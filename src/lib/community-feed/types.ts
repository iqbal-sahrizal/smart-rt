import type { RoleCode } from "@/lib/auth/types"
import {
  COMMUNITY_MODERATION_ROLES,
  COMMUNITY_MODERATION_STATUSES,
  COMMUNITY_REPORT_CATEGORIES,
  COMMUNITY_REPORT_STATUSES,
} from "@/lib/community-feed/constants"

export type CommunityFeedScope = "resident" | "admin"
export type CommunityModerationStatus =
  (typeof COMMUNITY_MODERATION_STATUSES)[number]
export type CommunityReportCategory =
  (typeof COMMUNITY_REPORT_CATEGORIES)[number]
export type CommunityReportStatus = (typeof COMMUNITY_REPORT_STATUSES)[number]
export type CommunityReportTargetType = "post" | "comment"

export function canModerateCommunityFeed(roles: readonly RoleCode[]): boolean {
  return roles.some((role) => COMMUNITY_MODERATION_ROLES.includes(role))
}

export interface CommunityAuthorInfo {
  memberId: string
  displayName: string
  initials: string
  staffBadge: string | null
}

export interface CommunityPostMediaItem {
  id: string
  mimeType: string
  fileSizeBytes: number
  sortOrder: number
  url: string
}

export interface CommunityCommentItem {
  id: string
  tenantId: string
  postId: string
  authorMemberId: string
  author: CommunityAuthorInfo
  parentCommentId: string | null
  content: string
  moderationStatus: CommunityModerationStatus
  createdAt: string
  updatedAt: string
  isOwnComment: boolean
  isEdited: boolean
}

export interface CommunityPostItem {
  id: string
  tenantId: string
  authorMemberId: string
  author: CommunityAuthorInfo
  caption: string | null
  media: CommunityPostMediaItem[]
  mediaCount: number
  likeCount: number
  commentCount: number
  likedByMe: boolean
  moderationStatus: CommunityModerationStatus
  createdAt: string
  updatedAt: string
  isOwnPost: boolean
  isEdited: boolean
  previewComments: CommunityCommentItem[]
}

export interface CommunityFeedCursor {
  createdAt: string
  id: string
}

export interface CommunityFeedPage {
  items: CommunityPostItem[]
  hasMore: boolean
  nextCursor: CommunityFeedCursor | null
}

export interface CommunityCommentsPage {
  postId: string
  items: CommunityCommentItem[]
  totalCount: number
  hasMore: boolean
  nextOffset: number | null
}

export interface CommunityReportItem {
  id: string
  tenantId: string
  targetType: CommunityReportTargetType
  postId: string | null
  commentId: string | null
  reporterMemberId: string
  reporterName: string
  reasonCategory: CommunityReportCategory
  reasonDetail: string | null
  status: CommunityReportStatus
  reviewedByName: string | null
  reviewedAt: string | null
  resolutionNote: string | null
  createdAt: string
  targetPreview: {
    exists: boolean
    authorName: string
    contentText: string | null
    moderationStatus: CommunityModerationStatus | null
    media: CommunityPostMediaItem[]
    parentPostId: string | null
  }
}

export interface CommunityModerationPostItem {
  id: string
  tenantId: string
  authorMemberId: string
  author: CommunityAuthorInfo
  caption: string | null
  media: CommunityPostMediaItem[]
  likeCount: number
  commentCount: number
  moderationStatus: CommunityModerationStatus
  moderationReason: string | null
  moderatedAt: string | null
  moderatedByName: string | null
  createdAt: string
  updatedAt: string
  pendingReportCount: number
}

export interface CommunityModerationAuditItem {
  id: string
  action: string
  entityType: string
  entityId: string | null
  actorName: string
  metadata: Record<string, unknown>
  createdAt: string
}

export interface CommunityModerationDashboardData {
  reports: CommunityReportItem[]
  posts: CommunityModerationPostItem[]
  auditLogs: CommunityModerationAuditItem[]
  pendingReportCount: number
  hiddenPostCount: number
}

export type CommunityActionErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "MEDIA_ERROR"
  | "INTERNAL_ERROR"

export interface CommunityActionResult<T = unknown> {
  ok: boolean
  data: T | null
  error: string | null
  code?: CommunityActionErrorCode
  fieldErrors?: Record<string, string[] | undefined>
}

