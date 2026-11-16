"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ImageIcon,
  InboxIcon,
  MessageSquareWarningIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
} from "lucide-react"

import { ResidentContainer } from "@/components/resident/resident-container"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  COMPLAINT_CATEGORY_FILTER_OPTIONS,
  COMPLAINT_SEARCH_DEBOUNCE_MS,
  formatComplaintDateTime,
  getComplaintPriorityBadgeVariant,
  getComplaintPriorityLabel,
  getComplaintStatusBadgeVariant,
  getComplaintStatusLabel,
  RESIDENT_COMPLAINT_FILTER_OPTIONS,
  truncateComplaintText,
} from "@/lib/complaints/formatters"
import { useResidentComplaints } from "@/lib/complaints/hooks"
import type {
  ComplaintCategory,
  ComplaintPageResult,
  ComplaintStatus,
} from "@/lib/complaints/types"

interface ResidentComplaintsListViewProps {
  tenantId: string
  actorKey: string
  initialFilters: {
    search: string
    status: "all" | ComplaintStatus
    category: "all" | ComplaintCategory
    page: number
  }
  initialData: ComplaintPageResult | null
  initialError: string | null
}

export function ResidentComplaintsListView({
  tenantId,
  actorKey,
  initialFilters,
  initialData,
  initialError,
}: ResidentComplaintsListViewProps) {
  const [searchInput, setSearchInput] = React.useState(initialFilters.search)
  const [debouncedSearch, setDebouncedSearch] = React.useState(
    initialFilters.search
  )
  const [status, setStatus] = React.useState<"all" | ComplaintStatus>(
    initialFilters.status
  )
  const [category, setCategory] = React.useState<"all" | ComplaintCategory>(
    initialFilters.category
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
    }, COMPLAINT_SEARCH_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [searchInput])

  const isInitialState =
    debouncedSearch === initialFilters.search &&
    status === initialFilters.status &&
    category === initialFilters.category &&
    page === initialFilters.page

  const complaintsQuery = useResidentComplaints({
    tenantId,
    actorKey,
    filters: {
      search: debouncedSearch || undefined,
      status: status === "all" ? undefined : status,
      category: category === "all" ? undefined : category,
      page,
      pageSize: 10,
    },
    initialData: isInitialState ? (initialData ?? undefined) : undefined,
  })

  const data =
    complaintsQuery.data ?? (isInitialState ? initialData : undefined)
  const items = data?.items ?? []
  const summary = data?.summary ?? {
    open: 0,
    inProgress: 0,
    resolved: 0,
    rejected: 0,
    total: 0,
  }
  const totalCount = data?.totalCount ?? 0
  const totalPages = data?.totalPages ?? 1

  const errorMessage =
    complaintsQuery.error instanceof Error
      ? complaintsQuery.error.message
      : isInitialState
        ? initialError
        : null

  const hasActiveFilters =
    Boolean(debouncedSearch) ||
    Boolean(searchInput.trim()) ||
    status !== "all" ||
    category !== "all"

  function handleSelectStatus(nextStatus: "all" | ComplaintStatus) {
    setStatus(nextStatus)
    setPage(1)
  }

  function handleSelectCategory(nextCategory: "all" | ComplaintCategory) {
    setCategory(nextCategory)
    setPage(1)
  }

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault()
    setDebouncedSearch(searchInput.trim())
    setPage(1)
  }

  function handleResetFilters() {
    setSearchInput("")
    setDebouncedSearch("")
    setStatus("all")
    setCategory("all")
    setPage(1)
  }

  const summaryItems: Array<{
    key: ComplaintStatus
    label: string
    count: number
    toneClass: string
  }> = [
    { key: "open", label: "Baru", count: summary.open, toneClass: "text-warning-text" },
    {
      key: "in_progress",
      label: "Diproses",
      count: summary.inProgress,
      toneClass: "text-info-text",
    },
    {
      key: "resolved",
      label: "Selesai",
      count: summary.resolved,
      toneClass: "text-success-text",
    },
    {
      key: "rejected",
      label: "Ditolak",
      count: summary.rejected,
      toneClass: "text-destructive-text",
    },
  ]

  return (
    <ResidentContainer>
      {/* Header */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 space-y-1">
          <h1 className="font-heading text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Pengaduan Saya
          </h1>
          <p className="text-sm text-muted-foreground">
            Kirim keluhan lingkungan RT dan pantau perkembangan tindak lanjutnya.
          </p>
        </div>

        <Button
          nativeButton={false}
          render={<Link href="/resident/complaints/new" />}
          className="w-full shrink-0 sm:w-auto"
          data-testid="resident-create-complaint-btn"
        >
          <PlusIcon className="size-4" />
          <span>Buat Pengaduan</span>
        </Button>
      </div>

      {/* Ringkasan Status Pribadi */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {summaryItems.map((entry) => {
          const isSelected = status === entry.key
          return (
            <button
              key={entry.key}
              type="button"
              aria-pressed={isSelected}
              onClick={() =>
                handleSelectStatus(isSelected ? "all" : entry.key)
              }
              className="text-left focus-visible:outline-none"
            >
              <Card
                className={
                  isSelected
                    ? "border-primary ring-2 ring-primary/20 transition-colors"
                    : "transition-colors hover:border-foreground/20"
                }
              >
                <CardContent className="flex flex-col gap-2 p-3.5">
                  <Badge
                    variant={getComplaintStatusBadgeVariant(entry.key)}
                    size="sm"
                  >
                    {entry.label}
                  </Badge>
                  <p
                    className={`text-xl font-semibold tabular-nums ${entry.toneClass}`}
                  >
                    {entry.count}
                  </p>
                </CardContent>
              </Card>
            </button>
          )
        })}
      </div>

      {/* Filter Status Pills + Search + Category */}
      <div className="space-y-3">
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Filter status pengaduan"
        >
          {RESIDENT_COMPLAINT_FILTER_OPTIONS.map((option) => {
            const active = status === option.value
            return (
              <Button
                key={option.value}
                type="button"
                variant={active ? "default" : "outline"}
                size="sm"
                onClick={() => handleSelectStatus(option.value)}
                aria-pressed={active}
                data-testid={`resident-filter-status-${option.value}`}
              >
                {option.label}
              </Button>
            )
          })}
        </div>

        <form
          onSubmit={handleSearchSubmit}
          className="flex flex-col gap-2.5 sm:flex-row sm:items-center"
        >
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Cari judul atau deskripsi pengaduan Anda..."
              aria-label="Cari pengaduan saya"
              className="pl-9"
              data-testid="resident-complaints-search"
            />
          </div>

          <select
            aria-label="Filter kategori pengaduan"
            value={category}
            onChange={(event) =>
              handleSelectCategory(
                event.target.value as "all" | ComplaintCategory
              )
            }
            className="h-[var(--size-control-md)] rounded-md border border-input bg-surface px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 sm:w-48"
            data-testid="resident-complaints-category-filter"
          >
            {COMPLAINT_CATEGORY_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          {hasActiveFilters && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleResetFilters}
              data-testid="resident-complaints-reset-filter"
            >
              <RotateCcwIcon className="size-4" />
              <span>Reset</span>
            </Button>
          )}
        </form>
      </div>

      {/* Error State */}
      {errorMessage && (
        <div
          role="alert"
          className="flex flex-col justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive-subtle/40 px-4 py-3 text-sm text-destructive sm:flex-row sm:items-center"
        >
          <div className="flex items-start gap-2">
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => complaintsQuery.refetch()}
          >
            <RefreshCwIcon className="size-3.5" />
            <span>Coba Lagi</span>
          </Button>
        </div>
      )}

      {/* List / Loading / Empty */}
      {complaintsQuery.isLoading && !data ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, idx) => (
            <Card key={idx}>
              <CardContent className="space-y-2.5 p-4">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              {hasActiveFilters ? (
                <InboxIcon className="size-6" />
              ) : (
                <MessageSquareWarningIcon className="size-6" />
              )}
            </div>
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-foreground">
                {hasActiveFilters
                  ? "Tidak ada pengaduan yang sesuai"
                  : "Belum ada pengaduan yang dikirim"}
              </h2>
              <p className="max-w-md text-sm text-muted-foreground">
                {hasActiveFilters
                  ? "Ubah filter status, kategori, atau kata kunci pencarian untuk melihat pengaduan Anda lainnya."
                  : "Sampaikan laporan terkait fasilitas, kebersihan, atau keamanan agar pengurus RT dapat segera menindaklanjutinya."}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {hasActiveFilters && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleResetFilters}
                >
                  <RotateCcwIcon className="size-4" />
                  <span>Reset Filter</span>
                </Button>
              )}
              <Button
                nativeButton={false}
                size="sm"
                render={<Link href="/resident/complaints/new" />}
                data-testid="resident-empty-create-btn"
              >
                <PlusIcon className="size-4" />
                <span>Buat Pengaduan</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3">
            {items.map((item) => (
              <Link
                key={item.id}
                href={`/resident/complaints/${item.id}`}
                className="group block min-w-0"
                data-testid={`resident-complaint-card-${item.id}`}
              >
                <Card className="transition-colors group-hover:border-primary/40">
                  <CardContent className="flex flex-col gap-3 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge
                          variant={getComplaintStatusBadgeVariant(item.status)}
                          size="sm"
                        >
                          {getComplaintStatusLabel(item.status)}
                        </Badge>
                        <Badge
                          variant={getComplaintPriorityBadgeVariant(
                            item.priority
                          )}
                          size="sm"
                        >
                          Prioritas {getComplaintPriorityLabel(item.priority)}
                        </Badge>
                        <Badge variant="outline" size="sm">
                          {item.category}
                        </Badge>
                      </div>

                      {item.hasPhoto && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <ImageIcon className="size-3.5" />
                          <span>Foto</span>
                        </span>
                      )}
                    </div>

                    <div className="min-w-0 space-y-1">
                      <h2 className="text-base font-semibold break-words text-foreground group-hover:text-primary">
                        {item.title}
                      </h2>
                      <p className="line-clamp-2 text-sm break-words text-muted-foreground">
                        {truncateComplaintText(item.description, 150)}
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-2 border-t border-border pt-2.5 text-xs text-muted-foreground">
                      <span>Dibuat {formatComplaintDateTime(item.createdAt)}</span>
                      <span className="inline-flex items-center gap-1 font-medium text-primary">
                        <span>Lihat Detail</span>
                        <ChevronRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-col items-center justify-between gap-3 border-t border-border pt-4 sm:flex-row">
              <p className="text-xs text-muted-foreground tabular-nums">
                Halaman {page} dari {totalPages} ({totalCount} pengaduan)
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={page <= 1 || complaintsQuery.isFetching}
                >
                  <ChevronLeftIcon className="size-4" />
                  <span>Sebelumnya</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setPage((prev) => Math.min(totalPages, prev + 1))
                  }
                  disabled={page >= totalPages || complaintsQuery.isFetching}
                >
                  <span>Berikutnya</span>
                  <ChevronRightIcon className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </ResidentContainer>
  )
}

