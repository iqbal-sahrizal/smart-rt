import {
  ACTIVITY_CATEGORY_LABELS,
  ACTIVITY_PARTICIPANT_STATUS_LABELS,
  ACTIVITY_STATUS_LABELS,
} from "@/lib/activities/constants"
import type {
  ActivityCategory,
  ActivityParticipantStatus,
  ActivityStatus,
} from "@/lib/activities/types"

export function formatActivityCategoryLabel(
  category: ActivityCategory
): string {
  return ACTIVITY_CATEGORY_LABELS[category] ?? "Lainnya"
}

export function formatActivityStatusLabel(status: ActivityStatus): string {
  return ACTIVITY_STATUS_LABELS[status] ?? status
}

export function formatActivityParticipantStatusLabel(
  status: ActivityParticipantStatus
): string {
  return ACTIVITY_PARTICIPANT_STATUS_LABELS[status] ?? status
}

export function formatActivityQuotaSummary(
  activeCount: number,
  maxParticipants: number | null
): string {
  if (maxParticipants === null) {
    return `${activeCount} peserta terdaftar (tanpa batas kuota)`
  }
  const remaining = Math.max(maxParticipants - activeCount, 0)
  return `${activeCount} / ${maxParticipants} kuota terisi (${remaining} tersisa)`
}

export function formatActivityDateTimeRange(
  startAt: string,
  endAt: string | null
): string {
  const startDate = new Date(startAt)
  if (Number.isNaN(startDate.getTime())) return "-"

  const dateFmt = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    year: "numeric",
  })
  const timeFmt = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
  })

  if (!endAt) {
    return `${dateFmt.format(startDate)}, ${timeFmt.format(startDate)} WIB`
  }

  const endDate = new Date(endAt)
  if (Number.isNaN(endDate.getTime())) {
    return `${dateFmt.format(startDate)}, ${timeFmt.format(startDate)} WIB`
  }

  const startDay = dateFmt.format(startDate)
  const endDay = dateFmt.format(endDate)

  if (startDay === endDay) {
    return `${startDay}, ${timeFmt.format(startDate)} – ${timeFmt.format(endDate)} WIB`
  }

  return `${startDay} ${timeFmt.format(startDate)} – ${endDay} ${timeFmt.format(endDate)} WIB`
}

export const ACTIVITY_ROSTER_REMOVAL_SEMANTICS_NOTE =
  "Menghapus peserta menghapus data pendaftaran dari daftar peserta aktif kegiatan (aksi tetap tercatat di log audit), berbeda dengan pembatalan pendaftaran mandiri oleh warga."

