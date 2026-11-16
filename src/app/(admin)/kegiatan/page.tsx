import { Suspense } from "react"
import { redirect } from "next/navigation"

import { ActivitiesAdminListSkeleton } from "@/components/activities/activities-skeletons"
import { ActivitiesAdminListView } from "@/components/activities/activities-admin-list-view"
import { requireAdminContext } from "@/lib/auth/guards"
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_STATUSES,
} from "@/lib/activities/constants"
import { listAdminActivities } from "@/lib/activities/queries"
import {
  canReadActivitiesAdmin,
  type ActivityCategory,
  type ActivityPageResult,
  type ActivitySortDirection,
  type ActivitySortField,
  type ActivityStatus,
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

function parseSortBy(raw: string): ActivitySortField {
  if (raw === "created_at" || raw === "updated_at") return raw
  return "start_at"
}

function parseSort(raw: string): ActivitySortDirection {
  return raw === "desc" ? "desc" : "asc"
}

function parsePage(raw: string): number {
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 1 ? n : 1
}

async function ActivitiesAdminListContent({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const [{ ctx, tenant }, params] = await Promise.all([
    requireAdminContext(),
    searchParams,
  ])

  if (!canReadActivitiesAdmin(tenant.roles)) {
    redirect("/no-access")
  }

  const search = pickFirst(params.q).trim()
  const status = parseStatus(pickFirst(params.status))
  const category = parseCategory(pickFirst(params.category))
  const upcomingOnly = pickFirst(params.upcoming) === "1"
  const includeDeleted = pickFirst(params.deletedList) === "1"
  const sortBy = parseSortBy(pickFirst(params.sortBy))
  const sort = parseSort(pickFirst(params.sort))
  const page = parsePage(pickFirst(params.page))

  let initialData: ActivityPageResult | null = null
  let initialError: string | null = null

  try {
    initialData = await listAdminActivities({
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      filters: {
        search: search || undefined,
        status: status === "all" ? undefined : status,
        category: category === "all" ? undefined : category,
        upcomingOnly: upcomingOnly ? true : undefined,
        includeDeleted: includeDeleted ? true : undefined,
        sortBy,
        sort,
        page,
      },
    })
  } catch (err) {
    initialError =
      err instanceof Error ? err.message : "Gagal memuat daftar kegiatan warga."
  }

  const notice = pickFirst(params.deleted) === "1" ? "deleted" : null

  return (
    <ActivitiesAdminListView
      tenantId={tenant.tenantId}
      actorKey={ctx.user.id}
      roles={tenant.roles}
      initialFilters={{
        search,
        status,
        category,
        upcomingOnly,
        includeDeleted,
        sortBy,
        sort,
        page,
      }}
      initialData={initialData}
      initialError={initialError}
      notice={notice}
    />
  )
}

export default function AdminActivitiesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <Suspense fallback={<ActivitiesAdminListSkeleton />}>
      <ActivitiesAdminListContent searchParams={searchParams} />
    </Suspense>
  )
}

