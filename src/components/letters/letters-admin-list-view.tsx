"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  FileCheck2Icon,
  FileTextIcon,
  InboxIcon,
  InfoIcon,
  PaperclipIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  Settings2Icon,
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
import { LETTER_STATUS_LABELS, LETTER_STATUSES } from "@/lib/letters/constants"
import {
  canShowManageLettersCta,
  formatLetterDateTime,
  getLetterRequestCode,
  getLetterRequestStatusBadgeVariant,
  getLetterRequestStatusLabel,
  getLetterRoleBannerNotice,
  LETTER_SEARCH_DEBOUNCE_MS,
  LETTER_SORT_OPTIONS,
  LETTER_STATUS_FILTER_OPTIONS,
  truncateLetterText,
} from "@/lib/letters/formatters"
import { useAdminLetterRequests } from "@/lib/letters/hooks"
import type {
  LetterPageResult,
  LetterRequestStatus,
  LetterType,
} from "@/lib/letters/types"

interface LettersAdminListViewProps {
  tenantId: string
  actorKey: string
  roles: readonly RoleCode[]
  letterTypes: LetterType[]
  initialFilters: {
    search: string
    status: "all" | LetterRequestStatus
    letterTypeId: "all" | string
    sort: "desc" | "asc"
    page: number
  }
  initialData: LetterPageResult | null
  initialError: string | null
}

export function LettersAdminListView({
  tenantId,
  actorKey,
  roles,
  letterTypes,
  initialFilters,
  initialData,
  initialError,
}: LettersAdminListViewProps) {
  const [searchInput, setSearchInput] = React.useState(initialFilters.search)
  const [debouncedSearch, setDebouncedSearch] = React.useState(
    initialFilters.search
  )
  const [status, setStatus] = React.useState<"all" | LetterRequestStatus>(
    initialFilters.status
  )
  const [letterTypeId, setLetterTypeId] = React.useState<string>(
    initialFilters.letterTypeId
  )
  const [sort, setSort] = React.useState<"desc" | "asc">(initialFilters.sort)
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
    letterTypeId === initialFilters.letterTypeId &&
    sort === initialFilters.sort &&
    page === initialFilters.page

  const lettersQuery = useAdminLetterRequests({
    tenantId,
    actorKey,
    filters: {
      search: debouncedSearch || undefined,
      status: status === "all" ? undefined : status,
      letterTypeId: letterTypeId === "all" ? undefined : letterTypeId,
      sortBy: "created_at",
      sort,
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
  const isMetadataOnly = data?.isMetadataOnly ?? false

  const errorMessage =
    lettersQuery.error?.message ?? (isInitialState ? initialError : null)

  const hasActiveFilter =
    Boolean(debouncedSearch) ||
    status !== "all" ||
    letterTypeId !== "all" ||
    sort !== "desc"

  const roleNotice = getLetterRoleBannerNotice(roles)
  const canManage = canShowManageLettersCta(roles)

  function handleResetFilters() {
    setSearchInput("")
    setDebouncedSearch("")
    setStatus("all")
    setLetterTypeId("all")
    setSort("desc")
    setPage(1)
  }

  return (
    <PageContainer className="flex flex-col gap-[var(--space-6)]">
      <PageHeader
        title="Surat Pengantar Warga"
        description="Kelola pengajuan surat keterangan/pengantar warga RT, verifikasi berkas, dan penerbitan PDF resmi."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/surat/jenis" />}
            >
              <Settings2Icon className="size-4" />
              <span>{canManage ? "Kelola Jenis Surat" : "Daftar Jenis Surat"}</span>
            </Button>
          </div>
        }
      />

      {roleNotice && (
        <div
          role="status"
          data-testid="letters-admin-role-notice"
          className="flex items-start gap-3 rounded-xl border border-info/30 bg-info-subtle/40 px-4 py-3 text-sm text-foreground"
        >
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-info" />
          <div className="space-y-0.5">
            <p className="font-medium">{roleNotice.title}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {roleNotice.description}
            </p>
          </div>
        </div>
      )}

      {/* Status Summary Grid */}
      <section
        aria-label="Ringkasan Status Permohonan Surat"
        className="grid grid-cols-2 gap-[var(--space-3)] sm:grid-cols-3 sm:gap-[var(--space-4)] xl:grid-cols-6"
      >
        {LETTER_STATUSES.map((st) => (
          <Card key={st}>
            <CardContent className="flex flex-col gap-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <Badge
                  variant={getLetterRequestStatusBadgeVariant(st)}
                  size="sm"
                >
                  {LETTER_STATUS_LABELS[st]}
                </Badge>
              </div>
              <span className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">
                {summary[st]}
              </span>
            </CardContent>
          </Card>
        ))}
      </section>

      {/* Filter & Search Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">
                Filter &amp; Pencarian
              </CardTitle>
              <CardDescription>
                Saring permohonan berdasarkan kata kunci, status, jenis surat,
                atau urutan tanggal pengajuan.
              </CardDescription>
            </div>
            {hasActiveFilter && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleResetFilters}
              >
                <RotateCcwIcon className="size-3.5" />
                <span>Reset Filter</span>
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Cari nomor surat atau keperluan..."
              aria-label="Cari permohonan surat"
              className="pl-9"
            />
          </div>

          <select
            aria-label="Filter Status Surat"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as "all" | LetterRequestStatus)
              setPage(1)
            }}
            className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-2xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
          >
            {LETTER_STATUS_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter Jenis Surat"
            value={letterTypeId}
            onChange={(e) => {
              setLetterTypeId(e.target.value)
              setPage(1)
            }}
            className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-2xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
          >
            <option value="all">Semua Jenis Surat</option>
            {letterTypes.map((lt) => (
              <option key={lt.id} value={lt.id}>
                {lt.code} — {lt.name}
                {lt.isActive ? "" : " (Nonaktif)"}
              </option>
            ))}
          </select>

          <select
            aria-label="Urutkan Permohonan Surat"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as "desc" | "asc")
              setPage(1)
            }}
            className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-2xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
          >
            {LETTER_SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

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

      {/* List Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <div>
            <CardTitle className="text-base">
              Daftar Permohonan ({totalCount})
            </CardTitle>
            <CardDescription>
              Halaman {page} dari {totalPages} • Total {summary.total}{" "}
              permohonan tercatat
            </CardDescription>
          </div>
          {lettersQuery.isFetching && !lettersQuery.isLoading && (
            <span className="text-xs text-muted-foreground">Memperbarui...</span>
          )}
        </CardHeader>

        <CardContent className="p-0 sm:p-6 sm:pt-0">
          {lettersQuery.isLoading && !data ? (
            <div className="space-y-3 p-4 sm:p-0">
              {Array.from({ length: 5 }).map((_, idx) => (
                <Skeleton key={idx} className="h-14 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-surface-subtle text-muted-foreground">
                <InboxIcon className="size-6" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {hasActiveFilter
                    ? "Tidak ada permohonan surat yang cocok dengan filter"
                    : "Belum ada permohonan surat dari warga"}
                </p>
                <p className="max-w-md text-xs text-muted-foreground">
                  {hasActiveFilter
                    ? "Coba ubah kata kunci pencarian atau reset filter untuk melihat seluruh permohonan."
                    : "Permohonan surat baru yang diajukan warga akan tampil di daftar ini."}
                </p>
              </div>
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
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>No. Permohonan / Surat</TableHead>
                      <TableHead>Pemohon</TableHead>
                      <TableHead>Jenis Surat</TableHead>
                      {!isMetadataOnly && <TableHead>Keperluan</TableHead>}
                      <TableHead>Tanggal Pengajuan</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="align-top">
                          <div className="space-y-1">
                            <Link
                              href={`/surat/${item.id}`}
                              className="font-medium text-foreground hover:text-primary hover:underline"
                            >
                              {item.letterNumber ?? getLetterRequestCode(item.id)}
                            </Link>
                            {!isMetadataOnly && (
                              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                {item.attachmentCount > 0 && (
                                  <span className="inline-flex items-center gap-1">
                                    <PaperclipIcon className="size-3" />
                                    {item.attachmentCount} lampiran
                                  </span>
                                )}
                                {item.hasIssuedPdf && (
                                  <span className="inline-flex items-center gap-1 text-success">
                                    <FileCheck2Icon className="size-3" />
                                    PDF terbit
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="space-y-0.5">
                            <p className="text-sm font-medium text-foreground">
                              {item.residentName}
                            </p>
                            {item.residentUnitLabel && (
                              <p className="text-xs text-muted-foreground">
                                {item.residentUnitLabel}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="space-y-0.5">
                            <Badge variant="outline" size="sm">
                              {item.letterTypeCode}
                            </Badge>
                            <p className="text-xs text-muted-foreground">
                              {item.letterTypeName}
                            </p>
                          </div>
                        </TableCell>
                        {!isMetadataOnly && (
                          <TableCell className="max-w-xs align-top">
                            <p className="line-clamp-2 text-xs text-muted-foreground">
                              {truncateLetterText(item.purpose, 90)}
                            </p>
                          </TableCell>
                        )}
                        <TableCell className="align-top text-xs whitespace-nowrap text-muted-foreground">
                          {formatLetterDateTime(item.createdAt)}
                        </TableCell>
                        <TableCell className="align-top">
                          <Badge
                            variant={getLetterRequestStatusBadgeVariant(
                              item.status
                            )}
                            size="sm"
                          >
                            {getLetterRequestStatusLabel(item.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right align-top">
                          <Button
                            variant="outline"
                            size="sm"
                            nativeButton={false}
                            render={<Link href={`/surat/${item.id}`} />}
                          >
                            <EyeIcon className="size-3.5" />
                            <span>Detail</span>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Cards */}
              <div className="flex flex-col gap-3 p-4 md:hidden">
                {items.map((item) => (
                  <Link
                    key={item.id}
                    href={`/surat/${item.id}`}
                    className="block rounded-xl border border-border bg-background p-4 transition-colors hover:border-primary/40"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" size="sm">
                            {item.letterTypeCode}
                          </Badge>
                          <span className="text-xs font-medium text-muted-foreground">
                            {item.letterNumber ?? getLetterRequestCode(item.id)}
                          </span>
                        </div>
                        <p className="truncate text-sm font-semibold text-foreground">
                          {item.letterTypeName}
                        </p>
                      </div>
                      <Badge
                        variant={getLetterRequestStatusBadgeVariant(
                          item.status
                        )}
                        size="sm"
                      >
                        {getLetterRequestStatusLabel(item.status)}
                      </Badge>
                    </div>

                    <div className="mt-2.5 space-y-1 text-xs text-muted-foreground">
                      <p className="font-medium text-foreground">
                        {item.residentName}
                        {item.residentUnitLabel
                          ? ` • ${item.residentUnitLabel}`
                          : ""}
                      </p>
                      {!isMetadataOnly && (
                        <p className="line-clamp-2">{item.purpose}</p>
                      )}
                      <div className="flex items-center justify-between pt-1">
                        <span>{formatLetterDateTime(item.createdAt)}</span>
                        <span className="inline-flex items-center gap-1 font-medium text-primary">
                          <FileTextIcon className="size-3.5" />
                          Buka Detail
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            Menampilkan halaman{" "}
            <span className="font-medium text-foreground">{page}</span> dari{" "}
            <span className="font-medium text-foreground">{totalPages}</span>
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1 || lettersQuery.isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeftIcon className="size-4" />
              <span>Sebelumnya</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= totalPages || lettersQuery.isFetching}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <span>Berikutnya</span>
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </PageContainer>
  )
}

