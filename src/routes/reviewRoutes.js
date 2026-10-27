import express from "express";

import {
  createReview,
  getMyReviews,
  getAdminReviews,
} from "../controllers/reviewController.js";

import {
  getDriverReviews,
} from "../controllers/driverReviewController.js";

import { protect } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/roleMiddleware.js";

const router = express.Router();

router.get(
  "/admin",
  protect,
  authorizeRoles("admin"),
  getAdminReviews
);

router.get(
  "/driver/mine",
  protect,
  authorizeRoles("driver"),
  getDriverReviews
);

router.get(
  "/mine",
  protect,
  authorizeRoles("customer"),
  getMyReviews
);

router.post(
  "/",
  protect,
  authorizeRoles("customer"),
  createReview
);

export default router;