import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import User from "../models/User.js";
import RefreshToken from "../models/RefreshToken.js";
import { clearAuthCookies } from "../utils/cookies.js";

function sendError(res, status, message) {
  return res.status(status).json({ success: false, message });
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function revokeAllSessions(userId) {
  await RefreshToken.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

export async function changeEmail(req, res) {
  try {
    const userId = req.user?.userId;
    const currentPassword = req.body?.currentPassword;
    const newEmail =
      typeof req.body?.newEmail === "string"
        ? req.body.newEmail.trim().toLowerCase()
        : "";

    if (!userId || !mongoose.isValidObjectId(userId)) {
      return sendError(res, 401, "Please sign in again.");
    }

    if (typeof currentPassword !== "string" || !currentPassword) {
      return sendError(
        res,
        400,
        "Enter your current password to change your email."
      );
    }

    if (!newEmail || newEmail.length > 254 || !validEmail(newEmail)) {
      return sendError(res, 400, "Enter a valid new email address.");
    }

    const user = await User.findById(userId).select("+password");

    if (!user || !user.isActive) {
      return sendError(
        res,
        401,
        "Your account is unavailable. Please sign in again."
      );
    }

    const passwordMatches = await bcrypt.compare(
      currentPassword,
      user.password
    );

    if (!passwordMatches) {
      return sendError(res, 400, "Your current password is incorrect.");
    }

    if (newEmail === String(user.email).toLowerCase()) {
      return sendError(
        res,
        400,
        "The new email is the same as your current email."
      );
    }

    const existingUser = await User.findOne({ email: newEmail })
      .select("_id")
      .lean();

    if (
      existingUser &&
      String(existingUser._id) !== String(user._id)
    ) {
      return sendError(
        res,
        409,
        "An account with this email already exists."
      );
    }

    user.email = newEmail;
    await user.save();

    await revokeAllSessions(user._id);
    clearAuthCookies(res);

    return res.status(200).json({
      success: true,
      requiresLogin: true,
      message:
        "Email updated. Please sign in again using your new email address.",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        profileImage: user.profileImage,
        isActive: user.isActive,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    if (error?.code === 11000) {
      return sendError(
        res,
        409,
        "An account with this email already exists."
      );
    }

    console.error("Change email error:", error.message);

    return sendError(
      res,
      500,
      "Unable to change your email right now."
    );
  }
}

export async function changePassword(req, res) {
  try {
    const userId = req.user?.userId;
    const currentPassword = req.body?.currentPassword;
    const newPassword = req.body?.newPassword;

    if (!userId || !mongoose.isValidObjectId(userId)) {
      return sendError(res, 401, "Please sign in again.");
    }

    if (typeof currentPassword !== "string" || !currentPassword) {
      return sendError(res, 400, "Enter your current password.");
    }

    if (
      typeof newPassword !== "string" ||
      newPassword.length < 8 ||
      newPassword.length > 72
    ) {
      return sendError(
        res,
        400,
        "New password must contain 8 to 72 characters."
      );
    }

    const user = await User.findById(userId).select("+password");

    if (!user || !user.isActive) {
      return sendError(
        res,
        401,
        "Your account is unavailable. Please sign in again."
      );
    }

    const passwordMatches = await bcrypt.compare(
      currentPassword,
      user.password
    );

    if (!passwordMatches) {
      return sendError(res, 400, "Your current password is incorrect.");
    }

    const samePassword = await bcrypt.compare(
      newPassword,
      user.password
    );

    if (samePassword) {
      return sendError(
        res,
        400,
        "Choose a password different from your current password."
      );
    }

    user.password = await bcrypt.hash(newPassword, 12);
    await user.save();

    await revokeAllSessions(user._id);
    clearAuthCookies(res);

    return res.status(200).json({
      success: true,
      requiresLogin: true,
      message:
        "Password changed. Please sign in again with your new password.",
    });
  } catch (error) {
    console.error("Change password error:", error.message);

    return sendError(
      res,
      500,
      "Unable to change your password right now."
    );
  }
}