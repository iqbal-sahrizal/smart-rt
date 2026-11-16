import { Suspense } from "react"

import { NotificationCenterView } from "@/components/notifications/notification-center-view"
import { ResidentContainer } from "@/components/resident/resident-container"
import { requireResidentContext } from "@/lib/auth/guards"
import { getNotificationsPageForTenant } from "@/lib/notifications/queries"
import { isValidUuid } from "@/lib/residents/schemas"

type ResidentNotificationsSearchParams = Promise<{
  selected?: string
}>

function ResidentNotificationsSkeleton() {
  return (
    <ResidentContainer>
      <div className="h-14 w-64 animate-pulse rounded-lg bg-muted/60" />
      <div className="h-14 animate-pulse rounded-xl border border-border bg-surface/60" />
      <div className="space-y-3">
        {[0, 1, 2, 3].map((idx) => (
          <div
            key={idx}
            className="h-24 animate-pulse rounded-xl border border-border bg-surface/60"
          />
        ))}
      </div>
    </ResidentContainer>
  )
}

async function ResidentNotificationsContent({
  searchParams,
}: {
  searchParams: ResidentNotificationsSearchParams
}) {
  const { ctx, tenant } = await requireResidentContext()
  const resolved = await searchParams
  const initialSelectedId =
    typeof resolved.selected === "string" && isValidUuid(resolved.selected)
      ? resolved.selected
      : undefined

  const initialPage = await getNotificationsPageForTenant({
    tenantId: tenant.tenantId,
    userId: ctx.user.id,
    scope: "resident",
    filter: "all",
    limit: 15,
  })

  return (
    <NotificationCenterView
      scope="resident"
      tenantId={tenant.tenantId}
      tenantName={tenant.tenantName}
      initialPage={initialPage}
      initialSelectedId={initialSelectedId}
    />
  )
}

export default function ResidentNotificationsPage({
  searchParams,
}: {
  searchParams: ResidentNotificationsSearchParams
}) {
  return (
    <Suspense fallback={<ResidentNotificationsSkeleton />}>
      <ResidentNotificationsContent searchParams={searchParams} />
    </Suspense>
  )
}

