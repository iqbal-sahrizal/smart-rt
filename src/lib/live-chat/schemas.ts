import { z } from "zod"

import { isValidUuid } from "@/lib/residents/schemas"

export const CHAT_DEFAULT_PAGE_LIMIT = 30
export const CHAT_MAX_PAGE_LIMIT = 60

export const chatUuidSchema = z
  .string()
  .trim()
  .refine(isValidUuid, "ID tidak valid.")

export const sendChatMessageSchema = z.object({
  roomId: chatUuidSchema,
  content: z
    .string()
    .trim()
    .min(1, "Pesan tidak boleh kosong.")
    .max(2000, "Pesan maksimal 2.000 karakter."),
  clientMessageId: chatUuidSchema.optional(),
})

export const deleteOwnChatMessageSchema = z.object({
  messageId: chatUuidSchema,
})

export const moderateChatMessageSchema = z
  .object({
    messageId: chatUuidSchema,
    action: z.enum(["hide", "restore"]),
    reason: z
      .string()
      .trim()
      .max(500, "Alasan moderasi maksimal 500 karakter.")
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (val.action === "hide" && (!val.reason || val.reason.trim().length < 3)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "Alasan moderasi minimal 3 karakter saat menyembunyikan pesan.",
      })
    }
  })

export const chatHistoryQuerySchema = z.object({
  roomId: chatUuidSchema,
  before: z
    .string()
    .trim()
    .datetime({ offset: true })
    .optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(CHAT_MAX_PAGE_LIMIT)
    .default(CHAT_DEFAULT_PAGE_LIMIT),
})

