
import express from "express";
import multer from "multer";

import {
  submitDriverProfile,
  updateDriverProfile,
  getMyDriverProfile,
  setDriverAvailability,
  getOnlineDrivers,
  listDriverProfiles,
  reviewDriverProfile,
  getDriverVehicles,
  addDriverVehicle,
  selectActiveDriverVehicle,
  updateDriverVehicle,
  listDriverActivities,
} from "../controllers/driverController.js";

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
  driverVehicleSchema,
  driverAvailabilitySchema,
  reviewDriverSchema,
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

// Existing driver profiles update directly. POST /profile remains initial onboarding only.
router.patch(
  "/profile",
  protect,
  authorizeRoles("driver"),
  validate(driverProfileSchema),
  validateDriverPhotoOwnership,
  updateDriverProfile
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

router.patch(
  "/vehicles/:vehicleId",
  protect,
  authorizeRoles("driver"),
  validate(driverVehicleSchema),
  validateDriverPhotoOwnership,
  updateDriverVehicle
);

// Additional vehicle creation remains disabled: one driver has exactly one vehicle.
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


// ---------------------------------------------------------------------
// ADMIN DRIVER APIs
// ---------------------------------------------------------------------

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




router.get(
  "/admin/activities",
  protect,
  authorizeRoles("admin"),
  listDriverActivities
);

// Handle Multer and upload middleware errors.
router.use((error, _req, res, next) => {
  if (!error) return next();

  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;

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
