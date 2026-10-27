
import { z } from "zod";

export const estimateFareSchema = z.object({
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
    .regex(
      /^[a-f\d]{24}$/i,
      "A valid vehicle ID is required"
    ),

  weightKg: z.coerce
    .number()
    .finite()
    .min(0.1, "Weight must be greater than zero")
    .max(5000, "Maximum supported weight is 5000 kg"),

  pickupLocationToken: z.string().max(4096).optional(),
  dropLocationToken: z.string().max(4096).optional(),
});
