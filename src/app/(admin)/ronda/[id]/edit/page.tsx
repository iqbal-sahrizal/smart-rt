import { Suspense } from "react"
import { notFound, redirect } from "next/navigation"

import { RondaScheduleForm } from "@/components/ronda/ronda-schedule-form"
import { RondaFormSkeleton } from "@/components/ronda/ronda-skeletons"
import { requireAdminContext } from "@/lib/auth/guards"
import {
  getAdminRondaScheduleDetail,
  listEligibleRondaResidents,
} from "@/lib/ronda/queries"
import { canManageRonda, type RondaResidentCandidate } from "@/lib/ronda/types"

type EditParams = Promise<{ id: string }>

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function EditRondaContent({ params }: { params: EditParams }) {
  const [{ tenant }, { id }] = await Promise.all([
    requireAdminContext(),
    params,
  ])

  if (!UUID_REGEX.test(id)) {
    notFound()
  }

  if (!canManageRonda(tenant.roles)) {
    redirect(`/ronda/${id}?notice=readonly`)
  }

  const detail = await getAdminRondaScheduleDetail({
    tenantId: tenant.tenantId,
    roles: tenant.roles,
    scheduleId: id,
  })

  if (!detail) {
    notFound()
  }

  let initialCandidates: RondaResidentCandidate[] = []
  let candidatesError: string | null = null

  try {
    initialCandidates = await listEligibleRondaResidents({
      tenantId: tenant.tenantId,
      roles: tenant.roles,
    })
  } catch (err) {
    candidatesError =
      err instanceof Error ? err.message : "Gagal memuat daftar warga aktif."
  }

  return (
    <RondaScheduleForm
      tenantId={tenant.tenantId}
      mode="edit"
      initialSchedule={detail}
      initialCandidates={initialCandidates}
      candidatesError={candidatesError}
    />
  )
}

export default function EditRondaPage({ params }: { params: EditParams }) {
  return (
    <Suspense fallback={<RondaFormSkeleton />}>
      <EditRondaContent params={params} />
    </Suspense>
  )
}
