import { type NextRequest } from "next/server"

import {
  handleRondaRouteError,
  requireScopedRondaApiContext,
  rondaJson,
} from "@/lib/ronda/http"
import { listEligibleRondaResidents } from "@/lib/ronda/queries"
import { canManageRonda } from "@/lib/ronda/types"

export async function GET(request: NextRequest) {
  const auth = await requireScopedRondaApiContext(
    "admin",
    "Anda tidak memiliki akses kandidat petugas ronda pada workspace ini."
  )
  if (!auth.ok) return auth.response

  const { tenant } = auth.context
  if (!canManageRonda(tenant.roles)) {
    return rondaJson(
      {
        error:
          "Hanya Ketua RT atau Sekretaris yang berhak mengakses kandidat petugas ronda.",
      },
      403
    )
  }

  const search = request.nextUrl.searchParams.get("search") ?? undefined

  try {
    const items = await listEligibleRondaResidents({
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      search,
    })
    return rondaJson({ items }, 200)
  } catch (err) {
    return handleRondaRouteError(
      err,
      "Gagal memuat daftar kandidat warga untuk ronda."
    )
  }
}

