import {
  activitiesJson,
  handleActivityRouteError,
  requireScopedActivityApiContext,
} from "@/lib/activities/http"
import { getResidentActivityRegistration } from "@/lib/activities/queries"
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
    "resident",
    "Anda tidak memiliki akses status pendaftaran kegiatan pada workspace ini."
  )
  if (!auth.ok) return auth.response

  try {
    const { tenant } = auth.context
    const registration = await getResidentActivityRegistration({
      tenantId: tenant.tenantId,
      residentId: tenant.residentId,
      activityId: id,
    })

    if (!registration) {
      return activitiesJson(
        { error: "Kegiatan warga tidak ditemukan." },
        404
      )
    }

    return activitiesJson(registration, 200)
  } catch (err) {
    return handleActivityRouteError(
      err,
      "Gagal memuat status pendaftaran kegiatan."
    )
  }
}

