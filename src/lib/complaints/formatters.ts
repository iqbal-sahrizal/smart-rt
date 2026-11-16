import type { RoleCode } from "@/lib/auth/types"
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_PRIORITIES,
  COMPLAINT_PRIORITY_LABELS,
  COMPLAINT_STATUSES,
  COMPLAINT_STATUS_LABELS,
} from "./constants"
import type {
  ComplaintCategory,
  ComplaintDetail,
  ComplaintPriority,
  ComplaintStatus,
  ComplaintTransitionTarget,
} from "./types"

export const COMPLAINT_SEARCH_DEBOUNCE_MS = 350

export type ComplaintBadgeVariant =
  | "warning"
  | "info"
  | "success"
  | "destructive"
  | "secondary"
  | "outline"

const COMPLAINT_DATETIME_FORMATTER = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Jakarta",
})

const COMPLAINT_DATE_SHORT_FORMATTER = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Jakarta",
})

export function formatComplaintDateTime(isoTimestamp: string | null): string {
  if (!isoTimestamp) return "-"
  const parsed = new Date(isoTimestamp)
  if (Number.isNaN(parsed.getTime())) return isoTimestamp
  return `${COMPLAINT_DATETIME_FORMATTER.format(parsed)} WIB`
}

export function formatComplaintDateShort(isoTimestamp: string | null): string {
  if (!isoTimestamp) return "-"
  const parsed = new Date(isoTimestamp)
  if (Number.isNaN(parsed.getTime())) return isoTimestamp
  return COMPLAINT_DATE_SHORT_FORMATTER.format(parsed)
}

export function getComplaintStatusLabel(status: ComplaintStatus): string {
  return COMPLAINT_STATUS_LABELS[status] ?? status
}

export function getComplaintStatusBadgeVariant(
  status: ComplaintStatus
): "warning" | "info" | "success" | "destructive" {
  switch (status) {
    case "open":
      return "warning"
    case "in_progress":
      return "info"
    case "resolved":
      return "success"
    case "rejected":
      return "destructive"
  }
}

export function getComplaintPriorityLabel(priority: ComplaintPriority): string {
  return COMPLAINT_PRIORITY_LABELS[priority] ?? priority
}

export function getComplaintPriorityBadgeVariant(
  priority: ComplaintPriority
): "secondary" | "warning" | "destructive" {
  switch (priority) {
    case "low":
      return "secondary"
    case "medium":
      return "warning"
    case "high":
      return "destructive"
  }
}

export const COMPLAINT_STATUS_FILTER_OPTIONS: ReadonlyArray<{
  value: "all" | ComplaintStatus
  label: string
}> = [
  { value: "all", label: "Semua Status" },
  ...COMPLAINT_STATUSES.map((status) => ({
    value: status,
    label: COMPLAINT_STATUS_LABELS[status],
  })),
]

export const COMPLAINT_CATEGORY_FILTER_OPTIONS: ReadonlyArray<{
  value: "all" | ComplaintCategory
  label: string
}> = [
  { value: "all", label: "Semua Kategori" },
  ...COMPLAINT_CATEGORIES.map((category) => ({
    value: category,
    label: category,
  })),
]

export const COMPLAINT_PRIORITY_FILTER_OPTIONS: ReadonlyArray<{
  value: "all" | ComplaintPriority
  label: string
}> = [
  { value: "all", label: "Semua Prioritas" },
  ...COMPLAINT_PRIORITIES.map((priority) => ({
    value: priority,
    label: COMPLAINT_PRIORITY_LABELS[priority],
  })),
]

/**
 * Transitions allowed from the current status. Closed statuses (`resolved`,
 * `rejected`) are terminal and cannot be reopened.
 */
export function getAllowedNextComplaintStatuses(
  currentStatus: ComplaintStatus
): ComplaintTransitionTarget[] {
  switch (currentStatus) {
    case "open":
      return ["in_progress", "resolved", "rejected"]
    case "in_progress":
      return ["resolved", "rejected"]
    case "resolved":
    case "rejected":
      return []
  }
}

export interface ComplaintTransitionActionMeta {
  targetStatus: ComplaintTransitionTarget
  buttonLabel: string
  dialogTitle: string
  dialogDescription: string
  confirmLabel: string
  buttonVariant: "default" | "outline" | "destructive" | "secondary"
}

export function getComplaintTransitionActionMeta(
  targetStatus: ComplaintTransitionTarget
): ComplaintTransitionActionMeta {
  switch (targetStatus) {
    case "in_progress":
      return {
        targetStatus,
        buttonLabel: "Tandai Diproses",
        dialogTitle: "Tandai Pengaduan Sedang Diproses?",
        dialogDescription:
          "Status pengaduan akan berubah menjadi Diproses agar pelapor mengetahui tindak lanjut pengurus.",
        confirmLabel: "Mulai Proses",
        buttonVariant: "secondary",
      }
    case "resolved":
      return {
        targetStatus,
        buttonLabel: "Tandai Selesai",
        dialogTitle: "Tandai Pengaduan Selesai?",
        dialogDescription:
          "Pengaduan akan ditutup dengan status Selesai dan tidak dapat dibuka kembali maupun dibalas lagi.",
        confirmLabel: "Konfirmasi Selesai",
        buttonVariant: "default",
      }
    case "rejected":
      return {
        targetStatus,
        buttonLabel: "Tolak Pengaduan",
        dialogTitle: "Tolak Pengaduan Ini?",
        dialogDescription:
          "Pengaduan akan ditutup dengan status Ditolak. Cantumkan alasan yang jelas untuk warga pelapor.",
        confirmLabel: "Konfirmasi Tolak",
        buttonVariant: "destructive",
      }
  }
}

export type ComplaintPhotoPresentation =
  | {
      kind: "restricted"
      message: string
    }
  | {
      kind: "available"
      photoUrl: string
    }
  | {
      kind: "empty"
      message: string
    }

/**
 * Never conclude a complaint lacks a photo solely from `hasPhoto === false`
 * when `permissions.isMetadataOnly` or `!permissions.canViewPhoto` is true
 * (e.g. Bendahara role).
 */
export function getComplaintPhotoPresentation(
  detail: Pick<ComplaintDetail, "complaint" | "permissions">
): ComplaintPhotoPresentation {
  if (!detail.permissions.canViewPhoto || detail.permissions.isMetadataOnly) {
    return {
      kind: "restricted",
      message:
        "Akses lampiran foto pengaduan dibatasi untuk peran Bendahara. Anda tetap dapat meninjau metadata pengaduan dan riwayat statusnya.",
    }
  }

  if (detail.complaint.hasPhoto && detail.complaint.photoUrl) {
    return {
      kind: "available",
      photoUrl: detail.complaint.photoUrl,
    }
  }

  return {
    kind: "empty",
    message: "Pengaduan ini tidak disertai lampiran foto.",
  }
}

export function getComplaintRoleBannerNotice(
  roles: readonly RoleCode[]
): string | null {
  const hasManagerialRole = roles.some(
    (role) =>
      role === "ketua_rt" || role === "sekretaris" || role === "pengurus"
  )
  if (!hasManagerialRole && roles.includes("bendahara")) {
    return "Peran Bendahara memiliki akses baca metadata pengaduan saja. Lampiran foto, balasan, perubahan status, dan penghapusan dibatasi untuk Ketua RT, Sekretaris, dan Pengurus."
  }
  return null
}

export function buildComplaintStatusHistoryDescription(params: {
  previousStatus: ComplaintStatus | null
  newStatus: ComplaintStatus
}): string {
  if (!params.previousStatus) {
    return `Pengaduan dibuat dengan status ${getComplaintStatusLabel(params.newStatus)}`
  }
  if (params.previousStatus === params.newStatus) {
    return `Status pengaduan tercatat sebagai ${getComplaintStatusLabel(params.newStatus)}`
  }
  return `Status diubah dari ${getComplaintStatusLabel(params.previousStatus)} ke ${getComplaintStatusLabel(params.newStatus)}`
}

export function truncateComplaintText(
  value: string,
  maxLength = 100
): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}…`
}

export const RESIDENT_COMPLAINT_FILTER_OPTIONS: ReadonlyArray<{
  value: "all" | ComplaintStatus
  label: string
}> = [
  { value: "all", label: "Semua" },
  { value: "open", label: "Baru" },
  { value: "in_progress", label: "Sedang diproses" },
  { value: "resolved", label: "Selesai" },
  { value: "rejected", label: "Ditolak" },
]

export function canResidentEditComplaint(status: ComplaintStatus): boolean {
  return status === "open"
}

export function canResidentReplyComplaint(status: ComplaintStatus): boolean {
  return status === "open" || status === "in_progress"
}

export function canResidentManageComplaintPhoto(
  status: ComplaintStatus
): boolean {
  return status === "open"
}

export function formatComplaintFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) {
    return `${Math.round((bytes / 1024) * 10) / 10} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}
