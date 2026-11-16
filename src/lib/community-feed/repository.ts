import type { SupabaseClient } from "@supabase/supabase-js"

import { getInitials } from "@/lib/auth/workspace"
import type { RoleCode } from "@/lib/auth/types"
import {
  COMMUNITY_COMMENT_DEFAULT_LIMIT,
  COMMUNITY_COMMENT_MAX_LIMIT,
  COMMUNITY_COMMENT_PREVIEW_COUNT,
  COMMUNITY_FEED_DEFAULT_LIMIT,
  COMMUNITY_FEED_MAX_LIMIT,
  COMMUNITY_MEDIA_BUCKET,
} from "@/lib/community-feed/constants"
import {
  CommunityFeedServiceError,
  mapCommunityFeedDbError,
} from "@/lib/community-feed/errors"
import {
  cleanupMediaPathsSchema,
  commentsListQuerySchema,
  communityUuidSchema,
  createCommentSchema,
  createCommunityPostSchema,
  dismissReportSchema,
  feedListQuerySchema,
  moderateContentSchema,
  reportContentSchema,
  toggleLikeSchema,
  updateCommentSchema,
  updateCommunityPostSchema,
} from "@/lib/community-feed/schemas"
import {
  buildCommunityMediaApiUrl,
  buildCommunityMediaPath,
  communityMediaPathBelongsToMember,
  type ValidatedCommunityImageFile,
} from "@/lib/community-feed/storage"
import {
  canModerateCommunityFeed,
  type CommunityAuthorInfo,
  type CommunityCommentItem,
  type CommunityCommentsPage,
  type CommunityFeedPage,
  type CommunityModerationAuditItem,
  type CommunityModerationDashboardData,
  type CommunityModerationPostItem,
  type CommunityModerationStatus,
  type CommunityPostItem,
  type CommunityPostMediaItem,
  type CommunityReportCategory,
  type CommunityReportItem,
  type CommunityReportStatus,
  type CommunityReportTargetType,
} from "@/lib/community-feed/types"

export const COMMUNITY_POST_SELECT_COLUMNS =
  "id, tenant_id, author_member_id, caption, media_count, like_count, comment_count, moderation_status, moderated_by_member_id, moderated_at, moderation_reason, created_at, updated_at" as const

export const COMMUNITY_MEDIA_SELECT_COLUMNS =
  "id, tenant_id, post_id, mime_type, file_size_bytes, sort_order, created_at" as const

export const COMMUNITY_COMMENT_SELECT_COLUMNS =
  "id, tenant_id, post_id, author_member_id, parent_comment_id, content, moderation_status, created_at, updated_at" as const

export const COMMUNITY_REPORT_SELECT_COLUMNS =
  "id, tenant_id, reporter_member_id, target_type, post_id, comment_id, reason_category, reason_detail, status, reviewed_by_member_id, reviewed_at, resolution_note, created_at" as const

interface RawPostRow {
  id: string
  tenant_id: string
  author_member_id: string
  caption: string | null
  media_count: number
  like_count: number
  comment_count: number
  moderation_status: CommunityModerationStatus
  moderated_by_member_id: string | null
  moderated_at: string | null
  moderation_reason: string | null
  created_at: string
  updated_at: string
}

interface RawMediaRow {
  id: string
  tenant_id: string
  post_id: string
  mime_type: string
  file_size_bytes: number
  sort_order: number
}

interface RawCommentRow {
  id: string
  tenant_id: string
  post_id: string
  author_member_id: string
  parent_comment_id: string | null
  content: string
  moderation_status: CommunityModerationStatus
  created_at: string
  updated_at: string
}

interface RawReportRow {
  id: string
  tenant_id: string
  reporter_member_id: string
  target_type: CommunityReportTargetType
  post_id: string | null
  comment_id: string | null
  reason_category: CommunityReportCategory
  reason_detail: string | null
  status: CommunityReportStatus
  reviewed_by_member_id: string | null
  reviewed_at: string | null
  resolution_note: string | null
  created_at: string
}

interface RawAuthorRpcRow {
  member_id: string
  display_name: string
  staff_badge: string | null
}

interface RawAuditLogRpcRow {
  id: string
  action: string
  entity_type: string
  entity_id: string | null
  actor_name: string
  metadata: Record<string, unknown> | null
  created_at: string
}

function fallbackAuthor(memberId: string): CommunityAuthorInfo {
  return {
    memberId,
    displayName: "Warga RT",
    initials: "WR",
    staffBadge: null,
  }
}

async function resolveCommunityAuthorsMap(
  supabase: SupabaseClient,
  tenantId: string,
  memberIds: readonly (string | null | undefined)[]
): Promise<Map<string, CommunityAuthorInfo>> {
  const uniqueIds = Array.from(
    new Set(memberIds.filter((id): id is string => Boolean(id)))
  )
  const map = new Map<string, CommunityAuthorInfo>()
  if (uniqueIds.length === 0) return map

  const { data, error } = await supabase.rpc("get_community_feed_authors", {
    p_tenant_id: tenantId,
    p_member_ids: uniqueIds,
  })

  if (error) {
    throw mapCommunityFeedDbError(error)
  }

  for (const row of (data ?? []) as RawAuthorRpcRow[]) {
    const displayName = row.display_name?.trim() || "Warga RT"
    map.set(row.member_id, {
      memberId: row.member_id,
      displayName,
      initials: getInitials(displayName),
      staffBadge: row.staff_badge ?? null,
    })
  }

  return map
}

function mapMediaRow(row: RawMediaRow): CommunityPostMediaItem {
  return {
    id: row.id,
    mimeType: row.mime_type,
    fileSizeBytes: row.file_size_bytes,
    sortOrder: row.sort_order,
    url: buildCommunityMediaApiUrl(row.id),
  }
}

function mapCommentRow(
  row: RawCommentRow,
  authorMap: Map<string, CommunityAuthorInfo>,
  viewerMemberId: string
): CommunityCommentItem {
  const createdMs = Date.parse(row.created_at)
  const updatedMs = Date.parse(row.updated_at)
  const isEdited =
    !Number.isNaN(createdMs) &&
    !Number.isNaN(updatedMs) &&
    updatedMs - createdMs > 2000

  return {
    id: row.id,
    tenantId: row.tenant_id,
    postId: row.post_id,
    authorMemberId: row.author_member_id,
    author:
      authorMap.get(row.author_member_id) ??
      fallbackAuthor(row.author_member_id),
    parentCommentId: row.parent_comment_id,
    content: row.content,
    moderationStatus: row.moderation_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isOwnComment: row.author_member_id === viewerMemberId,
    isEdited,
  }
}

export async function listResidentCommunityFeedWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    viewerMemberId,
    limit = COMMUNITY_FEED_DEFAULT_LIMIT,
    cursorCreatedAt,
    cursorId,
  }: {
    tenantId: string
    viewerMemberId: string
    limit?: number
    cursorCreatedAt?: string
    cursorId?: string
  }
): Promise<CommunityFeedPage> {
  const parsed = feedListQuerySchema.safeParse({
    limit,
    cursorCreatedAt,
    cursorId,
  })
  if (!parsed.success) {
    throw new CommunityFeedServiceError(
      400,
      "VALIDATION_ERROR",
      "Parameter paginasi feed tidak valid."
    )
  }

  const safeLimit = Math.min(
    Math.max(parsed.data.limit, 1),
    COMMUNITY_FEED_MAX_LIMIT
  )

  let postQuery = supabase
    .from("community_posts")
    .select(COMMUNITY_POST_SELECT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("moderation_status", "published")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(safeLimit + 1)

  if (parsed.data.cursorCreatedAt && parsed.data.cursorId) {
    const normalizedTs = parsed.data.cursorCreatedAt.replace(
      /(\+00:00|\+0000)$/,
      "Z"
    )
    postQuery = postQuery.or(
      `created_at.lt."${normalizedTs}",and(created_at.eq."${normalizedTs}",id.lt."${parsed.data.cursorId}")`
    )
  }

  const { data: postRowsData, error: postError } = await postQuery
  if (postError) {
    throw mapCommunityFeedDbError(postError)
  }

  const allRows = (postRowsData ?? []) as RawPostRow[]
  const hasMore = allRows.length > safeLimit
  const pageRows = hasMore ? allRows.slice(0, safeLimit) : allRows
  const postIds = pageRows.map((p) => p.id)

  if (postIds.length === 0) {
    return {
      items: [],
      hasMore: false,
      nextCursor: null,
    }
  }

  const [mediaRes, likesRes, commentsRes] = await Promise.all([
    supabase
      .from("community_post_media")
      .select(COMMUNITY_MEDIA_SELECT_COLUMNS)
      .eq("tenant_id", tenantId)
      .in("post_id", postIds)
      .order("sort_order", { ascending: true }),
    supabase
      .from("community_post_likes")
      .select("post_id")
      .eq("tenant_id", tenantId)
      .eq("member_id", viewerMemberId)
      .in("post_id", postIds),
    supabase
      .from("community_post_comments")
      .select(COMMUNITY_COMMENT_SELECT_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("moderation_status", "published")
      .is("deleted_at", null)
      .in("post_id", postIds)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(postIds.length * (COMMUNITY_COMMENT_PREVIEW_COUNT + 1)),
  ])

  if (mediaRes.error) throw mapCommunityFeedDbError(mediaRes.error)
  if (likesRes.error) throw mapCommunityFeedDbError(likesRes.error)
  if (commentsRes.error) throw mapCommunityFeedDbError(commentsRes.error)

  const mediaByPost = new Map<string, CommunityPostMediaItem[]>()
  for (const m of (mediaRes.data ?? []) as RawMediaRow[]) {
    const arr = mediaByPost.get(m.post_id) ?? []
    arr.push(mapMediaRow(m))
    mediaByPost.set(m.post_id, arr)
  }

  const likedPostIds = new Set(
    ((likesRes.data ?? []) as Array<{ post_id: string }>).map(
      (r) => r.post_id
    )
  )

  const rawCommentsByPost = new Map<string, RawCommentRow[]>()
  for (const c of (commentsRes.data ?? []) as RawCommentRow[]) {
    const arr = rawCommentsByPost.get(c.post_id) ?? []
    if (arr.length < COMMUNITY_COMMENT_PREVIEW_COUNT) {
      arr.push(c)
      rawCommentsByPost.set(c.post_id, arr)
    }
  }

  const authorMemberIds: string[] = []
  for (const p of pageRows) authorMemberIds.push(p.author_member_id)
  for (const list of rawCommentsByPost.values()) {
    for (const c of list) authorMemberIds.push(c.author_member_id)
  }

  const authorMap = await resolveCommunityAuthorsMap(
    supabase,
    tenantId,
    authorMemberIds
  )

  const items: CommunityPostItem[] = pageRows.map((row) => {
    const previewDesc = rawCommentsByPost.get(row.id) ?? []
    const previewAsc = [...previewDesc]
      .reverse()
      .map((c) => mapCommentRow(c, authorMap, viewerMemberId))

    const media = mediaByPost.get(row.id) ?? []

    return {
      id: row.id,
      tenantId: row.tenant_id,
      authorMemberId: row.author_member_id,
      author:
        authorMap.get(row.author_member_id) ??
        fallbackAuthor(row.author_member_id),
      caption: row.caption,
      media,
      mediaCount: media.length,
      likeCount: Number(row.like_count ?? 0),
      commentCount: Number(row.comment_count ?? 0),
      likedByMe: likedPostIds.has(row.id),
      moderationStatus: row.moderation_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      isOwnPost: row.author_member_id === viewerMemberId,
      isEdited: false,
      previewComments: previewAsc,
    }
  })

  const lastRow = pageRows[pageRows.length - 1]
  return {
    items,
    hasMore,
    nextCursor:
      hasMore && lastRow
        ? { createdAt: lastRow.created_at, id: lastRow.id }
        : null,
  }
}

export async function getResidentCommunityPostByIdWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    viewerMemberId,
    postId,
  }: {
    tenantId: string
    viewerMemberId: string
    postId: string
  }
): Promise<CommunityPostItem | null> {
  const parsedId = communityUuidSchema.safeParse(postId)
  if (!parsedId.success) {
    throw new CommunityFeedServiceError(
      400,
      "VALIDATION_ERROR",
      "Format ID postingan tidak valid."
    )
  }

  const { data: row, error } = await supabase
    .from("community_posts")
    .select(COMMUNITY_POST_SELECT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", parsedId.data)
    .eq("moderation_status", "published")
    .is("deleted_at", null)
    .maybeSingle()

  if (error) throw mapCommunityFeedDbError(error)
  if (!row) return null

  const typedRow = row as RawPostRow

  const [mediaRes, likeRes, commentRes] = await Promise.all([
    supabase
      .from("community_post_media")
      .select(COMMUNITY_MEDIA_SELECT_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("post_id", typedRow.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("community_post_likes")
      .select("post_id")
      .eq("tenant_id", tenantId)
      .eq("post_id", typedRow.id)
      .eq("member_id", viewerMemberId)
      .maybeSingle(),
    supabase
      .from("community_post_comments")
      .select(COMMUNITY_COMMENT_SELECT_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("post_id", typedRow.id)
      .eq("moderation_status", "published")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(COMMUNITY_COMMENT_PREVIEW_COUNT),
  ])

  if (mediaRes.error) throw mapCommunityFeedDbError(mediaRes.error)
  if (likeRes.error) throw mapCommunityFeedDbError(likeRes.error)
  if (commentRes.error) throw mapCommunityFeedDbError(commentRes.error)

  const rawComments = (commentRes.data ?? []) as RawCommentRow[]
  const authorMap = await resolveCommunityAuthorsMap(supabase, tenantId, [
    typedRow.author_member_id,
    ...rawComments.map((c) => c.author_member_id),
  ])

  const media = ((mediaRes.data ?? []) as RawMediaRow[]).map(mapMediaRow)

  return {
    id: typedRow.id,
    tenantId: typedRow.tenant_id,
    authorMemberId: typedRow.author_member_id,
    author:
      authorMap.get(typedRow.author_member_id) ??
      fallbackAuthor(typedRow.author_member_id),
    caption: typedRow.caption,
    media,
    mediaCount: media.length,
    likeCount: Number(typedRow.like_count ?? 0),
    commentCount: Number(typedRow.comment_count ?? 0),
    likedByMe: Boolean(likeRes.data),
    moderationStatus: typedRow.moderation_status,
    createdAt: typedRow.created_at,
    updatedAt: typedRow.updated_at,
    isOwnPost: typedRow.author_member_id === viewerMemberId,
    isEdited: false,
    previewComments: [...rawComments]
      .reverse()
      .map((c) => mapCommentRow(c, authorMap, viewerMemberId)),
  }
}

export async function listPostCommentsWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    viewerMemberId,
    postId,
    limit = COMMUNITY_COMMENT_DEFAULT_LIMIT,
    offset = 0,
  }: {
    tenantId: string
    viewerMemberId: string
    postId: string
    limit?: number
    offset?: number
  }
): Promise<CommunityCommentsPage> {
  const parsed = commentsListQuerySchema.safeParse({
    postId,
    limit,
    offset,
  })
  if (!parsed.success) {
    throw new CommunityFeedServiceError(
      400,
      "VALIDATION_ERROR",
      "Parameter komentar tidak valid."
    )
  }

  const safeLimit = Math.min(
    Math.max(parsed.data.limit, 1),
    COMMUNITY_COMMENT_MAX_LIMIT
  )
  const safeOffset = Math.max(parsed.data.offset, 0)

  const { data: postRow, error: postErr } = await supabase
    .from("community_posts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.postId)
    .eq("moderation_status", "published")
    .is("deleted_at", null)
    .maybeSingle()

  if (postErr) throw mapCommunityFeedDbError(postErr)
  if (!postRow) {
    throw new CommunityFeedServiceError(
      404,
      "NOT_FOUND",
      "Postingan tidak ditemukan atau telah disembunyikan."
    )
  }

  const { data: rowsData, count, error } = await supabase
    .from("community_post_comments")
    .select(COMMUNITY_COMMENT_SELECT_COLUMNS, { count: "exact" })
    .eq("tenant_id", tenantId)
    .eq("post_id", parsed.data.postId)
    .eq("moderation_status", "published")
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(safeOffset, safeOffset + safeLimit - 1)

  if (error) throw mapCommunityFeedDbError(error)

  const rows = (rowsData ?? []) as RawCommentRow[]
  const authorMap = await resolveCommunityAuthorsMap(
    supabase,
    tenantId,
    rows.map((r) => r.author_member_id)
  )

  const totalCount = count ?? rows.length
  const nextOffset =
    safeOffset + rows.length < totalCount ? safeOffset + rows.length : null

  return {
    postId: parsed.data.postId,
    items: rows.map((r) => mapCommentRow(r, authorMap, viewerMemberId)),
    totalCount,
    hasMore: nextOffset !== null,
    nextOffset,
  }
}

export async function uploadCommunityMediaFileWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    memberId,
    validatedFile,
  }: {
    tenantId: string
    memberId: string
    validatedFile: ValidatedCommunityImageFile
  }
): Promise<{
  storagePath: string
  mimeType: string
  fileSizeBytes: number
}> {
  const storagePath = buildCommunityMediaPath(
    tenantId,
    memberId,
    validatedFile.extension
  )

  const { error } = await supabase.storage
    .from(COMMUNITY_MEDIA_BUCKET)
    .upload(storagePath, validatedFile.buffer, {
      contentType: validatedFile.mimeType,
      upsert: false,
    })

  if (error) {
    throw new CommunityFeedServiceError(
      500,
      "MEDIA_ERROR",
      "Gagal mengunggah gambar ke penyimpanan privat."
    )
  }

  return {
    storagePath,
    mimeType: validatedFile.mimeType,
    fileSizeBytes: validatedFile.size,
  }
}

export async function cleanupOrphanCommunityMediaWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    memberId,
    paths,
  }: {
    tenantId: string
    memberId: string
    paths: readonly string[]
  }
): Promise<number> {
  const parsed = cleanupMediaPathsSchema.safeParse({ paths })
  if (!parsed.success || parsed.data.paths.length === 0) return 0

  const ownedPaths = parsed.data.paths.filter((p) =>
    communityMediaPathBelongsToMember(p, tenantId, memberId)
  )
  if (ownedPaths.length === 0) return 0

  const { error } = await supabase.storage
    .from(COMMUNITY_MEDIA_BUCKET)
    .remove(ownedPaths)

  if (error) return 0
  return ownedPaths.length
}

export async function createCommunityPostWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    viewerMemberId,
    input,
  }: {
    tenantId: string
    viewerMemberId: string
    input: unknown
  }
): Promise<CommunityPostItem> {
  const parsed = createCommunityPostSchema.safeParse(input)
  if (!parsed.success) {
    throw new CommunityFeedServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data postingan tidak valid."
    )
  }

  for (const item of parsed.data.mediaItems) {
    if (
      !communityMediaPathBelongsToMember(
        item.storagePath,
        tenantId,
        viewerMemberId
      )
    ) {
      throw new CommunityFeedServiceError(
        403,
        "FORBIDDEN",
        "Path berkas media tidak sesuai dengan identitas Anda."
      )
    }
  }

  const { data: createdId, error } = await supabase.rpc(
    "create_community_post",
    {
      p_tenant_id: tenantId,
      p_caption: parsed.data.caption,
      p_media_items: parsed.data.mediaItems,
    }
  )

  if (error || !createdId) {
    // Cleanup uploaded media if post creation RPC failed
    if (parsed.data.mediaItems.length > 0) {
      await cleanupOrphanCommunityMediaWithClient(supabase, {
        tenantId,
        memberId: viewerMemberId,
        paths: parsed.data.mediaItems.map((m) => m.storagePath),
      })
    }
    throw mapCommunityFeedDbError(
      error ?? { message: "Failed to create post" }
    )
  }

  const post = await getResidentCommunityPostByIdWithClient(supabase, {
    tenantId,
    viewerMemberId,
    postId: String(createdId),
  })

  if (!post) {
    throw new CommunityFeedServiceError(
      500,
      "INTERNAL_ERROR",
      "Postingan berhasil dibuat namun gagal dimuat kembali."
    )
  }

  return post
}

export async function updateCommunityPostWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    viewerMemberId,
    input,
  }: {
    tenantId: string
    viewerMemberId: string
    input: unknown
  }
): Promise<CommunityPostItem> {
  const parsed = updateCommunityPostSchema.safeParse(input)
  if (!parsed.success) {
    throw new CommunityFeedServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data pembaruan postingan tidak valid."
    )
  }

  for (const item of parsed.data.newMediaItems) {
    if (
      !communityMediaPathBelongsToMember(
        item.storagePath,
        tenantId,
        viewerMemberId
      )
    ) {
      throw new CommunityFeedServiceError(
        403,
        "FORBIDDEN",
        "Path berkas media tidak sesuai dengan identitas Anda."
      )
    }
  }

  const { data: rpcResult, error } = await supabase.rpc(
    "update_community_post",
    {
      p_tenant_id: tenantId,
      p_post_id: parsed.data.postId,
      p_caption: parsed.data.caption,
      p_keep_media_ids: parsed.data.keepMediaIds ?? null,
      p_new_media_items: parsed.data.newMediaItems,
    }
  )

  if (error) {
    if (parsed.data.newMediaItems.length > 0) {
      await cleanupOrphanCommunityMediaWithClient(supabase, {
        tenantId,
        memberId: viewerMemberId,
        paths: parsed.data.newMediaItems.map((m) => m.storagePath),
      })
    }
    throw mapCommunityFeedDbError(error)
  }

  const removedPaths = (
    rpcResult as { removed_storage_paths?: string[] } | null
  )?.removed_storage_paths

  if (Array.isArray(removedPaths) && removedPaths.length > 0) {
    await supabase.storage.from(COMMUNITY_MEDIA_BUCKET).remove(removedPaths)
  }

  const post = await getResidentCommunityPostByIdWithClient(supabase, {
    tenantId,
    viewerMemberId,
    postId: parsed.data.postId,
  })

  if (!post) {
    throw new CommunityFeedServiceError(
      404,
      "NOT_FOUND",
      "Postingan tidak ditemukan."
    )
  }

  return post
}

export async function softDeleteCommunityPostWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    postId,
  }: {
    tenantId: string
    postId: string
  }
): Promise<{ postId: string; deleted: true }> {
  const parsedId = communityUuidSchema.safeParse(postId)
  if (!parsedId.success) {
    throw new CommunityFeedServiceError(
      400,
      "VALIDATION_ERROR",
      "Format ID postingan tidak valid."
    )
  }

  const { data, error } = await supabase.rpc("soft_delete_community_post", {
    p_tenant_id: tenantId,
    p_post_id: parsedId.data,
  })

  if (error) throw mapCommunityFeedDbError(error)

  const storagePaths = (data as { storage_paths?: string[] } | null)
    ?.storage_paths
  if (Array.isArray(storagePaths) && storagePaths.length > 0) {
    await supabase.storage.from(COMMUNITY_MEDIA_BUCKET).remove(storagePaths)
  }

  return {
    postId: parsedId.data,
    deleted: true,
  }
}

export async function toggleCommunityPostLikeWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    input,
  }: {
    tenantId: string
    input: unknown
  }
): Promise<{ postId: string; liked: boolean; likeCount: number }> {
  const parsed = toggleLikeSchema.safeParse(input)
  if (!parsed.success) {
    throw new CommunityFeedServiceError(
      400,
      "VALIDATION_ERROR",
      "ID postingan tidak valid."
    )
  }

  const { data, error } = await supabase.rpc("toggle_community_post_like", {
    p_tenant_id: tenantId,
    p_post_id: parsed.data.postId,
    p_desired: parsed.data.desiredLiked ?? null,
  })

  if (error || !data) {
    throw mapCommunityFeedDbError(error ?? { message: "Like toggle failed" })
  }

  const res = data as {
    post_id: string
    liked: boolean
    like_count: number
  }
  return {
    postId: res.post_id,
    liked: Boolean(res.liked),
    likeCount: Number(res.like_count ?? 0),
  }
}

export async function createCommunityPostCommentWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    viewerMemberId,
    input,
  }: {
    tenantId: string
    viewerMemberId: string
    input: unknown
  }
): Promise<{ comment: CommunityCommentItem; commentCount: number }> {
  const parsed = createCommentSchema.safeParse(input)
  if (!parsed.success) {
    throw new CommunityFeedServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Komentar tidak valid."
    )
  }

  const { data: commentId, error } = await supabase.rpc(
    "create_community_post_comment",
    {
      p_tenant_id: tenantId,
      p_post_id: parsed.data.postId,
      p_content: parsed.data.content,
      p_parent_comment_id: parsed.data.parentCommentId ?? null,
    }
  )

  if (error || !commentId) {
    throw mapCommunityFeedDbError(error ?? { message: "Comment create failed" })
  }

  const [{ data: commentRow, error: rowErr }, { data: postRow }] =
    await Promise.all([
      supabase
        .from("community_post_comments")
        .select(COMMUNITY_COMMENT_SELECT_COLUMNS)
        .eq("tenant_id", tenantId)
        .eq("id", String(commentId))
        .maybeSingle(),
      supabase
        .from("community_posts")
        .select("comment_count")
        .eq("tenant_id", tenantId)
        .eq("id", parsed.data.postId)
        .maybeSingle(),
    ])

  if (rowErr || !commentRow) {
    throw new CommunityFeedServiceError(
      500,
      "INTERNAL_ERROR",
      "Komentar terkirim namun gagal dimuat."
    )
  }

  const typed = commentRow as RawCommentRow
  const authorMap = await resolveCommunityAuthorsMap(supabase, tenantId, [
    typed.author_member_id,
  ])

  return {
    comment: mapCommentRow(typed, authorMap, viewerMemberId),
    commentCount: Number(
      (postRow as { comment_count?: number } | null)?.comment_count ?? 0
    ),
  }
}

export async function updateCommunityPostCommentWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    viewerMemberId,
    input,
  }: {
    tenantId: string
    viewerMemberId: string
    input: unknown
  }
): Promise<CommunityCommentItem> {
  const parsed = updateCommentSchema.safeParse(input)
  if (!parsed.success) {
    throw new CommunityFeedServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Komentar tidak valid."
    )
  }

  const { error } = await supabase.rpc("update_community_post_comment", {
    p_tenant_id: tenantId,
    p_comment_id: parsed.data.commentId,
    p_content: parsed.data.content,
  })

  if (error) throw mapCommunityFeedDbError(error)

  const { data: commentRow, error: fetchErr } = await supabase
    .from("community_post_comments")
    .select(COMMUNITY_COMMENT_SELECT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.commentId)
    .maybeSingle()

  if (fetchErr || !commentRow) {
    throw new CommunityFeedServiceError(
      404,
      "NOT_FOUND",
      "Komentar tidak ditemukan."
    )
  }

  const typed = commentRow as RawCommentRow
  const authorMap = await resolveCommunityAuthorsMap(supabase, tenantId, [
    typed.author_member_id,
  ])
  return mapCommentRow(typed, authorMap, viewerMemberId)
}

export async function softDeleteCommunityPostCommentWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    commentId,
  }: {
    tenantId: string
    commentId: string
  }
): Promise<{ commentId: string; postId: string; commentCount: number }> {
  const parsedId = communityUuidSchema.safeParse(commentId)
  if (!parsedId.success) {
    throw new CommunityFeedServiceError(
      400,
      "VALIDATION_ERROR",
      "Format ID komentar tidak valid."
    )
  }

  const { data, error } = await supabase.rpc(
    "soft_delete_community_post_comment",
    {
      p_tenant_id: tenantId,
      p_comment_id: parsedId.data,
    }
  )

  if (error || !data) {
    throw mapCommunityFeedDbError(error ?? { message: "Comment delete failed" })
  }

  const res = data as {
    comment_id: string
    post_id: string
    comment_count: number
  }
  return {
    commentId: res.comment_id,
    postId: res.post_id,
    commentCount: Number(res.comment_count ?? 0),
  }
}

export async function reportCommunityContentWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    input,
  }: {
    tenantId: string
    input: unknown
  }
): Promise<{ reportId: string }> {
  const parsed = reportContentSchema.safeParse(input)
  if (!parsed.success) {
    throw new CommunityFeedServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data laporan tidak valid."
    )
  }

  const { data: reportId, error } = await supabase.rpc(
    "report_community_content",
    {
      p_tenant_id: tenantId,
      p_target_type: parsed.data.targetType,
      p_target_id: parsed.data.targetId,
      p_reason_category: parsed.data.reasonCategory,
      p_reason_detail: parsed.data.reasonDetail,
    }
  )

  if (error || !reportId) {
    throw mapCommunityFeedDbError(error ?? { message: "Report failed" })
  }

  return { reportId: String(reportId) }
}

// =============================================================================
// Backoffice Moderation Operations (ketua_rt, sekretaris, pengurus ONLY)
// =============================================================================

export async function listAdminModerationDashboardWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
  }
): Promise<CommunityModerationDashboardData> {
  if (!canModerateCommunityFeed(roles)) {
    throw new CommunityFeedServiceError(
      403,
      "FORBIDDEN",
      "Hanya Ketua RT, Sekretaris, atau Pengurus yang memiliki akses moderasi feed."
    )
  }

  const [reportsRes, postsRes, auditRes] = await Promise.all([
    supabase
      .from("community_post_reports")
      .select(COMMUNITY_REPORT_SELECT_COLUMNS)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(100),
    supabase
      .from("community_posts")
      .select(COMMUNITY_POST_SELECT_COLUMNS)
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(100),
    supabase.rpc("list_community_moderation_audit_logs", {
      p_tenant_id: tenantId,
      p_limit: 40,
    }),
  ])

  if (reportsRes.error) throw mapCommunityFeedDbError(reportsRes.error)
  if (postsRes.error) throw mapCommunityFeedDbError(postsRes.error)
  if (auditRes.error) throw mapCommunityFeedDbError(auditRes.error)

  const rawReports = (reportsRes.data ?? []) as RawReportRow[]
  const rawPosts = (postsRes.data ?? []) as RawPostRow[]
  const rawAudits = (auditRes.data ?? []) as RawAuditLogRpcRow[]

  const postIdsNeeded = Array.from(
    new Set([
      ...rawPosts.map((p) => p.id),
      ...rawReports
        .map((r) => r.post_id)
        .filter((id): id is string => Boolean(id)),
    ])
  )

  const reportedCommentIds = Array.from(
    new Set(
      rawReports
        .map((r) => r.comment_id)
        .filter((id): id is string => Boolean(id))
    )
  )

  const [mediaRes, reportedCommentsRes] = await Promise.all([
    postIdsNeeded.length > 0
      ? supabase
          .from("community_post_media")
          .select(COMMUNITY_MEDIA_SELECT_COLUMNS)
          .eq("tenant_id", tenantId)
          .in("post_id", postIdsNeeded)
          .order("sort_order", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    reportedCommentIds.length > 0
      ? supabase
          .from("community_post_comments")
          .select(COMMUNITY_COMMENT_SELECT_COLUMNS)
          .eq("tenant_id", tenantId)
          .in("id", reportedCommentIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (mediaRes.error) throw mapCommunityFeedDbError(mediaRes.error)
  if (reportedCommentsRes.error) {
    throw mapCommunityFeedDbError(reportedCommentsRes.error)
  }

  const mediaByPost = new Map<string, CommunityPostMediaItem[]>()
  for (const m of (mediaRes.data ?? []) as RawMediaRow[]) {
    const arr = mediaByPost.get(m.post_id) ?? []
    arr.push(mapMediaRow(m))
    mediaByPost.set(m.post_id, arr)
  }

  const postById = new Map<string, RawPostRow>()
  for (const p of rawPosts) postById.set(p.id, p)

  const commentById = new Map<string, RawCommentRow>()
  for (const c of (reportedCommentsRes.data ?? []) as RawCommentRow[]) {
    commentById.set(c.id, c)
  }

  const pendingReportCountByPost = new Map<string, number>()
  for (const r of rawReports) {
    if (r.status === "pending" && r.target_type === "post" && r.post_id) {
      pendingReportCountByPost.set(
        r.post_id,
        (pendingReportCountByPost.get(r.post_id) ?? 0) + 1
      )
    }
  }

  const allMemberIds: Array<string | null | undefined> = [
    ...rawPosts.flatMap((p) => [p.author_member_id, p.moderated_by_member_id]),
    ...rawReports.flatMap((r) => [r.reporter_member_id, r.reviewed_by_member_id]),
    ...Array.from(commentById.values()).map((c) => c.author_member_id),
  ]
  const authorMap = await resolveCommunityAuthorsMap(
    supabase,
    tenantId,
    allMemberIds
  )

  const reports: CommunityReportItem[] = rawReports.map((r) => {
    const targetPost = r.post_id ? postById.get(r.post_id) : null
    const targetComment = r.comment_id ? commentById.get(r.comment_id) : null
    const reporter =
      authorMap.get(r.reporter_member_id) ?? fallbackAuthor(r.reporter_member_id)
    const reviewer = r.reviewed_by_member_id
      ? authorMap.get(r.reviewed_by_member_id)?.displayName ?? "Pengurus RT"
      : null

    let targetPreview: CommunityReportItem["targetPreview"]
    if (r.target_type === "post") {
      const targetAuthor = targetPost
        ? authorMap.get(targetPost.author_member_id)?.displayName ?? "Warga RT"
        : "Warga RT"
      targetPreview = {
        exists: Boolean(targetPost),
        authorName: targetAuthor,
        contentText: targetPost?.caption ?? null,
        moderationStatus: targetPost?.moderation_status ?? null,
        media: targetPost ? (mediaByPost.get(targetPost.id) ?? []) : [],
        parentPostId: targetPost?.id ?? null,
      }
    } else {
      const targetAuthor = targetComment
        ? authorMap.get(targetComment.author_member_id)?.displayName ??
          "Warga RT"
        : "Warga RT"
      targetPreview = {
        exists: Boolean(targetComment),
        authorName: targetAuthor,
        contentText: targetComment?.content ?? null,
        moderationStatus: targetComment?.moderation_status ?? null,
        media: [],
        parentPostId: targetComment?.post_id ?? null,
      }
    }

    return {
      id: r.id,
      tenantId: r.tenant_id,
      targetType: r.target_type,
      postId: r.post_id,
      commentId: r.comment_id,
      reporterMemberId: r.reporter_member_id,
      reporterName: reporter.displayName,
      reasonCategory: r.reason_category,
      reasonDetail: r.reason_detail,
      status: r.status,
      reviewedByName: reviewer,
      reviewedAt: r.reviewed_at,
      resolutionNote: r.resolution_note,
      createdAt: r.created_at,
      targetPreview,
    }
  })

  const posts: CommunityModerationPostItem[] = rawPosts.map((p) => ({
    id: p.id,
    tenantId: p.tenant_id,
    authorMemberId: p.author_member_id,
    author:
      authorMap.get(p.author_member_id) ?? fallbackAuthor(p.author_member_id),
    caption: p.caption,
    media: mediaByPost.get(p.id) ?? [],
    likeCount: Number(p.like_count ?? 0),
    commentCount: Number(p.comment_count ?? 0),
    moderationStatus: p.moderation_status,
    moderationReason: p.moderation_reason,
    moderatedAt: p.moderated_at,
    moderatedByName: p.moderated_by_member_id
      ? authorMap.get(p.moderated_by_member_id)?.displayName ?? "Pengurus RT"
      : null,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    pendingReportCount: pendingReportCountByPost.get(p.id) ?? 0,
  }))

  const auditLogs: CommunityModerationAuditItem[] = rawAudits.map((a) => ({
    id: a.id,
    action: a.action,
    entityType: a.entity_type,
    entityId: a.entity_id,
    actorName: a.actor_name || "Pengurus RT",
    metadata: a.metadata ?? {},
    createdAt: a.created_at,
  }))

  return {
    reports,
    posts,
    auditLogs,
    pendingReportCount: reports.filter((r) => r.status === "pending").length,
    hiddenPostCount: posts.filter((p) => p.moderationStatus === "hidden").length,
  }
}

export async function moderateCommunityContentWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    input,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    input: unknown
  }
): Promise<{
  targetType: CommunityReportTargetType
  targetId: string
  moderationStatus: CommunityModerationStatus
}> {
  if (!canModerateCommunityFeed(roles)) {
    throw new CommunityFeedServiceError(
      403,
      "FORBIDDEN",
      "Hanya Ketua RT, Sekretaris, atau Pengurus yang dapat memoderasi konten feed."
    )
  }

  const parsed = moderateContentSchema.safeParse(input)
  if (!parsed.success) {
    throw new CommunityFeedServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data moderasi tidak valid."
    )
  }

  const rpcName =
    parsed.data.targetType === "post"
      ? "moderate_community_post"
      : "moderate_community_comment"

  const rpcArgs =
    parsed.data.targetType === "post"
      ? {
          p_tenant_id: tenantId,
          p_post_id: parsed.data.targetId,
          p_action: parsed.data.action,
          p_reason: parsed.data.reason ?? null,
          p_report_id: parsed.data.reportId ?? null,
        }
      : {
          p_tenant_id: tenantId,
          p_comment_id: parsed.data.targetId,
          p_action: parsed.data.action,
          p_reason: parsed.data.reason ?? null,
          p_report_id: parsed.data.reportId ?? null,
        }

  const { data, error } = await supabase.rpc(rpcName, rpcArgs)
  if (error || !data) {
    throw mapCommunityFeedDbError(error ?? { message: "Moderation failed" })
  }

  const res = data as { moderation_status: CommunityModerationStatus }
  return {
    targetType: parsed.data.targetType,
    targetId: parsed.data.targetId,
    moderationStatus: res.moderation_status,
  }
}

export async function dismissCommunityReportWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    input,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    input: unknown
  }
): Promise<{ reportId: string; status: "dismissed" }> {
  if (!canModerateCommunityFeed(roles)) {
    throw new CommunityFeedServiceError(
      403,
      "FORBIDDEN",
      "Hanya Ketua RT, Sekretaris, atau Pengurus yang dapat menolak laporan."
    )
  }

  const parsed = dismissReportSchema.safeParse(input)
  if (!parsed.success) {
    throw new CommunityFeedServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data laporan tidak valid."
    )
  }

  const { error } = await supabase.rpc("dismiss_community_report", {
    p_tenant_id: tenantId,
    p_report_id: parsed.data.reportId,
    p_resolution_note: parsed.data.resolutionNote ?? null,
  })

  if (error) throw mapCommunityFeedDbError(error)

  return {
    reportId: parsed.data.reportId,
    status: "dismissed",
  }
}

