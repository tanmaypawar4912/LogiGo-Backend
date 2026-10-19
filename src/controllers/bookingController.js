import { randomBytes } from "node:crypto";
import mongoose from "mongoose";

import Booking from "../models/Booking.js";
import DriverProfile from "../models/DriverProfile.js";
import DriverActivity from "../models/DriverActivity.js";
import { calculateFareEstimate } from "../services/fareService.js";
import {
  dispatchBooking,
  driverIsDispatchEligible,
  profilesAreDispatchEligible,
} from "../services/dispatchService.js";
import {
  notifyAdminsNewBooking,
  notifyBookingStatusToCustomer,
} from "../services/bookingNotificationService.js";

const validStatuses = [
  "pending",
  "assigned",
  "accepted",
  "arriving_at_pickup",
  "arrived_at_pickup",
  "picked_up",
  "in_transit",
  "arrived_at_drop",
  "delivered",
  "cancelled",
];

const nextDriverStatus = {
  accepted: "arriving_at_pickup",
  arriving_at_pickup: "arrived_at_pickup",
  arrived_at_pickup: "picked_up",
  picked_up: "in_transit",
  in_transit: "arrived_at_drop",
  arrived_at_drop: "delivered",
};

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function generateBookingCode() {
  const suffix = randomBytes(4).toString("hex").toUpperCase();
  return `LG-${Date.now().toString(36).toUpperCase()}-${suffix}`;
}

async function logDriverActivity({
  driver,
  driverProfile = null,
  actor = driver,
  action,
  message,
  metadata = {},
}) {
  try {
    await DriverActivity.create({
      driver,
      driverProfile,
      actor,
      action,
      message,
      metadata,
    });
  } catch (error) {
    // Logging failure must not fail a valid booking operation.
    console.error("Driver activity log failed:", error.message);
  }
}

async function hasRequiredDriverDocumentsAndPhotos(profile) {
  return driverIsDispatchEligible(profile);
}

async function logBookingActivity({ actor, booking, action, message, metadata = {} }) {
  try {
    await DriverActivity.create({
      driver: null,
      driverProfile: null,
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
    console.error("Booking activity log failed:", error.message);
  }
}

// CUSTOMER: Create a booking. Server recalculates route and fare.
export const createBooking = async (req, res) => {
  try {
    const estimate = await calculateFareEstimate(req.body);

    const booking = await Booking.create({
      bookingCode: generateBookingCode(),
      customer: req.user.userId,
      vehicle: estimate.vehicle.id,
      pickup: estimate.route.pickup,
      drop: estimate.route.drop,
      package: {
        description: req.body.packageDescription,
        weightKg: estimate.package.weightKg,
        specialInstructions: req.body.specialInstructions || "",
      },
      route: {
        distanceMeters: estimate.route.distanceMeters,
        distanceKm: estimate.route.distanceKm,
        durationSeconds: estimate.route.durationSeconds,
        durationMinutes: estimate.route.durationMinutes,
      },
      fare: estimate.fare,
      status: "pending",
      paymentStatus: "unpaid",
      dispatch: { mode: "automatic", status: "searching", offers: [] },
      statusHistory: [
        {
          status: "pending",
          changedBy: req.user.userId,
          note: "Booking created by customer",
        },
      ],
    });

    // Record booking creation separately from driver activity so the admin
    // audit trail includes customer-created orders before any driver is assigned.
    void logBookingActivity({
      actor: req.user.userId,
      booking,
      action: "booking_created",
      message: `Customer placed booking ${booking.bookingCode}`,
      metadata: {
        customerId: String(req.user.userId),
        vehicleId: String(booking.vehicle),
        weightKg: booking.package.weightKg,
        estimatedFare: booking.fare.estimatedFare,
      },
    });

    // Do not make booking creation dependent on SMTP or driver availability.
    // Dispatch state is persisted and the background worker retries it.
    void notifyAdminsNewBooking(booking._id);
    void notifyBookingStatusToCustomer(
      booking._id,
      "pending",
      "Your booking has been received. Automatic driver dispatch has started."
    );
    void dispatchBooking(booking._id);

    // Booking creation has committed. Treat a failed optional populate/read as
    // non-fatal so the client does not retry and accidentally create a second
    // order after a successful database write.
    let savedBooking = booking.toObject();
    try {
      savedBooking =
        (await Booking.findById(booking._id)
          .populate("vehicle", "name slug capacityKg")
          .lean()) || savedBooking;
    } catch (enrichmentError) {
      console.error("Could not enrich newly created booking response:", enrichmentError.message);
    }

    return res.status(201).json({
      success: true,
      message: "Booking created successfully",
      booking: savedBooking,
    });
  } catch (error) {
    console.error("Create booking error:", error.message);

    return res.status(error.statusCode || 500).json({
      success: false,
      message:
        error.statusCode && error.statusCode < 500
          ? error.message
          : "Unable to create booking at this time.",
    });
  }
};

// CUSTOMER: Only the logged-in customer's own bookings.
export const getMyBookings = async (req, res) => {
  try {
    const page = Math.max(
      1,
      Number.parseInt(req.query.page, 10) || 1
    );

    const limit = Math.min(
      50,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 10)
    );

    const status =
      typeof req.query.status === "string" ? req.query.status : "";

    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking status filter",
      });
    }

    const filter = {
      customer: req.user.userId,
      ...(status ? { status } : {}),
    };

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("vehicle", "name slug capacityKg")
        .lean(),
      Booking.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      bookings,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Get customer bookings error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve bookings",
    });
  }
};

// ADMIN: Bookings and currently online approved drivers.
export const getAdminBookingQueue = async (req, res) => {
  try {
    const requestedStatus =
      typeof req.query.status === "string"
        ? req.query.status
        : "pending";

    if (
      requestedStatus !== "all" &&
      !validStatuses.includes(requestedStatus)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking status filter",
      });
    }

    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 50)
    );

    const filter =
      requestedStatus === "all" ? {} : { status: requestedStatus };

    const [bookings, total, profiles] = await Promise.all([
      Booking.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate("customer", "name email phone")
        .populate("driver", "name email phone")
        .populate("vehicle", "name slug capacityKg")
        .lean(),

      Booking.countDocuments(filter),

      DriverProfile.find({
        approvalStatus: "approved",
        availability: "online",
        isActive: true,
        licenseExpiry: { $gt: new Date() },
      })
        .populate({
          path: "user",
          select: "name email phone role isActive",
        })
        .sort({ updatedAt: -1 })
        .lean(),
    ]);

    const driverCandidates = profiles.filter(
      (profile) =>
        profile.user &&
        profile.user.role === "driver" &&
        profile.user.isActive === true
    );
    const driverEligibility = await profilesAreDispatchEligible(driverCandidates);
    const availableDrivers = driverCandidates
      .filter((_profile, index) => driverEligibility[index])
      .map((profile) => ({
        profileId: profile._id,
        userId: profile.user._id,
        name: profile.user.name,
        email: profile.user.email,
        phone: profile.user.phone,
        vehicleType: profile.vehicleType,
        vehicleMakeModel: profile.vehicleMakeModel,
        vehicleRegistration: profile.vehicleRegistration,
        vehicleCapacityKg: profile.vehicleCapacityKg,
        availability: profile.availability,
      }));

    return res.status(200).json({
      success: true,
      bookings,
      availableDrivers,
      pagination: { total, limit },
    });
  } catch (error) {
    console.error("Get admin booking queue error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to load booking queue",
    });
  }
};

// ADMIN: Assign a currently online, approved driver.
export const assignDriver = async (req, res) => {
  let reservedDriverUserId = null;

  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID",
      });
    }

    const { driverUserId } = req.body;

    const bookingExists = await Booking.findById(req.params.id)
      .select("_id status driver")
      .lean();

    if (!bookingExists) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    if (bookingExists.status !== "pending" || bookingExists.driver) {
      return res.status(409).json({
        success: false,
        message: "Only unassigned pending bookings can be assigned",
      });
    }

    const driverProfile = await DriverProfile.findOne({
      user: driverUserId,
      approvalStatus: "approved",
      availability: "online",
      isActive: true,
      licenseExpiry: { $gt: new Date() },
    })
      .populate({ path: "user", select: "role isActive" })
      .lean();

    if (
      !driverProfile ||
      !driverProfile.user ||
      driverProfile.user.role !== "driver" ||
      driverProfile.user.isActive !== true
    ) {
      return res.status(409).json({
        success: false,
        message: "Driver is not eligible or available for assignment",
      });
    }

    if (!(await hasRequiredDriverDocumentsAndPhotos(driverProfile))) {
      return res.status(409).json({
        success: false,
        message:
          "Driver is missing a valid licence/identity/vehicle document or one of the four vehicle photos",
      });
    }

    const bookingDetails = await Booking.findById(req.params.id)
      .select("package vehicle")
      .populate("vehicle", "slug name isActive")
      .lean();

    if (
      !bookingDetails?.vehicle ||
      bookingDetails.vehicle.isActive === false ||
      driverProfile.vehicleType !== bookingDetails.vehicle.slug ||
      driverProfile.vehicleCapacityKg < bookingDetails.package.weightKg
    ) {
      return res.status(409).json({
        success: false,
        message: "Driver vehicle category or capacity does not match this booking",
      });
    }

    // Atomically reserve the driver to prevent concurrent double assignment.
    const reservedProfile = await DriverProfile.findOneAndUpdate(
      {
        user: driverUserId,
        approvalStatus: "approved",
        availability: "online",
        isActive: true,
        licenseExpiry: { $gt: new Date() },
      },
      { $set: { availability: "busy" } },
      { returnDocument: "after", runValidators: true }
    );

    if (!reservedProfile) {
      return res.status(409).json({
        success: false,
        message: "Driver is no longer available",
      });
    }

    reservedDriverUserId = driverUserId;

    const assignedBooking = await Booking.findOneAndUpdate(
      {
        _id: req.params.id,
        status: "pending",
        driver: null,
      },
      {
        $set: {
          driver: driverUserId,
          status: "assigned",
          "dispatch.mode": "manual",
          "dispatch.status": "offering",
          "dispatch.offers.$[offer].status": "lost",
          "dispatch.offers.$[offer].respondedAt": new Date(),
        },
        $push: {
          statusHistory: {
            status: "assigned",
            changedBy: req.user.userId,
            note: "Driver assigned by admin",
          },
        },
      },
      {
        returnDocument: "after",
        runValidators: true,
        arrayFilters: [{ "offer.status": "offered" }],
      }
    ).lean();

    if (!assignedBooking) {
      await DriverProfile.updateOne(
        { user: driverUserId, availability: "busy" },
        { $set: { availability: "online" } }
      );

      reservedDriverUserId = null;

      return res.status(409).json({
        success: false,
        message: "Booking changed before assignment. Refresh the queue.",
      });
    }

    // The database assignment succeeded; do not release the driver if optional
    // response enrichment or email delivery fails after this point.
    reservedDriverUserId = null;

    let booking = assignedBooking;
    try {
      booking =
        (await Booking.findById(assignedBooking._id)
          .populate("customer", "name email phone")
          .populate("driver", "name email phone")
          .populate("vehicle", "name slug capacityKg")
          .lean()) || assignedBooking;
    } catch (enrichmentError) {
      console.error("Could not enrich driver assignment response:", enrichmentError.message);
    }

    void notifyBookingStatusToCustomer(booking._id, "assigned", "A driver has been assigned to your delivery.");

    await logDriverActivity({
      driver: driverUserId,
      driverProfile: driverProfile._id,
      actor: req.user.userId,
      action: "job_assigned",
      message: `Admin assigned booking ${booking.bookingCode || booking._id}`,
      metadata: {
        bookingId: booking._id,
        bookingCode: booking.bookingCode,
        status: booking.status,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Driver assigned successfully",
      booking,
    });
  } catch (error) {
    if (reservedDriverUserId) {
      try {
        await DriverProfile.updateOne(
          { user: reservedDriverUserId, availability: "busy" },
          { $set: { availability: "online" } }
        );
      } catch (releaseError) {
        console.error(
          "Could not release reserved driver:",
          releaseError.message
        );
      }
    }

    console.error("Assign driver error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to assign driver",
    });
  }
};

// DRIVER: Assigned jobs/history plus live automatic dispatch offers.
export const getDriverJobs = async (req, res) => {
  try {
    const now = new Date();
    const [jobs, profile] = await Promise.all([
      Booking.find({ driver: req.user.userId })
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(100)
        .populate("customer", "name phone")
        .populate("vehicle", "name capacityKg slug")
        .lean(),
      DriverProfile.findOne({ user: req.user.userId })
        .select("availability approvalStatus isActive")
        .lean(),
    ]);

    let offers = [];
    if (
      profile?.availability === "online" &&
      profile.approvalStatus === "approved" &&
      profile.isActive
    ) {
      offers = await Booking.find({
        status: "pending",
        driver: null,
        "dispatch.offers": {
          $elemMatch: {
            driver: req.user.userId,
            status: "offered",
            expiresAt: { $gt: now },
          },
        },
      })
        .sort({ createdAt: 1 })
        .limit(25)
        .populate("customer", "name phone")
        .populate("vehicle", "name capacityKg slug")
        .lean();

      offers = offers.map((booking) => ({
        ...booking,
        dispatch: {
          ...booking.dispatch,
          offers: (booking.dispatch?.offers || []).filter(
            (offer) => String(offer.driver) === String(req.user.userId)
          ),
        },
      }));
    }

    return res.status(200).json({
      success: true,
      count: jobs.length,
      jobs,
      offers,
    });
  } catch (error) {
    console.error("Get driver jobs error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to load driver jobs",
    });
  }
};

// DRIVER: Accept/reject an automatic offer or a legacy admin assignment.
export const respondToBooking = async (req, res) => {
  let reservedProfileUserId = null;

  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid booking ID" });
    }

    const { action, rejectionReason = "" } = req.body;
    const driverUserId = req.user.userId;
    const now = new Date();

    const offerBooking = await Booking.findOne({
      _id: req.params.id,
      status: "pending",
      driver: null,
      "dispatch.offers": {
        $elemMatch: {
          driver: driverUserId,
          status: "offered",
          expiresAt: { $gt: now },
        },
      },
    }).select("_id bookingCode status driver dispatch").lean();

    // Automatic dispatch offer: another driver may accept at any moment, so
    // accept is claimed atomically after this driver's profile is reserved.
    if (offerBooking) {
      // Read the profile for audit metadata. Declining a valid outstanding offer
      // must remain possible even if the driver went offline or became ineligible
      // after the offer was sent; accepting is checked separately below.
      const profile = await DriverProfile.findOne({ user: driverUserId })
        .select("user _id approvalStatus availability isActive licenseExpiry documents vehiclePhotos registeredVehicles")
        .lean();

      if (action === "reject") {
        const rejected = await Booking.findOneAndUpdate(
          {
            _id: req.params.id,
            status: "pending",
            driver: null,
            "dispatch.offers": {
              $elemMatch: {
                driver: driverUserId,
                status: "offered",
                expiresAt: { $gt: now },
              },
            },
          },
          {
            $set: {
              "dispatch.offers.$.status": "rejected",
              "dispatch.offers.$.respondedAt": now,
              "dispatch.offers.$.rejectionReason": rejectionReason,
            },
            $push: {
              statusHistory: {
                status: "pending",
                changedBy: driverUserId,
                note: `Driver declined automatic offer: ${rejectionReason}`,
              },
            },
          },
          { returnDocument: "after", runValidators: true }
        ).lean();

        if (!rejected) {
          return res.status(409).json({
            success: false,
            message: "This offer is no longer available. Refresh your jobs.",
          });
        }

        await logDriverActivity({
          driver: driverUserId,
          driverProfile: profile?._id || null,
          action: "job_offer_rejected",
          message: `Driver declined automatic offer for booking ${rejected.bookingCode}`,
          metadata: { bookingId: rejected._id, bookingCode: rejected.bookingCode, rejectionReason },
        });

        void dispatchBooking(rejected._id);

        return res.status(200).json({
          success: true,
          message: "Offer declined. The job remains available to other drivers or will be redispatched.",
          booking: rejected,
        });
      }

      if (
        !profile ||
        profile.approvalStatus !== "approved" ||
        profile.availability !== "online" ||
        !profile.isActive ||
        new Date(profile.licenseExpiry) <= now ||
        !(await driverIsDispatchEligible(profile))
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Your driver profile, online status, documents or vehicle photos no longer meet the requirements for accepting this job.",
        });
      }

      // Atomic driver reservation prevents the same driver from claiming two
      // concurrent offers (or being assigned a second active job).
      const reservedProfile = await DriverProfile.findOneAndUpdate(
        {
          user: driverUserId,
          approvalStatus: "approved",
          availability: "online",
          isActive: true,
          licenseExpiry: { $gt: now },
        },
        { $set: { availability: "busy" } },
        { returnDocument: "after", runValidators: true }
      );

      if (!reservedProfile) {
        return res.status(409).json({
          success: false,
          message: "You are no longer available to accept this job. Refresh your jobs.",
        });
      }

      reservedProfileUserId = driverUserId;

      const accepted = await Booking.findOneAndUpdate(
        {
          _id: req.params.id,
          status: "pending",
          driver: null,
          "dispatch.offers": {
            $elemMatch: {
              driver: driverUserId,
              status: "offered",
              expiresAt: { $gt: now },
            },
          },
        },
        {
          $set: {
            driver: driverUserId,
            status: "accepted",
            "dispatch.status": "accepted",
            "dispatch.offers.$[winner].status": "accepted",
            "dispatch.offers.$[winner].respondedAt": now,
          },
          $push: {
            statusHistory: {
              $each: [
                {
                  status: "assigned",
                  changedBy: driverUserId,
                  note: "Booking claimed through automatic driver dispatch",
                },
                {
                  status: "accepted",
                  changedBy: driverUserId,
                  note: "Driver accepted the automatic dispatch offer",
                },
              ],
            },
          },
        },
        {
          returnDocument: "after",
          runValidators: true,
          arrayFilters: [
            {
              "winner.driver": new mongoose.Types.ObjectId(driverUserId),
              "winner.status": "offered",
              "winner.expiresAt": { $gt: now },
            },
          ],
        }
      ).lean();

      if (!accepted) {
        await DriverProfile.updateOne(
          { user: driverUserId, availability: "busy" },
          { $set: { availability: "online" } }
        );
        reservedProfileUserId = null;
        return res.status(409).json({
          success: false,
          message: "Another driver accepted this job, or the offer expired. It is no longer available.",
        });
      }

      // The booking claim succeeded. Do not release this driver after this
      // point, even if non-critical offer cleanup or notifications fail.
      reservedProfileUserId = null;

      const competingOffers = (accepted.dispatch?.offers || []).filter(
        (offer) =>
          offer.status === "offered" &&
          String(offer.driver) !== String(driverUserId)
      );

      // Make all competing offers unavailable while preserving their audit rows.
      // Booking.status/driver are already atomically claimed, so cleanup failure
      // cannot permit a second driver to accept this booking.
      try {
        await Booking.updateOne(
          { _id: accepted._id },
          {
            $set: {
              "dispatch.offers.$[other].status": "lost",
              "dispatch.offers.$[other].respondedAt": now,
            },
          },
          {
            arrayFilters: [
              {
                "other.driver": { $ne: new mongoose.Types.ObjectId(driverUserId) },
                "other.status": "offered",
              },
            ],
          }
        );
      } catch (cleanupError) {
        console.error("Could not mark competing dispatch offers lost:", cleanupError.message);
      }

      await Promise.all(
        competingOffers.map((offer) =>
          logDriverActivity({
            driver: offer.driver,
            actor: driverUserId,
            driverProfile: null,
            action: "job_offer_lost",
            message: `Automatic dispatch offer became unavailable after another driver accepted booking ${accepted.bookingCode}`,
            metadata: {
              bookingId: accepted._id,
              bookingCode: accepted.bookingCode,
              winnerDriverId: String(driverUserId),
            },
          })
        )
      );

      await logDriverActivity({
        driver: driverUserId,
        driverProfile: reservedProfile._id,
        action: "job_accepted",
        message: `Driver accepted booking ${accepted.bookingCode}`,
        metadata: { bookingId: accepted._id, bookingCode: accepted.bookingCode, status: accepted.status, dispatchMode: "automatic" },
      });

      void notifyBookingStatusToCustomer(
        accepted._id,
        "accepted",
        "A driver has accepted your delivery booking."
      );

      return res.status(200).json({
        success: true,
        message: "Job accepted successfully. Other driver offers are now unavailable.",
        booking: accepted,
      });
    }

    // Backward-compatible handling for bookings assigned manually before
    // automatic dispatch was enabled.
    const profile = await DriverProfile.findOne({
      user: driverUserId,
      approvalStatus: "approved",
      isActive: true,
    }).lean();

    if (!profile) {
      return res.status(403).json({
        success: false,
        message: "An approved active driver profile is required",
      });
    }

    const currentBooking = await Booking.findOne({
      _id: req.params.id,
      driver: driverUserId,
      status: "assigned",
    }).select("_id bookingCode status").lean();

    if (!currentBooking) {
      return res.status(409).json({
        success: false,
        message: "This job is no longer assigned/offered to you",
      });
    }

    const accepting = action === "accept";
    const update = accepting
      ? {
          $set: { status: "accepted" },
          $push: {
            statusHistory: {
              status: "accepted",
              changedBy: driverUserId,
              note: "Driver accepted the assigned job",
            },
          },
        }
      : {
          $set: {
            status: "pending",
            driver: null,
            "dispatch.mode": "automatic",
            "dispatch.status": "searching",
            "dispatch.nextAttemptAt": now,
            "dispatch.offers.$[offer].status": "lost",
            "dispatch.offers.$[offer].respondedAt": now,
          },
          $push: {
            statusHistory: {
              status: "pending",
              changedBy: driverUserId,
              note: `Driver rejected assignment: ${rejectionReason}`,
            },
          },
        };

    const booking = await Booking.findOneAndUpdate(
      {
        _id: req.params.id,
        driver: driverUserId,
        status: "assigned",
      },
      update,
      {
        returnDocument: "after",
        runValidators: true,
        ...(accepting ? {} : { arrayFilters: [{ "offer.status": "offered" }] }),
      }
    ).lean();

    if (!booking) {
      return res.status(409).json({
        success: false,
        message: "The job changed. Refresh your jobs list.",
      });
    }

    if (!accepting) {
      await DriverProfile.updateOne(
        { user: driverUserId, availability: "busy" },
        { $set: { availability: "online" } }
      );
      void dispatchBooking(booking._id);
    } else {
      void notifyBookingStatusToCustomer(
        booking._id,
        "accepted",
        "A driver has accepted your delivery booking."
      );
    }

    await logDriverActivity({
      driver: driverUserId,
      driverProfile: profile._id,
      action: accepting ? "job_accepted" : "job_rejected",
      message: accepting
        ? `Driver accepted booking ${booking.bookingCode || booking._id}`
        : `Driver rejected assignment for booking ${booking.bookingCode || booking._id}`,
      metadata: {
        bookingId: booking._id,
        bookingCode: booking.bookingCode,
        status: booking.status,
        rejectionReason: accepting ? "" : rejectionReason,
      },
    });

    return res.status(200).json({
      success: true,
      message: accepting
        ? "Job accepted successfully"
        : "Job declined and returned to automatic dispatch",
      booking,
    });
  } catch (error) {
    if (reservedProfileUserId) {
      await DriverProfile.updateOne(
        { user: reservedProfileUserId, availability: "busy" },
        { $set: { availability: "online" } }
      ).catch((releaseError) => {
        console.error("Could not release reserved driver:", releaseError.message);
      });
    }

    console.error("Respond to booking error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to respond to this job",
    });
  }
};

// DRIVER: Advance through the allowed delivery-status sequence.
export const updateDriverBookingStatus = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID",
      });
    }

    const currentBooking = await Booking.findOne({
      _id: req.params.id,
      driver: req.user.userId,
    })
      .select("_id status")
      .lean();

    if (!currentBooking) {
      return res.status(404).json({
        success: false,
        message: "Assigned booking not found",
      });
    }

    const expectedNext = nextDriverStatus[currentBooking.status];

    if (!expectedNext || req.body.status !== expectedNext) {
      return res.status(409).json({
        success: false,
        message: expectedNext
          ? `Next valid status is ${expectedNext}`
          : "This booking cannot advance to another delivery status",
        currentStatus: currentBooking.status,
        expectedNextStatus: expectedNext || null,
      });
    }

    const booking = await Booking.findOneAndUpdate(
      {
        _id: req.params.id,
        driver: req.user.userId,
        status: currentBooking.status,
      },
      {
        $set: { status: expectedNext },
        $push: {
          statusHistory: {
            status: expectedNext,
            changedBy: req.user.userId,
            note: `Driver updated delivery status to ${expectedNext}`,
          },
        },
      },
      { returnDocument: "after", runValidators: true }
    ).lean();

    if (!booking) {
      return res.status(409).json({
        success: false,
        message: "Booking changed concurrently. Refresh and try again.",
      });
    }

    if (expectedNext === "delivered") {
      await DriverProfile.updateOne(
        { user: req.user.userId, availability: "busy" },
        { $set: { availability: "online" } }
      );
    }

    const driverProfile = await DriverProfile.findOne({
      user: req.user.userId,
    })
      .select("_id")
      .lean();

    void notifyBookingStatusToCustomer(
      booking._id,
      expectedNext,
      expectedNext === "delivered"
        ? "Your delivery has been marked complete."
        : "The driver updated your delivery progress."
    );

    await logDriverActivity({
      driver: req.user.userId,
      driverProfile: driverProfile?._id || null,
      action:
        expectedNext === "delivered"
          ? "job_delivered"
          : "job_status_updated",
      message: `Driver updated booking ${booking.bookingCode || booking._id} to ${expectedNext}`,
      metadata: {
        bookingId: booking._id,
        bookingCode: booking.bookingCode,
        status: expectedNext,
      },
    });

    return res.status(200).json({
      success: true,
      message: `Delivery status updated to ${expectedNext}`,
      booking,
    });
  } catch (error) {
    console.error("Update delivery status error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to update delivery status",
    });
  }
};

// CUSTOMER, assigned DRIVER or ADMIN: Authorized booking details.
export const getBookingById = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID",
      });
    }

    const booking = await Booking.findById(req.params.id)
      .populate("vehicle", "name slug capacityKg")
      .populate("customer", "name email phone")
      .populate("driver", "name phone")
      .lean();

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    const userId = req.user.userId;
    const isAdmin = req.user.role === "admin";
    const isCustomer = booking.customer?._id?.toString() === userId;
    const isAssignedDriver = booking.driver?._id?.toString() === userId;

    if (!isAdmin && !isCustomer && !isAssignedDriver) {
      return res.status(403).json({
        success: false,
        message: "You cannot access this booking",
      });
    }

    return res.status(200).json({ success: true, booking });
  } catch (error) {
    console.error("Get booking error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve booking",
    });
  }
};