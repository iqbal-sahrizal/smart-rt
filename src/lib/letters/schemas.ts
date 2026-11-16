import { z } from "zod"

import {
  LETTER_DEFAULT_PAGE_SIZE,
  LETTER_MAX_PAGE_SIZE,
  LETTER_REVIEW_DECISIONS,
  LETTER_SORT_DIRECTIONS,
  LETTER_SORT_FIELDS,
  LETTER_STATUSES,
  MAX_LETTER_PURPOSE_LENGTH,
  MAX_LETTER_REQUIRED_DOCS_ITEMS,
  MAX_LETTER_TYPE_CODE_LENGTH,
  MAX_LETTER_TYPE_DESCRIPTION_LENGTH,
  MAX_LETTER_TYPE_NAME_LENGTH,
} from "@/lib/letters/constants"
import { isValidUuid } from "@/lib/residents/schemas"

export const letterUuidSchema = z
  .string()
  .trim()
  .refine((val) => isValidUuid(val), "Format ID tidak valid.")

export const letterRequestStatusSchema = z.enum(LETTER_STATUSES, {
  error: "Status permohonan surat tidak valid.",
})

export const letterReviewDecisionSchema = z.enum(LETTER_REVIEW_DECISIONS, {
  error: "Keputusan peninjauan harus Ditinjau, Disetujui, atau Ditolak.",
})

export const letterPurposeSchema = z
  .string()
  .trim()
  .min(1, "Keperluan pengajuan surat wajib diisi.")
  .max(
    MAX_LETTER_PURPOSE_LENGTH,
    `Keperluan pengajuan surat maksimal ${MAX_LETTER_PURPOSE_LENGTH} karakter.`
  )

export const createLetterRequestSchema = z.object({
  letterTypeId: letterUuidSchema,
  purpose: letterPurposeSchema,
})

function optionalNullableTrimmedNote(max: number, label: string) {
  return z
    .union([z.string(), z.null()])
    .optional()
    .transform((val) => {
      if (typeof val !== "string") return null
      const trimmed = val.trim()
      return trimmed.length > 0 ? trimmed : null
    })
    .refine(
      (val) => val === null || val.length <= max,
      `${label} maksimal ${max} karakter.`
    )
}

export const removeLetterSupportingDocSchema = z.object({
  requestId: letterUuidSchema,
  fileId: letterUuidSchema,
  reason: z
    .union([z.string(), z.null()])
    .optional()
    .transform((val) => {
      if (typeof val !== "string") return "user_requested"
      const trimmed = val.trim()
      return trimmed.length > 0 ? trimmed : "user_requested"
    })
    .refine(
      (val) => val.length <= 300,
      "Alasan penghapusan lampiran maksimal 300 karakter."
    ),
})

export const cancelLetterRequestSchema = z.object({
  requestId: letterUuidSchema,
  reason: optionalNullableTrimmedNote(500, "Alasan pembatalan"),
})

export const reviewLetterRequestSchema = z
  .object({
    requestId: letterUuidSchema,
    decision: letterReviewDecisionSchema,
    adminNotes: optionalNullableTrimmedNote(500, "Catatan pengurus"),
  })
  .superRefine((val, ctx) => {
    if (val.decision === "rejected" && !val.adminNotes) {
      ctx.addIssue({
        code: "custom",
        path: ["adminNotes"],
        message: "Alasan penolakan wajib diisi saat menolak permohonan surat.",
      })
    }
  })

const letterTypeCodeSchema = z
  .string()
  .trim()
  .min(1, "Kode jenis surat wajib diisi.")
  .max(
    MAX_LETTER_TYPE_CODE_LENGTH,
    `Kode jenis surat maksimal ${MAX_LETTER_TYPE_CODE_LENGTH} karakter.`
  )
  .refine(
    (val) => /[A-Za-z0-9]/.test(val),
    "Kode jenis surat harus mengandung minimal satu huruf atau angka."
  )

const letterTypeNameSchema = z
  .string()
  .trim()
  .min(1, "Nama jenis surat wajib diisi.")
  .max(
    MAX_LETTER_TYPE_NAME_LENGTH,
    `Nama jenis surat maksimal ${MAX_LETTER_TYPE_NAME_LENGTH} karakter.`
  )

const letterTypeRequiredDocsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, "Nama syarat dokumen tidak boleh kosong.")
      .max(100, "Nama syarat dokumen maksimal 100 karakter.")
  )
  .max(
    MAX_LETTER_REQUIRED_DOCS_ITEMS,
    `Maksimal ${MAX_LETTER_REQUIRED_DOCS_ITEMS} syarat dokumen per jenis surat.`
  )
  .default([])

export const createLetterTypeSchema = z.object({
  code: letterTypeCodeSchema,
  name: letterTypeNameSchema,
  description: optionalNullableTrimmedNote(
    MAX_LETTER_TYPE_DESCRIPTION_LENGTH,
    "Deskripsi jenis surat"
  ),
  requiredDocuments: letterTypeRequiredDocsSchema,
  isActive: z.boolean().default(true),
})

export const updateLetterTypeSchema = z.object({
  letterTypeId: letterUuidSchema,
  code: letterTypeCodeSchema,
  name: letterTypeNameSchema,
  description: optionalNullableTrimmedNote(
    MAX_LETTER_TYPE_DESCRIPTION_LENGTH,
    "Deskripsi jenis surat"
  ),
  requiredDocuments: letterTypeRequiredDocsSchema,
  isActive: z.boolean(),
})

export const deleteLetterTypeSchema = z.object({
  letterTypeId: letterUuidSchema,
})

export function sanitizeLetterSearchTerm(input?: string): string {
  if (!input) return ""
  return input
    .trim()
    .replace(/[,()%*_\\]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80)
}

export const letterListFiltersSchema = z.object({
  status: letterRequestStatusSchema.optional(),
  letterTypeId: letterUuidSchema.optional(),
  search: z
    .string()
    .optional()
    .transform((val) => {
      const cleaned = sanitizeLetterSearchTerm(val)
      return cleaned.length > 0 ? cleaned : undefined
    }),
  page: z.coerce
    .number()
    .int("Halaman harus bilangan bulat.")
    .min(1, "Halaman minimal 1.")
    .default(1),
  pageSize: z.coerce
    .number()
    .int("Ukuran halaman harus bilangan bulat.")
    .min(1, "Ukuran halaman minimal 1.")
    .max(
      LETTER_MAX_PAGE_SIZE,
      `Ukuran halaman maksimal ${LETTER_MAX_PAGE_SIZE}.`
    )
    .default(LETTER_DEFAULT_PAGE_SIZE),
  sortBy: z.enum(LETTER_SORT_FIELDS).default("created_at"),
  sort: z.enum(LETTER_SORT_DIRECTIONS).default("desc"),
})

