import { Suspense } from "react"

import { AnnouncementDirectoryView } from "@/components/announcements/announcement-directory-view"
import { AnnouncementsDirectorySkeleton } from "@/components/announcements/announcement-skeletons"
import { getAdminAnnouncementsDirectory } from "@/lib/announcements/queries"
import { canManageAnnouncements } from "@/lib/announcements/types"
import { requireAdminContext } from "@/lib/auth/guards"

type AnnouncementsSearchParams = Promise<{
  q?: string
  status?: string
  targetType?: string
  page?: string
  deleted?: string
}>

async function AnnouncementsDirectoryContent({
  searchParams,
}: {
  searchParams: AnnouncementsSearchParams
}) {
  const { tenant } = await requireAdminContext()
  const resolved = await searchParams

  const search = typeof resolved.q === "string" ? resolved.q : ""
  const status = typeof resolved.status === "string" ? resolved.status : "all"
  const targetType =
    typeof resolved.targetType === "string" ? resolved.targetType : "all"
  const parsedPage = Number.parseInt(
    typeof resolved.page === "string" ? resolved.page : "1",
    10
  )
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1

  const directory = await getAdminAnnouncementsDirectory({
    tenantId: tenant.tenantId,
    search,
    status: status === "all" ? undefined : status,
    targetType: targetType === "all" ? undefined : targetType,
    page,
    pageSize: 10,
  })

  return (
    <AnnouncementDirectoryView
      items={directory.items}
      totalCount={directory.totalCount}
      page={directory.page}
      pageSize={directory.pageSize}
      totalPages={directory.totalPages}
      canManage={canManageAnnouncements(tenant.roles)}
      filters={{
        search,
        status,
        targetType,
      }}
      error={directory.error}
      deletedNotice={resolved.deleted === "1"}
    />
  )
}

export default function AdminAnnouncementsPage({
  searchParams,
}: {
  searchParams: AnnouncementsSearchParams
}) {
  return (
    <Suspense fallback={<AnnouncementsDirectorySkeleton />}>
      <AnnouncementsDirectoryContent searchParams={searchParams} />
    </Suspense>
  )
}

