import { Suspense } from "react"
import { notFound, redirect } from "next/navigation"

import { DuesForm } from "@/components/finance/dues-form"
import { FinanceFormSkeleton } from "@/components/finance/finance-skeletons"
import { requireAdminContext } from "@/lib/auth/guards"
import { getDuesDetail } from "@/lib/finance/queries"
import { canManageDues } from "@/lib/finance/types"

type EditParams = Promise<{ id: string }>

async function EditDuesContent({ params }: { params: EditParams }) {
  const { tenant } = await requireAdminContext()
  const { id } = await params

  if (!canManageDues(tenant.roles)) {
    redirect(`/dues/${id}?notice=readonly`)
  }

  const due = await getDuesDetail({
    tenantId: tenant.tenantId,
    dueId: id,
  })

  if (!due) {
    notFound()
  }

  return (
    <DuesForm
      mode="edit"
      initialValues={{
        dueId: due.id,
        name: due.name,
        description: due.description,
        amount: due.amount,
        billingCycle: due.billingCycle,
        targetScope: due.targetScope,
        isActive: due.isActive,
        billCount: due.billCount ?? 0,
      }}
    />
  )
}

export default function EditDuesPage({ params }: { params: EditParams }) {
  return (
    <Suspense fallback={<FinanceFormSkeleton />}>
      <EditDuesContent params={params} />
    </Suspense>
  )
}

