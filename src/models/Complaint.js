import mongoose from "mongoose";
import { randomBytes } from "node:crypto";

const complaintSchema = new mongoose.Schema(
  {
    complaintCode: {
      type: String,
      required: true,
      unique: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      default: null,
      index: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 120,
    },
    category: {
      type: String,
      required: true,
      enum: ["booking", "driver", "vehicle", "payment", "delivery", "app", "other"],
      default: "other",
    },
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 2000,
    },
    status: {
      type: String,
      enum: ["open", "in_progress", "resolved", "closed", "dismissed"],
      default: "open",
      index: true,
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
      index: true,
    },
    adminNotes: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },
    resolution: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

complaintSchema.pre("validate", function setComplaintCode() {
  if (!this.complaintCode) {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = randomBytes(3).toString("hex").toUpperCase();
    this.complaintCode = `LG-CMP-${timestamp}-${random}`;
  }
});

complaintSchema.index({ customer: 1, createdAt: -1 });
complaintSchema.index({ status: 1, priority: 1, createdAt: -1 });

const Complaint = mongoose.model("Complaint", complaintSchema);
export default Complaint;
