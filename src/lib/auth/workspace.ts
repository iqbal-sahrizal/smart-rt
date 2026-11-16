import {
  ADMIN_ROLE_CODES,
  ROLE_CODES,
  type ActiveTenantMembership,
  type AuthContextData,
  type RoleCode,
  type ShellUserInfo,
  type WorkspaceOption,
} from "@/lib/auth/types"

const ROLE_SET = new Set<string>(ROLE_CODES)
const ADMIN_ROLE_SET = new Set<string>(ADMIN_ROLE_CODES)

export const WORKSPACE_COOKIE_NAME = "smart_rt_workspace"

export const ROLE_LABELS: Record<RoleCode, string> = {
  ketua_rt: "Ketua RT",
  sekretaris: "Sekretaris",
  bendahara: "Bendahara",
  pengurus: "Pengurus",
  warga: "Warga",
}

export function isRoleCode(value: string): value is RoleCode {
  return ROLE_SET.has(value)
}

export function hasAdminRole(roles: readonly RoleCode[]): boolean {
  return roles.some((role) => ADMIN_ROLE_SET.has(role))
}

export function hasResidentRole(roles: readonly RoleCode[]): boolean {
  return roles.includes("warga")
}

export function formatRoleLabels(roles: readonly RoleCode[]): string {
  if (roles.length === 0) return "Anggota"
  return roles.map((role) => ROLE_LABELS[role] ?? role).join(", ")
}

export function getInitials(name: string, email?: string | null): string {
  const cleaned = name.trim()
  if (cleaned) {
    const parts = cleaned.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
    }
    return cleaned.slice(0, 2).toUpperCase()
  }
  if (email) {
    return email.slice(0, 2).toUpperCase()
  }
  return "SR"
}

export function buildWorkspaceOptions(
  isSuperAdmin: boolean,
  memberships: readonly ActiveTenantMembership[]
): WorkspaceOption[] {
  const options: WorkspaceOption[] = []

  if (isSuperAdmin) {
    options.push({
      key: "super_admin",
      type: "super_admin",
      label: "Platform Super Admin",
      description: "Konsol lintas-tenant untuk pengelolaan platform Smart RT",
      tenantId: null,
      tenantName: null,
      tenantSubtitle: "Platform Global",
      roles: [],
      href: "/super-admin",
    })
  }

  for (const membership of memberships) {
    const rtRw = `RT ${membership.rtNumber} / RW ${membership.rwNumber}`
    const adminRoles = membership.roles.filter((role) => ADMIN_ROLE_SET.has(role))

    if (membership.hasAdminRole) {
      options.push({
        key: `admin:${membership.tenantId}`,
        type: "admin",
        label: `Dashboard Pengurus — ${membership.tenantName}`,
        description: `Masuk sebagai ${formatRoleLabels(adminRoles)}`,
        tenantId: membership.tenantId,
        tenantName: membership.tenantName,
        tenantSubtitle: rtRw,
        roles: adminRoles,
        href: "/",
      })
    }

    if (membership.hasResidentRole) {
      options.push({
        key: `resident:${membership.tenantId}`,
        type: "resident",
        label: `Portal Warga — ${membership.tenantName}`,
        description: "Masuk sebagai Warga untuk layanan mandiri",
        tenantId: membership.tenantId,
        tenantName: membership.tenantName,
        tenantSubtitle: rtRw,
        roles: ["warga"],
        href: "/resident",
      })
    }
  }

  return options
}

/**
 * Resolves the active workspace navigation preference against live DB-backed options.
 * Never trusts tampered, invalid, or stale workspace/tenant selections.
 */
export function resolveSelectedWorkspace(
  options: readonly WorkspaceOption[],
  selectedKey: string | null | undefined
): WorkspaceOption | null {
  if (options.length === 0) {
    return null
  }
  if (options.length === 1) {
    return options[0]
  }
  if (selectedKey) {
    const matched = options.find((opt) => opt.key === selectedKey)
    if (matched) {
      return matched
    }
  }
  return null
}

/**
 * Resolves destination after authentication without inventing arbitrary multi-role priority:
 * - 0 workspaces -> /no-access
 * - 1 workspace  -> direct route ('/', '/resident', or '/super-admin')
 * - >1 workspaces & valid selected workspace -> selected workspace route
 * - >1 workspaces & no valid selection -> /select-tenant
 */
export function resolvePostLoginRoute(
  options: readonly WorkspaceOption[],
  selectedWorkspace: WorkspaceOption | null = null
): "/login" | "/no-access" | "/select-tenant" | "/" | "/resident" | "/super-admin" {
  if (options.length === 0) {
    return "/no-access"
  }
  if (options.length === 1) {
    return options[0].href
  }
  if (selectedWorkspace) {
    const matched = options.find((opt) => opt.key === selectedWorkspace.key)
    if (matched) {
      return matched.href
    }
  }
  return "/select-tenant"
}

export function resolveActiveTenant(
  memberships: readonly ActiveTenantMembership[],
  activeTenantId: string | null
): ActiveTenantMembership | null {
  if (memberships.length === 0) {
    return null
  }
  if (activeTenantId) {
    const matched = memberships.find((m) => m.tenantId === activeTenantId)
    if (matched) {
      return matched
    }
  }
  if (memberships.length === 1) {
    return memberships[0]
  }
  return null
}

export function toAdminShellUserInfo(
  ctx: AuthContextData,
  tenant: ActiveTenantMembership
): ShellUserInfo {
  const adminRoles = tenant.roles.filter((role) => ADMIN_ROLE_SET.has(role))
  return {
    tenantId: tenant.tenantId,
    fullName: ctx.profile.fullName,
    email: ctx.user.email,
    initials: getInitials(ctx.profile.fullName, ctx.user.email),
    roleLabel: formatRoleLabels(adminRoles),
    roles: adminRoles,
    tenantName: tenant.tenantName,
    tenantSubtitle: `RT ${tenant.rtNumber} / RW ${tenant.rwNumber}`,
    tenantLogoUrl: tenant.tenantLogoUrl,
    hasMultipleWorkspaces: ctx.workspaceOptions.length > 1,
  }
}

export function toResidentShellUserInfo(
  ctx: AuthContextData,
  tenant: ActiveTenantMembership
): ShellUserInfo {
  return {
    tenantId: tenant.tenantId,
    fullName: ctx.profile.fullName,
    email: ctx.user.email,
    initials: getInitials(ctx.profile.fullName, ctx.user.email),
    roleLabel: ROLE_LABELS.warga,
    tenantName: tenant.tenantName,
    tenantSubtitle: `RT ${tenant.rtNumber} / RW ${tenant.rwNumber}`,
    tenantLogoUrl: tenant.tenantLogoUrl,
    hasMultipleWorkspaces: ctx.workspaceOptions.length > 1,
  }
}

export function toSuperAdminShellUserInfo(ctx: AuthContextData): ShellUserInfo {
  return {
    fullName: ctx.profile.fullName,
    email: ctx.user.email,
    initials: getInitials(ctx.profile.fullName, ctx.user.email),
    roleLabel: "Super Admin",
    tenantName: "Smart RT Platform",
    tenantSubtitle: "Platform Global",
    hasMultipleWorkspaces: ctx.workspaceOptions.length > 1,
  }
}

