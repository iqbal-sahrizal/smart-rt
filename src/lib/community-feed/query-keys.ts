import type { QueryKey } from "@tanstack/react-query"

export const communityFeedQueryKeys = {
  all: (tenantId: string, actorKey: string) =>
    ["community-feed", tenantId, actorKey] as const,
  residentFeed: (tenantId: string, actorKey: string) =>
    ["community-feed", tenantId, actorKey, "resident", "list"] as const,
  postComments: (tenantId: string, actorKey: string, postId: string) =>
    ["community-feed", tenantId, actorKey, "comments", postId] as const,
  adminModeration: (tenantId: string, actorKey: string) =>
    ["community-feed", tenantId, actorKey, "admin", "moderation"] as const,
} as const

export function getCommunityFeedMutationInvalidationKeys({
  tenantId,
  actorKey,
}: {
  tenantId: string
  actorKey: string
}): QueryKey[] {
  return [["community-feed", tenantId, actorKey]]
}

