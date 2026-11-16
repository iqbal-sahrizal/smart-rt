import { Suspense } from "react"

import { ResidentActivitiesListSkeleton } from "@/components/activities/resident-activities-skeletons"
import { ResidentActivitiesListView } from "@/components/activities/resident-activities-list-view"
import { requireResidentContext } from "@/lib/auth/guards"
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_STATUSES,
} from "@/lib/activities/constants"
import { listResidentActivities } from "@/lib/activities/queries"
import type {
  ActivityCategory,
  ActivitySortDirection,
  ActivitySortField,
  ActivityStatus,
  ResidentActivityPageResult,
} from "@/lib/activities/types"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function pickFirst(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ""
  return value ?? ""
}

function parseStatus(raw: string): "all" | ActivityStatus {
  return (ACTIVITY_STATUSES as readonly string[]).includes(raw)
    ? (raw as ActivityStatus)
    : "all"
}

function parseCategory(raw: string): "all" | ActivityCategory {
  return (ACTIVITY_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as ActivityCategory)
    : "all"
}

function parseSort(raw: string): ActivitySortDirection {
  return raw === "desc" ? "desc" : "asc"
}

function parsePage(raw: string): number {
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 1 ? n : 1
}

async function ResidentActivitiesContent({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const [{ ctx, tenant }, params] = await Promise.all([
    requireResidentContext(),
    searchParams,
  ])

  const search = pickFirst(params.q).trim()
  const status = parseStatus(pickFirst(params.status))
  const category = parseCategory(pickFirst(params.category))
  const upcomingOnly = pickFirst(params.upcoming) === "1"
  const sortBy: ActivitySortField = "start_at"
  const sort = parseSort(pickFirst(params.sort))
  const page = parsePage(pickFirst(params.page))

  let initialData: ResidentActivityPageResult | null = null
  let initialError: string | null = null

  try {
    initialData = await listResidentActivities({
      tenantId: tenant.tenantId,
      residentId: tenant.residentId,
      filters: {
        search: search || undefined,
        status: status === "all" ? undefined : status,
        category: category === "all" ? undefined : category,
        upcomingOnly: upcomingOnly ? true : undefined,
        sortBy,
        sort,
        page,
      },
    })
  } catch (err) {
    initialError =
      err instanceof Error ? err.message : "Gagal memuat daftar kegiatan warga."
  }

  return (
    <ResidentActivitiesListView
      tenantId={tenant.tenantId}
      actorKey={ctx.user.id}
      initialFilters={{
        search,
        status,
        category,
        upcomingOnly,
        sortBy,
        sort,
        page,
      }}
      initialData={initialData}
      initialError={initialError}
    />
  )
}

export default function ResidentActivitiesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <Suspense fallback={<ResidentActivitiesListSkeleton />}>
      <ResidentActivitiesContent searchParams={searchParams} />
    </Suspense>
  )
}

