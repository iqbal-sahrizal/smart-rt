import {
  complaintsJson,
  handleComplaintRouteError,
  requireScopedComplaintApiContext,
} from "@/lib/complaints/http"
import { getResidentComplaintDetail } from "@/lib/complaints/queries"
import { isValidUuid } from "@/lib/residents/schemas"

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: complaintId } = await context.params
  if (!isValidUuid(complaintId)) {
    return complaintsJson({ error: "ID pengaduan tidak valid." }, 400)
  }

  const auth = await requireScopedComplaintApiContext(
    "resident",
    "Anda tidak memiliki akses detail pengaduan warga pada workspace ini."
  )
  if (!auth.ok) return auth.response

  try {
    const { tenant } = auth.context
    const detail = await getResidentComplaintDetail({
      tenantId: tenant.tenantId,
      memberId: tenant.memberId,
      roles: tenant.roles,
      complaintId,
    })
    if (!detail) {
      return complaintsJson({ error: "Pengaduan tidak ditemukan." }, 404)
    }
    return complaintsJson(detail, 200)
  } catch (err) {
    return handleComplaintRouteError(
      err,
      "Gagal memuat detail pengaduan warga."
    )
  }
}

