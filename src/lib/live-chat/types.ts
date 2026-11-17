import type { RoleCode } from "@/lib/auth/types"

export type ChatScope = "resident" | "admin"

export type ChatMessageModerationStatus =
  | "published"
  | "deleted_by_sender"
  | "hidden_by_moderator"

export const CHAT_MODERATOR_ROLES: readonly RoleCode[] = [
  "ketua_rt",
  "sekretaris",
  "pengurus",
] as const

export function canModerateLiveChat(roles: readonly RoleCode[]): boolean {
  return roles.some((role) => CHAT_MODERATOR_ROLES.includes(role))
}

export interface ChatRoomInfo {
  id: string
  tenantId: string
  slug: string
  name: string
  description: string
  isActive: boolean
}

export interface ChatReplyPreview {
  id: string
  senderName: string
  content: string
  hasAttachment: boolean
  moderationStatus: ChatMessageModerationStatus
}

export interface ChatAttachmentInput {
  path: string
  mimeType: "image/jpeg" | "image/png" | "image/webp"
  size: number
}

export interface ChatMessageItem {
  id: string
  tenantId: string
  roomId: string
  senderUserId: string
  senderMemberId: string
  senderName: string
  senderRoleBadge: string | null
  content: string
  clientMessageId: string | null
  replyToMessageId: string | null
  replyTo: ChatReplyPreview | null
  attachmentPath: string | null
  attachmentMime: string | null
  attachmentSize: number | null
  attachmentUrl: string | null
  moderationStatus: ChatMessageModerationStatus
  moderationReason: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface ChatMessagesPage {
  room: ChatRoomInfo
  items: ChatMessageItem[]
  hasMore: boolean
  oldestCursor: string | null
}

export interface ChatOnlineParticipant {
  userId: string
  memberId: string
  displayName: string
  roleBadge: string
  onlineAt: string
}
