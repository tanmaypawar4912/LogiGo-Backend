
import { z } from "zod";

const bookingStatuses = [
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
];

export const createBookingSchema = z.object({
  pickupAddress: z
    .string()
    .trim()
    .min(3, "Enter a valid pickup address")
    .max(256),

  dropAddress: z
    .string()
    .trim()
    .min(3, "Enter a valid drop address")
    .max(256),

  vehicleId: z
    .string()
    .regex(/^[a-f\d]{24}$/i, "Invalid vehicle ID"),

  weightKg: z.coerce
    .number()
    .finite()
    .min(0.1)
    .max(5000),

  packageDescription: z
    .string()
    .trim()
    .min(2)
    .max(300),

  specialInstructions: z
    .string()
    .trim()
    .max(500)
    .optional()
    .default(""),
});

export const assignDriverSchema = z.object({
  driverUserId: z
    .string()
    .regex(/^[a-f\d]{24}$/i, "Invalid driver user ID"),
});

export const driverResponseSchema = z
  .object({
    action: z.enum(["accept", "reject"]),
    rejectionReason: z
      .string()
      .trim()
      .max(500)
      .optional()
      .default(""),
  })
  .refine(
    (data) =>
      data.action !== "reject" ||
      data.rejectionReason.length >= 3,
    {
      message: "Provide a reason when rejecting a job",
      path: ["rejectionReason"],
    }
  );

export const updateDeliveryStatusSchema = z.object({
  status: z.enum(bookingStatuses),
});
