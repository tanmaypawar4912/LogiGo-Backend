import mongoose from "mongoose";
import Review from "../models/Review.js";

export async function getDriverReviews(req, res, next) {
  try {
    const driverId = req.user?.userId;

    if (!driverId || !mongoose.isValidObjectId(driverId)) {
      return res.status(401).json({
        success: false,
        message: "Please sign in again.",
      });
    }

    const page = Math.max(
      1,
      Number.parseInt(req.query.page, 10) || 1
    );

    const limit = Math.min(
      50,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 10)
    );

    const driverObjectId = new mongoose.Types.ObjectId(String(driverId));

    const [reviews, total, aggregate] = await Promise.all([
      Review.find({ driver: driverObjectId })
        .populate({ path: "customer", select: "name" })
        .populate({ path: "booking", select: "bookingCode status" })
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),

      Review.countDocuments({ driver: driverObjectId }),

      Review.aggregate([
        { $match: { driver: driverObjectId } },
        {
          $group: {
            _id: null,
            averageRating: { $avg: "$rating" },
            totalReviews: { $sum: 1 },
          },
        },
      ]),
    ]);

    const summary = aggregate[0] || {
      averageRating: 0,
      totalReviews: 0,
    };

    return res.status(200).json({
      success: true,
      reviews,
      summary: {
        totalReviews: summary.totalReviews || 0,
        averageRating: Number(
          (summary.averageRating || 0).toFixed(1)
        ),
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return next(error);
  }
}