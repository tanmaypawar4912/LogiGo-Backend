import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Review from "../models/Review.js";

function authUserId(req) {
  return req.user?._id ?? req.user?.id ?? req.user?.userId ?? null;
}

function sendError(res, status, message) {
  return res.status(status).json({
    success: false,
    message,
  });
}

/**
 * Keep review ownership consistent with the customer booking-history query.
 * Current records match Booking.customer.
 * Legacy records may use the original customer ID stored in statusHistory.
 */
function customerBookingFilter(customerId) {
  return {
    $or: [
      { customer: customerId },
      {
        statusHistory: {
          $elemMatch: {
            status: "pending",
            changedBy: customerId,
          },
        },
      },
    ],
  };
}

function isBookingOwnedByCustomer(booking, customerId) {
  if (!booking || !customerId) return false;

  if (String(booking.customer ?? "") === String(customerId)) {
    return true;
  }

  return (
    Array.isArray(booking.statusHistory) &&
    booking.statusHistory.some(
      (entry) =>
        entry.status === "pending" &&
        String(entry.changedBy ?? "") === String(customerId)
    )
  );
}

const reviewPopulate = [
  { path: "customer", select: "name email phone" },
  { path: "driver", select: "name email phone" },
  { path: "booking", select: "bookingCode status" },
];

export async function createReview(req, res, next) {
  try {
    const customerId = authUserId(req);
    const {
      bookingId,
      rating,
      comment,
      title = "",
    } = req.body ?? {};

    if (
      !customerId ||
      !mongoose.isValidObjectId(customerId)
    ) {
      return sendError(
        res,
        401,
        "Please sign in again to submit a review."
      );
    }

    if (!mongoose.isValidObjectId(bookingId)) {
      return sendError(
        res,
        400,
        "A valid bookingId is required."
      );
    }

    const numericRating = Number(rating);

    if (
      !Number.isInteger(numericRating) ||
      numericRating < 1 ||
      numericRating > 5
    ) {
      return sendError(
        res,
        400,
        "Rating must be a whole number from 1 to 5."
      );
    }

    if (
      typeof comment !== "string" ||
      comment.trim().length < 2 ||
      comment.trim().length > 1000
    ) {
      return sendError(
        res,
        400,
        "Comment must contain 2 to 1000 characters."
      );
    }

    if (
      typeof title !== "string" ||
      title.trim().length > 100
    ) {
      return sendError(
        res,
        400,
        "Review title must not exceed 100 characters."
      );
    }

    // Fetch by ID first, then explicitly verify customer ownership.
    // This supports verified legacy bookings without allowing users to
    // review bookings that belong to someone else.
    const booking = await Booking.findById(bookingId).select(
      "_id customer driver status statusHistory"
    );

    if (!booking) {
      return sendError(
        res,
        404,
        "Booking not found for this customer."
      );
    }

    if (!isBookingOwnedByCustomer(booking, customerId)) {
      return sendError(
        res,
        404,
        "Booking not found for this customer."
      );
    }

    if (booking.status !== "delivered") {
      return sendError(
        res,
        409,
        "You can review a booking only after it has been delivered."
      );
    }

    // Always save the authenticated customer ID. Do not propagate an
    // incorrect legacy Booking.customer reference into the new review.
    const review = await Review.create({
      booking: booking._id,
      customer: customerId,
      driver: booking.driver ?? null,
      rating: numericRating,
      title: title.trim(),
      comment: comment.trim(),
    });

    const populatedReview = await Review.findById(review._id)
      .populate(reviewPopulate)
      .lean();

    return res.status(201).json({
      success: true,
      message: "Review submitted successfully.",
      review: populatedReview,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return sendError(
        res,
        409,
        "A review has already been submitted for this booking."
      );
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

    if (
      !customerId ||
      !mongoose.isValidObjectId(customerId)
    ) {
      return sendError(
        res,
        401,
        "Please sign in again."
      );
    }

    // Collect current and legacy bookings that can be verified as
    // belonging to this customer.
    const ownedBookings = await Booking.find(
      customerBookingFilter(customerId)
    )
      .select("_id")
      .lean();

    const ownedBookingIds = ownedBookings.map(
      (booking) => booking._id
    );

    const reviewConditions = [
      { customer: customerId },
    ];

    // Include historical reviews attached to an owned booking even if
    // the older Review.customer field was saved inconsistently.
    if (ownedBookingIds.length > 0) {
      reviewConditions.push({
        booking: { $in: ownedBookingIds },
      });
    }

    const reviews = await Review.find({
      $or: reviewConditions,
    })
      .populate(reviewPopulate)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return res.status(200).json({
      success: true,
      reviews,
    });
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

    return res.status(200).json({
      success: true,
      reviews,
    });
  } catch (error) {
    return next(error);
  }
}