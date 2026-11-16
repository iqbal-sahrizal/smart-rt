import { Suspense } from "react"

import { ResidentProfileView } from "@/components/residents/resident-portal-views"
import { ResidentPortalSkeleton } from "@/components/residents/resident-skeletons"
import { requireResidentContext } from "@/lib/auth/guards"
import { getResidentPortalData } from "@/lib/residents/queries"

async function ResidentProfileContent() {
  const { ctx, tenant } = await requireResidentContext()
  const data = await getResidentPortalData({
    tenantId: tenant.tenantId,
    userId: ctx.user.id,
    includePrivateProfile: true,
  })

  return <ResidentProfileView data={data} tenantName={tenant.tenantName} />
}

export default function ResidentProfilePage() {
  return (
    <Suspense fallback={<ResidentPortalSkeleton />}>
      <ResidentProfileContent />
    </Suspense>
  )
}

