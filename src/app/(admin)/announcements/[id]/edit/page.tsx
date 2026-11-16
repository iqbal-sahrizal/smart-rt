import { Suspense } from "react"
import { notFound, redirect } from "next/navigation"

import { AnnouncementForm } from "@/components/announcements/announcement-form"
import { AnnouncementFormSkeleton } from "@/components/announcements/announcement-skeletons"
import {
  getAdminAnnouncementDetail,
  getAnnouncementFormOptions,
} from "@/lib/announcements/queries"
import { canManageAnnouncements } from "@/lib/announcements/types"
import { requireAdminContext } from "@/lib/auth/guards"

type EditParams = Promise<{ id: string }>

async function EditAnnouncementContent({ params }: { params: EditParams }) {
  const { tenant } = await requireAdminContext()
  const { id } = await params

  if (!canManageAnnouncements(tenant.roles)) {
    redirect(`/announcements/${id}?notice=readonly`)
  }

  const [detail, options] = await Promise.all([
    getAdminAnnouncementDetail({
      tenantId: tenant.tenantId,
      announcementId: id,
    }),
    getAnnouncementFormOptions(tenant.tenantId),
  ])

  if (!detail) {
    notFound()
  }

  const recipientRoleIds = detail.recipients
    .map((r) => r.roleId)
    .filter((roleId): roleId is string => Boolean(roleId))
  const recipientHouseholdIds = detail.recipients
    .map((r) => r.householdId)
    .filter((householdId): householdId is string => Boolean(householdId))

  return (
    <AnnouncementForm
      mode="edit"
      roles={options.roles}
      households={options.households}
      initialValues={{
        announcementId: detail.announcement.id,
        title: detail.announcement.title,
        content: detail.announcement.content,
        status: detail.announcement.status,
        targetType: detail.announcement.targetType,
        recipientRoleIds,
        recipientHouseholdIds,
      }}
    />
  )
}

export default function EditAnnouncementPage({
  params,
}: {
  params: EditParams
}) {
  return (
    <Suspense fallback={<AnnouncementFormSkeleton />}>
      <EditAnnouncementContent params={params} />
    </Suspense>
  )
}

