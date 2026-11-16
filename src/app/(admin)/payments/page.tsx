import { Suspense } from "react"

import { FinanceDirectorySkeleton } from "@/components/finance/finance-skeletons"
import { PaymentQueueView } from "@/components/finance/payment-queue-view"
import { TreasurerOnlyView } from "@/components/finance/treasurer-only-view"
import { requireAdminContext } from "@/lib/auth/guards"
import { getPaymentVerificationQueue } from "@/lib/finance/queries"
import { canManageBills } from "@/lib/finance/types"

type PaymentsSearchParams = Promise<{
  status?: string
  method?: string
  q?: string
  page?: string
}>

async function PaymentsQueueContent({
  searchParams,
}: {
  searchParams: PaymentsSearchParams
}) {
  const { tenant } = await requireAdminContext()

  if (!canManageBills(tenant.roles)) {
    return <TreasurerOnlyView />
  }

  const resolved = await searchParams
  const status = typeof resolved.status === "string" ? resolved.status : "pending"
  const method = typeof resolved.method === "string" ? resolved.method : "all"
  const search = typeof resolved.q === "string" ? resolved.q : ""
  const parsedPage = Number.parseInt(
    typeof resolved.page === "string" ? resolved.page : "1",
    10
  )
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1

  const queue = await getPaymentVerificationQueue({
    tenantId: tenant.tenantId,
    status,
    method,
    search,
    page,
    pageSize: 10,
  })

  return (
    <PaymentQueueView
      items={queue.items}
      totalCount={queue.totalCount}
      page={queue.page}
      pageSize={queue.pageSize}
      totalPages={queue.totalPages}
      counts={queue.counts}
      incomeCategories={queue.incomeCategories}
      recentIncomeTransactions={queue.recentIncomeTransactions}
      filters={{
        status,
        method,
        search,
      }}
      error={queue.error}
    />
  )
}

export default function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: PaymentsSearchParams
}) {
  return (
    <Suspense fallback={<FinanceDirectorySkeleton />}>
      <PaymentsQueueContent searchParams={searchParams} />
    </Suspense>
  )
}

