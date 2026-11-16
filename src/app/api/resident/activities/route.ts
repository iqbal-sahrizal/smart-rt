import { type NextRequest } from "next/server"

import {
  activitiesJson,
  handleActivityRouteError,
  parseActivityFilterParams,
  requireScopedActivityApiContext,
} from "@/lib/activities/http"
import {
  listResidentActivities,
  listResidentActivityHistory,
} from "@/lib/activities/queries"

export async function GET(request: NextRequest) {
  const auth = await requireScopedActivityApiContext(
    "resident",
    "Anda tidak memiliki akses daftar kegiatan warga pada workspace ini."
  )
  if (!auth.ok) return auth.response

  const parsed = parseActivityFilterParams(request)
  if (!parsed.ok) return parsed.response

  const view = request.nextUrl.searchParams.get("view")

  try {
    const { tenant } = auth.context

    if (view === "history") {
      const history = await listResidentActivityHistory({
        tenantId: tenant.tenantId,
        residentId: tenant.residentId,
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
      })
      return activitiesJson(history, 200)
    }

    const result = await listResidentActivities({
      tenantId: tenant.tenantId,
      residentId: tenant.residentId,
      filters: parsed.data,
    })
    return activitiesJson(result, 200)
  } catch (err) {
    return handleActivityRouteError(err, "Gagal memuat daftar kegiatan warga.")
  }
}

