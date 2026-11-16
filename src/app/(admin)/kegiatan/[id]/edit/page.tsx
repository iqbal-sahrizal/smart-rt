import { Suspense } from "react"
import { notFound, redirect } from "next/navigation"

import { ActivityFormSkeleton } from "@/components/activities/activities-skeletons"
import { ActivityForm } from "@/components/activities/activity-form"
import { requireAdminContext } from "@/lib/auth/guards"
import { getAdminActivityDetail } from "@/lib/activities/queries"
import { canManageActivities } from "@/lib/activities/types"
import { isValidUuid } from "@/lib/residents/schemas"

type EditParams = Promise<{ id: string }>

async function EditActivityContent({ params }: { params: EditParams }) {
  const [{ tenant }, { id }] = await Promise.all([
    requireAdminContext(),
    params,
  ])

  if (!canManageActivities(tenant.roles)) {
    redirect("/no-access")
  }

  if (!isValidUuid(id)) {
    notFound()
  }

  const detail = await getAdminActivityDetail({
    tenantId: tenant.tenantId,
    roles: tenant.roles,
    activityId: id,
  })

  if (!detail) {
    notFound()
  }

  if (!detail.permissions.canUpdateInfo) {
    redirect(`/kegiatan/${id}?notice=locked_edit`)
  }

  return (
    <ActivityForm
      tenantId={tenant.tenantId}
      mode="edit"
      initialActivity={detail.activity}
    />
  )
}

export default function EditAdminActivityPage({
  params,
}: {
  params: EditParams
}) {
  return (
    <Suspense fallback={<ActivityFormSkeleton />}>
      <EditActivityContent params={params} />
    </Suspense>
  )
}

