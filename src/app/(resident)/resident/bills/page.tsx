import { Suspense } from "react"

import { ResidentBillsSkeleton } from "@/components/finance/finance-skeletons"
import { ResidentBillsListView } from "@/components/finance/resident-bills-views"
import { requireResidentContext } from "@/lib/auth/guards"
import { getResidentBillsPortal } from "@/lib/finance/queries"

async function ResidentBillsContent() {
  const { tenant } = await requireResidentContext()
  const portal = await getResidentBillsPortal(tenant.tenantId)

  return (
    <ResidentBillsListView
      tenantName={tenant.tenantName}
      items={portal.items}
      outstandingCount={portal.outstandingCount}
      overdueCount={portal.overdueCount}
      totalOutstandingAmount={portal.totalOutstandingAmount}
      error={portal.error}
    />
  )
}

export default function ResidentBillsPage() {
  return (
    <Suspense fallback={<ResidentBillsSkeleton />}>
      <ResidentBillsContent />
    </Suspense>
  )
}

