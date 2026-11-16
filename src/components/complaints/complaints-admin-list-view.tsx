"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  ImageIcon,
  InboxIcon,
  InfoIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
} from "lucide-react"

import { PageContainer, PageHeader } from "@/components/layout/page-container"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { RoleCode } from "@/lib/auth/types"
import {
  COMPLAINT_CATEGORY_FILTER_OPTIONS,
  COMPLAINT_PRIORITY_FILTER_OPTIONS,
  COMPLAINT_SEARCH_DEBOUNCE_MS,
  COMPLAINT_STATUS_FILTER_OPTIONS,
  formatComplaintDateTime,
  getComplaintPriorityBadgeVariant,
  getComplaintPriorityLabel,
  getComplaintRoleBannerNotice,
  getComplaintStatusBadgeVariant,
  getComplaintStatusLabel,
  truncateComplaintText,
} from "@/lib/complaints/formatters"
import { useAdminComplaints } from "@/lib/complaints/hooks"
import type {
  ComplaintCategory,
  ComplaintPageResult,
  ComplaintPriority,
  ComplaintStatus,
} from "@/lib/complaints/types"

interface ComplaintsAdminListViewProps {
  tenantId: string
  actorKey: string
  roles: readonly RoleCode[]
  initialFilters: {
    search: string
    status: "all" | ComplaintStatus
    category: "all" | ComplaintCategory
    priority: "all" | ComplaintPriority
    page: number
  }
  initialData: ComplaintPageResult | null
  initialError: string | null
  deletedNotice?: boolean
}

export function ComplaintsAdminListView({
  tenantId,
  actorKey,
  roles,
  initialFilters,
  initialData,
  initialError,
  deletedNotice = false,
}: ComplaintsAdminListViewProps) {
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
  const [priority, setPriority] = React.useState<"all" | ComplaintPriority>(
    initialFilters.priority
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
    priority === initialFilters.priority &&
    page === initialFilters.page

  const complaintsQuery = useAdminComplaints({
    tenantId,
    actorKey,
    filters: {
      search: debouncedSearch || undefined,
      status: status === "all" ? undefined : status,
      category: category === "all" ? undefined : category,
      priority: priority === "all" ? undefined : priority,
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
  const isMetadataOnly = data?.isMetadataOnly ?? false

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
    category !== "all" ||
    priority !== "all"

  const roleNotice = getComplaintRoleBannerNotice(roles)

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = searchInput.trim()
    setDebouncedSearch(trimmed)
    setPage(1)
  }

  function handleStatusChange(nextStatus: "all" | ComplaintStatus) {
    setStatus(nextStatus)
    setPage(1)
  }

  function handleCategoryChange(nextCategory: "all" | ComplaintCategory) {
    setCategory(nextCategory)
    setPage(1)
  }

  function handlePriorityChange(nextPriority: "all" | ComplaintPriority) {
    setPriority(nextPriority)
    setPage(1)
  }

  function handleResetFilters() {
    setSearchInput("")
    setDebouncedSearch("")
    setStatus("all")
    setCategory("all")
    setPriority("all")
    setPage(1)
  }

  function handleQuickStatusToggle(target: ComplaintStatus) {
    setStatus((prev) => (prev === target ? "all" : target))
    setPage(1)
  }

  const summaryCards: Array<{
    key: ComplaintStatus
    label: string
    count: number
    toneClass: string
  }> = [
    {
      key: "open",
      label: "Menunggu",
      count: summary.open,
      toneClass: "text-warning-text",
    },
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
    <PageContainer className="flex flex-col gap-[var(--space-6)]">
      <PageHeader
        title="Pengaduan Warga"
        description="Pantau dan tindak lanjuti pengaduan fasilitas, kebersihan, dan keamanan dari warga RT."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {isMetadataOnly && (
              <Badge variant="outline" size="default">
                Mode Metadata (Bendahara)
              </Badge>
            )}
            <Badge variant="secondary" size="default" className="tabular-nums">
              Total {summary.total} Pengaduan
            </Badge>
          </div>
        }
      />

      {deletedNotice && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary"
        >
          <CheckCircle2Icon className="size-4 shrink-0" />
          <span>Pengaduan berhasil dihapus dari daftar aktif.</span>
        </div>
      )}

      {roleNotice && (
        <div
          data-testid="bendahara-metadata-notice"
          className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground"
        >
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>{roleNotice}</span>
        </div>
      )}

      {/* Ringkasan Status */}
      <div className="grid grid-cols-2 gap-[var(--space-4)] lg:grid-cols-4">
        {summaryCards.map((card) => {
          const isSelected = status === card.key
          return (
            <button
              key={card.key}
              type="button"
              aria-pressed={isSelected}
              onClick={() => handleQuickStatusToggle(card.key)}
              className="text-left focus-visible:outline-none"
            >
              <Card
                className={
                  isSelected
                    ? "border-primary ring-2 ring-primary/20 transition-colors"
                    : "transition-colors hover:border-foreground/20"
                }
              >
                <CardContent className="flex flex-col gap-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <Badge
                      variant={getComplaintStatusBadgeVariant(card.key)}
                      size="sm"
                    >
                      {card.label}
                    </Badge>
                  </div>
                  <span
                    className={`text-2xl font-semibold tabular-nums ${card.toneClass}`}
                  >
                    {card.count}
                  </span>
                </CardContent>
              </Card>
            </button>
          )
        })}
      </div>

      {/* Pencarian & Filter */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cari &amp; Filter Pengaduan</CardTitle>
          <CardDescription>
            Saring daftar pengaduan berdasarkan judul, isi laporan, status,
            kategori, atau tingkat prioritas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSearchSubmit}
            className="flex flex-col gap-[var(--space-3)]"
          >
            <div className="grid gap-[var(--space-3)] md:grid-cols-12">
              <div className="relative md:col-span-5">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Cari judul atau deskripsi pengaduan..."
                  aria-label="Cari pengaduan"
                  className="pl-9"
                  data-testid="complaints-search-input"
                />
              </div>

              <div className="md:col-span-2">
                <select
                  aria-label="Filter status pengaduan"
                  value={status}
                  onChange={(event) =>
                    handleStatusChange(
                      event.target.value as "all" | ComplaintStatus
                    )
                  }
                  className="h-[var(--size-control-md)] w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                  data-testid="complaints-status-filter"
                >
                  {COMPLAINT_STATUS_FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <select
                  aria-label="Filter kategori pengaduan"
                  value={category}
                  onChange={(event) =>
                    handleCategoryChange(
                      event.target.value as "all" | ComplaintCategory
                    )
                  }
                  className="h-[var(--size-control-md)] w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                  data-testid="complaints-category-filter"
                >
                  {COMPLAINT_CATEGORY_FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <select
                  aria-label="Filter prioritas pengaduan"
                  value={priority}
                  onChange={(event) =>
                    handlePriorityChange(
                      event.target.value as "all" | ComplaintPriority
                    )
                  }
                  className="h-[var(--size-control-md)] w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                  data-testid="complaints-priority-filter"
                >
                  {COMPLAINT_PRIORITY_FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 md:col-span-1 md:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleResetFilters}
                  disabled={!hasActiveFilters}
                  className="w-full md:w-auto"
                  title="Reset filter"
                  data-testid="complaints-reset-filter-btn"
                >
                  <RotateCcwIcon className="size-4" />
                  <span className="md:sr-only">Reset</span>
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

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

      {/* Loading State (saat ganti filter/halaman tanpa data cache) */}
      {complaintsQuery.isLoading && !data ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, idx) => (
              <Skeleton key={idx} className="h-14 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <InboxIcon className="size-6" />
            </div>
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-foreground">
                {hasActiveFilters
                  ? "Tidak ada pengaduan yang sesuai"
                  : "Belum ada pengaduan warga"}
              </h2>
              <p className="max-w-md text-sm text-muted-foreground">
                {hasActiveFilters
                  ? "Coba ubah kata kunci pencarian atau reset filter untuk melihat seluruh pengaduan."
                  : "Pengaduan yang dikirim oleh warga di portal warga akan muncul di halaman ini."}
              </p>
            </div>
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
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop Table */}
          <Card className="hidden md:block">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[34%]">Pengaduan</TableHead>
                    <TableHead>Kategori</TableHead>
                    <TableHead>Prioritas</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Pelapor</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow
                      key={item.id}
                      data-testid={`complaint-row-${item.id}`}
                    >
                      <TableCell className="max-w-[340px] whitespace-normal">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/pengaduan/${item.id}`}
                              className="line-clamp-1 font-medium text-foreground hover:text-primary hover:underline"
                            >
                              {item.title}
                            </Link>
                            {!isMetadataOnly && item.hasPhoto && (
                              <span
                                title="Memiliki lampiran foto"
                                className="inline-flex shrink-0 items-center text-muted-foreground"
                              >
                                <ImageIcon className="size-3.5" />
                                <span className="sr-only">
                                  Ada lampiran foto
                                </span>
                              </span>
                            )}
                          </div>
                          <p className="line-clamp-1 text-xs text-muted-foreground">
                            {truncateComplaintText(item.description, 88)}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" size="sm">
                          {item.category}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={getComplaintPriorityBadgeVariant(
                            item.priority
                          )}
                          size="sm"
                        >
                          {getComplaintPriorityLabel(item.priority)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={getComplaintStatusBadgeVariant(item.status)}
                          size="sm"
                        >
                          {getComplaintStatusLabel(item.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[160px] truncate text-sm text-foreground">
                        {item.reporterLabel}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatComplaintDateTime(item.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          nativeButton={false}
                          render={<Link href={`/pengaduan/${item.id}`} />}
                          data-testid={`view-complaint-${item.id}`}
                        >
                          <EyeIcon className="size-4" />
                          <span>Detail</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Mobile Card List */}
          <div className="grid gap-3 md:hidden">
            {items.map((item) => (
              <Card key={item.id} data-testid={`complaint-card-${item.id}`}>
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
                        {getComplaintPriorityLabel(item.priority)}
                      </Badge>
                      <Badge variant="outline" size="sm">
                        {item.category}
                      </Badge>
                    </div>
                    {!isMetadataOnly && item.hasPhoto && (
                      <span
                        title="Memiliki lampiran foto"
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                      >
                        <ImageIcon className="size-3.5" />
                        <span>Foto</span>
                      </span>
                    )}
                  </div>

                  <div className="space-y-1">
                    <Link
                      href={`/pengaduan/${item.id}`}
                      className="block font-semibold text-foreground hover:text-primary hover:underline"
                    >
                      {item.title}
                    </Link>
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {truncateComplaintText(item.description, 120)}
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
                    <div className="min-w-0 truncate">
                      <span>{item.reporterLabel}</span>
                      <span className="mx-1.5">•</span>
                      <span>{formatComplaintDateTime(item.createdAt)}</span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={<Link href={`/pengaduan/${item.id}`} />}
                    >
                      <span>Detail</span>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          <div className="flex flex-col items-center justify-between gap-3 border-t border-border pt-4 sm:flex-row">
            <p className="text-xs text-muted-foreground tabular-nums">
              Menampilkan halaman {page} dari {totalPages} ({totalCount}{" "}
              pengaduan ditemukan)
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
        </>
      )}
    </PageContainer>
  )
}
