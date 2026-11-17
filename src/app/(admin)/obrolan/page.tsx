import { Suspense } from "react"
import { redirect } from "next/navigation"

import { PageContainer } from "@/components/layout/page-container"
import { LiveChatRoomView } from "@/components/live-chat/live-chat-room-view"
import { requireAdminContext } from "@/lib/auth/guards"
import { loadInitialChatPage } from "@/lib/live-chat/queries"
import { canModerateLiveChat } from "@/lib/live-chat/types"

async function AdminLiveChatContent() {
  const { ctx, tenant } = await requireAdminContext()

  if (!canModerateLiveChat(tenant.roles)) {
    redirect("/no-access")
  }

  const initialPage = await loadInitialChatPage({
    tenantId: tenant.tenantId,
    maskModeratedContent: false,
  })

  const displayName =
    ctx.profile.fullName.trim() ||
    ctx.user.email?.split("@")[0] ||
    "Pengurus RT"
  const tenantLabel = `RT ${tenant.rtNumber} / RW ${tenant.rwNumber} · ${tenant.tenantName}`

  return (
    <LiveChatRoomView
      scope="admin"
      tenantId={tenant.tenantId}
      tenantLabel={tenantLabel}
      initialPage={initialPage}
      currentUserId={ctx.user.id}
      currentMemberId={tenant.memberId}
      currentDisplayName={displayName}
      currentRoleBadge="Pengurus"
    />
  )
}

export default function AdminLiveChatPage() {
  return (
    <PageContainer className="py-4">
      <Suspense
        fallback={
          <div className="h-[70vh] animate-pulse rounded-xl bg-muted/60" />
        }
      >
        <AdminLiveChatContent />
      </Suspense>
    </PageContainer>
  )
}

