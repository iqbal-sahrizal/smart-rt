import { Suspense } from "react"

import { ResidentLetterFormSkeleton } from "@/components/letters/letters-skeletons"
import { ResidentLetterCreateForm } from "@/components/letters/resident-letter-create-form"
import { requireResidentContext } from "@/lib/auth/guards"
import { listResidentActiveLetterTypes } from "@/lib/letters/queries"
import type { LetterType } from "@/lib/letters/types"

async function ResidentNewLetterContent() {
  const { tenant } = await requireResidentContext()

  let activeLetterTypes: LetterType[] = []
  let letterTypesError: string | null = null

  try {
    activeLetterTypes = await listResidentActiveLetterTypes({
      tenantId: tenant.tenantId,
    })
  } catch (error) {
    letterTypesError =
      error instanceof Error
        ? error.message
        : "Gagal memuat daftar jenis surat."
  }

  return (
    <ResidentLetterCreateForm
      tenantId={tenant.tenantId}
      tenantName={tenant.tenantName}
      activeLetterTypes={activeLetterTypes}
      letterTypesError={letterTypesError}
    />
  )
}

export default function ResidentNewLetterPage() {
  return (
    <Suspense fallback={<ResidentLetterFormSkeleton />}>
      <ResidentNewLetterContent />
    </Suspense>
  )
}

