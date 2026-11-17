import { NextResponse, type NextRequest } from "next/server"

import {
  resolveAnyOperationalChatContext,
  resolveScopedChatContext,
} from "@/lib/live-chat/queries"
import { loadInitialChatPageWithClient } from "@/lib/live-chat/repository"
import { canModerateLiveChat, type ChatScope } from "@/lib/live-chat/types"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: NextRequest) {
  const requestedScope = request.nextUrl.searchParams.get("scope")
  const explicitScope: ChatScope | null =
    requestedScope === "admin" || requestedScope === "resident"
      ? requestedScope
      : null
  const auth = explicitScope
    ? {
        scope: explicitScope,
        res: await resolveScopedChatContext(explicitScope),
      }
    : (() => null)()

  const resolved = auth
    ? auth.res.status === "ok"
      ? { status: "ok" as const, scope: auth.scope, context: auth.res.context }
      : auth.res
    : await resolveAnyOperationalChatContext()

  if (resolved.status === "unauthenticated") {
    return NextResponse.json(
      { error: "Sesi login Anda telah berakhir." },
      { status: 401 }
    )
  }
  if (resolved.status === "forbidden") {
    return NextResponse.json(
      { error: "Anda tidak memiliki akses pada ruang obrolan RT ini." },
      { status: 403 }
    )
  }

  const resolvedScope = resolved.scope
  const { ctx, tenant } = resolved.context
  const supabase = await createClient()
  const initialPage = await loadInitialChatPageWithClient(supabase, {
    tenantId: tenant.tenantId,
    maskModeratedContent: resolvedScope !== "admin",
  })

  const displayName =
    ctx.profile.fullName.trim() ||
    ctx.user.email?.split("@")[0] ||
    (resolvedScope === "admin" ? "Pengurus RT" : "Warga RT")

  return NextResponse.json(
    {
      scope: resolvedScope,
      tenantId: tenant.tenantId,
      tenantLabel: `RT ${tenant.rtNumber} / RW ${tenant.rwNumber} · ${tenant.tenantName}`,
      initialPage,
      currentUserId: ctx.user.id,
      currentMemberId: tenant.memberId,
      currentDisplayName: displayName,
      currentRoleBadge: canModerateLiveChat(tenant.roles) ? "Pengurus" : "Warga",
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  )
}
