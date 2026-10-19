import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";

import User from "../models/User.js";
import RefreshToken from "../models/RefreshToken.js";
import PasswordResetToken from "../models/PasswordResetToken.js";

import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  hashToken,
} from "../utils/jwt.js";

import {
  setAuthCookies,
  clearAuthCookies,
} from "../utils/cookies.js";

import {
  isEmailServiceConfigured,
  sendPasswordResetEmail,
} from "../services/emailService.js";

const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000;

const PASSWORD_RESET_GENERIC_MESSAGE =
  "If an active account exists for that email, a password reset link will be sent shortly.";

const sanitizeUser = (user) => {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    profileImage: user.profileImage,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };
};

const createSession = async (user, res) => {
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  const tokenHash = hashToken(refreshToken);

  await RefreshToken.create({
    userId: user._id,
    tokenHash,
    expiresAt: new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000
    ),
  });

  setAuthCookies(res, accessToken, refreshToken);
};

// REGISTER
export const register = async (req, res) => {
  try {
    const { name, email, phone, password, role } = req.body;

    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await User.create({
      name,
      email,
      phone: phone || "",
      password: hashedPassword,
      role,
    });

    await createSession(user, res);

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error("Register error:", error);

    return res.status(500).json({
      success: false,
      message: "Registration failed",
    });
  }
};

// LOGIN
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select(
      "+password"
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Your account has been deactivated",
      });
    }

    const isPasswordCorrect = await bcrypt.compare(
      password,
      user.password
    );

    if (!isPasswordCorrect) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    await createSession(user, res);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      success: false,
      message: "Login failed",
    });
  }
};

// REFRESH ACCESS TOKEN
export const refreshAccessToken = async (req, res) => {
  try {
    const oldRefreshToken = req.cookies.refreshToken;

    if (!oldRefreshToken) {
      return res.status(401).json({
        success: false,
        message: "Refresh token not found",
      });
    }

    const decoded = verifyRefreshToken(oldRefreshToken);
    const tokenHash = hashToken(oldRefreshToken);

    const storedToken = await RefreshToken.findOne({
      userId: decoded.userId,
      tokenHash,
      revokedAt: null,
    });

    if (!storedToken) {
      return res.status(401).json({
        success: false,
        message: "Invalid refresh token",
      });
    }

    if (storedToken.expiresAt <= new Date()) {
      return res.status(401).json({
        success: false,
        message: "Refresh token expired",
      });
    }

    const user = await User.findById(decoded.userId);

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: "User account is not available",
      });
    }

    // Rotate refresh token.
    storedToken.revokedAt = new Date();
    await storedToken.save();

    await createSession(user, res);

    return res.status(200).json({
      success: true,
      message: "Access token refreshed",
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error("Refresh error:", error);

    clearAuthCookies(res);

    return res.status(401).json({
      success: false,
      message: "Invalid or expired refresh token",
    });
  }
};

// LOGOUT
export const logout = async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (refreshToken) {
      const tokenHash = hashToken(refreshToken);

      await RefreshToken.findOneAndUpdate(
        {
          tokenHash,
          revokedAt: null,
        },
        {
          revokedAt: new Date(),
        }
      );
    }

    clearAuthCookies(res);

    return res.status(200).json({
      success: true,
      message: "Logout successful",
    });
  } catch (error) {
    console.error("Logout error:", error);

    clearAuthCookies(res);

    return res.status(200).json({
      success: true,
      message: "Logout successful",
    });
  }
};

// CURRENT USER
export const getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: "User not found or inactive",
      });
    }

    return res.status(200).json({
      success: true,
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error("Get current user error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch current user",
    });
  }
};

// UPDATE AUTHENTICATED USER PROFILE
export const updateProfile = async (req, res) => {
  try {
    // The target account always comes from the authenticated session.
    // The client cannot change email, role, or account activation status.
    const user = await User.findById(req.user.userId);

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: "User not found or inactive",
      });
    }

    const { name, phone = "" } = req.body;

    user.name = name;
    user.phone = phone;

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error("Update profile error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update profile",
    });
  }
};

// FORGOT PASSWORD
// A generic response helps prevent account enumeration.
export const requestPasswordReset = async (req, res) => {
  if (!isEmailServiceConfigured()) {
    return res.status(503).json({
      success: false,
      message:
        "Password recovery is temporarily unavailable. Please try again later.",
    });
  }

  const email = String(req.body.email || "")
    .trim()
    .toLowerCase();

  try {
    const user = await User.findOne({
      email,
      isActive: true,
    });

    if (!user) {
      return res.status(200).json({
        success: true,
        message: PASSWORD_RESET_GENERIC_MESSAGE,
      });
    }

    const now = new Date();

    await PasswordResetToken.updateMany(
      {
        userId: user._id,
        usedAt: null,
      },
      {
        $set: { usedAt: now },
      }
    );

    const rawToken = randomBytes(32).toString("hex");

    const tokenHash = createHash("sha256")
      .update(rawToken)
      .digest("hex");

    const resetToken = await PasswordResetToken.create({
      userId: user._id,
      tokenHash,
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
    });

    const clientUrl = (
      process.env.CLIENT_URL || "http://localhost:5173"
    ).replace(/\/$/, "");

    const resetUrl =
      `${clientUrl}/reset-password?token=` +
      encodeURIComponent(rawToken);

    try {
      await sendPasswordResetEmail({
        to: user.email,
        resetUrl,
      });
    } catch (mailError) {
      // Revoke an undelivered reset token.
      await PasswordResetToken.updateOne(
        {
          _id: resetToken._id,
          usedAt: null,
        },
        {
          $set: { usedAt: new Date() },
        }
      );

      console.error(
        "Password reset email delivery failed:",
        mailError?.message || mailError
      );
    }

    return res.status(200).json({
      success: true,
      message: PASSWORD_RESET_GENERIC_MESSAGE,
    });
  } catch (error) {
    console.error("Password reset request error:", error);

    return res.status(500).json({
      success: false,
      message:
        "Unable to process the password reset request right now.",
    });
  }
};

// RESET PASSWORD
export const resetPassword = async (req, res) => {
  const { token, password } = req.body;

  try {
    const tokenHash = createHash("sha256")
      .update(token)
      .digest("hex");

    const now = new Date();

    const storedToken = await PasswordResetToken.findOne({
      tokenHash,
      usedAt: null,
      expiresAt: { $gt: now },
    }).select("+tokenHash");

    if (!storedToken) {
      return res.status(400).json({
        success: false,
        message:
          "This password reset link is invalid or has expired. Request a new one.",
      });
    }

    const user = await User.findById(
      storedToken.userId
    ).select("+password");

    if (!user || !user.isActive) {
      return res.status(400).json({
        success: false,
        message:
          "This password reset link is invalid or has expired. Request a new one.",
      });
    }

    // Atomically consume the reset token to prevent reuse.
    const consumedToken =
      await PasswordResetToken.findOneAndUpdate(
        {
          _id: storedToken._id,
          usedAt: null,
          expiresAt: { $gt: new Date() },
        },
        {
          $set: { usedAt: new Date() },
        },
        { new: true }
      );

    if (!consumedToken) {
      return res.status(400).json({
        success: false,
        message:
          "This password reset link has already been used or has expired. Request a new one.",
      });
    }

    user.password = await bcrypt.hash(password, 12);
    await user.save();

    // Revoke existing refresh-token sessions after password reset.
    await RefreshToken.updateMany(
      {
        userId: user._id,
        revokedAt: null,
      },
      {
        $set: { revokedAt: new Date() },
      }
    );

    await PasswordResetToken.updateMany(
      {
        userId: user._id,
        usedAt: null,
      },
      {
        $set: { usedAt: new Date() },
      }
    );

    clearAuthCookies(res);

    return res.status(200).json({
      success: true,
      message:
        "Password updated successfully. Please sign in with your new password.",
    });
  } catch (error) {
    console.error("Reset password error:", error);

    return res.status(500).json({
      success: false,
      message:
        "Unable to reset your password right now. Please try again.",
    });
  }
};