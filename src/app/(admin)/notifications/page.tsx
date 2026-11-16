import { Suspense } from "react"

import { PageContainer } from "@/components/layout/page-container"
import { NotificationCenterView } from "@/components/notifications/notification-center-view"
import { requireAdminContext } from "@/lib/auth/guards"
import { getNotificationsPageForTenant } from "@/lib/notifications/queries"
import { isValidUuid } from "@/lib/residents/schemas"

type AdminNotificationsSearchParams = Promise<{
  selected?: string
}>

function NotificationsCenterSkeleton() {
  return (
    <PageContainer>
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
    </PageContainer>
  )
}

async function AdminNotificationsContent({
  searchParams,
}: {
  searchParams: AdminNotificationsSearchParams
}) {
  const { ctx, tenant } = await requireAdminContext()
  const resolved = await searchParams
  const initialSelectedId =
    typeof resolved.selected === "string" && isValidUuid(resolved.selected)
      ? resolved.selected
      : undefined

  const initialPage = await getNotificationsPageForTenant({
    tenantId: tenant.tenantId,
    userId: ctx.user.id,
    scope: "admin",
    filter: "all",
    limit: 15,
  })

  return (
    <NotificationCenterView
      scope="admin"
      tenantId={tenant.tenantId}
      tenantName={tenant.tenantName}
      initialPage={initialPage}
      initialSelectedId={initialSelectedId}
    />
  )
}

export default function AdminNotificationsPage({
  searchParams,
}: {
  searchParams: AdminNotificationsSearchParams
}) {
  return (
    <Suspense fallback={<NotificationsCenterSkeleton />}>
      <AdminNotificationsContent searchParams={searchParams} />
    </Suspense>
  )
}

