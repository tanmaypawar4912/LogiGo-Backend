import express from "express";
import rateLimit from "express-rate-limit";

import {
  register,
  login,
  refreshAccessToken,
  logout,
  getCurrentUser,
  updateProfile,
  requestPasswordReset,
  resetPassword,
} from "../controllers/authController.js";

import { protect } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validateMiddleware.js";

import {
  registerSchema,
  loginSchema,
  updateProfileSchema,
} from "../validators/authValidator.js";

import {
  requestPasswordResetSchema,
  resetPasswordSchema,
} from "../validators/passwordResetValidator.js";

const router = express.Router();

// Rate-limit password recovery endpoints.
const passwordRecoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message:
      "Too many password recovery attempts. Please try again later.",
  },
});

// Registration
router.post(
  "/register",
  validate(registerSchema),
  register
);

// Login
router.post(
  "/login",
  validate(loginSchema),
  login
);

// Forgot password
router.post(
  "/forgot-password",
  passwordRecoveryLimiter,
  validate(requestPasswordResetSchema),
  requestPasswordReset
);

// Reset password
router.post(
  "/reset-password",
  passwordRecoveryLimiter,
  validate(resetPasswordSchema),
  resetPassword
);

// Refresh access token
router.post(
  "/refresh",
  refreshAccessToken
);

// Logout
router.post(
  "/logout",
  logout
);

// Update authenticated user's own profile
router.patch(
  "/profile",
  protect,
  validate(updateProfileSchema),
  updateProfile
);

// Get authenticated user's details
router.get(
  "/me",
  protect,
  getCurrentUser
);

export default router;