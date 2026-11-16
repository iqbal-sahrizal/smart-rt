import {
  handleLetterRouteError,
  lettersJson,
  requireScopedLetterApiContext,
} from "@/lib/letters/http"
import { listResidentActiveLetterTypes } from "@/lib/letters/queries"

export async function GET() {
  const auth = await requireScopedLetterApiContext(
    "resident",
    "Hanya warga pada workspace aktif yang dapat melihat jenis surat aktif."
  )
  if (!auth.ok) return auth.response

  try {
    const { tenant } = auth.context
    const items = await listResidentActiveLetterTypes({
      tenantId: tenant.tenantId,
    })
    return lettersJson({ items }, 200)
  } catch (err) {
    return handleLetterRouteError(err, "Gagal memuat daftar jenis surat aktif.")
  }
}

