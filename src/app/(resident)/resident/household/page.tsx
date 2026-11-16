import { Suspense } from "react"

import { ResidentHouseholdView } from "@/components/residents/resident-portal-views"
import { ResidentPortalSkeleton } from "@/components/residents/resident-skeletons"
import { requireResidentContext } from "@/lib/auth/guards"
import { getResidentPortalData } from "@/lib/residents/queries"

async function ResidentHouseholdContent() {
  const { ctx, tenant } = await requireResidentContext()
  const data = await getResidentPortalData({
    tenantId: tenant.tenantId,
    userId: ctx.user.id,
    includePrivateProfile: false,
  })

  return <ResidentHouseholdView data={data} tenantName={tenant.tenantName} />
}

export default function ResidentHouseholdPage() {
  return (
    <Suspense fallback={<ResidentPortalSkeleton />}>
      <ResidentHouseholdContent />
    </Suspense>
  )
}

