import "server-only"

import { getAuthContext } from "@/lib/auth/server"
import type { ActiveTenantMembership, AuthContextData } from "@/lib/auth/types"
import {
  COMMUNITY_COMMENT_DEFAULT_LIMIT,
  COMMUNITY_FEED_DEFAULT_LIMIT,
} from "@/lib/community-feed/constants"
import {
  listAdminModerationDashboardWithClient,
  listPostCommentsWithClient,
  listResidentCommunityFeedWithClient,
} from "@/lib/community-feed/repository"
import {
  canModerateCommunityFeed,
  type CommunityCommentsPage,
  type CommunityFeedPage,
  type CommunityFeedScope,
  type CommunityModerationDashboardData,
} from "@/lib/community-feed/types"
import { createClient } from "@/lib/supabase/server"

export interface ScopedCommunityFeedContext {
  ctx: AuthContextData
  tenant: ActiveTenantMembership
}

/**
 * Resolves the authenticated user and verified workspace tenant strictly from
 * live database memberships and validated workspace selection.
 * Non-member super_admins and bendahara (for admin moderation) are denied cleanly.
 */
export async function resolveScopedFeedContext(
  scope: CommunityFeedScope
): Promise<
  | { status: "ok"; context: ScopedCommunityFeedContext }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
> {
  const ctx = await getAuthContext()
  if (!ctx) {
    return { status: "unauthenticated" }
  }

  const eligible =
    scope === "admin"
      ? ctx.memberships.filter(
          (m) => m.hasAdminRole && canModerateCommunityFeed(m.roles)
        )
      : ctx.memberships.filter((m) => m.hasResidentRole)

  if (eligible.length === 0) {
    return { status: "forbidden" }
  }

  if (ctx.workspaceOptions.length > 1) {
    if (!ctx.selectedWorkspace || ctx.selectedWorkspace.type !== scope) {
      return { status: "forbidden" }
    }
    const matched = eligible.find(
      (m) => m.tenantId === ctx.selectedWorkspace?.tenantId
    )
    if (!matched) {
      return { status: "forbidden" }
    }
    return { status: "ok", context: { ctx, tenant: matched } }
  }

  if (!ctx.selectedWorkspace || ctx.selectedWorkspace.type !== scope) {
    return { status: "forbidden" }
  }

  return { status: "ok", context: { ctx, tenant: eligible[0] } }
}

/**
 * Resolves either active resident OR authorized admin moderator workspace context
 * for endpoints shared by both (such as authenticated private feed image proxy).
 */
export async function resolveAnyOperationalFeedContext(): Promise<
  | {
      status: "ok"
      scope: CommunityFeedScope
      context: ScopedCommunityFeedContext
    }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
> {
  const ctx = await getAuthContext()
  if (!ctx) {
    return { status: "unauthenticated" }
  }

  if (
    !ctx.selectedWorkspace ||
    ctx.selectedWorkspace.type === "super_admin" ||
    !ctx.selectedWorkspace.tenantId
  ) {
    return { status: "forbidden" }
  }

  const scope = ctx.selectedWorkspace.type
  const matched = ctx.memberships.find((m) => {
    if (m.tenantId !== ctx.selectedWorkspace?.tenantId) return false
    return scope === "admin"
      ? m.hasAdminRole && canModerateCommunityFeed(m.roles)
      : m.hasResidentRole
  })

  if (!matched) {
    return { status: "forbidden" }
  }

  return { status: "ok", scope, context: { ctx, tenant: matched } }
}

export async function listResidentCommunityFeed({
  tenantId,
  viewerMemberId,
  limit = COMMUNITY_FEED_DEFAULT_LIMIT,
  cursorCreatedAt,
  cursorId,
}: {
  tenantId: string
  viewerMemberId: string
  limit?: number
  cursorCreatedAt?: string
  cursorId?: string
}): Promise<CommunityFeedPage> {
  const supabase = await createClient()
  return listResidentCommunityFeedWithClient(supabase, {
    tenantId,
    viewerMemberId,
    limit,
    cursorCreatedAt,
    cursorId,
  })
}

export async function listPostComments({
  tenantId,
  viewerMemberId,
  postId,
  limit = COMMUNITY_COMMENT_DEFAULT_LIMIT,
  offset = 0,
}: {
  tenantId: string
  viewerMemberId: string
  postId: string
  limit?: number
  offset?: number
}): Promise<CommunityCommentsPage> {
  const supabase = await createClient()
  return listPostCommentsWithClient(supabase, {
    tenantId,
    viewerMemberId,
    postId,
    limit,
    offset,
  })
}

export async function listAdminModerationDashboard({
  tenantId,
  roles,
}: {
  tenantId: string
  roles: ActiveTenantMembership["roles"]
}): Promise<CommunityModerationDashboardData> {
  const supabase = await createClient()
  return listAdminModerationDashboardWithClient(supabase, {
    tenantId,
    roles,
  })
}

