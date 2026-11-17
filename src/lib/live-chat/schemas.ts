import { z } from "zod"

import { isValidUuid } from "@/lib/residents/schemas"

export const CHAT_DEFAULT_PAGE_LIMIT = 30
export const CHAT_MAX_PAGE_LIMIT = 60
export const CHAT_MAX_IMAGE_BYTES = 5 * 1024 * 1024

export const chatUuidSchema = z
  .string()
  .trim()
  .refine(isValidUuid, "ID tidak valid.")

export const chatAttachmentSchema = z.object({
  path: z.string().trim().min(10).max(300),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size: z.number().int().min(1).max(CHAT_MAX_IMAGE_BYTES),
})

export const sendChatMessageSchema = z
  .object({
    roomId: chatUuidSchema,
    content: z
      .string()
      .trim()
      .max(2000, "Pesan maksimal 2.000 karakter."),
    clientMessageId: chatUuidSchema.optional(),
    replyToMessageId: chatUuidSchema.optional(),
    attachment: chatAttachmentSchema.optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.attachment && val.content.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content"],
        message: "Pesan tidak boleh kosong.",
      })
    }
  })

export const markChatReadSchema = z.object({
  roomId: chatUuidSchema,
  lastReadMessageId: chatUuidSchema.optional(),
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
