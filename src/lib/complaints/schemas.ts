import { z } from "zod"

import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_DEFAULT_PAGE_SIZE,
  COMPLAINT_MAX_PAGE_SIZE,
  COMPLAINT_PRIORITIES,
  COMPLAINT_STATUSES,
  COMPLAINT_TRANSITION_TARGETS,
} from "@/lib/complaints/constants"
import { isValidUuid } from "@/lib/residents/schemas"

export const complaintUuidSchema = z
  .string()
  .trim()
  .refine((val) => isValidUuid(val), "Format ID pengaduan tidak valid.")

export const complaintCategorySchema = z.enum(COMPLAINT_CATEGORIES, {
  error: "Kategori pengaduan harus Fasilitas, Kebersihan, atau Keamanan.",
})

export const complaintStatusSchema = z.enum(COMPLAINT_STATUSES, {
  error: "Status pengaduan tidak valid.",
})

export const complaintTransitionTargetSchema = z.enum(
  COMPLAINT_TRANSITION_TARGETS,
  {
    error: "Status tujuan hanya boleh Diproses, Selesai, atau Ditolak.",
  }
)

export const complaintPrioritySchema = z.enum(COMPLAINT_PRIORITIES, {
  error: "Prioritas pengaduan tidak valid.",
})

const complaintTitleSchema = z
  .string()
  .trim()
  .min(5, "Judul pengaduan minimal 5 karakter.")
  .max(150, "Judul pengaduan maksimal 150 karakter.")

const complaintDescriptionSchema = z
  .string()
  .trim()
  .min(10, "Deskripsi pengaduan minimal 10 karakter.")
  .max(2000, "Deskripsi pengaduan maksimal 2000 karakter.")

const complaintReplyMessageSchema = z
  .string()
  .trim()
  .min(2, "Pesan balasan minimal 2 karakter.")
  .max(1500, "Pesan balasan maksimal 1500 karakter.")

export const createComplaintSchema = z.object({
  category: complaintCategorySchema,
  title: complaintTitleSchema,
  description: complaintDescriptionSchema,
})

export const updateComplaintSchema = z.object({
  complaintId: complaintUuidSchema,
  category: complaintCategorySchema,
  title: complaintTitleSchema,
  description: complaintDescriptionSchema,
})

export const createComplaintReplySchema = z.object({
  complaintId: complaintUuidSchema,
  message: complaintReplyMessageSchema,
  scope: z.enum(["admin", "resident"]).optional(),
})

export const transitionComplaintStatusSchema = z.object({
  complaintId: complaintUuidSchema,
  newStatus: complaintTransitionTargetSchema,
  reason: z
    .union([z.string(), z.null()])
    .optional()
    .transform((val) => {
      if (typeof val !== "string") return null
      const trimmed = val.trim()
      return trimmed.length > 0 ? trimmed : null
    })
    .refine(
      (val) => val === null || val.length <= 500,
      "Alasan perubahan status maksimal 500 karakter."
    ),
})

export const softDeleteComplaintSchema = z.object({
  complaintId: complaintUuidSchema,
  reason: z
    .string()
    .trim()
    .min(3, "Alasan penghapusan pengaduan minimal 3 karakter.")
    .max(500, "Alasan penghapusan pengaduan maksimal 500 karakter."),
})

export const deleteComplaintPhotoSchema = z.object({
  complaintId: complaintUuidSchema,
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
      "Alasan penghapusan foto maksimal 300 karakter."
    ),
})

export function sanitizeComplaintSearchTerm(input?: string): string {
  if (!input) return ""
  return input
    .trim()
    .replace(/[,()%*_\\]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80)
}

export const complaintListFiltersSchema = z.object({
  status: complaintStatusSchema.optional(),
  category: complaintCategorySchema.optional(),
  priority: complaintPrioritySchema.optional(),
  search: z
    .string()
    .optional()
    .transform((val) => {
      const cleaned = sanitizeComplaintSearchTerm(val)
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
      COMPLAINT_MAX_PAGE_SIZE,
      `Ukuran halaman maksimal ${COMPLAINT_MAX_PAGE_SIZE}.`
    )
    .default(COMPLAINT_DEFAULT_PAGE_SIZE),
  sort: z.enum(["asc", "desc"]).default("desc"),
})

