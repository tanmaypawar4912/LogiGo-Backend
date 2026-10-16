
import { z } from "zod";

const httpsUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "A secure HTTPS URL is required");

const vehiclePhotosSchema = z.object({
  front: httpsUrlSchema,
  right: httpsUrlSchema,
  left: httpsUrlSchema,
  back: httpsUrlSchema,
});

const documentUrlSchema = httpsUrlSchema;

const vehicleFields = {
  vehicleType: z.string().trim().min(1).max(80),
  vehicleMakeModel: z.string().trim().min(2).max(100),
  vehicleRegistration: z
    .string()
    .trim()
    .min(4)
    .max(30)
    .regex(/^[A-Za-z0-9 -]+$/)
    .transform((value) => value.toUpperCase()),
  vehicleCapacityKg: z.coerce.number().int().min(1).max(50000),
  vehicleDocumentUrl: documentUrlSchema,
  photos: vehiclePhotosSchema,
};

export const driverProfileSchema = z.object({
  licenseNumber: z
    .string()
    .trim()
    .min(5)
    .max(30)
    .regex(/^[A-Za-z0-9/-]+$/)
    .transform((value) => value.toUpperCase()),
  licenseExpiry: z
    .string()
    .refine(
      (value) => !Number.isNaN(Date.parse(value)),
      "Enter a valid license expiry date"
    ),
  ...vehicleFields,
  documents: z.object({
    licenseDocumentUrl: documentUrlSchema,
    identityDocumentUrl: documentUrlSchema,
    vehicleDocumentUrl: documentUrlSchema.optional(),
  }),
});

export const driverProfileChangeSchema = z.object({
  licenseNumber: z
    .string()
    .trim()
    .min(5)
    .max(30)
    .regex(/^[A-Za-z0-9/-]+$/)
    .transform((value) => value.toUpperCase()),
  licenseExpiry: z
    .string()
    .refine(
      (value) => !Number.isNaN(Date.parse(value)),
      "Enter a valid license expiry date"
    ),
  documents: z.object({
    licenseDocumentUrl: documentUrlSchema,
    identityDocumentUrl: documentUrlSchema,
  }),
  reason: z.string().trim().min(5).max(500),
});

export const driverVehicleSchema = z.object(vehicleFields);

export const driverVehicleChangeSchema = z.object({
  ...vehicleFields,
  reason: z.string().trim().min(5).max(500),
});

export const driverAvailabilitySchema = z.object({
  availability: z.enum(["online", "offline"]),
});

export const reviewDriverSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  rejectionReason: z.string().trim().max(500).optional().default(""),
}).refine(
  (data) =>
    data.decision !== "reject" ||
    data.rejectionReason.trim().length >= 3,
  {
    message: "A rejection reason is required",
    path: ["rejectionReason"],
  }
);

export const reviewChangeRequestSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reviewNote: z.string().trim().max(500).optional().default(""),
}).refine(
  (data) =>
    data.decision !== "reject" ||
    data.reviewNote.trim().length >= 3,
  {
    message: "A reason is required when rejecting a change request",
    path: ["reviewNote"],
  }
);
