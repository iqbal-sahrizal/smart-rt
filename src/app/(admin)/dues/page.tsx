import { Suspense } from "react"

import { DuesDirectoryView } from "@/components/finance/dues-directory-view"
import { FinanceDirectorySkeleton } from "@/components/finance/finance-skeletons"
import { requireAdminContext } from "@/lib/auth/guards"
import { getDuesDirectory } from "@/lib/finance/queries"
import { canManageBills, canManageDues } from "@/lib/finance/types"

type DuesSearchParams = Promise<{
  q?: string
  cycle?: string
  scope?: string
  active?: string
  page?: string
  deleted?: string
}>

async function DuesDirectoryContent({
  searchParams,
}: {
  searchParams: DuesSearchParams
}) {
  const { tenant } = await requireAdminContext()
  const resolved = await searchParams

  const search = typeof resolved.q === "string" ? resolved.q : ""
  const billingCycle =
    typeof resolved.cycle === "string" ? resolved.cycle : "all"
  const targetScope =
    typeof resolved.scope === "string" ? resolved.scope : "all"
  const activeFilter =
    typeof resolved.active === "string" ? resolved.active : "all"
  const parsedPage = Number.parseInt(
    typeof resolved.page === "string" ? resolved.page : "1",
    10
  )
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1

  const directory = await getDuesDirectory({
    tenantId: tenant.tenantId,
    search,
    billingCycle: billingCycle === "all" ? undefined : billingCycle,
    targetScope: targetScope === "all" ? undefined : targetScope,
    activeFilter: activeFilter === "all" ? undefined : activeFilter,
    page,
    pageSize: 10,
  })

  return (
    <DuesDirectoryView
      items={directory.items}
      totalCount={directory.totalCount}
      page={directory.page}
      pageSize={directory.pageSize}
      totalPages={directory.totalPages}
      canManage={canManageDues(tenant.roles)}
      canManageBills={canManageBills(tenant.roles)}
      filters={{
        search,
        billingCycle,
        targetScope,
        activeFilter,
      }}
      error={directory.error}
      deletedNotice={resolved.deleted === "1"}
    />
  )
}

export default function AdminDuesPage({
  searchParams,
}: {
  searchParams: DuesSearchParams
}) {
  return (
    <Suspense fallback={<FinanceDirectorySkeleton />}>
      <DuesDirectoryContent searchParams={searchParams} />
    </Suspense>
  )
}

