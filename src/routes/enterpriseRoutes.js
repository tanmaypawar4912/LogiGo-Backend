import express from "express";
import rateLimit from "express-rate-limit";
import {
  createEnterpriseEnquiry,
  getAdminEnterpriseEnquiries,
  updateAdminEnterpriseEnquiry,
} from "../controllers/enterpriseController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/roleMiddleware.js";
import { validate } from "../middleware/validateMiddleware.js";
import {
  createEnterpriseEnquirySchema,
  updateEnterpriseEnquirySchema,
} from "../validators/enterpriseValidator.js";

const router = express.Router();

const publicEnquiryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many enquiry attempts. Please wait and try again.",
  },
});

router.post(
  "/enquiries",
  publicEnquiryLimiter,
  validate(createEnterpriseEnquirySchema),
  createEnterpriseEnquiry
);

router.get(
  "/admin/enquiries",
  protect,
  authorizeRoles("admin"),
  getAdminEnterpriseEnquiries
);

router.patch(
  "/admin/enquiries/:id",
  protect,
  authorizeRoles("admin"),
  validate(updateEnterpriseEnquirySchema),
  updateAdminEnterpriseEnquiry
);

export default router;
