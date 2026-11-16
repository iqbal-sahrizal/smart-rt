import { Suspense } from "react"

import { AdminDashboardView } from "@/components/dashboard/admin-dashboard-view"
import { PageContainer } from "@/components/layout/page-container"
import { Skeleton } from "@/components/ui/skeleton"
import { getAdminDashboardAnalytics } from "@/lib/analytics/queries"
import {
  parseAnalyticsSearchParams,
  resolveAnalyticsPeriod,
} from "@/lib/analytics/schemas"
import { canManageAnnouncements } from "@/lib/announcements/types"
import { requireAdminContext } from "@/lib/auth/guards"
import { canManageBills, canManageDues } from "@/lib/finance/types"
import { canManageResidents } from "@/lib/residents/types"

type AdminDashboardSearchParams = Promise<{
  periodMode?: string
  year?: string
  month?: string
  startDate?: string
  endDate?: string
  activityCategory?: string
  activityPage?: string
}>

async function AdminDashboardContent({
  searchParams,
}: {
  searchParams: AdminDashboardSearchParams
}) {
  const { tenant } = await requireAdminContext()
  const resolved = await searchParams

  const parsed = parseAnalyticsSearchParams(resolved)
  const fallbackPeriod = resolveAnalyticsPeriod({ periodMode: "last_6_months" })

  const activePeriod = parsed.ok
    ? parsed.value.filter
    : fallbackPeriod.ok
      ? fallbackPeriod.period
      : {
          periodMode: "last_6_months" as const,
          year: 2026,
          month: 11,
          startDate: "2026-06-01",
          endDate: "2026-11-30",
          label: "6 Bulan Terakhir",
          granularity: "month" as const,
        }

  const analytics = await getAdminDashboardAnalytics({
    tenantId: tenant.tenantId,
    tenantName: tenant.tenantName,
    tenantSubtitle: `RT ${tenant.rtNumber} / RW ${tenant.rwNumber}`,
    filter: activePeriod,
    activityCategory: parsed.ok ? parsed.value.activityCategory : "all",
    activityPage: parsed.ok ? parsed.value.activityPage : 1,
    activityPageSize: 6,
  })

  return (
    <AdminDashboardView
      initialAnalytics={analytics}
      canManageResidents={canManageResidents(tenant.roles)}
      canManageAnnouncements={canManageAnnouncements(tenant.roles)}
      canManageDues={canManageDues(tenant.roles)}
      canManageBills={canManageBills(tenant.roles)}
      initialFilterError={parsed.ok ? null : parsed.error}
    />
  )
}

function AdminDashboardFallback() {
  return (
    <PageContainer>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, idx) => (
          <Skeleton key={idx} className="h-28 w-full" />
        ))}
      </div>
    </PageContainer>
  )
}

export default function AdminDashboardPage({
  searchParams,
}: {
  searchParams: AdminDashboardSearchParams
}) {
  return (
    <Suspense fallback={<AdminDashboardFallback />}>
      <AdminDashboardContent searchParams={searchParams} />
    </Suspense>
  )
}

