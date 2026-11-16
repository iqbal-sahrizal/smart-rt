import {
  handleLetterRouteError,
  lettersJson,
  requireScopedLetterApiContext,
} from "@/lib/letters/http"
import { getAdminLetterRequestDetail } from "@/lib/letters/queries"
import { isValidUuid } from "@/lib/residents/schemas"

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: requestId } = await context.params
  if (!isValidUuid(requestId)) {
    return lettersJson({ error: "ID permohonan surat tidak valid." }, 400)
  }

  const auth = await requireScopedLetterApiContext(
    "admin",
    "Anda tidak memiliki akses detail permohonan surat pengurus pada workspace ini."
  )
  if (!auth.ok) return auth.response

  try {
    const { tenant } = auth.context
    const detail = await getAdminLetterRequestDetail({
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      requestId,
    })
    if (!detail) {
      return lettersJson({ error: "Permohonan surat tidak ditemukan." }, 404)
    }
    return lettersJson(detail, 200)
  } catch (err) {
    return handleLetterRouteError(
      err,
      "Gagal memuat detail permohonan surat."
    )
  }
}

