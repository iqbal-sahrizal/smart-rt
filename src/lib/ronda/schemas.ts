import { z } from "zod"

import { isValidUuid } from "@/lib/residents/schemas"
import { RONDA_ATTENDANCE_STATUSES } from "@/lib/ronda/types"

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/

export function isValidCalendarDate(value: string): boolean {
  if (!ISO_DATE_REGEX.test(value)) return false
  const [yearStr, monthStr, dayStr] = value.split("-")
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false
  }
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

export function normalizeDbTime(value: string): string | null {
  const trimmed = value.trim()
  const match = TIME_REGEX.exec(trimmed)
  if (!match) return null
  const hh = match[1]
  const mm = match[2]
  const ss = match[3] ?? "00"
  return `${hh}:${mm}:${ss}`
}

const uuidSchema = z
  .string()
  .trim()
  .refine((val) => isValidUuid(val), "Format ID tidak valid.")

const dateStringSchema = z
  .string()
  .trim()
  .refine(
    (val) => isValidCalendarDate(val),
    "Tanggal harus berformat YYYY-MM-DD yang valid."
  )

const timeStringSchema = z
  .string()
  .trim()
  .refine(
    (val) => normalizeDbTime(val) !== null,
    "Format waktu harus HH:MM atau HH:MM:SS (00:00–23:59)."
  )
  .transform((val) => normalizeDbTime(val) as string)

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

export const upsertRondaScheduleSchema = z
  .object({
    scheduleId: z
      .union([z.string(), z.null()])
      .optional()
      .transform((val) => {
        if (typeof val !== "string") return null
        const trimmed = val.trim()
        return trimmed.length > 0 ? trimmed : null
      })
      .refine(
        (val) => val === null || isValidUuid(val),
        "ID jadwal ronda tidak valid."
      ),
    scheduleDate: dateStringSchema,
    shiftLabel: z
      .string()
      .trim()
      .min(1, "Label shift ronda wajib diisi.")
      .max(100, "Label shift ronda maksimal 100 karakter.")
      .default("Ronda Malam"),
    startTime: timeStringSchema.default("22:00:00"),
    endTime: timeStringSchema.default("04:00:00"),
    meetingPoint: optionalNullableTrimmedText(200, "Titik kumpul"),
    notes: optionalNullableTrimmedText(1000, "Catatan jadwal"),
    residentIds: z
      .array(
        z
          .string()
          .trim()
          .refine((val) => isValidUuid(val), "ID warga tidak valid.")
      )
      .min(1, "Minimal satu warga aktif harus ditugaskan pada jadwal ronda."),
  })
  .superRefine((data, ctx) => {
    if (data.startTime === data.endTime) {
      ctx.addIssue({
        code: "custom",
        path: ["endTime"],
        message: "Jam mulai dan jam selesai ronda tidak boleh sama.",
      })
    }

    const seen = new Set<string>()
    for (const residentId of data.residentIds) {
      const normalized = residentId.toLowerCase()
      if (seen.has(normalized)) {
        ctx.addIssue({
          code: "custom",
          path: ["residentIds"],
          message: "Terdapat duplikasi warga pada jadwal ronda yang sama.",
        })
        break
      }
      seen.add(normalized)
    }
  })

export const deleteRondaScheduleSchema = z.object({
  scheduleId: uuidSchema,
})

export const recordRondaAttendanceSchema = z
  .object({
    assignmentId: uuidSchema,
    attendanceStatus: z.preprocess(
      (val) => {
        if (val === undefined || val === null) return null
        if (typeof val === "string") {
          const trimmed = val.trim().toLowerCase()
          return trimmed.length === 0 ? null : trimmed
        }
        return val
      },
      z
        .enum(RONDA_ATTENDANCE_STATUSES, {
          message:
            "Status kehadiran hanya boleh 'present', 'absent', 'excused', atau kosong.",
        })
        .nullable()
    ),
    attendanceNotes: optionalNullableTrimmedText(300, "Catatan kehadiran"),
  })
  .superRefine((data, ctx) => {
    if (data.attendanceStatus === null && data.attendanceNotes !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["attendanceNotes"],
        message:
          "Catatan kehadiran tidak boleh diisi ketika status kehadiran dikosongkan.",
      })
    }
  })

export const rondaScheduleFiltersSchema = z
  .object({
    fromDate: z
      .string()
      .trim()
      .optional()
      .transform((val) => (val && val.length > 0 ? val : undefined))
      .refine(
        (val) => val === undefined || isValidCalendarDate(val),
        "Tanggal awal (fromDate) harus berformat YYYY-MM-DD yang valid."
      ),
    toDate: z
      .string()
      .trim()
      .optional()
      .transform((val) => (val && val.length > 0 ? val : undefined))
      .refine(
        (val) => val === undefined || isValidCalendarDate(val),
        "Tanggal akhir (toDate) harus berformat YYYY-MM-DD yang valid."
      ),
    page: z.coerce
      .number()
      .int("Halaman harus berupa bilangan bulat.")
      .min(1, "Halaman minimal 1.")
      .max(1000, "Halaman melebihi batas.")
      .default(1),
    pageSize: z.coerce
      .number()
      .int("Ukuran halaman harus berupa bilangan bulat.")
      .min(1, "Ukuran halaman minimal 1.")
      .max(50, "Ukuran halaman maksimal 50.")
      .default(20),
    sort: z.enum(["asc", "desc"]).default("desc"),
  })
  .superRefine((data, ctx) => {
    if (data.fromDate && data.toDate && data.fromDate > data.toDate) {
      ctx.addIssue({
        code: "custom",
        path: ["toDate"],
        message: "Tanggal akhir tidak boleh lebih awal dari tanggal awal.",
      })
    }
  })

export const rondaAttendanceFiltersSchema = z
  .object({
    scheduleId: z
      .string()
      .trim()
      .optional()
      .transform((val) => (val && val.length > 0 ? val : undefined))
      .refine(
        (val) => val === undefined || isValidUuid(val),
        "ID jadwal ronda tidak valid."
      ),
    fromDate: z
      .string()
      .trim()
      .optional()
      .transform((val) => (val && val.length > 0 ? val : undefined))
      .refine(
        (val) => val === undefined || isValidCalendarDate(val),
        "Tanggal awal (fromDate) harus berformat YYYY-MM-DD yang valid."
      ),
    toDate: z
      .string()
      .trim()
      .optional()
      .transform((val) => (val && val.length > 0 ? val : undefined))
      .refine(
        (val) => val === undefined || isValidCalendarDate(val),
        "Tanggal akhir (toDate) harus berformat YYYY-MM-DD yang valid."
      ),
  })
  .superRefine((data, ctx) => {
    if (data.fromDate && data.toDate && data.fromDate > data.toDate) {
      ctx.addIssue({
        code: "custom",
        path: ["toDate"],
        message: "Tanggal akhir tidak boleh lebih awal dari tanggal awal.",
      })
    }
  })
