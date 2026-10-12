
import express from "express";

import {
  createBooking,
  getMyBookings,
  getBookingById,
} from "../controllers/bookingController.js";

import { protect } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/roleMiddleware.js";
import { validate } from "../middleware/validateMiddleware.js";

import { createBookingSchema } from "../validators/bookingValidator.js";

const router = express.Router();

// Customer creates a booking.
router.post(
  "/",
  protect,
  authorizeRoles("customer"),
  validate(createBookingSchema),
  createBooking
);

// Customer sees only their own booking history.
router.get(
  "/my",
  protect,
  authorizeRoles("customer"),
  getMyBookings
);

// Only the booking's customer, assigned driver or admin may view it.
router.get("/:id", protect, getBookingById);

export default router;
