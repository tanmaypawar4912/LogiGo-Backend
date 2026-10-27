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
  cancelCustomerBooking,
} from "../controllers/bookingController.js";

import {
  updateDriverLiveLocation,
  stopDriverLiveLocation,
  getBookingLiveLocation,
} from "../controllers/driverTrackingController.js";

import {
  getDriverCompletedJobs,
} from "../controllers/driverHistoryController.js";

import { protect } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/roleMiddleware.js";
import { validate } from "../middleware/validateMiddleware.js";
import { reconcileStaleBusyDriver } from "../middleware/reconcileStaleBusyDriver.js";

import {
  createBookingSchema,
  assignDriverSchema,
  driverResponseSchema,
  updateDeliveryStatusSchema,
  cancelBookingSchema,
} from "../validators/bookingValidator.js";

const router = express.Router();

router.post(
  "/",
  protect,
  authorizeRoles("customer"),
  validate(createBookingSchema),
  createBooking
);

router.get(
  "/my",
  protect,
  authorizeRoles("customer"),
  getMyBookings
);

router.get(
  "/admin/queue",
  protect,
  authorizeRoles("admin"),
  getAdminBookingQueue
);

router.patch(
  "/admin/:id/assign",
  protect,
  authorizeRoles("admin"),
  validate(assignDriverSchema),
  assignDriver
);

router.get(
  "/driver/jobs",
  protect,
  authorizeRoles("driver"),
  reconcileStaleBusyDriver,
  getDriverJobs
);

router.get(
  "/driver/completed",
  protect,
  authorizeRoles("driver"),
  getDriverCompletedJobs
);

router.patch(
  "/:id/respond",
  protect,
  authorizeRoles("driver"),
  validate(driverResponseSchema),
  respondToBooking
);

router.patch(
  "/:id/status",
  protect,
  authorizeRoles("driver"),
  validate(updateDeliveryStatusSchema),
  updateDriverBookingStatus
);

router.patch(
  "/:id/cancel",
  protect,
  authorizeRoles("customer"),
  validate(cancelBookingSchema),
  cancelCustomerBooking
);


// Booking-scoped location endpoints; controller enforces ownership/status again.
router.post(
  "/:id/location",
  protect,
  authorizeRoles("driver"),
  updateDriverLiveLocation
);

router.delete(
  "/:id/location",
  protect,
  authorizeRoles("driver"),
  stopDriverLiveLocation
);

router.get("/:id/location", protect, getBookingLiveLocation);

// Keep this dynamic route last so it cannot intercept fixed routes above.
router.get("/:id", protect, getBookingById);

export default router;