import express from "express";

import { receiveDriverMedia } from "../middleware/driverMediaUpload.js";

import {
  uploadDriverMediaAsset,
  getDriverMediaAccess,
} from "../controllers/driverMediaController.js";

import {
  submitDriverProfile,
  getMyDriverProfile,
  requestDriverProfileChange,
  setDriverAvailability,
  getOnlineDrivers,
  listDriverProfiles,
  reviewDriverProfile,
  reviewDriverProfileChange,
  getDriverVehicles,
  addDriverVehicle,
  selectActiveDriverVehicle,
  requestDriverVehicleChange,
  reviewDriverVehicle,
  reviewDriverVehicleChange,
  listDriverActivities,
} from "../controllers/driverController.js";

import { protect } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/roleMiddleware.js";
import { validate } from "../middleware/validateMiddleware.js";

import {
  driverProfileSchema,
  driverProfileChangeSchema,
  driverAvailabilitySchema,
  driverVehicleSchema,
  driverVehicleChangeSchema,
  reviewDriverSchema,
  reviewChangeRequestSchema,
} from "../validators/driverValidator.js";

const router = express.Router();

// Customer/admin-facing availability list.
router.get(
  "/online",
  protect,
  authorizeRoles("customer", "admin"),
  getOnlineDrivers
);
router.post(
  "/media/upload",
  protect,
  authorizeRoles("driver"),
  receiveDriverMedia,
  uploadDriverMediaAsset
);

router.get(
  "/media/:assetId/access",
  protect,
  authorizeRoles("driver", "admin"),
  getDriverMediaAccess
);

// Driver profile.
router.post(
  "/profile",
  protect,
  authorizeRoles("driver"),
  validate(driverProfileSchema),
  submitDriverProfile
);

router.get(
  "/profile",
  protect,
  authorizeRoles("driver"),
  getMyDriverProfile
);

router.post(
  "/profile/change-request",
  protect,
  authorizeRoles("driver"),
  validate(driverProfileChangeSchema),
  requestDriverProfileChange
);

router.patch(
  "/availability",
  protect,
  authorizeRoles("driver"),
  validate(driverAvailabilitySchema),
  setDriverAvailability
);

// Driver-owned vehicles.
router.get(
  "/vehicles",
  protect,
  authorizeRoles("driver"),
  getDriverVehicles
);

router.post(
  "/vehicles",
  protect,
  authorizeRoles("driver"),
  validate(driverVehicleSchema),
  addDriverVehicle
);

router.patch(
  "/vehicles/:vehicleId/select",
  protect,
  authorizeRoles("driver"),
  selectActiveDriverVehicle
);

router.post(
  "/vehicles/:vehicleId/change-request",
  protect,
  authorizeRoles("driver"),
  validate(driverVehicleChangeSchema),
  requestDriverVehicleChange
);

// Admin: initial approval and change requests.
router.get(
  "/admin/profiles",
  protect,
  authorizeRoles("admin"),
  listDriverProfiles
);

router.patch(
  "/admin/profiles/:id/review",
  protect,
  authorizeRoles("admin"),
  validate(reviewDriverSchema),
  reviewDriverProfile
);

router.patch(
  "/admin/profiles/:id/change-request",
  protect,
  authorizeRoles("admin"),
  validate(reviewChangeRequestSchema),
  reviewDriverProfileChange
);

router.patch(
  "/admin/profiles/:id/vehicles/:vehicleId/review",
  protect,
  authorizeRoles("admin"),
  validate(reviewDriverSchema),
  reviewDriverVehicle
);

router.patch(
  "/admin/profiles/:id/vehicles/:vehicleId/change-request",
  protect,
  authorizeRoles("admin"),
  validate(reviewChangeRequestSchema),
  reviewDriverVehicleChange
);

router.get(
  "/admin/activities",
  protect,
  authorizeRoles("admin"),
  listDriverActivities
);

export default router;