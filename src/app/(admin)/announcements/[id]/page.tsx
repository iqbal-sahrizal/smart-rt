import { Suspense } from "react"
import { notFound } from "next/navigation"

import { AnnouncementDetailView } from "@/components/announcements/announcement-detail-view"
import { AnnouncementDetailSkeleton } from "@/components/announcements/announcement-skeletons"
import { getAdminAnnouncementDetail } from "@/lib/announcements/queries"
import { canManageAnnouncements } from "@/lib/announcements/types"
import { requireAdminContext } from "@/lib/auth/guards"

type DetailParams = Promise<{ id: string }>
type DetailSearchParams = Promise<{
  created?: string
  updated?: string
  notice?: string
}>

async function AnnouncementDetailContent({
  params,
  searchParams,
}: {
  params: DetailParams
  searchParams: DetailSearchParams
}) {
  const { tenant } = await requireAdminContext()
  const [{ id }, resolvedSearch] = await Promise.all([params, searchParams])

  const detail = await getAdminAnnouncementDetail({
    tenantId: tenant.tenantId,
    announcementId: id,
  })

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
    <AnnouncementDetailView
      announcement={detail.announcement}
      recipients={detail.recipients}
      canManage={canManageAnnouncements(tenant.roles)}
      notice={notice}
    />
  )
}

export default function AdminAnnouncementDetailPage({
  params,
  searchParams,
}: {
  params: DetailParams
  searchParams: DetailSearchParams
}) {
  return (
    <Suspense fallback={<AnnouncementDetailSkeleton />}>
      <AnnouncementDetailContent params={params} searchParams={searchParams} />
    </Suspense>
  )
}

