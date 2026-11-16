import type { SupabaseClient } from "@supabase/supabase-js"

import type { RoleCode } from "@/lib/auth/types"
import {
  ACTIVITY_DEFAULT_PAGE_SIZE,
  ACTIVITY_DOCS_BUCKET,
  ACTIVITY_MAX_PAGE_SIZE,
  MAX_ACTIVITY_DOCS,
} from "@/lib/activities/constants"
import {
  ActivityServiceError,
  mapActivityDbError,
} from "@/lib/activities/errors"
import {
  activityListFiltersSchema,
  activityParticipantsFiltersSchema,
  activityUuidSchema,
  addActivityParticipantSchema,
  cancelActivityRegistrationSchema,
  createActivitySchema,
  recordActivityAttendanceSchema,
  registerForActivitySchema,
  removeActivityDocSchema,
  removeActivityParticipantSchema,
  softDeleteActivitySchema,
  transitionActivityStatusSchema,
  updateActivitySchema,
} from "@/lib/activities/schemas"
import {
  activityDocPathBelongsTo,
  buildActivityDocApiUrl,
  buildActivityDocPath,
  extractActivityDocFileId,
  inferActivityDocContentType,
  type ValidatedActivityDocFile,
} from "@/lib/activities/storage"
import {
  canManageActivities,
  canOperateActivities,
  canReadActivitiesAdmin,
  canRemoveActivityDoc,
  canTransitionActivityStatus,
  canUploadActivityDoc,
  type ActivityCategory,
  type ActivityDetail,
  type ActivityDocument,
  type ActivityItem,
  type ActivityListFilters,
  type ActivityPageResult,
  type ActivityParticipant,
  type ActivityParticipantsFilters,
  type ActivityParticipantsPageResult,
  type ActivityParticipantStatus,
  type ActivityParticipantSummary,
  type ActivityPermissions,
  type ActivityStatus,
  type ActivityStatusCounts,
  type AddActivityParticipantInput,
  type CancelActivityRegistrationInput,
  type CancelActivityRegistrationResult,
  type CreateActivityInput,
  type RecordActivityAttendanceInput,
  type RegisterActivityResult,
  type RegisterForActivityInput,
  type RemoveActivityDocInput,
  type RemoveActivityDocResult,
  type RemoveActivityParticipantInput,
  type RemoveActivityParticipantResult,
  type ResidentActivityDetail,
  type ResidentActivityHistoryItem,
  type ResidentActivityHistoryPageResult,
  type ResidentActivityItem,
  type ResidentActivityPageResult,
  type ResidentActivityRegistrationDetail,
  type ResidentActivityRegistrationSummary,
  type SoftDeleteActivityInput,
  type TransitionActivityStatusInput,
  type UpdateActivityInput,
  type UploadActivityDocResult,
} from "@/lib/activities/types"

export const ACTIVITY_SELECT_COLUMNS =
  "id, tenant_id, title, description, category, location, start_at, end_at, status, allow_self_registration, max_participants, registration_deadline, documentation_paths, created_by, updated_by, cancelled_at, cancelled_by, cancellation_reason, deleted_at, created_at, updated_at" as const

export const ACTIVITY_PARTICIPANT_SELECT_COLUMNS =
  "id, tenant_id, activity_id, resident_id, resident_name_snapshot, household_label_snapshot, rsvp_status, registration_notes, cancellation_reason, cancelled_at, recorded_by, registered_at, updated_at" as const

interface RawActivityRow {
  id: string
  tenant_id: string
  title: string
  description: string | null
  category: ActivityCategory
  location: string
  start_at: string
  end_at: string | null
  status: ActivityStatus
  allow_self_registration: boolean
  max_participants: number | null
  registration_deadline: string | null
  documentation_paths: unknown
  created_by: string
  updated_by: string | null
  cancelled_at: string | null
  cancelled_by: string | null
  cancellation_reason: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

interface RawActivityParticipantRow {
  id: string
  tenant_id: string
  activity_id: string
  resident_id: string | null
  resident_name_snapshot: string
  household_label_snapshot: string
  rsvp_status: ActivityParticipantStatus
  registration_notes: string | null
  cancellation_reason: string | null
  cancelled_at: string | null
  recorded_by: string | null
  registered_at: string
  updated_at: string
}

interface RawRegistrationCountRow {
  activity_id: string
  active_count: number
}

function sanitizePostgrestSearch(search: string): string {
  return search.replace(/[,()*%\\]/g, " ").replace(/\s+/g, " ").trim()
}

function mapRawActivityDocuments(
  rawPaths: unknown,
  tenantId: string,
  activityId: string
): ActivityDocument[] {
  if (!Array.isArray(rawPaths)) return []

  const docs: ActivityDocument[] = []
  let index = 1
  for (const item of rawPaths) {
    if (typeof item !== "string") continue
    if (!activityDocPathBelongsTo(item, tenantId, activityId)) continue
    const fileId = extractActivityDocFileId(item)
    if (!fileId) continue
    const { contentType, extension } = inferActivityDocContentType(item)
    docs.push({
      fileId,
      fileName: `dokumentasi-${index}.${extension}`,
      contentType,
      extension,
      viewUrl: buildActivityDocApiUrl(activityId, fileId, false),
      downloadUrl: buildActivityDocApiUrl(activityId, fileId, true),
    })
    index += 1
  }
  return docs
}

function mapActivityRow(
  row: RawActivityRow,
  activeCount: number
): ActivityItem {
  const docs =
    row.deleted_at === null
      ? mapRawActivityDocuments(row.documentation_paths, row.tenant_id, row.id)
      : []
  const maxParticipants = row.max_participants
  const remainingSlots =
    maxParticipants === null ? null : Math.max(maxParticipants - activeCount, 0)

  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    description: row.description,
    category: row.category,
    location: row.location,
    startAt: row.start_at,
    endAt: row.end_at,
    status: row.status,
    allowSelfRegistration: Boolean(row.allow_self_registration),
    maxParticipants,
    registrationDeadline: row.registration_deadline,
    activeParticipantCount: activeCount,
    remainingSlots,
    isFull: maxParticipants !== null && activeCount >= maxParticipants,
    documents: docs,
    documentCount: docs.length,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by,
    cancellationReason: row.cancellation_reason,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapParticipantRow(
  row: RawActivityParticipantRow
): ActivityParticipant {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    activityId: row.activity_id,
    residentId: row.resident_id,
    residentNameSnapshot: row.resident_name_snapshot,
    householdLabelSnapshot: row.household_label_snapshot,
    rsvpStatus: row.rsvp_status,
    registrationNotes: row.registration_notes,
    cancellationReason: row.cancellation_reason,
    cancelledAt: row.cancelled_at,
    recordedBy: row.recorded_by,
    registeredAt: row.registered_at,
    updatedAt: row.updated_at,
  }
}

function mapParticipantSummaryRow(
  row: RawActivityParticipantRow
): ResidentActivityRegistrationSummary {
  return {
    participantId: row.id,
    activityId: row.activity_id,
    rsvpStatus: row.rsvp_status,
    registrationNotes: row.registration_notes,
    cancellationReason: row.cancellation_reason,
    cancelledAt: row.cancelled_at,
    registeredAt: row.registered_at,
    updatedAt: row.updated_at,
  }
}

function summarizeActivityStatuses(
  rows: ReadonlyArray<{ status: ActivityStatus }>
): ActivityStatusCounts {
  const summary: ActivityStatusCounts = {
    scheduled: 0,
    ongoing: 0,
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

function summarizeParticipantStatuses(
  rows: ReadonlyArray<{ rsvp_status: ActivityParticipantStatus }>
): ActivityParticipantSummary {
  const summary: ActivityParticipantSummary = {
    invited: 0,
    attending: 0,
    cancelled: 0,
    attended: 0,
    absent: 0,
    activeSeats: 0,
    total: 0,
  }
  for (const row of rows) {
    if (row.rsvp_status in summary) {
      summary[row.rsvp_status] += 1
    }
    if (row.rsvp_status === "attending" || row.rsvp_status === "attended") {
      summary.activeSeats += 1
    }
    summary.total += 1
  }
  return summary
}

function computeActivityPermissions(
  activity: ActivityItem,
  roles: readonly RoleCode[]
): ActivityPermissions {
  const isDeleted = activity.deletedAt !== null
  const isActiveState =
    activity.status === "scheduled" || activity.status === "ongoing"
  const canManage = canManageActivities(roles)
  const canOperate = canOperateActivities(roles)

  return {
    canUpdateInfo: !isDeleted && canManage && isActiveState,
    canStartActivity:
      !isDeleted && canOperate && activity.status === "scheduled",
    canCompleteActivity:
      !isDeleted && canOperate && activity.status === "ongoing",
    canCancelActivity: !isDeleted && canManage && isActiveState,
    canSoftDelete: !isDeleted && canManage,
    canManageParticipants: !isDeleted && canManage && isActiveState,
    canRecordAttendance:
      !isDeleted && canOperate && activity.status !== "cancelled",
    canUploadDocuments:
      !isDeleted &&
      canUploadActivityDoc(roles) &&
      activity.status !== "cancelled" &&
      activity.documentCount < MAX_ACTIVITY_DOCS,
    canRemoveDocuments: !isDeleted && canRemoveActivityDoc(roles),
  }
}

function evaluateResidentRegistrationEligibility({
  activity,
  myRegistration,
  isEligibleResident,
  nowMs = Date.now(),
}: {
  activity: ActivityItem
  myRegistration: ResidentActivityRegistrationSummary | null
  isEligibleResident: boolean
  nowMs?: number
}): {
  canRegister: boolean
  canCancelRegistration: boolean
  registrationBlockReason: string | null
} {
  if (activity.deletedAt !== null) {
    return {
      canRegister: false,
      canCancelRegistration: false,
      registrationBlockReason: "Kegiatan ini sudah tidak tersedia.",
    }
  }

  const isActiveActivityStatus =
    activity.status === "scheduled" || activity.status === "ongoing"

  const canCancelRegistration =
    isActiveActivityStatus &&
    myRegistration !== null &&
    (myRegistration.rsvpStatus === "invited" ||
      myRegistration.rsvpStatus === "attending")

  if (!isEligibleResident) {
    return {
      canRegister: false,
      canCancelRegistration,
      registrationBlockReason:
        "Hanya warga aktif pada rumah tangga aktif yang dapat mendaftar kegiatan.",
    }
  }

  if (!isActiveActivityStatus) {
    return {
      canRegister: false,
      canCancelRegistration,
      registrationBlockReason:
        activity.status === "cancelled"
          ? "Kegiatan ini telah dibatalkan."
          : "Kegiatan ini telah selesai dilaksanakan.",
    }
  }

  if (myRegistration?.rsvpStatus === "attending") {
    return {
      canRegister: false,
      canCancelRegistration,
      registrationBlockReason: "Anda sudah terdaftar sebagai peserta.",
    }
  }

  if (myRegistration?.rsvpStatus === "attended") {
    return {
      canRegister: false,
      canCancelRegistration: false,
      registrationBlockReason: "Kehadiran Anda pada kegiatan ini sudah tercatat.",
    }
  }

  if (myRegistration?.rsvpStatus === "absent") {
    return {
      canRegister: false,
      canCancelRegistration: false,
      registrationBlockReason:
        "Status Anda pada kegiatan ini sudah tercatat tidak hadir.",
    }
  }

  if (!activity.allowSelfRegistration) {
    return {
      canRegister: false,
      canCancelRegistration,
      registrationBlockReason: "Pendaftaran mandiri ditutup untuk kegiatan ini.",
    }
  }

  const deadlineIso =
    activity.registrationDeadline ?? activity.endAt ?? activity.startAt
  const deadlineMs = Date.parse(deadlineIso)
  const effectiveEndMs = Date.parse(activity.endAt ?? activity.startAt)

  if (
    (!Number.isNaN(deadlineMs) && nowMs > deadlineMs) ||
    (!Number.isNaN(effectiveEndMs) && nowMs > effectiveEndMs)
  ) {
    return {
      canRegister: false,
      canCancelRegistration,
      registrationBlockReason: "Batas waktu pendaftaran kegiatan telah berakhir.",
    }
  }

  if (
    activity.maxParticipants !== null &&
    activity.activeParticipantCount >= activity.maxParticipants
  ) {
    return {
      canRegister: false,
      canCancelRegistration,
      registrationBlockReason: "Kuota peserta kegiatan sudah penuh.",
    }
  }

  return {
    canRegister: true,
    canCancelRegistration,
    registrationBlockReason: null,
  }
}

async function fetchRegistrationCountsMap(
  supabase: SupabaseClient,
  activityIds: readonly string[]
): Promise<Map<string, number>> {
  const uniqueIds = Array.from(new Set(activityIds)).filter(Boolean)
  const map = new Map<string, number>()
  if (uniqueIds.length === 0) return map

  const { data, error } = await supabase.rpc(
    "get_activity_registration_counts",
    {
      p_activity_ids: uniqueIds,
    }
  )

  if (error) {
    throw mapActivityDbError(error, { operation: "read" })
  }

  for (const row of (data ?? []) as RawRegistrationCountRow[]) {
    if (row.activity_id) {
      map.set(row.activity_id, Number(row.active_count ?? 0))
    }
  }

  return map
}

async function checkResidentEligibilityWithClient(
  supabase: SupabaseClient,
  tenantId: string,
  residentId: string | null
): Promise<boolean> {
  if (!residentId) return false
  const { data, error } = await supabase.rpc("is_activity_resident_eligible", {
    p_tenant_id: tenantId,
    p_resident_id: residentId,
  })
  if (error) {
    throw mapActivityDbError(error, { operation: "read" })
  }
  return data === true
}

function normalizeListFilters(filters?: ActivityListFilters) {
  const parsed = activityListFiltersSchema.safeParse(filters ?? {})
  if (parsed.success) return parsed.data
  return {
    status: undefined,
    category: undefined,
    search: undefined,
    upcomingOnly: undefined,
    includeDeleted: undefined,
    page: 1,
    pageSize: ACTIVITY_DEFAULT_PAGE_SIZE,
    sortBy: "start_at" as const,
    sort: "asc" as const,
  }
}

export async function listAdminActivitiesWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    filters,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    filters?: ActivityListFilters
  }
): Promise<ActivityPageResult> {
  if (!canReadActivitiesAdmin(roles)) {
    throw new ActivityServiceError(
      403,
      "FORBIDDEN",
      "Role Anda tidak memiliki akses operasional kegiatan warga."
    )
  }

  const normalized = normalizeListFilters(filters)
  const safePageSize = Math.min(
    Math.max(normalized.pageSize, 1),
    ACTIVITY_MAX_PAGE_SIZE
  )
  const safePage = Math.max(normalized.page, 1)
  const from = (safePage - 1) * safePageSize
  const to = from + safePageSize - 1

  let dataQuery = supabase
    .from("activities")
    .select(ACTIVITY_SELECT_COLUMNS, { count: "exact" })
    .eq("tenant_id", tenantId)

  if (!normalized.includeDeleted) {
    dataQuery = dataQuery.is("deleted_at", null)
  }
  if (normalized.status) {
    dataQuery = dataQuery.eq("status", normalized.status)
  }
  if (normalized.category) {
    dataQuery = dataQuery.eq("category", normalized.category)
  }
  if (normalized.upcomingOnly) {
    dataQuery = dataQuery
      .in("status", ["scheduled", "ongoing"])
      .gte("start_at", new Date().toISOString())
  }
  if (normalized.search) {
    const safeSearch = sanitizePostgrestSearch(normalized.search)
    if (safeSearch) {
      dataQuery = dataQuery.or(
        `title.ilike.%${safeSearch}%,location.ilike.%${safeSearch}%,description.ilike.%${safeSearch}%`
      )
    }
  }

  dataQuery = dataQuery
    .order(normalized.sortBy, { ascending: normalized.sort === "asc" })
    .order("id", { ascending: false })
    .range(from, to)

  const summaryQuery = supabase
    .from("activities")
    .select("status")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)

  const [listRes, summaryRes] = await Promise.all([dataQuery, summaryQuery])

  if (listRes.error) {
    throw mapActivityDbError(listRes.error, { operation: "read" })
  }
  if (summaryRes.error) {
    throw mapActivityDbError(summaryRes.error, { operation: "read" })
  }

  const rawRows = (listRes.data ?? []) as unknown as RawActivityRow[]
  const countsMap = await fetchRegistrationCountsMap(
    supabase,
    rawRows.map((r) => r.id)
  )

  const items = rawRows.map((row) =>
    mapActivityRow(row, countsMap.get(row.id) ?? 0)
  )
  const totalCount = listRes.count ?? rawRows.length
  const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize))

  return {
    items,
    totalCount,
    page: Math.min(safePage, totalPages),
    pageSize: safePageSize,
    totalPages,
    summary: summarizeActivityStatuses(
      (summaryRes.data ?? []) as Array<{ status: ActivityStatus }>
    ),
    canManage: canManageActivities(roles),
    canOperate: canOperateActivities(roles),
  }
}

export async function getAdminActivityDetailWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    activityId,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    activityId: string
  }
): Promise<ActivityDetail | null> {
  if (!canReadActivitiesAdmin(roles)) {
    throw new ActivityServiceError(
      403,
      "FORBIDDEN",
      "Role Anda tidak memiliki akses operasional kegiatan warga."
    )
  }

  const parsedId = activityUuidSchema.safeParse(activityId)
  if (!parsedId.success) {
    throw new ActivityServiceError(
      400,
      "VALIDATION_ERROR",
      "ID kegiatan tidak valid."
    )
  }

  const { data, error } = await supabase
    .from("activities")
    .select(ACTIVITY_SELECT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", parsedId.data)
    .maybeSingle()

  if (error) {
    throw mapActivityDbError(error, { operation: "read" })
  }
  if (!data) {
    return null
  }

  const row = data as unknown as RawActivityRow
  const countsMap = await fetchRegistrationCountsMap(supabase, [row.id])
  const activity = mapActivityRow(row, countsMap.get(row.id) ?? 0)

  return {
    activity,
    permissions: computeActivityPermissions(activity, roles),
  }
}

export async function listAdminActivityParticipantsWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    activityId,
    filters,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    activityId: string
    filters?: ActivityParticipantsFilters
  }
): Promise<ActivityParticipantsPageResult> {
  if (!canReadActivitiesAdmin(roles)) {
    throw new ActivityServiceError(
      403,
      "FORBIDDEN",
      "Role Anda tidak memiliki akses daftar peserta kegiatan."
    )
  }

  const parsedId = activityUuidSchema.safeParse(activityId)
  if (!parsedId.success) {
    throw new ActivityServiceError(
      400,
      "VALIDATION_ERROR",
      "ID kegiatan tidak valid."
    )
  }

  const { data: activityRow, error: actErr } = await supabase
    .from("activities")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", parsedId.data)
    .maybeSingle()

  if (actErr) {
    throw mapActivityDbError(actErr, { operation: "read" })
  }
  if (!activityRow) {
    throw new ActivityServiceError(
      404,
      "NOT_FOUND",
      "Kegiatan warga tidak ditemukan pada RT ini."
    )
  }

  const parsedFilters = activityParticipantsFiltersSchema.safeParse(filters ?? {})
  const normalized = parsedFilters.success
    ? parsedFilters.data
    : {
        rsvpStatus: undefined,
        search: undefined,
        page: 1,
        pageSize: ACTIVITY_DEFAULT_PAGE_SIZE,
      }
  const safePageSize = Math.min(
    Math.max(normalized.pageSize, 1),
    ACTIVITY_MAX_PAGE_SIZE
  )
  const safePage = Math.max(normalized.page, 1)
  const from = (safePage - 1) * safePageSize
  const to = from + safePageSize - 1

  let dataQuery = supabase
    .from("activity_participants")
    .select(ACTIVITY_PARTICIPANT_SELECT_COLUMNS, { count: "exact" })
    .eq("tenant_id", tenantId)
    .eq("activity_id", parsedId.data)

  if (normalized.rsvpStatus) {
    dataQuery = dataQuery.eq("rsvp_status", normalized.rsvpStatus)
  }
  if (normalized.search) {
    const safeSearch = sanitizePostgrestSearch(normalized.search)
    if (safeSearch) {
      dataQuery = dataQuery.or(
        `resident_name_snapshot.ilike.%${safeSearch}%,household_label_snapshot.ilike.%${safeSearch}%,registration_notes.ilike.%${safeSearch}%`
      )
    }
  }

  dataQuery = dataQuery
    .order("registered_at", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to)

  const summaryQuery = supabase
    .from("activity_participants")
    .select("rsvp_status")
    .eq("tenant_id", tenantId)
    .eq("activity_id", parsedId.data)

  const [listRes, summaryRes] = await Promise.all([dataQuery, summaryQuery])

  if (listRes.error) {
    throw mapActivityDbError(listRes.error, { operation: "read" })
  }
  if (summaryRes.error) {
    throw mapActivityDbError(summaryRes.error, { operation: "read" })
  }

  const rawRows = (listRes.data ?? []) as unknown as RawActivityParticipantRow[]
  const items = rawRows.map(mapParticipantRow)
  const totalCount = listRes.count ?? rawRows.length
  const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize))

  return {
    items,
    totalCount,
    page: Math.min(safePage, totalPages),
    pageSize: safePageSize,
    totalPages,
    summary: summarizeParticipantStatuses(
      (summaryRes.data ?? []) as Array<{ rsvp_status: ActivityParticipantStatus }>
    ),
  }
}

export async function createActivityWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    input,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    input: CreateActivityInput
  }
): Promise<ActivityDetail> {
  if (!canManageActivities(roles)) {
    throw new ActivityServiceError(
      403,
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang dapat membuat kegiatan warga."
    )
  }

  const parsed = createActivitySchema.safeParse(input)
  if (!parsed.success) {
    throw new ActivityServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data kegiatan warga tidak valid."
    )
  }

  const { data: createdId, error } = await supabase.rpc("create_activity", {
    p_tenant_id: tenantId,
    p_title: parsed.data.title,
    p_location: parsed.data.location,
    p_start_at: parsed.data.startAt,
    p_description: parsed.data.description,
    p_category: parsed.data.category,
    p_end_at: parsed.data.endAt,
    p_allow_self_registration: parsed.data.allowSelfRegistration,
    p_max_participants: parsed.data.maxParticipants,
    p_registration_deadline: parsed.data.registrationDeadline,
  })

  if (error || typeof createdId !== "string") {
    throw mapActivityDbError(error ?? {}, { operation: "create" })
  }

  const detail = await getAdminActivityDetailWithClient(supabase, {
    tenantId,
    roles,
    activityId: createdId,
  })

  if (!detail) {
    throw new ActivityServiceError(
      500,
      "INTERNAL_ERROR",
      "Kegiatan berhasil dibuat namun gagal memuat detail."
    )
  }

  return detail
}

export async function updateActivityWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    input,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    input: UpdateActivityInput
  }
): Promise<ActivityDetail> {
  if (!canManageActivities(roles)) {
    throw new ActivityServiceError(
      403,
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang dapat mengubah informasi kegiatan."
    )
  }

  const parsed = updateActivitySchema.safeParse(input)
  if (!parsed.success) {
    throw new ActivityServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data pembaruan kegiatan tidak valid."
    )
  }

  const { data: existing, error: fetchErr } = await supabase
    .from("activities")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.activityId)
    .is("deleted_at", null)
    .maybeSingle()

  if (fetchErr) {
    throw mapActivityDbError(fetchErr, { operation: "update" })
  }
  if (!existing) {
    throw new ActivityServiceError(
      404,
      "NOT_FOUND",
      "Kegiatan warga tidak ditemukan pada RT ini."
    )
  }

  const { error } = await supabase.rpc("update_activity", {
    p_activity_id: parsed.data.activityId,
    p_title: parsed.data.title,
    p_location: parsed.data.location,
    p_start_at: parsed.data.startAt,
    p_description: parsed.data.description,
    p_category: parsed.data.category,
    p_end_at: parsed.data.endAt,
    p_allow_self_registration: parsed.data.allowSelfRegistration,
    p_max_participants: parsed.data.maxParticipants,
    p_registration_deadline: parsed.data.registrationDeadline,
  })

  if (error) {
    throw mapActivityDbError(error, { operation: "update" })
  }

  const detail = await getAdminActivityDetailWithClient(supabase, {
    tenantId,
    roles,
    activityId: parsed.data.activityId,
  })

  if (!detail) {
    throw new ActivityServiceError(
      404,
      "NOT_FOUND",
      "Kegiatan warga tidak ditemukan pada RT ini."
    )
  }

  return detail
}

export async function transitionActivityStatusWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    input,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    input: TransitionActivityStatusInput
  }
): Promise<ActivityDetail> {
  const parsed = transitionActivityStatusSchema.safeParse(input)
  if (!parsed.success) {
    throw new ActivityServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Parameter perubahan status tidak valid."
    )
  }

  if (!canTransitionActivityStatus(roles, parsed.data.newStatus)) {
    throw new ActivityServiceError(
      403,
      "FORBIDDEN",
      parsed.data.newStatus === "cancelled"
        ? "Hanya Ketua RT atau Sekretaris yang dapat membatalkan kegiatan."
        : "Role Anda tidak memiliki akses mengubah status kegiatan ini."
    )
  }

  const { data: existing, error: fetchErr } = await supabase
    .from("activities")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.activityId)
    .is("deleted_at", null)
    .maybeSingle()

  if (fetchErr) {
    throw mapActivityDbError(fetchErr, { operation: "transition" })
  }
  if (!existing) {
    throw new ActivityServiceError(
      404,
      "NOT_FOUND",
      "Kegiatan warga tidak ditemukan pada RT ini."
    )
  }

  const { error } = await supabase.rpc("transition_activity_status", {
    p_activity_id: parsed.data.activityId,
    p_new_status: parsed.data.newStatus,
    p_reason: parsed.data.reason,
  })

  if (error) {
    throw mapActivityDbError(error, { operation: "transition" })
  }

  const detail = await getAdminActivityDetailWithClient(supabase, {
    tenantId,
    roles,
    activityId: parsed.data.activityId,
  })

  if (!detail) {
    throw new ActivityServiceError(
      404,
      "NOT_FOUND",
      "Kegiatan warga tidak ditemukan pada RT ini."
    )
  }

  return detail
}

export async function softDeleteActivityWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    input,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    input: SoftDeleteActivityInput
  }
): Promise<{ activityId: string; deleted: true }> {
  if (!canManageActivities(roles)) {
    throw new ActivityServiceError(
      403,
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang dapat menghapus kegiatan warga."
    )
  }

  const parsed = softDeleteActivitySchema.safeParse(input)
  if (!parsed.success) {
    throw new ActivityServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Parameter penghapusan tidak valid."
    )
  }

  const { data: existing, error: fetchErr } = await supabase
    .from("activities")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.activityId)
    .maybeSingle()

  if (fetchErr) {
    throw mapActivityDbError(fetchErr, { operation: "soft_delete" })
  }
  if (!existing) {
    throw new ActivityServiceError(
      404,
      "NOT_FOUND",
      "Kegiatan warga tidak ditemukan pada RT ini."
    )
  }

  const { error } = await supabase.rpc("soft_delete_activity", {
    p_activity_id: parsed.data.activityId,
    p_reason: parsed.data.reason,
  })

  if (error) {
    throw mapActivityDbError(error, { operation: "soft_delete" })
  }

  return { activityId: parsed.data.activityId, deleted: true }
}

export async function addActivityParticipantWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    input,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    input: AddActivityParticipantInput
  }
): Promise<ActivityParticipant> {
  if (!canManageActivities(roles)) {
    throw new ActivityServiceError(
      403,
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang dapat menambah peserta kegiatan."
    )
  }

  const parsed = addActivityParticipantSchema.safeParse(input)
  if (!parsed.success) {
    throw new ActivityServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data penambahan peserta tidak valid."
    )
  }

  const { data: existingAct, error: actErr } = await supabase
    .from("activities")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.activityId)
    .is("deleted_at", null)
    .maybeSingle()

  if (actErr) {
    throw mapActivityDbError(actErr, { operation: "add_participant" })
  }
  if (!existingAct) {
    throw new ActivityServiceError(
      404,
      "NOT_FOUND",
      "Kegiatan warga tidak ditemukan pada RT ini."
    )
  }

  const { data: participantId, error } = await supabase.rpc(
    "add_activity_participant",
    {
      p_activity_id: parsed.data.activityId,
      p_resident_id: parsed.data.residentId,
      p_rsvp_status: parsed.data.rsvpStatus,
      p_notes: parsed.data.notes,
    }
  )

  if (error || typeof participantId !== "string") {
    throw mapActivityDbError(error ?? {}, { operation: "add_participant" })
  }

  const { data: rowData, error: fetchErr } = await supabase
    .from("activity_participants")
    .select(ACTIVITY_PARTICIPANT_SELECT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", participantId)
    .maybeSingle()

  if (fetchErr || !rowData) {
    throw mapActivityDbError(fetchErr ?? {}, { operation: "read" })
  }

  return mapParticipantRow(rowData as unknown as RawActivityParticipantRow)
}

export async function removeActivityParticipantWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    input,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    input: RemoveActivityParticipantInput
  }
): Promise<RemoveActivityParticipantResult> {
  if (!canManageActivities(roles)) {
    throw new ActivityServiceError(
      403,
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang dapat menghapus peserta dari daftar aktif."
    )
  }

  const parsed = removeActivityParticipantSchema.safeParse(input)
  if (!parsed.success) {
    throw new ActivityServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ??
        "Parameter penghapusan peserta tidak valid."
    )
  }

  const { data: existing, error: fetchErr } = await supabase
    .from("activity_participants")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("activity_id", parsed.data.activityId)
    .eq("id", parsed.data.participantId)
    .maybeSingle()

  if (fetchErr) {
    throw mapActivityDbError(fetchErr, { operation: "remove_participant" })
  }
  if (!existing) {
    throw new ActivityServiceError(
      404,
      "NOT_FOUND",
      "Data peserta kegiatan tidak ditemukan pada daftar aktif."
    )
  }

  const { error } = await supabase.rpc("remove_activity_participant", {
    p_activity_id: parsed.data.activityId,
    p_participant_id: parsed.data.participantId,
    p_reason: parsed.data.reason,
  })

  if (error) {
    throw mapActivityDbError(error, { operation: "remove_participant" })
  }

  return {
    activityId: parsed.data.activityId,
    participantId: parsed.data.participantId,
    removedFromActiveRoster: true,
    preservesRosterRow: false,
  }
}

export async function recordActivityAttendanceWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    input,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    input: RecordActivityAttendanceInput
  }
): Promise<ActivityParticipant> {
  if (!canOperateActivities(roles)) {
    throw new ActivityServiceError(
      403,
      "FORBIDDEN",
      "Role Anda tidak memiliki akses mencatat presensi kegiatan."
    )
  }

  const parsed = recordActivityAttendanceSchema.safeParse(input)
  if (!parsed.success) {
    throw new ActivityServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data presensi kegiatan tidak valid."
    )
  }

  const { data: existingAct, error: actErr } = await supabase
    .from("activities")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.activityId)
    .is("deleted_at", null)
    .maybeSingle()

  if (actErr) {
    throw mapActivityDbError(actErr, { operation: "attendance" })
  }
  if (!existingAct) {
    throw new ActivityServiceError(
      404,
      "NOT_FOUND",
      "Kegiatan warga tidak ditemukan pada RT ini."
    )
  }

  const { error } = await supabase.rpc("record_activity_attendance", {
    p_activity_id: parsed.data.activityId,
    p_resident_id: parsed.data.residentId,
    p_rsvp_status: parsed.data.rsvpStatus,
  })

  if (error) {
    throw mapActivityDbError(error, { operation: "attendance" })
  }

  const { data: rowData, error: fetchErr } = await supabase
    .from("activity_participants")
    .select(ACTIVITY_PARTICIPANT_SELECT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("activity_id", parsed.data.activityId)
    .eq("resident_id", parsed.data.residentId)
    .maybeSingle()

  if (fetchErr || !rowData) {
    throw mapActivityDbError(fetchErr ?? {}, { operation: "read" })
  }

  return mapParticipantRow(rowData as unknown as RawActivityParticipantRow)
}

export async function uploadActivityDocWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    activityId,
    validatedFile,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    activityId: string
    validatedFile: ValidatedActivityDocFile
  }
): Promise<UploadActivityDocResult> {
  if (!canUploadActivityDoc(roles)) {
    throw new ActivityServiceError(
      403,
      "FORBIDDEN",
      "Role Anda tidak memiliki akses mengunggah dokumentasi kegiatan."
    )
  }

  const parsedId = activityUuidSchema.safeParse(activityId)
  if (!parsedId.success) {
    throw new ActivityServiceError(
      400,
      "VALIDATION_ERROR",
      "ID kegiatan tidak valid."
    )
  }

  const { data: existing, error: fetchErr } = await supabase
    .from("activities")
    .select("id, tenant_id, status, documentation_paths, deleted_at")
    .eq("tenant_id", tenantId)
    .eq("id", parsedId.data)
    .is("deleted_at", null)
    .maybeSingle()

  if (fetchErr) {
    throw mapActivityDbError(fetchErr, { operation: "attach_doc" })
  }
  if (!existing) {
    throw new ActivityServiceError(
      404,
      "NOT_FOUND",
      "Kegiatan warga tidak ditemukan pada RT ini."
    )
  }

  const row = existing as unknown as Pick<
    RawActivityRow,
    "id" | "tenant_id" | "status" | "documentation_paths" | "deleted_at"
  >

  if (row.status === "cancelled") {
    throw new ActivityServiceError(
      400,
      "INVALID_STATE",
      "Tidak dapat mengunggah dokumentasi pada kegiatan yang telah dibatalkan."
    )
  }

  const currentPaths = Array.isArray(row.documentation_paths)
    ? row.documentation_paths.filter((p): p is string => typeof p === "string")
    : []

  if (currentPaths.length >= MAX_ACTIVITY_DOCS) {
    throw new ActivityServiceError(
      400,
      "DOCUMENT_LIMIT_REACHED",
      `Maksimal ${MAX_ACTIVITY_DOCS} berkas dokumentasi yang dapat dilampirkan per kegiatan.`
    )
  }

  const storagePath = buildActivityDocPath(
    tenantId,
    row.id,
    validatedFile.extension
  )

  const { error: uploadErr } = await supabase.storage
    .from(ACTIVITY_DOCS_BUCKET)
    .upload(storagePath, validatedFile.buffer, {
      contentType: validatedFile.mimeType,
      upsert: false,
    })

  if (uploadErr) {
    throw new ActivityServiceError(
      500,
      "STORAGE_ERROR",
      "Gagal mengunggah berkas dokumentasi ke penyimpanan privat."
    )
  }

  const { error: attachErr } = await supabase.rpc("attach_activity_doc", {
    p_activity_id: row.id,
    p_storage_path: storagePath,
  })

  if (attachErr) {
    // Orphan storage cleanup happens asynchronously via storage-orphan-scan
    // without bypassing storage_deletion_queue or exposing internal storage paths.
    const mapped = mapActivityDbError(attachErr, { operation: "attach_doc" })
    throw new ActivityServiceError(
      mapped.status,
      mapped.code,
      mapped.status >= 500
        ? "Berkas terunggah, namun gagal mencatat lampiran dokumentasi. Silakan muat ulang."
        : mapped.message
    )
  }

  const updatedPaths = [...currentPaths, storagePath]
  const docs = mapRawActivityDocuments(updatedPaths, tenantId, row.id)
  const fileId = extractActivityDocFileId(storagePath)
  const createdDoc = docs.find((d) => d.fileId === fileId)

  if (!createdDoc) {
    throw new ActivityServiceError(
      500,
      "INTERNAL_ERROR",
      "Gagal membangun metadata berkas dokumentasi kegiatan."
    )
  }

  return {
    activityId: row.id,
    document: createdDoc,
    documentCount: docs.length,
  }
}

export async function removeActivityDocWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    input,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    input: RemoveActivityDocInput
  }
): Promise<RemoveActivityDocResult> {
  if (!canRemoveActivityDoc(roles)) {
    throw new ActivityServiceError(
      403,
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang dapat menghapus dokumentasi kegiatan."
    )
  }

  const parsed = removeActivityDocSchema.safeParse(input)
  if (!parsed.success) {
    throw new ActivityServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ??
        "Parameter penghapusan dokumentasi tidak valid."
    )
  }

  const { data: existing, error: fetchErr } = await supabase
    .from("activities")
    .select("id, tenant_id, documentation_paths, deleted_at")
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.activityId)
    .is("deleted_at", null)
    .maybeSingle()

  if (fetchErr) {
    throw mapActivityDbError(fetchErr, { operation: "remove_doc" })
  }
  if (!existing) {
    throw new ActivityServiceError(
      404,
      "NOT_FOUND",
      "Kegiatan warga tidak ditemukan pada RT ini."
    )
  }

  const row = existing as unknown as Pick<
    RawActivityRow,
    "id" | "tenant_id" | "documentation_paths" | "deleted_at"
  >
  const paths = Array.isArray(row.documentation_paths)
    ? row.documentation_paths.filter((p): p is string => typeof p === "string")
    : []

  const matchedPath = paths.find(
    (p) =>
      activityDocPathBelongsTo(p, tenantId, row.id) &&
      extractActivityDocFileId(p) === parsed.data.fileId.toLowerCase()
  )

  if (!matchedPath) {
    throw new ActivityServiceError(
      404,
      "DOCUMENT_UNAVAILABLE",
      "Berkas dokumentasi tidak ditemukan pada kegiatan ini."
    )
  }

  const { data: removeData, error: removeErr } = await supabase.rpc(
    "remove_activity_doc",
    {
      p_activity_id: row.id,
      p_storage_path: matchedPath,
      p_reason: parsed.data.reason,
    }
  )

  if (removeErr) {
    throw mapActivityDbError(removeErr, { operation: "remove_doc" })
  }

  const jobRow = Array.isArray(removeData)
    ? (removeData[0] as
        | { job_id?: string; outcome?: string; job_status?: string }
        | undefined)
    : undefined

  return {
    activityId: row.id,
    fileId: parsed.data.fileId.toLowerCase(),
    jobId: jobRow?.job_id ?? "",
    outcome: jobRow?.outcome ?? "queued",
    jobStatus: jobRow?.job_status ?? "pending",
  }
}

export async function listResidentActivitiesWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    residentId,
    filters,
  }: {
    tenantId: string
    residentId: string | null
    filters?: ActivityListFilters
  }
): Promise<ResidentActivityPageResult> {
  const normalized = normalizeListFilters(filters)
  const safePageSize = Math.min(
    Math.max(normalized.pageSize, 1),
    ACTIVITY_MAX_PAGE_SIZE
  )
  const safePage = Math.max(normalized.page, 1)
  const from = (safePage - 1) * safePageSize
  const to = from + safePageSize - 1

  let dataQuery = supabase
    .from("activities")
    .select(ACTIVITY_SELECT_COLUMNS, { count: "exact" })
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)

  if (normalized.status) {
    dataQuery = dataQuery.eq("status", normalized.status)
  }
  if (normalized.category) {
    dataQuery = dataQuery.eq("category", normalized.category)
  }
  if (normalized.upcomingOnly) {
    dataQuery = dataQuery
      .in("status", ["scheduled", "ongoing"])
      .gte("start_at", new Date().toISOString())
  }
  if (normalized.search) {
    const safeSearch = sanitizePostgrestSearch(normalized.search)
    if (safeSearch) {
      dataQuery = dataQuery.or(
        `title.ilike.%${safeSearch}%,location.ilike.%${safeSearch}%,description.ilike.%${safeSearch}%`
      )
    }
  }

  dataQuery = dataQuery
    .order(normalized.sortBy, { ascending: normalized.sort === "asc" })
    .order("id", { ascending: false })
    .range(from, to)

  const summaryQuery = supabase
    .from("activities")
    .select("status")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)

  const [listRes, summaryRes, isEligibleResident] = await Promise.all([
    dataQuery,
    summaryQuery,
    checkResidentEligibilityWithClient(supabase, tenantId, residentId),
  ])

  if (listRes.error) {
    throw mapActivityDbError(listRes.error, { operation: "read" })
  }
  if (summaryRes.error) {
    throw mapActivityDbError(summaryRes.error, { operation: "read" })
  }

  const rawRows = (listRes.data ?? []) as unknown as RawActivityRow[]
  const activityIds = rawRows.map((r) => r.id)
  const countsMap = await fetchRegistrationCountsMap(supabase, activityIds)

  const myRegMap = new Map<string, ResidentActivityRegistrationSummary>()
  if (residentId && activityIds.length > 0) {
    const { data: myRegRows, error: regErr } = await supabase
      .from("activity_participants")
      .select(ACTIVITY_PARTICIPANT_SELECT_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("resident_id", residentId)
      .in("activity_id", activityIds)

    if (regErr) {
      throw mapActivityDbError(regErr, { operation: "read" })
    }

    for (const r of (myRegRows ?? []) as unknown as RawActivityParticipantRow[]) {
      myRegMap.set(r.activity_id, mapParticipantSummaryRow(r))
    }
  }

  const nowMs = Date.now()
  const items: ResidentActivityItem[] = rawRows.map((row) => {
    const base = mapActivityRow(row, countsMap.get(row.id) ?? 0)
    const myRegistration = myRegMap.get(row.id) ?? null
    const eligibility = evaluateResidentRegistrationEligibility({
      activity: base,
      myRegistration,
      isEligibleResident,
      nowMs,
    })

    return {
      ...base,
      myRegistration,
      ...eligibility,
    }
  })

  const totalCount = listRes.count ?? rawRows.length
  const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize))

  return {
    items,
    totalCount,
    page: Math.min(safePage, totalPages),
    pageSize: safePageSize,
    totalPages,
    summary: summarizeActivityStatuses(
      (summaryRes.data ?? []) as Array<{ status: ActivityStatus }>
    ),
  }
}

export async function getResidentActivityDetailWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    residentId,
    activityId,
  }: {
    tenantId: string
    residentId: string | null
    activityId: string
  }
): Promise<ResidentActivityDetail | null> {
  const parsedId = activityUuidSchema.safeParse(activityId)
  if (!parsedId.success) {
    throw new ActivityServiceError(
      400,
      "VALIDATION_ERROR",
      "ID kegiatan tidak valid."
    )
  }

  const { data: rowData, error } = await supabase
    .from("activities")
    .select(ACTIVITY_SELECT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", parsedId.data)
    .is("deleted_at", null)
    .maybeSingle()

  if (error) {
    throw mapActivityDbError(error, { operation: "read" })
  }
  if (!rowData) {
    return null
  }

  const row = rowData as unknown as RawActivityRow
  const [countsMap, isEligibleResident, myRegRes] = await Promise.all([
    fetchRegistrationCountsMap(supabase, [row.id]),
    checkResidentEligibilityWithClient(supabase, tenantId, residentId),
    residentId
      ? supabase
          .from("activity_participants")
          .select(ACTIVITY_PARTICIPANT_SELECT_COLUMNS)
          .eq("tenant_id", tenantId)
          .eq("activity_id", row.id)
          .eq("resident_id", residentId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  if (myRegRes.error) {
    throw mapActivityDbError(myRegRes.error, { operation: "read" })
  }

  const base = mapActivityRow(row, countsMap.get(row.id) ?? 0)
  const myRegistration = myRegRes.data
    ? mapParticipantSummaryRow(
        myRegRes.data as unknown as RawActivityParticipantRow
      )
    : null
  const eligibility = evaluateResidentRegistrationEligibility({
    activity: base,
    myRegistration,
    isEligibleResident,
  })

  return {
    activity: {
      ...base,
      myRegistration,
      ...eligibility,
    },
    myRegistration,
    isEligibleResident,
  }
}

export async function getResidentActivityRegistrationWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    residentId,
    activityId,
  }: {
    tenantId: string
    residentId: string | null
    activityId: string
  }
): Promise<ResidentActivityRegistrationDetail | null> {
  const detail = await getResidentActivityDetailWithClient(supabase, {
    tenantId,
    residentId,
    activityId,
  })

  if (!detail) return null

  const { activity, myRegistration, isEligibleResident } = detail
  return {
    activityId: activity.id,
    activityStatus: activity.status,
    allowSelfRegistration: activity.allowSelfRegistration,
    maxParticipants: activity.maxParticipants,
    registrationDeadline: activity.registrationDeadline,
    activeParticipantCount: activity.activeParticipantCount,
    remainingSlots: activity.remainingSlots,
    isFull: activity.isFull,
    isEligibleResident,
    canRegister: activity.canRegister,
    canCancelRegistration: activity.canCancelRegistration,
    registrationBlockReason: activity.registrationBlockReason,
    myRegistration,
  }
}

export async function listResidentActivityHistoryWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    residentId,
    page = 1,
    pageSize = ACTIVITY_DEFAULT_PAGE_SIZE,
  }: {
    tenantId: string
    residentId: string | null
    page?: number
    pageSize?: number
  }
): Promise<ResidentActivityHistoryPageResult> {
  const safePageSize = Math.min(Math.max(pageSize, 1), ACTIVITY_MAX_PAGE_SIZE)
  const safePage = Math.max(page, 1)

  if (!residentId) {
    return {
      items: [],
      totalCount: 0,
      page: 1,
      pageSize: safePageSize,
      totalPages: 1,
    }
  }

  const from = (safePage - 1) * safePageSize
  const to = from + safePageSize - 1

  const { data: partRows, count, error: partErr } = await supabase
    .from("activity_participants")
    .select(ACTIVITY_PARTICIPANT_SELECT_COLUMNS, { count: "exact" })
    .eq("tenant_id", tenantId)
    .eq("resident_id", residentId)
    .order("registered_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to)

  if (partErr) {
    throw mapActivityDbError(partErr, { operation: "read" })
  }

  const rawParts = (partRows ?? []) as unknown as RawActivityParticipantRow[]
  if (rawParts.length === 0) {
    return {
      items: [],
      totalCount: 0,
      page: 1,
      pageSize: safePageSize,
      totalPages: 1,
    }
  }

  const activityIds = Array.from(new Set(rawParts.map((p) => p.activity_id)))
  const [actRes, countsMap] = await Promise.all([
    supabase
      .from("activities")
      .select(ACTIVITY_SELECT_COLUMNS)
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .in("id", activityIds),
    fetchRegistrationCountsMap(supabase, activityIds),
  ])

  if (actRes.error) {
    throw mapActivityDbError(actRes.error, { operation: "read" })
  }

  const actMap = new Map<string, ActivityItem>()
  for (const row of (actRes.data ?? []) as unknown as RawActivityRow[]) {
    actMap.set(row.id, mapActivityRow(row, countsMap.get(row.id) ?? 0))
  }

  const items: ResidentActivityHistoryItem[] = []
  for (const part of rawParts) {
    const act = actMap.get(part.activity_id)
    if (!act) continue
    items.push({
      participant: mapParticipantSummaryRow(part),
      activity: act,
    })
  }

  const totalCount = count ?? items.length
  const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize))

  return {
    items,
    totalCount,
    page: Math.min(safePage, totalPages),
    pageSize: safePageSize,
    totalPages,
  }
}

export async function registerForActivityWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    residentId,
    input,
  }: {
    tenantId: string
    residentId: string | null
    input: RegisterForActivityInput
  }
): Promise<RegisterActivityResult> {
  const parsed = registerForActivitySchema.safeParse(input)
  if (!parsed.success) {
    throw new ActivityServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data pendaftaran kegiatan tidak valid."
    )
  }

  if (!residentId) {
    throw new ActivityServiceError(
      403,
      "INELIGIBLE_RESIDENT",
      "Akun Anda belum terhubung dengan data warga aktif di RT ini."
    )
  }

  const { data: existingAct, error: actErr } = await supabase
    .from("activities")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.activityId)
    .is("deleted_at", null)
    .maybeSingle()

  if (actErr) {
    throw mapActivityDbError(actErr, { operation: "register" })
  }
  if (!existingAct) {
    throw new ActivityServiceError(
      404,
      "NOT_FOUND",
      "Kegiatan warga tidak ditemukan pada RT ini."
    )
  }

  const { data, error } = await supabase.rpc("register_for_activity", {
    p_activity_id: parsed.data.activityId,
    p_notes: parsed.data.notes,
  })

  if (error) {
    throw mapActivityDbError(error, { operation: "register" })
  }

  const row = Array.isArray(data)
    ? (data[0] as
        | {
            participant_id?: string
            activity_id?: string
            rsvp_status?: string
            registered_at?: string
          }
        | undefined)
    : undefined

  if (!row?.participant_id) {
    throw new ActivityServiceError(
      500,
      "INTERNAL_ERROR",
      "Pendaftaran berhasil namun gagal membaca ringkasan peserta."
    )
  }

  return {
    participantId: row.participant_id,
    activityId: row.activity_id ?? parsed.data.activityId,
    rsvpStatus: "attending",
    registeredAt: row.registered_at ?? new Date().toISOString(),
  }
}

export async function cancelActivityRegistrationWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    residentId,
    input,
  }: {
    tenantId: string
    residentId: string | null
    input: CancelActivityRegistrationInput
  }
): Promise<CancelActivityRegistrationResult> {
  const parsed = cancelActivityRegistrationSchema.safeParse(input)
  if (!parsed.success) {
    throw new ActivityServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ??
        "Parameter pembatalan pendaftaran tidak valid."
    )
  }

  if (!residentId) {
    throw new ActivityServiceError(
      403,
      "INELIGIBLE_RESIDENT",
      "Akun Anda belum terhubung dengan data warga pada RT ini."
    )
  }

  const { data: existingAct, error: actErr } = await supabase
    .from("activities")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.activityId)
    .is("deleted_at", null)
    .maybeSingle()

  if (actErr) {
    throw mapActivityDbError(actErr, { operation: "cancel_registration" })
  }
  if (!existingAct) {
    throw new ActivityServiceError(
      404,
      "NOT_FOUND",
      "Kegiatan warga tidak ditemukan pada RT ini."
    )
  }

  const { data, error } = await supabase.rpc("cancel_activity_registration", {
    p_activity_id: parsed.data.activityId,
    p_reason: parsed.data.reason,
  })

  if (error) {
    throw mapActivityDbError(error, { operation: "cancel_registration" })
  }

  const row = Array.isArray(data)
    ? (data[0] as
        | {
            participant_id?: string
            activity_id?: string
            rsvp_status?: string
            cancelled_at?: string
          }
        | undefined)
    : undefined

  if (!row?.participant_id) {
    throw new ActivityServiceError(
      500,
      "INTERNAL_ERROR",
      "Pembatalan berhasil namun gagal membaca status pendaftaran."
    )
  }

  return {
    participantId: row.participant_id,
    activityId: row.activity_id ?? parsed.data.activityId,
    rsvpStatus: "cancelled",
    cancelledAt: row.cancelled_at ?? new Date().toISOString(),
  }
}
