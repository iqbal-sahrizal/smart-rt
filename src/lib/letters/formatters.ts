import type { RoleCode } from "@/lib/auth/types"
import { LETTER_STATUSES, LETTER_STATUS_LABELS } from "@/lib/letters/constants"
import {
  canManageLetters,
  isLetterMetadataOnlyRole,
  type LetterRequest,
  type LetterRequestAttachment,
  type LetterRequestPermissions,
  type LetterRequestStatus,
  type LetterReviewDecision,
} from "@/lib/letters/types"

export const LETTER_SEARCH_DEBOUNCE_MS = 350

export const LETTER_SORT_OPTIONS: ReadonlyArray<{
  value: "desc" | "asc"
  label: string
}> = [
  { value: "desc", label: "Terbaru Diajukan" },
  { value: "asc", label: "Terlama Diajukan" },
]

const LETTER_DATETIME_FORMATTER = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Jakarta",
})

const LETTER_DATE_SHORT_FORMATTER = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Jakarta",
})

export function formatLetterDateTime(isoTimestamp: string | null): string {
  if (!isoTimestamp) return "-"
  const parsed = new Date(isoTimestamp)
  if (Number.isNaN(parsed.getTime())) return isoTimestamp
  return `${LETTER_DATETIME_FORMATTER.format(parsed)} WIB`
}

export function formatLetterDateShort(isoTimestamp: string | null): string {
  if (!isoTimestamp) return "-"
  const parsed = new Date(isoTimestamp)
  if (Number.isNaN(parsed.getTime())) return isoTimestamp
  return LETTER_DATE_SHORT_FORMATTER.format(parsed)
}

export function getLetterRequestStatusLabel(
  status: LetterRequestStatus
): string {
  return LETTER_STATUS_LABELS[status] ?? status
}

export function getLetterRequestStatusBadgeVariant(
  status: LetterRequestStatus
): "warning" | "info" | "success" | "destructive" | "outline" {
  switch (status) {
    case "submitted":
      return "warning"
    case "reviewing":
      return "info"
    case "approved":
    case "completed":
      return "success"
    case "rejected":
      return "destructive"
    case "cancelled":
      return "outline"
  }
}

export const LETTER_STATUS_FILTER_OPTIONS: ReadonlyArray<{
  value: "all" | LetterRequestStatus
  label: string
}> = [
  { value: "all", label: "Semua Status" },
  ...LETTER_STATUSES.map((status) => ({
    value: status,
    label: LETTER_STATUS_LABELS[status],
  })),
]

export function getAllowedReviewDecisions(
  currentStatus: LetterRequestStatus
): LetterReviewDecision[] {
  switch (currentStatus) {
    case "submitted":
      return ["reviewing", "approved", "rejected"]
    case "reviewing":
      return ["approved", "rejected"]
    case "approved":
    case "rejected":
    case "completed":
    case "cancelled":
      return []
  }
}

export function formatLetterFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B"
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(2)} MB`
}

export function truncateLetterText(text: string, maxLength = 80): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

export function getLetterRequestCode(requestId: string): string {
  return `SRT-${requestId.slice(0, 8).toUpperCase()}`
}

export function getLetterStatusExplanation(status: LetterRequestStatus): string {
  switch (status) {
    case "submitted":
      return "Permohonan baru diajukan dan menunggu peninjauan Ketua RT atau Sekretaris."
    case "reviewing":
      return "Permohonan sedang ditinjau oleh pengelola RT."
    case "approved":
      return "Permohonan disetujui dan menunggu pengunggahan PDF surat resmi yang telah ditandatangani."
    case "completed":
      return "Surat resmi telah diterbitkan dan PDF siap dibuka atau diunduh."
    case "rejected":
      return "Permohonan ditolak oleh pengelola RT. Periksa catatan penolakan untuk detailnya."
    case "cancelled":
      return "Permohonan dibatalkan oleh warga pemohon sebelum diproses lebih lanjut."
  }
}

export function getLetterRoleBannerNotice(
  roles: readonly RoleCode[]
): { title: string; description: string } | null {
  if (isLetterMetadataOnlyRole(roles)) {
    return {
      title: "Akses Hanya Metadata",
      description:
        "Role Pengurus hanya dapat melihat ringkasan dan status operasional permohonan surat. Keperluan pengajuan, lampiran dokumen, PDF terbit, dan aksi persetujuan hanya tersedia untuk Ketua RT dan Sekretaris.",
    }
  }
  return null
}

export interface LetterReviewActionMeta {
  decision: LetterReviewDecision
  buttonLabel: string
  dialogTitle: string
  dialogDescription: string
  confirmLabel: string
  buttonVariant: "default" | "outline" | "destructive" | "secondary"
  requiresNotes: boolean
}

export function getLetterReviewActionMeta(
  decision: LetterReviewDecision
): LetterReviewActionMeta {
  switch (decision) {
    case "reviewing":
      return {
        decision,
        buttonLabel: "Mulai Tinjau",
        dialogTitle: "Tandai Permohonan Sedang Ditinjau?",
        dialogDescription:
          "Status permohonan akan berubah menjadi Ditinjau. Setelah ditinjau, warga tidak lagi dapat membatalkan atau mengubah lampiran.",
        confirmLabel: "Mulai Peninjauan",
        buttonVariant: "outline",
        requiresNotes: false,
      }
    case "approved":
      return {
        decision,
        buttonLabel: "Setujui Permohonan",
        dialogTitle: "Setujui Permohonan Surat?",
        dialogDescription:
          "Permohonan akan berstatus Disetujui dan siap dilanjutkan ke tahap penerbitan PDF surat resmi.",
        confirmLabel: "Setujui Permohonan",
        buttonVariant: "default",
        requiresNotes: false,
      }
    case "rejected":
      return {
        decision,
        buttonLabel: "Tolak Permohonan",
        dialogTitle: "Tolak Permohonan Surat?",
        dialogDescription:
          "Status Ditolak bersifat final. Sertakan alasan penolakan yang jelas agar pemohon dapat memahami keputusannya.",
        confirmLabel: "Tolak Permohonan",
        buttonVariant: "destructive",
        requiresNotes: true,
      }
  }
}

export type LetterDocumentsPresentation =
  | {
      kind: "restricted"
      message: string
    }
  | {
      kind: "available"
      attachments: LetterRequestAttachment[]
      hasIssuedPdf: boolean
      issuedPdfUrl: string | null
      issuedDownloadUrl: string | null
    }

export function getLetterDocumentsPresentation({
  request,
  permissions,
}: {
  request: Pick<
    LetterRequest,
    "attachments" | "hasIssuedPdf" | "issuedPdfUrl" | "issuedDownloadUrl"
  >
  permissions: Pick<
    LetterRequestPermissions,
    "isMetadataOnly" | "canAccessDocuments"
  >
}): LetterDocumentsPresentation {
  if (permissions.isMetadataOnly || !permissions.canAccessDocuments) {
    return {
      kind: "restricted",
      message:
        "Dokumen persyaratan dan PDF surat terbit bersifat privat dan hanya dapat diakses oleh Ketua RT, Sekretaris, atau warga pemohon.",
    }
  }

  return {
    kind: "available",
    attachments: request.attachments,
    hasIssuedPdf: request.hasIssuedPdf,
    issuedPdfUrl: request.issuedPdfUrl,
    issuedDownloadUrl: request.issuedDownloadUrl,
  }
}

export function canShowManageLettersCta(roles: readonly RoleCode[]): boolean {
  return canManageLetters(roles)
}

