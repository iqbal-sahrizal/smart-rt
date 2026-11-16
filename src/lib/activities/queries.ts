import "server-only"

import { getAuthContext } from "@/lib/auth/server"
import type {
  ActiveTenantMembership,
  AuthContextData,
  RoleCode,
} from "@/lib/auth/types"
import {
  getAdminActivityDetailWithClient,
  getResidentActivityDetailWithClient,
  getResidentActivityRegistrationWithClient,
  listAdminActivitiesWithClient,
  listAdminActivityParticipantsWithClient,
  listResidentActivitiesWithClient,
  listResidentActivityHistoryWithClient,
} from "@/lib/activities/repository"
import {
  canReadActivitiesAdmin,
  type ActivityDetail,
  type ActivityListFilters,
  type ActivityPageResult,
  type ActivityParticipantsFilters,
  type ActivityParticipantsPageResult,
  type ActivityScope,
  type ResidentActivityDetail,
  type ResidentActivityHistoryPageResult,
  type ResidentActivityPageResult,
  type ResidentActivityRegistrationDetail,
} from "@/lib/activities/types"
import { createClient } from "@/lib/supabase/server"

export interface ScopedActivityContext {
  ctx: AuthContextData
  tenant: ActiveTenantMembership
}

/**
 * Resolves the authenticated user and verified workspace tenant strictly from
 * live database memberships and validated workspace selection.
 * Never trusts client-supplied tenant_id/resident_id or non-member super_admin.
 * Bendahara without another operational role is denied access to Activities.
 */
export async function resolveScopedActivityContext(
  scope: ActivityScope
): Promise<
  | { status: "ok"; context: ScopedActivityContext }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
> {
  const ctx = await getAuthContext()
  if (!ctx) {
    return { status: "unauthenticated" }
  }

  const eligible =
    scope === "admin"
      ? ctx.memberships.filter(
          (m) => m.hasAdminRole && canReadActivitiesAdmin(m.roles)
        )
      : ctx.memberships.filter((m) => m.hasResidentRole)

  if (eligible.length === 0) {
    return { status: "forbidden" }
  }

  if (!ctx.selectedWorkspace || ctx.selectedWorkspace.type !== scope) {
    return { status: "forbidden" }
  }

  if (ctx.workspaceOptions.length > 1) {
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

/**
 * Resolves active admin (ketua_rt, sekretaris, pengurus) or resident workspace
 * context for shared operational endpoints such as the private document proxy.
 */
export async function resolveAnyOperationalActivityContext(): Promise<
  | {
      status: "ok"
      scope: ActivityScope
      context: ScopedActivityContext
    }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
> {
  const ctx = await getAuthContext()
  if (!ctx) {
    return { status: "unauthenticated" }
  }

  if (
    !ctx.selectedWorkspace ||
    ctx.selectedWorkspace.type === "super_admin" ||
    !ctx.selectedWorkspace.tenantId
  ) {
    return { status: "forbidden" }
  }

  const scope = ctx.selectedWorkspace.type
  const matched = ctx.memberships.find((m) => {
    if (m.tenantId !== ctx.selectedWorkspace?.tenantId) return false
    return scope === "admin"
      ? m.hasAdminRole && canReadActivitiesAdmin(m.roles)
      : m.hasResidentRole
  })

  if (!matched) {
    return { status: "forbidden" }
  }

  return { status: "ok", scope, context: { ctx, tenant: matched } }
}

export async function listAdminActivities({
  tenantId,
  roles,
  filters,
}: {
  tenantId: string
  roles: readonly RoleCode[]
  filters?: ActivityListFilters
}): Promise<ActivityPageResult> {
  const supabase = await createClient()
  return listAdminActivitiesWithClient(supabase, { tenantId, roles, filters })
}

export async function getAdminActivityDetail({
  tenantId,
  roles,
  activityId,
}: {
  tenantId: string
  roles: readonly RoleCode[]
  activityId: string
}): Promise<ActivityDetail | null> {
  const supabase = await createClient()
  return getAdminActivityDetailWithClient(supabase, {
    tenantId,
    roles,
    activityId,
  })
}

export async function listAdminActivityParticipants({
  tenantId,
  roles,
  activityId,
  filters,
}: {
  tenantId: string
  roles: readonly RoleCode[]
  activityId: string
  filters?: ActivityParticipantsFilters
}): Promise<ActivityParticipantsPageResult> {
  const supabase = await createClient()
  return listAdminActivityParticipantsWithClient(supabase, {
    tenantId,
    roles,
    activityId,
    filters,
  })
}

export async function listResidentActivities({
  tenantId,
  residentId,
  filters,
}: {
  tenantId: string
  residentId: string | null
  filters?: ActivityListFilters
}): Promise<ResidentActivityPageResult> {
  const supabase = await createClient()
  return listResidentActivitiesWithClient(supabase, {
    tenantId,
    residentId,
    filters,
  })
}

export async function getResidentActivityDetail({
  tenantId,
  residentId,
  activityId,
}: {
  tenantId: string
  residentId: string | null
  activityId: string
}): Promise<ResidentActivityDetail | null> {
  const supabase = await createClient()
  return getResidentActivityDetailWithClient(supabase, {
    tenantId,
    residentId,
    activityId,
  })
}

export async function getResidentActivityRegistration({
  tenantId,
  residentId,
  activityId,
}: {
  tenantId: string
  residentId: string | null
  activityId: string
}): Promise<ResidentActivityRegistrationDetail | null> {
  const supabase = await createClient()
  return getResidentActivityRegistrationWithClient(supabase, {
    tenantId,
    residentId,
    activityId,
  })
}

export async function listResidentActivityHistory({
  tenantId,
  residentId,
  page,
  pageSize,
}: {
  tenantId: string
  residentId: string | null
  page?: number
  pageSize?: number
}): Promise<ResidentActivityHistoryPageResult> {
  const supabase = await createClient()
  return listResidentActivityHistoryWithClient(supabase, {
    tenantId,
    residentId,
    page,
    pageSize,
  })
}

