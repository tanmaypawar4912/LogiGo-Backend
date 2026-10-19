import mongoose from "mongoose";
import DriverProfile from "../models/DriverProfile.js";
import DriverActivity from "../models/DriverActivity.js";
import Vehicle from "../models/Vehicle.js";
import DriverMediaAsset from "../models/DriverMediaAsset.js";
import {
  driverIsDispatchEligible,
  getDriverDispatchEligibility,
  profilesAreDispatchEligible,
} from "../services/dispatchService.js";

const publicDriverFields = "name email phone role";
const emptyPhotos = { front: "", right: "", left: "", back: "" };

async function logActivity({
  driver, driverProfile, actor = driver, action, message, metadata = {},
}) {
  try {
    await DriverActivity.create({
      driver, driverProfile, actor, action, message, metadata,
    });
  } catch (error) {
    console.error("Driver activity log failed:", error.message);
  }
}

function isValidFutureDate(value) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date > new Date();
}

function isHttpsUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

async function hasRequiredDriverDocumentsAndPhotos(profile) {
  return driverIsDispatchEligible(profile);
}

async function linkDriverMediaAssets({ ownerId, profileId, documentAssetIds = [], photoUrls = [] }) {
  const assetIds = [...new Set(documentAssetIds.filter(Boolean).map(String))]
    .filter((id) => mongoose.isValidObjectId(id));
  const urls = [...new Set(photoUrls.filter((url) => typeof url === "string" && url.trim()))];

  try {
    if (assetIds.length) {
      await DriverMediaAsset.updateMany(
        {
          _id: { $in: assetIds },
          owner: ownerId,
          status: { $in: ["uploaded", "linked"] },
        },
        { $set: { driverProfile: profileId, status: "linked" } }
      );
    }

    if (urls.length) {
      await DriverMediaAsset.updateMany(
        {
          owner: ownerId,
          kind: "vehicle-photo",
          secureUrl: { $in: urls },
          status: { $in: ["uploaded", "linked"] },
        },
        { $set: { driverProfile: profileId, status: "linked" } }
      );
    }
  } catch (error) {
    // Saving a profile/request must not be reported as failed after it has
    // already committed. Deletion also checks live profile references, so a
    // temporary linking failure cannot make an in-use photo deletable.
    console.error("Link driver media assets failed:", error.message);
  }
}

async function ownedUploadedAsset(assetId, ownerId, kind) {
  if (!assetId || !mongoose.isValidObjectId(assetId)) return null;
  return DriverMediaAsset.findOne({
    _id: assetId,
    owner: ownerId,
    kind,
    status: { $in: ["uploaded", "linked"] },
  });
}

async function validateDocumentAssets({
  ownerId,
  documents,
  vehicleDocumentAssetId,
}) {
  const doc = documents || {};
  const checks = [
    [doc.licenseDocumentAssetId, "license-document"],
    [doc.identityDocumentAssetId, "identity-document"],
    [doc.vehicleDocumentAssetId || vehicleDocumentAssetId, "vehicle-document"],
  ];

  for (const [assetId, kind] of checks) {
    if (!assetId) continue;
    const asset = await ownedUploadedAsset(assetId, ownerId, kind);
    if (!asset) return false;
  }

  return true;
}

async function ensurePrimaryVehicle(profile) {
  if (!Array.isArray(profile.registeredVehicles)) {
    profile.registeredVehicles = [];
  }

  if (profile.registeredVehicles.length === 0) {
    profile.registeredVehicles.push({
      vehicleType: profile.vehicleType,
      vehicleMakeModel: profile.vehicleMakeModel,
      vehicleRegistration: profile.vehicleRegistration,
      vehicleCapacityKg: profile.vehicleCapacityKg,
      vehicleDocumentUrl: profile.documents?.vehicleDocumentUrl || "",
      vehicleDocumentAssetId:
        profile.documents?.vehicleDocumentAssetId || null,
      photos: profile.vehiclePhotos || emptyPhotos,
      approvalStatus: profile.approvalStatus,
      isPrimary: true,
      approvedBy: profile.approvedBy || null,
      approvedAt: profile.approvedAt || null,
      rejectionReason: profile.rejectionReason || "",
    });
    await profile.save();
  } else if (!profile.registeredVehicles.some((item) => item.isPrimary)) {
    profile.registeredVehicles[0].isPrimary = true;
    await profile.save();
  }

  return profile;
}

async function activeCatalogVehicle(slug) {
  return Vehicle.findOne({ slug, isActive: true })
    .select("_id slug name capacityKg")
    .lean();
}

async function registrationInUse(
  registration,
  excludeUserId,
  excludeVehicleId = null
) {
  const profiles = await DriverProfile.find({
    $or: [
      { vehicleRegistration: registration },
      { "registeredVehicles.vehicleRegistration": registration },
    ],
    user: { $ne: excludeUserId },
  }).select("_id").limit(1).lean();

  if (profiles.length) return true;

  const ownProfile = await DriverProfile.findOne({ user: excludeUserId });
  if (!ownProfile) return false;

  const ownVehicle = (ownProfile.registeredVehicles || []).find((vehicle) =>
    vehicle.vehicleRegistration === registration &&
    (!excludeVehicleId ||
      vehicle._id.toString() !== excludeVehicleId.toString())
  );

  return Boolean(
    ownVehicle ||
    (ownProfile.vehicleRegistration === registration && !excludeVehicleId)
  );
}

function profileVehiclePayload(body) {
  return {
    vehicleType: body.vehicleType,
    vehicleMakeModel: body.vehicleMakeModel,
    vehicleRegistration: body.vehicleRegistration,
    vehicleCapacityKg: body.vehicleCapacityKg,
    vehicleDocumentUrl: body.vehicleDocumentAssetId
      ? ""
      : body.vehicleDocumentUrl || body.documents?.vehicleDocumentUrl || "",
    vehicleDocumentAssetId:
      body.vehicleDocumentAssetId ||
      body.documents?.vehicleDocumentAssetId ||
      null,
    photos: body.photos || body.vehiclePhotos || emptyPhotos,
  };
}

// DRIVER: Create initial onboarding profile once.
export const submitDriverProfile = async (req, res) => {
  try {
    const existing = await DriverProfile.findOne({ user: req.user.userId });

    if (existing) {
      return res.status(409).json({
        success: false,
        message:
          "A driver profile already exists. Use PATCH /drivers/profile to update it directly.",
      });
    }

    if (!isValidFutureDate(req.body.licenseExpiry)) {
      return res.status(422).json({
        success: false,
        message: "Your driving licence must not be expired",
      });
    }

    if (!(await activeCatalogVehicle(req.body.vehicleType))) {
      return res.status(422).json({
        success: false,
        message: "Choose an active vehicle type from the LogiGo catalogue",
      });
    }

    if (await registrationInUse(req.body.vehicleRegistration, req.user.userId)) {
      return res.status(409).json({
        success: false,
        message: "This vehicle registration is already registered",
      });
    }

    const incomingDocuments = req.body.documents || {};

    const assetsValid = await validateDocumentAssets({
      ownerId: req.user.userId,
      documents: incomingDocuments,
      vehicleDocumentAssetId: req.body.vehicleDocumentAssetId,
    });

    if (!assetsValid) {
      return res.status(422).json({
        success: false,
        message:
          "One or more document uploads are invalid or do not belong to your account. Upload the documents again.",
      });
    }

    const initialVehicle = profileVehiclePayload({
      ...req.body,
      documents: incomingDocuments,
      vehicleDocumentAssetId:
        req.body.vehicleDocumentAssetId ||
        incomingDocuments.vehicleDocumentAssetId,
    });

    const profile = await DriverProfile.create({
      user: req.user.userId,
      licenseNumber: req.body.licenseNumber,
      licenseExpiry: new Date(req.body.licenseExpiry),
      vehicleType: req.body.vehicleType,
      vehicleMakeModel: req.body.vehicleMakeModel,
      vehicleRegistration: req.body.vehicleRegistration,
      vehicleCapacityKg: req.body.vehicleCapacityKg,
      documents: {
        licenseDocumentAssetId:
          incomingDocuments.licenseDocumentAssetId || null,
        identityDocumentAssetId:
          incomingDocuments.identityDocumentAssetId || null,
        vehicleDocumentAssetId:
          initialVehicle.vehicleDocumentAssetId || null,
        licenseDocumentUrl: incomingDocuments.licenseDocumentAssetId
          ? ""
          : incomingDocuments.licenseDocumentUrl || "",
        identityDocumentUrl: incomingDocuments.identityDocumentAssetId
          ? ""
          : incomingDocuments.identityDocumentUrl || "",
        vehicleDocumentUrl: initialVehicle.vehicleDocumentAssetId
          ? ""
          : initialVehicle.vehicleDocumentUrl,
      },
      vehiclePhotos: initialVehicle.photos,
      registeredVehicles: [
        {
          ...initialVehicle,
          approvalStatus: "pending",
          isPrimary: true,
        },
      ],
      approvalStatus: "pending",
      availability: "offline",
      isActive: true,
    });

    await linkDriverMediaAssets({
      ownerId: req.user.userId,
      profileId: profile._id,
      documentAssetIds: [
        profile.documents?.licenseDocumentAssetId,
        profile.documents?.identityDocumentAssetId,
        profile.documents?.vehicleDocumentAssetId,
      ],
      photoUrls: [
        initialVehicle.photos?.front,
        initialVehicle.photos?.right,
        initialVehicle.photos?.left,
        initialVehicle.photos?.back,
      ],
    });

    await logActivity({
      driver: req.user.userId,
      driverProfile: profile._id,
      action: "profile_submitted",
      message: "Driver onboarding profile submitted for review",
      metadata: { approvalStatus: profile.approvalStatus },
    });

    return res.status(201).json({
      success: true,
      message: "Driver profile submitted for admin approval",
      profile,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "This driver or vehicle registration is already registered",
      });
    }

    console.error("Submit driver profile:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to submit driver profile",
    });
  }
};


// DRIVER: Update an existing profile directly. Initial onboarding still requires admin approval.
export const updateDriverProfile = async (req, res) => {
  try {
    const ownerId = req.user.userId;
    const profile = await DriverProfile.findOne({ user: ownerId });

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found. Submit your initial profile first.",
      });
    }

    if (profile.approvalStatus === "suspended" || !profile.isActive) {
      return res.status(403).json({
        success: false,
        message: "This driver profile is suspended or inactive and cannot be edited.",
      });
    }

    if (profile.availability === "busy") {
      return res.status(409).json({
        success: false,
        message: "Complete your active delivery before updating driver or vehicle details.",
      });
    }

    if (!isValidFutureDate(req.body.licenseExpiry)) {
      return res.status(422).json({
        success: false,
        message: "Your driving licence expiry date must be in the future.",
      });
    }

    if (!(await activeCatalogVehicle(req.body.vehicleType))) {
      return res.status(422).json({
        success: false,
        message: "Choose an active vehicle type from the LogiGo catalogue.",
      });
    }

    await ensurePrimaryVehicle(profile);
    const primaryVehicle = profile.registeredVehicles.find((vehicle) => vehicle.isPrimary)
      || profile.registeredVehicles[0];

    if (await registrationInUse(
      req.body.vehicleRegistration,
      ownerId,
      primaryVehicle?._id || null
    )) {
      return res.status(409).json({
        success: false,
        message: "This vehicle registration is already registered to another driver.",
      });
    }

    const incomingDocuments = req.body.documents || {};
    const vehicleDocumentAssetId = req.body.vehicleDocumentAssetId
      || incomingDocuments.vehicleDocumentAssetId;

    const assetsValid = await validateDocumentAssets({
      ownerId,
      documents: incomingDocuments,
      vehicleDocumentAssetId,
    });

    if (!assetsValid) {
      return res.status(422).json({
        success: false,
        message: "One or more uploaded documents are invalid or do not belong to your account. Upload them again.",
      });
    }

    const wasApproved = profile.approvalStatus === "approved";
    const vehiclePayload = profileVehiclePayload({
      ...req.body,
      documents: incomingDocuments,
      vehicleDocumentAssetId,
    });

    if (!profile.documents) profile.documents = {};

    profile.licenseNumber = req.body.licenseNumber;
    profile.licenseExpiry = new Date(req.body.licenseExpiry);
    profile.vehicleType = req.body.vehicleType;
    profile.vehicleMakeModel = req.body.vehicleMakeModel;
    profile.vehicleRegistration = req.body.vehicleRegistration;
    profile.vehicleCapacityKg = req.body.vehicleCapacityKg;
    profile.documents.licenseDocumentAssetId = incomingDocuments.licenseDocumentAssetId || null;
    profile.documents.identityDocumentAssetId = incomingDocuments.identityDocumentAssetId || null;
    profile.documents.vehicleDocumentAssetId = vehiclePayload.vehicleDocumentAssetId || null;
    profile.documents.licenseDocumentUrl = incomingDocuments.licenseDocumentAssetId
      ? ""
      : incomingDocuments.licenseDocumentUrl || "";
    profile.documents.identityDocumentUrl = incomingDocuments.identityDocumentAssetId
      ? ""
      : incomingDocuments.identityDocumentUrl || "";
    profile.documents.vehicleDocumentUrl = vehiclePayload.vehicleDocumentAssetId
      ? ""
      : vehiclePayload.vehicleDocumentUrl || "";
    profile.vehiclePhotos = { ...vehiclePayload.photos };

    if (primaryVehicle) {
      primaryVehicle.vehicleType = vehiclePayload.vehicleType;
      primaryVehicle.vehicleMakeModel = vehiclePayload.vehicleMakeModel;
      primaryVehicle.vehicleRegistration = vehiclePayload.vehicleRegistration;
      primaryVehicle.vehicleCapacityKg = vehiclePayload.vehicleCapacityKg;
      primaryVehicle.vehicleDocumentUrl = vehiclePayload.vehicleDocumentUrl;
      primaryVehicle.vehicleDocumentAssetId = vehiclePayload.vehicleDocumentAssetId || null;
      primaryVehicle.photos = { ...vehiclePayload.photos };
      primaryVehicle.isPrimary = true;

      if (wasApproved) {
        primaryVehicle.approvalStatus = "approved";
        primaryVehicle.rejectionReason = "";
      } else {
        primaryVehicle.approvalStatus = "pending";
        primaryVehicle.approvedBy = null;
        primaryVehicle.approvedAt = null;
        primaryVehicle.rejectionReason = "";
      }
      // The legacy change-request workflow is retired. Discard only its active embedded request.
      primaryVehicle.changeRequest = null;
    }

    if (wasApproved) {
      // Updates to an already-approved driver are immediate, but force offline
      // so the updated identity/vehicle is re-checked before receiving offers.
      profile.approvalStatus = "approved";
      profile.availability = "offline";
      profile.rejectionReason = "";
    } else {
      // New/rejected onboarding profiles still require an administrator's initial approval.
      profile.approvalStatus = "pending";
      profile.approvedBy = null;
      profile.approvedAt = null;
      profile.availability = "offline";
      profile.rejectionReason = "";
    }

    // The old request queue is no longer used; the initial onboarding review remains.
    profile.profileChangeRequest = null;

    await profile.save();

    await linkDriverMediaAssets({
      ownerId,
      profileId: profile._id,
      documentAssetIds: [
        profile.documents?.licenseDocumentAssetId,
        profile.documents?.identityDocumentAssetId,
        profile.documents?.vehicleDocumentAssetId,
      ],
      photoUrls: [
        vehiclePayload.photos?.front,
        vehiclePayload.photos?.right,
        vehiclePayload.photos?.left,
        vehiclePayload.photos?.back,
      ],
    });

    await logActivity({
      driver: ownerId,
      driverProfile: profile._id,
      action: "profile_updated",
      message: wasApproved
        ? "Driver updated profile, documents, or registered vehicle details directly"
        : "Driver corrected onboarding details; initial administrator approval is still required",
      metadata: {
        approvalStatus: profile.approvalStatus,
        availability: profile.availability,
      },
    });

    await profile.populate("user", publicDriverFields);

    return res.status(200).json({
      success: true,
      message: wasApproved
        ? "Your profile and vehicle details were updated. You are offline; validate your documents and go online when ready."
        : "Your onboarding details were updated and remain pending initial administrator approval.",
      profile,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "This driver or vehicle registration is already registered.",
      });
    }

    console.error("Update driver profile:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to update driver profile.",
    });
  }
};

// DRIVER: Read own profile.
export const getMyDriverProfile = async (req, res) => {
  try {
    let profile = await DriverProfile.findOne({ user: req.user.userId })
      .populate("user", publicDriverFields);

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Driver profile has not been submitted",
      });
    }

    profile = await ensurePrimaryVehicle(profile);
    await profile.populate("user", publicDriverFields);

    return res.status(200).json({ success: true, profile });
  } catch (error) {
    console.error("Get driver profile:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to load driver profile",
    });
  }
};

// DRIVER: Request admin-reviewed licence/identity document changes.
export const requestDriverProfileChange = async (req, res) => {
  try {
    const profile = await DriverProfile.findOne({ user: req.user.userId });

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Submit your driver profile first",
      });
    }

    if (profile.approvalStatus === "suspended" || !profile.isActive) {
      return res.status(403).json({
        success: false,
        message:
          "This driver profile cannot request changes while suspended or inactive",
      });
    }

    if (profile.availability === "busy") {
      return res.status(409).json({
        success: false,
        message:
          "Finish the active delivery before requesting licence or identity changes",
      });
    }

    if (profile.profileChangeRequest?.status === "pending") {
      return res.status(409).json({
        success: false,
        message:
          "You already have a profile change request waiting for admin review",
      });
    }

    if (!isValidFutureDate(req.body.licenseExpiry)) {
      return res.status(422).json({
        success: false,
        message: "The requested licence expiry date must be in the future",
      });
    }

    const changeDocuments = req.body.documents || {};

    const changeAssetsValid = await validateDocumentAssets({
      ownerId: req.user.userId,
      documents: changeDocuments,
    });

    if (!changeAssetsValid) {
      return res.status(422).json({
        success: false,
        message:
          "One or more document uploads are invalid. Upload the documents again.",
      });
    }

    profile.profileChangeRequest = {
      licenseNumber: req.body.licenseNumber,
      licenseExpiry: new Date(req.body.licenseExpiry),
      documents: {
        licenseDocumentAssetId:
          changeDocuments.licenseDocumentAssetId || null,
        identityDocumentAssetId:
          changeDocuments.identityDocumentAssetId || null,
        licenseDocumentUrl: changeDocuments.licenseDocumentAssetId
          ? ""
          : changeDocuments.licenseDocumentUrl || "",
        identityDocumentUrl: changeDocuments.identityDocumentAssetId
          ? ""
          : changeDocuments.identityDocumentUrl || "",
      },
      reason: req.body.reason,
      status: "pending",
      requestedAt: new Date(),
      reviewedAt: null,
      reviewedBy: null,
      reviewNote: "",
    };

    await profile.save();

    await logActivity({
      driver: req.user.userId,
      driverProfile: profile._id,
      action: "profile_change_requested",
      message: "Driver requested an admin-reviewed licence/document change",
      metadata: { reason: req.body.reason },
    });

    return res.status(201).json({
      success: true,
      message: "Change request sent for admin approval",
      profileChangeRequest: profile.profileChangeRequest,
    });
  } catch (error) {
    console.error("Request driver profile change:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to submit profile change request",
    });
  }
};
// DRIVER: Set online or offline.
export const setDriverAvailability = async (req, res) => {
  try {
    if (!["online", "offline"].includes(req.body.availability)) {
      return res.status(422).json({
        success: false,
        message: "Availability must be online or offline",
      });
    }

    const profile = await DriverProfile.findOne({ user: req.user.userId });

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Submit your driver profile first",
      });
    }

    if (
      profile.approvalStatus !== "approved" ||
      !profile.isActive ||
      profile.licenseExpiry <= new Date()
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Only active drivers with an approved profile and valid licence can go online",
      });
    }

    if (req.body.availability === "online") {
      const readiness = await getDriverDispatchEligibility(profile);

      if (!readiness.eligible) {
        const missing = readiness.missing;
        return res.status(403).json({
          success: false,
          code: "DRIVER_VERIFICATION_INCOMPLETE",
          message: `Cannot go online yet. Missing or invalid: ${missing.join(", ")}. Update and save the required documents and all four vehicle photos, then retry. New or not-yet-approved onboarding profiles must receive initial administrator approval before dispatch is enabled.`,
          missingRequirements: missing,
        });
      }
    }

    if (profile.availability === "busy") {
      return res.status(409).json({
        success: false,
        message:
          "Availability cannot be changed while an active delivery is assigned. Complete the delivery first.",
      });
    }

    const previous = profile.availability;
    profile.availability = req.body.availability;
    await profile.save();

    await logActivity({
      driver: req.user.userId,
      driverProfile: profile._id,
      action: "availability_changed",
      message: `Driver changed availability from ${previous} to ${profile.availability}`,
      metadata: { previous, availability: profile.availability },
    });

    return res.status(200).json({
      success: true,
      message: `You are now ${profile.availability}`,
      availability: profile.availability,
    });
  } catch (error) {
    console.error("Change driver availability:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to update driver availability",
    });
  }
};

// CUSTOMER/ADMIN: Minimum public information for online drivers.
export const getOnlineDrivers = async (req, res) => {
  try {
    const profiles = await DriverProfile.find({
      approvalStatus: "approved",
      availability: "online",
      isActive: true,
      licenseExpiry: { $gt: new Date() },
    })
      .populate({ path: "user", select: "name role isActive" })
      .sort({ updatedAt: -1 })
      .lean();

    const candidates = profiles.filter(
      (profile) =>
        profile.user?.role === "driver" &&
        profile.user.isActive === true
    );
    const eligibility = await profilesAreDispatchEligible(candidates);
    const drivers = candidates
      .filter((_profile, index) => eligibility[index])
      .map((profile) => ({
        id: profile.user._id,
        name: profile.user.name,
        availability: profile.availability,
        vehicleType: profile.vehicleType,
        vehicleMakeModel: profile.vehicleMakeModel,
        vehicleCapacityKg: profile.vehicleCapacityKg,
      }));

    return res.status(200).json({
      success: true,
      count: drivers.length,
      drivers,
    });
  } catch (error) {
    console.error("List online drivers:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to list currently available drivers",
    });
  }
};

// ADMIN: List/filter driver profiles.
export const listDriverProfiles = async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      50,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 10)
    );
    const allowedStatuses = [
      "pending",
      "approved",
      "rejected",
      "suspended",
    ];
    const approvalStatus =
      typeof req.query.approvalStatus === "string"
        ? req.query.approvalStatus
        : "";

    if (approvalStatus && !allowedStatuses.includes(approvalStatus)) {
      return res.status(400).json({
        success: false,
        message: "Invalid approval status filter",
      });
    }

    const filter = approvalStatus ? { approvalStatus } : {};

    const [profiles, total] = await Promise.all([
      DriverProfile.find(filter)
        .populate("user", publicDriverFields)
        .populate("approvedBy", "name email")
        .populate("profileChangeRequest.reviewedBy", "name email")
        .populate("registeredVehicles.approvedBy", "name email")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),

      DriverProfile.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      drivers: profiles,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("List driver profiles:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to list driver profiles",
    });
  }
};

// ADMIN: Approve/reject initial driver onboarding.
export const reviewDriverProfile = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid driver profile ID",
      });
    }

    const profile = await DriverProfile.findById(req.params.id);

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    if (profile.approvalStatus === "suspended") {
      return res.status(409).json({
        success: false,
        message: "Suspended driver profiles cannot be approved here",
      });
    }

    if (req.body.decision === "approve") {
      if (profile.licenseExpiry <= new Date()) {
        return res.status(422).json({
          success: false,
          message: "Cannot approve an expired driving licence",
        });
      }

      const docs = profile.documents || {};

      if (
        ![
          docs.licenseDocumentAssetId ||
            isHttpsUrl(docs.licenseDocumentUrl),
          docs.identityDocumentAssetId ||
            isHttpsUrl(docs.identityDocumentUrl),
          docs.vehicleDocumentAssetId ||
            isHttpsUrl(docs.vehicleDocumentUrl),
        ].every(Boolean)
      ) {
        return res.status(422).json({
          success: false,
          message:
            "Driver must submit licence, identity and vehicle documents before approval",
        });
      }

      const photos = profile.vehiclePhotos || {};

      if (
        ![
          photos.front,
          photos.right,
          photos.left,
          photos.back,
        ].every(Boolean)
      ) {
        return res.status(422).json({
          success: false,
          message:
            "All four vehicle photos (front, right, left and back) are required before approval",
        });
      }

      if (!(await hasRequiredDriverDocumentsAndPhotos(profile))) {
        return res.status(422).json({
          success: false,
          message:
            "Cannot approve this driver until all required documents and four vehicle photos are valid, uploaded by this driver, and available for review",
        });
      }

      profile.approvalStatus = "approved";
      profile.approvedBy = req.user.userId;
      profile.approvedAt = new Date();
      profile.rejectionReason = "";
      profile.availability = "offline";
      profile.isActive = true;

      await ensurePrimaryVehicle(profile);

      profile.registeredVehicles.forEach((vehicle) => {
        if (vehicle.isPrimary) {
          vehicle.approvalStatus = "approved";
          vehicle.approvedBy = req.user.userId;
          vehicle.approvedAt = new Date();
          vehicle.rejectionReason = "";
        }
      });
    } else {
      profile.approvalStatus = "rejected";
      profile.approvedBy = null;
      profile.approvedAt = null;
      profile.availability = "offline";
      profile.rejectionReason = req.body.rejectionReason;

      profile.registeredVehicles.forEach((vehicle) => {
        if (vehicle.isPrimary) {
          vehicle.approvalStatus = "rejected";
          vehicle.rejectionReason = req.body.rejectionReason;
        }
      });
    }

    await profile.save();

    if (req.body.decision === "approve") {
      const primaryVehicle =
        profile.registeredVehicles.find((vehicle) => vehicle.isPrimary) ||
        profile.registeredVehicles[0];
      await linkDriverMediaAssets({
        ownerId: profile.user,
        profileId: profile._id,
        documentAssetIds: [
          profile.documents?.licenseDocumentAssetId,
          profile.documents?.identityDocumentAssetId,
          profile.documents?.vehicleDocumentAssetId,
          primaryVehicle?.vehicleDocumentAssetId,
        ],
        photoUrls: [
          primaryVehicle?.photos?.front || profile.vehiclePhotos?.front,
          primaryVehicle?.photos?.right || profile.vehiclePhotos?.right,
          primaryVehicle?.photos?.left || profile.vehiclePhotos?.left,
          primaryVehicle?.photos?.back || profile.vehiclePhotos?.back,
        ],
      });
    }

    await logActivity({
      driver: profile.user,
      driverProfile: profile._id,
      actor: req.user.userId,
      action: `profile_${req.body.decision}d`,
      message: `Admin ${req.body.decision}d driver onboarding`,
      metadata: {
        rejectionReason: req.body.rejectionReason || "",
      },
    });

    return res.status(200).json({
      success: true,
      message:
        req.body.decision === "approve"
          ? "Driver approved successfully"
          : "Driver profile rejected",
      profile,
    });
  } catch (error) {
    console.error("Review driver profile:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to review driver profile",
    });
  }
};

// ADMIN: Approve/reject licence or identity change request.
export const reviewDriverProfileChange = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid driver profile ID",
      });
    }

    const profile = await DriverProfile.findById(req.params.id);

    if (
      !profile?.profileChangeRequest ||
      profile.profileChangeRequest.status !== "pending"
    ) {
      return res.status(404).json({
        success: false,
        message: "Pending profile change request not found",
      });
    }

    const request = profile.profileChangeRequest;

    if (req.body.decision === "approve") {
      if (profile.availability === "busy") {
        return res.status(409).json({
          success: false,
          message:
            "Wait until the active delivery is complete before approving licence or identity changes",
        });
      }

      if (request.licenseExpiry <= new Date()) {
        return res.status(422).json({
          success: false,
          message: "Cannot approve an expired licence",
        });
      }

      profile.licenseNumber = request.licenseNumber;
      profile.licenseExpiry = request.licenseExpiry;
      profile.documents.licenseDocumentAssetId =
        request.documents.licenseDocumentAssetId || null;
      profile.documents.identityDocumentAssetId =
        request.documents.identityDocumentAssetId || null;
      profile.documents.licenseDocumentUrl =
        request.documents.licenseDocumentAssetId
          ? ""
          : request.documents.licenseDocumentUrl || "";
      profile.documents.identityDocumentUrl =
        request.documents.identityDocumentAssetId
          ? ""
          : request.documents.identityDocumentUrl || "";

      request.status = "approved";

      if (profile.availability === "online") {
        profile.availability = "offline";
      }
    } else {
      request.status = "rejected";
    }

    request.reviewedAt = new Date();
    request.reviewedBy = req.user.userId;
    request.reviewNote = req.body.reviewNote || "";

    await profile.save();

    if (req.body.decision === "approve") {
      await linkDriverMediaAssets({
        ownerId: profile.user,
        profileId: profile._id,
        documentAssetIds: [
          profile.documents?.licenseDocumentAssetId,
          profile.documents?.identityDocumentAssetId,
        ],
      });
    }

    await logActivity({
      driver: profile.user,
      driverProfile: profile._id,
      actor: req.user.userId,
      action: `profile_change_${req.body.decision}d`,
      message: `Admin ${req.body.decision}d driver profile change request`,
      metadata: { note: request.reviewNote },
    });

    return res.status(200).json({
      success: true,
      message: `Profile change request ${req.body.decision}d`,
      profileChangeRequest: request,
    });
  } catch (error) {
    console.error("Review driver profile change:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to review profile change request",
    });
  }
};

// DRIVER: List registered vehicles.
export const getDriverVehicles = async (req, res) => {
  try {
    let profile = await DriverProfile.findOne({ user: req.user.userId });

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Submit your driver profile first",
      });
    }

    profile = await ensurePrimaryVehicle(profile);

    const primaryVehicle =
      profile.registeredVehicles.find((vehicle) => vehicle.isPrimary) ||
      profile.registeredVehicles[0] ||
      null;

    return res.status(200).json({
      success: true,
      // LogiGo supports one registered vehicle per driver. Any legacy extra
      // entries remain untouched in MongoDB until explicitly reconciled.
      vehicles: primaryVehicle ? [primaryVehicle] : [],
      activeVehicleId: primaryVehicle?._id || null,
    });
  } catch (error) {
    console.error("Get driver vehicles:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to load your registered vehicles",
    });
  }
};

// DRIVER: Update the one registered vehicle directly. Initial profile approval remains required.
export const updateDriverVehicle = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.vehicleId)) {
      return res.status(400).json({ success: false, message: "Invalid vehicle ID." });
    }

    const ownerId = req.user.userId;
    const profile = await DriverProfile.findOne({ user: ownerId });
    if (!profile) {
      return res.status(404).json({ success: false, message: "Driver profile not found." });
    }

    if (profile.approvalStatus === "suspended" || !profile.isActive) {
      return res.status(403).json({ success: false, message: "This driver profile is suspended or inactive." });
    }

    if (profile.availability === "busy") {
      return res.status(409).json({
        success: false,
        message: "Complete your active delivery before changing vehicle details.",
      });
    }

    await ensurePrimaryVehicle(profile);
    const vehicle = profile.registeredVehicles.find((item) => item.isPrimary)
      || profile.registeredVehicles[0];

    if (!vehicle || String(vehicle._id) !== String(req.params.vehicleId)) {
      return res.status(404).json({
        success: false,
        message: "Registered vehicle not found. LogiGo supports one vehicle per driver.",
      });
    }

    if (!(await activeCatalogVehicle(req.body.vehicleType))) {
      return res.status(422).json({ success: false, message: "Choose an active vehicle category." });
    }

    if (await registrationInUse(req.body.vehicleRegistration, ownerId, vehicle._id)) {
      return res.status(409).json({
        success: false,
        message: "This vehicle registration is already registered to another driver.",
      });
    }

    if (!req.body.vehicleDocumentAssetId && !isHttpsUrl(req.body.vehicleDocumentUrl)) {
      return res.status(422).json({
        success: false,
        message: "A valid vehicle registration document is required.",
      });
    }

    const assetValid = await validateDocumentAssets({
      ownerId,
      documents: {},
      vehicleDocumentAssetId: req.body.vehicleDocumentAssetId,
    });

    if (!assetValid) {
      return res.status(422).json({
        success: false,
        message: "The vehicle document upload is invalid or belongs to another account. Upload it again.",
      });
    }

    const wasApproved = profile.approvalStatus === "approved";
    vehicle.vehicleType = req.body.vehicleType;
    vehicle.vehicleMakeModel = req.body.vehicleMakeModel;
    vehicle.vehicleRegistration = req.body.vehicleRegistration;
    vehicle.vehicleCapacityKg = req.body.vehicleCapacityKg;
    vehicle.vehicleDocumentAssetId = req.body.vehicleDocumentAssetId || null;
    vehicle.vehicleDocumentUrl = req.body.vehicleDocumentAssetId
      ? ""
      : req.body.vehicleDocumentUrl || "";
    vehicle.photos = { ...req.body.photos };
    vehicle.isPrimary = true;
    vehicle.changeRequest = null;

    if (!profile.documents) profile.documents = {};
    profile.vehicleType = vehicle.vehicleType;
    profile.vehicleMakeModel = vehicle.vehicleMakeModel;
    profile.vehicleRegistration = vehicle.vehicleRegistration;
    profile.vehicleCapacityKg = vehicle.vehicleCapacityKg;
    profile.documents.vehicleDocumentAssetId = vehicle.vehicleDocumentAssetId;
    profile.documents.vehicleDocumentUrl = vehicle.vehicleDocumentUrl;
    profile.vehiclePhotos = { ...vehicle.photos };
    // Remove any stale embedded request left over from the retired change-request workflow.
    profile.profileChangeRequest = null;

    if (wasApproved) {
      vehicle.approvalStatus = "approved";
      vehicle.rejectionReason = "";
      profile.availability = "offline";
    } else {
      // The initial driver/vehicle verification is still required for new or rejected onboarding.
      profile.approvalStatus = "pending";
      profile.approvedBy = null;
      profile.approvedAt = null;
      profile.rejectionReason = "";
      profile.availability = "offline";
      vehicle.approvalStatus = "pending";
      vehicle.approvedBy = null;
      vehicle.approvedAt = null;
      vehicle.rejectionReason = "";
    }

    await profile.save();

    await linkDriverMediaAssets({
      ownerId,
      profileId: profile._id,
      documentAssetIds: [vehicle.vehicleDocumentAssetId],
      photoUrls: [
        vehicle.photos?.front,
        vehicle.photos?.right,
        vehicle.photos?.left,
        vehicle.photos?.back,
      ],
    });

    await logActivity({
      driver: ownerId,
      driverProfile: profile._id,
      action: "vehicle_updated",
      message: "Driver directly updated their registered vehicle and photos",
      metadata: {
        vehicleId: String(vehicle._id),
        approvalStatus: profile.approvalStatus,
        availability: profile.availability,
      },
    });

    return res.status(200).json({
      success: true,
      message: wasApproved
        ? "Vehicle details and photos updated. You are offline; check verification and go online when ready."
        : "Vehicle details updated. Your initial driver profile still requires administrator approval.",
      vehicle,
      profileStatus: profile.approvalStatus,
      availability: profile.availability,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "This vehicle registration is already registered." });
    }

    console.error("Update driver vehicle:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update registered vehicle." });
  }
};

// DRIVER: Deprecated endpoint. LogiGo intentionally supports one vehicle per driver.
export const addDriverVehicle = async (req, res) => {
  try {
    const profile = await DriverProfile.findOne({ user: req.user.userId });

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Submit your driver profile first",
      });
    }

    await ensurePrimaryVehicle(profile);

    return res.status(409).json({
      success: false,
      message:
        "LogiGo supports one registered vehicle per driver. Use the direct vehicle update form to replace vehicle details. Initial driver onboarding still requires administrator approval.",
    });
  } catch (error) {
    console.error("Add driver vehicle disabled:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to verify the registered vehicle",
    });
  }
};

// DRIVER: Vehicle switching is disabled because each driver has exactly one vehicle.
export const selectActiveDriverVehicle = async (_req, res) => {
  return res.status(409).json({
    success: false,
    message: "Vehicle switching is disabled. Each driver has one registered vehicle. Edit the existing vehicle directly on the Vehicle details page.",
  });
};

export const requestDriverVehicleChange = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.vehicleId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid vehicle ID",
      });
    }

    const profile = await DriverProfile.findOne({ user: req.user.userId });

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    await ensurePrimaryVehicle(profile);

    const vehicle = profile.registeredVehicles.id(req.params.vehicleId);

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: "Registered vehicle not found",
      });
    }

    if (!vehicle.isPrimary) {
      return res.status(409).json({
        success: false,
        message:
          "LogiGo supports one registered vehicle per driver. Only the primary vehicle can receive an admin-reviewed vehicle change request.",
      });
    }

    if (vehicle.approvalStatus !== "approved") {
      return res.status(409).json({
        success: false,
        message:
          "Only approved vehicle details can be changed through a request",
      });
    }

    if (vehicle.changeRequest?.status === "pending") {
      return res.status(409).json({
        success: false,
        message: "A change request for this vehicle is already pending",
      });
    }

    if (!(await activeCatalogVehicle(req.body.vehicleType))) {
      return res.status(422).json({
        success: false,
        message: "Choose an active vehicle category",
      });
    }

    const duplicate = await DriverProfile.findOne({
      user: { $ne: req.user.userId },
      $or: [
        { vehicleRegistration: req.body.vehicleRegistration },
        {
          "registeredVehicles.vehicleRegistration":
            req.body.vehicleRegistration,
        },
      ],
    }).select("_id").lean();

    if (
      duplicate ||
      (vehicle.vehicleRegistration !== req.body.vehicleRegistration &&
        profile.registeredVehicles.some(
          (other) =>
            other._id.toString() !== vehicle._id.toString() &&
            other.vehicleRegistration === req.body.vehicleRegistration
        ))
    ) {
      return res.status(409).json({
        success: false,
        message: "This vehicle registration is already registered",
      });
    }

    const changeVehicleAssetsValid = await validateDocumentAssets({
      ownerId: req.user.userId,
      documents: {},
      vehicleDocumentAssetId: req.body.vehicleDocumentAssetId,
    });

    if (!changeVehicleAssetsValid) {
      return res.status(422).json({
        success: false,
        message: "The vehicle document upload is invalid. Upload it again.",
      });
    }

    vehicle.changeRequest = {
      ...req.body,
      vehicleDocumentUrl: req.body.vehicleDocumentAssetId
        ? ""
        : req.body.vehicleDocumentUrl || "",
      status: "pending",
      requestedAt: new Date(),
      reviewedAt: null,
      reviewedBy: null,
      reviewNote: "",
    };

    await profile.save();

    await logActivity({
      driver: req.user.userId,
      driverProfile: profile._id,
      action: "vehicle_change_requested",
      message: "Driver requested an admin-reviewed vehicle change",
      metadata: {
        vehicleId: vehicle._id,
        reason: req.body.reason,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Vehicle change request sent for admin approval",
      vehicle,
    });
  } catch (error) {
    console.error("Request driver vehicle change:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to submit vehicle change request",
    });
  }
};

// ADMIN: Review added vehicle.
export const reviewDriverVehicle = async (req, res) => {
  try {
    if (
      !mongoose.isValidObjectId(req.params.id) ||
      !mongoose.isValidObjectId(req.params.vehicleId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid driver or vehicle ID",
      });
    }

    const profile = await DriverProfile.findById(req.params.id);

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    const vehicle = profile.registeredVehicles.id(req.params.vehicleId);

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: "Registered vehicle not found",
      });
    }

    if (vehicle.isPrimary && vehicle.approvalStatus === "approved") {
      return res.status(409).json({
        success: false,
        message:
          "The primary vehicle is reviewed with the driver onboarding profile",
      });
    }

    if (req.body.decision === "approve" && !vehicle.isPrimary) {
      return res.status(409).json({
        success: false,
        message:
          "LogiGo supports one registered vehicle per driver. Reject or reconcile this legacy secondary vehicle instead of approving another vehicle.",
      });
    }

    if (req.body.decision === "approve") {
      if (
        vehicle.vehicleDocumentAssetId &&
        !(await ownedUploadedAsset(
          vehicle.vehicleDocumentAssetId,
          profile.user,
          "vehicle-document"
        ))
      ) {
        return res.status(422).json({
          success: false,
          message: "The vehicle document upload is invalid",
        });
      }

      vehicle.approvalStatus = "approved";
      vehicle.approvedBy = req.user.userId;
      vehicle.approvedAt = new Date();
      vehicle.rejectionReason = "";
    } else {
      vehicle.approvalStatus = "rejected";
      vehicle.approvedBy = null;
      vehicle.approvedAt = null;
      vehicle.rejectionReason =
        req.body.rejectionReason || "Vehicle rejected by administrator";
    }

    await profile.save();

    await logActivity({
      driver: profile.user,
      driverProfile: profile._id,
      actor: req.user.userId,
      action: `vehicle_${req.body.decision}d`,
      message: `Admin ${req.body.decision}d a registered vehicle`,
      metadata: {
        vehicleId: vehicle._id,
        registration: vehicle.vehicleRegistration,
        reason: vehicle.rejectionReason,
      },
    });

    return res.status(200).json({
      success: true,
      message: `Vehicle ${req.body.decision}d`,
      vehicle,
    });
  } catch (error) {
    console.error("Review driver vehicle:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to review vehicle",
    });
  }
};

// ADMIN: Review vehicle change request.
export const reviewDriverVehicleChange = async (req, res) => {
  try {
    if (
      !mongoose.isValidObjectId(req.params.id) ||
      !mongoose.isValidObjectId(req.params.vehicleId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid driver or vehicle ID",
      });
    }

    const profile = await DriverProfile.findById(req.params.id);
    const vehicle = profile?.registeredVehicles.id(req.params.vehicleId);

    if (
      !profile ||
      !vehicle?.changeRequest ||
      vehicle.changeRequest.status !== "pending"
    ) {
      return res.status(404).json({
        success: false,
        message: "Pending vehicle change request not found",
      });
    }

    const change = vehicle.changeRequest;

    if (req.body.decision === "approve") {
      if (vehicle.isPrimary && profile.availability === "busy") {
        return res.status(409).json({
          success: false,
          message:
            "Wait until the driver finishes the active delivery before approving an active vehicle change",
        });
      }

      if (
        change.vehicleDocumentAssetId &&
        !(await ownedUploadedAsset(
          change.vehicleDocumentAssetId,
          profile.user,
          "vehicle-document"
        ))
      ) {
        return res.status(422).json({
          success: false,
          message: "The vehicle document upload is invalid",
        });
      }

      vehicle.vehicleType = change.vehicleType;
      vehicle.vehicleMakeModel = change.vehicleMakeModel;
      vehicle.vehicleRegistration = change.vehicleRegistration;
      vehicle.vehicleCapacityKg = change.vehicleCapacityKg;
      vehicle.vehicleDocumentAssetId =
        change.vehicleDocumentAssetId || null;
      vehicle.vehicleDocumentUrl = change.vehicleDocumentAssetId
        ? ""
        : change.vehicleDocumentUrl || "";
      vehicle.photos = change.photos;
      change.status = "approved";

      if (vehicle.isPrimary) {
        profile.vehicleType = vehicle.vehicleType;
        profile.vehicleMakeModel = vehicle.vehicleMakeModel;
        profile.vehicleRegistration = vehicle.vehicleRegistration;
        profile.vehicleCapacityKg = vehicle.vehicleCapacityKg;
        profile.documents.vehicleDocumentAssetId =
          vehicle.vehicleDocumentAssetId || null;
        profile.documents.vehicleDocumentUrl =
          vehicle.vehicleDocumentAssetId
            ? ""
            : vehicle.vehicleDocumentUrl || "";
        profile.vehiclePhotos = vehicle.photos;
      }
    } else {
      change.status = "rejected";
    }

    change.reviewedAt = new Date();
    change.reviewedBy = req.user.userId;
    change.reviewNote = req.body.reviewNote || "";

    await profile.save();

    if (req.body.decision === "approve") {
      await linkDriverMediaAssets({
        ownerId: profile.user,
        profileId: profile._id,
        documentAssetIds: [vehicle.vehicleDocumentAssetId],
        photoUrls: [
          vehicle.photos?.front,
          vehicle.photos?.right,
          vehicle.photos?.left,
          vehicle.photos?.back,
        ],
      });
    }

    await logActivity({
      driver: profile.user,
      driverProfile: profile._id,
      actor: req.user.userId,
      action: `vehicle_change_${req.body.decision}d`,
      message: `Admin ${req.body.decision}d vehicle change request`,
      metadata: {
        vehicleId: vehicle._id,
        note: change.reviewNote,
      },
    });

    return res.status(200).json({
      success: true,
      message: `Vehicle change request ${req.body.decision}d`,
      vehicle,
    });
  } catch (error) {
    console.error("Review driver vehicle change:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to review vehicle change request",
    });
  }
};

// ADMIN: List driver activities.
export const listDriverActivities = async (req, res) => {
  try {
    const limit = Math.min(
      200,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 100)
    );

    const filter = {};

    if (
      req.query.driverId &&
      mongoose.isValidObjectId(req.query.driverId)
    ) {
      filter.driver = req.query.driverId;
    }

    if (typeof req.query.action === "string" && req.query.action.trim()) {
      filter.action = req.query.action.trim();
    }

    const activities = await DriverActivity.find(filter)
      .populate("driver", "name email phone")
      .populate("actor", "name email role")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.status(200).json({
      success: true,
      activities,
    });
  } catch (error) {
    console.error("List driver activities:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to load driver activities",
    });
  }
};