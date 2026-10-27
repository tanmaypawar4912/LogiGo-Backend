import mongoose from "mongoose";
import Booking from "../models/Booking.js";

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function getDriverCompletedJobs(req, res) {
  try {
    const driverId = req.user?.userId;

    if (!driverId || !mongoose.isValidObjectId(driverId)) {
      return res.status(401).json({
        success: false,
        message: "Please sign in again.",
      });
    }

    const page = Math.max(
      1,
      Number.parseInt(req.query.page, 10) || 1
    );

    const limit = Math.min(
      50,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 10)
    );

    const search =
      typeof req.query.search === "string"
        ? req.query.search.trim().slice(0, 100)
        : "";

    const filter = {
      driver: driverId,
      status: "delivered",
    };

    if (search) {
      const phrase = new RegExp(escapeRegex(search), "i");

      filter.$or = [
        { bookingCode: phrase },
        { "pickup.address": phrase },
        { "drop.address": phrase },
        { "package.description": phrase },
      ];
    }

    const [jobs, total] = await Promise.all([
      Booking.find(filter)
        .sort({ updatedAt: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("customer", "name phone")
        .populate("vehicle", "name capacityKg slug")
        .lean(),

      Booking.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      jobs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error(
      "Get driver completed jobs error:",
      error.message
    );

    return res.status(500).json({
      success: false,
      message: "Unable to load completed deliveries.",
    });
  }
}