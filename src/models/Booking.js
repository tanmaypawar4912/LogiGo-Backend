
import mongoose from "mongoose";

const locationSchema = new mongoose.Schema(
  {
    address: {
      type: String,
      required: true,
      trim: true,
    },

    longitude: {
      type: Number,
      required: true,
      min: -180,
      max: 180,
    },

    latitude: {
      type: Number,
      required: true,
      min: -90,
      max: 90,
    },
  },
  { _id: false }
);

const packageSchema = new mongoose.Schema(
  {
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },

    weightKg: {
      type: Number,
      required: true,
      min: 0.1,
    },

    specialInstructions: {
      type: String,
      default: "",
      maxlength: 500,
    },
  },
  { _id: false }
);

const routeSchema = new mongoose.Schema(
  {
    distanceMeters: {
      type: Number,
      required: true,
      min: 0,
    },

    distanceKm: {
      type: Number,
      required: true,
      min: 0,
    },

    durationSeconds: {
      type: Number,
      required: true,
      min: 0,
    },

    durationMinutes: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

const fareSchema = new mongoose.Schema(
  {
    currency: {
      type: String,
      enum: ["INR"],
      default: "INR",
    },

    baseFare: { type: Number, required: true, min: 0 },
    perKmRate: { type: Number, required: true, min: 0 },
    perKgRate: { type: Number, required: true, min: 0 },
    distanceCharge: { type: Number, required: true, min: 0 },
    weightCharge: { type: Number, required: true, min: 0 },
    serviceFee: { type: Number, required: true, min: 0 },
    subtotal: { type: Number, required: true, min: 0 },
    minimumFare: { type: Number, required: true, min: 0 },
    estimatedFare: { type: Number, required: true, min: 0 },

    finalFare: {
      type: Number,
      default: null,
      min: 0,
    },
  },
  { _id: false }
);

const statusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      required: true,
      enum: [
        "pending",
        "assigned",
        "accepted",
        "arriving_at_pickup",
        "arrived_at_pickup",
        "picked_up",
        "in_transit",
        "arrived_at_drop",
        "delivered",
        "cancelled",
      ],
    },

    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    note: {
      type: String,
      default: "",
      maxlength: 300,
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const bookingSchema = new mongoose.Schema(
  {
    bookingCode: {
      type: String,
      required: true,
      unique: true,
    },

    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    vehicle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
    },

    pickup: {
      type: locationSchema,
      required: true,
    },

    drop: {
      type: locationSchema,
      required: true,
    },

    package: {
      type: packageSchema,
      required: true,
    },

    route: {
      type: routeSchema,
      required: true,
    },

    fare: {
      type: fareSchema,
      required: true,
    },

    status: {
      type: String,
      enum: [
        "pending",
        "assigned",
        "accepted",
        "arriving_at_pickup",
        "arrived_at_pickup",
        "picked_up",
        "in_transit",
        "arrived_at_drop",
        "delivered",
        "cancelled",
      ],
      default: "pending",
      index: true,
    },

    paymentStatus: {
      type: String,
      enum: [
        "unpaid",
        "pending",
        "paid",
        "failed",
        "refunded",
      ],
      default: "unpaid",
    },

    statusHistory: {
      type: [statusHistorySchema],
      default: [],
    },

    cancelledAt: {
      type: Date,
      default: null,
    },

    cancellationReason: {
      type: String,
      default: "",
      maxlength: 500,
    },
  },
  {
    timestamps: true,
  }
);

bookingSchema.index({ customer: 1, createdAt: -1 });
bookingSchema.index({ driver: 1, status: 1, createdAt: -1 });

const Booking = mongoose.model("Booking", bookingSchema);

export default Booking;
