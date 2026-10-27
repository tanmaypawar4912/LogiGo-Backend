
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


const dispatchOfferSchema = new mongoose.Schema(
  {
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["offered", "accepted", "rejected", "expired", "lost"],
      default: "offered",
    },
    offeredAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    respondedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: "", maxlength: 500 },
  },
  { _id: false }
);

const dispatchSchema = new mongoose.Schema(
  {
    mode: {
      type: String,
      enum: ["automatic", "manual"],
      default: "automatic",
    },
    status: {
      type: String,
      enum: ["searching", "offering", "accepted", "exhausted", "cancelled"],
      default: "searching",
      index: true,
    },
    offers: { type: [dispatchOfferSchema], default: [] },
    attemptCount: { type: Number, default: 0, min: 0 },
    lastAttemptAt: { type: Date, default: null },
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    lockedAt: { type: Date, default: null },
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

    // Automatic dispatch offers are durable and atomic. A driver is assigned
    // only when one eligible offered driver accepts the booking.
    dispatch: {
      type: dispatchSchema,
      default: () => ({ mode: "automatic", status: "searching" }),
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
bookingSchema.index({ status: 1, driver: 1, "dispatch.status": 1, "dispatch.nextAttemptAt": 1 });
bookingSchema.index({ "dispatch.offers.driver": 1, "dispatch.offers.status": 1, status: 1 });

const Booking = mongoose.model("Booking", bookingSchema);

export default Booking;
