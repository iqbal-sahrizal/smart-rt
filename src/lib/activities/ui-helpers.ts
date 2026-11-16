import type { RoleCode } from "@/lib/auth/types"
import {
  canManageActivities,
  type ActivityCategory,
  type ActivityParticipantStatus,
  type ActivityStatus,
} from "@/lib/activities/types"

export type ActivityBadgeVariant =
  | "default"
  | "secondary"
  | "navy"
  | "accent"
  | "success"
  | "warning"
  | "destructive"
  | "info"
  | "outline"

export function getActivityStatusBadgeVariant(
  status: ActivityStatus
): ActivityBadgeVariant {
  switch (status) {
    case "scheduled":
      return "info"
    case "ongoing":
      return "warning"
    case "completed":
      return "success"
    case "cancelled":
      return "destructive"
  }
}

export function getActivityCategoryBadgeVariant(
  category: ActivityCategory
): ActivityBadgeVariant {
  switch (category) {
    case "kerja_bakti":
      return "accent"
    case "rapat":
      return "navy"
    case "kesehatan":
      return "success"
    case "keamanan":
      return "warning"
    default:
      return "outline"
  }
}

export function getParticipantStatusBadgeVariant(
  status: ActivityParticipantStatus
): ActivityBadgeVariant {
  switch (status) {
    case "invited":
      return "info"
    case "attending":
      return "default"
    case "attended":
      return "success"
    case "absent":
      return "destructive"
    case "cancelled":
      return "outline"
  }
}

export function getAdminActivitiesRoleBanner(roles: readonly RoleCode[]): {
  title: string
  description: string
} | null {
  if (canManageActivities(roles)) {
    return null
  }

  return {
    title: "Akses Operasional Pengurus",
    description:
      "Anda dapat memantau daftar kegiatan & peserta, memulai/menyelesaikan kegiatan, mencatat presensi kehadiran, dan mengunggah dokumentasi. Pembuatan, perubahan jadwal, pembatalan, pengarsipan kegiatan, pengelolaan peserta manual, serta penghapusan dokumentasi hanya tersedia untuk Ketua RT dan Sekretaris.",
  }
}

/**
 * Formats an ISO timestamp into a `YYYY-MM-DDTHH:mm` string in Asia/Jakarta (+07:00)
 * for `<input type="datetime-local">`.
 */
export function isoToJakartaDatetimeLocal(
  iso: string | null | undefined
): string {
  if (!iso) return ""
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ""
  // Shift UTC ms by +7 hours (Asia/Jakarta, fixed UTC+07:00 without DST)
  const jakartaDate = new Date(ms + 7 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${jakartaDate.getUTCFullYear()}-${pad(jakartaDate.getUTCMonth() + 1)}-${pad(
    jakartaDate.getUTCDate()
  )}T${pad(jakartaDate.getUTCHours())}:${pad(jakartaDate.getUTCMinutes())}`
}

/**
 * Converts a `YYYY-MM-DDTHH:mm` value interpreted as Asia/Jakarta (+07:00) into
 * a UTC ISO 8601 string, or returns null when empty.
 */
export function jakartaDatetimeLocalToIso(
  localValue: string | null | undefined
): string | null {
  const trimmed = localValue?.trim() ?? ""
  if (!trimmed) return null
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
    return null
  }
  const normalized = trimmed.length === 16 ? `${trimmed}:00` : trimmed
  const parsed = Date.parse(`${normalized}+07:00`)
  if (Number.isNaN(parsed)) return null
  return new Date(parsed).toISOString()
}

export function formatJakartaDateTimeShort(iso: string | null | undefined): string {
  if (!iso) return "-"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "-"
  return (
    new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d) + " WIB"
  )
}

