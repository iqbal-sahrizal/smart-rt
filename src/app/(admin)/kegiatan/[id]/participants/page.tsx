import { Suspense } from "react"
import { notFound, redirect } from "next/navigation"

import { ActivityParticipantsSkeleton } from "@/components/activities/activities-skeletons"
import { ActivityParticipantsPageView } from "@/components/activities/activity-participants-page-view"
import { requireAdminContext } from "@/lib/auth/guards"
import { listEligibleActivityResidents } from "@/lib/activities/admin-candidates"
import {
  getAdminActivityDetail,
  listAdminActivityParticipants,
} from "@/lib/activities/queries"
import { canReadActivitiesAdmin } from "@/lib/activities/types"
import { isValidUuid } from "@/lib/residents/schemas"

type ParticipantsParams = Promise<{ id: string }>

async function AdminActivityParticipantsContent({
  params,
}: {
  params: ParticipantsParams
}) {
  const [{ ctx, tenant }, { id }] = await Promise.all([
    requireAdminContext(),
    params,
  ])

  if (!canReadActivitiesAdmin(tenant.roles)) {
    redirect("/no-access")
  }

  if (!isValidUuid(id)) {
    notFound()
  }

  const detail = await getAdminActivityDetail({
    tenantId: tenant.tenantId,
    roles: tenant.roles,
    activityId: id,
  })

  if (!detail) {
    notFound()
  }

  const [participantsRes, eligibleResidents] = await Promise.all([
    listAdminActivityParticipants({
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      activityId: id,
      filters: { page: 1, pageSize: 10 },
    })
      .then((data) => ({ data, error: null as string | null }))
      .catch((err) => ({
        data: null,
        error:
          err instanceof Error
            ? err.message
            : "Gagal memuat daftar peserta kegiatan.",
      })),
    listEligibleActivityResidents({
      tenantId: tenant.tenantId,
      roles: tenant.roles,
    }).catch(() => []),
  ])

  return (
    <ActivityParticipantsPageView
      tenantId={tenant.tenantId}
      actorKey={ctx.user.id}
      roles={tenant.roles}
      detail={detail}
      initialParticipants={participantsRes.data}
      initialParticipantsError={participantsRes.error}
      eligibleResidents={eligibleResidents}
    />
  )
}

export default function AdminActivityParticipantsPage({
  params,
}: {
  params: ParticipantsParams
}) {
  return (
    <Suspense fallback={<ActivityParticipantsSkeleton />}>
      <AdminActivityParticipantsContent params={params} />
    </Suspense>
  )
}

