import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
  {
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      unique: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      validate: {
        validator: Number.isInteger,
        message: "Rating must be a whole number from 1 to 5.",
      },
    },
    title: {
      type: String,
      trim: true,
      maxlength: 100,
      default: "",
    },
    comment: {
      type: String,
      trim: true,
      required: true,
      minlength: 2,
      maxlength: 1000,
    },
  },
  { timestamps: true }
);

reviewSchema.index({ customer: 1, createdAt: -1 });
reviewSchema.index({ driver: 1, createdAt: -1 });

const Review = mongoose.model("Review", reviewSchema);
export default Review;
