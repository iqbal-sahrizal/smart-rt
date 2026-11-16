"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertCircleIcon,
  ChevronRightIcon,
  FileCheck2Icon,
  FileTextIcon,
  InboxIcon,
  PaperclipIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
} from "lucide-react"

import { ResidentContainer } from "@/components/resident/resident-container"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { LETTER_STATUS_LABELS, LETTER_STATUSES } from "@/lib/letters/constants"
import {
  formatLetterDateTime,
  getLetterRequestCode,
  getLetterRequestStatusBadgeVariant,
  getLetterRequestStatusLabel,
  LETTER_SEARCH_DEBOUNCE_MS,
  LETTER_STATUS_FILTER_OPTIONS,
} from "@/lib/letters/formatters"
import { useResidentLetterRequests } from "@/lib/letters/hooks"
import type { LetterPageResult, LetterRequestStatus } from "@/lib/letters/types"

interface ResidentLettersListViewProps {
  tenantId: string
  actorKey: string
  initialFilters: {
    search: string
    status: "all" | LetterRequestStatus
    page: number
  }
  initialData: LetterPageResult | null
  initialError: string | null
}

export function ResidentLettersListView({
  tenantId,
  actorKey,
  initialFilters,
  initialData,
  initialError,
}: ResidentLettersListViewProps) {
  const [searchInput, setSearchInput] = React.useState(initialFilters.search)
  const [debouncedSearch, setDebouncedSearch] = React.useState(
    initialFilters.search
  )
  const [status, setStatus] = React.useState<"all" | LetterRequestStatus>(
    initialFilters.status
  )
  const [page, setPage] = React.useState(initialFilters.page)

  React.useEffect(() => {
    const trimmed = searchInput.trim()
    const timer = window.setTimeout(() => {
      setDebouncedSearch((prev) => {
        if (prev !== trimmed) {
          setPage(1)
        }
        return trimmed
      })
    }, LETTER_SEARCH_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [searchInput])

  const isInitialState =
    debouncedSearch === initialFilters.search &&
    status === initialFilters.status &&
    page === initialFilters.page

  const lettersQuery = useResidentLetterRequests({
    tenantId,
    actorKey,
    filters: {
      search: debouncedSearch || undefined,
      status: status === "all" ? undefined : status,
      sortBy: "created_at",
      sort: "desc",
      page,
      pageSize: 10,
    },
    initialData: isInitialState ? (initialData ?? undefined) : undefined,
  })

  const data = lettersQuery.data ?? (isInitialState ? initialData : undefined)
  const items = data?.items ?? []
  const summary = data?.summary ?? {
    submitted: 0,
    reviewing: 0,
    approved: 0,
    rejected: 0,
    completed: 0,
    cancelled: 0,
    total: 0,
  }
  const totalCount = data?.totalCount ?? 0
  const totalPages = data?.totalPages ?? 1
  const errorMessage =
    lettersQuery.error?.message ?? (isInitialState ? initialError : null)

  const hasActiveFilter = Boolean(debouncedSearch) || status !== "all"

  function handleResetFilters() {
    setSearchInput("")
    setDebouncedSearch("")
    setStatus("all")
    setPage(1)
  }

  return (
    <ResidentContainer className="flex flex-col gap-[var(--space-5)]">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="font-heading text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Permohonan Surat Saya
          </h1>
          <p className="text-sm text-muted-foreground">
            Ajukan surat pengantar RT, lengkapi syarat, dan unduh PDF surat
            terbit Anda.
          </p>
        </div>

        <Button
          nativeButton={false}
          size="sm"
          render={<Link href="/resident/letters/new" />}
        >
          <PlusIcon className="size-4" />
          <span>Ajukan Surat</span>
        </Button>
      </div>

      {/* Status Summary Grid */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-6">
        {LETTER_STATUSES.map((st) => (
          <Card key={st}>
            <CardContent className="space-y-1 p-3">
              <p className="truncate text-[11px] font-medium text-muted-foreground">
                {LETTER_STATUS_LABELS[st]}
              </p>
              <p className="text-lg font-semibold tracking-tight text-foreground tabular-nums">
                {summary[st]}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter Pills + Search */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {LETTER_STATUS_FILTER_OPTIONS.map((opt) => {
            const active = status === opt.value
            return (
              <Button
                key={opt.value}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                onClick={() => {
                  setStatus(opt.value)
                  setPage(1)
                }}
                className="rounded-full"
              >
                {opt.label}
              </Button>
            )
          })}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Cari keperluan atau nomor surat..."
              aria-label="Cari permohonan surat saya"
              className="pl-9"
            />
          </div>
          {hasActiveFilter && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleResetFilters}
            >
              <RotateCcwIcon className="size-3.5" />
              <span>Reset</span>
            </Button>
          )}
        </div>
      </div>

      {/* Error State */}
      {errorMessage && (
        <Card className="border-destructive/40 bg-destructive-subtle/20">
          <CardContent className="flex flex-col items-start justify-between gap-3 p-4 sm:flex-row sm:items-center">
            <div className="flex items-start gap-2.5 text-sm text-destructive">
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => lettersQuery.refetch()}
            >
              <RefreshCwIcon className="size-3.5" />
              <span>Coba Lagi</span>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Menampilkan {totalCount} permohonan</span>
          {lettersQuery.isFetching && !lettersQuery.isLoading && (
            <span>Memperbarui...</span>
          )}
        </div>

        {lettersQuery.isLoading && !data ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, idx) => (
              <Card key={idx}>
                <CardContent className="space-y-2 p-4">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-5 w-64 max-w-full" />
                  <Skeleton className="h-4 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-surface-subtle text-muted-foreground">
                <InboxIcon className="size-6" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {hasActiveFilter
                    ? "Tidak ada permohonan yang cocok"
                    : "Belum ada permohonan surat"}
                </p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  {hasActiveFilter
                    ? "Coba ubah kata kunci pencarian atau pilih filter status lain."
                    : "Ajukan surat pengantar RT pertama Anda secara online."}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {hasActiveFilter && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleResetFilters}
                  >
                    <RotateCcwIcon className="size-3.5" />
                    <span>Reset Filter</span>
                  </Button>
                )}
                <Button
                  nativeButton={false}
                  size="sm"
                  render={<Link href="/resident/letters/new" />}
                >
                  <PlusIcon className="size-4" />
                  <span>Ajukan Surat Baru</span>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          items.map((item) => (
            <Link
              key={item.id}
              href={`/resident/letters/${item.id}`}
              className="group block"
            >
              <Card className="transition-colors group-hover:border-primary/40">
                <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant={getLetterRequestStatusBadgeVariant(item.status)}
                        size="sm"
                      >
                        {getLetterRequestStatusLabel(item.status)}
                      </Badge>
                      <Badge variant="outline" size="sm">
                        {item.letterTypeCode}
                      </Badge>
                      <span className="text-xs font-medium text-muted-foreground">
                        {item.letterNumber ?? getLetterRequestCode(item.id)}
                      </span>
                    </div>
                    <CardTitle className="truncate text-base">
                      {item.letterTypeName}
                    </CardTitle>
                    <CardDescription className="line-clamp-2 text-xs">
                      {item.purpose}
                    </CardDescription>
                  </div>
                  <ChevronRightIcon className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </CardHeader>

                <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-0 text-xs text-muted-foreground">
                  <span>{formatLetterDateTime(item.createdAt)}</span>
                  <div className="flex items-center gap-3">
                    {item.attachmentCount > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <PaperclipIcon className="size-3.5" />
                        {item.attachmentCount} lampiran
                      </span>
                    )}
                    {item.hasIssuedPdf && (
                      <span className="inline-flex items-center gap-1 font-medium text-success">
                        <FileCheck2Icon className="size-3.5" />
                        PDF siap diunduh
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 font-medium text-primary">
                      <FileTextIcon className="size-3.5" />
                      Detail
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1 || lettersQuery.isFetching}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Sebelumnya
          </Button>
          <span className="text-xs text-muted-foreground">
            Halaman {page} dari {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= totalPages || lettersQuery.isFetching}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Berikutnya
          </Button>
        </div>
      )}
    </ResidentContainer>
  )
}

