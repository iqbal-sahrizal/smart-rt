import type { RoleCode } from "@/lib/auth/types"

export const COMPLAINT_STATUSES = [
  "open",
  "in_progress",
  "resolved",
  "rejected",
] as const

export const COMPLAINT_TRANSITION_TARGETS = [
  "in_progress",
  "resolved",
  "rejected",
] as const

export const COMPLAINT_PRIORITIES = ["low", "medium", "high"] as const

export const DEFAULT_COMPLAINT_PRIORITY = "medium" as const
export const DEFAULT_COMPLAINT_STATUS = "open" as const

/**
 * Verified complaint categories present in the Smart RT database.
 */
export const COMPLAINT_CATEGORIES = [
  "Fasilitas",
  "Kebersihan",
  "Keamanan",
] as const

export const COMPLAINT_ADMIN_READ_ROLES: readonly RoleCode[] = [
  "ketua_rt",
  "sekretaris",
  "bendahara",
  "pengurus",
]

export const COMPLAINT_MANAGEMENT_ROLES: readonly RoleCode[] = [
  "ketua_rt",
  "sekretaris",
  "pengurus",
]

export const COMPLAINT_PHOTO_BUCKET = "complaints"
export const MAX_COMPLAINT_PHOTO_BYTES = 5 * 1024 * 1024 // 5 MiB

export const ALLOWED_COMPLAINT_PHOTO_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const

export const COMPLAINT_STATUS_LABELS: Record<
  (typeof COMPLAINT_STATUSES)[number],
  string
> = {
  open: "Menunggu",
  in_progress: "Diproses",
  resolved: "Selesai",
  rejected: "Ditolak",
}

export const COMPLAINT_PRIORITY_LABELS: Record<
  (typeof COMPLAINT_PRIORITIES)[number],
  string
> = {
  low: "Rendah",
  medium: "Sedang",
  high: "Tinggi",
}

export const COMPLAINT_DEFAULT_PAGE_SIZE = 10
export const COMPLAINT_MAX_PAGE_SIZE = 50

