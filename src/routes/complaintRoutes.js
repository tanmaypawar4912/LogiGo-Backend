import express from "express";
import {
  createComplaint,
  getMyComplaints,
  getAdminComplaints,
  updateAdminComplaint,
} from "../controllers/complaintController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/roleMiddleware.js";

const router = express.Router();

// Register fixed routes before the id route.
router.get("/admin", protect, authorizeRoles("admin"), getAdminComplaints);
router.patch("/admin/:id", protect, authorizeRoles("admin"), updateAdminComplaint);
router.get("/mine", protect, authorizeRoles("customer"), getMyComplaints);
router.post("/", protect, authorizeRoles("customer"), createComplaint);

export default router;
