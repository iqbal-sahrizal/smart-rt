import {
  handleLetterRouteError,
  lettersJson,
  requireScopedLetterApiContext,
} from "@/lib/letters/http"
import { listAdminLetterTypes } from "@/lib/letters/queries"

export async function GET() {
  const auth = await requireScopedLetterApiContext(
    "admin",
    "Anda tidak memiliki akses daftar jenis surat pengurus pada workspace ini."
  )
  if (!auth.ok) return auth.response

  try {
    const { tenant } = auth.context
    const result = await listAdminLetterTypes({
      tenantId: tenant.tenantId,
      roles: tenant.roles,
    })
    return lettersJson(result, 200)
  } catch (err) {
    return handleLetterRouteError(err, "Gagal memuat daftar jenis surat.")
  }
}

