import "server-only"

import { createClient } from "@/lib/supabase/server"
import type { TenantIdentity } from "@/lib/tenants/schemas"

export async function getTenantIdentity(
  tenantId: string
): Promise<TenantIdentity | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("tenants")
    .select(
      "id, code, name, rt_number, rw_number, kelurahan, kecamatan, city, province, status, settings, updated_at"
    )
    .eq("id", tenantId)
    .is("deleted_at", null)
    .maybeSingle()

  if (error || !data) {
    return null
  }

  const settings = (data.settings ?? {}) as Record<string, unknown>

  return {
    id: data.id,
    code: data.code,
    name: data.name,
    rtNumber: data.rt_number,
    rwNumber: data.rw_number,
    kelurahan: data.kelurahan,
    kecamatan: data.kecamatan,
    city: data.city,
    province: data.province,
    postalCode: typeof settings.postal_code === "string" ? settings.postal_code : null,
    logoUrl: typeof settings.logo_url === "string" ? settings.logo_url : null,
    status: data.status,
    updatedAt: data.updated_at,
  }
}

