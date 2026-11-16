import "server-only"

import type { RoleCode } from "@/lib/auth/types"
import {
  canManageInvitations,
  type EligibleResidentForInvitation,
  type InvitationStatus,
  type InvitationValidationPreview,
  type InvitationValidationReason,
  type ResidentAccountLinkSummary,
  type ResidentInvitationItem,
} from "@/lib/invitations/types"
import { isValidUuid } from "@/lib/residents/schemas"
import { createClient } from "@/lib/supabase/server"

interface RawHouseholdEmbed {
  block_unit: string | null
  address: string | null
}

interface RawResidentEmbed {
  id: string
  full_name: string
  residency_status: string
  household: RawHouseholdEmbed | RawHouseholdEmbed[] | null
}

interface RawInvitationRow {
  id: string
  tenant_id: string
  resident_id: string
  email: string
  status: InvitationStatus
  expires_at: string
  redeemed_at: string | null
  revoked_at: string | null
  created_at: string
  resident: RawResidentEmbed | RawResidentEmbed[] | null
}

function unwrapSingle<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  if (Array.isArray(value)) return value[0] ?? null
  return value
}

export function computeEffectiveStatus(
  status: InvitationStatus,
  expiresAt: string,
  nowMs: number = Date.now()
): InvitationStatus {
  if (status === "pending") {
    const exp = Date.parse(expiresAt)
    if (!Number.isNaN(exp) && exp <= nowMs) {
      return "expired"
    }
  }
  return status
}

function mapInvitationRow(
  row: RawInvitationRow,
  nowMs: number
): ResidentInvitationItem {
  const resident = unwrapSingle(row.resident)
  const household = unwrapSingle(resident?.household)
  return {
    id: row.id,
    tenantId: row.tenant_id,
    residentId: row.resident_id,
    residentName: resident?.full_name ?? "Warga",
    residentStatus: resident?.residency_status ?? "aktif",
    householdBlockUnit: household?.block_unit ?? null,
    householdAddress: household?.address ?? null,
    email: row.email,
    status: row.status,
    effectiveStatus: computeEffectiveStatus(row.status, row.expires_at, nowMs),
    expiresAt: row.expires_at,
    redeemedAt: row.redeemed_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  }
}

const INVITATION_LIST_SELECT = `
  id,
  tenant_id,
  resident_id,
  email,
  status,
  expires_at,
  redeemed_at,
  revoked_at,
  created_at,
  resident:residents (
    id,
    full_name,
    residency_status,
    household:households!fk_residents_household (
      block_unit,
      address
    )
  )
`

export interface AdminResidentInvitationsResult {
  items: ResidentInvitationItem[]
  eligibleResidents: EligibleResidentForInvitation[]
  counts: Record<"all" | InvitationStatus, number>
  error: string | null
}

export async function getAdminResidentInvitations({
  tenantId,
  status,
  search,
}: {
  tenantId: string
  status?: string
  search?: string
}): Promise<AdminResidentInvitationsResult> {
  const supabase = await createClient()
  const nowMs = Date.now()

  const [invRes, membersRes, residentsRes] = await Promise.all([
    supabase
      .from("resident_invitations")
      .select(INVITATION_LIST_SELECT)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }),
    supabase
      .from("tenant_members")
      .select("resident_id, status")
      .eq("tenant_id", tenantId)
      .not("resident_id", "is", null)
      .in("status", ["active", "invited"]),
    supabase
      .from("residents")
      .select(
        `
        id,
        full_name,
        phone,
        family_role,
        residency_status,
        household:households!fk_residents_household!inner (
          block_unit,
          address,
          deleted_at
        )
      `
      )
      .eq("tenant_id", tenantId)
      .eq("residency_status", "aktif")
      .is("deleted_at", null)
      .is("households.deleted_at", null)
      .order("full_name", { ascending: true }),
  ])

  if (invRes.error) {
    return {
      items: [],
      eligibleResidents: [],
      counts: { all: 0, pending: 0, redeemed: 0, revoked: 0, expired: 0 },
      error: "Gagal memuat daftar undangan aktivasi warga.",
    }
  }

  const allItems = ((invRes.data ?? []) as RawInvitationRow[]).map((row) =>
    mapInvitationRow(row, nowMs)
  )

  const counts: Record<"all" | InvitationStatus, number> = {
    all: allItems.length,
    pending: 0,
    redeemed: 0,
    revoked: 0,
    expired: 0,
  }
  const activePendingResidentIds = new Set<string>()
  for (const item of allItems) {
    counts[item.effectiveStatus] += 1
    if (item.effectiveStatus === "pending") {
      activePendingResidentIds.add(item.residentId)
    }
  }

  const cleanSearch = search?.trim().toLowerCase() ?? ""
  const validStatusFilter =
    status &&
    ["pending", "redeemed", "revoked", "expired"].includes(status)
      ? (status as InvitationStatus)
      : null

  const filteredItems = allItems.filter((item) => {
    if (validStatusFilter && item.effectiveStatus !== validStatusFilter) {
      return false
    }
    if (cleanSearch) {
      const hay = `${item.residentName} ${item.email} ${item.householdBlockUnit ?? ""} ${item.householdAddress ?? ""}`.toLowerCase()
      if (!hay.includes(cleanSearch)) return false
    }
    return true
  })

  const linkedResidentIds = new Set<string>()
  for (const m of (membersRes.data ?? []) as Array<{ resident_id: string | null }>) {
    if (m.resident_id) linkedResidentIds.add(m.resident_id)
  }

  const eligibleResidents: EligibleResidentForInvitation[] = []
  for (const r of (residentsRes.data ?? []) as Array<{
    id: string
    full_name: string
    phone: string | null
    family_role: string
    household: RawHouseholdEmbed | RawHouseholdEmbed[] | null
  }>) {
    if (linkedResidentIds.has(r.id) || activePendingResidentIds.has(r.id)) {
      continue
    }
    const household = unwrapSingle(r.household)
    eligibleResidents.push({
      id: r.id,
      fullName: r.full_name,
      phone: r.phone,
      familyRole: r.family_role,
      blockUnit: household?.block_unit ?? null,
      address: household?.address ?? null,
    })
  }

  return {
    items: filteredItems,
    eligibleResidents,
    counts,
    error: null,
  }
}

export async function getResidentAccountLinkSummary({
  tenantId,
  residentId,
  roleCodes,
}: {
  tenantId: string
  residentId: string
  roleCodes: readonly RoleCode[]
}): Promise<ResidentAccountLinkSummary> {
  if (!isValidUuid(residentId)) {
    return {
      isLinked: false,
      memberStatus: null,
      joinedAt: null,
      latestInvitation: null,
      history: [],
    }
  }

  const supabase = await createClient()
  const nowMs = Date.now()
  const canManage = canManageInvitations(roleCodes)

  const [memberRes, invRes] = await Promise.all([
    supabase
      .from("tenant_members")
      .select("id, status, joined_at")
      .eq("tenant_id", tenantId)
      .eq("resident_id", residentId)
      .in("status", ["active", "invited"])
      .maybeSingle(),
    canManage
      ? supabase
          .from("resident_invitations")
          .select(INVITATION_LIST_SELECT)
          .eq("tenant_id", tenantId)
          .eq("resident_id", residentId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ])

  const memberRow = memberRes.data as {
    id: string
    status: string
    joined_at: string | null
  } | null

  const history = ((invRes.data ?? []) as RawInvitationRow[]).map((row) =>
    mapInvitationRow(row, nowMs)
  )

  return {
    isLinked: Boolean(memberRow),
    memberStatus: memberRow?.status ?? null,
    joinedAt: memberRow?.joined_at ?? null,
    latestInvitation: history[0] ?? null,
    history,
  }
}

export async function validateInvitationToken(
  token: string
): Promise<InvitationValidationPreview> {
  const cleanToken = token.trim()
  if (cleanToken.length < 32) {
    return {
      valid: false,
      reason: "not_found",
      tenantName: null,
      rtNumber: null,
      rwNumber: null,
      residentName: null,
      emailMasked: null,
      expiresAt: null,
    }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("validate_resident_invitation", {
    p_token: cleanToken,
  })

  if (error || !data || typeof data !== "object") {
    return {
      valid: false,
      reason: "not_found",
      tenantName: null,
      rtNumber: null,
      rwNumber: null,
      residentName: null,
      emailMasked: null,
      expiresAt: null,
    }
  }

  const payload = data as Record<string, unknown>
  const reason = (
    typeof payload.reason === "string" ? payload.reason : "not_found"
  ) as InvitationValidationReason

  return {
    valid: payload.valid === true,
    reason,
    tenantName:
      typeof payload.tenant_name === "string" ? payload.tenant_name : null,
    rtNumber: typeof payload.rt_number === "string" ? payload.rt_number : null,
    rwNumber: typeof payload.rw_number === "string" ? payload.rw_number : null,
    residentName:
      typeof payload.resident_name === "string" ? payload.resident_name : null,
    emailMasked:
      typeof payload.email_masked === "string" ? payload.email_masked : null,
    expiresAt:
      typeof payload.expires_at === "string" ? payload.expires_at : null,
  }
}

/**
 * Checks whether the currently signed-in user matches the invited email
 * without leaking the raw invited email to client components.
 */
export async function getSignedInInvitationMatchState(
  token: string,
  signedInEmail: string | null
): Promise<"unauthenticated" | "match" | "mismatch"> {
  if (!signedInEmail) {
    return "unauthenticated"
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc(
    "get_resident_invitation_claim_target",
    {
      p_token: token.trim(),
    }
  )

  if (error || !data || typeof data !== "object") {
    return "mismatch"
  }

  const payload = data as Record<string, unknown>
  const targetEmail =
    typeof payload.email === "string" ? payload.email.toLowerCase().trim() : null

  if (!targetEmail) {
    return "mismatch"
  }

  return targetEmail === signedInEmail.toLowerCase().trim()
    ? "match"
    : "mismatch"
}

