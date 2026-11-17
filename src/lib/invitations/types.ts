import type { RoleCode } from "@/lib/auth/types"
import { RESIDENT_MANAGEMENT_ROLES } from "@/lib/residents/types"

export type InvitationStatus = "pending" | "redeemed" | "revoked" | "expired"

export const INVITATION_MANAGEMENT_ROLES: readonly RoleCode[] =
  RESIDENT_MANAGEMENT_ROLES

export function canManageInvitations(roleCodes: readonly RoleCode[]): boolean {
  return roleCodes.some((role) => INVITATION_MANAGEMENT_ROLES.includes(role))
}

export const INVITATION_STATUS_LABELS: Record<InvitationStatus, string> = {
  pending: "Menunggu Aktivasi",
  redeemed: "Sudah Diaktivasi",
  revoked: "Dibatalkan",
  expired: "Kedaluwarsa",
}

export function getInvitationStatusBadgeVariant(
  status: InvitationStatus
): "warning" | "success" | "destructive" | "outline" {
  switch (status) {
    case "pending":
      return "warning"
    case "redeemed":
      return "success"
    case "revoked":
      return "destructive"
    case "expired":
      return "outline"
  }
}

export interface ResidentInvitationItem {
  id: string
  tenantId: string
  residentId: string
  residentName: string
  residentStatus: string
  householdBlockUnit: string | null
  householdAddress: string | null
  email: string
  status: InvitationStatus
  effectiveStatus: InvitationStatus
  expiresAt: string
  redeemedAt: string | null
  revokedAt: string | null
  createdAt: string
}

export interface EligibleResidentForInvitation {
  id: string
  fullName: string
  phone: string | null
  familyRole: string
  blockUnit: string | null
  address: string | null
}

export interface ResidentAccountLinkSummary {
  isLinked: boolean
  memberStatus: string | null
  joinedAt: string | null
  latestInvitation: ResidentInvitationItem | null
  history: ResidentInvitationItem[]
}

export type InvitationValidationReason =
  | "valid"
  | "not_found"
  | "revoked"
  | "redeemed"
  | "expired"
  | "inactive_resident"
  | "already_linked"

export interface InvitationValidationPreview {
  valid: boolean
  reason: InvitationValidationReason
  tenantName: string | null
  rtNumber: string | null
  rwNumber: string | null
  residentName: string | null
  emailMasked: string | null
  expiresAt: string | null
}

export interface ActivationSuccessResult {
  tenantId: string
  tenantName: string
  rtNumber: string
  rwNumber: string
  residentName: string
  assignedRole: "warga"
}

export interface InvitationActionState {
  ok?: boolean
  error: string | null
  fieldErrors?: Record<string, string[] | undefined>
  activationPath?: string | null
  activationUrl?: string | null
  invitedEmail?: string | null
  expiresAt?: string | null
  message?: string | null
}

export interface RedeemInvitationActionState {
  ok?: boolean
  error: string | null
  needsEmailConfirmation?: boolean
  confirmationMessage?: string | null
  fieldErrors?: {
    token?: string[]
    password?: string[]
    confirmPassword?: string[]
  }
  activated?: ActivationSuccessResult | null
}

