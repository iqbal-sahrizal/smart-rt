import { Suspense } from "react"

import { ResidentActivitiesHistorySkeleton } from "@/components/activities/resident-activities-skeletons"
import { ResidentMyActivitiesView } from "@/components/activities/resident-my-activities-view"
import { requireResidentContext } from "@/lib/auth/guards"
import { listResidentActivityHistory } from "@/lib/activities/queries"
import type { ResidentActivityHistoryPageResult } from "@/lib/activities/types"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function parsePage(raw: string | string[] | undefined): number {
  const val = Array.isArray(raw) ? raw[0] : raw
  const n = Number.parseInt(val ?? "1", 10)
  return Number.isFinite(n) && n >= 1 ? n : 1
}

async function ResidentMyActivitiesContent({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const [{ ctx, tenant }, params] = await Promise.all([
    requireResidentContext(),
    searchParams,
  ])

  const page = parsePage(params.page)
  let initialData: ResidentActivityHistoryPageResult | null = null
  let initialError: string | null = null

  try {
    initialData = await listResidentActivityHistory({
      tenantId: tenant.tenantId,
      residentId: tenant.residentId,
      page,
      pageSize: 20,
    })
  } catch (err) {
    initialError =
      err instanceof Error
        ? err.message
        : "Gagal memuat riwayat kegiatan Anda."
  }

  return (
    <ResidentMyActivitiesView
      tenantId={tenant.tenantId}
      actorKey={ctx.user.id}
      initialPage={page}
      initialData={initialData}
      initialError={initialError}
    />
  )
}

export default function ResidentMyActivitiesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <Suspense fallback={<ResidentActivitiesHistorySkeleton />}>
      <ResidentMyActivitiesContent searchParams={searchParams} />
    </Suspense>
  )
}

