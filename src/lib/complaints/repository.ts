import type { SupabaseClient } from "@supabase/supabase-js"

import type { RoleCode } from "@/lib/auth/types"
import {
  COMPLAINT_DEFAULT_PAGE_SIZE,
  COMPLAINT_MAX_PAGE_SIZE,
  COMPLAINT_PHOTO_BUCKET,
  DEFAULT_COMPLAINT_PRIORITY,
  DEFAULT_COMPLAINT_STATUS,
} from "@/lib/complaints/constants"
import {
  complaintListFiltersSchema,
  complaintUuidSchema,
  createComplaintReplySchema,
  createComplaintSchema,
  deleteComplaintPhotoSchema,
  sanitizeComplaintSearchTerm,
  softDeleteComplaintSchema,
  transitionComplaintStatusSchema,
  updateComplaintSchema,
} from "@/lib/complaints/schemas"
import {
  buildComplaintPhotoPath,
  complaintPhotoPathBelongsTo,
  isValidComplaintPhotoPath,
  type ValidatedComplaintPhoto,
} from "@/lib/complaints/storage"
import {
  canManageComplaints,
  canReadComplaintsAdmin,
  canViewComplaintPhotos,
  isComplaintMetadataOnlyRole,
  type Complaint,
  type ComplaintActionErrorCode,
  type ComplaintDetail,
  type ComplaintListFilters,
  type ComplaintPageResult,
  type ComplaintPriority,
  type ComplaintReply,
  type ComplaintScope,
  type ComplaintStatus,
  type ComplaintStatusCounts,
  type ComplaintStatusHistory,
  type CreateComplaintInput,
  type CreateComplaintReplyInput,
  type DeleteComplaintPhotoInput,
  type DeleteComplaintPhotoResult,
  type SoftDeleteComplaintInput,
  type TransitionComplaintStatusInput,
  type UpdateComplaintInput,
  type UploadComplaintPhotoResult,
} from "@/lib/complaints/types"

export const COMPLAINT_METADATA_SELECT_COLUMNS =
  "id, tenant_id, reporter_member_id, category, title, description, priority, status, created_at, updated_at" as const

/**
 * Full complaint select including photo_path.
 * Never use for Bendahara / metadata-only callers.
 */
export const COMPLAINT_FULL_SELECT_COLUMNS =
  "id, tenant_id, reporter_member_id, category, title, description, photo_path, priority, status, created_at, updated_at" as const

export const COMPLAINT_REPLY_SELECT_COLUMNS =
  "id, tenant_id, complaint_id, author_member_id, message, created_at" as const

export const COMPLAINT_HISTORY_SELECT_COLUMNS =
  "id, tenant_id, complaint_id, changed_by_member_id, previous_status, new_status, reason, created_at" as const

interface RawComplaintRow {
  id: string
  tenant_id: string
  reporter_member_id: string
  category: string
  title: string
  description: string
  photo_path?: string | null
  priority: ComplaintPriority
  status: ComplaintStatus
  created_at: string
  updated_at: string
}

interface RawComplaintReplyRow {
  id: string
  tenant_id: string
  complaint_id: string
  author_member_id: string
  message: string
  created_at: string
}

interface RawComplaintHistoryRow {
  id: string
  tenant_id: string
  complaint_id: string
  changed_by_member_id: string
  previous_status: ComplaintStatus
  new_status: ComplaintStatus
  reason: string | null
  created_at: string
}

interface RawMemberLookupRow {
  id: string
  resident_id: string | null
  member_roles: Array<{
    role: { code: string | null; name: string | null } | Array<{ code: string | null; name: string | null }> | null
  }> | null
}

interface RawResidentLookupRow {
  id: string
  full_name: string
  household_id: string
}

interface RawHouseholdLookupRow {
  id: string
  block_unit: string | null
}

interface MemberLabelInfo {
  label: string
  isStaff: boolean
}

export class ComplaintServiceError extends Error {
  readonly status: number
  readonly code: ComplaintActionErrorCode

  constructor(status: number, code: ComplaintActionErrorCode, message: string) {
    super(message)
    this.name = "ComplaintServiceError"
    this.status = status
    this.code = code
  }
}

export function mapComplaintDbError(error: {
  code?: string | null
  message?: string | null
}): ComplaintServiceError {
  const code = error.code ?? ""
  const lower = (error.message ?? "").toLowerCase()

  if (code === "42501" || lower.includes("forbidden")) {
    return new ComplaintServiceError(
      403,
      "FORBIDDEN",
      "Anda tidak memiliki izin untuk mengakses atau mengubah pengaduan ini."
    )
  }

  if (lower.includes("unauthenticated")) {
    return new ComplaintServiceError(
      401,
      "UNAUTHORIZED",
      "Sesi login tidak ditemukan atau telah berakhir."
    )
  }

  if (code === "P0002" || lower.includes("not found")) {
    return new ComplaintServiceError(
      404,
      "NOT_FOUND",
      "Pengaduan tidak ditemukan atau sudah dihapus."
    )
  }

  if (code === "22023" || code === "23514") {
    if (lower.includes("invalid complaint transition")) {
      return new ComplaintServiceError(
        400,
        "INVALID_STATE",
        "Perubahan status pengaduan tidak valid atau pengaduan sudah ditutup."
      )
    }
    if (lower.includes("while open")) {
      return new ComplaintServiceError(
        400,
        "INVALID_STATE",
        "Foto pengaduan hanya dapat diubah saat status masih Menunggu."
      )
    }
    if (lower.includes("chk_complaint_replies_attachment_null")) {
      return new ComplaintServiceError(
        400,
        "VALIDATION_ERROR",
        "Lampiran pada balasan pengaduan tidak didukung."
      )
    }
    return new ComplaintServiceError(
      400,
      "VALIDATION_ERROR",
      "Data pengaduan tidak memenuhi ketentuan."
    )
  }

  if (code === "40001") {
    return new ComplaintServiceError(
      409,
      "CONFLICT",
      "Pengaduan sedang diproses oleh permintaan lain. Silakan muat ulang."
    )
  }

  if (code === "23503") {
    return new ComplaintServiceError(
      400,
      "STORAGE_ERROR",
      "Berkas foto tidak ditemukan di penyimpanan privat."
    )
  }

  return new ComplaintServiceError(
    500,
    "INTERNAL_ERROR",
    "Gagal memproses permintaan pengaduan. Silakan coba lagi."
  )
}

export function buildComplaintPhotoApiUrl(complaintId: string): string {
  return `/api/complaints/${encodeURIComponent(complaintId)}/photo`
}

function unwrapSingle<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null
  return Array.isArray(val) ? (val[0] ?? null) : val
}

function mapComplaintRow(
  row: RawComplaintRow,
  {
    includePhoto,
    reporterLabel,
  }: {
    includePhoto: boolean
    reporterLabel: string
  }
): Complaint {
  const safePhotoPath =
    includePhoto &&
    row.photo_path &&
    isValidComplaintPhotoPath(row.photo_path) &&
    complaintPhotoPathBelongsTo(row.photo_path, row.tenant_id, row.id)
      ? row.photo_path
      : null

  return {
    id: row.id,
    tenantId: row.tenant_id,
    reporterMemberId: row.reporter_member_id,
    reporterLabel,
    category: row.category,
    title: row.title,
    description: row.description,
    photoPath: safePhotoPath,
    photoUrl: safePhotoPath ? buildComplaintPhotoApiUrl(row.id) : null,
    hasPhoto: Boolean(safePhotoPath),
    priority: row.priority,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function resolveAdminMemberLabelsWithClient(
  supabase: SupabaseClient,
  tenantId: string,
  memberIds: string[]
): Promise<Map<string, MemberLabelInfo>> {
  const map = new Map<string, MemberLabelInfo>()
  const uniqueIds = Array.from(new Set(memberIds.filter(Boolean)))
  if (uniqueIds.length === 0) return map

  const { data: memberRows } = await supabase
    .from("tenant_members")
    .select("id, resident_id, member_roles(role:roles(code, name))")
    .eq("tenant_id", tenantId)
    .in("id", uniqueIds)

  const typedMembers = (memberRows ?? []) as RawMemberLookupRow[]
  const residentIds = typedMembers
    .map((m) => m.resident_id)
    .filter((id): id is string => Boolean(id))

  const residentMap = new Map<string, RawResidentLookupRow>()
  const householdMap = new Map<string, RawHouseholdLookupRow>()

  if (residentIds.length > 0) {
    const { data: residentRows } = await supabase
      .from("residents")
      .select("id, full_name, household_id")
      .eq("tenant_id", tenantId)
      .in("id", residentIds)

    const typedResidents = (residentRows ?? []) as RawResidentLookupRow[]
    for (const r of typedResidents) {
      residentMap.set(r.id, r)
    }

    const householdIds = Array.from(
      new Set(typedResidents.map((r) => r.household_id).filter(Boolean))
    )
    if (householdIds.length > 0) {
      const { data: householdRows } = await supabase
        .from("households")
        .select("id, block_unit")
        .eq("tenant_id", tenantId)
        .in("id", householdIds)

      for (const h of (householdRows ?? []) as RawHouseholdLookupRow[]) {
        householdMap.set(h.id, h)
      }
    }
  }

  for (const m of typedMembers) {
    const roleCodes: string[] = []
    let staffRoleLabel: string | null = null
    for (const mr of m.member_roles ?? []) {
      const roleObj = unwrapSingle(mr.role)
      if (roleObj?.code) {
        roleCodes.push(roleObj.code)
        if (
          ["ketua_rt", "sekretaris", "pengurus", "bendahara"].includes(
            roleObj.code
          ) &&
          !staffRoleLabel
        ) {
          staffRoleLabel = roleObj.name ?? "Pengurus RT"
        }
      }
    }

    const isStaff = roleCodes.some((code) =>
      ["ketua_rt", "sekretaris", "pengurus"].includes(code)
    )
    const resident = m.resident_id ? residentMap.get(m.resident_id) : null
    const household = resident
      ? householdMap.get(resident.household_id)
      : null

    let label = "Anggota RT"
    if (resident) {
      label = household?.block_unit
        ? `${resident.full_name} (${household.block_unit})`
        : resident.full_name
    } else if (staffRoleLabel) {
      label = staffRoleLabel
    }

    map.set(m.id, { label, isStaff })
  }

  return map
}

async function fetchComplaintStatusCounts(
  supabase: SupabaseClient,
  {
    tenantId,
    reporterMemberId,
  }: {
    tenantId: string
    reporterMemberId?: string
  }
): Promise<ComplaintStatusCounts> {
  let query = supabase
    .from("complaints")
    .select("status")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)

  if (reporterMemberId) {
    query = query.eq("reporter_member_id", reporterMemberId)
  }

  const { data, error } = await query
  if (error) {
    throw mapComplaintDbError(error)
  }

  const counts: ComplaintStatusCounts = {
    open: 0,
    inProgress: 0,
    resolved: 0,
    rejected: 0,
    total: 0,
  }

  for (const row of (data ?? []) as Array<{ status: ComplaintStatus }>) {
    if (row.status === "open") counts.open += 1
    else if (row.status === "in_progress") counts.inProgress += 1
    else if (row.status === "resolved") counts.resolved += 1
    else if (row.status === "rejected") counts.rejected += 1
    counts.total += 1
  }

  return counts
}

function applyComplaintQueryFilters<
  T extends {
    eq: (col: string, val: string) => T
    or: (filter: string) => T
  },
>(
  query: T,
  filters: {
    status?: ComplaintStatus
    category?: string
    priority?: ComplaintPriority
    search?: string
  }
): T {
  let q = query
  if (filters.status) {
    q = q.eq("status", filters.status)
  }
  if (filters.category) {
    q = q.eq("category", filters.category)
  }
  if (filters.priority) {
    q = q.eq("priority", filters.priority)
  }
  const cleanSearch = sanitizeComplaintSearchTerm(filters.search)
  if (cleanSearch.length > 0) {
    q = q.or(`title.ilike.%${cleanSearch}%,description.ilike.%${cleanSearch}%`)
  }
  return q
}

async function fetchComplaintsPageWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    scope,
    reporterMemberId,
    includePhoto,
    isMetadataOnly,
    filters,
  }: {
    tenantId: string
    scope: ComplaintScope
    reporterMemberId?: string
    includePhoto: boolean
    isMetadataOnly: boolean
    filters?: ComplaintListFilters
  }
): Promise<ComplaintPageResult> {
  const parsed = complaintListFiltersSchema.safeParse(filters ?? {})
  if (!parsed.success) {
    throw new ComplaintServiceError(
      400,
      "VALIDATION_ERROR",
      "Parameter filter daftar pengaduan tidak valid."
    )
  }

  const normalized = parsed.data
  const safePageSize = Math.min(
    Math.max(normalized.pageSize ?? COMPLAINT_DEFAULT_PAGE_SIZE, 1),
    COMPLAINT_MAX_PAGE_SIZE
  )
  const requestedPage = Math.max(normalized.page ?? 1, 1)
  const ascending = normalized.sort === "asc"

  let countQuery = supabase
    .from("complaints")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)

  if (reporterMemberId) {
    countQuery = countQuery.eq("reporter_member_id", reporterMemberId)
  }
  countQuery = applyComplaintQueryFilters(countQuery, normalized)

  const [{ count, error: countError }, summary] = await Promise.all([
    countQuery,
    fetchComplaintStatusCounts(supabase, { tenantId, reporterMemberId }),
  ])

  if (countError) {
    throw mapComplaintDbError(countError)
  }

  const totalCount = count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize))
  const safePage = Math.min(requestedPage, totalPages)
  const offset = (safePage - 1) * safePageSize

  const selectCols = includePhoto
    ? COMPLAINT_FULL_SELECT_COLUMNS
    : COMPLAINT_METADATA_SELECT_COLUMNS

  let listQuery = supabase
    .from("complaints")
    .select(selectCols)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)

  if (reporterMemberId) {
    listQuery = listQuery.eq("reporter_member_id", reporterMemberId)
  }
  listQuery = applyComplaintQueryFilters(listQuery, normalized)

  const { data: rows, error: listError } = await listQuery
    .order("created_at", { ascending })
    .order("id", { ascending })
    .range(offset, offset + safePageSize - 1)

  if (listError) {
    throw mapComplaintDbError(listError)
  }

  const rawRows = (rows ?? []) as unknown as RawComplaintRow[]
  const labelMap =
    scope === "admin"
      ? await resolveAdminMemberLabelsWithClient(
          supabase,
          tenantId,
          rawRows.map((r) => r.reporter_member_id)
        )
      : new Map<string, MemberLabelInfo>()

  const items = rawRows.map((row) =>
    mapComplaintRow(row, {
      includePhoto,
      reporterLabel:
        scope === "resident"
          ? "Anda"
          : (labelMap.get(row.reporter_member_id)?.label ?? "Anggota RT"),
    })
  )

  return {
    items,
    totalCount,
    page: safePage,
    pageSize: safePageSize,
    totalPages,
    summary,
    isMetadataOnly,
  }
}

async function fetchComplaintDetailWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    complaintId,
    scope,
    roles,
    reporterMemberId,
  }: {
    tenantId: string
    complaintId: string
    scope: ComplaintScope
    roles: readonly RoleCode[]
    reporterMemberId?: string
  }
): Promise<ComplaintDetail | null> {
  if (!complaintUuidSchema.safeParse(complaintId).success) {
    throw new ComplaintServiceError(
      400,
      "VALIDATION_ERROR",
      "Format ID pengaduan tidak valid."
    )
  }

  const includePhoto =
    scope === "resident" ? true : canViewComplaintPhotos(roles)
  const isMetadataOnly =
    scope === "admin" ? isComplaintMetadataOnlyRole(roles) : false
  const canManage = scope === "admin" ? canManageComplaints(roles) : false

  const selectCols = includePhoto
    ? COMPLAINT_FULL_SELECT_COLUMNS
    : COMPLAINT_METADATA_SELECT_COLUMNS

  let complaintQuery = supabase
    .from("complaints")
    .select(selectCols)
    .eq("tenant_id", tenantId)
    .eq("id", complaintId)
    .is("deleted_at", null)

  if (scope === "resident" && reporterMemberId) {
    complaintQuery = complaintQuery.eq("reporter_member_id", reporterMemberId)
  }

  const { data: complaintRow, error: complaintError } =
    await complaintQuery.maybeSingle()

  if (complaintError) {
    throw mapComplaintDbError(complaintError)
  }
  if (!complaintRow) {
    return null
  }

  const rawComplaint = complaintRow as unknown as RawComplaintRow

  const [{ data: replyRows, error: replyErr }, { data: histRows, error: histErr }] =
    await Promise.all([
      supabase
        .from("complaint_replies")
        .select(COMPLAINT_REPLY_SELECT_COLUMNS)
        .eq("tenant_id", tenantId)
        .eq("complaint_id", complaintId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
      supabase
        .from("complaint_status_history")
        .select(COMPLAINT_HISTORY_SELECT_COLUMNS)
        .eq("tenant_id", tenantId)
        .eq("complaint_id", complaintId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
    ])

  if (replyErr) throw mapComplaintDbError(replyErr)
  if (histErr) throw mapComplaintDbError(histErr)

  const typedReplies = (replyRows ?? []) as RawComplaintReplyRow[]
  const typedHistory = (histRows ?? []) as RawComplaintHistoryRow[]

  const labelMap =
    scope === "admin"
      ? await resolveAdminMemberLabelsWithClient(supabase, tenantId, [
          rawComplaint.reporter_member_id,
          ...typedReplies.map((r) => r.author_member_id),
          ...typedHistory.map((h) => h.changed_by_member_id),
        ])
      : new Map<string, MemberLabelInfo>()

  const complaint = mapComplaintRow(rawComplaint, {
    includePhoto,
    reporterLabel:
      scope === "resident"
        ? "Anda"
        : (labelMap.get(rawComplaint.reporter_member_id)?.label ?? "Anggota RT"),
  })

  const replies: ComplaintReply[] = typedReplies.map((row) => {
    const isOwn =
      scope === "resident" && reporterMemberId
        ? row.author_member_id === reporterMemberId
        : false
    const memberInfo = labelMap.get(row.author_member_id)
    const authorLabel =
      scope === "resident"
        ? isOwn
          ? "Anda"
          : "Pengurus RT"
        : (memberInfo?.label ?? "Pengguna RT")

    return {
      id: row.id,
      tenantId: row.tenant_id,
      complaintId: row.complaint_id,
      authorMemberId: row.author_member_id,
      authorLabel,
      isStaffReply:
        scope === "resident"
          ? row.author_member_id !== rawComplaint.reporter_member_id
          : (memberInfo?.isStaff ??
            row.author_member_id !== rawComplaint.reporter_member_id),
      message: row.message,
      attachmentPath: null,
      createdAt: row.created_at,
    }
  })

  const statusHistory: ComplaintStatusHistory[] = typedHistory.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    complaintId: row.complaint_id,
    changedByMemberId: row.changed_by_member_id,
    changedByLabel:
      scope === "resident"
        ? "Pengurus RT"
        : (labelMap.get(row.changed_by_member_id)?.label ?? "Pengurus RT"),
    previousStatus: row.previous_status,
    newStatus: row.new_status,
    reason: row.reason,
    createdAt: row.created_at,
  }))

  const isOpen = complaint.status === "open"
  const isReplyableStatus =
    complaint.status === "open" || complaint.status === "in_progress"
  const isResidentOwner =
    scope === "resident" &&
    Boolean(reporterMemberId) &&
    complaint.reporterMemberId === reporterMemberId

  return {
    complaint,
    replies,
    statusHistory,
    permissions: {
      canEdit: isResidentOwner && isOpen,
      canReply:
        isReplyableStatus && (scope === "resident" ? isResidentOwner : canManage),
      canTransition: canManage && isReplyableStatus,
      canSoftDelete: canManage,
      canViewPhoto: includePhoto,
      canManagePhoto:
        scope === "resident" ? isResidentOwner && isOpen : canManage,
      isMetadataOnly,
    },
  }
}

export async function listAdminComplaintsWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    filters,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    filters?: ComplaintListFilters
  }
): Promise<ComplaintPageResult> {
  if (!canReadComplaintsAdmin(roles)) {
    throw new ComplaintServiceError(
      403,
      "FORBIDDEN",
      "Anda tidak memiliki izin membaca daftar pengaduan."
    )
  }

  return fetchComplaintsPageWithClient(supabase, {
    tenantId,
    scope: "admin",
    includePhoto: canViewComplaintPhotos(roles),
    isMetadataOnly: isComplaintMetadataOnlyRole(roles),
    filters,
  })
}

export async function getAdminComplaintDetailWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    complaintId,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    complaintId: string
  }
): Promise<ComplaintDetail | null> {
  if (!canReadComplaintsAdmin(roles)) {
    throw new ComplaintServiceError(
      403,
      "FORBIDDEN",
      "Anda tidak memiliki izin melihat detail pengaduan."
    )
  }

  return fetchComplaintDetailWithClient(supabase, {
    tenantId,
    complaintId,
    scope: "admin",
    roles,
  })
}

export async function listResidentComplaintsWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    memberId,
    filters,
  }: {
    tenantId: string
    memberId: string
    filters?: ComplaintListFilters
  }
): Promise<ComplaintPageResult> {
  return fetchComplaintsPageWithClient(supabase, {
    tenantId,
    scope: "resident",
    reporterMemberId: memberId,
    includePhoto: true,
    isMetadataOnly: false,
    filters,
  })
}

export async function getResidentComplaintDetailWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    memberId,
    roles,
    complaintId,
  }: {
    tenantId: string
    memberId: string
    roles: readonly RoleCode[]
    complaintId: string
  }
): Promise<ComplaintDetail | null> {
  return fetchComplaintDetailWithClient(supabase, {
    tenantId,
    complaintId,
    scope: "resident",
    roles,
    reporterMemberId: memberId,
  })
}

export async function createComplaintWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    memberId,
    input,
  }: {
    tenantId: string
    memberId: string
    input: CreateComplaintInput
  }
): Promise<Complaint> {
  const parsed = createComplaintSchema.safeParse(input)
  if (!parsed.success) {
    throw new ComplaintServiceError(
      400,
      "VALIDATION_ERROR",
      "Periksa kembali kategori, judul, dan deskripsi pengaduan."
    )
  }

  const { data, error } = await supabase
    .from("complaints")
    .insert({
      tenant_id: tenantId,
      reporter_member_id: memberId,
      category: parsed.data.category,
      title: parsed.data.title,
      description: parsed.data.description,
      priority: DEFAULT_COMPLAINT_PRIORITY,
      status: DEFAULT_COMPLAINT_STATUS,
      photo_path: null,
    })
    .select(COMPLAINT_FULL_SELECT_COLUMNS)
    .single()

  if (error) {
    throw mapComplaintDbError(error)
  }

  return mapComplaintRow(data as unknown as RawComplaintRow, {
    includePhoto: true,
    reporterLabel: "Anda",
  })
}

export async function updateComplaintWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    memberId,
    input,
  }: {
    tenantId: string
    memberId: string
    input: UpdateComplaintInput
  }
): Promise<Complaint> {
  const parsed = updateComplaintSchema.safeParse(input)
  if (!parsed.success) {
    throw new ComplaintServiceError(
      400,
      "VALIDATION_ERROR",
      "Periksa kembali pembaruan pengaduan Anda."
    )
  }

  const { data: existing, error: fetchErr } = await supabase
    .from("complaints")
    .select("id, reporter_member_id, status, deleted_at")
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.complaintId)
    .is("deleted_at", null)
    .maybeSingle()

  if (fetchErr) {
    throw mapComplaintDbError(fetchErr)
  }
  if (!existing) {
    throw new ComplaintServiceError(
      404,
      "NOT_FOUND",
      "Pengaduan tidak ditemukan atau sudah dihapus."
    )
  }

  const row = existing as {
    id: string
    reporter_member_id: string
    status: ComplaintStatus
    deleted_at: string | null
  }
  if (row.reporter_member_id !== memberId) {
    throw new ComplaintServiceError(
      403,
      "FORBIDDEN",
      "Hanya pelapor pemilik yang dapat mengubah pengaduan ini."
    )
  }
  if (row.status !== "open") {
    throw new ComplaintServiceError(
      400,
      "INVALID_STATE",
      "Pengaduan hanya dapat diubah selama masih berstatus Menunggu."
    )
  }

  const { data: updated, error: updateErr } = await supabase
    .from("complaints")
    .update({
      category: parsed.data.category,
      title: parsed.data.title,
      description: parsed.data.description,
    })
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.complaintId)
    .eq("reporter_member_id", memberId)
    .eq("status", "open")
    .is("deleted_at", null)
    .select(COMPLAINT_FULL_SELECT_COLUMNS)
    .maybeSingle()

  if (updateErr) {
    throw mapComplaintDbError(updateErr)
  }
  if (!updated) {
    throw new ComplaintServiceError(
      409,
      "INVALID_STATE",
      "Pengaduan tidak lagi berstatus Menunggu atau sudah berubah."
    )
  }

  return mapComplaintRow(updated as unknown as RawComplaintRow, {
    includePhoto: true,
    reporterLabel: "Anda",
  })
}

export async function createComplaintReplyWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    memberId,
    roles,
    scope,
    input,
  }: {
    tenantId: string
    memberId: string
    roles: readonly RoleCode[]
    scope: ComplaintScope
    input: CreateComplaintReplyInput
  }
): Promise<ComplaintReply> {
  const parsed = createComplaintReplySchema.safeParse(input)
  if (!parsed.success) {
    throw new ComplaintServiceError(
      400,
      "VALIDATION_ERROR",
      "Pesan balasan tidak valid."
    )
  }

  if (scope === "admin" && !canManageComplaints(roles)) {
    throw new ComplaintServiceError(
      403,
      "FORBIDDEN",
      "Hanya Ketua RT, Sekretaris, atau Pengurus yang dapat membalas pengaduan."
    )
  }

  const { data: parentRow, error: parentErr } = await supabase
    .from("complaints")
    .select("id, tenant_id, reporter_member_id, status, deleted_at")
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.complaintId)
    .is("deleted_at", null)
    .maybeSingle()

  if (parentErr) {
    throw mapComplaintDbError(parentErr)
  }
  if (!parentRow) {
    throw new ComplaintServiceError(
      404,
      "NOT_FOUND",
      "Pengaduan tidak ditemukan atau sudah dihapus."
    )
  }

  const parent = parentRow as {
    id: string
    tenant_id: string
    reporter_member_id: string
    status: ComplaintStatus
    deleted_at: string | null
  }

  if (scope === "resident" && parent.reporter_member_id !== memberId) {
    throw new ComplaintServiceError(
      403,
      "FORBIDDEN",
      "Anda hanya dapat membalas pengaduan milik Anda sendiri."
    )
  }

  if (parent.status !== "open" && parent.status !== "in_progress") {
    throw new ComplaintServiceError(
      400,
      "INVALID_STATE",
      "Balasan hanya diizinkan saat pengaduan berstatus Menunggu atau Diproses."
    )
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("complaint_replies")
    .insert({
      tenant_id: tenantId,
      complaint_id: parsed.data.complaintId,
      author_member_id: memberId,
      message: parsed.data.message,
      attachment_path: null,
    })
    .select(COMPLAINT_REPLY_SELECT_COLUMNS)
    .single()

  if (insertErr) {
    throw mapComplaintDbError(insertErr)
  }

  const reply = inserted as RawComplaintReplyRow
  return {
    id: reply.id,
    tenantId: reply.tenant_id,
    complaintId: reply.complaint_id,
    authorMemberId: reply.author_member_id,
    authorLabel: scope === "resident" ? "Anda" : "Pengurus RT",
    isStaffReply: scope === "admin",
    message: reply.message,
    attachmentPath: null,
    createdAt: reply.created_at,
  }
}

export async function transitionComplaintStatusWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    input,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    input: TransitionComplaintStatusInput
  }
): Promise<{ complaintId: string; newStatus: ComplaintStatus }> {
  if (!canManageComplaints(roles)) {
    throw new ComplaintServiceError(
      403,
      "FORBIDDEN",
      "Hanya Ketua RT, Sekretaris, atau Pengurus yang dapat mengubah status pengaduan."
    )
  }

  const parsed = transitionComplaintStatusSchema.safeParse(input)
  if (!parsed.success) {
    throw new ComplaintServiceError(
      400,
      "VALIDATION_ERROR",
      "Perubahan status pengaduan tidak valid."
    )
  }

  // Verify complaint belongs to active tenant context before RPC
  const { data: existing, error: fetchErr } = await supabase
    .from("complaints")
    .select("id, status")
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.complaintId)
    .is("deleted_at", null)
    .maybeSingle()

  if (fetchErr) {
    throw mapComplaintDbError(fetchErr)
  }
  if (!existing) {
    throw new ComplaintServiceError(
      404,
      "NOT_FOUND",
      "Pengaduan tidak ditemukan di workspace ini."
    )
  }

  const { error: rpcErr } = await supabase.rpc("transition_complaint_status", {
    p_complaint_id: parsed.data.complaintId,
    p_new_status: parsed.data.newStatus,
    p_reason: parsed.data.reason,
  })

  if (rpcErr) {
    throw mapComplaintDbError(rpcErr)
  }

  return {
    complaintId: parsed.data.complaintId,
    newStatus: parsed.data.newStatus,
  }
}

export async function softDeleteComplaintWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    input,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    input: SoftDeleteComplaintInput
  }
): Promise<{ complaintId: string; deleted: true }> {
  if (!canManageComplaints(roles)) {
    throw new ComplaintServiceError(
      403,
      "FORBIDDEN",
      "Hanya Ketua RT, Sekretaris, atau Pengurus yang dapat menghapus pengaduan."
    )
  }

  const parsed = softDeleteComplaintSchema.safeParse(input)
  if (!parsed.success) {
    throw new ComplaintServiceError(
      400,
      "VALIDATION_ERROR",
      "Alasan penghapusan pengaduan wajib diisi (3–500 karakter)."
    )
  }

  const { data: existing, error: fetchErr } = await supabase
    .from("complaints")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.complaintId)
    .is("deleted_at", null)
    .maybeSingle()

  if (fetchErr) {
    throw mapComplaintDbError(fetchErr)
  }
  if (!existing) {
    throw new ComplaintServiceError(
      404,
      "NOT_FOUND",
      "Pengaduan tidak ditemukan di workspace ini."
    )
  }

  const { error: rpcErr } = await supabase.rpc("soft_delete_complaint", {
    p_complaint_id: parsed.data.complaintId,
    p_reason: parsed.data.reason,
  })

  if (rpcErr) {
    throw mapComplaintDbError(rpcErr)
  }

  return {
    complaintId: parsed.data.complaintId,
    deleted: true,
  }
}

export async function uploadComplaintPhotoWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    memberId,
    complaintId,
    validatedFile,
  }: {
    tenantId: string
    memberId: string
    complaintId: string
    validatedFile: ValidatedComplaintPhoto
  }
): Promise<UploadComplaintPhotoResult> {
  if (!complaintUuidSchema.safeParse(complaintId).success) {
    throw new ComplaintServiceError(
      400,
      "VALIDATION_ERROR",
      "Format ID pengaduan tidak valid."
    )
  }

  const { data: existing, error: fetchErr } = await supabase
    .from("complaints")
    .select("id, tenant_id, reporter_member_id, status, photo_path, deleted_at")
    .eq("tenant_id", tenantId)
    .eq("id", complaintId)
    .is("deleted_at", null)
    .maybeSingle()

  if (fetchErr) {
    throw mapComplaintDbError(fetchErr)
  }
  if (!existing) {
    throw new ComplaintServiceError(
      404,
      "NOT_FOUND",
      "Pengaduan tidak ditemukan atau sudah dihapus."
    )
  }

  const row = existing as {
    id: string
    tenant_id: string
    reporter_member_id: string
    status: ComplaintStatus
    photo_path: string | null
    deleted_at: string | null
  }

  if (row.reporter_member_id !== memberId) {
    throw new ComplaintServiceError(
      403,
      "FORBIDDEN",
      "Hanya pelapor pemilik yang dapat mengunggah foto pengaduan."
    )
  }
  if (row.status !== "open") {
    throw new ComplaintServiceError(
      400,
      "INVALID_STATE",
      "Foto pengaduan hanya dapat diunggah selama berstatus Menunggu."
    )
  }

  // Enqueue cleanup of any existing attached photo before attaching a new one
  if (row.photo_path) {
    const { error: cleanupErr } = await supabase.rpc(
      "request_delete_complaint_photo",
      {
        p_complaint_id: complaintId,
        p_reason: "replaced_by_new_upload",
      }
    )
    if (cleanupErr) {
      throw mapComplaintDbError(cleanupErr)
    }
  }

  const storagePath = buildComplaintPhotoPath(
    tenantId,
    complaintId,
    validatedFile.extension
  )

  const { error: uploadErr } = await supabase.storage
    .from(COMPLAINT_PHOTO_BUCKET)
    .upload(storagePath, validatedFile.buffer, {
      contentType: validatedFile.mimeType,
      upsert: false,
    })

  if (uploadErr) {
    throw new ComplaintServiceError(
      500,
      "STORAGE_ERROR",
      "Gagal mengunggah foto pengaduan ke penyimpanan privat."
    )
  }

  const { error: attachErr } = await supabase.rpc("attach_complaint_photo", {
    p_complaint_id: complaintId,
    p_storage_path: storagePath,
  })

  if (attachErr) {
    // Storage policies prohibit direct authenticated DELETE; unreferenced objects are
    // handled asynchronously by storage-orphan-scan and attach failure is surfaced safely.
    const mapped = mapComplaintDbError(attachErr)
    throw new ComplaintServiceError(
      mapped.status,
      mapped.code,
      "Foto terunggah ke penyimpanan privat, namun gagal ditautkan ke pengaduan. Silakan coba muat ulang dan ulangi penautan."
    )
  }

  return {
    complaintId,
    photoPath: storagePath,
    photoUrl: buildComplaintPhotoApiUrl(complaintId),
  }
}

export async function requestDeleteComplaintPhotoWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    memberId,
    roles,
    scope,
    input,
  }: {
    tenantId: string
    memberId: string
    roles: readonly RoleCode[]
    scope: ComplaintScope
    input: DeleteComplaintPhotoInput
  }
): Promise<DeleteComplaintPhotoResult> {
  const parsed = deleteComplaintPhotoSchema.safeParse(input)
  if (!parsed.success) {
    throw new ComplaintServiceError(
      400,
      "VALIDATION_ERROR",
      "Parameter penghapusan foto pengaduan tidak valid."
    )
  }

  if (scope === "admin" && !canManageComplaints(roles)) {
    throw new ComplaintServiceError(
      403,
      "FORBIDDEN",
      "Bendahara tidak berhak menghapus foto pengaduan."
    )
  }

  const { data: existing, error: fetchErr } = await supabase
    .from("complaints")
    .select("id, reporter_member_id, status, photo_path")
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.complaintId)
    .is("deleted_at", null)
    .maybeSingle()

  if (fetchErr) {
    throw mapComplaintDbError(fetchErr)
  }
  if (!existing) {
    throw new ComplaintServiceError(
      404,
      "NOT_FOUND",
      "Pengaduan tidak ditemukan atau sudah dihapus."
    )
  }

  const row = existing as {
    id: string
    reporter_member_id: string
    status: ComplaintStatus
    photo_path: string | null
  }

  if (scope === "resident") {
    if (row.reporter_member_id !== memberId) {
      throw new ComplaintServiceError(
        403,
        "FORBIDDEN",
        "Anda tidak berhak menghapus foto pengaduan warga lain."
      )
    }
    if (row.status !== "open") {
      throw new ComplaintServiceError(
        400,
        "INVALID_STATE",
        "Warga hanya dapat menghapus foto saat pengaduan berstatus Menunggu."
      )
    }
  }

  if (!row.photo_path) {
    throw new ComplaintServiceError(
      404,
      "NOT_FOUND",
      "Pengaduan ini belum memiliki foto yang terpasang."
    )
  }

  const { data, error: rpcErr } = await supabase.rpc(
    "request_delete_complaint_photo",
    {
      p_complaint_id: parsed.data.complaintId,
      p_reason: parsed.data.reason,
    }
  )

  if (rpcErr) {
    throw mapComplaintDbError(rpcErr)
  }

  const jobRow = (
    Array.isArray(data) ? data[0] : data
  ) as
    | { job_id: string; outcome: string; job_status: string }
    | null
    | undefined

  if (!jobRow) {
    throw new ComplaintServiceError(
      500,
      "INTERNAL_ERROR",
      "Gagal mengantrekan penghapusan foto pengaduan."
    )
  }

  return {
    jobId: jobRow.job_id,
    outcome: jobRow.outcome,
    jobStatus: jobRow.job_status,
  }
}

