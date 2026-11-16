import type { RoleCode } from "@/lib/auth/types"
import {
  LETTER_ADMIN_READ_ROLES,
  LETTER_DOCUMENT_VIEW_ROLES,
  LETTER_MANAGEMENT_ROLES,
  LETTER_REVIEW_DECISIONS,
  LETTER_SORT_DIRECTIONS,
  LETTER_SORT_FIELDS,
  LETTER_STATUSES,
} from "@/lib/letters/constants"

export type LetterRequestStatus = (typeof LETTER_STATUSES)[number]
export type LetterReviewDecision = (typeof LETTER_REVIEW_DECISIONS)[number]
export type LetterScope = "admin" | "resident"
export type LetterSortField = (typeof LETTER_SORT_FIELDS)[number]
export type LetterSortDirection = (typeof LETTER_SORT_DIRECTIONS)[number]

export function canReadLettersAdmin(roles: readonly RoleCode[]): boolean {
  return roles.some((role) => LETTER_ADMIN_READ_ROLES.includes(role))
}

export function canManageLetters(roles: readonly RoleCode[]): boolean {
  return roles.some((role) => LETTER_MANAGEMENT_ROLES.includes(role))
}

export function canViewLetterDocuments(roles: readonly RoleCode[]): boolean {
  return roles.some((role) => LETTER_DOCUMENT_VIEW_ROLES.includes(role))
}

export function isLetterMetadataOnlyRole(roles: readonly RoleCode[]): boolean {
  return canReadLettersAdmin(roles) && !canViewLetterDocuments(roles)
}

export interface LetterType {
  id: string
  tenantId: string
  code: string
  name: string
  description: string | null
  requiredDocuments: string[]
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface LetterRequestAttachment {
  fileId: string
  fileName: string
  contentType: "image/jpeg" | "image/png" | "application/pdf"
  extension: "jpg" | "jpeg" | "png" | "pdf"
  downloadUrl: string
}

export interface LetterRequest {
  id: string
  tenantId: string
  letterTypeId: string
  letterTypeCode: string
  letterTypeName: string
  residentId: string
  residentName: string
  residentUnitLabel: string | null
  requestedByMemberId: string
  purpose: string
  status: LetterRequestStatus
  adminNotes: string | null
  letterNumber: string | null
  reviewedBy: string | null
  reviewedByLabel: string | null
  reviewedAt: string | null
  issuedAt: string | null
  hasIssuedPdf: boolean
  issuedPdfUrl: string | null
  issuedDownloadUrl: string | null
  attachments: LetterRequestAttachment[]
  attachmentCount: number
  createdAt: string
  updatedAt: string
}

export type LetterRequestListItem = LetterRequest

export interface LetterRequestPermissions {
  canAttachDocs: boolean
  canRemoveDocs: boolean
  canCancel: boolean
  canReview: boolean
  canIssue: boolean
  canAccessDocuments: boolean
  isMetadataOnly: boolean
}

export interface LetterRequestDetail {
  request: LetterRequest
  letterType: LetterType | null
  permissions: LetterRequestPermissions
}

export interface LetterStatusCounts {
  submitted: number
  reviewing: number
  approved: number
  rejected: number
  completed: number
  cancelled: number
  total: number
}

export interface LetterListFilters {
  status?: LetterRequestStatus
  letterTypeId?: string
  search?: string
  page?: number
  pageSize?: number
  sortBy?: LetterSortField
  sort?: LetterSortDirection
}

export interface LetterPageResult {
  items: LetterRequestListItem[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  summary: LetterStatusCounts
  isMetadataOnly: boolean
}

export interface CreateLetterRequestInput {
  letterTypeId: string
  purpose: string
}

export interface RemoveLetterSupportingDocInput {
  requestId: string
  fileId: string
  reason?: string | null
}

export interface CancelLetterRequestInput {
  requestId: string
  reason?: string | null
}

export interface ReviewLetterRequestInput {
  requestId: string
  decision: LetterReviewDecision
  adminNotes?: string | null
}

export interface CreateLetterTypeInput {
  code: string
  name: string
  description?: string | null
  requiredDocuments?: string[]
  isActive?: boolean
}

export interface UpdateLetterTypeInput {
  letterTypeId: string
  code: string
  name: string
  description?: string | null
  requiredDocuments?: string[]
  isActive: boolean
}

export interface DeleteLetterTypeInput {
  letterTypeId: string
}

export type LetterActionErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_STATE"
  | "INELIGIBLE_RESIDENT"
  | "ATTACHMENT_LIMIT_REACHED"
  | "DUPLICATE_ATTACHMENT"
  | "STORAGE_ERROR"
  | "INTERNAL_ERROR"

export interface LetterActionResult<T = unknown> {
  ok: boolean
  data: T | null
  error: string | null
  code?: LetterActionErrorCode
  fieldErrors?: Record<string, string[] | undefined>
}

export interface UploadLetterAttachmentResult {
  requestId: string
  attachment: LetterRequestAttachment
  attachmentCount: number
}

export interface RemoveLetterAttachmentResult {
  requestId: string
  fileId: string
  jobId: string
  outcome: string
  jobStatus: string
}

export interface IssueLetterResult {
  requestId: string
  letterNumber: string
  issuedPdfUrl: string
  issuedDownloadUrl: string
}

