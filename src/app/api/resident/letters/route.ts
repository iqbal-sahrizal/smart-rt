import { type NextRequest } from "next/server"

import {
  handleLetterRouteError,
  lettersJson,
  parseLetterFilterParams,
  requireScopedLetterApiContext,
} from "@/lib/letters/http"
import { listResidentLetterRequests } from "@/lib/letters/queries"

export async function GET(request: NextRequest) {
  const auth = await requireScopedLetterApiContext(
    "resident",
    "Hanya warga pada workspace aktif yang dapat mengakses daftar permohonan surat."
  )
  if (!auth.ok) return auth.response

  const parsed = parseLetterFilterParams(request)
  if (!parsed.ok) return parsed.response

  try {
    const { tenant } = auth.context
    const result = await listResidentLetterRequests({
      tenantId: tenant.tenantId,
      memberId: tenant.memberId,
      residentId: tenant.residentId,
      filters: parsed.data,
    })
    return lettersJson(result, 200)
  } catch (err) {
    return handleLetterRouteError(
      err,
      "Gagal memuat daftar permohonan surat Anda."
    )
  }
}

