import { Suspense } from "react"
import { notFound } from "next/navigation"

import { RondaAdminDetailView } from "@/components/ronda/ronda-admin-detail-view"
import { RondaDetailSkeleton } from "@/components/ronda/ronda-skeletons"
import { requireAdminContext } from "@/lib/auth/guards"
import { getJakartaTodayIsoDate } from "@/lib/finance/types"
import { getAdminRondaScheduleDetail } from "@/lib/ronda/queries"
import { canManageRonda, canReadAllRondaAttendance } from "@/lib/ronda/types"

type DetailParams = Promise<{ id: string }>
type DetailSearchParams = Promise<{
  notice?: string
}>

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function RondaDetailContent({
  params,
  searchParams,
}: {
  params: DetailParams
  searchParams: DetailSearchParams
}) {
  const [{ tenant }, { id }, resolvedSearch] = await Promise.all([
    requireAdminContext(),
    params,
    searchParams,
  ])

  if (!UUID_REGEX.test(id)) {
    notFound()
  }

  const todayDate = getJakartaTodayIsoDate()
  const detail = await getAdminRondaScheduleDetail({
    tenantId: tenant.tenantId,
    roles: tenant.roles,
    scheduleId: id,
  })

  if (!detail) {
    notFound()
  }

  return (
    <RondaAdminDetailView
      tenantId={tenant.tenantId}
      scheduleId={id}
      canManage={canManageRonda(tenant.roles)}
      canReadAttendance={canReadAllRondaAttendance(tenant.roles)}
      todayDate={todayDate}
      initialSchedule={detail}
      notice={resolvedSearch.notice === "readonly" ? "readonly" : null}
    />
  )
}

export default function RondaDetailPage({
  params,
  searchParams,
}: {
  params: DetailParams
  searchParams: DetailSearchParams
}) {
  return (
    <Suspense fallback={<RondaDetailSkeleton />}>
      <RondaDetailContent params={params} searchParams={searchParams} />
    </Suspense>
  )
}
