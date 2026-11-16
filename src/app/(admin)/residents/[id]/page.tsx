import { Suspense } from "react"
import { notFound } from "next/navigation"

import { ResidentDetailView } from "@/components/residents/resident-detail-view"
import { ResidentDetailSkeleton } from "@/components/residents/resident-skeletons"
import { requireAdminContext } from "@/lib/auth/guards"
import { getResidentAccountLinkSummary } from "@/lib/invitations/queries"
import { getAdminResidentDetail } from "@/lib/residents/queries"
import { canManageResidents } from "@/lib/residents/types"

type ResidentDetailParams = Promise<{ id: string }>
type ResidentDetailSearchParams = Promise<{
  created?: string
  updated?: string
  notice?: string
}>

async function ResidentDetailContent({
  params,
  searchParams,
}: {
  params: ResidentDetailParams
  searchParams: ResidentDetailSearchParams
}) {
  const { tenant } = await requireAdminContext()
  const { id } = await params
  const resolvedSearch = await searchParams

  const [detail, linkSummary] = await Promise.all([
    getAdminResidentDetail({
      tenantId: tenant.tenantId,
      residentId: id,
      roleCodes: tenant.roles,
    }),
    getResidentAccountLinkSummary({
      tenantId: tenant.tenantId,
      residentId: id,
      roleCodes: tenant.roles,
    }),
  ])

  if (!detail) {
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
    <ResidentDetailView
      detail={detail}
      linkSummary={linkSummary}
      canManage={canManageResidents(tenant.roles)}
      notice={notice}
    />
  )
}

export default function ResidentDetailPage({
  params,
  searchParams,
}: {
  params: ResidentDetailParams
  searchParams: ResidentDetailSearchParams
}) {
  return (
    <Suspense fallback={<ResidentDetailSkeleton />}>
      <ResidentDetailContent params={params} searchParams={searchParams} />
    </Suspense>
  )
}
