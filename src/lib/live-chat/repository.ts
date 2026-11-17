import type { SupabaseClient } from "@supabase/supabase-js"

import { CHAT_DEFAULT_PAGE_LIMIT } from "@/lib/live-chat/schemas"
import type {
  ChatMessageItem,
  ChatMessageModerationStatus,
  ChatMessagesPage,
  ChatRoomInfo,
} from "@/lib/live-chat/types"

export const CHAT_MESSAGE_SELECT_COLUMNS =
  "id, tenant_id, room_id, sender_user_id, sender_member_id, sender_name, sender_role_badge, content, client_message_id, moderation_status, moderation_reason, created_at, updated_at, deleted_at" as const

export interface RawChatRoomRow {
  id: string
  tenant_id: string
  slug: string
  name: string
  description: string
  is_active: boolean
}

export interface RawChatMessageRow {
  id: string
  tenant_id: string
  room_id: string
  sender_user_id: string
  sender_member_id: string
  sender_name: string
  sender_role_badge: string | null
  content: string
  client_message_id: string | null
  moderation_status: ChatMessageModerationStatus
  moderation_reason: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export function mapRawChatRoom(row: RawChatRoomRow): ChatRoomInfo {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    isActive: row.is_active,
  }
}

export function mapRawChatMessage(
  row: RawChatMessageRow,
  maskModeratedContent = true
): ChatMessageItem {
  const isDeleted = row.moderation_status === "deleted_by_sender"
  const isHidden = row.moderation_status === "hidden_by_moderator"
  let displayContent = row.content
  if (isDeleted) {
    displayContent = "Pesan ini telah dihapus oleh pengirim."
  } else if (isHidden && maskModeratedContent) {
    displayContent = "Pesan ini disembunyikan oleh pengurus RT."
  }

  return {
    id: row.id,
    tenantId: row.tenant_id,
    roomId: row.room_id,
    senderUserId: row.sender_user_id,
    senderMemberId: row.sender_member_id,
    senderName: row.sender_name,
    senderRoleBadge: row.sender_role_badge,
    content: displayContent,
    clientMessageId: row.client_message_id,
    moderationStatus: row.moderation_status,
    moderationReason: row.moderation_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }
}

function compareMessagesAsc(a: ChatMessageItem, b: ChatMessageItem): number {
  if (a.createdAt < b.createdAt) return -1
  if (a.createdAt > b.createdAt) return 1
  return a.id.localeCompare(b.id)
}

/**
 * Merges a newly arrived or updated realtime message without creating duplicates
 * (deduplicating by both `id` and `clientMessageId`), keeping ascending order.
 */
export function mergeRealtimeMessage(
  existing: readonly ChatMessageItem[],
  incoming: ChatMessageItem
): ChatMessageItem[] {
  const next = [...existing]
  const matchIdx = next.findIndex(
    (item) =>
      item.id === incoming.id ||
      (incoming.clientMessageId !== null &&
        item.clientMessageId !== null &&
        item.clientMessageId === incoming.clientMessageId &&
        item.senderUserId === incoming.senderUserId)
  )

  if (matchIdx >= 0) {
    next[matchIdx] = incoming
  } else {
    next.push(incoming)
  }

  next.sort(compareMessagesAsc)
  return next
}

/**
 * Prepends an older page of messages (for scroll-up pagination), deduplicating
 * against already-loaded items and maintaining ascending chronological order.
 */
export function prependOlderMessages(
  existing: readonly ChatMessageItem[],
  older: readonly ChatMessageItem[]
): ChatMessageItem[] {
  const byId = new Map<string, ChatMessageItem>()
  for (const item of older) {
    byId.set(item.id, item)
  }
  for (const item of existing) {
    byId.set(item.id, item)
  }
  return Array.from(byId.values()).sort(compareMessagesAsc)
}

export async function ensureTenantChatRoomWithClient(
  supabase: SupabaseClient,
  tenantId: string
): Promise<ChatRoomInfo> {
  const { data, error } = await supabase.rpc("ensure_tenant_chat_room", {
    p_tenant_id: tenantId,
  })
  if (error || !data) {
    throw new Error(error?.message ?? "Gagal menyiapkan ruang obrolan RT.")
  }
  return mapRawChatRoom(data as RawChatRoomRow)
}

export async function listChatMessagesWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roomId,
    before,
    limit = CHAT_DEFAULT_PAGE_LIMIT,
    maskModeratedContent = true,
  }: {
    tenantId: string
    roomId: string
    before?: string
    limit?: number
    maskModeratedContent?: boolean
  }
): Promise<{ items: ChatMessageItem[]; hasMore: boolean; oldestCursor: string | null }> {
  let query = supabase
    .from("chat_messages")
    .select(CHAT_MESSAGE_SELECT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1)

  if (before) {
    query = query.lt("created_at", before)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(error.message || "Gagal memuat riwayat percakapan.")
  }

  const rows = (data ?? []) as RawChatMessageRow[]
  const hasMore = rows.length > limit
  const sliced = hasMore ? rows.slice(0, limit) : rows

  // When rendering Backoffice moderation view (`maskModeratedContent === false`),
  // enrich hidden rows with original text from the moderator-only vault
  // (RLS-enforced: only active ketua_rt, sekretaris, pengurus can SELECT).
  const vaultContentById = new Map<string, string>()
  if (!maskModeratedContent) {
    const hiddenIds = sliced
      .filter((row) => row.moderation_status === "hidden_by_moderator")
      .map((row) => row.id)

    if (hiddenIds.length > 0) {
      const { data: vaultRows } = await supabase
        .from("chat_message_moderation_vault")
        .select("message_id, original_content")
        .eq("tenant_id", tenantId)
        .in("message_id", hiddenIds)

      for (const entry of (vaultRows ?? []) as {
        message_id: string
        original_content: string
      }[]) {
        vaultContentById.set(entry.message_id, entry.original_content)
      }
    }
  }

  const items = sliced
    .map((row) => {
      const vaultText = vaultContentById.get(row.id)
      const enrichedRow =
        vaultText !== undefined ? { ...row, content: vaultText } : row
      return mapRawChatMessage(enrichedRow, maskModeratedContent)
    })
    .reverse()

  return {
    items,
    hasMore,
    oldestCursor: items.length > 0 ? items[0].createdAt : null,
  }
}

export async function loadInitialChatPageWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    limit = CHAT_DEFAULT_PAGE_LIMIT,
    maskModeratedContent = true,
  }: {
    tenantId: string
    limit?: number
    maskModeratedContent?: boolean
  }
): Promise<ChatMessagesPage> {
  const room = await ensureTenantChatRoomWithClient(supabase, tenantId)
  const page = await listChatMessagesWithClient(supabase, {
    tenantId,
    roomId: room.id,
    limit,
    maskModeratedContent,
  })

  return {
    room,
    items: page.items,
    hasMore: page.hasMore,
    oldestCursor: page.oldestCursor,
  }
}

export async function sendChatMessageWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roomId,
    content,
    clientMessageId,
  }: {
    tenantId: string
    roomId: string
    content: string
    clientMessageId?: string
  }
): Promise<ChatMessageItem> {
  const { data, error } = await supabase.rpc("send_chat_message", {
    p_tenant_id: tenantId,
    p_room_id: roomId,
    p_content: content,
    p_client_message_id: clientMessageId ?? null,
  })
  if (error || !data) {
    throw new Error(error?.message ?? "Gagal mengirim pesan obrolan.")
  }
  return mapRawChatMessage(data as RawChatMessageRow)
}

export async function deleteOwnChatMessageWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    messageId,
  }: {
    tenantId: string
    messageId: string
  }
): Promise<ChatMessageItem> {
  const { data, error } = await supabase.rpc("delete_own_chat_message", {
    p_tenant_id: tenantId,
    p_message_id: messageId,
  })
  if (error || !data) {
    throw new Error(error?.message ?? "Gagal menghapus pesan.")
  }
  return mapRawChatMessage(data as RawChatMessageRow)
}

export async function moderateChatMessageWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    messageId,
    action,
    reason,
  }: {
    tenantId: string
    messageId: string
    action: "hide" | "restore"
    reason?: string
  }
): Promise<ChatMessageItem> {
  const { data, error } = await supabase.rpc("moderate_chat_message", {
    p_tenant_id: tenantId,
    p_message_id: messageId,
    p_action: action,
    p_reason: reason ?? null,
  })
  if (error || !data) {
    throw new Error(error?.message ?? "Gagal memoderasi pesan.")
  }

  let row = data as RawChatMessageRow
  if (action === "hide") {
    const { data: vaultRow } = await supabase
      .from("chat_message_moderation_vault")
      .select("original_content")
      .eq("tenant_id", tenantId)
      .eq("message_id", messageId)
      .maybeSingle()

    if (
      vaultRow &&
      typeof (vaultRow as { original_content?: unknown }).original_content ===
        "string"
    ) {
      row = {
        ...row,
        content: (vaultRow as { original_content: string }).original_content,
      }
    }
  }

  return mapRawChatMessage(row, false)
}

