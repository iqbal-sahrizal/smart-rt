export const ROLE_CODES = [
  "ketua_rt",
  "sekretaris",
  "bendahara",
  "pengurus",
  "warga",
] as const

export type RoleCode = (typeof ROLE_CODES)[number]

export const ADMIN_ROLE_CODES = [
  "ketua_rt",
  "sekretaris",
  "bendahara",
  "pengurus",
] as const satisfies readonly RoleCode[]

export type AdminRoleCode = (typeof ADMIN_ROLE_CODES)[number]

export type WorkspaceType = "super_admin" | "admin" | "resident"

export interface UserProfileSummary {
  id: string
  fullName: string
  phone: string | null
  avatarPath: string | null
  activeTenantId: string | null
  isSuperAdmin: boolean
}

export interface ActiveTenantMembership {
  memberId: string
  tenantId: string
  tenantCode: string
  tenantName: string
  rtNumber: string
  rwNumber: string
  residentId: string | null
  roles: RoleCode[]
  hasAdminRole: boolean
  hasResidentRole: boolean
  tenantLogoUrl?: string | null
}

export interface WorkspaceOption {
  key: string
  type: WorkspaceType
  label: string
  description: string
  tenantId: string | null
  tenantName: string | null
  tenantSubtitle: string
  roles: RoleCode[]
  href: "/" | "/resident" | "/super-admin"
}

export interface AuthContextData {
  user: {
    id: string
    email: string | null
  }
  profile: UserProfileSummary
  memberships: ActiveTenantMembership[]
  workspaceOptions: WorkspaceOption[]
  selectedWorkspace: WorkspaceOption | null
  resolvedTenant: ActiveTenantMembership | null
}

export interface ShellUserInfo {
  tenantId?: string
  fullName: string
  email: string | null
  initials: string
  roleLabel: string
  roles?: RoleCode[]
  tenantName: string
  tenantSubtitle: string
  tenantLogoUrl?: string | null
  hasMultipleWorkspaces: boolean
}

