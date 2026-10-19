
import { z } from "zod";

const httpsUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          !url.username &&
          !url.password
        );
      } catch {
        return false;
      }
    },
    "A secure HTTPS URL is required"
  );

const optionalUrl = z
  .union([httpsUrlSchema, z.literal("")])
  .optional();

const optionalAssetId = z
  .string()
  .trim()
  .regex(/^[a-f\d]{24}$/i, "Invalid uploaded document asset ID")
  .optional();

const photosSchema = z.object({
  front: httpsUrlSchema,
  right: httpsUrlSchema,
  left: httpsUrlSchema,
  back: httpsUrlSchema,
});

const licenseFields = {
  licenseNumber: z
    .string()
    .trim()
    .min(5)
    .max(30)
    .regex(/^[A-Za-z0-9/-]+$/)
    .transform((value) => value.toUpperCase()),

  licenseExpiry: z.string().refine(
    (value) => {
      const date = new Date(value);
      return !Number.isNaN(date.getTime());
    },
    "Enter a valid licence expiry date"
  ),
};

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

  vehicleDocumentUrl: optionalUrl,
  vehicleDocumentAssetId: optionalAssetId,

  photos: photosSchema,
};

const documentsSchema = z
  .object({
    licenseDocumentUrl: optionalUrl,
    licenseDocumentAssetId: optionalAssetId,

    identityDocumentUrl: optionalUrl,
    identityDocumentAssetId: optionalAssetId,

    vehicleDocumentUrl: optionalUrl,
    vehicleDocumentAssetId: optionalAssetId,
  })
  .refine(
    (data) =>
      Boolean(
        data.licenseDocumentAssetId ||
          (data.licenseDocumentUrl &&
            data.licenseDocumentUrl.length > 0)
      ),
    {
      message: "Driving licence document is required",
      path: ["licenseDocumentAssetId"],
    }
  )
  .refine(
    (data) =>
      Boolean(
        data.identityDocumentAssetId ||
          (data.identityDocumentUrl &&
            data.identityDocumentUrl.length > 0)
      ),
    {
      message: "Identity document is required",
      path: ["identityDocumentAssetId"],
    }
  )
  .refine(
    (data) =>
      Boolean(
        data.vehicleDocumentAssetId ||
          (data.vehicleDocumentUrl &&
            data.vehicleDocumentUrl.length > 0)
      ),
    {
      message: "Vehicle registration document is required",
      path: ["vehicleDocumentAssetId"],
    }
  );

const profileChangeDocumentsSchema = z
  .object({
    licenseDocumentUrl: optionalUrl,
    licenseDocumentAssetId: optionalAssetId,

    identityDocumentUrl: optionalUrl,
    identityDocumentAssetId: optionalAssetId,
  })
  .refine(
    (data) =>
      Boolean(
        data.licenseDocumentAssetId ||
          (data.licenseDocumentUrl &&
            data.licenseDocumentUrl.length > 0)
      ),
    {
      message: "Driving licence document is required",
      path: ["licenseDocumentAssetId"],
    }
  )
  .refine(
    (data) =>
      Boolean(
        data.identityDocumentAssetId ||
          (data.identityDocumentUrl &&
            data.identityDocumentUrl.length > 0)
      ),
    {
      message: "Identity document is required",
      path: ["identityDocumentAssetId"],
    }
  );

const changeReasonSchema = z.string().trim().min(5).max(500);

export const driverProfileSchema = z.object({
  ...licenseFields,
  ...vehicleFields,
  documents: documentsSchema,
});

export const driverProfileChangeSchema = z.object({
  ...licenseFields,
  documents: profileChangeDocumentsSchema,
  reason: changeReasonSchema,
});

export const driverVehicleSchema = z
  .object(vehicleFields)
  .refine(
    (data) =>
      Boolean(
        data.vehicleDocumentAssetId ||
          (data.vehicleDocumentUrl && data.vehicleDocumentUrl.length > 0)
      ),
    {
      message: "Vehicle registration document is required",
      path: ["vehicleDocumentAssetId"],
    }
  );

export const driverVehicleChangeSchema = z.object({
  ...vehicleFields,
  reason: changeReasonSchema,
});

export const driverAvailabilitySchema = z.object({
  availability: z.enum(["online", "offline"]),
});

export const reviewDriverSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    rejectionReason: z.string().trim().max(500).optional().default(""),
  })
  .refine(
    (data) =>
      data.decision !== "reject" ||
      data.rejectionReason.trim().length >= 3,
    {
      message: "A rejection reason is required",
      path: ["rejectionReason"],
    }
  );

export const reviewChangeRequestSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    reviewNote: z.string().trim().max(500).optional().default(""),
  })
  .refine(
    (data) =>
      data.decision !== "reject" ||
      data.reviewNote.trim().length >= 3,
    {
      message: "A reason is required when rejecting a change request",
      path: ["reviewNote"],
    }
  );
