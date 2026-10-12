
import { z } from "zod";

export const createBookingSchema = z.object({
  pickupAddress: z
    .string()
    .trim()
    .min(3, "Enter a valid pickup address")
    .max(256, "Pickup address is too long"),

  dropAddress: z
    .string()
    .trim()
    .min(3, "Enter a valid drop address")
    .max(256, "Drop address is too long"),

  vehicleId: z
    .string()
    .regex(/^[a-f\d]{24}$/i, "Invalid vehicle ID"),

  weightKg: z.coerce
    .number()
    .finite()
    .min(0.1, "Package weight must be greater than zero")
    .max(5000, "Package weight exceeds the maximum"),

  packageDescription: z
    .string()
    .trim()
    .min(2, "Describe the package")
    .max(300, "Package description is too long"),

  specialInstructions: z
    .string()
    .trim()
    .max(500, "Special instructions are too long")
    .optional()
    .default(""),
});
