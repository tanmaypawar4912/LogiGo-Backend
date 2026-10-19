import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Complaint from "../models/Complaint.js";

function authUserId(req) {
  return req.user?._id ?? req.user?.id ?? req.user?.userId ?? null;
}

function sendError(res, status, message) {
  return res.status(status).json({ success: false, message });
}

const complaintPopulate = [
  { path: "customer", select: "name email phone" },
  { path: "booking", select: "bookingCode status pickup drop" },
];

const allowedCategories = new Set(["booking", "driver", "vehicle", "payment", "delivery", "app", "other"]);
const allowedStatuses = new Set(["open", "in_progress", "resolved", "closed", "dismissed"]);
const allowedPriorities = new Set(["low", "medium", "high", "urgent"]);

export async function createComplaint(req, res, next) {
  try {
    const customerId = authUserId(req);
    const { bookingId, subject, category = "other", description } = req.body ?? {};

    if (!customerId || !mongoose.isValidObjectId(customerId)) {
      return sendError(res, 401, "Please sign in again to submit a complaint.");
    }
    if (typeof subject !== "string" || subject.trim().length < 3 || subject.trim().length > 120) {
      return sendError(res, 400, "Subject must contain 3 to 120 characters.");
    }
    if (typeof description !== "string" || description.trim().length < 10 || description.trim().length > 2000) {
      return sendError(res, 400, "Description must contain 10 to 2000 characters.");
    }
    if (typeof category !== "string" || !allowedCategories.has(category)) {
      return sendError(res, 400, "Choose a valid complaint category.");
    }

    let booking = null;
    if (bookingId !== undefined && bookingId !== null && bookingId !== "") {
      if (!mongoose.isValidObjectId(bookingId)) {
        return sendError(res, 400, "The bookingId is invalid.");
      }
      booking = await Booking.findOne({ _id: bookingId, customer: customerId }).select("_id");
      if (!booking) {
        return sendError(res, 404, "Booking not found for this customer.");
      }
    }

    const complaint = await Complaint.create({
      customer: customerId,
      booking: booking?._id ?? null,
      subject: subject.trim(),
      category,
      description: description.trim(),
    });
    const populatedComplaint = await Complaint.findById(complaint._id).populate(complaintPopulate);

    return res.status(201).json({
      success: true,
      message: "Complaint submitted successfully.",
      complaint: populatedComplaint,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return sendError(res, 409, "Could not create a unique complaint reference. Please retry.");
    }
    if (error instanceof mongoose.Error.ValidationError) {
      return sendError(res, 400, error.message);
    }
    return next(error);
  }
}

export async function getMyComplaints(req, res, next) {
  try {
    const customerId = authUserId(req);
    if (!customerId || !mongoose.isValidObjectId(customerId)) {
      return sendError(res, 401, "Please sign in again.");
    }

    const complaints = await Complaint.find({ customer: customerId })
      .populate(complaintPopulate)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return res.status(200).json({ success: true, complaints });
  } catch (error) {
    return next(error);
  }
}

export async function getAdminComplaints(req, res, next) {
  try {
    const complaints = await Complaint.find({})
      .populate(complaintPopulate)
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    return res.status(200).json({ success: true, complaints });
  } catch (error) {
    return next(error);
  }
}

export async function updateAdminComplaint(req, res, next) {
  try {
    const { id } = req.params;
    const { status, priority, adminNotes, resolution } = req.body ?? {};

    if (!mongoose.isValidObjectId(id)) {
      return sendError(res, 400, "A valid complaint id is required.");
    }
    if (status !== undefined && !allowedStatuses.has(status)) {
      return sendError(res, 400, "Choose a valid complaint status.");
    }
    if (priority !== undefined && !allowedPriorities.has(priority)) {
      return sendError(res, 400, "Choose a valid complaint priority.");
    }
    if (adminNotes !== undefined && (typeof adminNotes !== "string" || adminNotes.length > 2000)) {
      return sendError(res, 400, "Admin notes must be a string of at most 2000 characters.");
    }
    if (resolution !== undefined && (typeof resolution !== "string" || resolution.length > 2000)) {
      return sendError(res, 400, "Resolution must be a string of at most 2000 characters.");
    }
    if (status === undefined && priority === undefined && adminNotes === undefined && resolution === undefined) {
      return sendError(res, 400, "Provide at least one supported complaint field to update.");
    }

    const update = {};
    if (status !== undefined) update.status = status;
    if (priority !== undefined) update.priority = priority;
    if (adminNotes !== undefined) update.adminNotes = adminNotes.trim();
    if (resolution !== undefined) update.resolution = resolution.trim();
    if (status === "resolved" || status === "closed") {
      update.resolvedAt = new Date();
    } else if (status !== undefined) {
      update.resolvedAt = null;
    }

    const complaint = await Complaint.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true,
    }).populate(complaintPopulate);

    if (!complaint) {
      return sendError(res, 404, "Complaint not found.");
    }

    return res.status(200).json({
      success: true,
      message: "Complaint updated successfully.",
      complaint,
    });
  } catch (error) {
    if (error instanceof mongoose.Error.ValidationError) {
      return sendError(res, 400, error.message);
    }
    return next(error);
  }
}
