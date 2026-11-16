import { Suspense } from "react"
import { notFound } from "next/navigation"

import { DuesDetailView } from "@/components/finance/dues-detail-view"
import { FinanceDetailSkeleton } from "@/components/finance/finance-skeletons"
import { requireAdminContext } from "@/lib/auth/guards"
import { getDuesDetail } from "@/lib/finance/queries"
import { canManageBills, canManageDues } from "@/lib/finance/types"

type DetailParams = Promise<{ id: string }>
type DetailSearchParams = Promise<{
  created?: string
  updated?: string
  notice?: string
}>

async function DuesDetailContent({
  params,
  searchParams,
}: {
  params: DetailParams
  searchParams: DetailSearchParams
}) {
  const { tenant } = await requireAdminContext()
  const [{ id }, resolvedSearch] = await Promise.all([params, searchParams])

  const due = await getDuesDetail({
    tenantId: tenant.tenantId,
    dueId: id,
  })

  if (!due) {
    notFound()
  }

  const notice =
    resolvedSearch.created === "1"
      ? "created"
      : resolvedSearch.updated === "1"
        ? "updated"
        : resolvedSearch.notice === "readonly"
          ? "readonly"
          : null

  return (
    <DuesDetailView
      due={due}
      canManage={canManageDues(tenant.roles)}
      canManageBills={canManageBills(tenant.roles)}
      notice={notice}
    />
  )
}

export default function DuesDetailPage({
  params,
  searchParams,
}: {
  params: DetailParams
  searchParams: DetailSearchParams
}) {
  return (
    <Suspense fallback={<FinanceDetailSkeleton />}>
      <DuesDetailContent params={params} searchParams={searchParams} />
    </Suspense>
  )
}

