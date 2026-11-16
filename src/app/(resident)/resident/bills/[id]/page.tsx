import { Suspense } from "react"
import { notFound } from "next/navigation"

import { ResidentBillsSkeleton } from "@/components/finance/finance-skeletons"
import { ResidentBillDetailView } from "@/components/finance/resident-bills-views"
import { requireResidentContext } from "@/lib/auth/guards"
import { getResidentBillDetail } from "@/lib/finance/queries"

type DetailParams = Promise<{ id: string }>
type DetailSearchParams = Promise<{ submitted?: string }>

async function ResidentBillDetailContent({
  params,
  searchParams,
}: {
  params: DetailParams
  searchParams: DetailSearchParams
}) {
  const { tenant } = await requireResidentContext()
  const [{ id }, resolvedSearch] = await Promise.all([params, searchParams])

  const detail = await getResidentBillDetail({
    tenantId: tenant.tenantId,
    billId: id,
  })

  if (!detail) {
    notFound()
  }

  return (
    <ResidentBillDetailView
      tenantName={tenant.tenantName}
      bill={detail.bill}
      payments={detail.payments}
      notice={resolvedSearch.submitted === "1" ? "submitted" : null}
    />
  )
}

export default function ResidentBillDetailPage({
  params,
  searchParams,
}: {
  params: DetailParams
  searchParams: DetailSearchParams
}) {
  return (
    <Suspense fallback={<ResidentBillsSkeleton />}>
      <ResidentBillDetailContent params={params} searchParams={searchParams} />
    </Suspense>
  )
}

