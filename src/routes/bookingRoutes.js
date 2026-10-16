
import express from "express";

import {
  createBooking,
  getMyBookings,
  getBookingById,
  getAdminBookingQueue,
  assignDriver,
  getDriverJobs,
  respondToBooking,
  updateDriverBookingStatus,
} from "../controllers/bookingController.js";

import { protect } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/roleMiddleware.js";
import { validate } from "../middleware/validateMiddleware.js";

import {
  createBookingSchema,
  assignDriverSchema,
  driverResponseSchema,
  updateDeliveryStatusSchema,
} from "../validators/bookingValidator.js";

const router = express.Router();

// Customer: create a booking.
router.post(
  "/",
  protect,
  authorizeRoles("customer"),
  validate(createBookingSchema),
  createBooking
);

// Customer: list own bookings.
router.get(
  "/my",
  protect,
  authorizeRoles("customer"),
  getMyBookings
);

// Admin: booking queue and available drivers.
router.get(
  "/admin/queue",
  protect,
  authorizeRoles("admin"),
  getAdminBookingQueue
);

// Admin: assign an eligible driver.
router.patch(
  "/admin/:id/assign",
  protect,
  authorizeRoles("admin"),
  validate(assignDriverSchema),
  assignDriver
);

// Driver: active assigned jobs.
router.get(
  "/driver/jobs",
  protect,
  authorizeRoles("driver"),
  getDriverJobs
);

// Driver: accept or reject a job.
router.patch(
  "/:id/respond",
  protect,
  authorizeRoles("driver"),
  validate(driverResponseSchema),
  respondToBooking
);

// Driver: update delivery status through valid transitions.
router.patch(
  "/:id/status",
  protect,
  authorizeRoles("driver"),
  validate(updateDeliveryStatusSchema),
  updateDriverBookingStatus
);

// Any authorized customer, assigned driver or admin can view a booking.
// Keep this parameter route last.
router.get("/:id", protect, getBookingById);

export default router;
