import { z } from "zod"

import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_DEFAULT_PAGE_SIZE,
  ACTIVITY_MANUAL_PARTICIPANT_STATUSES,
  ACTIVITY_MAX_PAGE_SIZE,
  ACTIVITY_PARTICIPANT_STATUSES,
  ACTIVITY_SORT_DIRECTIONS,
  ACTIVITY_SORT_FIELDS,
  ACTIVITY_STATUSES,
  MAX_ACTIVITY_DESCRIPTION_LENGTH,
  MAX_ACTIVITY_LOCATION_LENGTH,
  MAX_ACTIVITY_NOTES_LENGTH,
  MAX_ACTIVITY_REASON_LENGTH,
  MAX_ACTIVITY_TITLE_LENGTH,
} from "@/lib/activities/constants"
import { isValidUuid } from "@/lib/residents/schemas"

export const activityUuidSchema = z
  .string()
  .trim()
  .refine((val) => isValidUuid(val), "Format ID tidak valid.")

export const activityCategorySchema = z.enum(ACTIVITY_CATEGORIES, {
  error: "Kategori kegiatan tidak valid.",
})

export const activityStatusSchema = z.enum(ACTIVITY_STATUSES, {
  error: "Status kegiatan tidak valid.",
})

export const activityTransitionTargetSchema = z.enum(
  ["ongoing", "completed", "cancelled"],
  {
    error: "Status tujuan harus Berlangsung, Selesai, atau Dibatalkan.",
  }
)

export const activityParticipantStatusSchema = z.enum(
  ACTIVITY_PARTICIPANT_STATUSES,
  {
    error: "Status peserta kegiatan tidak valid.",
  }
)

export const activityManualParticipantStatusSchema = z.enum(
  ACTIVITY_MANUAL_PARTICIPANT_STATUSES,
  {
    error: "Status pendaftaran manual harus Diundang atau Terdaftar.",
  }
)

function optionalNullableTrimmedText(max: number, label: string) {
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

const isoDatetimeSchema = z
  .string()
  .trim()
  .min(1, "Tanggal dan waktu wajib diisi.")
  .refine(
    (val) => !Number.isNaN(Date.parse(val)),
    "Format tanggal dan waktu tidak valid."
  )
  .transform((val) => new Date(val).toISOString())

const optionalNullableIsoDatetimeSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((val) => {
    if (typeof val !== "string") return null
    const trimmed = val.trim()
    return trimmed.length > 0 ? trimmed : null
  })
  .refine(
    (val) => val === null || !Number.isNaN(Date.parse(val)),
    "Format tanggal dan waktu tidak valid."
  )
  .transform((val) => (val === null ? null : new Date(val).toISOString()))

const activityBaseFields = {
  title: z
    .string()
    .trim()
    .min(1, "Judul kegiatan wajib diisi.")
    .max(
      MAX_ACTIVITY_TITLE_LENGTH,
      `Judul kegiatan maksimal ${MAX_ACTIVITY_TITLE_LENGTH} karakter.`
    ),
  description: optionalNullableTrimmedText(
    MAX_ACTIVITY_DESCRIPTION_LENGTH,
    "Deskripsi kegiatan"
  ),
  category: activityCategorySchema.default("lainnya"),
  location: z
    .string()
    .trim()
    .min(1, "Lokasi kegiatan wajib diisi.")
    .max(
      MAX_ACTIVITY_LOCATION_LENGTH,
      `Lokasi kegiatan maksimal ${MAX_ACTIVITY_LOCATION_LENGTH} karakter.`
    ),
  startAt: isoDatetimeSchema,
  endAt: optionalNullableIsoDatetimeSchema,
  allowSelfRegistration: z.boolean().default(true),
  maxParticipants: z
    .union([z.number(), z.null()])
    .optional()
    .transform((val) => (val === undefined ? null : val))
    .refine(
      (val) =>
        val === null || (Number.isInteger(val) && val > 0 && val <= 100000),
      "Kuota maksimal peserta harus berupa bilangan bulat lebih dari 0."
    ),
  registrationDeadline: optionalNullableIsoDatetimeSchema,
}

function validateActivityDates(
  val: {
    startAt: string
    endAt: string | null
    registrationDeadline: string | null
  },
  ctx: z.RefinementCtx
) {
  const startMs = Date.parse(val.startAt)
  const endMs = val.endAt ? Date.parse(val.endAt) : null
  const deadlineMs = val.registrationDeadline
    ? Date.parse(val.registrationDeadline)
    : null

  if (endMs !== null && endMs < startMs) {
    ctx.addIssue({
      code: "custom",
      path: ["endAt"],
      message: "Waktu selesai tidak boleh lebih awal dari waktu mulai.",
    })
  }

  const effectiveEndMs = endMs ?? startMs
  if (deadlineMs !== null && deadlineMs > effectiveEndMs) {
    ctx.addIssue({
      code: "custom",
      path: ["registrationDeadline"],
      message:
        "Batas waktu pendaftaran tidak boleh melewati waktu berakhirnya kegiatan.",
    })
  }
}

export const createActivitySchema = z
  .object(activityBaseFields)
  .superRefine(validateActivityDates)

export const updateActivitySchema = z
  .object({
    activityId: activityUuidSchema,
    ...activityBaseFields,
  })
  .superRefine(validateActivityDates)

export const transitionActivityStatusSchema = z.object({
  activityId: activityUuidSchema,
  newStatus: activityTransitionTargetSchema,
  reason: optionalNullableTrimmedText(
    MAX_ACTIVITY_REASON_LENGTH,
    "Alasan perubahan status"
  ),
})

export const softDeleteActivitySchema = z.object({
  activityId: activityUuidSchema,
  reason: optionalNullableTrimmedText(
    MAX_ACTIVITY_REASON_LENGTH,
    "Alasan penghapusan kegiatan"
  ),
})

export const registerForActivitySchema = z.object({
  activityId: activityUuidSchema,
  notes: optionalNullableTrimmedText(
    MAX_ACTIVITY_NOTES_LENGTH,
    "Catatan pendaftaran"
  ),
})

export const cancelActivityRegistrationSchema = z.object({
  activityId: activityUuidSchema,
  reason: optionalNullableTrimmedText(
    MAX_ACTIVITY_REASON_LENGTH,
    "Alasan pembatalan pendaftaran"
  ),
})

export const addActivityParticipantSchema = z.object({
  activityId: activityUuidSchema,
  residentId: activityUuidSchema,
  rsvpStatus: activityManualParticipantStatusSchema.default("attending"),
  notes: optionalNullableTrimmedText(
    MAX_ACTIVITY_NOTES_LENGTH,
    "Catatan peserta"
  ),
})

export const removeActivityParticipantSchema = z.object({
  activityId: activityUuidSchema,
  participantId: activityUuidSchema,
  reason: optionalNullableTrimmedText(
    MAX_ACTIVITY_REASON_LENGTH,
    "Alasan penghapusan peserta"
  ),
})

export const recordActivityAttendanceSchema = z.object({
  activityId: activityUuidSchema,
  residentId: activityUuidSchema,
  rsvpStatus: activityParticipantStatusSchema,
})

export const removeActivityDocSchema = z.object({
  activityId: activityUuidSchema,
  fileId: activityUuidSchema,
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
      "Alasan penghapusan dokumentasi maksimal 300 karakter."
    ),
})

const optionalBooleanParamSchema = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((val) => {
    if (val === "true" || val === "1") return true
    if (val === "false" || val === "0") return false
    return undefined
  })

export const activityListFiltersSchema = z.object({
  status: activityStatusSchema.optional(),
  category: activityCategorySchema.optional(),
  search: z
    .string()
    .trim()
    .max(120, "Kata kunci pencarian maksimal 120 karakter.")
    .optional()
    .transform((val) => (val && val.length > 0 ? val : undefined)),
  upcomingOnly: optionalBooleanParamSchema,
  includeDeleted: optionalBooleanParamSchema,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(ACTIVITY_MAX_PAGE_SIZE)
    .default(ACTIVITY_DEFAULT_PAGE_SIZE),
  sortBy: z.enum(ACTIVITY_SORT_FIELDS).default("start_at"),
  sort: z.enum(ACTIVITY_SORT_DIRECTIONS).default("asc"),
})

export const activityParticipantsFiltersSchema = z.object({
  rsvpStatus: activityParticipantStatusSchema.optional(),
  search: z
    .string()
    .trim()
    .max(120, "Kata kunci pencarian peserta maksimal 120 karakter.")
    .optional()
    .transform((val) => (val && val.length > 0 ? val : undefined)),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(ACTIVITY_MAX_PAGE_SIZE)
    .default(ACTIVITY_DEFAULT_PAGE_SIZE),
})

