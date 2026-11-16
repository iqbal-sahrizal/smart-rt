import type { RoleCode } from "@/lib/auth/types"
import {
  COMPLAINT_ADMIN_READ_ROLES,
  COMPLAINT_CATEGORIES,
  COMPLAINT_MANAGEMENT_ROLES,
  COMPLAINT_PRIORITIES,
  COMPLAINT_STATUSES,
  COMPLAINT_TRANSITION_TARGETS,
} from "@/lib/complaints/constants"

export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number]
export type ComplaintTransitionTarget =
  (typeof COMPLAINT_TRANSITION_TARGETS)[number]
export type ComplaintPriority = (typeof COMPLAINT_PRIORITIES)[number]
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number]
export type ComplaintScope = "admin" | "resident"

export function canReadComplaintsAdmin(roles: readonly RoleCode[]): boolean {
  return roles.some((role) => COMPLAINT_ADMIN_READ_ROLES.includes(role))
}

export function canManageComplaints(roles: readonly RoleCode[]): boolean {
  return roles.some((role) => COMPLAINT_MANAGEMENT_ROLES.includes(role))
}

export function canViewComplaintPhotos(roles: readonly RoleCode[]): boolean {
  return canManageComplaints(roles)
}

export function isComplaintMetadataOnlyRole(roles: readonly RoleCode[]): boolean {
  return canReadComplaintsAdmin(roles) && !canManageComplaints(roles)
}

export interface Complaint {
  id: string
  tenantId: string
  reporterMemberId: string
  reporterLabel: string
  category: string
  title: string
  description: string
  photoPath: string | null
  photoUrl: string | null
  hasPhoto: boolean
  priority: ComplaintPriority
  status: ComplaintStatus
  createdAt: string
  updatedAt: string
}

export interface ComplaintReply {
  id: string
  tenantId: string
  complaintId: string
  authorMemberId: string
  authorLabel: string
  isStaffReply: boolean
  message: string
  attachmentPath: null
  createdAt: string
}

export interface ComplaintStatusHistory {
  id: string
  tenantId: string
  complaintId: string
  changedByMemberId: string
  changedByLabel: string
  previousStatus: ComplaintStatus
  newStatus: ComplaintStatus
  reason: string | null
  createdAt: string
}

export interface ComplaintDetail {
  complaint: Complaint
  replies: ComplaintReply[]
  statusHistory: ComplaintStatusHistory[]
  permissions: {
    canEdit: boolean
    canReply: boolean
    canTransition: boolean
    canSoftDelete: boolean
    canViewPhoto: boolean
    canManagePhoto: boolean
    isMetadataOnly: boolean
  }
}

export interface ComplaintStatusCounts {
  open: number
  inProgress: number
  resolved: number
  rejected: number
  total: number
}

export interface ComplaintListFilters {
  status?: ComplaintStatus
  category?: ComplaintCategory
  priority?: ComplaintPriority
  search?: string
  page?: number
  pageSize?: number
  sort?: "asc" | "desc"
}

export interface ComplaintPageResult {
  items: Complaint[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  summary: ComplaintStatusCounts
  isMetadataOnly: boolean
}

export interface CreateComplaintInput {
  category: ComplaintCategory
  title: string
  description: string
}

export interface UpdateComplaintInput {
  complaintId: string
  category: ComplaintCategory
  title: string
  description: string
}

export interface CreateComplaintReplyInput {
  complaintId: string
  message: string
  scope?: ComplaintScope
}

export interface TransitionComplaintStatusInput {
  complaintId: string
  newStatus: ComplaintTransitionTarget
  reason?: string | null
}

export interface SoftDeleteComplaintInput {
  complaintId: string
  reason: string
}

export interface DeleteComplaintPhotoInput {
  complaintId: string
  reason?: string | null
}

export type ComplaintActionErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_STATE"
  | "STORAGE_ERROR"
  | "INTERNAL_ERROR"

export interface ComplaintActionResult<T = unknown> {
  ok: boolean
  data: T | null
  error: string | null
  code?: ComplaintActionErrorCode
  fieldErrors?: Record<string, string[] | undefined>
}

export interface DeleteComplaintPhotoResult {
  jobId: string
  outcome: string
  jobStatus: string
}

export interface UploadComplaintPhotoResult {
  complaintId: string
  photoPath: string
  photoUrl: string
}

