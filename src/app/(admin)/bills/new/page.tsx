import { Suspense } from "react"
import { redirect } from "next/navigation"

import { BillCreateViews } from "@/components/finance/bill-create-views"
import { FinanceFormSkeleton } from "@/components/finance/finance-skeletons"
import { requireAdminContext } from "@/lib/auth/guards"
import { getBillFormOptions } from "@/lib/finance/queries"
import { canManageBills } from "@/lib/finance/types"

type NewBillSearchParams = Promise<{
  dueId?: string
}>

async function NewBillContent({
  searchParams,
}: {
  searchParams: NewBillSearchParams
}) {
  const { tenant } = await requireAdminContext()

  if (!canManageBills(tenant.roles)) {
    redirect("/bills")
  }

  const [resolved, options] = await Promise.all([
    searchParams,
    getBillFormOptions(tenant.tenantId),
  ])

  return (
    <BillCreateViews
      dues={options.dues}
      households={options.households}
      residents={options.residents}
      existingBillKeys={options.existingBillKeys}
      initialDueId={
        typeof resolved.dueId === "string" ? resolved.dueId : undefined
      }
    />
  )
}

export default function NewBillPage({
  searchParams,
}: {
  searchParams: NewBillSearchParams
}) {
  return (
    <Suspense fallback={<FinanceFormSkeleton />}>
      <NewBillContent searchParams={searchParams} />
    </Suspense>
  )
}

