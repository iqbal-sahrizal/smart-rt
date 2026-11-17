import "server-only"

import { getAuthContext } from "@/lib/auth/server"
import type { ActiveTenantMembership, AuthContextData } from "@/lib/auth/types"
import { loadInitialChatPageWithClient } from "@/lib/live-chat/repository"
import {
  canModerateLiveChat,
  type ChatMessagesPage,
  type ChatScope,
} from "@/lib/live-chat/types"
import { createClient } from "@/lib/supabase/server"

export interface ScopedChatContext {
  ctx: AuthContextData
  tenant: ActiveTenantMembership
}

/**
 * Resolves the authenticated user and verified workspace tenant from live
 * memberships. Admin chat moderation strictly excludes bendahara and super_admin.
 */
export async function resolveScopedChatContext(
  scope: ChatScope
): Promise<
  | { status: "ok"; context: ScopedChatContext }
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
          (m) => m.hasAdminRole && canModerateLiveChat(m.roles)
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

export async function resolveAnyOperationalChatContext(): Promise<
  | { status: "ok"; scope: ChatScope; context: ScopedChatContext }
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
      ? m.hasAdminRole && canModerateLiveChat(m.roles)
      : m.hasResidentRole
  })

  if (!matched) {
    return { status: "forbidden" }
  }

  return { status: "ok", scope, context: { ctx, tenant: matched } }
}

export async function loadInitialChatPage({
  tenantId,
  maskModeratedContent = true,
}: {
  tenantId: string
  maskModeratedContent?: boolean
}): Promise<ChatMessagesPage> {
  const supabase = await createClient()
  return loadInitialChatPageWithClient(supabase, {
    tenantId,
    maskModeratedContent,
  })
}

