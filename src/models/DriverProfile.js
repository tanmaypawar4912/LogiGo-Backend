
import mongoose from "mongoose";

const mediaAssetIdField = {
  type: mongoose.Schema.Types.ObjectId,
  ref: "DriverMediaAsset",
  default: null,
};

const vehiclePhotosSchema = new mongoose.Schema(
  {
    front: { type: String, trim: true, default: "" },
    right: { type: String, trim: true, default: "" },
    left: { type: String, trim: true, default: "" },
    back: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const profileChangeRequestSchema = new mongoose.Schema(
  {
    licenseNumber: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 30,
    },
    licenseExpiry: { type: Date },
    documents: {
      licenseDocumentUrl: { type: String, default: null },
      identityDocumentUrl: { type: String, default: null },

      // Private Cloudinary asset references
      licenseDocumentAssetId: mediaAssetIdField,
      identityDocumentAssetId: mediaAssetIdField,
    },
    reason: {
      type: String,
      trim: true,
      maxlength: 500,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    requestedAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date, default: null },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewNote: { type: String, default: "", maxlength: 500 },
  },
  { _id: false }
);

const vehicleChangeRequestSchema = new mongoose.Schema(
  {
    vehicleType: {
      type: String,
      trim: true,
      required: true,
    },
    vehicleMakeModel: {
      type: String,
      trim: true,
      required: true,
      maxlength: 100,
    },
    vehicleRegistration: {
      type: String,
      trim: true,
      uppercase: true,
      required: true,
      maxlength: 30,
    },
    vehicleCapacityKg: {
      type: Number,
      required: true,
      min: 1,
      max: 50000,
    },
    vehicleDocumentUrl: {
      type: String,
      trim: true,
      default: "",
    },

    // Private Cloudinary asset reference
    vehicleDocumentAssetId: mediaAssetIdField,

    photos: {
      type: vehiclePhotosSchema,
      required: true,
    },
    reason: {
      type: String,
      trim: true,
      required: true,
      maxlength: 500,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    requestedAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date, default: null },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewNote: { type: String, default: "", maxlength: 500 },
  },
  { _id: false }
);

const registeredVehicleSchema = new mongoose.Schema(
  {
    vehicleType: {
      type: String,
      trim: true,
      required: true,
      maxlength: 80,
    },
    vehicleMakeModel: {
      type: String,
      trim: true,
      required: true,
      maxlength: 100,
    },
    vehicleRegistration: {
      type: String,
      trim: true,
      uppercase: true,
      required: true,
      maxlength: 30,
    },
    vehicleCapacityKg: {
      type: Number,
      required: true,
      min: 1,
      max: 50000,
    },
    vehicleDocumentUrl: {
      type: String,
      trim: true,
      default: "",
    },

    // Private Cloudinary asset reference
    vehicleDocumentAssetId: mediaAssetIdField,

    photos: {
      type: vehiclePhotosSchema,
      required: true,
    },
    approvalStatus: {
      type: String,
      enum: ["pending", "approved", "rejected", "suspended"],
      default: "pending",
      index: true,
    },
    isPrimary: { type: Boolean, default: false },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    approvedAt: { type: Date, default: null },
    rejectionReason: {
      type: String,
      default: "",
      maxlength: 500,
    },
    changeRequest: {
      type: vehicleChangeRequestSchema,
      default: null,
    },
  },
  { timestamps: true }
);

const driverProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    licenseNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 30,
    },
    licenseExpiry: {
      type: Date,
      required: true,
    },

    // Vehicle categories are managed by the dynamic Vehicle catalogue.
    vehicleType: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    vehicleMakeModel: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    vehicleRegistration: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 30,
    },
    vehicleCapacityKg: {
      type: Number,
      required: true,
      min: 1,
      max: 50000,
    },
    documents: {
      // Existing URL fields retained for compatibility.
      licenseDocumentUrl: {
        type: String,
        default: null,
      },
      identityDocumentUrl: {
        type: String,
        default: null,
      },
      vehicleDocumentUrl: {
        type: String,
        default: null,
      },

      // Private Cloudinary asset references.
      licenseDocumentAssetId: mediaAssetIdField,
      identityDocumentAssetId: mediaAssetIdField,
      vehicleDocumentAssetId: mediaAssetIdField,
    },
    vehiclePhotos: {
      type: vehiclePhotosSchema,
      default: undefined,
    },
    registeredVehicles: {
      type: [registeredVehicleSchema],
      default: [],
    },
    profileChangeRequest: {
      type: profileChangeRequestSchema,
      default: null,
    },
    approvalStatus: {
      type: String,
      enum: ["pending", "approved", "rejected", "suspended"],
      default: "pending",
      index: true,
    },
    availability: {
      type: String,
      enum: ["offline", "online", "busy"],
      default: "offline",
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: "",
      maxlength: 500,
    },
  },
  { timestamps: true }
);

driverProfileSchema.index({
  approvalStatus: 1,
  availability: 1,
});

driverProfileSchema.index({
  "registeredVehicles.vehicleRegistration": 1,
});

const DriverProfile = mongoose.model(
  "DriverProfile",
  driverProfileSchema
);

export default DriverProfile;
