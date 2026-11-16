import { Suspense } from "react"

import { CashLedgerView } from "@/components/finance/cash-ledger-view"
import { FinanceDirectorySkeleton } from "@/components/finance/finance-skeletons"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { Card, CardContent } from "@/components/ui/card"
import { requireAdminContext } from "@/lib/auth/guards"
import { getCashLedger } from "@/lib/finance/queries"
import {
  canManageBills,
  canManageDues,
  canViewCashLedger,
  getJakartaTodayIsoDate,
} from "@/lib/finance/types"

type SearchParams = Promise<{
  type?: string
  category?: string
  from?: string
  to?: string
  q?: string
  page?: string
  created?: string
  updated?: string
}>

async function CashLedgerContent({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const [{ tenant }, params] = await Promise.all([
    requireAdminContext(),
    searchParams,
  ])

  if (!canViewCashLedger(tenant.roles)) {
    return (
      <PageContainer>
        <PageHeader
          title="Kas & Pengeluaran RT"
          description="Akses buku kas RT dibatasi untuk pengurus RT."
        />
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Peran Anda saat ini tidak memiliki izin untuk melihat buku kas RT.
          </CardContent>
        </Card>
      </PageContainer>
    )
  }

  const type = params.type ?? "all"
  const categoryId = params.category ?? "all"
  const startDate = params.from ?? ""
  const endDate = params.to ?? ""
  const search = params.q ?? ""
  const page = Number.parseInt(params.page ?? "1", 10) || 1

  const ledger = await getCashLedger({
    tenantId: tenant.tenantId,
    type,
    categoryId,
    startDate,
    endDate,
    search,
    page,
    pageSize: 15,
  })

  const notice =
    params.created === "1"
      ? "created"
      : params.updated === "1"
        ? "updated"
        : null

  return (
    <CashLedgerView
      items={ledger.items}
      totalCount={ledger.totalCount}
      page={ledger.page}
      pageSize={ledger.pageSize}
      totalPages={ledger.totalPages}
      summary={ledger.summary}
      categories={ledger.categories}
      filters={{
        type,
        categoryId,
        startDate,
        endDate,
        search,
      }}
      todayIso={getJakartaTodayIsoDate()}
      canManageExpenses={canManageBills(tenant.roles)}
      canManageCategories={canManageDues(tenant.roles)}
      canOpenPayments={canManageBills(tenant.roles)}
      notice={notice}
      error={ledger.error}
    />
  )
}

export default function AdminCashPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <Suspense fallback={<FinanceDirectorySkeleton />}>
      <CashLedgerContent searchParams={searchParams} />
    </Suspense>
  )
}

