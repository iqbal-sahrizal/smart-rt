import {
  handleLetterRouteError,
  lettersJson,
  requireScopedLetterApiContext,
} from "@/lib/letters/http"
import { getResidentLetterRequestDetail } from "@/lib/letters/queries"
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
    "resident",
    "Hanya warga pada workspace aktif yang dapat mengakses detail permohonan surat."
  )
  if (!auth.ok) return auth.response

  try {
    const { tenant } = auth.context
    const detail = await getResidentLetterRequestDetail({
      tenantId: tenant.tenantId,
      memberId: tenant.memberId,
      residentId: tenant.residentId,
      requestId,
    })
    if (!detail) {
      return lettersJson({ error: "Permohonan surat tidak ditemukan." }, 404)
    }
    return lettersJson(detail, 200)
  } catch (err) {
    return handleLetterRouteError(
      err,
      "Gagal memuat detail permohonan surat Anda."
    )
  }
}

