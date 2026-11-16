import { Suspense } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowLeftIcon } from "lucide-react"

import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { ResidentForm } from "@/components/residents/resident-form"
import { ResidentFormSkeleton } from "@/components/residents/resident-skeletons"
import { Button } from "@/components/ui/button"
import { requireAdminContext } from "@/lib/auth/guards"
import { getTenantHouseholdOptions } from "@/lib/residents/queries"
import { canManageResidents } from "@/lib/residents/types"

async function NewResidentContent() {
  const { tenant } = await requireAdminContext()

  if (!canManageResidents(tenant.roles)) {
    redirect("/residents")
  }

  const householdOptions = await getTenantHouseholdOptions(tenant.tenantId)

  return (
    <PageContainer>
      <div>
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href="/residents" />}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Kembali ke Direktori Warga
        </Button>
      </div>

      <PageHeader
        title="Tambah Warga Baru"
        description={`Daftarkan warga dan kartu keluarga pada ${tenant.tenantName}.`}
      />

      <ResidentForm
        mode="create"
        householdOptions={householdOptions}
        cancelHref="/residents"
      />
    </PageContainer>
  )
}

export default function NewResidentPage() {
  return (
    <Suspense fallback={<ResidentFormSkeleton />}>
      <NewResidentContent />
    </Suspense>
  )
}
