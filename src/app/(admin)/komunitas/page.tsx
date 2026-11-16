import { Suspense } from "react"
import { redirect } from "next/navigation"

import { AdminCommunityModerationView } from "@/components/community-feed/admin-community-moderation-view"
import { AdminCommunityModerationSkeleton } from "@/components/community-feed/community-feed-skeletons"
import { PageContainer } from "@/components/layout/page-container"
import { requireAdminContext } from "@/lib/auth/guards"
import { canModerateCommunityFeed } from "@/lib/community-feed/types"
import { listAdminModerationDashboard } from "@/lib/community-feed/queries"
import type { CommunityModerationDashboardData } from "@/lib/community-feed/types"

async function AdminCommunityModerationContent() {
  const { ctx, tenant } = await requireAdminContext()

  if (!canModerateCommunityFeed(tenant.roles)) {
    redirect("/no-access")
  }

  let initialData: CommunityModerationDashboardData | null = null
  let initialError: string | null = null

  try {
    initialData = await listAdminModerationDashboard({
      tenantId: tenant.tenantId,
      roles: tenant.roles,
    })
  } catch (err) {
    initialError =
      err instanceof Error
        ? err.message
        : "Gagal memuat modul moderasi feed komunitas."
  }

  return (
    <PageContainer>
      <AdminCommunityModerationView
        tenantId={tenant.tenantId}
        actorKey={ctx.user.id}
        initialData={initialData}
        initialError={initialError}
      />
    </PageContainer>
  )
}

export default function AdminCommunityModerationPage() {
  return (
    <Suspense
      fallback={
        <PageContainer>
          <AdminCommunityModerationSkeleton />
        </PageContainer>
      }
    >
      <AdminCommunityModerationContent />
    </Suspense>
  )
}
