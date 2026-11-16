import { type NextRequest } from "next/server"

import {
  handleRondaRouteError,
  parseRondaScheduleFilterParams,
  requireScopedRondaApiContext,
  rondaJson,
} from "@/lib/ronda/http"
import { listAdminRondaSchedules } from "@/lib/ronda/queries"

export async function GET(request: NextRequest) {
  const auth = await requireScopedRondaApiContext(
    "admin",
    "Anda tidak memiliki akses jadwal ronda pengurus pada workspace ini."
  )
  if (!auth.ok) return auth.response

  const parsed = parseRondaScheduleFilterParams(request)
  if (!parsed.ok) return parsed.response

  try {
    const { tenant } = auth.context
    const result = await listAdminRondaSchedules({
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      filters: parsed.data,
    })
    return rondaJson(result, 200)
  } catch (err) {
    return handleRondaRouteError(err, "Gagal memuat daftar jadwal ronda.")
  }
}
