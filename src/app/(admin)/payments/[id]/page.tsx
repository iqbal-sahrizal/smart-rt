import { Suspense } from "react"
import { notFound } from "next/navigation"

import { FinanceDetailSkeleton } from "@/components/finance/finance-skeletons"
import { PaymentDetailView } from "@/components/finance/payment-detail-view"
import { TreasurerOnlyView } from "@/components/finance/treasurer-only-view"
import { requireAdminContext } from "@/lib/auth/guards"
import { getPaymentDetail } from "@/lib/finance/queries"
import { canManageBills } from "@/lib/finance/types"

type DetailParams = Promise<{ id: string }>
type DetailSearchParams = Promise<{
  verified?: string
  rejected?: string
  refunded?: string
}>

async function PaymentDetailContent({
  params,
  searchParams,
}: {
  params: DetailParams
  searchParams: DetailSearchParams
}) {
  const { tenant } = await requireAdminContext()

  if (!canManageBills(tenant.roles)) {
    return <TreasurerOnlyView title="Detail Pembayaran" />
  }

  const [{ id }, resolvedSearch] = await Promise.all([params, searchParams])
  const detail = await getPaymentDetail({
    tenantId: tenant.tenantId,
    paymentId: id,
  })

  if (!detail) {
    notFound()
  }

  const notice =
    resolvedSearch.verified === "1"
      ? "verified"
      : resolvedSearch.rejected === "1"
        ? "rejected"
        : resolvedSearch.refunded === "1"
          ? "refunded"
          : null

  return <PaymentDetailView data={detail} notice={notice} />
}

export default function AdminPaymentDetailPage({
  params,
  searchParams,
}: {
  params: DetailParams
  searchParams: DetailSearchParams
}) {
  return (
    <Suspense fallback={<FinanceDetailSkeleton />}>
      <PaymentDetailContent params={params} searchParams={searchParams} />
    </Suspense>
  )
}

