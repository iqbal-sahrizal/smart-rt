import { isValidUuid } from "@/lib/residents/schemas"

export type NotificationScope = "admin" | "resident"
export type NotificationFilter = "all" | "unread" | "read"

export interface NotificationItem {
  id: string
  tenantId: string
  title: string
  body: string
  type: string
  referenceType: string | null
  referenceId: string | null
  isRead: boolean
  readAt: string | null
  createdAt: string
  destinationHref: string | null
}

export interface NotificationSummary {
  unreadCount: number
  recent: NotificationItem[]
}

export interface NotificationCursor {
  createdAt: string
  id: string
}

export interface NotificationListPage {
  items: NotificationItem[]
  unreadCount: number
  totalCount: number
  hasMore: boolean
  nextCursor: NotificationCursor | null
}

export interface NotificationMutationResult {
  ok: boolean
  error: string | null
  updatedCount?: number
  readAt?: string | null
}

export function resolveNotificationDestination(
  scope: NotificationScope,
  referenceType: string | null,
  referenceId: string | null
): string | null {
  if (!referenceType) return null
  const normalizedType = referenceType.trim().toLowerCase()
  const safeId = referenceId && isValidUuid(referenceId) ? referenceId : null

  if (scope === "admin") {
    switch (normalizedType) {
      case "announcements":
      case "announcement":
        return safeId ? `/announcements/${safeId}` : "/announcements"
      case "bills":
      case "bill":
        return safeId ? `/bills/${safeId}` : "/bills"
      case "dues":
      case "due":
        return safeId ? `/dues/${safeId}` : "/dues"
      case "payments":
      case "payment":
        return safeId ? `/payments/${safeId}` : "/payments"
      case "cash_transactions":
      case "cash_transaction":
      case "cash":
        return "/cash"
      case "residents":
      case "resident":
      case "households":
      case "household":
        return safeId && normalizedType.startsWith("resident")
          ? `/residents/${safeId}`
          : "/residents"
      case "resident_invitations":
      case "resident_invitation":
        return "/resident-invitations"
      default:
        return null
    }
  }

  switch (normalizedType) {
    case "announcements":
    case "announcement":
      return safeId
        ? `/resident/announcements/${safeId}`
        : "/resident/announcements"
    case "bills":
    case "bill":
      return safeId ? `/resident/bills/${safeId}` : "/resident/bills"
    case "payments":
    case "payment":
      return "/resident/bills"
    case "households":
    case "household":
      return "/resident/household"
    case "residents":
    case "resident":
    case "resident_invitations":
    case "resident_invitation":
      return "/resident/profile"
    default:
      return null
  }
}

export function getNotificationTypeLabel(type: string): string {
  const normalized = type.trim().toLowerCase()
  if (normalized.includes("payment") || normalized.includes("pembayaran")) {
    return "Pembayaran"
  }
  if (normalized.includes("bill") || normalized.includes("tagihan")) {
    return "Tagihan"
  }
  if (
    normalized.includes("announcement") ||
    normalized.includes("pengumuman")
  ) {
    return "Pengumuman"
  }
  if (normalized.includes("resident") || normalized.includes("warga")) {
    return "Data Warga"
  }
  if (normalized.includes("complaint") || normalized.includes("pengaduan")) {
    return "Pengaduan"
  }
  if (normalized.includes("letter") || normalized.includes("surat")) {
    return "Surat"
  }
  if (normalized.includes("activity") || normalized.includes("kegiatan")) {
    return "Kegiatan"
  }
  return "Informasi"
}

export function getNotificationTypeBadgeVariant(
  type: string
): "info" | "success" | "warning" | "outline" {
  const normalized = type.trim().toLowerCase()
  if (normalized.includes("reject") || normalized.includes("overdue")) {
    return "warning"
  }
  if (normalized.includes("verif") || normalized.includes("paid") || normalized.includes("approv")) {
    return "success"
  }
  if (normalized.includes("announcement") || normalized.includes("bill") || normalized.includes("payment")) {
    return "info"
  }
  return "outline"
}

export function formatNotificationTimestamp(iso: string | null): string {
  if (!iso) return "-"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  })} WIB`
}

export function formatNotificationRelative(
  iso: string,
  nowMs: number
): string {
  const createdMs = Date.parse(iso)
  if (Number.isNaN(createdMs)) return iso
  const diffSec = Math.max(0, Math.floor((nowMs - createdMs) / 1000))
  if (diffSec < 60) return "Baru saja"
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m lalu`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}j lalu`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 7) return `${diffDay}h lalu`
  return formatNotificationTimestamp(iso)
}

