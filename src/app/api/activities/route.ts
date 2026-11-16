import { type NextRequest } from "next/server"

import {
  activitiesJson,
  handleActivityRouteError,
  parseActivityFilterParams,
  requireScopedActivityApiContext,
} from "@/lib/activities/http"
import { listAdminActivities } from "@/lib/activities/queries"

export async function GET(request: NextRequest) {
  const auth = await requireScopedActivityApiContext(
    "admin",
    "Anda tidak memiliki akses daftar kegiatan pengurus pada workspace ini."
  )
  if (!auth.ok) return auth.response

  const parsed = parseActivityFilterParams(request)
  if (!parsed.ok) return parsed.response

  try {
    const { tenant } = auth.context
    const result = await listAdminActivities({
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      filters: parsed.data,
    })
    return activitiesJson(result, 200)
  } catch (err) {
    return handleActivityRouteError(err, "Gagal memuat daftar kegiatan warga.")
  }
}

