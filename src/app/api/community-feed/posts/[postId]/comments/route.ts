import { NextRequest, connection } from "next/server"

import {
  communityFeedJson,
  handleCommunityFeedRouteError,
  requireScopedFeedApiContext,
} from "@/lib/community-feed/http"
import { listPostComments } from "@/lib/community-feed/queries"
import { commentsListQuerySchema } from "@/lib/community-feed/schemas"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ postId: string }> }
) {
  await connection()

  const auth = await requireScopedFeedApiContext(
    "resident",
    "Hanya warga aktif pada workspace warga yang dapat mengakses komentar feed."
  )
  if (!auth.ok) return auth.response

  const { postId } = await context.params
  const parsed = commentsListQuerySchema.safeParse({
    postId,
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
    offset: request.nextUrl.searchParams.get("offset") ?? undefined,
  })

  if (!parsed.success) {
    return communityFeedJson(
      { error: "Parameter daftar komentar tidak valid." },
      400
    )
  }

  try {
    const page = await listPostComments({
      tenantId: auth.context.tenant.tenantId,
      viewerMemberId: auth.context.tenant.memberId,
      postId: parsed.data.postId,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    })
    return communityFeedJson(page, 200)
  } catch (err) {
    return handleCommunityFeedRouteError(
      err,
      "Gagal memuat daftar komentar postingan."
    )
  }
}

