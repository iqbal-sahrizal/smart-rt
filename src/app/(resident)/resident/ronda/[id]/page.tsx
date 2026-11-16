import { Suspense } from "react"
import { notFound } from "next/navigation"

import { RondaResidentDetailView } from "@/components/ronda/ronda-resident-views"
import { ResidentRondaSkeleton } from "@/components/ronda/ronda-skeletons"
import { requireResidentContext } from "@/lib/auth/guards"
import { getJakartaTodayIsoDate } from "@/lib/finance/types"
import {
  getMyRondaAttendance,
  getResidentRondaScheduleDetail,
} from "@/lib/ronda/queries"

type DetailParams = Promise<{ id: string }>

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function ResidentRondaDetailContent({
  params,
}: {
  params: DetailParams
}) {
  const [{ tenant }, { id }] = await Promise.all([
    requireResidentContext(),
    params,
  ])

  if (!UUID_REGEX.test(id)) {
    notFound()
  }

  const todayDate = getJakartaTodayIsoDate()

  const [detail, myAttendance] = await Promise.all([
    getResidentRondaScheduleDetail({
      tenantId: tenant.tenantId,
      scheduleId: id,
    }),
    getMyRondaAttendance({
      tenantId: tenant.tenantId,
      scheduleId: id,
    }),
  ])

  if (!detail) {
    notFound()
  }

  return (
    <RondaResidentDetailView
      tenantId={tenant.tenantId}
      scheduleId={id}
      todayDate={todayDate}
      initialSchedule={detail}
      initialMyAttendance={myAttendance[0] ?? detail.myAttendance ?? null}
    />
  )
}

export default function ResidentRondaDetailPage({
  params,
}: {
  params: DetailParams
}) {
  return (
    <Suspense fallback={<ResidentRondaSkeleton />}>
      <ResidentRondaDetailContent params={params} />
    </Suspense>
  )
}
