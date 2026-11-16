import { Suspense } from "react"
import { notFound } from "next/navigation"

import { BillDetailView } from "@/components/finance/bill-detail-view"
import { FinanceDetailSkeleton } from "@/components/finance/finance-skeletons"
import { requireAdminContext } from "@/lib/auth/guards"
import { getBillDetail } from "@/lib/finance/queries"
import { canManageBills } from "@/lib/finance/types"

type DetailParams = Promise<{ id: string }>
type DetailSearchParams = Promise<{
  created?: string
  updated?: string
  cancelled?: string
}>

async function BillDetailContent({
  params,
  searchParams,
}: {
  params: DetailParams
  searchParams: DetailSearchParams
}) {
  const { tenant } = await requireAdminContext()
  const [{ id }, resolvedSearch] = await Promise.all([params, searchParams])

  const detail = await getBillDetail({
    tenantId: tenant.tenantId,
    billId: id,
  })

  if (!detail) {
    notFound()
  }

  const notice =
    resolvedSearch.created === "1"
      ? "created"
      : resolvedSearch.updated === "1"
        ? "updated"
        : resolvedSearch.cancelled === "1"
          ? "cancelled"
          : null

  return (
    <BillDetailView
      bill={detail.bill}
      payments={detail.payments}
      canManageBills={canManageBills(tenant.roles)}
      notice={notice}
    />
  )
}

export default function BillDetailPage({
  params,
  searchParams,
}: {
  params: DetailParams
  searchParams: DetailSearchParams
}) {
  return (
    <Suspense fallback={<FinanceDetailSkeleton />}>
      <BillDetailContent params={params} searchParams={searchParams} />
    </Suspense>
  )
}
