import type { RoleCode } from "@/lib/auth/types"

export const LETTER_STATUSES = [
  "submitted",
  "reviewing",
  "approved",
  "rejected",
  "completed",
  "cancelled",
] as const

export const LETTER_REVIEW_DECISIONS = [
  "reviewing",
  "approved",
  "rejected",
] as const

export const LETTER_ADMIN_READ_ROLES: readonly RoleCode[] = [
  "ketua_rt",
  "sekretaris",
  "pengurus",
]

export const LETTER_MANAGEMENT_ROLES: readonly RoleCode[] = [
  "ketua_rt",
  "sekretaris",
]

export const LETTER_DOCUMENT_VIEW_ROLES: readonly RoleCode[] = [
  "ketua_rt",
  "sekretaris",
]

export const LETTER_REQUEST_DOCS_BUCKET = "letter-requests"
export const ISSUED_LETTERS_BUCKET = "issued-letters"

export const MAX_LETTER_SUPPORTING_DOCS = 5
export const MAX_LETTER_ATTACHMENT_BYTES = 5 * 1024 * 1024 // 5 MiB
export const MAX_ISSUED_LETTER_PDF_BYTES = 10 * 1024 * 1024 // 10 MiB

export const MAX_LETTER_PURPOSE_LENGTH = 1000
export const MAX_LETTER_TYPE_CODE_LENGTH = 32
export const MAX_LETTER_TYPE_NAME_LENGTH = 120
export const MAX_LETTER_TYPE_DESCRIPTION_LENGTH = 500
export const MAX_LETTER_REQUIRED_DOCS_ITEMS = 20

export const ALLOWED_LETTER_ATTACHMENT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "application/pdf",
] as const

export const ALLOWED_ISSUED_LETTER_MIME_TYPES = ["application/pdf"] as const

export const LETTER_STATUS_LABELS: Record<
  (typeof LETTER_STATUSES)[number],
  string
> = {
  submitted: "Diajukan",
  reviewing: "Ditinjau",
  approved: "Disetujui",
  rejected: "Ditolak",
  completed: "Selesai",
  cancelled: "Dibatalkan",
}

export const LETTER_DEFAULT_PAGE_SIZE = 10
export const LETTER_MAX_PAGE_SIZE = 50

export const LETTER_SORT_FIELDS = ["created_at", "updated_at", "status"] as const
export const LETTER_SORT_DIRECTIONS = ["asc", "desc"] as const

