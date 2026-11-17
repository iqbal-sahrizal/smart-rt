import type { SupabaseClient } from "@supabase/supabase-js"

import { CHAT_DEFAULT_PAGE_LIMIT } from "@/lib/live-chat/schemas"
import { CHAT_MEDIA_BUCKET } from "@/lib/live-chat/storage"
import type {
  ChatAttachmentInput,
  ChatMessageItem,
  ChatMessageModerationStatus,
  ChatMessagesPage,
  ChatReplyPreview,
  ChatRoomInfo,
} from "@/lib/live-chat/types"

export const CHAT_MESSAGE_SELECT_COLUMNS =
  "id, tenant_id, room_id, sender_user_id, sender_member_id, sender_name, sender_role_badge, content, client_message_id, reply_to_message_id, attachment_path, attachment_mime, attachment_size, moderation_status, moderation_reason, created_at, updated_at, deleted_at" as const

const SIGNED_URL_EXPIRY_SECONDS = 3600

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
  reply_to_message_id?: string | null
  attachment_path?: string | null
  attachment_mime?: string | null
  attachment_size?: number | null
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

export function buildReplyPreviewFromRow(
  row: {
    id: string
    sender_name: string
    content: string
    attachment_path?: string | null
    moderation_status: ChatMessageModerationStatus
  },
  maskModeratedContent = true
): ChatReplyPreview {
  const isDeleted = row.moderation_status === "deleted_by_sender"
  const isHidden = row.moderation_status === "hidden_by_moderator"

  if (isDeleted) {
    return {
      id: row.id,
      senderName: row.sender_name,
      content: "Pesan ini telah dihapus oleh pengirim.",
      hasAttachment: false,
      moderationStatus: row.moderation_status,
    }
  }

  if (isHidden && maskModeratedContent) {
    return {
      id: row.id,
      senderName: row.sender_name,
      content: "Pesan ini disembunyikan oleh pengurus RT.",
      hasAttachment: false,
      moderationStatus: row.moderation_status,
    }
  }

  return {
    id: row.id,
    senderName: row.sender_name,
    content: row.content || (row.attachment_path ? "Foto" : ""),
    hasAttachment: Boolean(row.attachment_path),
    moderationStatus: row.moderation_status,
  }
}

export function mapRawChatMessage(
  row: RawChatMessageRow,
  maskModeratedContent = true,
  options?: {
    replyTo?: ChatReplyPreview | null
    attachmentUrl?: string | null
  }
): ChatMessageItem {
  const isDeleted = row.moderation_status === "deleted_by_sender"
  const isHidden = row.moderation_status === "hidden_by_moderator"
  let displayContent = row.content
  let attachmentPath = row.attachment_path ?? null
  let attachmentMime = row.attachment_mime ?? null
  let attachmentSize = row.attachment_size ?? null
  let attachmentUrl = options?.attachmentUrl ?? null

  if (isDeleted) {
    displayContent = "Pesan ini telah dihapus oleh pengirim."
    attachmentPath = null
    attachmentMime = null
    attachmentSize = null
    attachmentUrl = null
  } else if (isHidden && maskModeratedContent) {
    displayContent = "Pesan ini disembunyikan oleh pengurus RT."
    attachmentPath = null
    attachmentMime = null
    attachmentSize = null
    attachmentUrl = null
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
    replyToMessageId: row.reply_to_message_id ?? null,
    replyTo: options?.replyTo ?? null,
    attachmentPath,
    attachmentMime,
    attachmentSize,
    attachmentUrl,
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
    const prev = next[matchIdx]
    next[matchIdx] = {
      ...incoming,
      replyTo: incoming.replyTo ?? prev.replyTo ?? null,
      attachmentUrl:
        incoming.attachmentPath && !incoming.attachmentUrl
          ? prev.attachmentPath === incoming.attachmentPath
            ? prev.attachmentUrl
            : null
          : incoming.attachmentUrl,
    }
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

async function resolveSignedUrlsForPaths(
  supabase: SupabaseClient,
  paths: readonly string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const unique = Array.from(new Set(paths.filter(Boolean)))
  if (unique.length === 0 || !supabase.storage) return result

  try {
    const { data, error } = await supabase.storage
      .from(CHAT_MEDIA_BUCKET)
      .createSignedUrls(unique, SIGNED_URL_EXPIRY_SECONDS)

    if (!error && Array.isArray(data)) {
      for (const entry of data) {
        if (entry?.path && entry?.signedUrl) {
          result.set(entry.path, entry.signedUrl)
        }
      }
    }
  } catch {
    // Non-fatal: UI can request signed URL on demand via /api/live-chat/media
  }

  return result
}

async function resolveReplyPreviewsForRows(
  supabase: SupabaseClient,
  {
    tenantId,
    roomId,
    rows,
    maskModeratedContent,
  }: {
    tenantId: string
    roomId: string
    rows: readonly RawChatMessageRow[]
    maskModeratedContent: boolean
  }
): Promise<Map<string, ChatReplyPreview>> {
  const map = new Map<string, ChatReplyPreview>()
  const byLoadedId = new Map<string, RawChatMessageRow>()
  for (const row of rows) {
    byLoadedId.set(row.id, row)
  }

  const missingIds = new Set<string>()
  for (const row of rows) {
    if (!row.reply_to_message_id) continue
    const localTarget = byLoadedId.get(row.reply_to_message_id)
    if (localTarget) {
      map.set(
        localTarget.id,
        buildReplyPreviewFromRow(localTarget, maskModeratedContent)
      )
    } else {
      missingIds.add(row.reply_to_message_id)
    }
  }

  if (missingIds.size === 0) return map

  const { data } = await supabase
    .from("chat_messages")
    .select("id, sender_name, content, attachment_path, moderation_status")
    .eq("tenant_id", tenantId)
    .eq("room_id", roomId)
    .in("id", Array.from(missingIds))

  for (const target of (data ?? []) as {
    id: string
    sender_name: string
    content: string
    attachment_path?: string | null
    moderation_status: ChatMessageModerationStatus
  }[]) {
    map.set(target.id, buildReplyPreviewFromRow(target, maskModeratedContent))
  }

  return map
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
): Promise<{
  items: ChatMessageItem[]
  hasMore: boolean
  oldestCursor: string | null
}> {
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
  // enrich hidden rows with original text & attachment from the moderator-only vault
  // (RLS-enforced: only active ketua_rt, sekretaris, pengurus can SELECT).
  const vaultById = new Map<
    string,
    {
      original_content: string
      original_attachment_path: string | null
      original_attachment_mime: string | null
      original_attachment_size: number | null
    }
  >()

  if (!maskModeratedContent) {
    const hiddenIds = sliced
      .filter((row) => row.moderation_status === "hidden_by_moderator")
      .map((row) => row.id)

    if (hiddenIds.length > 0) {
      const { data: vaultRows } = await supabase
        .from("chat_message_moderation_vault")
        .select(
          "message_id, original_content, original_attachment_path, original_attachment_mime, original_attachment_size"
        )
        .eq("tenant_id", tenantId)
        .in("message_id", hiddenIds)

      for (const entry of (vaultRows ?? []) as {
        message_id: string
        original_content: string
        original_attachment_path?: string | null
        original_attachment_mime?: string | null
        original_attachment_size?: number | null
      }[]) {
        vaultById.set(entry.message_id, {
          original_content: entry.original_content,
          original_attachment_path: entry.original_attachment_path ?? null,
          original_attachment_mime: entry.original_attachment_mime ?? null,
          original_attachment_size: entry.original_attachment_size ?? null,
        })
      }
    }
  }

  const enrichedRows = sliced.map((row) => {
    const v = vaultById.get(row.id)
    if (!v) return row
    return {
      ...row,
      content: v.original_content,
      attachment_path: v.original_attachment_path ?? row.attachment_path,
      attachment_mime: v.original_attachment_mime ?? row.attachment_mime,
      attachment_size: v.original_attachment_size ?? row.attachment_size,
    }
  })

  const visibleAttachmentPaths = enrichedRows
    .filter((row) => {
      if (!row.attachment_path) return false
      if (row.moderation_status === "deleted_by_sender") return false
      if (row.moderation_status === "hidden_by_moderator" && maskModeratedContent) {
        return false
      }
      return true
    })
    .map((row) => row.attachment_path!)

  const [signedUrls, replyMap] = await Promise.all([
    resolveSignedUrlsForPaths(supabase, visibleAttachmentPaths),
    resolveReplyPreviewsForRows(supabase, {
      tenantId,
      roomId,
      rows: enrichedRows,
      maskModeratedContent,
    }),
  ])

  const items = enrichedRows
    .map((row) => {
      const replyTo = row.reply_to_message_id
        ? (replyMap.get(row.reply_to_message_id) ?? null)
        : null
      const attachmentUrl = row.attachment_path
        ? (signedUrls.get(row.attachment_path) ?? null)
        : null
      return mapRawChatMessage(row, maskModeratedContent, {
        replyTo,
        attachmentUrl,
      })
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
    replyToMessageId,
    attachment,
  }: {
    tenantId: string
    roomId: string
    content: string
    clientMessageId?: string
    replyToMessageId?: string
    attachment?: ChatAttachmentInput
  }
): Promise<ChatMessageItem> {
  const { data, error } = await supabase.rpc("send_chat_message", {
    p_tenant_id: tenantId,
    p_room_id: roomId,
    p_content: content,
    p_client_message_id: clientMessageId ?? null,
    p_reply_to_message_id: replyToMessageId ?? null,
    p_attachment_path: attachment?.path ?? null,
    p_attachment_mime: attachment?.mimeType ?? null,
    p_attachment_size: attachment?.size ?? null,
  })
  if (error || !data) {
    throw new Error(error?.message ?? "Gagal mengirim pesan obrolan.")
  }

  const row = data as RawChatMessageRow
  const [signedUrls, replyMap] = await Promise.all([
    row.attachment_path
      ? resolveSignedUrlsForPaths(supabase, [row.attachment_path])
      : Promise.resolve(new Map<string, string>()),
    row.reply_to_message_id
      ? resolveReplyPreviewsForRows(supabase, {
          tenantId,
          roomId,
          rows: [row],
          maskModeratedContent: true,
        })
      : Promise.resolve(new Map<string, ChatReplyPreview>()),
  ])

  return mapRawChatMessage(row, true, {
    replyTo: row.reply_to_message_id
      ? (replyMap.get(row.reply_to_message_id) ?? null)
      : null,
    attachmentUrl: row.attachment_path
      ? (signedUrls.get(row.attachment_path) ?? null)
      : null,
  })
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
      .select(
        "original_content, original_attachment_path, original_attachment_mime, original_attachment_size"
      )
      .eq("tenant_id", tenantId)
      .eq("message_id", messageId)
      .maybeSingle()

    const typed = vaultRow as {
      original_content?: string
      original_attachment_path?: string | null
      original_attachment_mime?: string | null
      original_attachment_size?: number | null
    } | null

    if (typed) {
      row = {
        ...row,
        content:
          typeof typed.original_content === "string"
            ? typed.original_content
            : row.content,
        attachment_path: typed.original_attachment_path ?? row.attachment_path,
        attachment_mime: typed.original_attachment_mime ?? row.attachment_mime,
        attachment_size: typed.original_attachment_size ?? row.attachment_size,
      }
    }
  }

  const signedUrls = row.attachment_path
    ? await resolveSignedUrlsForPaths(supabase, [row.attachment_path])
    : new Map<string, string>()

  return mapRawChatMessage(row, false, {
    attachmentUrl: row.attachment_path
      ? (signedUrls.get(row.attachment_path) ?? null)
      : null,
  })
}

export async function getChatUnreadCountWithClient(
  supabase: SupabaseClient,
  tenantId: string
): Promise<{ roomId: string | null; unreadCount: number }> {
  const { data, error } = await supabase.rpc("get_chat_unread_count", {
    p_tenant_id: tenantId,
  })
  if (error || !data) {
    return { roomId: null, unreadCount: 0 }
  }
  const parsed = data as { roomId?: string | null; unreadCount?: number }
  return {
    roomId: parsed.roomId ?? null,
    unreadCount: typeof parsed.unreadCount === "number" ? parsed.unreadCount : 0,
  }
}

export async function markChatRoomReadWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roomId,
    lastReadMessageId,
  }: {
    tenantId: string
    roomId: string
    lastReadMessageId?: string
  }
): Promise<void> {
  const { error } = await supabase.rpc("mark_chat_room_read", {
    p_tenant_id: tenantId,
    p_room_id: roomId,
    p_last_read_message_id: lastReadMessageId ?? null,
  })
  if (error) {
    throw new Error(error.message || "Gagal memperbarui status baca chat.")
  }
}
