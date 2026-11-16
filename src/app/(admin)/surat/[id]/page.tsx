import { Suspense } from "react"
import { notFound, redirect } from "next/navigation"

import { LettersAdminDetailView } from "@/components/letters/letters-admin-detail-view"
import { LettersAdminDetailSkeleton } from "@/components/letters/letters-skeletons"
import { requireAdminContext } from "@/lib/auth/guards"
import { getAdminLetterRequestDetail } from "@/lib/letters/queries"
import { canReadLettersAdmin } from "@/lib/letters/types"

type DetailParams = Promise<{ id: string }>

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function LettersAdminDetailContent({
  params,
}: {
  params: DetailParams
}) {
  const [{ ctx, tenant }, { id }] = await Promise.all([
    requireAdminContext(),
    params,
  ])

  if (!canReadLettersAdmin(tenant.roles)) {
    redirect("/no-access")
  }

  if (!UUID_REGEX.test(id)) {
    notFound()
  }

  const detail = await getAdminLetterRequestDetail({
    tenantId: tenant.tenantId,
    roles: tenant.roles,
    requestId: id,
  })

  if (!detail) {
    notFound()
  }

  return (
    <LettersAdminDetailView
      tenantId={tenant.tenantId}
      actorKey={ctx.user.id}
      roles={tenant.roles}
      requestId={id}
      initialDetail={detail}
    />
  )
}

export default function AdminLetterDetailPage({
  params,
}: {
  params: DetailParams
}) {
  return (
    <Suspense fallback={<LettersAdminDetailSkeleton />}>
      <LettersAdminDetailContent params={params} />
    </Suspense>
  )
}

