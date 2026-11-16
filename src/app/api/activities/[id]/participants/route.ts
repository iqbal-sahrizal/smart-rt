import { type NextRequest } from "next/server"

import {
  activitiesJson,
  handleActivityRouteError,
  parseActivityParticipantsFilterParams,
  requireScopedActivityApiContext,
} from "@/lib/activities/http"
import { listAdminActivityParticipants } from "@/lib/activities/queries"
import { isValidUuid } from "@/lib/residents/schemas"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params
  if (!isValidUuid(id)) {
    return activitiesJson({ error: "ID kegiatan tidak valid." }, 400)
  }

  const auth = await requireScopedActivityApiContext(
    "admin",
    "Anda tidak memiliki akses daftar peserta kegiatan pada workspace ini."
  )
  if (!auth.ok) return auth.response

  const parsed = parseActivityParticipantsFilterParams(request)
  if (!parsed.ok) return parsed.response

  try {
    const { tenant } = auth.context
    const result = await listAdminActivityParticipants({
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      activityId: id,
      filters: parsed.data,
    })
    return activitiesJson(result, 200)
  } catch (err) {
    return handleActivityRouteError(
      err,
      "Gagal memuat daftar peserta kegiatan."
    )
  }
}

