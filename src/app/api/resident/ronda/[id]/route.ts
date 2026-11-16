import { connection } from "next/server"

import { isValidUuid } from "@/lib/residents/schemas"
import {
  handleRondaRouteError,
  requireScopedRondaApiContext,
  rondaJson,
} from "@/lib/ronda/http"
import { getResidentRondaScheduleDetail } from "@/lib/ronda/queries"

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  await connection()

  const { id: scheduleId } = await context.params
  if (!isValidUuid(scheduleId)) {
    return rondaJson({ error: "ID jadwal ronda tidak valid." }, 400)
  }

  const auth = await requireScopedRondaApiContext(
    "resident",
    "Anda tidak memiliki akses detail jadwal ronda warga pada workspace ini."
  )
  if (!auth.ok) return auth.response

  try {
    const { tenant } = auth.context
    const detail = await getResidentRondaScheduleDetail({
      tenantId: tenant.tenantId,
      scheduleId: scheduleId.trim(),
    })

    if (!detail) {
      return rondaJson(
        { error: "Jadwal ronda tidak ditemukan pada RT aktif." },
        404
      )
    }

    return rondaJson(detail, 200)
  } catch (err) {
    return handleRondaRouteError(err, "Gagal memuat detail jadwal ronda warga.")
  }
}

