import {
  activitiesJson,
  handleActivityRouteError,
  requireScopedActivityApiContext,
} from "@/lib/activities/http"
import { getAdminActivityDetail } from "@/lib/activities/queries"
import { isValidUuid } from "@/lib/residents/schemas"

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params
  if (!isValidUuid(id)) {
    return activitiesJson({ error: "ID kegiatan tidak valid." }, 400)
  }

  const auth = await requireScopedActivityApiContext(
    "admin",
    "Anda tidak memiliki akses detail kegiatan pengurus pada workspace ini."
  )
  if (!auth.ok) return auth.response

  try {
    const { tenant } = auth.context
    const detail = await getAdminActivityDetail({
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      activityId: id,
    })

    if (!detail) {
      return activitiesJson(
        { error: "Kegiatan warga tidak ditemukan atau tidak memiliki akses." },
        404
      )
    }

    return activitiesJson(detail, 200)
  } catch (err) {
    return handleActivityRouteError(err, "Gagal memuat detail kegiatan warga.")
  }
}

