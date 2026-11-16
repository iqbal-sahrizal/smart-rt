import { type NextRequest } from "next/server"

import {
  handleLetterRouteError,
  lettersJson,
  parseLetterFilterParams,
  requireScopedLetterApiContext,
} from "@/lib/letters/http"
import { listAdminLetterRequests } from "@/lib/letters/queries"

export async function GET(request: NextRequest) {
  const auth = await requireScopedLetterApiContext(
    "admin",
    "Anda tidak memiliki akses daftar permohonan surat pengurus pada workspace ini."
  )
  if (!auth.ok) return auth.response

  const parsed = parseLetterFilterParams(request)
  if (!parsed.ok) return parsed.response

  try {
    const { tenant } = auth.context
    const result = await listAdminLetterRequests({
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      filters: parsed.data,
    })
    return lettersJson(result, 200)
  } catch (err) {
    return handleLetterRouteError(
      err,
      "Gagal memuat daftar permohonan surat."
    )
  }
}

