import "server-only"

import { getAuthContext } from "@/lib/auth/server"
import type { ActiveTenantMembership, AuthContextData, RoleCode } from "@/lib/auth/types"
import {
  getAdminRondaScheduleDetailWithClient,
  getMyRondaAttendanceWithClient,
  getResidentRondaScheduleDetailWithClient,
  listAdminRondaAttendanceWithClient,
  listAdminRondaSchedulesWithClient,
  listEligibleRondaResidentsWithClient,
  listResidentRondaSchedulesWithClient,
} from "@/lib/ronda/repository"
import type {
  RondaAttendanceAdminRecord,
  RondaMyAttendanceRecord,
  RondaResidentCandidate,
  RondaScheduleFilters,
  RondaSchedulePageResult,
  RondaScheduleWithRoster,
  RondaScope,
} from "@/lib/ronda/types"
import { createClient } from "@/lib/supabase/server"

export interface ScopedRondaContext {
  ctx: AuthContextData
  tenant: ActiveTenantMembership
}

/**
 * Resolves the authenticated user and active workspace tenant without
 * redirecting, safe for API Route Handlers and Server Actions.
 * Never trusts tenant_id or role values supplied by the client.
 */
export async function resolveScopedRondaContext(
  scope: RondaScope
): Promise<
  | { status: "ok"; context: ScopedRondaContext }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
> {
  const ctx = await getAuthContext()
  if (!ctx) {
    return { status: "unauthenticated" }
  }

  const eligible =
    scope === "admin"
      ? ctx.memberships.filter((m) => m.hasAdminRole)
      : ctx.memberships.filter((m) => m.hasResidentRole)

  if (eligible.length === 0) {
    return { status: "forbidden" }
  }

  if (ctx.workspaceOptions.length > 1) {
    if (!ctx.selectedWorkspace || ctx.selectedWorkspace.type !== scope) {
      return { status: "forbidden" }
    }
    const matched = eligible.find(
      (m) => m.tenantId === ctx.selectedWorkspace?.tenantId
    )
    if (!matched) {
      return { status: "forbidden" }
    }
    return { status: "ok", context: { ctx, tenant: matched } }
  }

  return { status: "ok", context: { ctx, tenant: eligible[0] } }
}

export async function listAdminRondaSchedules({
  tenantId,
  roles,
  filters,
}: {
  tenantId: string
  roles: readonly RoleCode[]
  filters?: RondaScheduleFilters
}): Promise<RondaSchedulePageResult> {
  const supabase = await createClient()
  return listAdminRondaSchedulesWithClient(supabase, {
    tenantId,
    roles,
    filters,
  })
}

export async function getAdminRondaScheduleDetail({
  tenantId,
  roles,
  scheduleId,
}: {
  tenantId: string
  roles: readonly RoleCode[]
  scheduleId: string
}): Promise<RondaScheduleWithRoster | null> {
  const supabase = await createClient()
  return getAdminRondaScheduleDetailWithClient(supabase, {
    tenantId,
    roles,
    scheduleId,
  })
}

export async function listAdminRondaAttendance({
  tenantId,
  roles,
  scheduleId,
  fromDate,
  toDate,
}: {
  tenantId: string
  roles: readonly RoleCode[]
  scheduleId?: string
  fromDate?: string
  toDate?: string
}): Promise<RondaAttendanceAdminRecord[]> {
  const supabase = await createClient()
  return listAdminRondaAttendanceWithClient(supabase, {
    tenantId,
    roles,
    scheduleId,
    fromDate,
    toDate,
  })
}

export async function listEligibleRondaResidents({
  tenantId,
  roles,
  search,
}: {
  tenantId: string
  roles: readonly RoleCode[]
  search?: string
}): Promise<RondaResidentCandidate[]> {
  const supabase = await createClient()
  return listEligibleRondaResidentsWithClient(supabase, {
    tenantId,
    roles,
    search,
  })
}

export async function listResidentRondaSchedules({
  tenantId,
  filters,
}: {
  tenantId: string
  filters?: RondaScheduleFilters
}): Promise<RondaSchedulePageResult> {
  const supabase = await createClient()
  return listResidentRondaSchedulesWithClient(supabase, {
    tenantId,
    filters,
  })
}

export async function getResidentRondaScheduleDetail({
  tenantId,
  scheduleId,
}: {
  tenantId: string
  scheduleId: string
}): Promise<RondaScheduleWithRoster | null> {
  const supabase = await createClient()
  return getResidentRondaScheduleDetailWithClient(supabase, {
    tenantId,
    scheduleId,
  })
}

export async function getMyRondaAttendance({
  tenantId,
  scheduleId,
}: {
  tenantId: string
  scheduleId?: string
}): Promise<RondaMyAttendanceRecord[]> {
  const supabase = await createClient()
  return getMyRondaAttendanceWithClient(supabase, {
    tenantId,
    scheduleId,
  })
}

