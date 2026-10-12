
import mongoose from "mongoose";

import connectDB from "../config/db.js";
import Vehicle from "../models/Vehicle.js";
import PricingRule from "../models/PricingRule.js";

const initialVehicles = [
  {
    name: "Mini Truck",
    slug: "mini-truck",
    description: "For small household moves and local deliveries.",
    capacityKg: 750,
    features: ["Local delivery", "Small shifting"],
    sortOrder: 1,
    pricing: {
      baseFare: 150,
      perKmRate: 18,
      perKgRate: 0.5,
      minimumFare: 200,
      serviceFee: 20,
    },
  },
  {
    name: "Pickup Truck",
    slug: "pickup-truck",
    description: "For medium-sized goods and business deliveries.",
    capacityKg: 1500,
    features: ["Business delivery", "Medium loads"],
    sortOrder: 2,
    pricing: {
      baseFare: 250,
      perKmRate: 24,
      perKgRate: 0.75,
      minimumFare: 300,
      serviceFee: 30,
    },
  },
  {
    name: "Large Truck",
    slug: "large-truck",
    description: "For heavy and bulk transportation.",
    capacityKg: 5000,
    features: ["Heavy goods", "Bulk transportation"],
    sortOrder: 3,
    pricing: {
      baseFare: 500,
      perKmRate: 35,
      perKgRate: 1,
      minimumFare: 600,
      serviceFee: 50,
    },
  },
];

async function seedVehicles() {
  try {
    await connectDB();

    for (const item of initialVehicles) {
      const { pricing, ...vehicleData } = item;

      const vehicle = await Vehicle.findOneAndUpdate(
        { slug: vehicleData.slug },
        { $set: vehicleData },
        {
          returnDocument: "after",
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        }
      );

      await PricingRule.findOneAndUpdate(
        { vehicle: vehicle._id },
        {
          $set: {
            vehicle: vehicle._id,
            ...pricing,
            isActive: true,
          },
        },
        {
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        }
      );

      console.log(`Seeded: ${vehicle.name}`);
    }

    console.log("Vehicle catalog seeding completed successfully.");
  } catch (error) {
    console.error("Vehicle seeding failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

seedVehicles();
