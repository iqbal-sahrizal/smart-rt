import { type NextRequest } from "next/server"

import {
  handleRondaRouteError,
  requireScopedRondaApiContext,
  rondaJson,
} from "@/lib/ronda/http"
import { listAdminRondaAttendance } from "@/lib/ronda/queries"
import { rondaAttendanceFiltersSchema } from "@/lib/ronda/schemas"
import { canReadAllRondaAttendance } from "@/lib/ronda/types"

export async function GET(request: NextRequest) {
  const auth = await requireScopedRondaApiContext(
    "admin",
    "Anda tidak memiliki akses rekap kehadiran ronda pada workspace ini."
  )
  if (!auth.ok) return auth.response

  const { tenant } = auth.context
  if (!canReadAllRondaAttendance(tenant.roles)) {
    return rondaJson(
      {
        error:
          "Hanya Ketua RT atau Sekretaris yang berhak mengakses rekap kehadiran ronda.",
      },
      403
    )
  }

  const parsed = rondaAttendanceFiltersSchema.safeParse({
    scheduleId: request.nextUrl.searchParams.get("scheduleId") ?? undefined,
    fromDate: request.nextUrl.searchParams.get("fromDate") ?? undefined,
    toDate: request.nextUrl.searchParams.get("toDate") ?? undefined,
  })

  if (!parsed.success) {
    return rondaJson(
      { error: "Parameter filter rekap kehadiran ronda tidak valid." },
      400
    )
  }

  try {
    const items = await listAdminRondaAttendance({
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      scheduleId: parsed.data.scheduleId,
      fromDate: parsed.data.fromDate,
      toDate: parsed.data.toDate,
    })
    return rondaJson({ items }, 200)
  } catch (err) {
    return handleRondaRouteError(
      err,
      "Gagal memuat rekap kehadiran jadwal ronda."
    )
  }
}

