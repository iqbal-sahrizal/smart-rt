import { NextResponse, connection } from "next/server"

import {
  communityFeedJson,
  requireOperationalFeedApiContext,
} from "@/lib/community-feed/http"
import {
  COMMUNITY_MEDIA_BUCKET,
  communityMediaPathBelongsToTenant,
  inferCommunityMediaContentType,
  isValidCommunityMediaPath,
} from "@/lib/community-feed/storage"
import { canModerateCommunityFeed } from "@/lib/community-feed/types"
import { isValidUuid } from "@/lib/residents/schemas"
import { createClient } from "@/lib/supabase/server"

export async function GET(
  _request: Request,
  context: { params: Promise<{ mediaId: string }> }
) {
  await connection()

  const { mediaId } = await context.params
  if (!isValidUuid(mediaId)) {
    return communityFeedJson({ error: "ID media tidak valid." }, 400)
  }

  const auth = await requireOperationalFeedApiContext()
  if (!auth.ok) return auth.response

  const { tenant } = auth.context

  if (auth.scope === "admin" && !canModerateCommunityFeed(tenant.roles)) {
    return communityFeedJson(
      { error: "Role Anda tidak memiliki izin melihat media moderasi feed." },
      403
    )
  }

  const supabase = await createClient()
  const { data: mediaRowData, error: mediaErr } = await supabase
    .from("community_post_media")
    .select("id, tenant_id, post_id, storage_path")
    .eq("id", mediaId)
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle()

  if (mediaErr || !mediaRowData) {
    return communityFeedJson(
      { error: "Media postingan tidak ditemukan atau tidak memiliki akses." },
      404
    )
  }

  const mediaRow = mediaRowData as {
    id: string
    tenant_id: string
    post_id: string
    storage_path: string
  }

  const { data: postRowData, error: postErr } = await supabase
    .from("community_posts")
    .select("id, tenant_id, moderation_status, deleted_at")
    .eq("id", mediaRow.post_id)
    .eq("tenant_id", tenant.tenantId)
    .is("deleted_at", null)
    .maybeSingle()

  if (postErr || !postRowData) {
    return communityFeedJson(
      { error: "Postingan tidak ditemukan atau telah dihapus." },
      404
    )
  }

  const postRow = postRowData as {
    id: string
    tenant_id: string
    moderation_status: string
    deleted_at: string | null
  }

  if (auth.scope === "resident" && postRow.moderation_status !== "published") {
    return communityFeedJson(
      { error: "Media tidak tersedia karena postingan sedang dimoderasi." },
      404
    )
  }

  if (
    !isValidCommunityMediaPath(mediaRow.storage_path) ||
    !communityMediaPathBelongsToTenant(mediaRow.storage_path, tenant.tenantId)
  ) {
    return communityFeedJson({ error: "Path media tidak valid." }, 404)
  }

  const { data: blob, error: downloadErr } = await supabase.storage
    .from(COMMUNITY_MEDIA_BUCKET)
    .download(mediaRow.storage_path)

  if (downloadErr || !blob) {
    return communityFeedJson({ error: "Gagal mengambil berkas media." }, 404)
  }

  const { contentType, extension } = inferCommunityMediaContentType(
    mediaRow.storage_path
  )
  const fileBuffer = await blob.arrayBuffer()

  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="feed-${mediaRow.id.slice(0, 8)}.${extension}"`,
      "Content-Length": String(fileBuffer.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

