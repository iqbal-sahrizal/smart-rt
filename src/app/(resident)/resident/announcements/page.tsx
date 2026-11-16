import { Suspense } from "react"

import { ResidentAnnouncementsSkeleton } from "@/components/announcements/announcement-skeletons"
import { ResidentAnnouncementsFeedView } from "@/components/announcements/resident-announcements-views"
import { getResidentAnnouncementsFeed } from "@/lib/announcements/queries"
import { requireResidentContext } from "@/lib/auth/guards"

type ResidentAnnouncementsSearchParams = Promise<{
  page?: string
}>

async function ResidentAnnouncementsContent({
  searchParams,
}: {
  searchParams: ResidentAnnouncementsSearchParams
}) {
  const { tenant } = await requireResidentContext()
  const resolved = await searchParams
  const parsedPage = Number.parseInt(
    typeof resolved.page === "string" ? resolved.page : "1",
    10
  )
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1

  const feed = await getResidentAnnouncementsFeed({
    tenantId: tenant.tenantId,
    page,
    pageSize: 10,
  })

  return (
    <ResidentAnnouncementsFeedView
      tenantName={tenant.tenantName}
      items={feed.items}
      totalCount={feed.totalCount}
      page={feed.page}
      pageSize={feed.pageSize}
      totalPages={feed.totalPages}
      error={feed.error}
    />
  )
}

export default function ResidentAnnouncementsPage({
  searchParams,
}: {
  searchParams: ResidentAnnouncementsSearchParams
}) {
  return (
    <Suspense fallback={<ResidentAnnouncementsSkeleton />}>
      <ResidentAnnouncementsContent searchParams={searchParams} />
    </Suspense>
  )
}
