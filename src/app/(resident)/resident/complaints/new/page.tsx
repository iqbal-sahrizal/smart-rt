import { Suspense } from "react"

import { ResidentComplaintFormSkeleton } from "@/components/complaints/complaints-skeletons"
import { ResidentComplaintCreateForm } from "@/components/complaints/resident-complaint-create-form"
import { requireResidentContext } from "@/lib/auth/guards"

async function ResidentNewComplaintContent() {
  const { tenant } = await requireResidentContext()

  return (
    <ResidentComplaintCreateForm
      tenantId={tenant.tenantId}
      tenantName={tenant.tenantName}
    />
  )
}

export default function ResidentNewComplaintPage() {
  return (
    <Suspense fallback={<ResidentComplaintFormSkeleton />}>
      <ResidentNewComplaintContent />
    </Suspense>
  )
}

