import type { RoleCode } from "@/lib/auth/types"

export const COMMUNITY_MEDIA_BUCKET = "community-media" as const

export const MAX_COMMUNITY_MEDIA_COUNT = 4
export const MAX_COMMUNITY_IMAGE_BYTES = 5 * 1024 * 1024 // 5 MiB

export const ALLOWED_COMMUNITY_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const

export const MAX_COMMUNITY_CAPTION_LENGTH = 2200
export const MAX_COMMUNITY_COMMENT_LENGTH = 1000
export const MAX_COMMUNITY_REPORT_DETAIL_LENGTH = 500
export const MAX_COMMUNITY_MODERATION_REASON_LENGTH = 500

export const COMMUNITY_FEED_DEFAULT_LIMIT = 10
export const COMMUNITY_FEED_MAX_LIMIT = 20
export const COMMUNITY_COMMENT_DEFAULT_LIMIT = 10
export const COMMUNITY_COMMENT_MAX_LIMIT = 30
export const COMMUNITY_COMMENT_PREVIEW_COUNT = 2

export const COMMUNITY_REPORT_CATEGORIES = [
  "spam",
  "harassment",
  "inappropriate",
  "misinformation",
  "privacy",
  "other",
] as const

export const COMMUNITY_REPORT_CATEGORY_LABELS: Record<
  (typeof COMMUNITY_REPORT_CATEGORIES)[number],
  string
> = {
  spam: "Spam / Promosi Berlebihan",
  harassment: "Pelecehan / Ujaran Kebencian",
  inappropriate: "Konten Tidak Pantas",
  misinformation: "Informasi Menyesatkan / Hoaks",
  privacy: "Pelanggaran Privasi Warga",
  other: "Lainnya",
}

export const COMMUNITY_REPORT_STATUSES = [
  "pending",
  "resolved_hidden",
  "dismissed",
] as const

export const COMMUNITY_MODERATION_STATUSES = ["published", "hidden"] as const

/**
 * Only Ketua RT, Sekretaris, and Pengurus are authorized to moderate community feed content.
 * Bendahara and regular Warga must never moderate content.
 */
export const COMMUNITY_MODERATION_ROLES: readonly RoleCode[] = [
  "ketua_rt",
  "sekretaris",
  "pengurus",
] as const

