
import Vehicle from "../models/Vehicle.js";
import PricingRule from "../models/PricingRule.js";

import {
  geocodeAddress,
  getDrivingRoute,
} from "./mapboxService.js";

const roundMoney = (amount) =>
  Math.round((amount + Number.EPSILON) * 100) / 100;

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export async function calculateFareEstimate({
  pickupAddress,
  dropAddress,
  vehicleId,
  weightKg,
}) {
  const vehicle = await Vehicle.findOne({
    _id: vehicleId,
    isActive: true,
  }).lean();

  if (!vehicle) {
    throw createError("Vehicle not found or unavailable.", 404);
  }

  const pricing = await PricingRule.findOne({
    vehicle: vehicle._id,
    isActive: true,
  }).lean();

  if (!pricing) {
    throw createError(
      "Pricing is unavailable for this vehicle.",
      422
    );
  }

  if (weightKg > vehicle.capacityKg) {
    throw createError(
      `This vehicle supports up to ${vehicle.capacityKg} kg.`,
      422
    );
  }

  const [pickup, drop] = await Promise.all([
    geocodeAddress(pickupAddress),
    geocodeAddress(dropAddress),
  ]);

  const route = await getDrivingRoute(pickup, drop);

  const distanceCharge =
    route.distanceKm * pricing.perKmRate;

  const weightCharge =
    weightKg * pricing.perKgRate;

  const serviceFee = pricing.serviceFee || 0;

  const subtotal = roundMoney(
    pricing.baseFare +
      distanceCharge +
      weightCharge +
      serviceFee
  );

  const estimatedFare = roundMoney(
    Math.max(subtotal, pricing.minimumFare)
  );

  return {
    route: {
      pickup: {
        address: pickup.resolvedAddress,
        longitude: pickup.longitude,
        latitude: pickup.latitude,
      },

      drop: {
        address: drop.resolvedAddress,
        longitude: drop.longitude,
        latitude: drop.latitude,
      },

      distanceMeters: route.distanceMeters,
      distanceKm: route.distanceKm,
      durationSeconds: route.durationSeconds,
      durationMinutes: route.durationMinutes,
    },

    vehicle: {
      id: vehicle._id.toString(),
      name: vehicle.name,
      capacityKg: vehicle.capacityKg,
    },

    package: {
      weightKg,
    },

    fare: {
      currency: "INR",
      baseFare: pricing.baseFare,
      perKmRate: pricing.perKmRate,
      perKgRate: pricing.perKgRate,
      distanceCharge: roundMoney(distanceCharge),
      weightCharge: roundMoney(weightCharge),
      serviceFee,
      subtotal,
      minimumFare: pricing.minimumFare,
      estimatedFare,
    },
  };
}
