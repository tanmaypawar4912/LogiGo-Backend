import express from "express";
import {
  createReview,
  getMyReviews,
  getAdminReviews,
} from "../controllers/reviewController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/roleMiddleware.js";

const router = express.Router();

// Admin list route is registered before any potential id-based route.
router.get("/admin", protect, authorizeRoles("admin"), getAdminReviews);
router.get("/mine", protect, authorizeRoles("customer"), getMyReviews);
router.post("/", protect, authorizeRoles("customer"), createReview);

export default router;
