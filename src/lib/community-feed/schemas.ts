import { z } from "zod"

import {
  COMMUNITY_FEED_DEFAULT_LIMIT,
  COMMUNITY_FEED_MAX_LIMIT,
  COMMUNITY_COMMENT_DEFAULT_LIMIT,
  COMMUNITY_COMMENT_MAX_LIMIT,
  COMMUNITY_MODERATION_STATUSES,
  COMMUNITY_REPORT_CATEGORIES,
  COMMUNITY_REPORT_STATUSES,
  MAX_COMMUNITY_CAPTION_LENGTH,
  MAX_COMMUNITY_COMMENT_LENGTH,
  MAX_COMMUNITY_IMAGE_BYTES,
  MAX_COMMUNITY_MEDIA_COUNT,
  MAX_COMMUNITY_MODERATION_REASON_LENGTH,
  MAX_COMMUNITY_REPORT_DETAIL_LENGTH,
} from "@/lib/community-feed/constants"
import { isValidCommunityMediaPath } from "@/lib/community-feed/storage"
import { isValidUuid } from "@/lib/residents/schemas"

export const communityUuidSchema = z
  .string()
  .trim()
  .refine(isValidUuid, "Format ID tidak valid.")

export const communityMediaInputItemSchema = z.object({
  storagePath: z
    .string()
    .trim()
    .refine(isValidCommunityMediaPath, "Path media tidak valid."),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  fileSizeBytes: z
    .number()
    .int()
    .min(1, "Ukuran gambar minimal 1 byte.")
    .max(MAX_COMMUNITY_IMAGE_BYTES, "Ukuran gambar maksimal 5 MiB."),
})

export const createCommunityPostSchema = z
  .object({
    caption: z
      .string()
      .max(
        MAX_COMMUNITY_CAPTION_LENGTH,
        `Keterangan postingan maksimal ${MAX_COMMUNITY_CAPTION_LENGTH} karakter.`
      )
      .optional()
      .nullable()
      .transform((val) => {
        const trimmed = (val ?? "").trim()
        return trimmed.length > 0 ? trimmed : null
      }),
    mediaItems: z
      .array(communityMediaInputItemSchema)
      .max(
        MAX_COMMUNITY_MEDIA_COUNT,
        `Maksimal ${MAX_COMMUNITY_MEDIA_COUNT} gambar per postingan.`
      )
      .default([]),
  })
  .superRefine((data, ctx) => {
    if (!data.caption && data.mediaItems.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Tulis keterangan atau unggah minimal satu foto.",
        path: ["caption"],
      })
    }
  })

export const updateCommunityPostSchema = z
  .object({
    postId: communityUuidSchema,
    caption: z
      .string()
      .max(
        MAX_COMMUNITY_CAPTION_LENGTH,
        `Keterangan postingan maksimal ${MAX_COMMUNITY_CAPTION_LENGTH} karakter.`
      )
      .optional()
      .nullable()
      .transform((val) => {
        const trimmed = (val ?? "").trim()
        return trimmed.length > 0 ? trimmed : null
      }),
    keepMediaIds: z
      .array(communityUuidSchema)
      .max(MAX_COMMUNITY_MEDIA_COUNT)
      .optional(),
    newMediaItems: z
      .array(communityMediaInputItemSchema)
      .max(MAX_COMMUNITY_MEDIA_COUNT)
      .default([]),
  })
  .superRefine((data, ctx) => {
    const keepCount = data.keepMediaIds ? data.keepMediaIds.length : 1
    const newCount = data.newMediaItems.length
    if (data.keepMediaIds && keepCount + newCount > MAX_COMMUNITY_MEDIA_COUNT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Total gambar maksimal ${MAX_COMMUNITY_MEDIA_COUNT} per postingan.`,
        path: ["newMediaItems"],
      })
    }
    if (data.keepMediaIds && keepCount === 0 && newCount === 0 && !data.caption) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Postingan tidak boleh kosong tanpa keterangan dan gambar.",
        path: ["caption"],
      })
    }
  })

export const toggleLikeSchema = z.object({
  postId: communityUuidSchema,
  desiredLiked: z.boolean().optional(),
})

export const createCommentSchema = z.object({
  postId: communityUuidSchema,
  content: z
    .string()
    .trim()
    .min(1, "Komentar tidak boleh kosong.")
    .max(
      MAX_COMMUNITY_COMMENT_LENGTH,
      `Komentar maksimal ${MAX_COMMUNITY_COMMENT_LENGTH} karakter.`
    ),
  parentCommentId: communityUuidSchema.optional().nullable(),
})

export const updateCommentSchema = z.object({
  commentId: communityUuidSchema,
  content: z
    .string()
    .trim()
    .min(1, "Komentar tidak boleh kosong.")
    .max(
      MAX_COMMUNITY_COMMENT_LENGTH,
      `Komentar maksimal ${MAX_COMMUNITY_COMMENT_LENGTH} karakter.`
    ),
})

export const reportContentSchema = z.object({
  targetType: z.enum(["post", "comment"]),
  targetId: communityUuidSchema,
  reasonCategory: z.enum(COMMUNITY_REPORT_CATEGORIES),
  reasonDetail: z
    .string()
    .max(
      MAX_COMMUNITY_REPORT_DETAIL_LENGTH,
      `Detail laporan maksimal ${MAX_COMMUNITY_REPORT_DETAIL_LENGTH} karakter.`
    )
    .optional()
    .nullable()
    .transform((val) => {
      const trimmed = (val ?? "").trim()
      return trimmed.length > 0 ? trimmed : null
    }),
})

export const moderateContentSchema = z
  .object({
    targetType: z.enum(["post", "comment"]),
    targetId: communityUuidSchema,
    action: z.enum(["hide", "restore"]),
    reason: z
      .string()
      .max(
        MAX_COMMUNITY_MODERATION_REASON_LENGTH,
        `Alasan moderasi maksimal ${MAX_COMMUNITY_MODERATION_REASON_LENGTH} karakter.`
      )
      .optional()
      .nullable()
      .transform((val) => {
        const trimmed = (val ?? "").trim()
        return trimmed.length > 0 ? trimmed : null
      }),
    reportId: communityUuidSchema.optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.action === "hide" && (!data.reason || data.reason.length < 3)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Alasan moderasi minimal 3 karakter saat menyembunyikan konten.",
        path: ["reason"],
      })
    }
  })

export const dismissReportSchema = z.object({
  reportId: communityUuidSchema,
  resolutionNote: z
    .string()
    .max(
      MAX_COMMUNITY_MODERATION_REASON_LENGTH,
      `Catatan resolusi maksimal ${MAX_COMMUNITY_MODERATION_REASON_LENGTH} karakter.`
    )
    .optional()
    .nullable()
    .transform((val) => {
      const trimmed = (val ?? "").trim()
      return trimmed.length > 0 ? trimmed : null
    }),
})

export const isoCursorRegex =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/

export const feedListQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(COMMUNITY_FEED_MAX_LIMIT)
    .default(COMMUNITY_FEED_DEFAULT_LIMIT),
  cursorCreatedAt: z
    .string()
    .trim()
    .regex(isoCursorRegex, "Format cursor waktu tidak valid.")
    .optional(),
  cursorId: communityUuidSchema.optional(),
})

export const commentsListQuerySchema = z.object({
  postId: communityUuidSchema,
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(COMMUNITY_COMMENT_MAX_LIMIT)
    .default(COMMUNITY_COMMENT_DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).max(5000).default(0),
})

export const adminModerationQuerySchema = z.object({
  reportStatus: z
    .enum(["all", ...COMMUNITY_REPORT_STATUSES])
    .default("pending"),
  postStatus: z
    .enum(["all", ...COMMUNITY_MODERATION_STATUSES])
    .default("all"),
})

export const cleanupMediaPathsSchema = z.object({
  paths: z
    .array(
      z
        .string()
        .trim()
        .refine(isValidCommunityMediaPath, "Path media tidak valid.")
    )
    .max(10),
})

export type CreateCommunityPostInput = z.infer<typeof createCommunityPostSchema>
export type UpdateCommunityPostInput = z.infer<typeof updateCommunityPostSchema>
export type ToggleCommunityPostLikeInput = z.infer<typeof toggleLikeSchema>
export type CreateCommunityCommentInput = z.infer<typeof createCommentSchema>
export type UpdateCommunityCommentInput = z.infer<typeof updateCommentSchema>
export type ReportCommunityContentInput = z.infer<typeof reportContentSchema>
export type ModerateCommunityContentInput = z.infer<
  typeof moderateContentSchema
>
export type DismissCommunityReportInput = z.infer<typeof dismissReportSchema>

