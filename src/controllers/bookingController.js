import { randomBytes } from "node:crypto";
import mongoose from "mongoose";

import Booking from "../models/Booking.js";
import DriverProfile from "../models/DriverProfile.js";
import DriverActivity from "../models/DriverActivity.js";
import { calculateFareEstimate } from "../services/fareService.js";

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

function hasRequiredDriverDocumentsAndPhotos(profile) {
  const isHttpsUrl = (value) => {
    if (typeof value !== "string" || !value.trim()) return false;

    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  };

  const primaryVehicle = (profile.registeredVehicles || []).find(
    (vehicle) => vehicle.isPrimary
  );

  const photos = primaryVehicle?.photos || profile.vehiclePhotos;
  const vehicleDocument =
    primaryVehicle?.vehicleDocumentUrl ||
    profile.documents?.vehicleDocumentUrl;

  return [
    profile.documents?.licenseDocumentUrl,
    profile.documents?.identityDocumentUrl,
    vehicleDocument,
  ].every(isHttpsUrl) &&
    [photos?.front, photos?.right, photos?.left, photos?.back].every(isHttpsUrl);
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
      statusHistory: [
        {
          status: "pending",
          changedBy: req.user.userId,
          note: "Booking created by customer",
        },
      ],
    });

    const savedBooking = await Booking.findById(booking._id)
      .populate("vehicle", "name slug capacityKg")
      .lean();

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

    const availableDrivers = profiles
      .filter(
        (profile) =>
          profile.user &&
          profile.user.role === "driver" &&
          profile.user.isActive === true
      )
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

    if (!hasRequiredDriverDocumentsAndPhotos(driverProfile)) {
      return res.status(409).json({
        success: false,
        message:
          "Driver is missing a valid licence/identity/vehicle document or one of the four vehicle photos",
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

    const booking = await Booking.findOneAndUpdate(
      {
        _id: req.params.id,
        status: "pending",
        driver: null,
      },
      {
        $set: { driver: driverUserId, status: "assigned" },
        $push: {
          statusHistory: {
            status: "assigned",
            changedBy: req.user.userId,
            note: "Driver assigned by admin",
          },
        },
      },
      { returnDocument: "after", runValidators: true }
    )
      .populate("customer", "name email phone")
      .populate("driver", "name email phone")
      .populate("vehicle", "name slug capacityKg")
      .lean();

    if (!booking) {
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

    reservedDriverUserId = null;

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

// DRIVER: Assigned jobs and recent history for Overview statistics.
export const getDriverJobs = async (req, res) => {
  try {
    const bookings = await Booking.find({
      driver: req.user.userId,
    })
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(100)
      .populate("customer", "name phone")
      .populate("vehicle", "name capacityKg")
      .lean();

    return res.status(200).json({
      success: true,
      count: bookings.length,
      jobs: bookings,
    });
  } catch (error) {
    console.error("Get driver jobs error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to load driver jobs",
    });
  }
};

// DRIVER: Accept or reject an assigned booking.
export const respondToBooking = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID",
      });
    }

    const { action, rejectionReason = "" } = req.body;

    const profile = await DriverProfile.findOne({
      user: req.user.userId,
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
      driver: req.user.userId,
      status: "assigned",
    })
      .select("_id")
      .lean();

    if (!currentBooking) {
      return res.status(409).json({
        success: false,
        message: "This job is no longer assigned to you",
      });
    }

    const accepting = action === "accept";

    const update = accepting
      ? {
          $set: { status: "accepted" },
          $push: {
            statusHistory: {
              status: "accepted",
              changedBy: req.user.userId,
              note: "Driver accepted the job",
            },
          },
        }
      : {
          $set: { status: "pending", driver: null },
          $push: {
            statusHistory: {
              status: "pending",
              changedBy: req.user.userId,
              note: `Driver rejected assignment: ${rejectionReason}`,
            },
          },
        };

    const booking = await Booking.findOneAndUpdate(
      {
        _id: req.params.id,
        driver: req.user.userId,
        status: "assigned",
      },
      update,
      { returnDocument: "after", runValidators: true }
    )
      .populate("customer", "name phone")
      .populate("vehicle", "name capacityKg")
      .lean();

    if (!booking) {
      return res.status(409).json({
        success: false,
        message: "The job changed. Refresh your jobs list.",
      });
    }

    if (!accepting) {
      await DriverProfile.updateOne(
        { user: req.user.userId, availability: "busy" },
        { $set: { availability: "online" } }
      );
    }

    await logDriverActivity({
      driver: req.user.userId,
      driverProfile: profile._id,
      action: accepting ? "job_accepted" : "job_rejected",
      message: accepting
        ? `Driver accepted booking ${booking.bookingCode || booking._id}`
        : `Driver rejected booking ${booking.bookingCode || booking._id}`,
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
        : "Job rejected and returned to the pending queue",
      booking,
    });
  } catch (error) {
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
    )
      .populate("customer", "name phone")
      .populate("vehicle", "name capacityKg")
      .lean();

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