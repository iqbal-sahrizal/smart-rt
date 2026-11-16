import type { SupabaseClient } from "@supabase/supabase-js"

import type { RoleCode } from "@/lib/auth/types"
import {
  ISSUED_LETTERS_BUCKET,
  LETTER_DEFAULT_PAGE_SIZE,
  LETTER_MAX_PAGE_SIZE,
  LETTER_REQUEST_DOCS_BUCKET,
  MAX_LETTER_SUPPORTING_DOCS,
} from "@/lib/letters/constants"
import { LetterServiceError, mapLetterDbError } from "@/lib/letters/errors"
import {
  cancelLetterRequestSchema,
  createLetterRequestSchema,
  createLetterTypeSchema,
  deleteLetterTypeSchema,
  letterListFiltersSchema,
  letterUuidSchema,
  removeLetterSupportingDocSchema,
  reviewLetterRequestSchema,
  updateLetterTypeSchema,
} from "@/lib/letters/schemas"
import {
  buildIssuedLetterApiUrl,
  buildIssuedLetterPdfPath,
  buildLetterAttachmentApiUrl,
  buildLetterAttachmentPath,
  extractLetterAttachmentFileId,
  inferLetterAttachmentContentType,
  issuedLetterPdfPathBelongsTo,
  letterAttachmentPathBelongsTo,
  type ValidatedIssuedLetterPdfFile,
  type ValidatedLetterAttachmentFile,
} from "@/lib/letters/storage"
import {
  canManageLetters,
  canReadLettersAdmin,
  canViewLetterDocuments,
  isLetterMetadataOnlyRole,
  type CancelLetterRequestInput,
  type CreateLetterRequestInput,
  type CreateLetterTypeInput,
  type DeleteLetterTypeInput,
  type IssueLetterResult,
  type LetterListFilters,
  type LetterPageResult,
  type LetterRequest,
  type LetterRequestAttachment,
  type LetterRequestDetail,
  type LetterRequestStatus,
  type LetterScope,
  type LetterStatusCounts,
  type LetterType,
  type RemoveLetterAttachmentResult,
  type RemoveLetterSupportingDocInput,
  type ReviewLetterRequestInput,
  type UpdateLetterTypeInput,
  type UploadLetterAttachmentResult,
} from "@/lib/letters/types"
import { isValidUuid } from "@/lib/residents/schemas"

export const LETTER_REQUEST_METADATA_SELECT_COLUMNS =
  "id, tenant_id, letter_type_id, resident_id, requested_by_member_id, purpose, status, admin_notes, letter_number, reviewed_by, reviewed_at, issued_at, created_at, updated_at" as const

/**
 * Full letter_requests select including Storage reference columns.
 * Never use for pengurus / metadata-only callers.
 */
export const LETTER_REQUEST_FULL_SELECT_COLUMNS =
  "id, tenant_id, letter_type_id, resident_id, requested_by_member_id, purpose, supporting_doc_paths, status, admin_notes, letter_number, issued_file_path, reviewed_by, reviewed_at, issued_at, created_at, updated_at" as const

export const LETTER_TYPE_SELECT_COLUMNS =
  "id, tenant_id, code, name, description, required_documents, is_active, created_at, updated_at" as const

interface RawLetterRequestRow {
  id: string
  tenant_id: string
  letter_type_id: string
  resident_id: string
  requested_by_member_id: string
  purpose: string
  supporting_doc_paths?: unknown
  status: LetterRequestStatus
  admin_notes: string | null
  letter_number: string | null
  issued_file_path?: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  issued_at: string | null
  created_at: string
  updated_at: string
}

interface RawLetterTypeRow {
  id: string
  tenant_id: string
  code: string
  name: string
  description: string | null
  required_documents: unknown
  is_active: boolean
  created_at: string
  updated_at: string
}

interface RawResidentLookupRow {
  id: string
  full_name: string
  household_id: string
}

interface RawHouseholdLookupRow {
  id: string
  block_unit: string | null
  address: string
}

interface RawReviewerMemberRow {
  user_id: string
  resident_id: string | null
  member_roles: Array<{
    role:
      | { code: string | null; name: string | null }
      | Array<{ code: string | null; name: string | null }>
      | null
  }> | null
}

function unwrapSingle<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null
  return Array.isArray(val) ? (val[0] ?? null) : val
}

function mapLetterTypeRow(row: RawLetterTypeRow): LetterType {
  const reqDocs = Array.isArray(row.required_documents)
    ? row.required_documents.filter((d): d is string => typeof d === "string")
    : []

  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    description: row.description,
    requiredDocuments: reqDocs,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function isAttachmentPathActive(
  supabase: SupabaseClient,
  storagePath: string
): Promise<boolean> {
  const [pendingRes, retiredRes] = await Promise.all([
    supabase.rpc("is_storage_object_deletion_pending", {
      p_bucket_id: LETTER_REQUEST_DOCS_BUCKET,
      p_object_path: storagePath,
    }),
    supabase.rpc("is_storage_object_path_retired", {
      p_bucket_id: LETTER_REQUEST_DOCS_BUCKET,
      p_object_path: storagePath,
    }),
  ])

  if (pendingRes.error || retiredRes.error) {
    return false
  }

  return pendingRes.data !== true && retiredRes.data !== true
}

async function isIssuedPdfPathActive(
  supabase: SupabaseClient,
  storagePath: string
): Promise<boolean> {
  const [pendingRes, retiredRes] = await Promise.all([
    supabase.rpc("is_storage_object_deletion_pending", {
      p_bucket_id: ISSUED_LETTERS_BUCKET,
      p_object_path: storagePath,
    }),
    supabase.rpc("is_storage_object_path_retired", {
      p_bucket_id: ISSUED_LETTERS_BUCKET,
      p_object_path: storagePath,
    }),
  ])

  if (pendingRes.error || retiredRes.error) {
    return false
  }

  return pendingRes.data !== true && retiredRes.data !== true
}

function buildAttachmentDescriptor(
  requestId: string,
  storagePath: string,
  index: number
): LetterRequestAttachment | null {
  const fileId = extractLetterAttachmentFileId(storagePath)
  if (!fileId) return null
  const { contentType, extension } = inferLetterAttachmentContentType(storagePath)
  return {
    fileId,
    fileName: `lampiran-${index + 1}-${fileId.slice(0, 8)}.${extension}`,
    contentType,
    extension,
    downloadUrl: buildLetterAttachmentApiUrl(requestId, fileId),
  }
}

async function resolveActiveAttachmentsForRow(
  supabase: SupabaseClient,
  row: RawLetterRequestRow,
  includeDocuments: boolean
): Promise<{
  attachments: LetterRequestAttachment[]
  hasIssuedPdf: boolean
  issuedPdfUrl: string | null
  issuedDownloadUrl: string | null
}> {
  if (!includeDocuments) {
    return {
      attachments: [],
      hasIssuedPdf: false,
      issuedPdfUrl: null,
      issuedDownloadUrl: null,
    }
  }

  const rawPaths = Array.isArray(row.supporting_doc_paths)
    ? row.supporting_doc_paths.filter(
        (p): p is string =>
          typeof p === "string" &&
          letterAttachmentPathBelongsTo(p, row.tenant_id, row.id)
      )
    : []

  let activePaths: string[] = []
  if (rawPaths.length > 0) {
    const checks = await Promise.all(
      rawPaths.map(async (p) => ((await isAttachmentPathActive(supabase, p)) ? p : null))
    )
    activePaths = checks.filter((p): p is string => p !== null)
  }

  const attachments: LetterRequestAttachment[] = []
  for (let i = 0; i < activePaths.length; i++) {
    const desc = buildAttachmentDescriptor(row.id, activePaths[i], i)
    if (desc) attachments.push(desc)
  }

  let hasIssuedPdf = false
  if (
    row.status === "completed" &&
    row.issued_file_path &&
    issuedLetterPdfPathBelongsTo(row.issued_file_path, row.tenant_id, row.id)
  ) {
    hasIssuedPdf = await isIssuedPdfPathActive(supabase, row.issued_file_path)
  }

  return {
    attachments,
    hasIssuedPdf,
    issuedPdfUrl: hasIssuedPdf ? buildIssuedLetterApiUrl(row.id, false) : null,
    issuedDownloadUrl: hasIssuedPdf ? buildIssuedLetterApiUrl(row.id, true) : null,
  }
}

async function buildEnrichmentLookups(
  supabase: SupabaseClient,
  tenantId: string,
  rows: readonly RawLetterRequestRow[]
): Promise<{
  typeMap: Map<string, LetterType>
  residentMap: Map<string, { fullName: string; unitLabel: string | null }>
  reviewerLabelMap: Map<string, string>
}> {
  const typeIds = Array.from(new Set(rows.map((r) => r.letter_type_id)))
  const residentIds = Array.from(new Set(rows.map((r) => r.resident_id)))
  const reviewerUserIds = Array.from(
    new Set(
      rows
        .map((r) => r.reviewed_by)
        .filter((id): id is string => typeof id === "string" && isValidUuid(id))
    )
  )

  const [typesRes, residentsRes, reviewerMembersRes] = await Promise.all([
    typeIds.length > 0
      ? supabase
          .from("letter_types")
          .select(LETTER_TYPE_SELECT_COLUMNS)
          .eq("tenant_id", tenantId)
          .in("id", typeIds)
      : Promise.resolve({ data: [], error: null }),
    residentIds.length > 0
      ? supabase
          .from("residents")
          .select("id, full_name, household_id")
          .eq("tenant_id", tenantId)
          .in("id", residentIds)
      : Promise.resolve({ data: [], error: null }),
    reviewerUserIds.length > 0
      ? supabase
          .from("tenant_members")
          .select(
            "user_id, resident_id, member_roles(role:roles(code, name))"
          )
          .eq("tenant_id", tenantId)
          .in("user_id", reviewerUserIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  const typeMap = new Map<string, LetterType>()
  for (const row of (typesRes.data ?? []) as RawLetterTypeRow[]) {
    const mapped = mapLetterTypeRow(row)
    typeMap.set(mapped.id, mapped)
  }

  const rawResidents = (residentsRes.data ?? []) as RawResidentLookupRow[]
  const householdIds = Array.from(
    new Set(rawResidents.map((r) => r.household_id).filter(Boolean))
  )

  const householdsRes =
    householdIds.length > 0
      ? await supabase
          .from("households")
          .select("id, block_unit, address")
          .eq("tenant_id", tenantId)
          .in("id", householdIds)
      : { data: [], error: null }

  const householdMap = new Map<string, RawHouseholdLookupRow>()
  for (const hh of (householdsRes.data ?? []) as RawHouseholdLookupRow[]) {
    householdMap.set(hh.id, hh)
  }

  const residentMap = new Map<
    string,
    { fullName: string; unitLabel: string | null }
  >()
  for (const res of rawResidents) {
    const hh = householdMap.get(res.household_id)
    const unitLabel = hh?.block_unit ?? hh?.address ?? null
    residentMap.set(res.id, { fullName: res.full_name, unitLabel })
  }

  const reviewerMembers = (reviewerMembersRes.data ??
    []) as unknown as RawReviewerMemberRow[]
  const reviewerResidentIds = Array.from(
    new Set(
      reviewerMembers
        .map((m) => m.resident_id)
        .filter((id): id is string => Boolean(id) && !residentMap.has(id!))
    )
  )
  const reviewerResidentNameMap = new Map<string, string>()
  for (const [id, info] of residentMap.entries()) {
    reviewerResidentNameMap.set(id, info.fullName)
  }
  if (reviewerResidentIds.length > 0) {
    const { data: revResidents } = await supabase
      .from("residents")
      .select("id, full_name")
      .eq("tenant_id", tenantId)
      .in("id", reviewerResidentIds)
    for (const r of (revResidents ?? []) as Array<{
      id: string
      full_name: string
    }>) {
      reviewerResidentNameMap.set(r.id, r.full_name)
    }
  }

  const reviewerLabelMap = new Map<string, string>()
  for (const m of reviewerMembers) {
    const resName = m.resident_id
      ? reviewerResidentNameMap.get(m.resident_id)
      : null
    const roleCodes = (m.member_roles ?? [])
      .map((mr) => unwrapSingle(mr.role)?.code ?? null)
      .filter((code): code is string => Boolean(code))
    const roleName = roleCodes.includes("ketua_rt")
      ? "Ketua RT"
      : roleCodes.includes("sekretaris")
        ? "Sekretaris"
        : "Pengurus RT"
    reviewerLabelMap.set(m.user_id, resName ? `${resName} (${roleName})` : roleName)
  }

  return { typeMap, residentMap, reviewerLabelMap }
}

async function mapRowsToRequests(
  supabase: SupabaseClient,
  tenantId: string,
  rows: readonly RawLetterRequestRow[],
  includeDocuments: boolean
): Promise<{
  items: LetterRequest[]
  typeMap: Map<string, LetterType>
}> {
  const { typeMap, residentMap, reviewerLabelMap } =
    await buildEnrichmentLookups(supabase, tenantId, rows)

  const docStates = await Promise.all(
    rows.map((row) =>
      resolveActiveAttachmentsForRow(supabase, row, includeDocuments)
    )
  )

  const items: LetterRequest[] = rows.map((row, idx) => {
    const lt = typeMap.get(row.letter_type_id)
    const resident = residentMap.get(row.resident_id)
    const docs = docStates[idx]

    return {
      id: row.id,
      tenantId: row.tenant_id,
      letterTypeId: row.letter_type_id,
      letterTypeCode: lt?.code ?? "-",
      letterTypeName: lt?.name ?? "Surat Pengantar",
      residentId: row.resident_id,
      residentName: resident?.fullName ?? "Warga Terdaftar",
      residentUnitLabel: resident?.unitLabel ?? null,
      requestedByMemberId: row.requested_by_member_id,
      purpose: row.purpose,
      status: row.status,
      adminNotes: row.admin_notes,
      letterNumber: row.letter_number,
      reviewedBy: row.reviewed_by,
      reviewedByLabel: row.reviewed_by
        ? (reviewerLabelMap.get(row.reviewed_by) ?? "Pengurus RT")
        : null,
      reviewedAt: row.reviewed_at,
      issuedAt: row.issued_at,
      hasIssuedPdf: docs.hasIssuedPdf,
      issuedPdfUrl: docs.issuedPdfUrl,
      issuedDownloadUrl: docs.issuedDownloadUrl,
      attachments: docs.attachments,
      attachmentCount: docs.attachments.length,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  })

  return { items, typeMap }
}

function summarizeStatusRows(
  rows: ReadonlyArray<{ status: LetterRequestStatus }>
): LetterStatusCounts {
  const summary: LetterStatusCounts = {
    submitted: 0,
    reviewing: 0,
    approved: 0,
    rejected: 0,
    completed: 0,
    cancelled: 0,
    total: 0,
  }

  for (const row of rows) {
    if (row.status in summary) {
      summary[row.status] += 1
    }
    summary.total += 1
  }

  return summary
}

function normalizeValidatedFilters(filters?: LetterListFilters): Required<
  Pick<LetterListFilters, "page" | "pageSize" | "sortBy" | "sort">
> &
  Omit<LetterListFilters, "page" | "pageSize" | "sortBy" | "sort"> {
  const parsed = letterListFiltersSchema.safeParse(filters ?? {})
  if (parsed.success) {
    return parsed.data
  }
  return {
    status: undefined,
    letterTypeId: undefined,
    search: undefined,
    page: 1,
    pageSize: LETTER_DEFAULT_PAGE_SIZE,
    sortBy: "created_at",
    sort: "desc",
  }
}

export async function listAdminLetterRequestsWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    filters,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    filters?: LetterListFilters
  }
): Promise<LetterPageResult> {
  if (!canReadLettersAdmin(roles)) {
    throw new LetterServiceError(
      403,
      "FORBIDDEN",
      "Anda tidak memiliki akses melihat daftar permohonan surat."
    )
  }

  const includeDocuments = canViewLetterDocuments(roles)
  const selectColumns = includeDocuments
    ? LETTER_REQUEST_FULL_SELECT_COLUMNS
    : LETTER_REQUEST_METADATA_SELECT_COLUMNS

  const normalized = normalizeValidatedFilters(filters)
  const safePageSize = Math.min(
    Math.max(normalized.pageSize, 1),
    LETTER_MAX_PAGE_SIZE
  )
  const safePage = Math.max(normalized.page, 1)
  const from = (safePage - 1) * safePageSize
  const to = from + safePageSize - 1

  let dataQuery = supabase
    .from("letter_requests")
    .select(selectColumns, { count: "exact" })
    .eq("tenant_id", tenantId)

  if (normalized.status) {
    dataQuery = dataQuery.eq("status", normalized.status)
  }
  if (normalized.letterTypeId) {
    dataQuery = dataQuery.eq("letter_type_id", normalized.letterTypeId)
  }
  if (normalized.search) {
    dataQuery = dataQuery.or(
      `purpose.ilike.%${normalized.search}%,letter_number.ilike.%${normalized.search}%`
    )
  }

  dataQuery = dataQuery
    .order(normalized.sortBy, { ascending: normalized.sort === "asc" })
    .order("id", { ascending: false })
    .range(from, to)

  const summaryQuery = supabase
    .from("letter_requests")
    .select("status")
    .eq("tenant_id", tenantId)

  const [listRes, summaryRes] = await Promise.all([dataQuery, summaryQuery])

  if (listRes.error) {
    throw mapLetterDbError(listRes.error)
  }
  if (summaryRes.error) {
    throw mapLetterDbError(summaryRes.error)
  }

  const rawRows = (listRes.data ?? []) as unknown as RawLetterRequestRow[]
  const { items } = await mapRowsToRequests(
    supabase,
    tenantId,
    rawRows,
    includeDocuments
  )

  const totalCount = listRes.count ?? rawRows.length
  const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize))
  const summary = summarizeStatusRows(
    (summaryRes.data ?? []) as Array<{ status: LetterRequestStatus }>
  )

  return {
    items,
    totalCount,
    page: Math.min(safePage, totalPages),
    pageSize: safePageSize,
    totalPages,
    summary,
    isMetadataOnly: isLetterMetadataOnlyRole(roles),
  }
}

export async function getAdminLetterRequestDetailWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    requestId,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    requestId: string
  }
): Promise<LetterRequestDetail | null> {
  if (!canReadLettersAdmin(roles)) {
    throw new LetterServiceError(
      403,
      "FORBIDDEN",
      "Anda tidak memiliki akses melihat detail permohonan surat."
    )
  }
  if (!isValidUuid(requestId)) {
    return null
  }

  const includeDocuments = canViewLetterDocuments(roles)
  const selectColumns = includeDocuments
    ? LETTER_REQUEST_FULL_SELECT_COLUMNS
    : LETTER_REQUEST_METADATA_SELECT_COLUMNS

  const { data: rowData, error } = await supabase
    .from("letter_requests")
    .select(selectColumns)
    .eq("tenant_id", tenantId)
    .eq("id", requestId)
    .maybeSingle()

  if (error) {
    throw mapLetterDbError(error)
  }
  if (!rowData) {
    return null
  }

  const row = rowData as unknown as RawLetterRequestRow
  const { items, typeMap } = await mapRowsToRequests(
    supabase,
    tenantId,
    [row],
    includeDocuments
  )
  const request = items[0]
  if (!request) return null

  const canManage = canManageLetters(roles)
  return {
    request,
    letterType: typeMap.get(row.letter_type_id) ?? null,
    permissions: {
      canAttachDocs: false,
      canRemoveDocs:
        canManage && (row.status === "submitted" || row.status === "reviewing"),
      canCancel: false,
      canReview:
        canManage && (row.status === "submitted" || row.status === "reviewing"),
      canIssue: canManage && row.status === "approved",
      canAccessDocuments: includeDocuments,
      isMetadataOnly: isLetterMetadataOnlyRole(roles),
    },
  }
}

export async function listAdminLetterTypesWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
  }
): Promise<{
  items: LetterType[]
  canManage: boolean
}> {
  if (!canReadLettersAdmin(roles)) {
    throw new LetterServiceError(
      403,
      "FORBIDDEN",
      "Anda tidak memiliki akses melihat jenis surat pada RT ini."
    )
  }

  const { data, error } = await supabase
    .from("letter_types")
    .select(LETTER_TYPE_SELECT_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("is_active", { ascending: false })
    .order("name", { ascending: true })

  if (error) {
    throw mapLetterDbError(error, { operation: "letter_type" })
  }

  const items = ((data ?? []) as RawLetterTypeRow[]).map(mapLetterTypeRow)
  return {
    items,
    canManage: canManageLetters(roles),
  }
}

function buildResidentOwnershipOrClause(
  memberId: string,
  residentId: string | null
): string | null {
  if (!isValidUuid(memberId)) {
    throw new LetterServiceError(403, "FORBIDDEN", "Identitas anggota tidak valid.")
  }
  if (residentId && isValidUuid(residentId)) {
    return `requested_by_member_id.eq.${memberId},resident_id.eq.${residentId}`
  }
  return null
}

export async function listResidentLetterRequestsWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    memberId,
    residentId,
    filters,
  }: {
    tenantId: string
    memberId: string
    residentId: string | null
    filters?: LetterListFilters
  }
): Promise<LetterPageResult> {
  const normalized = normalizeValidatedFilters(filters)
  const safePageSize = Math.min(
    Math.max(normalized.pageSize, 1),
    LETTER_MAX_PAGE_SIZE
  )
  const safePage = Math.max(normalized.page, 1)
  const from = (safePage - 1) * safePageSize
  const to = from + safePageSize - 1
  const ownershipOr = buildResidentOwnershipOrClause(memberId, residentId)

  let dataQuery = supabase
    .from("letter_requests")
    .select(LETTER_REQUEST_FULL_SELECT_COLUMNS, { count: "exact" })
    .eq("tenant_id", tenantId)

  dataQuery = ownershipOr
    ? dataQuery.or(ownershipOr)
    : dataQuery.eq("requested_by_member_id", memberId)

  if (normalized.status) {
    dataQuery = dataQuery.eq("status", normalized.status)
  }
  if (normalized.letterTypeId) {
    dataQuery = dataQuery.eq("letter_type_id", normalized.letterTypeId)
  }
  if (normalized.search) {
    dataQuery = dataQuery.or(
      `purpose.ilike.%${normalized.search}%,letter_number.ilike.%${normalized.search}%`
    )
  }

  dataQuery = dataQuery
    .order(normalized.sortBy, { ascending: normalized.sort === "asc" })
    .order("id", { ascending: false })
    .range(from, to)

  const baseSummaryQuery = supabase
    .from("letter_requests")
    .select("status")
    .eq("tenant_id", tenantId)

  const summaryQuery = ownershipOr
    ? baseSummaryQuery.or(ownershipOr)
    : baseSummaryQuery.eq("requested_by_member_id", memberId)

  const [listRes, summaryRes] = await Promise.all([dataQuery, summaryQuery])

  if (listRes.error) {
    throw mapLetterDbError(listRes.error)
  }
  if (summaryRes.error) {
    throw mapLetterDbError(summaryRes.error)
  }

  const rawRows = (listRes.data ?? []) as unknown as RawLetterRequestRow[]
  const { items } = await mapRowsToRequests(supabase, tenantId, rawRows, true)

  const totalCount = listRes.count ?? rawRows.length
  const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize))
  const summary = summarizeStatusRows(
    (summaryRes.data ?? []) as Array<{ status: LetterRequestStatus }>
  )

  return {
    items,
    totalCount,
    page: Math.min(safePage, totalPages),
    pageSize: safePageSize,
    totalPages,
    summary,
    isMetadataOnly: false,
  }
}

export async function getResidentLetterRequestDetailWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    memberId,
    residentId,
    requestId,
  }: {
    tenantId: string
    memberId: string
    residentId: string | null
    requestId: string
  }
): Promise<LetterRequestDetail | null> {
  if (!isValidUuid(requestId)) {
    return null
  }

  const ownershipOr = buildResidentOwnershipOrClause(memberId, residentId)
  const baseQuery = supabase
    .from("letter_requests")
    .select(LETTER_REQUEST_FULL_SELECT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", requestId)

  const query = ownershipOr
    ? baseQuery.or(ownershipOr)
    : baseQuery.eq("requested_by_member_id", memberId)

  const { data: rowData, error } = await query.maybeSingle()

  if (error) {
    throw mapLetterDbError(error)
  }
  if (!rowData) {
    return null
  }

  const row = rowData as unknown as RawLetterRequestRow
  const isRequester = row.requested_by_member_id === memberId
  const { items, typeMap } = await mapRowsToRequests(
    supabase,
    tenantId,
    [row],
    true
  )
  const request = items[0]
  if (!request) return null

  return {
    request,
    letterType: typeMap.get(row.letter_type_id) ?? null,
    permissions: {
      canAttachDocs:
        isRequester &&
        row.status === "submitted" &&
        request.attachmentCount < MAX_LETTER_SUPPORTING_DOCS,
      canRemoveDocs: isRequester && row.status === "submitted",
      canCancel: isRequester && row.status === "submitted",
      canReview: false,
      canIssue: false,
      canAccessDocuments: true,
      isMetadataOnly: false,
    },
  }
}

export async function listResidentActiveLetterTypesWithClient(
  supabase: SupabaseClient,
  { tenantId }: { tenantId: string }
): Promise<LetterType[]> {
  const { data, error } = await supabase
    .from("letter_types")
    .select(LETTER_TYPE_SELECT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("name", { ascending: true })

  if (error) {
    throw mapLetterDbError(error, { operation: "letter_type" })
  }

  return ((data ?? []) as RawLetterTypeRow[]).map(mapLetterTypeRow)
}

export async function createLetterRequestWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    memberId,
    residentId,
    input,
  }: {
    tenantId: string
    memberId: string
    residentId: string | null
    input: CreateLetterRequestInput
  }
): Promise<LetterRequest> {
  const parsed = createLetterRequestSchema.safeParse(input)
  if (!parsed.success) {
    throw new LetterServiceError(
      400,
      "VALIDATION_ERROR",
      "Periksa kembali jenis surat dan keperluan pengajuan."
    )
  }

  if (!residentId || !isValidUuid(residentId)) {
    throw new LetterServiceError(
      403,
      "INELIGIBLE_RESIDENT",
      "Akun warga belum terhubung ke profil penduduk aktif pada RT ini."
    )
  }

  const { data: ltCheck, error: ltErr } = await supabase
    .from("letter_types")
    .select("id, is_active")
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.letterTypeId)
    .maybeSingle()

  if (ltErr) {
    throw mapLetterDbError(ltErr, { operation: "create_request" })
  }
  if (!ltCheck || !ltCheck.is_active) {
    throw new LetterServiceError(
      400,
      "INELIGIBLE_RESIDENT",
      "Jenis surat tidak ditemukan atau sedang tidak aktif."
    )
  }

  const { data, error } = await supabase
    .from("letter_requests")
    .insert({
      tenant_id: tenantId,
      letter_type_id: parsed.data.letterTypeId,
      resident_id: residentId,
      requested_by_member_id: memberId,
      purpose: parsed.data.purpose,
    })
    .select(LETTER_REQUEST_FULL_SELECT_COLUMNS)
    .single()

  if (error) {
    throw mapLetterDbError(error, { operation: "create_request" })
  }

  const rawRow = data as unknown as RawLetterRequestRow
  const { items } = await mapRowsToRequests(supabase, tenantId, [rawRow], true)
  if (!items[0]) {
    throw new LetterServiceError(
      500,
      "INTERNAL_ERROR",
      "Gagal memuat permohonan surat yang baru dibuat."
    )
  }
  return items[0]
}

export async function uploadLetterSupportingDocWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    memberId,
    requestId,
    validatedFile,
  }: {
    tenantId: string
    memberId: string
    requestId: string
    validatedFile: ValidatedLetterAttachmentFile
  }
): Promise<UploadLetterAttachmentResult> {
  const parsedId = letterUuidSchema.safeParse(requestId)
  if (!parsedId.success) {
    throw new LetterServiceError(
      400,
      "VALIDATION_ERROR",
      "ID permohonan surat tidak valid."
    )
  }

  const { data: existing, error: fetchErr } = await supabase
    .from("letter_requests")
    .select("id, tenant_id, requested_by_member_id, status, supporting_doc_paths")
    .eq("tenant_id", tenantId)
    .eq("id", parsedId.data)
    .maybeSingle()

  if (fetchErr) {
    throw mapLetterDbError(fetchErr, { operation: "attachment" })
  }
  if (!existing) {
    throw new LetterServiceError(
      404,
      "NOT_FOUND",
      "Permohonan surat tidak ditemukan atau Anda tidak memiliki akses."
    )
  }

  const row = existing as {
    id: string
    tenant_id: string
    requested_by_member_id: string
    status: LetterRequestStatus
    supporting_doc_paths: unknown
  }

  if (row.requested_by_member_id !== memberId) {
    throw new LetterServiceError(
      403,
      "FORBIDDEN",
      "Hanya pemohon pemilik yang dapat mengunggah dokumen pendukung."
    )
  }

  if (row.status !== "submitted") {
    throw new LetterServiceError(
      400,
      "INVALID_STATE",
      "Dokumen pendukung hanya dapat diunggah selama berstatus Diajukan."
    )
  }

  const existingPaths = Array.isArray(row.supporting_doc_paths)
    ? row.supporting_doc_paths.filter((p): p is string => typeof p === "string")
    : []

  if (existingPaths.length >= MAX_LETTER_SUPPORTING_DOCS) {
    throw new LetterServiceError(
      400,
      "ATTACHMENT_LIMIT_REACHED",
      "Maksimal 5 dokumen pendukung yang dapat dilampirkan per permohonan surat."
    )
  }

  const storagePath = buildLetterAttachmentPath(
    tenantId,
    row.id,
    validatedFile.extension
  )

  const { error: uploadErr } = await supabase.storage
    .from(LETTER_REQUEST_DOCS_BUCKET)
    .upload(storagePath, validatedFile.buffer, {
      contentType: validatedFile.mimeType,
      upsert: false,
    })

  if (uploadErr) {
    throw new LetterServiceError(
      500,
      "STORAGE_ERROR",
      "Gagal mengunggah dokumen pendukung ke penyimpanan privat."
    )
  }

  const { error: attachErr } = await supabase.rpc(
    "attach_letter_supporting_doc",
    {
      p_request_id: row.id,
      p_storage_path: storagePath,
    }
  )

  if (attachErr) {
    // Unreferenced objects remain isolated in the private bucket and are cleaned up
    // asynchronously by storage-orphan-scan without bypassing storage_deletion_queue.
    const mapped = mapLetterDbError(attachErr, { operation: "attachment" })
    throw new LetterServiceError(
      mapped.status,
      mapped.code,
      mapped.code === "ATTACHMENT_LIMIT_REACHED"
        ? mapped.message
        : "Berkas terunggah ke penyimpanan privat, namun gagal ditautkan ke permohonan surat. Silakan muat ulang halaman dan coba lagi."
    )
  }

  const descriptor = buildAttachmentDescriptor(
    row.id,
    storagePath,
    existingPaths.length
  )
  if (!descriptor) {
    throw new LetterServiceError(
      500,
      "INTERNAL_ERROR",
      "Gagal menyusun metadata dokumen pendukung."
    )
  }

  return {
    requestId: row.id,
    attachment: descriptor,
    attachmentCount: existingPaths.length + 1,
  }
}

export async function requestRemoveLetterSupportingDocWithClient(
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
    scope: LetterScope
    input: RemoveLetterSupportingDocInput
  }
): Promise<RemoveLetterAttachmentResult> {
  const parsed = removeLetterSupportingDocSchema.safeParse(input)
  if (!parsed.success) {
    throw new LetterServiceError(
      400,
      "VALIDATION_ERROR",
      "Parameter penghapusan dokumen pendukung tidak valid."
    )
  }

  if (scope === "admin" && !canManageLetters(roles)) {
    throw new LetterServiceError(
      403,
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang dapat menghapus lampiran permohonan surat."
    )
  }

  const { data: existing, error: fetchErr } = await supabase
    .from("letter_requests")
    .select("id, tenant_id, requested_by_member_id, status, supporting_doc_paths")
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.requestId)
    .maybeSingle()

  if (fetchErr) {
    throw mapLetterDbError(fetchErr, { operation: "attachment" })
  }
  if (!existing) {
    throw new LetterServiceError(
      404,
      "NOT_FOUND",
      "Permohonan surat tidak ditemukan."
    )
  }

  const row = existing as {
    id: string
    tenant_id: string
    requested_by_member_id: string
    status: LetterRequestStatus
    supporting_doc_paths: unknown
  }

  if (scope === "resident") {
    if (row.requested_by_member_id !== memberId) {
      throw new LetterServiceError(
        403,
        "FORBIDDEN",
        "Hanya pemohon pemilik yang dapat menghapus dokumen pendukung."
      )
    }
    if (row.status !== "submitted") {
      throw new LetterServiceError(
        400,
        "INVALID_STATE",
        "Dokumen pendukung hanya dapat dihapus saat status masih Diajukan."
      )
    }
  } else if (row.status !== "submitted" && row.status !== "reviewing") {
    throw new LetterServiceError(
      400,
      "INVALID_STATE",
      "Lampiran tidak dapat dihapus setelah permohonan disetujui, selesai, ditolak, atau dibatalkan."
    )
  }

  const storedPaths = Array.isArray(row.supporting_doc_paths)
    ? row.supporting_doc_paths.filter((p): p is string => typeof p === "string")
    : []

  const targetFileId = parsed.data.fileId.toLowerCase()
  const matchedPath = storedPaths.find(
    (p) =>
      letterAttachmentPathBelongsTo(p, tenantId, row.id) &&
      extractLetterAttachmentFileId(p) === targetFileId
  )

  if (!matchedPath) {
    throw new LetterServiceError(
      404,
      "NOT_FOUND",
      "Dokumen pendukung tidak ditemukan pada permohonan surat ini."
    )
  }

  const { data: queueRes, error: rpcErr } = await supabase.rpc(
    "request_remove_letter_supporting_doc",
    {
      p_request_id: row.id,
      p_storage_path: matchedPath,
      p_reason: parsed.data.reason,
    }
  )

  if (rpcErr) {
    throw mapLetterDbError(rpcErr, { operation: "attachment" })
  }

  const firstRow = (
    Array.isArray(queueRes) ? queueRes[0] : queueRes
  ) as { job_id?: string; outcome?: string; job_status?: string } | null

  return {
    requestId: row.id,
    fileId: targetFileId,
    jobId: firstRow?.job_id ?? "",
    outcome: firstRow?.outcome ?? "enqueued",
    jobStatus: firstRow?.job_status ?? "pending",
  }
}

export async function cancelLetterRequestWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    memberId,
    input,
  }: {
    tenantId: string
    memberId: string
    input: CancelLetterRequestInput
  }
): Promise<{ requestId: string; status: "cancelled" }> {
  const parsed = cancelLetterRequestSchema.safeParse(input)
  if (!parsed.success) {
    throw new LetterServiceError(
      400,
      "VALIDATION_ERROR",
      "Parameter pembatalan permohonan surat tidak valid."
    )
  }

  const { data: existing, error: fetchErr } = await supabase
    .from("letter_requests")
    .select("id, requested_by_member_id, status")
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.requestId)
    .maybeSingle()

  if (fetchErr) {
    throw mapLetterDbError(fetchErr, { operation: "cancel" })
  }
  if (!existing) {
    throw new LetterServiceError(
      404,
      "NOT_FOUND",
      "Permohonan surat tidak ditemukan."
    )
  }

  if (existing.requested_by_member_id !== memberId) {
    throw new LetterServiceError(
      403,
      "FORBIDDEN",
      "Hanya warga pemohon yang dapat membatalkan permohonan surat."
    )
  }

  if (existing.status !== "submitted") {
    throw new LetterServiceError(
      400,
      "INVALID_STATE",
      "Permohonan surat hanya dapat dibatalkan saat masih berstatus Diajukan."
    )
  }

  const { error: rpcErr } = await supabase.rpc("cancel_letter_request", {
    p_request_id: parsed.data.requestId,
    p_reason: parsed.data.reason,
  })

  if (rpcErr) {
    throw mapLetterDbError(rpcErr, { operation: "cancel" })
  }

  return {
    requestId: parsed.data.requestId,
    status: "cancelled",
  }
}

export async function reviewLetterRequestWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    input,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    input: ReviewLetterRequestInput
  }
): Promise<{ requestId: string; status: LetterRequestStatus }> {
  if (!canManageLetters(roles)) {
    throw new LetterServiceError(
      403,
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang dapat meninjau permohonan surat."
    )
  }

  const parsed = reviewLetterRequestSchema.safeParse(input)
  if (!parsed.success) {
    throw new LetterServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ??
        "Parameter peninjauan permohonan surat tidak valid."
    )
  }

  const { data: existing, error: fetchErr } = await supabase
    .from("letter_requests")
    .select("id, status")
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.requestId)
    .maybeSingle()

  if (fetchErr) {
    throw mapLetterDbError(fetchErr, { operation: "review" })
  }
  if (!existing) {
    throw new LetterServiceError(
      404,
      "NOT_FOUND",
      "Permohonan surat tidak ditemukan pada RT ini."
    )
  }

  const { error: rpcErr } = await supabase.rpc("review_letter_request", {
    p_request_id: parsed.data.requestId,
    p_decision: parsed.data.decision,
    p_admin_notes: parsed.data.adminNotes,
  })

  if (rpcErr) {
    throw mapLetterDbError(rpcErr, { operation: "review" })
  }

  return {
    requestId: parsed.data.requestId,
    status: parsed.data.decision,
  }
}

export async function issueLetterWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    requestId,
    validatedFile,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    requestId: string
    validatedFile: ValidatedIssuedLetterPdfFile
  }
): Promise<IssueLetterResult> {
  if (!canManageLetters(roles)) {
    throw new LetterServiceError(
      403,
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang dapat menerbitkan surat."
    )
  }

  const parsedId = letterUuidSchema.safeParse(requestId)
  if (!parsedId.success) {
    throw new LetterServiceError(
      400,
      "VALIDATION_ERROR",
      "ID permohonan surat tidak valid."
    )
  }

  const { data: existing, error: fetchErr } = await supabase
    .from("letter_requests")
    .select("id, status")
    .eq("tenant_id", tenantId)
    .eq("id", parsedId.data)
    .maybeSingle()

  if (fetchErr) {
    throw mapLetterDbError(fetchErr, { operation: "issue" })
  }
  if (!existing) {
    throw new LetterServiceError(
      404,
      "NOT_FOUND",
      "Permohonan surat tidak ditemukan pada RT ini."
    )
  }
  if (existing.status !== "approved") {
    throw new LetterServiceError(
      400,
      "INVALID_STATE",
      "Surat hanya dapat diterbitkan setelah permohonan berstatus Disetujui."
    )
  }

  const storagePath = buildIssuedLetterPdfPath(tenantId, existing.id)
  const { error: uploadErr } = await supabase.storage
    .from(ISSUED_LETTERS_BUCKET)
    .upload(storagePath, validatedFile.buffer, {
      contentType: validatedFile.mimeType,
      upsert: false,
    })

  if (uploadErr) {
    throw new LetterServiceError(
      500,
      "STORAGE_ERROR",
      "Gagal mengunggah PDF surat terbit ke penyimpanan privat."
    )
  }

  const { data: letterNumberData, error: issueErr } = await supabase.rpc(
    "issue_letter",
    {
      p_request_id: existing.id,
      p_storage_path: storagePath,
    }
  )

  if (issueErr || typeof letterNumberData !== "string") {
    // Unreferenced PDF objects are cleaned asynchronously by storage-orphan-scan
    // without bypassing storage_deletion_queue or exposing internal storage paths.
    if (issueErr) {
      const mapped = mapLetterDbError(issueErr, { operation: "issue" })
      throw new LetterServiceError(
        mapped.status,
        mapped.code,
        "PDF terunggah ke penyimpanan privat, namun gagal mencatat penerbitan surat. Silakan muat ulang dan ulangi penerbitan."
      )
    }
    throw new LetterServiceError(
      500,
      "INTERNAL_ERROR",
      "Gagal membaca nomor surat hasil penerbitan."
    )
  }

  return {
    requestId: existing.id,
    letterNumber: letterNumberData,
    issuedPdfUrl: buildIssuedLetterApiUrl(existing.id, false),
    issuedDownloadUrl: buildIssuedLetterApiUrl(existing.id, true),
  }
}

export async function createLetterTypeWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    input,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    input: CreateLetterTypeInput
  }
): Promise<LetterType> {
  if (!canManageLetters(roles)) {
    throw new LetterServiceError(
      403,
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang dapat membuat jenis surat."
    )
  }

  const parsed = createLetterTypeSchema.safeParse(input)
  if (!parsed.success) {
    throw new LetterServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data jenis surat tidak valid."
    )
  }

  const { data, error } = await supabase
    .from("letter_types")
    .insert({
      tenant_id: tenantId,
      code: parsed.data.code,
      name: parsed.data.name,
      description: parsed.data.description,
      required_documents: parsed.data.requiredDocuments,
      is_active: parsed.data.isActive,
    })
    .select(LETTER_TYPE_SELECT_COLUMNS)
    .single()

  if (error) {
    throw mapLetterDbError(error, { operation: "letter_type" })
  }

  return mapLetterTypeRow(data as RawLetterTypeRow)
}

export async function updateLetterTypeWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    input,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    input: UpdateLetterTypeInput
  }
): Promise<LetterType> {
  if (!canManageLetters(roles)) {
    throw new LetterServiceError(
      403,
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang dapat mengubah jenis surat."
    )
  }

  const parsed = updateLetterTypeSchema.safeParse(input)
  if (!parsed.success) {
    throw new LetterServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data pembaruan jenis surat tidak valid."
    )
  }

  const { data, error } = await supabase
    .from("letter_types")
    .update({
      code: parsed.data.code,
      name: parsed.data.name,
      description: parsed.data.description,
      required_documents: parsed.data.requiredDocuments,
      is_active: parsed.data.isActive,
    })
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.letterTypeId)
    .select(LETTER_TYPE_SELECT_COLUMNS)
    .maybeSingle()

  if (error) {
    throw mapLetterDbError(error, { operation: "letter_type" })
  }
  if (!data) {
    throw new LetterServiceError(
      404,
      "NOT_FOUND",
      "Jenis surat tidak ditemukan pada RT ini."
    )
  }

  return mapLetterTypeRow(data as RawLetterTypeRow)
}

export async function deleteLetterTypeWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    input,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    input: DeleteLetterTypeInput
  }
): Promise<{ letterTypeId: string; deleted: true }> {
  if (!canManageLetters(roles)) {
    throw new LetterServiceError(
      403,
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang dapat menghapus jenis surat."
    )
  }

  const parsed = deleteLetterTypeSchema.safeParse(input)
  if (!parsed.success) {
    throw new LetterServiceError(
      400,
      "VALIDATION_ERROR",
      "ID jenis surat tidak valid."
    )
  }

  const { data: existing, error: fetchErr } = await supabase
    .from("letter_types")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.letterTypeId)
    .maybeSingle()

  if (fetchErr) {
    throw mapLetterDbError(fetchErr, { operation: "letter_type" })
  }
  if (!existing) {
    throw new LetterServiceError(
      404,
      "NOT_FOUND",
      "Jenis surat tidak ditemukan pada RT ini."
    )
  }

  const { error: delErr } = await supabase
    .from("letter_types")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.letterTypeId)

  if (delErr) {
    throw mapLetterDbError(delErr, { operation: "letter_type" })
  }

  return { letterTypeId: parsed.data.letterTypeId, deleted: true }
}
