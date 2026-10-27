import { z } from "zod";

const serviceOptions = [
  "local_delivery",
  "intercity_transport",
  "bulk_logistics",
  "scheduled_deliveries",
  "multi_location",
];

const volumeOptions = ["1-50", "51-200", "201-1000", "1000+"];

export const createEnterpriseEnquirySchema = z.object({
  contactName: z.string().trim().min(2, "Enter your full name").max(80),
  email: z.string().trim().email("Enter a valid work email").max(254).transform((value) => value.toLowerCase()),
  phone: z.string().trim().min(10, "Enter a valid phone number").max(25).refine(
    (value) => value.replace(/\D/g, "").length >= 10 && value.replace(/\D/g, "").length <= 15,
    "Phone number must contain 10 to 15 digits"
  ),
  companyName: z.string().trim().min(2, "Enter your company name").max(120),
  city: z.string().trim().min(2, "Enter your operating city").max(80),
  monthlyShipmentVolume: z.enum(volumeOptions),
  services: z.array(z.enum(serviceOptions)).min(1, "Select at least one service").max(5),
  message: z.string().trim().min(10, "Add at least 10 characters about your requirements").max(2000),
}).strict();

export const updateEnterpriseEnquirySchema = z.object({
  status: z.enum(["new", "contacted", "qualified", "closed"]).optional(),
  adminNotes: z.string().trim().max(2000).optional(),
}).strict().refine(
  (value) => value.status !== undefined || value.adminNotes !== undefined,
  "Provide a status or admin note to update"
);

export const enterpriseServiceOptions = serviceOptions;
export const enterpriseVolumeOptions = volumeOptions;
