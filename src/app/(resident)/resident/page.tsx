import { Suspense } from "react"

import { ResidentContainer } from "@/components/resident/resident-container"
import { ResidentDashboardView } from "@/components/resident/resident-dashboard-view"
import { Skeleton } from "@/components/ui/skeleton"
import { getResidentDashboardData } from "@/lib/analytics/queries"
import { requireResidentContext } from "@/lib/auth/guards"

async function ResidentHomeContent() {
  const { ctx, tenant } = await requireResidentContext()
  const data = await getResidentDashboardData({
    tenantId: tenant.tenantId,
    tenantName: tenant.tenantName,
    tenantSubtitle: `RT ${tenant.rtNumber} / RW ${tenant.rwNumber}`,
    userId: ctx.user.id,
    memberId: tenant.memberId,
    residentId: tenant.residentId,
  })

  return (
    <ResidentDashboardView
      data={data}
      fallbackGreetingName={ctx.profile.fullName || "Warga RT"}
    />
  )
}

function ResidentDashboardFallback() {
  return (
    <ResidentContainer>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    </ResidentContainer>
  )
}

export default function ResidentHomePage() {
  return (
    <Suspense fallback={<ResidentDashboardFallback />}>
      <ResidentHomeContent />
    </Suspense>
  )
}

