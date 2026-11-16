import { Suspense } from "react"
import { redirect } from "next/navigation"

import { RondaAttendanceSummaryView } from "@/components/ronda/ronda-attendance-summary-view"
import { RondaListSkeleton } from "@/components/ronda/ronda-skeletons"
import { requireAdminContext } from "@/lib/auth/guards"
import { getJakartaTodayIsoDate } from "@/lib/finance/types"
import { getMonthDateRange, getMonthKeyFromDate } from "@/lib/ronda/formatters"
import { listAdminRondaAttendance } from "@/lib/ronda/queries"
import { isValidCalendarDate } from "@/lib/ronda/schemas"
import {
  canReadAllRondaAttendance,
  type RondaAttendanceAdminRecord,
} from "@/lib/ronda/types"

type SearchParams = Promise<{
  fromDate?: string
  toDate?: string
}>

async function RondaAttendanceContent({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const [{ tenant }, params] = await Promise.all([
    requireAdminContext(),
    searchParams,
  ])

  if (!canReadAllRondaAttendance(tenant.roles)) {
    redirect("/ronda?notice=readonly")
  }

  const todayDate = getJakartaTodayIsoDate()
  const defaultRange = getMonthDateRange(getMonthKeyFromDate(todayDate))

  const fromDate =
    params.fromDate && isValidCalendarDate(params.fromDate)
      ? params.fromDate
      : defaultRange.fromDate
  const toDate =
    params.toDate && isValidCalendarDate(params.toDate)
      ? params.toDate
      : defaultRange.toDate

  let initialRecords: RondaAttendanceAdminRecord[] = []
  let initialError: string | null = null

  try {
    initialRecords = await listAdminRondaAttendance({
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      fromDate,
      toDate,
    })
  } catch (err) {
    initialError =
      err instanceof Error ? err.message : "Gagal memuat rekap kehadiran ronda."
  }

  return (
    <RondaAttendanceSummaryView
      tenantId={tenant.tenantId}
      initialFilters={{ fromDate, toDate }}
      initialRecords={initialRecords}
      initialError={initialError}
    />
  )
}

export default function RondaAttendancePage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <Suspense fallback={<RondaListSkeleton />}>
      <RondaAttendanceContent searchParams={searchParams} />
    </Suspense>
  )
}
