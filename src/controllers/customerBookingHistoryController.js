import mongoose from "mongoose";
import Booking from "../models/Booking.js";

const validStatuses = new Set([
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
]);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getId(value) {
  if (!value) return "";

  if (typeof value === "object" && value._id) {
    return String(value._id);
  }

  return String(value);
}

function wasCreatedByCustomer(booking, customerId) {
  return (
    Array.isArray(booking.statusHistory) &&
    booking.statusHistory.some(
      (entry) =>
        entry.status === "pending" &&
        String(entry.changedBy || "") === String(customerId)
    )
  );
}

// CUSTOMER: List own bookings, including verifiable legacy records.
export const getMyBookings = async (req, res) => {
  try {
    const customerId = req.user.userId;

    const page = Math.max(
      1,
      Number.parseInt(req.query.page, 10) || 1
    );

    const limit = Math.min(
      50,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 10)
    );

    const status =
      typeof req.query.status === "string"
        ? req.query.status
        : "";

    const search =
      typeof req.query.search === "string"
        ? req.query.search.trim().slice(0, 120)
        : "";

    if (status && !validStatuses.has(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking status filter",
      });
    }

    // A booking is visible when either:
    // 1. its customer reference is the logged-in customer, OR
    // 2. the initial pending status-history event identifies
    //    that same customer as the booking creator.
    const conditions = [
      {
        $or: [
          { customer: customerId },
          {
            statusHistory: {
              $elemMatch: {
                status: "pending",
                changedBy: customerId,
              },
            },
          },
        ],
      },
    ];

    if (search) {
      const phrase = new RegExp(escapeRegex(search), "i");

      conditions.push({
        $or: [
          { bookingCode: phrase },
          { "pickup.address": phrase },
          { "drop.address": phrase },
          { "package.description": phrase },
        ],
      });
    }

    const filter = {
      $and: conditions,
    };

    if (status) {
      filter.status = status;
    }

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .sort({ createdAt: -1, _id: -1 })
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
    console.error(
      "Get customer bookings error:",
      error.message
    );

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve bookings",
    });
  }
};

// CUSTOMER / assigned DRIVER / ADMIN: Access-controlled booking details.
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

    const userId = String(req.user.userId);
    const role = req.user.role;

    const isAdmin = role === "admin";

    const customerRefId = getId(booking.customer);

    const isCustomerByReference =
      role === "customer" &&
      customerRefId === userId;

    const isCustomerByCreationHistory =
      role === "customer" &&
      wasCreatedByCustomer(booking, userId);

    const isAssignedDriver =
      role === "driver" &&
      getId(booking.driver) === userId;

    if (
      !isAdmin &&
      !isCustomerByReference &&
      !isCustomerByCreationHistory &&
      !isAssignedDriver
    ) {
      return res.status(403).json({
        success: false,
        message: "You cannot access this booking",
      });
    }

    return res.status(200).json({
      success: true,
      booking,
    });
  } catch (error) {
    console.error("Get booking error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve booking",
    });
  }
};