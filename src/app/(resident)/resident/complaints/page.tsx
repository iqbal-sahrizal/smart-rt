import { Suspense } from "react"

import { ResidentComplaintsListSkeleton } from "@/components/complaints/complaints-skeletons"
import { ResidentComplaintsListView } from "@/components/complaints/resident-complaints-list-view"
import { requireResidentContext } from "@/lib/auth/guards"
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_STATUSES,
} from "@/lib/complaints/constants"
import { listResidentComplaints } from "@/lib/complaints/queries"
import type {
  ComplaintCategory,
  ComplaintPageResult,
  ComplaintStatus,
} from "@/lib/complaints/types"

type SearchParams = Promise<{
  q?: string
  status?: string
  category?: string
  page?: string
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

async function ResidentComplaintsContent({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const [{ ctx, tenant }, params] = await Promise.all([
    requireResidentContext(),
    searchParams,
  ])

  const search = typeof params.q === "string" ? params.q.trim() : ""
  const status = parseEnumFilter<ComplaintStatus>(
    params.status,
    COMPLAINT_STATUSES
  )
  const category = parseEnumFilter<ComplaintCategory>(
    params.category,
    COMPLAINT_CATEGORIES
  )

  const parsedPage = Number.parseInt(
    typeof params.page === "string" ? params.page : "1",
    10
  )
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1

  let initialData: ComplaintPageResult | null = null
  let initialError: string | null = null

  try {
    initialData = await listResidentComplaints({
      tenantId: tenant.tenantId,
      memberId: tenant.memberId,
      filters: {
        search: search || undefined,
        status: status === "all" ? undefined : status,
        category: category === "all" ? undefined : category,
        page,
        pageSize: 10,
      },
    })
  } catch (err) {
    initialError =
      err instanceof Error ? err.message : "Gagal memuat pengaduan Anda."
  }

  return (
    <ResidentComplaintsListView
      tenantId={tenant.tenantId}
      actorKey={ctx.user.id}
      initialFilters={{
        search,
        status,
        category,
        page,
      }}
      initialData={initialData}
      initialError={initialError}
    />
  )
}

export default function ResidentComplaintsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <Suspense fallback={<ResidentComplaintsListSkeleton />}>
      <ResidentComplaintsContent searchParams={searchParams} />
    </Suspense>
  )
}

