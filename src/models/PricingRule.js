import mongoose from "mongoose";

const pricingRuleSchema = new mongoose.Schema(
  {
    vehicle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
      unique: true,
    },

    baseFare: {
      type: Number,
      required: true,
      min: 0,
    },

    perKmRate: {
      type: Number,
      required: true,
      min: 0,
    },

    perKgRate: {
      type: Number,
      required: true,
      min: 0,
    },

    minimumFare: {
      type: Number,
      required: true,
      min: 0,
    },

    serviceFee: {
      type: Number,
      default: 0,
      min: 0,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

const PricingRule = mongoose.model(
  "PricingRule",
  pricingRuleSchema
);

export default PricingRule;