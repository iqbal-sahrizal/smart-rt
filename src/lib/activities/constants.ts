import type { RoleCode } from "@/lib/auth/types"

export const ACTIVITY_CATEGORIES = [
  "kerja_bakti",
  "rapat",
  "kesehatan",
  "keamanan",
  "sosial",
  "olahraga",
  "keagamaan",
  "lainnya",
] as const

export const ACTIVITY_STATUSES = [
  "scheduled",
  "ongoing",
  "completed",
  "cancelled",
] as const

export const ACTIVITY_PARTICIPANT_STATUSES = [
  "invited",
  "attending",
  "cancelled",
  "attended",
  "absent",
] as const

export const ACTIVITY_MANUAL_PARTICIPANT_STATUSES = [
  "invited",
  "attending",
] as const

export const ACTIVITY_CATEGORY_LABELS: Record<
  (typeof ACTIVITY_CATEGORIES)[number],
  string
> = {
  kerja_bakti: "Kerja Bakti",
  rapat: "Rapat Warga",
  kesehatan: "Kesehatan",
  keamanan: "Keamanan & Ronda",
  sosial: "Sosial Kemasyarakatan",
  olahraga: "Olahraga",
  keagamaan: "Keagamaan",
  lainnya: "Lainnya",
}

export const ACTIVITY_STATUS_LABELS: Record<
  (typeof ACTIVITY_STATUSES)[number],
  string
> = {
  scheduled: "Dijadwalkan",
  ongoing: "Berlangsung",
  completed: "Selesai",
  cancelled: "Dibatalkan",
}

export const ACTIVITY_PARTICIPANT_STATUS_LABELS: Record<
  (typeof ACTIVITY_PARTICIPANT_STATUSES)[number],
  string
> = {
  invited: "Diundang",
  attending: "Terdaftar / Hadir",
  cancelled: "Dibatalkan Mandiri",
  attended: "Hadir",
  absent: "Tidak Hadir",
}

export const ACTIVITY_ADMIN_READ_ROLES: readonly RoleCode[] = [
  "ketua_rt",
  "sekretaris",
  "pengurus",
]

export const ACTIVITY_MANAGEMENT_ROLES: readonly RoleCode[] = [
  "ketua_rt",
  "sekretaris",
]

export const ACTIVITY_OPERATIONAL_ROLES: readonly RoleCode[] = [
  "ketua_rt",
  "sekretaris",
  "pengurus",
]

export const ACTIVITY_DOCS_BUCKET = "activity-docs"
export const MAX_ACTIVITY_DOCS = 20
export const MAX_ACTIVITY_DOC_BYTES = 10 * 1024 * 1024 // 10 MiB

export const ALLOWED_ACTIVITY_DOC_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const

export const MAX_ACTIVITY_TITLE_LENGTH = 200
export const MAX_ACTIVITY_LOCATION_LENGTH = 200
export const MAX_ACTIVITY_DESCRIPTION_LENGTH = 4000
export const MAX_ACTIVITY_NOTES_LENGTH = 500
export const MAX_ACTIVITY_REASON_LENGTH = 500

export const ACTIVITY_DEFAULT_PAGE_SIZE = 10
export const ACTIVITY_MAX_PAGE_SIZE = 50

export const ACTIVITY_SORT_FIELDS = [
  "start_at",
  "created_at",
  "updated_at",
] as const
export const ACTIVITY_SORT_DIRECTIONS = ["asc", "desc"] as const

