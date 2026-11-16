import { type NextRequest } from "next/server"

import {
  complaintsJson,
  handleComplaintRouteError,
  parseComplaintFilterParams,
  requireScopedComplaintApiContext,
} from "@/lib/complaints/http"
import { listResidentComplaints } from "@/lib/complaints/queries"

export async function GET(request: NextRequest) {
  const auth = await requireScopedComplaintApiContext(
    "resident",
    "Anda tidak memiliki akses portal pengaduan warga pada workspace ini."
  )
  if (!auth.ok) return auth.response

  const parsed = parseComplaintFilterParams(request)
  if (!parsed.ok) return parsed.response

  try {
    const { tenant } = auth.context
    const result = await listResidentComplaints({
      tenantId: tenant.tenantId,
      memberId: tenant.memberId,
      filters: parsed.data,
    })
    return complaintsJson(result, 200)
  } catch (err) {
    return handleComplaintRouteError(
      err,
      "Gagal memuat daftar pengaduan warga."
    )
  }
}

