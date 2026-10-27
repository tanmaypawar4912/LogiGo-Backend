import mongoose from "mongoose";

const driverLocationSchema = new mongoose.Schema(
  {
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
    },
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    latitude: { type: Number, required: true, min: -90, max: 90 },
    longitude: { type: Number, required: true, min: -180, max: 180 },
    accuracyMeters: { type: Number, default: null, min: 0, max: 100000 },
    headingDegrees: { type: Number, default: null, min: 0, max: 360 },
    speedMetersPerSecond: { type: Number, default: null, min: 0, max: 100 },
    capturedAt: { type: Date, required: true, default: Date.now },
    // Only the latest point is kept. MongoDB removes it after sharing stops
    // and the five-minute safety TTL expires.
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 },
    },
  },
  { timestamps: true, versionKey: false }
);

driverLocationSchema.index({ booking: 1 }, { unique: true });

const DriverLocation = mongoose.model("DriverLocation", driverLocationSchema);
export default DriverLocation;
