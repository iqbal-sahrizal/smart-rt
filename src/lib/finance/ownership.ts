import "server-only"

import type { createClient } from "@/lib/supabase/server"

/**
 * Verifies whether the authenticated user's active tenant_member record in
 * `tenantId` owns a bill via linked `resident_id` or `household_id`.
 */
export async function checkResidentOwnsBill({
  supabase,
  tenantId,
  billHouseholdId,
  billResidentId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>
  tenantId: string
  billHouseholdId: string | null
  billResidentId: string | null
}): Promise<boolean> {
  const [{ data: myResidentId }, { data: myHouseholdId }] = await Promise.all([
    supabase.rpc("get_my_resident_id", { p_tenant_id: tenantId }),
    supabase.rpc("get_my_household_id", { p_tenant_id: tenantId }),
  ])

  const matchesResident =
    typeof myResidentId === "string" &&
    billResidentId !== null &&
    billResidentId === myResidentId
  const matchesHousehold =
    typeof myHouseholdId === "string" &&
    billHouseholdId !== null &&
    billHouseholdId === myHouseholdId

  return matchesResident || matchesHousehold
}

