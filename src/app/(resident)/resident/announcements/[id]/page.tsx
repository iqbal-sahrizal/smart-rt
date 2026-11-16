import { Suspense } from "react"
import { notFound } from "next/navigation"

import { ResidentAnnouncementsSkeleton } from "@/components/announcements/announcement-skeletons"
import { ResidentAnnouncementDetailView } from "@/components/announcements/resident-announcements-views"
import { getResidentAnnouncementDetail } from "@/lib/announcements/queries"
import { requireResidentContext } from "@/lib/auth/guards"

type DetailParams = Promise<{ id: string }>

async function ResidentAnnouncementDetailContent({
  params,
}: {
  params: DetailParams
}) {
  const { tenant } = await requireResidentContext()
  const { id } = await params

  const announcement = await getResidentAnnouncementDetail({
    tenantId: tenant.tenantId,
    announcementId: id,
  })

  if (!announcement) {
    notFound()
  }

  return (
    <ResidentAnnouncementDetailView
      tenantName={tenant.tenantName}
      announcement={announcement}
    />
  )
}

export default function ResidentAnnouncementDetailPage({
  params,
}: {
  params: DetailParams
}) {
  return (
    <Suspense fallback={<ResidentAnnouncementsSkeleton />}>
      <ResidentAnnouncementDetailContent params={params} />
    </Suspense>
  )
}

