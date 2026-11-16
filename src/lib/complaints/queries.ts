import "server-only"

import { getAuthContext } from "@/lib/auth/server"
import type {
  ActiveTenantMembership,
  AuthContextData,
  RoleCode,
} from "@/lib/auth/types"
import {
  getAdminComplaintDetailWithClient,
  getResidentComplaintDetailWithClient,
  listAdminComplaintsWithClient,
  listResidentComplaintsWithClient,
} from "@/lib/complaints/repository"
import {
  canReadComplaintsAdmin,
  type ComplaintDetail,
  type ComplaintListFilters,
  type ComplaintPageResult,
  type ComplaintScope,
} from "@/lib/complaints/types"
import { createClient } from "@/lib/supabase/server"

export interface ScopedComplaintContext {
  ctx: AuthContextData
  tenant: ActiveTenantMembership
}

/**
 * Resolves the authenticated user and verified workspace tenant strictly from
 * live database memberships and validated workspace selection.
 * Never treats profiles.active_tenant_id or client-supplied IDs as authorization.
 * Non-member super_admins are denied operational access.
 */
export async function resolveScopedComplaintContext(
  scope: ComplaintScope
): Promise<
  | { status: "ok"; context: ScopedComplaintContext }
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
          (m) => m.hasAdminRole && canReadComplaintsAdmin(m.roles)
        )
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

  // Single workspace option must also match requested scope cleanly
  if (!ctx.selectedWorkspace || ctx.selectedWorkspace.type !== scope) {
    return { status: "forbidden" }
  }

  return { status: "ok", context: { ctx, tenant: eligible[0] } }
}

/**
 * Resolves either active admin or resident workspace context for endpoints
 * shared by both roles (such as authenticated photo streaming).
 */
export async function resolveAnyOperationalComplaintContext(): Promise<
  | {
      status: "ok"
      scope: ComplaintScope
      context: ScopedComplaintContext
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
      ? m.hasAdminRole && canReadComplaintsAdmin(m.roles)
      : m.hasResidentRole
  })

  if (!matched) {
    return { status: "forbidden" }
  }

  return { status: "ok", scope, context: { ctx, tenant: matched } }
}

export async function listAdminComplaints({
  tenantId,
  roles,
  filters,
}: {
  tenantId: string
  roles: readonly RoleCode[]
  filters?: ComplaintListFilters
}): Promise<ComplaintPageResult> {
  const supabase = await createClient()
  return listAdminComplaintsWithClient(supabase, {
    tenantId,
    roles,
    filters,
  })
}

export async function getAdminComplaintDetail({
  tenantId,
  roles,
  complaintId,
}: {
  tenantId: string
  roles: readonly RoleCode[]
  complaintId: string
}): Promise<ComplaintDetail | null> {
  const supabase = await createClient()
  return getAdminComplaintDetailWithClient(supabase, {
    tenantId,
    roles,
    complaintId,
  })
}

export async function listResidentComplaints({
  tenantId,
  memberId,
  filters,
}: {
  tenantId: string
  memberId: string
  filters?: ComplaintListFilters
}): Promise<ComplaintPageResult> {
  const supabase = await createClient()
  return listResidentComplaintsWithClient(supabase, {
    tenantId,
    memberId,
    filters,
  })
}

export async function getResidentComplaintDetail({
  tenantId,
  memberId,
  roles,
  complaintId,
}: {
  tenantId: string
  memberId: string
  roles: readonly RoleCode[]
  complaintId: string
}): Promise<ComplaintDetail | null> {
  const supabase = await createClient()
  return getResidentComplaintDetailWithClient(supabase, {
    tenantId,
    memberId,
    roles,
    complaintId,
  })
}

