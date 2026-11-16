import { connection } from "next/server"

import {
  communityFeedJson,
  handleCommunityFeedRouteError,
  requireScopedFeedApiContext,
} from "@/lib/community-feed/http"
import { listAdminModerationDashboard } from "@/lib/community-feed/queries"

export async function GET() {
  await connection()

  const auth = await requireScopedFeedApiContext(
    "admin",
    "Hanya Ketua RT, Sekretaris, atau Pengurus yang berhak mengakses modul moderasi feed."
  )
  if (!auth.ok) return auth.response

  try {
    const dashboard = await listAdminModerationDashboard({
      tenantId: auth.context.tenant.tenantId,
      roles: auth.context.tenant.roles,
    })
    return communityFeedJson(dashboard, 200)
  } catch (err) {
    return handleCommunityFeedRouteError(
      err,
      "Gagal memuat antrean moderasi feed komunitas."
    )
  }
}

