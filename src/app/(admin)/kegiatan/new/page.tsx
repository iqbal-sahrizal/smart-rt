import { Suspense } from "react"
import { redirect } from "next/navigation"

import { ActivityFormSkeleton } from "@/components/activities/activities-skeletons"
import { ActivityForm } from "@/components/activities/activity-form"
import { requireAdminContext } from "@/lib/auth/guards"
import { canManageActivities } from "@/lib/activities/types"

async function NewActivityContent() {
  const { tenant } = await requireAdminContext()

  if (!canManageActivities(tenant.roles)) {
    redirect("/no-access")
  }

  return <ActivityForm tenantId={tenant.tenantId} mode="create" />
}

export default function NewAdminActivityPage() {
  return (
    <Suspense fallback={<ActivityFormSkeleton />}>
      <NewActivityContent />
    </Suspense>
  )
}

