import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import DriverLocation from "../models/DriverLocation.js";

const TRACKABLE_STATUSES = new Set([
  "accepted",
  "arriving_at_pickup",
  "arrived_at_pickup",
  "picked_up",
  "in_transit",
  "arrived_at_drop",
]);
const TERMINAL_STATUSES = new Set(["delivered", "cancelled"]);
const LOCATION_TTL_MS = 5 * 60 * 1000;

const isSameId = (left, right) => left != null && right != null && String(left) === String(right);

function validateBookingId(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(400).json({ success: false, message: "Invalid booking ID" });
    return false;
  }
  return true;
}

function parseOptionalNumber(value, name, min, max, res) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    res.status(422).json({ success: false, message: `${name} must be a number between ${min} and ${max}` });
    return undefined;
  }
  return value;
}

async function loadAuthorizedBooking(req, res) {
  const booking = await Booking.findById(req.params.id)
    .select("_id customer driver status bookingCode")
    .lean();

  if (!booking) {
    res.status(404).json({ success: false, message: "Booking not found" });
    return null;
  }

  const allowed =
    req.user.role === "admin" ||
    isSameId(booking.customer, req.user.userId) ||
    isSameId(booking.driver, req.user.userId);

  if (!allowed) {
    res.status(403).json({ success: false, message: "You cannot access tracking for this booking" });
    return null;
  }
  return booking;
}

// DRIVER: save only the latest point for their own active assigned delivery.
export const updateDriverLiveLocation = async (req, res) => {
  try {
    if (!validateBookingId(req, res)) return;

    const { latitude, longitude } = req.body || {};
    if (
      typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
    ) {
      return res.status(422).json({ success: false, message: "Send valid GPS latitude and longitude values" });
    }

    const accuracyMeters = parseOptionalNumber(req.body.accuracyMeters, "accuracyMeters", 0, 100000, res);
    if (accuracyMeters === undefined) return;
    const headingDegrees = parseOptionalNumber(req.body.headingDegrees, "headingDegrees", 0, 360, res);
    if (headingDegrees === undefined) return;
    const speedMetersPerSecond = parseOptionalNumber(req.body.speedMetersPerSecond, "speedMetersPerSecond", 0, 100, res);
    if (speedMetersPerSecond === undefined) return;

    const booking = await Booking.findById(req.params.id).select("_id driver status").lean();
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
    if (!isSameId(booking.driver, req.user.userId)) {
      return res.status(403).json({ success: false, message: "Only the assigned driver can share location" });
    }
    if (!TRACKABLE_STATUSES.has(booking.status)) {
      return res.status(409).json({
        success: false,
        message: "GPS sharing is available only after the driver accepts and while the delivery is active",
        currentStatus: booking.status,
      });
    }

    const now = new Date();
    const values = {
      booking: booking._id,
      driver: req.user.userId,
      latitude,
      longitude,
      accuracyMeters,
      headingDegrees,
      speedMetersPerSecond,
      capturedAt: now,
      expiresAt: new Date(now.getTime() + LOCATION_TTL_MS),
    };

    try {
      await DriverLocation.findOneAndUpdate(
        { booking: booking._id },
        { $set: values },
        { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true }
      );
    } catch (error) {
      // Recover when two tabs race to create the first point for a booking.
      if (error?.code !== 11000) throw error;
      await DriverLocation.findOneAndUpdate(
        { booking: booking._id, driver: req.user.userId },
        { $set: values },
        { returnDocument: "after", runValidators: true }
      );
    }

    return res.status(200).json({ success: true, message: "Live location updated", capturedAt: now });
  } catch (error) {
    console.error("Update driver live location error:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update live location" });
  }
};

// DRIVER: explicitly stop sharing and immediately delete the latest point.
export const stopDriverLiveLocation = async (req, res) => {
  try {
    if (!validateBookingId(req, res)) return;
    const booking = await Booking.findById(req.params.id).select("_id driver").lean();
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
    if (!isSameId(booking.driver, req.user.userId)) {
      return res.status(403).json({ success: false, message: "Only the assigned driver can stop location sharing" });
    }

    await DriverLocation.deleteOne({ booking: booking._id, driver: req.user.userId });
    return res.status(200).json({ success: true, message: "Live location sharing stopped" });
  } catch (error) {
    console.error("Stop driver live location error:", error.message);
    return res.status(500).json({ success: false, message: "Unable to stop live location sharing" });
  }
};

// CUSTOMER (booking owner), assigned DRIVER, or ADMIN: read only the latest point.
export const getBookingLiveLocation = async (req, res) => {
  try {
    if (!validateBookingId(req, res)) return;
    const booking = await loadAuthorizedBooking(req, res);
    if (!booking) return;

    if (TERMINAL_STATUSES.has(booking.status)) {
      await DriverLocation.deleteOne({ booking: booking._id });
      return res.status(200).json({ success: true, trackingActive: false, reason: "delivery_finished", location: null });
    }
    if (!TRACKABLE_STATUSES.has(booking.status) || !booking.driver) {
      return res.status(200).json({ success: true, trackingActive: false, reason: "waiting_for_driver", location: null });
    }

    const location = await DriverLocation.findOne({
      booking: booking._id,
      driver: booking.driver,
      expiresAt: { $gt: new Date() },
    }).select("latitude longitude accuracyMeters headingDegrees speedMetersPerSecond capturedAt").lean();

    return res.status(200).json({
      success: true,
      trackingActive: true,
      reason: location ? null : "waiting_for_location",
      location: location || null,
    });
  } catch (error) {
    console.error("Get booking live location error:", error.message);
    return res.status(500).json({ success: false, message: "Unable to load live location" });
  }
};
