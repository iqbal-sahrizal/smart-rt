import type { RoleCode } from "@/lib/auth/types"

export type AnnouncementStatus = "draft" | "published" | "archived"
export type AnnouncementTargetType = "all" | "role" | "household"

export const ANNOUNCEMENT_MANAGEMENT_ROLES: readonly RoleCode[] = [
  "ketua_rt",
  "sekretaris",
  "pengurus",
]

export function canManageAnnouncements(roles: readonly RoleCode[]): boolean {
  return roles.some((role) => ANNOUNCEMENT_MANAGEMENT_ROLES.includes(role))
}

export const ANNOUNCEMENT_STATUS_LABELS: Record<AnnouncementStatus, string> = {
  draft: "Draf",
  published: "Dipublikasikan",
  archived: "Diarsipkan",
}

export const ANNOUNCEMENT_TARGET_LABELS: Record<
  AnnouncementTargetType,
  string
> = {
  all: "Seluruh Warga",
  role: "Peran Tertentu",
  household: "Kartu Keluarga Tertentu",
}

export const RESIDENT_SAFE_TARGET_LABELS: Record<
  AnnouncementTargetType,
  string
> = {
  all: "Umum • Seluruh Warga",
  role: "Khusus Peran Anda",
  household: "Khusus Keluarga Anda",
}

export function getAnnouncementStatusBadgeVariant(
  status: AnnouncementStatus
): "success" | "warning" | "outline" {
  switch (status) {
    case "published":
      return "success"
    case "draft":
      return "warning"
    case "archived":
      return "outline"
  }
}

export function getAnnouncementTargetBadgeVariant(
  targetType: AnnouncementTargetType
): "info" | "accent" | "outline" {
  switch (targetType) {
    case "all":
      return "info"
    case "role":
      return "accent"
    case "household":
      return "outline"
  }
}

export interface AnnouncementSummary {
  id: string
  tenantId: string
  authorId: string
  title: string
  content: string
  attachmentPath: string | null
  status: AnnouncementStatus
  targetType: AnnouncementTargetType
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AnnouncementRecipientSummary {
  id: string
  roleId: string | null
  roleCode: string | null
  roleName: string | null
  householdId: string | null
  householdLabel: string | null
}

export interface ResidentAnnouncementItem {
  id: string
  title: string
  content: string
  targetType: AnnouncementTargetType
  publishedAt: string | null
  createdAt: string
}

export interface RoleOption {
  id: string
  code: RoleCode
  name: string
}

export interface HouseholdTargetOption {
  id: string
  label: string
}

export interface AnnouncementFormActionState {
  error: string | null
  fieldErrors?: Record<string, string[] | undefined>
}

