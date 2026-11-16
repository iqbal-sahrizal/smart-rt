import { Suspense } from "react"
import { notFound } from "next/navigation"

import { ResidentComplaintDetailSkeleton } from "@/components/complaints/complaints-skeletons"
import { ResidentComplaintDetailView } from "@/components/complaints/resident-complaint-detail-view"
import { requireResidentContext } from "@/lib/auth/guards"
import { getResidentComplaintDetail } from "@/lib/complaints/queries"

type DetailParams = Promise<{ id: string }>

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function ResidentComplaintDetailContent({
  params,
}: {
  params: DetailParams
}) {
  const [{ ctx, tenant }, { id }] = await Promise.all([
    requireResidentContext(),
    params,
  ])

  if (!UUID_REGEX.test(id)) {
    notFound()
  }

  const detail = await getResidentComplaintDetail({
    tenantId: tenant.tenantId,
    memberId: tenant.memberId,
    roles: tenant.roles,
    complaintId: id,
  })

  if (!detail) {
    notFound()
  }

  return (
    <ResidentComplaintDetailView
      tenantId={tenant.tenantId}
      actorKey={ctx.user.id}
      complaintId={id}
      initialDetail={detail}
    />
  )
}

export default function ResidentComplaintDetailPage({
  params,
}: {
  params: DetailParams
}) {
  return (
    <Suspense fallback={<ResidentComplaintDetailSkeleton />}>
      <ResidentComplaintDetailContent params={params} />
    </Suspense>
  )
}

