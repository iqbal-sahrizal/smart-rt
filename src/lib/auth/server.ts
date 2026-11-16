import { cookies } from "next/headers"
import { connection } from "next/server"

import { createClient } from "@/lib/supabase/server"
import type {
  ActiveTenantMembership,
  AuthContextData,
  RoleCode,
} from "@/lib/auth/types"
import {
  WORKSPACE_COOKIE_NAME,
  buildWorkspaceOptions,
  hasAdminRole,
  hasResidentRole,
  isRoleCode,
  resolveActiveTenant,
  resolveSelectedWorkspace,
} from "@/lib/auth/workspace"

interface RawRoleRow {
  code: string | null
}

interface RawMemberRoleRow {
  role: RawRoleRow | RawRoleRow[] | null
}

interface RawTenantRow {
  id: string
  code: string
  name: string
  rt_number: string
  rw_number: string
  status: string
  settings?: Record<string, unknown> | null
  deleted_at: string | null
}

interface RawTenantMemberRow {
  id: string
  tenant_id: string
  resident_id: string | null
  status: string
  tenant: RawTenantRow | RawTenantRow[] | null
  member_roles: RawMemberRoleRow[] | null
}

function unwrapSingle<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  if (Array.isArray(value)) return value[0] ?? null
  return value
}

/**
 * Loads the authenticated user, their profile, active tenant memberships,
 * and effective roles directly from Supabase on every request.
 * Never trusts client-supplied tenant_id or role values.
 */
export async function getAuthContext(): Promise<AuthContextData | null> {
  await connection()
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return null
  }

  const [{ data: profileRow, error: profileError }, { data: memberRows, error: memberError }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, phone, avatar_path, active_tenant_id, is_super_admin")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("tenant_members")
        .select(
          `
          id,
          tenant_id,
          resident_id,
          status,
          tenant:tenants!inner (
            id,
            code,
            name,
            rt_number,
            rw_number,
            status,
            settings,
            deleted_at
          ),
          member_roles (
            role:roles (
              code
            )
          )
        `
        )
        .eq("user_id", user.id)
        .eq("status", "active")
        .eq("tenants.status", "active")
        .is("tenants.deleted_at", null),
    ])

  if (profileError || memberError) {
    console.error("Failed to resolve auth context from database")
    return {
      user: {
        id: user.id,
        email: user.email ?? null,
      },
      profile: {
        id: user.id,
        fullName: user.email?.split("@")[0] ?? "Pengguna",
        phone: null,
        avatarPath: null,
        activeTenantId: null,
        isSuperAdmin: false,
      },
      memberships: [],
      workspaceOptions: [],
      selectedWorkspace: null,
      resolvedTenant: null,
    }
  }

  const profile = {
    id: profileRow?.id ?? user.id,
    fullName:
      profileRow?.full_name?.trim() ||
      user.email?.split("@")[0] ||
      "Pengguna",
    phone: profileRow?.phone ?? null,
    avatarPath: profileRow?.avatar_path ?? null,
    activeTenantId: profileRow?.active_tenant_id ?? null,
    isSuperAdmin: profileRow?.is_super_admin === true,
  }

  const memberships: ActiveTenantMembership[] = []
  for (const row of (memberRows ?? []) as RawTenantMemberRow[]) {
    if (row.status !== "active") continue
    const tenant = unwrapSingle(row.tenant)
    if (!tenant || tenant.status !== "active" || tenant.deleted_at !== null) {
      continue
    }

    const roleSet = new Set<RoleCode>()
    for (const mr of row.member_roles ?? []) {
      const roleObj = unwrapSingle(mr.role)
      const code = roleObj?.code
      if (code && isRoleCode(code)) {
        roleSet.add(code)
      }
    }

    const roles = Array.from(roleSet)
    const tenantSettings = (tenant.settings ?? {}) as Record<string, unknown>
    const tenantLogoUrl =
      typeof tenantSettings.logo_url === "string" && tenantSettings.logo_url.trim() !== ""
        ? tenantSettings.logo_url.trim()
        : null

    memberships.push({
      memberId: row.id,
      tenantId: tenant.id,
      tenantCode: tenant.code,
      tenantName: tenant.name,
      rtNumber: tenant.rt_number,
      rwNumber: tenant.rw_number,
      residentId: row.resident_id ?? null,
      roles,
      hasAdminRole: hasAdminRole(roles),
      hasResidentRole: hasResidentRole(roles),
      tenantLogoUrl,
    })
  }

  memberships.sort((a, b) => a.tenantName.localeCompare(b.tenantName, "id"))

  const workspaceOptions = buildWorkspaceOptions(
    profile.isSuperAdmin,
    memberships
  )
  const cookieStore = await cookies()
  const workspaceCookie = cookieStore.get(WORKSPACE_COOKIE_NAME)?.value ?? null
  const selectedWorkspace = resolveSelectedWorkspace(
    workspaceOptions,
    workspaceCookie
  )
  const preferredTenantId =
    selectedWorkspace?.tenantId ?? profile.activeTenantId
  const resolvedTenant = resolveActiveTenant(memberships, preferredTenantId)

  return {
    user: {
      id: user.id,
      email: user.email ?? null,
    },
    profile,
    memberships,
    workspaceOptions,
    selectedWorkspace,
    resolvedTenant,
  }
}

