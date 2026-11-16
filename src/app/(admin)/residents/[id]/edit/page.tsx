import { Suspense } from "react"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowLeftIcon } from "lucide-react"

import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { ResidentForm } from "@/components/residents/resident-form"
import { ResidentFormSkeleton } from "@/components/residents/resident-skeletons"
import { Button } from "@/components/ui/button"
import { requireAdminContext } from "@/lib/auth/guards"
import {
  getAdminResidentDetail,
  getTenantHouseholdOptions,
} from "@/lib/residents/queries"
import { canManageResidents } from "@/lib/residents/types"

type EditResidentParams = Promise<{ id: string }>

async function EditResidentContent({ params }: { params: EditResidentParams }) {
  const { tenant } = await requireAdminContext()
  const { id } = await params

  if (!canManageResidents(tenant.roles)) {
    redirect(`/residents/${id}?notice=readonly`)
  }

  const [detail, householdOptions] = await Promise.all([
    getAdminResidentDetail({
      tenantId: tenant.tenantId,
      residentId: id,
      roleCodes: tenant.roles,
    }),
    getTenantHouseholdOptions(tenant.tenantId),
  ])

  if (!detail) {
    notFound()
  }

  return (
    <PageContainer>
      <div>
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href={`/residents/${detail.resident.id}`} />}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Kembali ke Detail Warga
        </Button>
      </div>

      <PageHeader
        title={`Ubah Data: ${detail.resident.fullName}`}
        description="Perbarui identitas warga, keanggotaan Kartu Keluarga, dan data kependudukan terproteksi."
      />

      <ResidentForm
        mode="edit"
        householdOptions={householdOptions}
        resident={detail.resident}
        privateData={detail.privateData}
        currentIsHead={detail.household?.headResidentId === detail.resident.id}
        cancelHref={`/residents/${detail.resident.id}`}
      />
    </PageContainer>
  )
}

export default function EditResidentPage({
  params,
}: {
  params: EditResidentParams
}) {
  return (
    <Suspense fallback={<ResidentFormSkeleton />}>
      <EditResidentContent params={params} />
    </Suspense>
  )
}
