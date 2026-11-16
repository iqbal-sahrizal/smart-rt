import { Suspense } from "react"

import { BillDirectoryView } from "@/components/finance/bill-directory-view"
import { FinanceDirectorySkeleton } from "@/components/finance/finance-skeletons"
import { requireAdminContext } from "@/lib/auth/guards"
import { getBillsDirectory } from "@/lib/finance/queries"
import { canManageBills } from "@/lib/finance/types"

type BillsSearchParams = Promise<{
  q?: string
  status?: string
  dueId?: string
  year?: string
  month?: string
  page?: string
}>

async function BillsDirectoryContent({
  searchParams,
}: {
  searchParams: BillsSearchParams
}) {
  const { tenant } = await requireAdminContext()
  const resolved = await searchParams

  const search = typeof resolved.q === "string" ? resolved.q : ""
  const status = typeof resolved.status === "string" ? resolved.status : "all"
  const dueId = typeof resolved.dueId === "string" ? resolved.dueId : "all"
  const periodYear = typeof resolved.year === "string" ? resolved.year : "all"
  const periodMonth = typeof resolved.month === "string" ? resolved.month : "all"
  const parsedPage = Number.parseInt(
    typeof resolved.page === "string" ? resolved.page : "1",
    10
  )
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1

  const parsedYear =
    periodYear !== "all" && /^\d{4}$/.test(periodYear)
      ? Number.parseInt(periodYear, 10)
      : undefined
  const parsedMonth =
    periodMonth !== "all" && /^\d{1,2}$/.test(periodMonth)
      ? Number.parseInt(periodMonth, 10)
      : undefined

  const directory = await getBillsDirectory({
    tenantId: tenant.tenantId,
    search,
    status: status === "all" ? undefined : status,
    dueId: dueId === "all" ? undefined : dueId,
    periodYear: parsedYear,
    periodMonth: parsedMonth,
    page,
    pageSize: 10,
  })

  return (
    <BillDirectoryView
      items={directory.items}
      totalCount={directory.totalCount}
      page={directory.page}
      pageSize={directory.pageSize}
      totalPages={directory.totalPages}
      dueOptions={directory.dueOptions}
      canManageBills={canManageBills(tenant.roles)}
      filters={{
        search,
        status,
        dueId,
        periodYear,
        periodMonth,
      }}
      error={directory.error}
    />
  )
}

export default function AdminBillsPage({
  searchParams,
}: {
  searchParams: BillsSearchParams
}) {
  return (
    <Suspense fallback={<FinanceDirectorySkeleton />}>
      <BillsDirectoryContent searchParams={searchParams} />
    </Suspense>
  )
}

