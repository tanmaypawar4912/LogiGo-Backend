import mongoose from "mongoose";
import { randomBytes } from "node:crypto";

const enterpriseEnquirySchema = new mongoose.Schema(
  {
    enquiryCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    contactName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      index: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      maxlength: 25,
    },
    companyName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120,
      index: true,
    },
    city: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    monthlyShipmentVolume: {
      type: String,
      required: true,
      enum: ["1-50", "51-200", "201-1000", "1000+"],
    },
    services: {
      type: [{
        type: String,
        enum: [
          "local_delivery",
          "intercity_transport",
          "bulk_logistics",
          "scheduled_deliveries",
          "multi_location",
        ],
      }],
      required: true,
      validate: {
        validator: (values) => Array.isArray(values) && values.length > 0 && values.length <= 5,
        message: "Select at least one business service.",
      },
    },
    message: {
      type: String,
      trim: true,
      required: true,
      minlength: 10,
      maxlength: 2000,
    },
    status: {
      type: String,
      enum: ["new", "contacted", "qualified", "closed"],
      default: "new",
      index: true,
    },
    adminNotes: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },
    source: {
      type: String,
      enum: ["website"],
      default: "website",
    },
  },
  { timestamps: true }
);

enterpriseEnquirySchema.pre("validate", function setEnquiryCode() {
  if (!this.enquiryCode) {
    const timePart = Date.now().toString(36).toUpperCase();
    const randomPart = randomBytes(3).toString("hex").toUpperCase();
    this.enquiryCode = `LG-BIZ-${timePart}-${randomPart}`;
  }
});

enterpriseEnquirySchema.index({ status: 1, createdAt: -1 });
enterpriseEnquirySchema.index({ email: 1, createdAt: -1 });

const EnterpriseEnquiry = mongoose.model(
  "EnterpriseEnquiry",
  enterpriseEnquirySchema
);

export default EnterpriseEnquiry;
