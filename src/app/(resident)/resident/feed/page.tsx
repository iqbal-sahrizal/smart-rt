import { Suspense } from "react"

import { ResidentCommunityFeedSkeleton } from "@/components/community-feed/community-feed-skeletons"
import { ResidentCommunityFeedView } from "@/components/community-feed/resident-community-feed-view"
import { requireResidentContext } from "@/lib/auth/guards"
import { listResidentCommunityFeed } from "@/lib/community-feed/queries"
import type { CommunityFeedPage } from "@/lib/community-feed/types"

async function ResidentCommunityFeedContent() {
  const { ctx, tenant } = await requireResidentContext()

  let initialData: CommunityFeedPage | null = null
  let initialError: string | null = null

  try {
    initialData = await listResidentCommunityFeed({
      tenantId: tenant.tenantId,
      viewerMemberId: tenant.memberId,
    })
  } catch (err) {
    initialError =
      err instanceof Error ? err.message : "Gagal memuat feed komunitas warga."
  }

  return (
    <ResidentCommunityFeedView
      tenantId={tenant.tenantId}
      actorKey={ctx.user.id}
      initialData={initialData}
      initialError={initialError}
    />
  )
}

export default function ResidentCommunityFeedPage() {
  return (
    <Suspense fallback={<ResidentCommunityFeedSkeleton />}>
      <ResidentCommunityFeedContent />
    </Suspense>
  )
}
