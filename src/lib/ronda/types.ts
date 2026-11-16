import type { RoleCode } from "@/lib/auth/types"

export const RONDA_ATTENDANCE_STATUSES = [
  "present",
  "absent",
  "excused",
] as const

export type RondaAttendanceStatusCode =
  (typeof RONDA_ATTENDANCE_STATUSES)[number]

export type RondaAttendanceStatus = RondaAttendanceStatusCode | null

export type RondaScope = "admin" | "resident"

export const RONDA_MANAGEMENT_ROLES: readonly RoleCode[] = [
  "ketua_rt",
  "sekretaris",
]

export function canManageRonda(roles: readonly RoleCode[]): boolean {
  return roles.some((role) => RONDA_MANAGEMENT_ROLES.includes(role))
}

export function canReadAllRondaAttendance(roles: readonly RoleCode[]): boolean {
  return canManageRonda(roles)
}

export const RONDA_ATTENDANCE_STATUS_LABELS: Record<
  RondaAttendanceStatusCode | "unrecorded",
  string
> = {
  present: "Hadir",
  absent: "Tidak Hadir",
  excused: "Izin",
  unrecorded: "Belum Dicatat",
}

export function getRondaAttendanceBadgeVariant(
  status: RondaAttendanceStatus
): "success" | "warning" | "destructive" | "outline" {
  switch (status) {
    case "present":
      return "success"
    case "excused":
      return "warning"
    case "absent":
      return "destructive"
    default:
      return "outline"
  }
}

export interface RondaSchedule {
  id: string
  tenantId: string
  scheduleDate: string
  shiftLabel: string
  startTime: string
  endTime: string
  meetingPoint: string | null
  notes: string | null
  createdBy: string | null
  updatedBy: string | null
  createdAt: string
  updatedAt: string
}

export interface RondaAssignment {
  id: string
  tenantId: string
  scheduleId: string
  residentId: string | null
  residentNameSnapshot: string
  householdLabelSnapshot: string
  createdAt: string
  updatedAt: string
  attendanceStatus?: RondaAttendanceStatus
  attendanceNotes?: string | null
  attendanceRecordedBy?: string | null
  attendanceRecordedAt?: string | null
}

export interface RondaScheduleListItem extends RondaSchedule {
  assignedCount: number
  officers: RondaAssignment[]
  myAttendance?: RondaMyAttendanceRecord | null
}

export interface RondaScheduleWithRoster {
  schedule: RondaSchedule
  roster: RondaAssignment[]
  canManage: boolean
  canReadAllAttendance: boolean
  myAttendance: RondaMyAttendanceRecord | null
}

export interface RondaScheduleInput {
  scheduleId?: string | null
  scheduleDate: string
  shiftLabel?: string
  startTime?: string
  endTime?: string
  meetingPoint?: string | null
  notes?: string | null
  residentIds: string[]
}

export interface RondaAttendanceInput {
  assignmentId: string
  attendanceStatus: RondaAttendanceStatus
  attendanceNotes?: string | null
}

export interface RondaScheduleFilters {
  fromDate?: string
  toDate?: string
  page?: number
  pageSize?: number
  sort?: "asc" | "desc"
}

export interface RondaAttendanceFilterParams {
  scheduleId?: string
  fromDate?: string
  toDate?: string
}

export interface RondaSchedulePageResult {
  items: RondaScheduleListItem[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  canManage: boolean
  canReadAllAttendance: boolean
}

export interface RondaAttendanceAdminRecord {
  assignmentId: string
  scheduleId: string
  scheduleDate: string
  residentId: string | null
  residentNameSnapshot: string
  householdLabelSnapshot: string
  attendanceStatus: RondaAttendanceStatus
  attendanceNotes: string | null
  attendanceRecordedBy: string | null
  attendanceRecordedAt: string | null
}

export interface RondaMyAttendanceRecord {
  assignmentId: string
  scheduleId: string
  scheduleDate: string
  shiftLabel: string
  attendanceStatus: RondaAttendanceStatus
  attendanceNotes: string | null
  attendanceRecordedAt: string | null
}

export interface RondaResidentCandidate {
  id: string
  fullName: string
  householdId: string
  householdLabel: string
}

export type RondaActionErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_ERROR"

export interface RondaActionResult<T = unknown> {
  ok: boolean
  data: T | null
  error: string | null
  code?: RondaActionErrorCode
  fieldErrors?: Record<string, string[] | undefined>
}

export interface UpsertRondaScheduleResult {
  id: string
  tenantId: string
  scheduleDate: string
  shiftLabel: string
  startTime: string
  endTime: string
  meetingPoint: string | null
  notes: string | null
  assignedCount: number
}

export interface DeleteRondaScheduleResult {
  id: string
  tenantId: string
  deleted: boolean
}

export interface RecordRondaAttendanceResult {
  assignmentId: string
  tenantId: string
  scheduleId: string
  attendanceStatus: RondaAttendanceStatus
  attendanceNotes: string | null
  attendanceRecordedBy: string | null
  attendanceRecordedAt: string | null
}

