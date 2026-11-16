import { NextRequest, connection } from "next/server"

import {
  communityFeedJson,
  handleCommunityFeedRouteError,
  requireScopedFeedApiContext,
} from "@/lib/community-feed/http"
import { listResidentCommunityFeed } from "@/lib/community-feed/queries"
import { feedListQuerySchema } from "@/lib/community-feed/schemas"

export async function GET(request: NextRequest) {
  await connection()

  const auth = await requireScopedFeedApiContext(
    "resident",
    "Hanya warga aktif pada workspace warga yang dapat mengakses feed komunitas."
  )
  if (!auth.ok) return auth.response

  const parsed = feedListQuerySchema.safeParse({
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
    cursorCreatedAt:
      request.nextUrl.searchParams.get("cursorCreatedAt") ?? undefined,
    cursorId: request.nextUrl.searchParams.get("cursorId") ?? undefined,
  })

  if (!parsed.success) {
    return communityFeedJson(
      { error: "Parameter paginasi feed tidak valid." },
      400
    )
  }

  try {
    const page = await listResidentCommunityFeed({
      tenantId: auth.context.tenant.tenantId,
      viewerMemberId: auth.context.tenant.memberId,
      limit: parsed.data.limit,
      cursorCreatedAt: parsed.data.cursorCreatedAt,
      cursorId: parsed.data.cursorId,
    })
    return communityFeedJson(page, 200)
  } catch (err) {
    return handleCommunityFeedRouteError(
      err,
      "Gagal memuat feed komunitas warga."
    )
  }
}

