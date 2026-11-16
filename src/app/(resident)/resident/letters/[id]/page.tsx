import { Suspense } from "react"
import { notFound } from "next/navigation"

import { ResidentLetterDetailSkeleton } from "@/components/letters/letters-skeletons"
import { ResidentLetterDetailView } from "@/components/letters/resident-letter-detail-view"
import { requireResidentContext } from "@/lib/auth/guards"
import { getResidentLetterRequestDetail } from "@/lib/letters/queries"

type DetailParams = Promise<{ id: string }>

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function ResidentLetterDetailContent({
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

  const detail = await getResidentLetterRequestDetail({
    tenantId: tenant.tenantId,
    memberId: tenant.memberId,
    residentId: tenant.residentId,
    requestId: id,
  })

  if (!detail) {
    notFound()
  }

  return (
    <ResidentLetterDetailView
      tenantId={tenant.tenantId}
      actorKey={ctx.user.id}
      requestId={id}
      initialDetail={detail}
    />
  )
}

export default function ResidentLetterDetailPage({
  params,
}: {
  params: DetailParams
}) {
  return (
    <Suspense fallback={<ResidentLetterDetailSkeleton />}>
      <ResidentLetterDetailContent params={params} />
    </Suspense>
  )
}

