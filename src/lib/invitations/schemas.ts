import { z } from "zod"

import { isValidUuid } from "@/lib/residents/schemas"

export const createInvitationSchema = z.object({
  residentId: z
    .string()
    .trim()
    .refine(isValidUuid, "ID warga tidak valid."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Masukkan alamat email yang valid.")
    .max(254, "Email terlalu panjang."),
  expiresInHours: z.coerce
    .number()
    .int("Masa berlaku harus berupa bilangan bulat jam.")
    .min(1, "Masa berlaku minimal 1 jam.")
    .max(720, "Masa berlaku maksimal 720 jam (30 hari).")
    .default(168),
})

export const resendInvitationSchema = z.object({
  invitationId: z
    .string()
    .trim()
    .refine(isValidUuid, "ID undangan tidak valid."),
  email: z
    .union([
      z.literal(""),
      z
        .string()
        .trim()
        .toLowerCase()
        .email("Masukkan alamat email yang valid.")
        .max(254, "Email terlalu panjang."),
    ])
    .optional()
    .transform((value) => (value ? value : undefined)),
  expiresInHours: z.coerce
    .number()
    .int("Masa berlaku harus berupa bilangan bulat jam.")
    .min(1, "Masa berlaku minimal 1 jam.")
    .max(720, "Masa berlaku maksimal 720 jam (30 hari).")
    .default(168),
})

export const revokeInvitationSchema = z.object({
  invitationId: z
    .string()
    .trim()
    .refine(isValidUuid, "ID undangan tidak valid."),
})

export const invitationTokenSchema = z
  .string()
  .trim()
  .min(32, "Token undangan tidak valid.")
  .max(128, "Token undangan tidak valid.")

export const redeemNewPasswordSchema = z
  .object({
    token: invitationTokenSchema,
    password: z
      .string()
      .min(8, "Kata sandi minimal 8 karakter.")
      .max(72, "Kata sandi maksimal 72 karakter."),
    confirmPassword: z.string().min(1, "Konfirmasi kata sandi wajib diisi."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Konfirmasi kata sandi tidak cocok.",
    path: ["confirmPassword"],
  })

export const redeemSignedInSchema = z.object({
  token: invitationTokenSchema,
})

