import { Suspense } from "react"

import { ResidentDirectoryView } from "@/components/residents/resident-directory-view"
import { ResidentsDirectorySkeleton } from "@/components/residents/resident-skeletons"
import { requireAdminContext } from "@/lib/auth/guards"
import { getAdminResidentsDirectory } from "@/lib/residents/queries"
import { canManageResidents } from "@/lib/residents/types"

type DirectorySearchParams = Promise<{
  q?: string
  status?: string
  householdId?: string
  page?: string
  archived?: string
}>

async function ResidentsDirectoryContent({
  searchParams,
}: {
  searchParams: DirectorySearchParams
}) {
  const { tenant } = await requireAdminContext()
  const resolved = await searchParams

  const search = typeof resolved.q === "string" ? resolved.q : ""
  const status = typeof resolved.status === "string" ? resolved.status : "all"
  const householdId =
    typeof resolved.householdId === "string" ? resolved.householdId : "all"
  const parsedPage = Number.parseInt(
    typeof resolved.page === "string" ? resolved.page : "1",
    10
  )
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1

  const directory = await getAdminResidentsDirectory({
    tenantId: tenant.tenantId,
    search,
    status: status === "all" ? undefined : status,
    householdId: householdId === "all" ? undefined : householdId,
    page,
    pageSize: 10,
  })

  return (
    <ResidentDirectoryView
      items={directory.items}
      totalCount={directory.totalCount}
      page={directory.page}
      pageSize={directory.pageSize}
      totalPages={directory.totalPages}
      householdOptions={directory.householdOptions}
      selectedHousehold={directory.selectedHousehold}
      selectedHouseholdMembers={directory.selectedHouseholdMembers}
      canManage={canManageResidents(tenant.roles)}
      filters={{
        search,
        status,
        householdId,
      }}
      error={directory.error}
      archivedNotice={resolved.archived === "1"}
    />
  )
}

export default function AdminResidentsPage({
  searchParams,
}: {
  searchParams: DirectorySearchParams
}) {
  return (
    <Suspense fallback={<ResidentsDirectorySkeleton />}>
      <ResidentsDirectoryContent searchParams={searchParams} />
    </Suspense>
  )
}
