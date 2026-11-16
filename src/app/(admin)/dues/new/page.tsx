import { Suspense } from "react"
import { redirect } from "next/navigation"

import { DuesForm } from "@/components/finance/dues-form"
import { FinanceFormSkeleton } from "@/components/finance/finance-skeletons"
import { requireAdminContext } from "@/lib/auth/guards"
import { canManageDues } from "@/lib/finance/types"

async function NewDuesContent() {
  const { tenant } = await requireAdminContext()

  if (!canManageDues(tenant.roles)) {
    redirect("/dues")
  }

  return <DuesForm mode="create" />
}

export default function NewDuesPage() {
  return (
    <Suspense fallback={<FinanceFormSkeleton />}>
      <NewDuesContent />
    </Suspense>
  )
}

