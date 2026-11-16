import { Suspense } from "react"

import { RondaResidentListView } from "@/components/ronda/ronda-resident-views"
import { ResidentRondaSkeleton } from "@/components/ronda/ronda-skeletons"
import { requireResidentContext } from "@/lib/auth/guards"
import { getJakartaTodayIsoDate } from "@/lib/finance/types"
import {
  getMyRondaAttendance,
  listResidentRondaSchedules,
} from "@/lib/ronda/queries"
import type {
  RondaMyAttendanceRecord,
  RondaSchedulePageResult,
} from "@/lib/ronda/types"

async function ResidentRondaContent() {
  const { tenant } = await requireResidentContext()
  const todayDate = getJakartaTodayIsoDate()

  let initialSchedules: RondaSchedulePageResult | null = null
  let initialMyAttendance: RondaMyAttendanceRecord[] = []
  let initialError: string | null = null

  try {
    const [schedules, myAttendance] = await Promise.all([
      listResidentRondaSchedules({
        tenantId: tenant.tenantId,
        filters: {
          fromDate: todayDate,
          page: 1,
          pageSize: 20,
        },
      }),
      getMyRondaAttendance({
        tenantId: tenant.tenantId,
      }),
    ])
    initialSchedules = schedules
    initialMyAttendance = myAttendance
  } catch (err) {
    initialError =
      err instanceof Error ? err.message : "Gagal memuat jadwal ronda."
  }

  return (
    <RondaResidentListView
      tenantId={tenant.tenantId}
      todayDate={todayDate}
      initialSchedules={initialSchedules}
      initialMyAttendance={initialMyAttendance}
      initialError={initialError}
    />
  )
}

export default function ResidentRondaPage() {
  return (
    <Suspense fallback={<ResidentRondaSkeleton />}>
      <ResidentRondaContent />
    </Suspense>
  )
}
