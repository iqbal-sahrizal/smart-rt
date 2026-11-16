import { Suspense } from "react"
import { redirect } from "next/navigation"

import { ComplaintsAdminListView } from "@/components/complaints/complaints-admin-list-view"
import { ComplaintsAdminListSkeleton } from "@/components/complaints/complaints-skeletons"
import { requireAdminContext } from "@/lib/auth/guards"
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_PRIORITIES,
  COMPLAINT_STATUSES,
} from "@/lib/complaints/constants"
import { listAdminComplaints } from "@/lib/complaints/queries"
import {
  canReadComplaintsAdmin,
  type ComplaintCategory,
  type ComplaintPageResult,
  type ComplaintPriority,
  type ComplaintStatus,
} from "@/lib/complaints/types"

type SearchParams = Promise<{
  q?: string
  status?: string
  category?: string
  priority?: string
  page?: string
  deleted?: string
}>

function parseEnumFilter<T extends string>(
  raw: string | undefined,
  allowed: readonly T[]
): "all" | T {
  if (raw && (allowed as readonly string[]).includes(raw)) {
    return raw as T
  }
  return "all"
}

async function ComplaintsAdminListContent({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const [{ ctx, tenant }, params] = await Promise.all([
    requireAdminContext(),
    searchParams,
  ])

  if (!canReadComplaintsAdmin(tenant.roles)) {
    redirect("/no-access")
  }

  const search = typeof params.q === "string" ? params.q.trim() : ""
  const status = parseEnumFilter<ComplaintStatus>(
    params.status,
    COMPLAINT_STATUSES
  )
  const category = parseEnumFilter<ComplaintCategory>(
    params.category,
    COMPLAINT_CATEGORIES
  )
  const priority = parseEnumFilter<ComplaintPriority>(
    params.priority,
    COMPLAINT_PRIORITIES
  )

  const parsedPage = Number.parseInt(
    typeof params.page === "string" ? params.page : "1",
    10
  )
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1

  let initialData: ComplaintPageResult | null = null
  let initialError: string | null = null

  try {
    initialData = await listAdminComplaints({
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      filters: {
        search: search || undefined,
        status: status === "all" ? undefined : status,
        category: category === "all" ? undefined : category,
        priority: priority === "all" ? undefined : priority,
        page,
        pageSize: 10,
      },
    })
  } catch (err) {
    initialError =
      err instanceof Error ? err.message : "Gagal memuat daftar pengaduan."
  }

  return (
    <ComplaintsAdminListView
      tenantId={tenant.tenantId}
      actorKey={ctx.user.id}
      roles={tenant.roles}
      initialFilters={{
        search,
        status,
        category,
        priority,
        page,
      }}
      initialData={initialData}
      initialError={initialError}
      deletedNotice={params.deleted === "1"}
    />
  )
}

export default function AdminComplaintsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <Suspense fallback={<ComplaintsAdminListSkeleton />}>
      <ComplaintsAdminListContent searchParams={searchParams} />
    </Suspense>
  )
}
