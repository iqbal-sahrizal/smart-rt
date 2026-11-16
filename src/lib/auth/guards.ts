import { redirect } from "next/navigation"

import { getAuthContext } from "@/lib/auth/server"
import type { ActiveTenantMembership, AuthContextData } from "@/lib/auth/types"
import { resolvePostLoginRoute } from "@/lib/auth/workspace"

export interface TenantGuardResult {
  ctx: AuthContextData
  tenant: ActiveTenantMembership
}

export async function requireAuthenticatedUser(): Promise<AuthContextData> {
  const ctx = await getAuthContext()
  if (!ctx) {
    redirect("/login")
  }
  return ctx
}

export async function requireAdminContext(): Promise<TenantGuardResult> {
  const ctx = await requireAuthenticatedUser()
  const adminMemberships = ctx.memberships.filter((m) => m.hasAdminRole)

  if (adminMemberships.length === 0) {
    redirect(resolvePostLoginRoute(ctx.workspaceOptions, ctx.selectedWorkspace))
  }

  if (ctx.workspaceOptions.length > 1) {
    if (!ctx.selectedWorkspace) {
      redirect("/select-tenant")
    }
    if (ctx.selectedWorkspace.type !== "admin") {
      redirect(ctx.selectedWorkspace.href)
    }
    const matched = adminMemberships.find(
      (m) => m.tenantId === ctx.selectedWorkspace?.tenantId
    )
    if (!matched) {
      redirect("/select-tenant")
    }
    return { ctx, tenant: matched }
  }

  return { ctx, tenant: adminMemberships[0] }
}

export async function requireResidentContext(): Promise<TenantGuardResult> {
  const ctx = await requireAuthenticatedUser()
  const residentMemberships = ctx.memberships.filter((m) => m.hasResidentRole)

  if (residentMemberships.length === 0) {
    redirect(resolvePostLoginRoute(ctx.workspaceOptions, ctx.selectedWorkspace))
  }

  if (ctx.workspaceOptions.length > 1) {
    if (!ctx.selectedWorkspace) {
      redirect("/select-tenant")
    }
    if (ctx.selectedWorkspace.type !== "resident") {
      redirect(ctx.selectedWorkspace.href)
    }
    const matched = residentMemberships.find(
      (m) => m.tenantId === ctx.selectedWorkspace?.tenantId
    )
    if (!matched) {
      redirect("/select-tenant")
    }
    return { ctx, tenant: matched }
  }

  return { ctx, tenant: residentMemberships[0] }
}

export async function requireSuperAdminContext(): Promise<AuthContextData> {
  const ctx = await requireAuthenticatedUser()

  if (!ctx.profile.isSuperAdmin) {
    redirect(resolvePostLoginRoute(ctx.workspaceOptions, ctx.selectedWorkspace))
  }

  if (ctx.workspaceOptions.length > 1) {
    if (!ctx.selectedWorkspace) {
      redirect("/select-tenant")
    }
    if (ctx.selectedWorkspace.type !== "super_admin") {
      redirect(ctx.selectedWorkspace.href)
    }
  }

  return ctx
}
