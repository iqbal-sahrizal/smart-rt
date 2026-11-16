import "server-only"

import { getAuthContext } from "@/lib/auth/server"
import type {
  ActiveTenantMembership,
  AuthContextData,
  RoleCode,
} from "@/lib/auth/types"
import {
  getAdminLetterRequestDetailWithClient,
  getResidentLetterRequestDetailWithClient,
  listAdminLetterRequestsWithClient,
  listAdminLetterTypesWithClient,
  listResidentActiveLetterTypesWithClient,
  listResidentLetterRequestsWithClient,
} from "@/lib/letters/repository"
import {
  canReadLettersAdmin,
  type LetterListFilters,
  type LetterPageResult,
  type LetterRequestDetail,
  type LetterScope,
  type LetterType,
} from "@/lib/letters/types"
import { createClient } from "@/lib/supabase/server"

export interface ScopedLetterContext {
  ctx: AuthContextData
  tenant: ActiveTenantMembership
}

/**
 * Resolves the authenticated user and verified workspace tenant strictly from
 * live database memberships and validated workspace selection.
 * Never treats profiles.active_tenant_id or client-supplied IDs as authorization.
 * Bendahara and non-member super_admin are denied operational access to Letters.
 */
export async function resolveScopedLetterContext(
  scope: LetterScope
): Promise<
  | { status: "ok"; context: ScopedLetterContext }
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
          (m) => m.hasAdminRole && canReadLettersAdmin(m.roles)
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
 * Resolves active admin or resident operational workspace context for shared
 * endpoints (such as private document proxy routes and attachment actions).
 */
export async function resolveAnyOperationalLetterContext(): Promise<
  | {
      status: "ok"
      scope: LetterScope
      context: ScopedLetterContext
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
      ? m.hasAdminRole && canReadLettersAdmin(m.roles)
      : m.hasResidentRole
  })

  if (!matched) {
    return { status: "forbidden" }
  }

  return { status: "ok", scope, context: { ctx, tenant: matched } }
}

export async function listAdminLetterRequests({
  tenantId,
  roles,
  filters,
}: {
  tenantId: string
  roles: readonly RoleCode[]
  filters?: LetterListFilters
}): Promise<LetterPageResult> {
  const supabase = await createClient()
  return listAdminLetterRequestsWithClient(supabase, {
    tenantId,
    roles,
    filters,
  })
}

export async function getAdminLetterRequestDetail({
  tenantId,
  roles,
  requestId,
}: {
  tenantId: string
  roles: readonly RoleCode[]
  requestId: string
}): Promise<LetterRequestDetail | null> {
  const supabase = await createClient()
  return getAdminLetterRequestDetailWithClient(supabase, {
    tenantId,
    roles,
    requestId,
  })
}

export async function listAdminLetterTypes({
  tenantId,
  roles,
}: {
  tenantId: string
  roles: readonly RoleCode[]
}): Promise<{ items: LetterType[]; canManage: boolean }> {
  const supabase = await createClient()
  return listAdminLetterTypesWithClient(supabase, { tenantId, roles })
}

export async function listResidentLetterRequests({
  tenantId,
  memberId,
  residentId,
  filters,
}: {
  tenantId: string
  memberId: string
  residentId: string | null
  filters?: LetterListFilters
}): Promise<LetterPageResult> {
  const supabase = await createClient()
  return listResidentLetterRequestsWithClient(supabase, {
    tenantId,
    memberId,
    residentId,
    filters,
  })
}

export async function getResidentLetterRequestDetail({
  tenantId,
  memberId,
  residentId,
  requestId,
}: {
  tenantId: string
  memberId: string
  residentId: string | null
  requestId: string
}): Promise<LetterRequestDetail | null> {
  const supabase = await createClient()
  return getResidentLetterRequestDetailWithClient(supabase, {
    tenantId,
    memberId,
    residentId,
    requestId,
  })
}

export async function listResidentActiveLetterTypes({
  tenantId,
}: {
  tenantId: string
}): Promise<LetterType[]> {
  const supabase = await createClient()
  return listResidentActiveLetterTypesWithClient(supabase, { tenantId })
}

