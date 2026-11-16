import { Suspense } from "react"
import { redirect } from "next/navigation"

import { LettersTypesSkeleton } from "@/components/letters/letters-skeletons"
import { LetterTypesAdminView } from "@/components/letters/letter-types-admin-view"
import { requireAdminContext } from "@/lib/auth/guards"
import { listAdminLetterTypes } from "@/lib/letters/queries"
import { canReadLettersAdmin, type LetterType } from "@/lib/letters/types"

async function LetterTypesAdminContent() {
  const { ctx, tenant } = await requireAdminContext()

  if (!canReadLettersAdmin(tenant.roles)) {
    redirect("/no-access")
  }

  let initialData: { items: LetterType[]; canManage: boolean } | null = null
  let initialError: string | null = null

  try {
    initialData = await listAdminLetterTypes({
      tenantId: tenant.tenantId,
      roles: tenant.roles,
    })
  } catch (error) {
    initialError =
      error instanceof Error
        ? error.message
        : "Gagal memuat daftar jenis surat."
  }

  return (
    <LetterTypesAdminView
      tenantId={tenant.tenantId}
      actorKey={ctx.user.id}
      roles={tenant.roles}
      initialData={initialData}
      initialError={initialError}
    />
  )
}

export default function AdminLetterTypesPage() {
  return (
    <Suspense fallback={<LettersTypesSkeleton />}>
      <LetterTypesAdminContent />
    </Suspense>
  )
}

