import type { RoleCode } from "@/lib/auth/types"
import {
  ACTIVITY_ADMIN_READ_ROLES,
  ACTIVITY_CATEGORIES,
  ACTIVITY_MANAGEMENT_ROLES,
  ACTIVITY_MANUAL_PARTICIPANT_STATUSES,
  ACTIVITY_OPERATIONAL_ROLES,
  ACTIVITY_PARTICIPANT_STATUSES,
  ACTIVITY_SORT_DIRECTIONS,
  ACTIVITY_SORT_FIELDS,
  ACTIVITY_STATUSES,
} from "@/lib/activities/constants"

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number]
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number]
export type ActivityParticipantStatus =
  (typeof ACTIVITY_PARTICIPANT_STATUSES)[number]
export type ActivityManualParticipantStatus =
  (typeof ACTIVITY_MANUAL_PARTICIPANT_STATUSES)[number]
export type ActivityScope = "admin" | "resident"
export type ActivitySortField = (typeof ACTIVITY_SORT_FIELDS)[number]
export type ActivitySortDirection = (typeof ACTIVITY_SORT_DIRECTIONS)[number]

export function canReadActivitiesAdmin(roles: readonly RoleCode[]): boolean {
  return roles.some((role) => ACTIVITY_ADMIN_READ_ROLES.includes(role))
}

export function canManageActivities(roles: readonly RoleCode[]): boolean {
  return roles.some((role) => ACTIVITY_MANAGEMENT_ROLES.includes(role))
}

export function canOperateActivities(roles: readonly RoleCode[]): boolean {
  return roles.some((role) => ACTIVITY_OPERATIONAL_ROLES.includes(role))
}

export function canTransitionActivityStatus(
  roles: readonly RoleCode[],
  targetStatus: Exclude<ActivityStatus, "scheduled">
): boolean {
  if (targetStatus === "cancelled") {
    return canManageActivities(roles)
  }
  return canOperateActivities(roles)
}

export function canUploadActivityDoc(roles: readonly RoleCode[]): boolean {
  return canOperateActivities(roles)
}

export function canRemoveActivityDoc(roles: readonly RoleCode[]): boolean {
  return canManageActivities(roles)
}

export interface ActivityDocument {
  fileId: string
  fileName: string
  contentType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf"
  extension: "jpg" | "jpeg" | "png" | "webp" | "pdf"
  viewUrl: string
  downloadUrl: string
}

export interface ActivityItem {
  id: string
  tenantId: string
  title: string
  description: string | null
  category: ActivityCategory
  location: string
  startAt: string
  endAt: string | null
  status: ActivityStatus
  allowSelfRegistration: boolean
  maxParticipants: number | null
  registrationDeadline: string | null
  activeParticipantCount: number
  remainingSlots: number | null
  isFull: boolean
  documents: ActivityDocument[]
  documentCount: number
  createdBy: string
  updatedBy: string | null
  cancelledAt: string | null
  cancelledBy: string | null
  cancellationReason: string | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ActivityPermissions {
  canUpdateInfo: boolean
  canStartActivity: boolean
  canCompleteActivity: boolean
  canCancelActivity: boolean
  canSoftDelete: boolean
  canManageParticipants: boolean
  canRecordAttendance: boolean
  canUploadDocuments: boolean
  canRemoveDocuments: boolean
}

export interface ActivityDetail {
  activity: ActivityItem
  permissions: ActivityPermissions
}

export interface ActivityStatusCounts {
  scheduled: number
  ongoing: number
  completed: number
  cancelled: number
  total: number
}

export interface ActivityListFilters {
  status?: ActivityStatus
  category?: ActivityCategory
  search?: string
  upcomingOnly?: boolean
  includeDeleted?: boolean
  page?: number
  pageSize?: number
  sortBy?: ActivitySortField
  sort?: ActivitySortDirection
}

export interface ActivityPageResult {
  items: ActivityItem[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  summary: ActivityStatusCounts
  canManage: boolean
  canOperate: boolean
}

export interface ActivityParticipant {
  id: string
  tenantId: string
  activityId: string
  residentId: string | null
  residentNameSnapshot: string
  householdLabelSnapshot: string
  rsvpStatus: ActivityParticipantStatus
  registrationNotes: string | null
  cancellationReason: string | null
  cancelledAt: string | null
  recordedBy: string | null
  registeredAt: string
  updatedAt: string
}

export interface ActivityParticipantSummary {
  invited: number
  attending: number
  cancelled: number
  attended: number
  absent: number
  activeSeats: number
  total: number
}

export interface ActivityParticipantsFilters {
  rsvpStatus?: ActivityParticipantStatus
  search?: string
  page?: number
  pageSize?: number
}

export interface ActivityParticipantsPageResult {
  items: ActivityParticipant[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  summary: ActivityParticipantSummary
}

export interface ResidentActivityRegistrationSummary {
  participantId: string
  activityId: string
  rsvpStatus: ActivityParticipantStatus
  registrationNotes: string | null
  cancellationReason: string | null
  cancelledAt: string | null
  registeredAt: string
  updatedAt: string
}

export interface ResidentActivityItem extends ActivityItem {
  myRegistration: ResidentActivityRegistrationSummary | null
  canRegister: boolean
  canCancelRegistration: boolean
  registrationBlockReason: string | null
}

export interface ResidentActivityPageResult {
  items: ResidentActivityItem[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  summary: ActivityStatusCounts
}

export interface ResidentActivityDetail {
  activity: ResidentActivityItem
  myRegistration: ResidentActivityRegistrationSummary | null
  isEligibleResident: boolean
}

export interface ResidentActivityRegistrationDetail {
  activityId: string
  activityStatus: ActivityStatus
  allowSelfRegistration: boolean
  maxParticipants: number | null
  registrationDeadline: string | null
  activeParticipantCount: number
  remainingSlots: number | null
  isFull: boolean
  isEligibleResident: boolean
  canRegister: boolean
  canCancelRegistration: boolean
  registrationBlockReason: string | null
  myRegistration: ResidentActivityRegistrationSummary | null
}

export interface ResidentActivityHistoryItem {
  participant: ResidentActivityRegistrationSummary
  activity: ActivityItem
}

export interface ResidentActivityHistoryPageResult {
  items: ResidentActivityHistoryItem[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
}

export interface CreateActivityInput {
  title: string
  description?: string | null
  category?: ActivityCategory
  location: string
  startAt: string
  endAt?: string | null
  allowSelfRegistration?: boolean
  maxParticipants?: number | null
  registrationDeadline?: string | null
}

export interface UpdateActivityInput extends CreateActivityInput {
  activityId: string
}

export interface TransitionActivityStatusInput {
  activityId: string
  newStatus: Exclude<ActivityStatus, "scheduled">
  reason?: string | null
}

export interface SoftDeleteActivityInput {
  activityId: string
  reason?: string | null
}

export interface RegisterForActivityInput {
  activityId: string
  notes?: string | null
}

export interface CancelActivityRegistrationInput {
  activityId: string
  reason?: string | null
}

export interface AddActivityParticipantInput {
  activityId: string
  residentId: string
  rsvpStatus?: ActivityManualParticipantStatus
  notes?: string | null
}

export interface RemoveActivityParticipantInput {
  activityId: string
  participantId: string
  reason?: string | null
}

export interface RecordActivityAttendanceInput {
  activityId: string
  residentId: string
  rsvpStatus: ActivityParticipantStatus
}

export interface RemoveActivityDocInput {
  activityId: string
  fileId: string
  reason?: string | null
}

export interface UploadActivityDocResult {
  activityId: string
  document: ActivityDocument
  documentCount: number
}

export interface RemoveActivityDocResult {
  activityId: string
  fileId: string
  jobId: string
  outcome: string
  jobStatus: string
}

export interface RegisterActivityResult {
  participantId: string
  activityId: string
  rsvpStatus: "attending"
  registeredAt: string
}

export interface CancelActivityRegistrationResult {
  participantId: string
  activityId: string
  rsvpStatus: "cancelled"
  cancelledAt: string
}

export interface RemoveActivityParticipantResult {
  activityId: string
  participantId: string
  removedFromActiveRoster: true
  preservesRosterRow: false
}

export type ActivityActionErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "DUPLICATE_REGISTRATION"
  | "CAPACITY_FULL"
  | "DEADLINE_PASSED"
  | "REGISTRATION_CLOSED"
  | "INVALID_STATE"
  | "INELIGIBLE_RESIDENT"
  | "DOCUMENT_UNAVAILABLE"
  | "DOCUMENT_LIMIT_REACHED"
  | "DUPLICATE_DOCUMENT"
  | "LOCK_TIMEOUT"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "STORAGE_ERROR"
  | "INTERNAL_ERROR"

export interface ActivityActionResult<T = unknown> {
  ok: boolean
  data: T | null
  error: string | null
  code?: ActivityActionErrorCode
  fieldErrors?: Record<string, string[] | undefined>
}

