"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertCircleIcon,
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  InfoIcon,
  MapPinIcon,
  PaperclipIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  UsersIcon,
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
import { Checkbox } from "@/components/ui/checkbox"
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
  ACTIVITY_CATEGORIES,
  ACTIVITY_CATEGORY_LABELS,
  ACTIVITY_STATUS_LABELS,
  ACTIVITY_STATUSES,
} from "@/lib/activities/constants"
import {
  formatActivityCategoryLabel,
  formatActivityDateTimeRange,
  formatActivityStatusLabel,
} from "@/lib/activities/formatters"
import { useAdminActivities } from "@/lib/activities/hooks"
import {
  canManageActivities,
  type ActivityCategory,
  type ActivityPageResult,
  type ActivitySortDirection,
  type ActivitySortField,
  type ActivityStatus,
} from "@/lib/activities/types"
import {
  getActivityCategoryBadgeVariant,
  getActivityStatusBadgeVariant,
  getAdminActivitiesRoleBanner,
} from "@/lib/activities/ui-helpers"

interface ActivitiesAdminListViewProps {
  tenantId: string
  actorKey: string
  roles: readonly RoleCode[]
  initialFilters: {
    search: string
    status: "all" | ActivityStatus
    category: "all" | ActivityCategory
    upcomingOnly: boolean
    includeDeleted: boolean
    sortBy: ActivitySortField
    sort: ActivitySortDirection
    page: number
  }
  initialData: ActivityPageResult | null
  initialError: string | null
  notice?: "deleted" | null
}

type SortOptionValue = "start_at:asc" | "start_at:desc" | "created_at:desc"

export function ActivitiesAdminListView({
  tenantId,
  actorKey,
  roles,
  initialFilters,
  initialData,
  initialError,
  notice = null,
}: ActivitiesAdminListViewProps) {
  const canManage = canManageActivities(roles)
  const roleBanner = getAdminActivitiesRoleBanner(roles)

  const [searchInput, setSearchInput] = React.useState(initialFilters.search)
  const [debouncedSearch, setDebouncedSearch] = React.useState(
    initialFilters.search
  )
  const [status, setStatus] = React.useState<"all" | ActivityStatus>(
    initialFilters.status
  )
  const [category, setCategory] = React.useState<"all" | ActivityCategory>(
    initialFilters.category
  )
  const [upcomingOnly, setUpcomingOnly] = React.useState(
    initialFilters.upcomingOnly
  )
  const [includeDeleted, setIncludeDeleted] = React.useState(
    initialFilters.includeDeleted
  )
  const [sortOption, setSortOption] = React.useState<SortOptionValue>(
    `${initialFilters.sortBy}:${initialFilters.sort}` === "start_at:desc"
      ? "start_at:desc"
      : `${initialFilters.sortBy}:${initialFilters.sort}` === "created_at:desc"
        ? "created_at:desc"
        : "start_at:asc"
  )
  const [page, setPage] = React.useState(initialFilters.page)

  const [sortBy, sort] = sortOption.split(":") as [
    ActivitySortField,
    ActivitySortDirection,
  ]

  React.useEffect(() => {
    const trimmed = searchInput.trim()
    const timer = window.setTimeout(() => {
      setDebouncedSearch((prev) => {
        if (prev !== trimmed) {
          setPage(1)
        }
        return trimmed
      })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const isInitialState =
    debouncedSearch === initialFilters.search &&
    status === initialFilters.status &&
    category === initialFilters.category &&
    upcomingOnly === initialFilters.upcomingOnly &&
    includeDeleted === initialFilters.includeDeleted &&
    sortBy === initialFilters.sortBy &&
    sort === initialFilters.sort &&
    page === initialFilters.page

  const query = useAdminActivities({
    tenantId,
    actorKey,
    filters: {
      search: debouncedSearch || undefined,
      status: status === "all" ? undefined : status,
      category: category === "all" ? undefined : category,
      upcomingOnly: upcomingOnly ? true : undefined,
      includeDeleted: includeDeleted ? true : undefined,
      sortBy,
      sort,
      page,
      pageSize: 10,
    },
    initialData: isInitialState ? (initialData ?? undefined) : undefined,
  })

  const data = query.data ?? (isInitialState ? initialData : null)
  const errorMessage =
    query.error?.message ?? (isInitialState ? initialError : null)

  const summary = data?.summary ?? {
    scheduled: 0,
    ongoing: 0,
    completed: 0,
    cancelled: 0,
    total: 0,
  }

  const hasActiveFilter =
    Boolean(debouncedSearch) ||
    status !== "all" ||
    category !== "all" ||
    upcomingOnly ||
    includeDeleted ||
    sortOption !== "start_at:asc"

  function handleResetFilters() {
    setSearchInput("")
    setDebouncedSearch("")
    setStatus("all")
    setCategory("all")
    setUpcomingOnly(false)
    setIncludeDeleted(false)
    setSortOption("start_at:asc")
    setPage(1)
  }

  return (
    <PageContainer className="space-y-6">
      <PageHeader
        title="Kegiatan Warga"
        description="Kelola jadwal kegiatan RT, pendaftaran peserta, pencatatan presensi, dan dokumentasi pelaksanaan."
        actions={
          canManage ? (
            <Button
              type="button"
              size="sm"
              nativeButton={false}
              render={<Link href="/kegiatan/new" />}
            >
              <PlusIcon className="size-4" />
              <span>Buat Kegiatan</span>
            </Button>
          ) : undefined
        }
      />

      {notice === "deleted" && (
        <div
          role="status"
          className="rounded-xl border border-success-border bg-success-subtle/40 px-4 py-3 text-sm text-success-text"
        >
          Kegiatan warga berhasil diarsipkan dari daftar aktif.
        </div>
      )}

      {roleBanner && (
        <div
          role="status"
          data-testid="activities-admin-role-notice"
          className="flex items-start gap-3 rounded-xl border border-info/30 bg-info-subtle/40 px-4 py-3 text-sm text-foreground"
        >
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-info" />
          <div className="space-y-0.5">
            <p className="font-medium">{roleBanner.title}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {roleBanner.description}
            </p>
          </div>
        </div>
      )}

      {/* Status KPI Grid */}
      <section
        aria-label="Ringkasan Status Kegiatan Warga"
        className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
      >
        {ACTIVITY_STATUSES.map((st) => (
          <Card key={st}>
            <CardContent className="flex flex-col gap-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <Badge variant={getActivityStatusBadgeVariant(st)} size="sm">
                  {ACTIVITY_STATUS_LABELS[st]}
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
                Saring kegiatan berdasarkan judul/lokasi, status, kategori, atau
                urutan jadwal pelaksanaan.
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
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Cari judul atau lokasi..."
                aria-label="Cari kegiatan warga"
                className="pl-9"
              />
            </div>

            <select
              aria-label="Filter Status Kegiatan"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as "all" | ActivityStatus)
                setPage(1)
              }}
              className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-2xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
            >
              <option value="all">Semua Status</option>
              {ACTIVITY_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {ACTIVITY_STATUS_LABELS[st]}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter Kategori Kegiatan"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value as "all" | ActivityCategory)
                setPage(1)
              }}
              className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-2xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
            >
              <option value="all">Semua Kategori</option>
              {ACTIVITY_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {ACTIVITY_CATEGORY_LABELS[cat]}
                </option>
              ))}
            </select>

            <select
              aria-label="Urutkan Kegiatan"
              value={sortOption}
              onChange={(e) => {
                setSortOption(e.target.value as SortOptionValue)
                setPage(1)
              }}
              className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-2xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
            >
              <option value="start_at:asc">Jadwal Terdekat (Asc)</option>
              <option value="start_at:desc">Jadwal Terbaru (Desc)</option>
              <option value="created_at:desc">Baru Dibuat</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-5 pt-1">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground">
              <Checkbox
                checked={upcomingOnly}
                onCheckedChange={(checked) => {
                  setUpcomingOnly(checked === true)
                  setPage(1)
                }}
              />
              <span>Hanya kegiatan mendatang</span>
            </label>

            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground">
              <Checkbox
                checked={includeDeleted}
                onCheckedChange={(checked) => {
                  setIncludeDeleted(checked === true)
                  setPage(1)
                }}
              />
              <span>Tampilkan kegiatan diarsipkan</span>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {query.isLoading && !data ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </CardContent>
        </Card>
      ) : errorMessage && !data ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 p-8 text-center">
            <AlertCircleIcon className="size-8 text-destructive" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                Gagal Memuat Daftar Kegiatan
              </p>
              <p className="text-xs text-muted-foreground">{errorMessage}</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => query.refetch()}
            >
              <RefreshCwIcon className="size-3.5" />
              <span>Coba Lagi</span>
            </Button>
          </CardContent>
        </Card>
      ) : !data || data.items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 p-10 text-center">
            <CalendarDaysIcon className="size-9 text-muted-foreground/60" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                Belum ada kegiatan yang sesuai
              </p>
              <p className="text-xs text-muted-foreground">
                {hasActiveFilter
                  ? "Coba ubah kata kunci atau reset filter pencarian."
                  : canManage
                    ? "Klik tombol Buat Kegiatan untuk menjadwalkan agenda RT baru."
                    : "Belum ada agenda kegiatan warga pada workspace RT ini."}
              </p>
            </div>
            {hasActiveFilter ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleResetFilters}
              >
                <RotateCcwIcon className="size-3.5" />
                <span>Reset Filter</span>
              </Button>
            ) : canManage ? (
              <Button
                type="button"
                size="sm"
                nativeButton={false}
                render={<Link href="/kegiatan/new" />}
              >
                <PlusIcon className="size-4" />
                <span>Buat Kegiatan Pertama</span>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            {/* Desktop Table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kegiatan</TableHead>
                    <TableHead>Kategori</TableHead>
                    <TableHead>Jadwal &amp; Lokasi</TableHead>
                    <TableHead>Peserta</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((item) => (
                    <TableRow
                      key={item.id}
                      className={item.deletedAt ? "opacity-65" : undefined}
                    >
                      <TableCell>
                        <div className="space-y-0.5">
                          <Link
                            href={`/kegiatan/${item.id}`}
                            className="font-medium text-foreground hover:text-primary hover:underline"
                          >
                            {item.title}
                          </Link>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {item.documentCount > 0 && (
                              <span className="inline-flex items-center gap-1">
                                <PaperclipIcon className="size-3" />
                                {item.documentCount} dok
                              </span>
                            )}
                            {item.deletedAt && (
                              <Badge variant="outline" size="sm">
                                Diarsipkan
                              </Badge>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={getActivityCategoryBadgeVariant(
                            item.category
                          )}
                          size="sm"
                        >
                          {formatActivityCategoryLabel(item.category)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5 text-xs">
                          <p className="font-medium text-foreground">
                            {formatActivityDateTimeRange(
                              item.startAt,
                              item.endAt
                            )}
                          </p>
                          <p className="flex items-center gap-1 text-muted-foreground">
                            <MapPinIcon className="size-3 shrink-0" />
                            <span className="truncate">{item.location}</span>
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground tabular-nums">
                          <UsersIcon className="size-3.5 text-muted-foreground" />
                          {item.maxParticipants !== null
                            ? `${item.activeParticipantCount} / ${item.maxParticipants}`
                            : `${item.activeParticipantCount} terdaftar`}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={getActivityStatusBadgeVariant(item.status)}
                          size="sm"
                        >
                          {formatActivityStatusLabel(item.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          nativeButton={false}
                          render={<Link href={`/kegiatan/${item.id}`} />}
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
            <div className="divide-y divide-border md:hidden">
              {data.items.map((item) => (
                <div
                  key={item.id}
                  className="space-y-2.5 p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <Link
                        href={`/kegiatan/${item.id}`}
                        className="block truncate text-sm font-semibold text-foreground hover:text-primary"
                      >
                        {item.title}
                      </Link>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge
                          variant={getActivityCategoryBadgeVariant(
                            item.category
                          )}
                          size="sm"
                        >
                          {formatActivityCategoryLabel(item.category)}
                        </Badge>
                        <Badge
                          variant={getActivityStatusBadgeVariant(item.status)}
                          size="sm"
                        >
                          {formatActivityStatusLabel(item.status)}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p className="flex items-center gap-1.5 text-foreground">
                      <CalendarDaysIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span>
                        {formatActivityDateTimeRange(item.startAt, item.endAt)}
                      </span>
                    </p>
                    <p className="flex items-center gap-1.5">
                      <MapPinIcon className="size-3.5 shrink-0" />
                      <span>{item.location}</span>
                    </p>
                    <p className="flex items-center gap-1.5 tabular-nums">
                      <UsersIcon className="size-3.5 shrink-0" />
                      <span>
                        {item.maxParticipants !== null
                          ? `${item.activeParticipantCount} / ${item.maxParticipants} peserta`
                          : `${item.activeParticipantCount} peserta terdaftar`}
                      </span>
                    </p>
                  </div>

                  <div className="pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full"
                      nativeButton={false}
                      render={<Link href={`/kegiatan/${item.id}`} />}
                    >
                      <EyeIcon className="size-3.5" />
                      <span>Lihat Detail</span>
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination Footer */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
              <span>
                Menampilkan halaman {data.page} dari {data.totalPages} (
                {data.totalCount} kegiatan)
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={data.page <= 1 || query.isFetching}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeftIcon className="size-3.5" />
                  <span>Sebelumnya</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={data.page >= data.totalPages || query.isFetching}
                  onClick={() =>
                    setPage((p) => Math.min(data.totalPages, p + 1))
                  }
                >
                  <span>Berikutnya</span>
                  <ChevronRightIcon className="size-3.5" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  )
}

