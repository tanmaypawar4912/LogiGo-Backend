import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import DriverProfile from "../models/DriverProfile.js";
import DriverMediaAsset from "../models/DriverMediaAsset.js";
import DriverActivity from "../models/DriverActivity.js";
import {
  notifyDriversOfBookingOffer,
  notifyAdminsDispatchExhausted,
  notifyBookingStatusToCustomer,
} from "./bookingNotificationService.js";

const OFFER_TTL_MS = 2 * 60 * 1000;
const RETRY_DELAY_MS = 30 * 1000;
const LOCK_TTL_MS = 2 * 60 * 1000;
// Send each booking offer to one eligible driver at a time. A new offer is
// created only after the current offer is rejected or expires.
const OFFER_BATCH_SIZE = 1;
const DRIVER_REOFFER_COOLDOWN_MS = 5 * 60 * 1000;
const SWEEP_BATCH_SIZE = 50;
const ACTIVE_ASSET_STATUSES = ["uploaded", "linked"];

function validHttpsUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

const DOCUMENT_KINDS = [
  "license-document",
  "identity-document",
  "vehicle-document",
];
const PHOTO_VIEWS = ["front", "right", "left", "back"];

function profileMediaRequirements(profile) {
  if (!profile?.user) return null;

  const ownerId = profile.user._id || profile.user;
  const owner = String(ownerId);
  const primaryVehicle = (profile.registeredVehicles || []).find(
    (vehicle) => vehicle.isPrimary
  ) || (profile.registeredVehicles || [])[0];

  const vehicleDocumentAssetId =
    primaryVehicle?.vehicleDocumentAssetId ||
    profile.documents?.vehicleDocumentAssetId;
  const vehicleDocumentUrl =
    primaryVehicle?.vehicleDocumentUrl ||
    profile.documents?.vehicleDocumentUrl;

  const documents = [
    {
      assetId: profile.documents?.licenseDocumentAssetId,
      url: profile.documents?.licenseDocumentUrl,
      kind: "license-document",
    },
    {
      assetId: profile.documents?.identityDocumentAssetId,
      url: profile.documents?.identityDocumentUrl,
      kind: "identity-document",
    },
    {
      assetId: vehicleDocumentAssetId,
      url: vehicleDocumentUrl,
      kind: "vehicle-document",
    },
  ];

  const photos = {
    front: primaryVehicle?.photos?.front || profile.vehiclePhotos?.front || "",
    right: primaryVehicle?.photos?.right || profile.vehiclePhotos?.right || "",
    left: primaryVehicle?.photos?.left || profile.vehiclePhotos?.left || "",
    back: primaryVehicle?.photos?.back || profile.vehiclePhotos?.back || "",
  };

  return { owner, documents, photos };
}

/**
 * Verify a batch of candidate profiles using one media-asset query rather
 * than issuing up to seven database queries per candidate. The supplied
 * asset ID must match owner and kind; URLs for vehicle photos must match the
 * exact uploaded asset, owner, view, and active asset status.
 */
export async function profilesAreDispatchEligible(profiles) {
  const requirements = profiles.map(profileMediaRequirements);
  const ownerIds = new Set();
  const documentAssetIds = new Set();
  const photoUrls = new Set();

  for (const requirement of requirements) {
    if (!requirement) continue;
    ownerIds.add(requirement.owner);

    for (const document of requirement.documents) {
      if (document.assetId && mongoose.isValidObjectId(document.assetId)) {
        documentAssetIds.add(String(document.assetId));
      }
    }

    for (const view of PHOTO_VIEWS) {
      const url = requirement.photos[view];
      if (validHttpsUrl(url)) photoUrls.add(url);
    }
  }

  const clauses = [];
  if (documentAssetIds.size) {
    clauses.push({
      _id: { $in: [...documentAssetIds] },
      kind: { $in: DOCUMENT_KINDS },
    });
  }
  if (photoUrls.size) {
    clauses.push({
      kind: "vehicle-photo",
      view: { $in: PHOTO_VIEWS },
      secureUrl: { $in: [...photoUrls] },
    });
  }

  let assets = [];
  if (ownerIds.size && clauses.length) {
    assets = await DriverMediaAsset.find({
      owner: { $in: [...ownerIds] },
      status: { $in: ACTIVE_ASSET_STATUSES },
      $or: clauses,
    })
      .select("_id owner kind view secureUrl status")
      .lean();
  }

  const documentAssetKeys = new Set(
    assets.map((asset) =>
      `${String(asset.owner)}|${asset.kind}|${String(asset._id)}`
    )
  );
  const photoKeys = new Set(
    assets
      .filter((asset) => asset.kind === "vehicle-photo")
      .map((asset) =>
        `${String(asset.owner)}|${asset.view}|${asset.secureUrl}`
      )
  );

  return requirements.map((requirement) => {
    if (!requirement) return false;

    const documentsValid = requirement.documents.every((document) => {
      if (document.assetId) {
        if (!mongoose.isValidObjectId(document.assetId)) return false;
        return documentAssetKeys.has(
          `${requirement.owner}|${document.kind}|${String(document.assetId)}`
        );
      }

      // Legacy HTTPS URLs remain accepted for existing records during
      // migration. Newly uploaded private documents should use asset IDs.
      return validHttpsUrl(document.url);
    });

    const photosValid = PHOTO_VIEWS.every((view) => {
      const url = requirement.photos[view];
      return (
        validHttpsUrl(url) &&
        photoKeys.has(`${requirement.owner}|${view}|${url}`)
      );
    });

    return documentsValid && photosValid;
  });
}

export async function driverIsDispatchEligible(profile) {
  const [eligible] = await profilesAreDispatchEligible([profile]);
  return Boolean(eligible);
}

/**
 * Return human-readable reasons why a driver cannot go online yet.
 * This uses the same document/photo ownership rules as automatic dispatch,
 * so the dashboard can tell the driver what must be corrected without
 * weakening the eligibility checks.
 */
export async function getDriverDispatchEligibility(profile) {
  const requirement = profileMediaRequirements(profile);
  if (!requirement) {
    return {
      eligible: false,
      missing: ["Driver profile could not be resolved"],
    };
  }

  const documentAssetIds = requirement.documents
    .map((document) => document.assetId)
    .filter((assetId) => assetId && mongoose.isValidObjectId(assetId))
    .map(String);
  const photoUrls = PHOTO_VIEWS
    .map((view) => requirement.photos[view])
    .filter((url) => validHttpsUrl(url));

  const clauses = [];
  if (documentAssetIds.length) {
    clauses.push({
      _id: { $in: documentAssetIds },
      kind: { $in: DOCUMENT_KINDS },
    });
  }
  if (photoUrls.length) {
    clauses.push({
      kind: "vehicle-photo",
      view: { $in: PHOTO_VIEWS },
      secureUrl: { $in: photoUrls },
    });
  }

  const assets = clauses.length
    ? await DriverMediaAsset.find({
        owner: requirement.owner,
        status: { $in: ACTIVE_ASSET_STATUSES },
        $or: clauses,
      })
        .select("_id owner kind view secureUrl status")
        .lean()
    : [];

  const documentAssetKeys = new Set(
    assets.map((asset) =>
      `${String(asset.owner)}|${asset.kind}|${String(asset._id)}`
    )
  );
  const photoKeys = new Set(
    assets
      .filter((asset) => asset.kind === "vehicle-photo")
      .map((asset) =>
        `${String(asset.owner)}|${asset.view}|${asset.secureUrl}`
      )
  );

  const documentLabels = {
    "license-document": "driving licence document",
    "identity-document": "identity document",
    "vehicle-document": "vehicle registration document",
  };

  const missing = [];

  for (const document of requirement.documents) {
    let valid = false;

    if (document.assetId) {
      valid = Boolean(
        mongoose.isValidObjectId(document.assetId) &&
          documentAssetKeys.has(
            `${requirement.owner}|${document.kind}|${String(document.assetId)}`
          )
      );
    } else {
      // Legacy public HTTPS URLs remain accepted for old records.
      valid = validHttpsUrl(document.url);
    }

    if (!valid) missing.push(documentLabels[document.kind]);
  }

  const photoLabels = {
    front: "front vehicle photo",
    right: "right-side vehicle photo",
    left: "left-side vehicle photo",
    back: "rear vehicle photo",
  };

  for (const view of PHOTO_VIEWS) {
    const url = requirement.photos[view];
    const valid = Boolean(
      validHttpsUrl(url) &&
        photoKeys.has(`${requirement.owner}|${view}|${url}`)
    );

    if (!valid) missing.push(photoLabels[view]);
  }

  return {
    eligible: missing.length === 0,
    missing,
  };
}

async function getMatchingAvailableProfiles(booking) {
  const now = new Date();
  const vehicle = booking.vehicle && typeof booking.vehicle === "object"
    ? booking.vehicle
    : null;

  if (!vehicle?.slug || vehicle.isActive === false) return [];

  // Avoid immediately sending the same offer again to drivers who just
  // declined or let it expire, but do re-try them after a cooldown. Without
  // this, a booking could remain exhausted forever after every driver has
  // received one offer.
  const lastOfferByDriver = new Map();
  for (const offer of booking.dispatch?.offers || []) {
    const id = String(offer.driver);
    const previous = lastOfferByDriver.get(id);
    if (
      !previous ||
      new Date(offer.offeredAt || 0) >= new Date(previous.offeredAt || 0)
    ) {
      lastOfferByDriver.set(id, offer);
    }
  }

  const profiles = await DriverProfile.find({
    approvalStatus: "approved",
    availability: "online",
    isActive: true,
    licenseExpiry: { $gt: now },
    vehicleType: vehicle.slug,
    vehicleCapacityKg: { $gte: booking.package.weightKg },
  })
    .populate({ path: "user", select: "name email phone role isActive" })
    .sort({ updatedAt: 1 })
    .limit(200)
    .lean();

  const candidates = profiles.filter((profile) => {
    if (!profile.user || profile.user.role !== "driver" || !profile.user.isActive) {
      return false;
    }

    const lastOffer = lastOfferByDriver.get(String(profile.user._id));
    if (!lastOffer) return true;
    if (lastOffer.status === "offered" || lastOffer.status === "accepted" || lastOffer.status === "lost") {
      return false;
    }

    const lastResponseAt = new Date(
      lastOffer.respondedAt || lastOffer.expiresAt || lastOffer.offeredAt || 0
    ).getTime();
    return !Number.isFinite(lastResponseAt) ||
      now.getTime() - lastResponseAt >= DRIVER_REOFFER_COOLDOWN_MS;
  });

  // Check approved documents and all four owned photos before sending an offer.
  const eligibility = await profilesAreDispatchEligible(candidates);

  return candidates
    .filter((_profile, index) => eligibility[index])
    .slice(0, OFFER_BATCH_SIZE);
}

async function logDispatchActivity({
  driver,
  driverProfile,
  actor = driver,
  booking,
  action,
  message,
  metadata = {},
}) {
  try {
    await DriverActivity.create({
      driver,
      driverProfile: driverProfile || null,
      actor,
      action,
      message,
      metadata: {
        bookingId: booking._id,
        bookingCode: booking.bookingCode,
        ...metadata,
      },
    });
  } catch (error) {
    console.error("Dispatch activity log failed:", error.message);
  }
}

/**
 * Backfill dispatch defaults for bookings created before automatic dispatch
 * was introduced. Mongoose schema defaults apply when documents are created
 * through the model, but they do not retroactively add nested arrays to older
 * MongoDB records. Positional array updates such as dispatch.offers.$[expired]
 * fail if dispatch.offers is absent in one of those existing records.
 */
async function ensureDispatchState(bookingId, now = new Date()) {
  await Booking.updateOne(
    {
      _id: bookingId,
      $or: [
        { dispatch: { $exists: false } },
        { dispatch: null },
      ],
    },
    {
      $set: {
        dispatch: {
          mode: "automatic",
          status: "searching",
          offers: [],
          attemptCount: 0,
          lastAttemptAt: null,
          nextAttemptAt: now,
          lockedAt: null,
        },
      },
    }
  );

  await Booking.updateOne(
    {
      _id: bookingId,
      $or: [
        { "dispatch.offers": { $exists: false } },
        { "dispatch.offers": null },
      ],
    },
    { $set: { "dispatch.offers": [] } }
  );
}

export async function dispatchBooking(bookingId) {
  const now = new Date();
  let lockAcquired = false;

  try {
    if (!mongoose.isValidObjectId(bookingId)) return { dispatched: false, reason: "invalid_id" };

    // Existing MongoDB bookings need this migration before arrayFilters run.
    await ensureDispatchState(bookingId, now);

    const current = await Booking.findById(bookingId)
      .select("_id status driver dispatch")
      .lean();

    if (!current || current.status !== "pending" || current.driver) {
      return { dispatched: false, reason: "booking_not_dispatchable" };
    }

    const nextAttemptAt = current.dispatch?.nextAttemptAt
      ? new Date(current.dispatch.nextAttemptAt)
      : null;
    if (
      current.dispatch?.status === "exhausted" &&
      nextAttemptAt &&
      nextAttemptAt > now
    ) {
      return { dispatched: false, reason: "retry_not_due" };
    }

    // A short lease prevents concurrent workers from creating duplicate offers.
    const staleLockBefore = new Date(now.getTime() - LOCK_TTL_MS);
    const lockedBooking = await Booking.findOneAndUpdate(
      {
        _id: bookingId,
        status: "pending",
        driver: null,
        $or: [
          { "dispatch.lockedAt": null },
          { "dispatch.lockedAt": { $exists: false } },
          { "dispatch.lockedAt": { $lt: staleLockBefore } },
        ],
      },
      { $set: { "dispatch.lockedAt": now } },
      { returnDocument: "after" }
    );

    if (!lockedBooking) return { dispatched: false, reason: "already_processing" };
    lockAcquired = true;

    const expiredOffers = (lockedBooking.dispatch?.offers || []).filter(
      (offer) =>
        offer.status === "offered" &&
        new Date(offer.expiresAt).getTime() <= now.getTime()
    );

    const expirationUpdate = await Booking.updateOne(
      {
        _id: bookingId,
        status: "pending",
        driver: null,
        "dispatch.lockedAt": now,
      },
      {
        $set: {
          "dispatch.offers.$[expired].status": "expired",
          "dispatch.offers.$[expired].respondedAt": now,
        },
      },
      {
        arrayFilters: [
          { "expired.status": "offered", "expired.expiresAt": { $lte: now } },
        ],
      }
    );

    if (expirationUpdate.matchedCount !== 1) {
      lockAcquired = false;
      return { dispatched: false, reason: "dispatch_lock_lost" };
    }

    const booking = await Booking.findById(bookingId)
      .populate("vehicle", "name slug capacityKg isActive")
      .lean();

    if (!booking || booking.status !== "pending" || booking.driver) {
      await Booking.updateOne(
        { _id: bookingId, "dispatch.lockedAt": now },
        { $set: { "dispatch.lockedAt": null } }
      );
      lockAcquired = false;
      return { dispatched: false, reason: "booking_changed" };
    }

    if (expiredOffers.length) {
      await Promise.all(
        expiredOffers.map((offer) =>
          logDispatchActivity({
            driver: offer.driver,
            booking,
            action: "job_offer_expired",
            message: `Automatic dispatch offer expired for booking ${booking.bookingCode}`,
            metadata: {
              offerExpiresAt: offer.expiresAt,
            },
          })
        )
      );
    }

    const activeOffers = (booking.dispatch?.offers || []).filter(
      (offer) => offer.status === "offered" && new Date(offer.expiresAt) > now
    );

    if (activeOffers.length) {
      const earliestExpiry = activeOffers.reduce((earliest, offer) => {
        const expiresAt = new Date(offer.expiresAt);
        return expiresAt < earliest ? expiresAt : earliest;
      }, new Date(activeOffers[0].expiresAt));

      const released = await Booking.updateOne(
        {
          _id: bookingId,
          status: "pending",
          driver: null,
          "dispatch.lockedAt": now,
        },
        {
          $set: {
            "dispatch.status": "offering",
            "dispatch.nextAttemptAt": earliestExpiry,
            "dispatch.lockedAt": null,
          },
        }
      );
      lockAcquired = false;
      if (released.matchedCount !== 1) {
        return { dispatched: false, reason: "dispatch_lock_lost" };
      }
      return { dispatched: false, reason: "offers_still_active", activeOffers: activeOffers.length };
    }

    const profiles = await getMatchingAvailableProfiles(booking);

    if (!profiles.length) {
      const wasAlreadyExhausted = booking.dispatch?.status === "exhausted";
      const exhaustedUpdate = await Booking.updateOne(
        {
          _id: bookingId,
          status: "pending",
          driver: null,
          "dispatch.lockedAt": now,
        },
        {
          $set: {
            "dispatch.status": "exhausted",
            "dispatch.lastAttemptAt": now,
            "dispatch.nextAttemptAt": new Date(now.getTime() + RETRY_DELAY_MS),
            "dispatch.lockedAt": null,
          },
          $inc: { "dispatch.attemptCount": 1 },
        }
      );
      lockAcquired = false;

      if (exhaustedUpdate.matchedCount !== 1) {
        return { dispatched: false, reason: "dispatch_lock_lost" };
      }

      if (!wasAlreadyExhausted) {
        void notifyAdminsDispatchExhausted(bookingId);
        void notifyBookingStatusToCustomer(
          bookingId,
          "pending",
          "We are still matching your delivery with an eligible online driver. You do not need to place another booking; automatic dispatch will retry."
        );
      }

      return { dispatched: false, reason: "no_eligible_drivers" };
    }

    const expiresAt = new Date(now.getTime() + OFFER_TTL_MS);
    const newOffers = profiles.map((profile) => ({
      driver: profile.user._id,
      status: "offered",
      offeredAt: now,
      expiresAt,
      respondedAt: null,
      rejectionReason: "",
    }));

    const update = await Booking.updateOne(
      {
        _id: bookingId,
        status: "pending",
        driver: null,
        "dispatch.lockedAt": now,
      },
      {
        $push: { "dispatch.offers": { $each: newOffers } },
        $set: {
          "dispatch.status": "offering",
          "dispatch.lastAttemptAt": now,
          "dispatch.nextAttemptAt": expiresAt,
          "dispatch.lockedAt": null,
        },
        $inc: { "dispatch.attemptCount": 1 },
      }
    );

    lockAcquired = false;

    if (update.modifiedCount !== 1) {
      await Booking.updateOne(
        { _id: bookingId, "dispatch.lockedAt": now },
        { $set: { "dispatch.lockedAt": null } }
      );
      return { dispatched: false, reason: "booking_changed_before_offers" };
    }

    const driverIds = profiles.map((profile) => profile.user._id);
    await Promise.all(
      profiles.map((profile) =>
        logDispatchActivity({
          driver: profile.user._id,
          driverProfile: profile._id,
          booking,
          action: "job_offer_sent",
          message: `Automatic dispatch offer sent for booking ${booking.bookingCode}`,
          metadata: { expiresAt, vehicleType: profile.vehicleType },
        })
      )
    );

    // Notification delivery is best-effort: a mail failure must not erase offers.
    void notifyDriversOfBookingOffer(bookingId, driverIds, expiresAt);

    return { dispatched: true, offersCreated: driverIds.length, expiresAt };
  } catch (error) {
    console.error("Automatic dispatch failed:", error.message);
    if (lockAcquired) {
      await Booking.updateOne(
        { _id: bookingId, "dispatch.lockedAt": now },
        { $set: { "dispatch.lockedAt": null } }
      ).catch(() => undefined);
    }
    return { dispatched: false, reason: "internal_error" };
  }
}

export async function runDispatchSweep() {
  const now = new Date();

  try {
    const dueBookings = await Booking.find({
      status: "pending",
      driver: null,
      $or: [
        { "dispatch.status": "searching" },
        {
          "dispatch.status": "offering",
          "dispatch.nextAttemptAt": { $lte: now },
        },
        {
          "dispatch.status": "exhausted",
          "dispatch.nextAttemptAt": { $lte: now },
        },
        { "dispatch.status": { $exists: false } },
      ],
    })
      .select("_id")
      .sort({ createdAt: 1 })
      .limit(SWEEP_BATCH_SIZE)
      .lean();

    for (const booking of dueBookings) {
      await dispatchBooking(booking._id);
    }
  } catch (error) {
    console.error("Automatic dispatch sweep failed:", error.message);
  }
}

export function startDispatchWorker() {
  // Run once on startup, then retry offers/exhausted bookings on an interval.
  void runDispatchSweep();
  const timer = setInterval(() => void runDispatchSweep(), 10_000);
  timer.unref?.();
  console.log("LogiGo automatic dispatch worker started (10-second sweep)");
  return timer;
}

export const dispatchConfig = {
  offerTtlMs: OFFER_TTL_MS,
  batchSize: OFFER_BATCH_SIZE,
};
