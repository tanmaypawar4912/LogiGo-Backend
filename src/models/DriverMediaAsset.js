import mongoose from "mongoose";

const driverMediaAssetSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    driverProfile: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DriverProfile",
      default: null,
    },
    kind: {
      type: String,
      enum: [
        "vehicle-photo",
        "license-document",
        "identity-document",
        "vehicle-document",
      ],
      required: true,
      index: true,
    },
    view: {
      type: String,
      enum: ["front", "right", "left", "back", null],
      default: null,
    },
    cloudinaryAssetId: {
      type: String,
      required: true,
      unique: true,
    },
    publicId: {
      type: String,
      required: true,
      index: true,
    },
    resourceType: {
      type: String,
      enum: ["image", "raw"],
      required: true,
    },
    deliveryType: {
      type: String,
      enum: ["upload", "authenticated"],
      required: true,
    },
    secureUrl: {
      type: String,
      required: true,
    },
    format: {
      type: String,
      required: true,
    },
    bytes: {
      type: Number,
      required: true,
      min: 0,
    },
    width: {
      type: Number,
      default: null,
    },
    height: {
      type: Number,
      default: null,
    },
    originalFilename: {
      type: String,
      trim: true,
      maxlength: 200,
      default: "",
    },
    status: {
      type: String,
      enum: ["uploaded", "linked", "deleted"],
      default: "uploaded",
      index: true,
    },
  },
  { timestamps: true }
);

driverMediaAssetSchema.index({
  owner: 1,
  createdAt: -1,
});

driverMediaAssetSchema.index({
  owner: 1,
  kind: 1,
  view: 1,
  status: 1,
});

export default mongoose.model(
  "DriverMediaAsset",
  driverMediaAssetSchema
);