import mongoose from "mongoose";
import DriverProfile from "../models/DriverProfile.js";
import DriverActivity from "../models/DriverActivity.js";
import Vehicle from "../models/Vehicle.js";

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

function hasRequiredDriverDocumentsAndPhotos(profile) {
  const primary = (profile.registeredVehicles || []).find(
    (vehicle) => vehicle.isPrimary
  );
  const photos = primary?.photos || profile.vehiclePhotos;
  const vehicleDocument =
    primary?.vehicleDocumentUrl || profile.documents?.vehicleDocumentUrl;

  return [
    profile.documents?.licenseDocumentUrl,
    profile.documents?.identityDocumentUrl,
    vehicleDocument,
  ].every(isHttpsUrl) &&
    [photos?.front, photos?.right, photos?.left, photos?.back].every(isHttpsUrl);
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
  registration, excludeUserId, excludeVehicleId = null
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
    (!excludeVehicleId || vehicle._id.toString() !== excludeVehicleId.toString())
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
    vehicleDocumentUrl:
      body.vehicleDocumentUrl || body.documents?.vehicleDocumentUrl || "",
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
          "Your driver profile is locked after submission. Submit a change request for admin approval instead.",
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

    const initialVehicle = profileVehiclePayload(req.body);
    const profile = await DriverProfile.create({
      user: req.user.userId,
      licenseNumber: req.body.licenseNumber,
      licenseExpiry: new Date(req.body.licenseExpiry),
      vehicleType: req.body.vehicleType,
      vehicleMakeModel: req.body.vehicleMakeModel,
      vehicleRegistration: req.body.vehicleRegistration,
      vehicleCapacityKg: req.body.vehicleCapacityKg,
      documents: {
        licenseDocumentUrl: req.body.documents.licenseDocumentUrl,
        identityDocumentUrl: req.body.documents.identityDocumentUrl,
        vehicleDocumentUrl: initialVehicle.vehicleDocumentUrl,
      },
      vehiclePhotos: initialVehicle.photos,
      registeredVehicles: [
        { ...initialVehicle, approvalStatus: "pending", isPrimary: true },
      ],
      approvalStatus: "pending",
      availability: "offline",
      isActive: true,
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
        message: "This driver profile cannot request changes while suspended or inactive",
      });
    }

    if (profile.availability === "busy") {
      return res.status(409).json({
        success: false,
        message: "Finish the active delivery before requesting licence or identity changes",
      });
    }

    if (profile.profileChangeRequest?.status === "pending") {
      return res.status(409).json({
        success: false,
        message: "You already have a profile change request waiting for admin review",
      });
    }

    if (!isValidFutureDate(req.body.licenseExpiry)) {
      return res.status(422).json({
        success: false,
        message: "The requested licence expiry date must be in the future",
      });
    }

    profile.profileChangeRequest = {
      licenseNumber: req.body.licenseNumber,
      licenseExpiry: new Date(req.body.licenseExpiry),
      documents: {
        licenseDocumentUrl: req.body.documents.licenseDocumentUrl,
        identityDocumentUrl: req.body.documents.identityDocumentUrl,
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
        message: "Only active drivers with an approved profile and valid licence can go online",
      });
    }

    if (
      req.body.availability === "online" &&
      !hasRequiredDriverDocumentsAndPhotos(profile)
    ) {
      return res.status(403).json({
        success: false,
        message: "Complete valid HTTPS licence, identity and vehicle documents plus all four vehicle photos before going online",
      });
    }

    if (profile.availability === "busy") {
      return res.status(409).json({
        success: false,
        message: "Availability cannot be changed while an active delivery is assigned. Complete the delivery first.",
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

// CUSTOMER/ADMIN: Minimum public information for currently online drivers.
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

    const drivers = profiles
      .filter(
        (profile) =>
          profile.user?.role === "driver" &&
          profile.user.isActive &&
          hasRequiredDriverDocumentsAndPhotos(profile)
      )
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
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
    const allowedStatuses = ["pending", "approved", "rejected", "suspended"];
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
          docs.licenseDocumentUrl,
          docs.identityDocumentUrl,
          docs.vehicleDocumentUrl,
        ].every(Boolean)
      ) {
        return res.status(422).json({
          success: false,
          message: "Driver must submit licence, identity and vehicle documents before approval",
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
          message: "All four vehicle photos (front, right, left and back) are required before approval",
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
    await logActivity({
      driver: profile.user,
      driverProfile: profile._id,
      actor: req.user.userId,
      action: `profile_${req.body.decision}d`,
      message: `Admin ${req.body.decision}d driver onboarding`,
      metadata: { rejectionReason: req.body.rejectionReason || "" },
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
          message: "Wait until the active delivery is complete before approving licence or identity changes",
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
      profile.documents.licenseDocumentUrl =
        request.documents.licenseDocumentUrl;
      profile.documents.identityDocumentUrl =
        request.documents.identityDocumentUrl;
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
    return res.status(200).json({
      success: true,
      vehicles: profile.registeredVehicles,
      activeVehicleId:
        profile.registeredVehicles.find((vehicle) => vehicle.isPrimary)?._id ||
        null,
    });
  } catch (error) {
    console.error("Get driver vehicles:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to load your registered vehicles",
    });
  }
};

// DRIVER: Add another vehicle for admin approval.
export const addDriverVehicle = async (req, res) => {
  try {
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
        message: "Your profile must be approved, active and have a valid licence before adding another vehicle",
      });
    }

    if (!(await activeCatalogVehicle(req.body.vehicleType))) {
      return res.status(422).json({
        success: false,
        message: "Choose an active vehicle category",
      });
    }

    if (await registrationInUse(req.body.vehicleRegistration, req.user.userId)) {
      return res.status(409).json({
        success: false,
        message: "This vehicle registration is already registered",
      });
    }

    await ensurePrimaryVehicle(profile);
    const vehicle = profile.registeredVehicles.create({
      ...req.body,
      approvalStatus: "pending",
      isPrimary: false,
      approvedBy: null,
      approvedAt: null,
      rejectionReason: "",
    });

    profile.registeredVehicles.push(vehicle);
    await profile.save();

    await logActivity({
      driver: req.user.userId,
      driverProfile: profile._id,
      action: "vehicle_added_requested",
      message: "Driver submitted a new vehicle for admin approval",
      metadata: {
        vehicleId: vehicle._id,
        registration: vehicle.vehicleRegistration,
      },
    });

    return res.status(201).json({
      success: true,
      message: "New vehicle submitted for admin approval",
      vehicle,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "This vehicle registration is already registered",
      });
    }
    console.error("Add driver vehicle:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to add vehicle",
    });
  }
};

// DRIVER: Select one approved vehicle as active.
export const selectActiveDriverVehicle = async (req, res) => {
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

    if (profile.approvalStatus !== "approved" || !profile.isActive) {
      return res.status(403).json({
        success: false,
        message: "Only approved active drivers can select an active vehicle",
      });
    }

    if (profile.availability === "busy") {
      return res.status(409).json({
        success: false,
        message: "Finish the active delivery before switching vehicles",
      });
    }

    await ensurePrimaryVehicle(profile);
    const selected = profile.registeredVehicles.id(req.params.vehicleId);

    if (!selected) {
      return res.status(404).json({
        success: false,
        message: "Registered vehicle not found",
      });
    }

    if (selected.approvalStatus !== "approved") {
      return res.status(409).json({
        success: false,
        message: "Only admin-approved vehicles can be selected",
      });
    }

    profile.registeredVehicles.forEach((vehicle) => {
      vehicle.isPrimary =
        vehicle._id.toString() === selected._id.toString();
    });

    profile.vehicleType = selected.vehicleType;
    profile.vehicleMakeModel = selected.vehicleMakeModel;
    profile.vehicleRegistration = selected.vehicleRegistration;
    profile.vehicleCapacityKg = selected.vehicleCapacityKg;
    profile.documents.vehicleDocumentUrl = selected.vehicleDocumentUrl;
    profile.vehiclePhotos = selected.photos;

    await profile.save();
    await logActivity({
      driver: req.user.userId,
      driverProfile: profile._id,
      action: "vehicle_selected",
      message: "Driver selected an approved vehicle as active",
      metadata: {
        vehicleId: selected._id,
        registration: selected.vehicleRegistration,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Active vehicle updated",
      activeVehicleId: selected._id,
    });
  } catch (error) {
    console.error("Select active driver vehicle:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to select active vehicle",
    });
  }
};

// DRIVER: Request admin-reviewed vehicle change.
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

    if (vehicle.approvalStatus !== "approved") {
      return res.status(409).json({
        success: false,
        message: "Only approved vehicle details can be changed through a request",
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
        { "registeredVehicles.vehicleRegistration": req.body.vehicleRegistration },
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

    vehicle.changeRequest = {
      ...req.body,
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
        message: "The primary vehicle is reviewed with the driver onboarding profile",
      });
    }

    if (req.body.decision === "approve") {
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

// ADMIN: Review vehicle changes.
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
          message: "Wait until the driver finishes the active delivery before approving an active vehicle change",
        });
      }

      vehicle.vehicleType = change.vehicleType;
      vehicle.vehicleMakeModel = change.vehicleMakeModel;
      vehicle.vehicleRegistration = change.vehicleRegistration;
      vehicle.vehicleCapacityKg = change.vehicleCapacityKg;
      vehicle.vehicleDocumentUrl = change.vehicleDocumentUrl;
      vehicle.photos = change.photos;
      change.status = "approved";

      if (vehicle.isPrimary) {
        profile.vehicleType = vehicle.vehicleType;
        profile.vehicleMakeModel = vehicle.vehicleMakeModel;
        profile.vehicleRegistration = vehicle.vehicleRegistration;
        profile.vehicleCapacityKg = vehicle.vehicleCapacityKg;
        profile.documents.vehicleDocumentUrl = vehicle.vehicleDocumentUrl;
        profile.vehiclePhotos = vehicle.photos;
      }
    } else {
      change.status = "rejected";
    }

    change.reviewedAt = new Date();
    change.reviewedBy = req.user.userId;
    change.reviewNote = req.body.reviewNote || "";
    await profile.save();

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

// ADMIN: Driver activity history.
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

    if (
      typeof req.query.action === "string" &&
      req.query.action.trim()
    ) {
      filter.action = req.query.action.trim();
    }

    const activities = await DriverActivity.find(filter)
      .populate("driver", "name email phone")
      .populate("actor", "name email role")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.status(200).json({ success: true, activities });
  } catch (error) {
    console.error("List driver activities:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to load driver activities",
    });
  }
};