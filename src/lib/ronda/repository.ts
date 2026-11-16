import type { SupabaseClient } from "@supabase/supabase-js"

import type { RoleCode } from "@/lib/auth/types"
import {
  canManageRonda,
  canReadAllRondaAttendance,
  type DeleteRondaScheduleResult,
  type RecordRondaAttendanceResult,
  type RondaActionErrorCode,
  type RondaAssignment,
  type RondaAttendanceAdminRecord,
  type RondaAttendanceStatus,
  type RondaMyAttendanceRecord,
  type RondaResidentCandidate,
  type RondaSchedule,
  type RondaScheduleFilters,
  type RondaScheduleListItem,
  type RondaSchedulePageResult,
  type RondaScheduleWithRoster,
  type UpsertRondaScheduleResult,
} from "@/lib/ronda/types"

export const RONDA_SCHEDULE_SELECT_COLUMNS =
  "id, tenant_id, schedule_date, shift_label, start_time, end_time, meeting_point, notes, created_by, updated_by, created_at, updated_at" as const

/**
 * Explicitly restricts direct table SELECTs to non-attendance roster columns.
 * Never use `*` or select attendance_* on public.ronda_assignments.
 */
export const RONDA_ASSIGNMENT_ROSTER_COLUMNS =
  "id, tenant_id, schedule_id, resident_id, resident_name_snapshot, household_label_snapshot, created_at, updated_at" as const

interface RawRondaScheduleRow {
  id: string
  tenant_id: string
  schedule_date: string
  shift_label: string
  start_time: string
  end_time: string
  meeting_point: string | null
  notes: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

interface RawRondaAssignmentRosterRow {
  id: string
  tenant_id: string
  schedule_id: string
  resident_id: string | null
  resident_name_snapshot: string
  household_label_snapshot: string
  created_at: string
  updated_at: string
}

interface RawAdminAttendanceRpcRow {
  assignment_id: string
  schedule_id: string
  schedule_date: string
  resident_id: string | null
  resident_name_snapshot: string
  household_label_snapshot: string
  attendance_status: RondaAttendanceStatus
  attendance_notes: string | null
  attendance_recorded_by: string | null
  attendance_recorded_at: string | null
}

interface RawMyAttendanceRpcRow {
  assignment_id: string
  schedule_id: string
  schedule_date: string
  shift_label: string
  attendance_status: RondaAttendanceStatus
  attendance_notes: string | null
  attendance_recorded_at: string | null
}

interface RawUpsertRpcJson {
  id: string
  tenant_id: string
  schedule_date: string
  shift_label: string
  start_time: string
  end_time: string
  meeting_point: string | null
  notes: string | null
  assigned_count: number
}

interface RawDeleteRpcJson {
  id: string
  tenant_id: string
  deleted: boolean
}

interface RawRecordAttendanceRpcJson {
  assignment_id: string
  tenant_id: string
  schedule_id: string
  attendance_status: RondaAttendanceStatus
  attendance_notes: string | null
  attendance_recorded_by: string | null
  attendance_recorded_at: string | null
}

export class RondaServiceError extends Error {
  readonly status: number
  readonly code: RondaActionErrorCode

  constructor(status: number, code: RondaActionErrorCode, message: string) {
    super(message)
    this.name = "RondaServiceError"
    this.status = status
    this.code = code
  }
}

export function mapRondaRpcError(error: {
  code?: string | null
  message?: string | null
}): RondaServiceError {
  const code = error.code ?? ""
  const lower = (error.message ?? "").toLowerCase()

  if (code === "42501" || lower.includes("forbidden")) {
    return new RondaServiceError(
      403,
      "FORBIDDEN",
      "Anda tidak memiliki izin untuk mengakses atau mengelola data ronda ini."
    )
  }

  if (lower.includes("unauthenticated")) {
    return new RondaServiceError(
      401,
      "UNAUTHORIZED",
      "Sesi login Anda telah berakhir. Silakan masuk kembali."
    )
  }

  if (code === "23503" || lower.includes("sebagian warga tidak ditemukan")) {
    return new RondaServiceError(
      400,
      "VALIDATION_ERROR",
      "Sebagian warga yang dipilih tidak ditemukan, sudah tidak aktif, atau berasal dari RT lain."
    )
  }

  if (code === "P0002" || lower.includes("tidak ditemukan")) {
    return new RondaServiceError(
      404,
      "NOT_FOUND",
      "Jadwal atau penugasan ronda tidak ditemukan pada RT aktif."
    )
  }

  if (code === "23505") {
    if (
      lower.includes("uq_ronda_schedules_tenant_date") ||
      lower.includes("schedule_date")
    ) {
      return new RondaServiceError(
        409,
        "CONFLICT",
        "Jadwal ronda untuk tanggal tersebut sudah tersedia pada RT ini."
      )
    }
    if (
      lower.includes("uq_ronda_assignments_schedule_resident") ||
      lower.includes("duplikasi warga")
    ) {
      return new RondaServiceError(
        409,
        "CONFLICT",
        "Terdapat warga yang ditugaskan lebih dari satu kali pada jadwal yang sama."
      )
    }
    return new RondaServiceError(
      409,
      "CONFLICT",
      "Data jadwal ronda bentrok dengan catatan yang sudah ada."
    )
  }

  if (code === "22023" || code === "23514") {
    if (lower.includes("jam mulai dan selesai")) {
      return new RondaServiceError(
        400,
        "VALIDATION_ERROR",
        "Jam mulai dan jam selesai ronda tidak boleh sama."
      )
    }
    if (lower.includes("minimal satu warga")) {
      return new RondaServiceError(
        400,
        "VALIDATION_ERROR",
        "Minimal satu warga aktif harus ditugaskan pada jadwal ronda."
      )
    }
    if (lower.includes("catatan kehadiran tidak boleh diisi")) {
      return new RondaServiceError(
        400,
        "VALIDATION_ERROR",
        "Catatan kehadiran tidak boleh diisi ketika status kehadiran dikosongkan."
      )
    }
    return new RondaServiceError(
      400,
      "VALIDATION_ERROR",
      "Data jadwal atau kehadiran ronda tidak memenuhi ketentuan."
    )
  }

  return new RondaServiceError(
    500,
    "INTERNAL_ERROR",
    "Gagal memproses permintaan data ronda. Silakan coba lagi."
  )
}

function mapScheduleRow(row: RawRondaScheduleRow): RondaSchedule {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    scheduleDate: row.schedule_date,
    shiftLabel: row.shift_label,
    startTime: row.start_time,
    endTime: row.end_time,
    meetingPoint: row.meeting_point,
    notes: row.notes,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapRosterRow(row: RawRondaAssignmentRosterRow): RondaAssignment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    scheduleId: row.schedule_id,
    residentId: row.resident_id,
    residentNameSnapshot: row.resident_name_snapshot,
    householdLabelSnapshot: row.household_label_snapshot,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapAdminAttendanceRow(
  row: RawAdminAttendanceRpcRow
): RondaAttendanceAdminRecord {
  return {
    assignmentId: row.assignment_id,
    scheduleId: row.schedule_id,
    scheduleDate: row.schedule_date,
    residentId: row.resident_id,
    residentNameSnapshot: row.resident_name_snapshot,
    householdLabelSnapshot: row.household_label_snapshot,
    attendanceStatus: row.attendance_status,
    attendanceNotes: row.attendance_notes,
    attendanceRecordedBy: row.attendance_recorded_by,
    attendanceRecordedAt: row.attendance_recorded_at,
  }
}

function mapMyAttendanceRow(row: RawMyAttendanceRpcRow): RondaMyAttendanceRecord {
  return {
    assignmentId: row.assignment_id,
    scheduleId: row.schedule_id,
    scheduleDate: row.schedule_date,
    shiftLabel: row.shift_label,
    attendanceStatus: row.attendance_status,
    attendanceNotes: row.attendance_notes,
    attendanceRecordedAt: row.attendance_recorded_at,
  }
}

function sanitizeSearchTerm(input: string | undefined): string {
  if (!input) return ""
  return input
    .trim()
    .replace(/[,()%*\\]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80)
}

async function fetchSchedulesAndRosterPage(
  supabase: SupabaseClient,
  {
    tenantId,
    filters,
    canManage,
    canReadAllAttendance,
    includeMyAttendance,
  }: {
    tenantId: string
    filters?: RondaScheduleFilters
    canManage: boolean
    canReadAllAttendance: boolean
    includeMyAttendance: boolean
  }
): Promise<RondaSchedulePageResult> {
  const safePageSize = Math.min(Math.max(filters?.pageSize ?? 20, 1), 50)
  const requestedPage = Math.max(filters?.page ?? 1, 1)
  const ascending = filters?.sort === "asc"

  let countQuery = supabase
    .from("ronda_schedules")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)

  if (filters?.fromDate) {
    countQuery = countQuery.gte("schedule_date", filters.fromDate)
  }
  if (filters?.toDate) {
    countQuery = countQuery.lte("schedule_date", filters.toDate)
  }

  const { count, error: countError } = await countQuery
  if (countError) {
    throw mapRondaRpcError(countError)
  }

  const totalCount = count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize))
  const safePage = Math.min(requestedPage, totalPages)
  const offset = (safePage - 1) * safePageSize

  let listQuery = supabase
    .from("ronda_schedules")
    .select(RONDA_SCHEDULE_SELECT_COLUMNS)
    .eq("tenant_id", tenantId)

  if (filters?.fromDate) {
    listQuery = listQuery.gte("schedule_date", filters.fromDate)
  }
  if (filters?.toDate) {
    listQuery = listQuery.lte("schedule_date", filters.toDate)
  }

  const { data: scheduleRows, error: listError } = await listQuery
    .order("schedule_date", { ascending })
    .range(offset, offset + safePageSize - 1)

  if (listError) {
    throw mapRondaRpcError(listError)
  }

  const schedules = ((scheduleRows ?? []) as RawRondaScheduleRow[]).map(
    mapScheduleRow
  )
  const scheduleIds = schedules.map((item) => item.id)

  const officersBySchedule = new Map<string, RondaAssignment[]>()
  if (scheduleIds.length > 0) {
    const { data: assignmentRows, error: assignError } = await supabase
      .from("ronda_assignments")
      .select(RONDA_ASSIGNMENT_ROSTER_COLUMNS)
      .eq("tenant_id", tenantId)
      .in("schedule_id", scheduleIds)
      .order("resident_name_snapshot", { ascending: true })
      .order("created_at", { ascending: true })

    if (assignError) {
      throw mapRondaRpcError(assignError)
    }

    for (const row of (assignmentRows ?? []) as RawRondaAssignmentRosterRow[]) {
      const mapped = mapRosterRow(row)
      const list = officersBySchedule.get(mapped.scheduleId) ?? []
      list.push(mapped)
      officersBySchedule.set(mapped.scheduleId, list)
    }
  }

  const myAttendanceBySchedule = new Map<string, RondaMyAttendanceRecord>()
  if (includeMyAttendance && scheduleIds.length > 0) {
    const { data: myRows, error: myError } = await supabase.rpc(
      "get_my_ronda_attendance",
      {
        p_tenant_id: tenantId,
        p_schedule_id: null,
      }
    )

    if (myError) {
      throw mapRondaRpcError(myError)
    }

    for (const row of (myRows ?? []) as RawMyAttendanceRpcRow[]) {
      myAttendanceBySchedule.set(row.schedule_id, mapMyAttendanceRow(row))
    }
  }

  const items: RondaScheduleListItem[] = schedules.map((schedule) => {
    const officers = officersBySchedule.get(schedule.id) ?? []
    return {
      ...schedule,
      assignedCount: officers.length,
      officers,
      ...(includeMyAttendance
        ? { myAttendance: myAttendanceBySchedule.get(schedule.id) ?? null }
        : {}),
    }
  })

  return {
    items,
    totalCount,
    page: safePage,
    pageSize: safePageSize,
    totalPages,
    canManage,
    canReadAllAttendance,
  }
}

export async function listAdminRondaSchedulesWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    filters,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    filters?: RondaScheduleFilters
  }
): Promise<RondaSchedulePageResult> {
  return fetchSchedulesAndRosterPage(supabase, {
    tenantId,
    filters,
    canManage: canManageRonda(roles),
    canReadAllAttendance: canReadAllRondaAttendance(roles),
    includeMyAttendance: false,
  })
}

export async function getAdminRondaScheduleDetailWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    scheduleId,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    scheduleId: string
  }
): Promise<RondaScheduleWithRoster | null> {
  const { data: scheduleRow, error: scheduleError } = await supabase
    .from("ronda_schedules")
    .select(RONDA_SCHEDULE_SELECT_COLUMNS)
    .eq("id", scheduleId)
    .eq("tenant_id", tenantId)
    .maybeSingle()

  if (scheduleError) {
    throw mapRondaRpcError(scheduleError)
  }
  if (!scheduleRow) {
    return null
  }

  const schedule = mapScheduleRow(scheduleRow as RawRondaScheduleRow)
  const allowAllAttendance = canReadAllRondaAttendance(roles)
  const allowManage = canManageRonda(roles)

  if (allowAllAttendance) {
    const { data: rpcRows, error: rpcError } = await supabase.rpc(
      "get_ronda_schedule_attendance",
      { p_schedule_id: scheduleId }
    )
    if (rpcError) {
      throw mapRondaRpcError(rpcError)
    }

    const roster: RondaAssignment[] = (
      (rpcRows ?? []) as RawAdminAttendanceRpcRow[]
    ).map((row) => ({
      id: row.assignment_id,
      tenantId: schedule.tenantId,
      scheduleId: row.schedule_id,
      residentId: row.resident_id,
      residentNameSnapshot: row.resident_name_snapshot,
      householdLabelSnapshot: row.household_label_snapshot,
      createdAt: schedule.createdAt,
      updatedAt: schedule.updatedAt,
      attendanceStatus: row.attendance_status,
      attendanceNotes: row.attendance_notes,
      attendanceRecordedBy: row.attendance_recorded_by,
      attendanceRecordedAt: row.attendance_recorded_at,
    }))

    return {
      schedule,
      roster,
      canManage: allowManage,
      canReadAllAttendance: true,
      myAttendance: null,
    }
  }

  // Bendahara & pengurus only see roster columns without attendance fields.
  const { data: rosterRows, error: rosterError } = await supabase
    .from("ronda_assignments")
    .select(RONDA_ASSIGNMENT_ROSTER_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("schedule_id", scheduleId)
    .order("resident_name_snapshot", { ascending: true })
    .order("created_at", { ascending: true })

  if (rosterError) {
    throw mapRondaRpcError(rosterError)
  }

  return {
    schedule,
    roster: ((rosterRows ?? []) as RawRondaAssignmentRosterRow[]).map(
      mapRosterRow
    ),
    canManage: allowManage,
    canReadAllAttendance: false,
    myAttendance: null,
  }
}

export async function listAdminRondaAttendanceWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    scheduleId,
    fromDate,
    toDate,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    scheduleId?: string
    fromDate?: string
    toDate?: string
  }
): Promise<RondaAttendanceAdminRecord[]> {
  if (!canReadAllRondaAttendance(roles)) {
    throw new RondaServiceError(
      403,
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang berhak mengakses rekap kehadiran ronda."
    )
  }

  if (scheduleId) {
    const { data: ownSchedule, error: checkError } = await supabase
      .from("ronda_schedules")
      .select("id")
      .eq("id", scheduleId)
      .eq("tenant_id", tenantId)
      .maybeSingle()

    if (checkError) {
      throw mapRondaRpcError(checkError)
    }
    if (!ownSchedule) {
      throw new RondaServiceError(
        404,
        "NOT_FOUND",
        "Jadwal ronda tidak ditemukan pada RT aktif."
      )
    }

    const { data, error } = await supabase.rpc("get_ronda_schedule_attendance", {
      p_schedule_id: scheduleId,
    })
    if (error) {
      throw mapRondaRpcError(error)
    }
    return ((data ?? []) as RawAdminAttendanceRpcRow[]).map(
      mapAdminAttendanceRow
    )
  }

  const { data, error } = await supabase.rpc("list_ronda_attendance_admin", {
    p_tenant_id: tenantId,
    p_from_date: fromDate ?? null,
    p_to_date: toDate ?? null,
  })
  if (error) {
    throw mapRondaRpcError(error)
  }

  return ((data ?? []) as RawAdminAttendanceRpcRow[]).map(
    mapAdminAttendanceRow
  )
}

export async function listEligibleRondaResidentsWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    search,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    search?: string
  }
): Promise<RondaResidentCandidate[]> {
  if (!canManageRonda(roles)) {
    throw new RondaServiceError(
      403,
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang berhak memuat daftar kandidat petugas ronda."
    )
  }

  const cleanSearch = sanitizeSearchTerm(search)

  let residentQuery = supabase
    .from("residents")
    .select("id, full_name, household_id")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .eq("residency_status", "aktif")
    .order("full_name", { ascending: true })
    .limit(500)

  if (cleanSearch) {
    residentQuery = residentQuery.ilike("full_name", `%${cleanSearch}%`)
  }

  const [{ data: householdRows, error: hhError }, { data: residentRows, error: resError }] =
    await Promise.all([
      supabase
        .from("households")
        .select("id, block_unit, address")
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .is("deleted_at", null),
      residentQuery,
    ])

  if (hhError) {
    throw mapRondaRpcError(hhError)
  }
  if (resError) {
    throw mapRondaRpcError(resError)
  }

  const householdLabelMap = new Map<string, string>()
  for (const row of (householdRows ?? []) as Array<{
    id: string
    block_unit: string | null
    address: string
  }>) {
    const label =
      row.block_unit?.trim() || row.address?.trim() || "Warga RT"
    householdLabelMap.set(row.id, label)
  }

  const candidates: RondaResidentCandidate[] = []
  for (const row of (residentRows ?? []) as Array<{
    id: string
    full_name: string
    household_id: string
  }>) {
    const householdLabel = householdLabelMap.get(row.household_id)
    if (!householdLabel) continue
    candidates.push({
      id: row.id,
      fullName: row.full_name,
      householdId: row.household_id,
      householdLabel,
    })
  }

  return candidates
}

export async function listResidentRondaSchedulesWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    filters,
  }: {
    tenantId: string
    filters?: RondaScheduleFilters
  }
): Promise<RondaSchedulePageResult> {
  return fetchSchedulesAndRosterPage(supabase, {
    tenantId,
    filters,
    canManage: false,
    canReadAllAttendance: false,
    includeMyAttendance: true,
  })
}

export async function getResidentRondaScheduleDetailWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    scheduleId,
  }: {
    tenantId: string
    scheduleId: string
  }
): Promise<RondaScheduleWithRoster | null> {
  const { data: scheduleRow, error: scheduleError } = await supabase
    .from("ronda_schedules")
    .select(RONDA_SCHEDULE_SELECT_COLUMNS)
    .eq("id", scheduleId)
    .eq("tenant_id", tenantId)
    .maybeSingle()

  if (scheduleError) {
    throw mapRondaRpcError(scheduleError)
  }
  if (!scheduleRow) {
    return null
  }

  const [{ data: rosterRows, error: rosterError }, { data: myRows, error: myError }] =
    await Promise.all([
      supabase
        .from("ronda_assignments")
        .select(RONDA_ASSIGNMENT_ROSTER_COLUMNS)
        .eq("tenant_id", tenantId)
        .eq("schedule_id", scheduleId)
        .order("resident_name_snapshot", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase.rpc("get_my_ronda_attendance", {
        p_tenant_id: tenantId,
        p_schedule_id: scheduleId,
      }),
    ])

  if (rosterError) {
    throw mapRondaRpcError(rosterError)
  }
  if (myError) {
    throw mapRondaRpcError(myError)
  }

  const myAttendanceRow = ((myRows ?? []) as RawMyAttendanceRpcRow[])[0] ?? null
  const myAttendance = myAttendanceRow
    ? mapMyAttendanceRow(myAttendanceRow)
    : null

  const roster: RondaAssignment[] = (
    (rosterRows ?? []) as RawRondaAssignmentRosterRow[]
  ).map((row) => {
    const item = mapRosterRow(row)
    if (myAttendance && item.id === myAttendance.assignmentId) {
      item.attendanceStatus = myAttendance.attendanceStatus
      item.attendanceNotes = myAttendance.attendanceNotes
      item.attendanceRecordedAt = myAttendance.attendanceRecordedAt
    }
    return item
  })

  return {
    schedule: mapScheduleRow(scheduleRow as RawRondaScheduleRow),
    roster,
    canManage: false,
    canReadAllAttendance: false,
    myAttendance,
  }
}

export async function getMyRondaAttendanceWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    scheduleId,
  }: {
    tenantId: string
    scheduleId?: string
  }
): Promise<RondaMyAttendanceRecord[]> {
  const { data, error } = await supabase.rpc("get_my_ronda_attendance", {
    p_tenant_id: tenantId,
    p_schedule_id: scheduleId ?? null,
  })
  if (error) {
    throw mapRondaRpcError(error)
  }
  return ((data ?? []) as RawMyAttendanceRpcRow[]).map(mapMyAttendanceRow)
}

export async function upsertRondaScheduleWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    input,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    input: {
      scheduleId: string | null
      scheduleDate: string
      shiftLabel: string
      startTime: string
      endTime: string
      meetingPoint: string | null
      notes: string | null
      residentIds: string[]
    }
  }
): Promise<UpsertRondaScheduleResult> {
  if (!canManageRonda(roles)) {
    throw new RondaServiceError(
      403,
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang berwenang membuat atau mengubah jadwal ronda."
    )
  }

  const { data, error } = await supabase.rpc(
    "upsert_ronda_schedule_with_roster",
    {
      p_tenant_id: tenantId,
      p_schedule_date: input.scheduleDate,
      p_resident_ids: input.residentIds,
      p_schedule_id: input.scheduleId,
      p_shift_label: input.shiftLabel,
      p_start_time: input.startTime,
      p_end_time: input.endTime,
      p_meeting_point: input.meetingPoint,
      p_notes: input.notes,
    }
  )

  if (error || !data) {
    throw mapRondaRpcError(error ?? {})
  }

  const row = data as RawUpsertRpcJson
  return {
    id: row.id,
    tenantId: row.tenant_id,
    scheduleDate: row.schedule_date,
    shiftLabel: row.shift_label,
    startTime: row.start_time,
    endTime: row.end_time,
    meetingPoint: row.meeting_point,
    notes: row.notes,
    assignedCount: row.assigned_count,
  }
}

export async function deleteRondaScheduleWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    scheduleId,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    scheduleId: string
  }
): Promise<DeleteRondaScheduleResult> {
  if (!canManageRonda(roles)) {
    throw new RondaServiceError(
      403,
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang berwenang menghapus jadwal ronda."
    )
  }

  // Verify the schedule belongs to the caller's resolved active tenant before RPC
  const { data: ownSchedule, error: checkError } = await supabase
    .from("ronda_schedules")
    .select("id")
    .eq("id", scheduleId)
    .eq("tenant_id", tenantId)
    .maybeSingle()

  if (checkError) {
    throw mapRondaRpcError(checkError)
  }
  if (!ownSchedule) {
    throw new RondaServiceError(
      404,
      "NOT_FOUND",
      "Jadwal ronda tidak ditemukan pada RT aktif."
    )
  }

  const { data, error } = await supabase.rpc("delete_ronda_schedule", {
    p_schedule_id: scheduleId,
  })
  if (error || !data) {
    throw mapRondaRpcError(error ?? {})
  }

  const row = data as RawDeleteRpcJson
  return {
    id: row.id,
    tenantId: row.tenant_id,
    deleted: row.deleted === true,
  }
}

export async function recordRondaAttendanceWithClient(
  supabase: SupabaseClient,
  {
    tenantId,
    roles,
    assignmentId,
    attendanceStatus,
    attendanceNotes,
  }: {
    tenantId: string
    roles: readonly RoleCode[]
    assignmentId: string
    attendanceStatus: RondaAttendanceStatus
    attendanceNotes: string | null
  }
): Promise<RecordRondaAttendanceResult> {
  if (!canManageRonda(roles)) {
    throw new RondaServiceError(
      403,
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang berwenang mencatat kehadiran ronda."
    )
  }

  // Verify assignment belongs to caller's active workspace tenant before RPC
  const { data: ownAssignment, error: checkError } = await supabase
    .from("ronda_assignments")
    .select("id")
    .eq("id", assignmentId)
    .eq("tenant_id", tenantId)
    .maybeSingle()

  if (checkError) {
    throw mapRondaRpcError(checkError)
  }
  if (!ownAssignment) {
    throw new RondaServiceError(
      404,
      "NOT_FOUND",
      "Penugasan petugas ronda tidak ditemukan pada RT aktif."
    )
  }

  const { data, error } = await supabase.rpc("record_ronda_attendance", {
    p_assignment_id: assignmentId,
    p_attendance_status: attendanceStatus,
    p_attendance_notes: attendanceNotes,
  })
  if (error || !data) {
    throw mapRondaRpcError(error ?? {})
  }

  const row = data as RawRecordAttendanceRpcJson
  return {
    assignmentId: row.assignment_id,
    tenantId: row.tenant_id,
    scheduleId: row.schedule_id,
    attendanceStatus: row.attendance_status,
    attendanceNotes: row.attendance_notes,
    attendanceRecordedBy: row.attendance_recorded_by,
    attendanceRecordedAt: row.attendance_recorded_at,
  }
}
