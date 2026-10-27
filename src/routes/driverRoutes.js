import express from "express";
import multer from "multer";

import {
  submitDriverProfile,
  getMyDriverProfile,
  requestDriverProfileChange,
  setDriverAvailability,
  getOnlineDrivers,
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

import {
  listDriverProfilesForAdmin,
} from "../controllers/adminDriverProfileController.js";

import {
  uploadDriverMedia,
  getDriverMediaAccess,
  deleteDriverMediaAsset,
} from "../controllers/driverMediaController.js";

import { protect } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/roleMiddleware.js";
import { validate } from "../middleware/validateMiddleware.js";
import { validateDriverPhotoOwnership } from "../middleware/validateDriverPhotoOwnership.js";

import {
  driverProfileSchema,
  driverProfileChangeSchema,
  driverVehicleSchema,
  driverVehicleChangeSchema,
  driverAvailabilitySchema,
  reviewDriverSchema,
  reviewChangeRequestSchema,
} from "../validators/driverValidator.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      const error = new Error(
        "Only JPG, PNG and WEBP images are allowed"
      );

      error.statusCode = 422;

      return callback(error);
    }

    callback(null, true);
  },
});

// ---------------------------------------------------------------------
// DRIVER MEDIA APIs
// ---------------------------------------------------------------------

router.post(
  "/media/upload",
  protect,
  authorizeRoles("driver"),
  upload.single("file"),
  uploadDriverMedia
);

router.get(
  "/media/:assetId/access",
  protect,
  getDriverMediaAccess
);

router.delete(
  "/media/:assetId",
  protect,
  authorizeRoles("driver"),
  deleteDriverMediaAsset
);

// ---------------------------------------------------------------------
// DRIVER PROFILE APIs
// ---------------------------------------------------------------------

router.post(
  "/profile",
  protect,
  authorizeRoles("driver"),
  validate(driverProfileSchema),
  validateDriverPhotoOwnership,
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

router.get(
  "/online",
  protect,
  getOnlineDrivers
);

// ---------------------------------------------------------------------
// DRIVER VEHICLE APIs
// ---------------------------------------------------------------------

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
  validateDriverPhotoOwnership,
  addDriverVehicle
);

router.patch(
  "/vehicles/:vehicleId/active",
  protect,
  authorizeRoles("driver"),
  selectActiveDriverVehicle
);

router.post(
  "/vehicles/:vehicleId/change-request",
  protect,
  authorizeRoles("driver"),
  validate(driverVehicleChangeSchema),
  validateDriverPhotoOwnership,
  requestDriverVehicleChange
);

// ---------------------------------------------------------------------
// ADMIN DRIVER APIs
// ---------------------------------------------------------------------

router.get(
  "/admin/profiles",
  protect,
  authorizeRoles("admin"),
  listDriverProfilesForAdmin
);

router.patch(
  "/admin/profiles/:id/review",
  protect,
  authorizeRoles("admin"),
  validate(reviewDriverSchema),
  reviewDriverProfile
);

router.patch(
  "/admin/profiles/:id/change-request/review",
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
  "/admin/profiles/:id/vehicles/:vehicleId/change-request/review",
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

// ---------------------------------------------------------------------
// Upload middleware error handling
// ---------------------------------------------------------------------

router.use((error, _req, res, next) => {
  if (!error) {
    return next();
  }

  if (error instanceof multer.MulterError) {
    const status =
      error.code === "LIMIT_FILE_SIZE" ? 413 : 400;

    return res.status(status).json({
      success: false,
      message:
        error.code === "LIMIT_FILE_SIZE"
          ? "Image size must be 8 MB or less"
          : "Unable to process uploaded image",
    });
  }

  if (error.statusCode) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
    });
  }

  return next(error);
});

export default router;