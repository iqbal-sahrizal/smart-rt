import { Suspense } from "react"
import { redirect } from "next/navigation"

import { AnnouncementForm } from "@/components/announcements/announcement-form"
import { AnnouncementFormSkeleton } from "@/components/announcements/announcement-skeletons"
import { getAnnouncementFormOptions } from "@/lib/announcements/queries"
import { canManageAnnouncements } from "@/lib/announcements/types"
import { requireAdminContext } from "@/lib/auth/guards"

async function NewAnnouncementContent() {
  const { tenant } = await requireAdminContext()

  if (!canManageAnnouncements(tenant.roles)) {
    redirect("/announcements")
  }

  const { roles, households } = await getAnnouncementFormOptions(tenant.tenantId)

  return <AnnouncementForm mode="create" roles={roles} households={households} />
}

export default function NewAnnouncementPage() {
  return (
    <Suspense fallback={<AnnouncementFormSkeleton />}>
      <NewAnnouncementContent />
    </Suspense>
  )
}

