import { Suspense } from "react"
import { redirect } from "next/navigation"

import { LettersAdminListSkeleton } from "@/components/letters/letters-skeletons"
import { LettersAdminListView } from "@/components/letters/letters-admin-list-view"
import { requireAdminContext } from "@/lib/auth/guards"
import { LETTER_STATUSES } from "@/lib/letters/constants"
import {
  listAdminLetterRequests,
  listAdminLetterTypes,
} from "@/lib/letters/queries"
import {
  canReadLettersAdmin,
  type LetterPageResult,
  type LetterRequestStatus,
  type LetterType,
} from "@/lib/letters/types"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

function parseLetterTypeId(raw: string): "all" | string {
  const trimmed = raw.trim()
  if (!trimmed || trimmed === "all") return "all"
  return UUID_REGEX.test(trimmed) ? trimmed : "all"
}

function parseSort(raw: string): "desc" | "asc" {
  return raw === "asc" ? "asc" : "desc"
}

function parsePage(raw: string): number {
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1
}

async function LettersAdminListContent({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const [{ ctx, tenant }, params] = await Promise.all([
    requireAdminContext(),
    searchParams,
  ])

  if (!canReadLettersAdmin(tenant.roles)) {
    redirect("/no-access")
  }

  const search = pickFirst(params.q).trim()
  const status = parseStatus(pickFirst(params.status))
  const letterTypeId = parseLetterTypeId(pickFirst(params.letterTypeId))
  const sort = parseSort(pickFirst(params.sort))
  const page = parsePage(pickFirst(params.page))

  let initialData: LetterPageResult | null = null
  let initialError: string | null = null
  let letterTypes: LetterType[] = []

  const [requestsResult, typesResult] = await Promise.allSettled([
    listAdminLetterRequests({
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      filters: {
        search: search || undefined,
        status: status === "all" ? undefined : status,
        letterTypeId: letterTypeId === "all" ? undefined : letterTypeId,
        sortBy: "created_at",
        sort,
        page,
      },
    }),
    listAdminLetterTypes({
      tenantId: tenant.tenantId,
      roles: tenant.roles,
    }),
  ])

  if (requestsResult.status === "fulfilled") {
    initialData = requestsResult.value
  } else {
    initialError =
      requestsResult.reason instanceof Error
        ? requestsResult.reason.message
        : "Gagal memuat daftar permohonan surat."
  }

  if (typesResult.status === "fulfilled") {
    letterTypes = typesResult.value.items
  }

  return (
    <LettersAdminListView
      tenantId={tenant.tenantId}
      actorKey={ctx.user.id}
      roles={tenant.roles}
      letterTypes={letterTypes}
      initialFilters={{
        search,
        status,
        letterTypeId,
        sort,
        page,
      }}
      initialData={initialData}
      initialError={initialError}
    />
  )
}

export default function AdminLettersPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <Suspense fallback={<LettersAdminListSkeleton />}>
      <LettersAdminListContent searchParams={searchParams} />
    </Suspense>
  )
}

