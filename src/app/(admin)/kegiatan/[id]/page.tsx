import { Suspense } from "react"
import { notFound, redirect } from "next/navigation"

import { ActivityAdminDetailSkeleton } from "@/components/activities/activities-skeletons"
import { ActivityAdminDetailView } from "@/components/activities/activity-admin-detail-view"
import { requireAdminContext } from "@/lib/auth/guards"
import {
  getAdminActivityHistory,
  listEligibleActivityResidents,
} from "@/lib/activities/admin-candidates"
import {
  getAdminActivityDetail,
  listAdminActivityParticipants,
} from "@/lib/activities/queries"
import { canReadActivitiesAdmin } from "@/lib/activities/types"
import { isValidUuid } from "@/lib/residents/schemas"

type DetailParams = Promise<{ id: string }>
type SearchParams = Promise<{ notice?: string }>

async function AdminActivityDetailContent({
  params,
  searchParams,
}: {
  params: DetailParams
  searchParams: SearchParams
}) {
  const [{ ctx, tenant }, { id }, queryParams] = await Promise.all([
    requireAdminContext(),
    params,
    searchParams,
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

  const [participantsRes, eligibleResidents, activityHistory] =
    await Promise.all([
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
      getAdminActivityHistory({
        tenantId: tenant.tenantId,
        roles: tenant.roles,
        activityId: id,
      }).catch(() => []),
    ])

  return (
    <ActivityAdminDetailView
      tenantId={tenant.tenantId}
      actorKey={ctx.user.id}
      roles={tenant.roles}
      activityId={id}
      initialDetail={detail}
      initialParticipants={participantsRes.data}
      initialParticipantsError={participantsRes.error}
      eligibleResidents={eligibleResidents}
      activityHistory={activityHistory}
      notice={queryParams.notice === "locked_edit" ? "locked_edit" : null}
    />
  )
}

export default function AdminActivityDetailPage({
  params,
  searchParams,
}: {
  params: DetailParams
  searchParams: SearchParams
}) {
  return (
    <Suspense fallback={<ActivityAdminDetailSkeleton />}>
      <AdminActivityDetailContent params={params} searchParams={searchParams} />
    </Suspense>
  )
}

