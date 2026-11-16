import { Suspense } from "react"
import { notFound } from "next/navigation"

import { ResidentActivityDetailSkeleton } from "@/components/activities/resident-activities-skeletons"
import { ResidentActivityDetailView } from "@/components/activities/resident-activity-detail-view"
import { requireResidentContext } from "@/lib/auth/guards"
import { getResidentActivityDetail } from "@/lib/activities/queries"
import { isValidUuid } from "@/lib/residents/schemas"

type DetailParams = Promise<{ id: string }>

async function ResidentActivityDetailContent({
  params,
}: {
  params: DetailParams
}) {
  const [{ ctx, tenant }, { id }] = await Promise.all([
    requireResidentContext(),
    params,
  ])

  if (!isValidUuid(id)) {
    notFound()
  }

  const detail = await getResidentActivityDetail({
    tenantId: tenant.tenantId,
    residentId: tenant.residentId,
    activityId: id,
  })

  if (!detail) {
    notFound()
  }

  return (
    <ResidentActivityDetailView
      tenantId={tenant.tenantId}
      actorKey={ctx.user.id}
      activityId={id}
      initialDetail={detail}
    />
  )
}

export default function ResidentActivityDetailPage({
  params,
}: {
  params: DetailParams
}) {
  return (
    <Suspense fallback={<ResidentActivityDetailSkeleton />}>
      <ResidentActivityDetailContent params={params} />
    </Suspense>
  )
}

