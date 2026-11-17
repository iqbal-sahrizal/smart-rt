import { Suspense } from "react"

import { LiveChatRoomView } from "@/components/live-chat/live-chat-room-view"
import { requireResidentContext } from "@/lib/auth/guards"
import { loadInitialChatPage } from "@/lib/live-chat/queries"
import { canModerateLiveChat } from "@/lib/live-chat/types"

async function ResidentChatContent() {
  const { ctx, tenant } = await requireResidentContext()
  const initialPage = await loadInitialChatPage({
    tenantId: tenant.tenantId,
    maskModeratedContent: true,
  })

  const displayName =
    ctx.profile.fullName.trim() ||
    ctx.user.email?.split("@")[0] ||
    "Warga RT"
  const tenantLabel = `RT ${tenant.rtNumber} / RW ${tenant.rwNumber} · ${tenant.tenantName}`
  const roleBadge = canModerateLiveChat(tenant.roles) ? "Pengurus" : "Warga"

  return (
    <div className="mx-auto w-full max-w-3xl px-2 py-2 sm:px-4 sm:py-4">
      <LiveChatRoomView
        scope="resident"
        tenantId={tenant.tenantId}
        tenantLabel={tenantLabel}
        initialPage={initialPage}
        currentUserId={ctx.user.id}
        currentMemberId={tenant.memberId}
        currentDisplayName={displayName}
        currentRoleBadge={roleBadge}
      />
    </div>
  )
}

export default function ResidentChatPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-3xl px-3 py-4">
          <div className="h-[68vh] animate-pulse rounded-xl bg-muted/60" />
        </div>
      }
    >
      <ResidentChatContent />
    </Suspense>
  )
}

