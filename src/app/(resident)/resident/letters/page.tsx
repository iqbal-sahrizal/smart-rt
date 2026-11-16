import { Suspense } from "react"

import { ResidentLettersListSkeleton } from "@/components/letters/letters-skeletons"
import { ResidentLettersListView } from "@/components/letters/resident-letters-list-view"
import { requireResidentContext } from "@/lib/auth/guards"
import { LETTER_STATUSES } from "@/lib/letters/constants"
import { listResidentLetterRequests } from "@/lib/letters/queries"
import type { LetterPageResult, LetterRequestStatus } from "@/lib/letters/types"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function pickFirst(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? ""
  }
  return value ?? ""
}

function parseStatus(raw: string): "all" | LetterRequestStatus {
  return (LETTER_STATUSES as readonly string[]).includes(raw)
    ? (raw as LetterRequestStatus)
    : "all"
}

function parsePage(raw: string): number {
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1
}

async function ResidentLettersListContent({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const [{ ctx, tenant }, params] = await Promise.all([
    requireResidentContext(),
    searchParams,
  ])

  const search = pickFirst(params.q).trim()
  const status = parseStatus(pickFirst(params.status))
  const page = parsePage(pickFirst(params.page))

  let initialData: LetterPageResult | null = null
  let initialError: string | null = null

  try {
    initialData = await listResidentLetterRequests({
      tenantId: tenant.tenantId,
      memberId: tenant.memberId,
      residentId: tenant.residentId,
      filters: {
        search: search || undefined,
        status: status === "all" ? undefined : status,
        page,
      },
    })
  } catch (error) {
    initialError =
      error instanceof Error
        ? error.message
        : "Gagal memuat daftar permohonan surat Anda."
  }

  return (
    <ResidentLettersListView
      tenantId={tenant.tenantId}
      actorKey={ctx.user.id}
      initialFilters={{
        search,
        status,
        page,
      }}
      initialData={initialData}
      initialError={initialError}
    />
  )
}

export default function ResidentLettersPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <Suspense fallback={<ResidentLettersListSkeleton />}>
      <ResidentLettersListContent searchParams={searchParams} />
    </Suspense>
  )
}

