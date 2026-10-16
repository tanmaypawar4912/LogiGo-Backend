import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Review from "../models/Review.js";

function authUserId(req) {
  return req.user?._id ?? req.user?.id ?? req.user?.userId ?? null;
}

function sendError(res, status, message) {
  return res.status(status).json({ success: false, message });
}

const reviewPopulate = [
  { path: "customer", select: "name email phone" },
  { path: "driver", select: "name email phone" },
  { path: "booking", select: "bookingCode status" },
];

export async function createReview(req, res, next) {
  try {
    const customerId = authUserId(req);
    const { bookingId, rating, comment, title = "" } = req.body ?? {};

    if (!customerId || !mongoose.isValidObjectId(customerId)) {
      return sendError(res, 401, "Please sign in again to submit a review.");
    }
    if (!mongoose.isValidObjectId(bookingId)) {
      return sendError(res, 400, "A valid bookingId is required.");
    }
    const numericRating = Number(rating);
    if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
      return sendError(res, 400, "Rating must be a whole number from 1 to 5.");
    }
    if (typeof comment !== "string" || comment.trim().length < 2 || comment.trim().length > 1000) {
      return sendError(res, 400, "Comment must contain 2 to 1000 characters.");
    }
    if (typeof title !== "string" || title.trim().length > 100) {
      return sendError(res, 400, "Review title must not exceed 100 characters.");
    }

    const booking = await Booking.findOne({ _id: bookingId, customer: customerId }).select("_id customer driver status");
    if (!booking) {
      return sendError(res, 404, "Booking not found for this customer.");
    }
    if (booking.status !== "delivered") {
      return sendError(res, 409, "You can review a booking only after it has been delivered.");
    }

    const review = await Review.create({
      booking: booking._id,
      customer: booking.customer,
      driver: booking.driver ?? null,
      rating: numericRating,
      title: title.trim(),
      comment: comment.trim(),
    });

    const populatedReview = await Review.findById(review._id).populate(reviewPopulate);
    return res.status(201).json({
      success: true,
      message: "Review submitted successfully.",
      review: populatedReview,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return sendError(res, 409, "A review has already been submitted for this booking.");
    }
    if (error instanceof mongoose.Error.ValidationError) {
      return sendError(res, 400, error.message);
    }
    return next(error);
  }
}

export async function getMyReviews(req, res, next) {
  try {
    const customerId = authUserId(req);
    if (!customerId || !mongoose.isValidObjectId(customerId)) {
      return sendError(res, 401, "Please sign in again.");
    }

    const reviews = await Review.find({ customer: customerId })
      .populate(reviewPopulate)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return res.status(200).json({ success: true, reviews });
  } catch (error) {
    return next(error);
  }
}

export async function getAdminReviews(req, res, next) {
  try {
    const reviews = await Review.find({})
      .populate(reviewPopulate)
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    return res.status(200).json({ success: true, reviews });
  } catch (error) {
    return next(error);
  }
}
