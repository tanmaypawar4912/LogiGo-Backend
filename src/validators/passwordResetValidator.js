import { z } from "zod";

export const requestPasswordResetSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .max(254)
    .transform((value) => value.toLowerCase()),
});

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(64).max(200),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be no more than 128 characters"),
});
