import { Suspense } from "react"

import { RondaAdminListView } from "@/components/ronda/ronda-admin-list-view"
import { RondaListSkeleton } from "@/components/ronda/ronda-skeletons"
import { requireAdminContext } from "@/lib/auth/guards"
import { getJakartaTodayIsoDate } from "@/lib/finance/types"
import {
  getMonthDateRange,
  getMonthKeyFromDate,
  isValidMonthKey,
} from "@/lib/ronda/formatters"
import { listAdminRondaSchedules } from "@/lib/ronda/queries"
import { isValidCalendarDate } from "@/lib/ronda/schemas"
import {
  canManageRonda,
  canReadAllRondaAttendance,
  type RondaSchedulePageResult,
} from "@/lib/ronda/types"

type SearchParams = Promise<{
  fromDate?: string
  toDate?: string
  month?: string
  page?: string
  deleted?: string
  notice?: string
}>

async function RondaListContent({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const [{ tenant }, params] = await Promise.all([
    requireAdminContext(),
    searchParams,
  ])

  const todayDate = getJakartaTodayIsoDate()
  const defaultMonth = getMonthKeyFromDate(todayDate)
  const viewMonth =
    params.month && isValidMonthKey(params.month) ? params.month : defaultMonth

  const hasExplicitFrom = Boolean(
    params.fromDate && isValidCalendarDate(params.fromDate)
  )
  const hasExplicitTo = Boolean(
    params.toDate && isValidCalendarDate(params.toDate)
  )

  const monthRange = getMonthDateRange(viewMonth)
  const fromDate = hasExplicitFrom
    ? params.fromDate!
    : hasExplicitTo
      ? ""
      : monthRange.fromDate
  const toDate = hasExplicitTo
    ? params.toDate!
    : hasExplicitFrom
      ? ""
      : monthRange.toDate

  const parsedPage = Number.parseInt(params.page ?? "1", 10)
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1

  let initialData: RondaSchedulePageResult | null = null
  let initialError: string | null = null

  try {
    initialData = await listAdminRondaSchedules({
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      filters: {
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        page,
        pageSize: 20,
      },
    })
  } catch (err) {
    initialError =
      err instanceof Error ? err.message : "Gagal memuat daftar jadwal ronda."
  }

  const notice =
    params.deleted === "1"
      ? "deleted"
      : params.notice === "readonly"
        ? "readonly"
        : null

  return (
    <RondaAdminListView
      tenantId={tenant.tenantId}
      canManage={canManageRonda(tenant.roles)}
      canReadAttendanceSummary={canReadAllRondaAttendance(tenant.roles)}
      todayDate={todayDate}
      initialFilters={{
        fromDate,
        toDate,
        page,
        viewMonth,
      }}
      initialData={initialData}
      initialError={initialError}
      notice={notice}
    />
  )
}

export default function RondaPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <Suspense fallback={<RondaListSkeleton />}>
      <RondaListContent searchParams={searchParams} />
    </Suspense>
  )
}
