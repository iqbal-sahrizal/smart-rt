import "server-only"

import { getAuthContext } from "@/lib/auth/server"
import type { ActiveTenantMembership, AuthContextData } from "@/lib/auth/types"
import {
  resolveNotificationDestination,
  type NotificationFilter,
  type NotificationItem,
  type NotificationListPage,
  type NotificationScope,
  type NotificationSummary,
} from "@/lib/notifications/types"
import { createClient } from "@/lib/supabase/server"

interface RawNotificationRow {
  id: string
  tenant_id: string
  title: string
  body: string
  type: string
  reference_type: string | null
  reference_id: string | null
  is_read: boolean
  read_at: string | null
  created_at: string
}

function mapNotificationRow(
  row: RawNotificationRow,
  scope: NotificationScope
): NotificationItem {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    body: row.body,
    type: row.type,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    isRead: row.is_read,
    readAt: row.read_at,
    createdAt: row.created_at,
    destinationHref: resolveNotificationDestination(
      scope,
      row.reference_type,
      row.reference_id
    ),
  }
}

export interface ScopedNotificationContext {
  ctx: AuthContextData
  tenant: ActiveTenantMembership
}

/**
 * Resolves the authenticated user and active workspace tenant for notification
 * operations without redirecting (suitable for API route handlers and actions).
 * Never trusts recipient_user_id or tenant_id from client input.
 */
export async function resolveScopedNotificationContext(
  scope: NotificationScope
): Promise<
  | { status: "ok"; context: ScopedNotificationContext }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
> {
  const ctx = await getAuthContext()
  if (!ctx) {
    return { status: "unauthenticated" }
  }

  const eligible =
    scope === "admin"
      ? ctx.memberships.filter((m) => m.hasAdminRole)
      : ctx.memberships.filter((m) => m.hasResidentRole)

  if (eligible.length === 0) {
    return { status: "forbidden" }
  }

  if (ctx.workspaceOptions.length > 1) {
    if (!ctx.selectedWorkspace || ctx.selectedWorkspace.type !== scope) {
      return { status: "forbidden" }
    }
    const matched = eligible.find(
      (m) => m.tenantId === ctx.selectedWorkspace?.tenantId
    )
    if (!matched) {
      return { status: "forbidden" }
    }
    return { status: "ok", context: { ctx, tenant: matched } }
  }

  return { status: "ok", context: { ctx, tenant: eligible[0] } }
}

const NOTIFICATION_SELECT_COLUMNS =
  "id, tenant_id, title, body, type, reference_type, reference_id, is_read, read_at, created_at"

export async function getNotificationSummaryForTenant({
  tenantId,
  userId,
  scope,
  limit = 5,
}: {
  tenantId: string
  userId: string
  scope: NotificationScope
  limit?: number
}): Promise<NotificationSummary> {
  const supabase = await createClient()
  const safeLimit = Math.min(Math.max(limit, 1), 10)

  const [unreadRes, recentRes] = await Promise.all([
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("recipient_user_id", userId)
      .eq("is_read", false),
    supabase
      .from("notifications")
      .select(NOTIFICATION_SELECT_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("recipient_user_id", userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(safeLimit),
  ])

  if (unreadRes.error || recentRes.error) {
    throw new Error("Gagal memuat ringkasan notifikasi.")
  }

  return {
    unreadCount: unreadRes.count ?? 0,
    recent: ((recentRes.data ?? []) as RawNotificationRow[]).map((row) =>
      mapNotificationRow(row, scope)
    ),
  }
}

export async function getNotificationsPageForTenant({
  tenantId,
  userId,
  scope,
  filter = "all",
  limit = 15,
  cursorCreatedAt,
  cursorId,
}: {
  tenantId: string
  userId: string
  scope: NotificationScope
  filter?: NotificationFilter
  limit?: number
  cursorCreatedAt?: string
  cursorId?: string
}): Promise<NotificationListPage> {
  const supabase = await createClient()
  const safeLimit = Math.min(Math.max(limit, 1), 30)

  let listQuery = supabase
    .from("notifications")
    .select(NOTIFICATION_SELECT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("recipient_user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(safeLimit + 1)

  if (filter === "unread") {
    listQuery = listQuery.eq("is_read", false)
  } else if (filter === "read") {
    listQuery = listQuery.eq("is_read", true)
  }

  // Keyset pagination prevents duplicate/skipped notifications when new rows arrive
  if (cursorCreatedAt && cursorId) {
    const normalizedTs = cursorCreatedAt.replace(/(\+00:00|\+0000)$/, "Z")
    listQuery = listQuery.or(
      `created_at.lt."${normalizedTs}",and(created_at.eq."${normalizedTs}",id.lt."${cursorId}")`
    )
  }

  const [listRes, unreadCountRes, totalCountRes] = await Promise.all([
    listQuery,
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("recipient_user_id", userId)
      .eq("is_read", false),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("recipient_user_id", userId),
  ])

  if (listRes.error || unreadCountRes.error || totalCountRes.error) {
    throw new Error("Gagal memuat daftar notifikasi.")
  }

  const rows = (listRes.data ?? []) as RawNotificationRow[]
  const hasMore = rows.length > safeLimit
  const pageRows = hasMore ? rows.slice(0, safeLimit) : rows
  const items = pageRows.map((row) => mapNotificationRow(row, scope))
  const lastRow = pageRows[pageRows.length - 1] ?? null

  return {
    items,
    unreadCount: unreadCountRes.count ?? 0,
    totalCount: totalCountRes.count ?? 0,
    hasMore,
    nextCursor:
      hasMore && lastRow
        ? { createdAt: lastRow.created_at, id: lastRow.id }
        : null,
  }
}

