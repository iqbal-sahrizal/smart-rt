import { Suspense } from "react"
import { notFound, redirect } from "next/navigation"

import { ComplaintsAdminDetailView } from "@/components/complaints/complaints-admin-detail-view"
import { ComplaintsAdminDetailSkeleton } from "@/components/complaints/complaints-skeletons"
import { requireAdminContext } from "@/lib/auth/guards"
import { getAdminComplaintDetail } from "@/lib/complaints/queries"
import { canReadComplaintsAdmin } from "@/lib/complaints/types"

type DetailParams = Promise<{ id: string }>

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function ComplaintsAdminDetailContent({
  params,
}: {
  params: DetailParams
}) {
  const [{ ctx, tenant }, { id }] = await Promise.all([
    requireAdminContext(),
    params,
  ])

  if (!canReadComplaintsAdmin(tenant.roles)) {
    redirect("/no-access")
  }

  if (!UUID_REGEX.test(id)) {
    notFound()
  }

  const detail = await getAdminComplaintDetail({
    tenantId: tenant.tenantId,
    roles: tenant.roles,
    complaintId: id,
  })

  if (!detail) {
    notFound()
  }

  return (
    <ComplaintsAdminDetailView
      tenantId={tenant.tenantId}
      actorKey={ctx.user.id}
      roles={tenant.roles}
      complaintId={id}
      initialDetail={detail}
    />
  )
}

export default function AdminComplaintDetailPage({
  params,
}: {
  params: DetailParams
}) {
  return (
    <Suspense fallback={<ComplaintsAdminDetailSkeleton />}>
      <ComplaintsAdminDetailContent params={params} />
    </Suspense>
  )
}

