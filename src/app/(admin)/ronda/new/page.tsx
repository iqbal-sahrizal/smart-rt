import { Suspense } from "react"
import { redirect } from "next/navigation"

import { RondaScheduleForm } from "@/components/ronda/ronda-schedule-form"
import { RondaFormSkeleton } from "@/components/ronda/ronda-skeletons"
import { requireAdminContext } from "@/lib/auth/guards"
import { getJakartaTodayIsoDate } from "@/lib/finance/types"
import { listEligibleRondaResidents } from "@/lib/ronda/queries"
import { isValidCalendarDate } from "@/lib/ronda/schemas"
import { canManageRonda, type RondaResidentCandidate } from "@/lib/ronda/types"

type SearchParams = Promise<{
  date?: string
}>

async function NewRondaContent({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const [{ tenant }, params] = await Promise.all([
    requireAdminContext(),
    searchParams,
  ])

  if (!canManageRonda(tenant.roles)) {
    redirect("/ronda?notice=readonly")
  }

  const todayDate = getJakartaTodayIsoDate()
  const initialDate =
    params.date && isValidCalendarDate(params.date) ? params.date : todayDate

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
      mode="create"
      initialDate={initialDate}
      initialCandidates={initialCandidates}
      candidatesError={candidatesError}
    />
  )
}

export default function NewRondaPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <Suspense fallback={<RondaFormSkeleton />}>
      <NewRondaContent searchParams={searchParams} />
    </Suspense>
  )
}
