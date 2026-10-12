
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";

import Booking from "../models/Booking.js";
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

function generateBookingCode() {
  const randomPart = randomBytes(4).toString("hex").toUpperCase();

  return `LG-${Date.now().toString(36).toUpperCase()}-${randomPart}`;
}

export const createBooking = async (req, res) => {
  try {
    // Recalculate the route and fare on the server.
    // Never trust a price sent by the browser.
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

    const statusCode = error.statusCode || 500;

    return res.status(statusCode).json({
      success: false,
      message:
        statusCode < 500
          ? error.message
          : "Unable to create the booking at this time.",
    });
  }
};

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
      typeof req.query.status === "string"
        ? req.query.status
        : "";

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

    const isAdmin = req.user.role === "admin";

    const isCustomer =
      booking.customer?._id?.toString() === req.user.userId;

    const isAssignedDriver =
      booking.driver?._id?.toString() === req.user.userId;

    if (!isAdmin && !isCustomer && !isAssignedDriver) {
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
