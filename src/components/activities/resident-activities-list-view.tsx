"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertCircleIcon,
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  HistoryIcon,
  MapPinIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  UsersIcon,
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
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_CATEGORY_LABELS,
  ACTIVITY_STATUS_LABELS,
  ACTIVITY_STATUSES,
} from "@/lib/activities/constants"
import {
  formatActivityCategoryLabel,
  formatActivityDateTimeRange,
  formatActivityParticipantStatusLabel,
  formatActivityQuotaSummary,
  formatActivityStatusLabel,
} from "@/lib/activities/formatters"
import { useResidentActivities } from "@/lib/activities/hooks"
import type {
  ActivityCategory,
  ActivitySortDirection,
  ActivitySortField,
  ActivityStatus,
  ResidentActivityPageResult,
} from "@/lib/activities/types"
import {
  formatJakartaDateTimeShort,
  getActivityCategoryBadgeVariant,
  getActivityStatusBadgeVariant,
  getParticipantStatusBadgeVariant,
} from "@/lib/activities/ui-helpers"

interface ResidentActivitiesListViewProps {
  tenantId: string
  actorKey: string
  initialFilters: {
    search: string
    status: "all" | ActivityStatus
    category: "all" | ActivityCategory
    upcomingOnly: boolean
    sortBy: ActivitySortField
    sort: ActivitySortDirection
    page: number
  }
  initialData: ResidentActivityPageResult | null
  initialError: string | null
}

export function ResidentActivitiesListView({
  tenantId,
  actorKey,
  initialFilters,
  initialData,
  initialError,
}: ResidentActivitiesListViewProps) {
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
  const [sortOption, setSortOption] = React.useState<
    "start_at:asc" | "start_at:desc"
  >(
    initialFilters.sortBy === "start_at" && initialFilters.sort === "desc"
      ? "start_at:desc"
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
    sortBy === initialFilters.sortBy &&
    sort === initialFilters.sort &&
    page === initialFilters.page

  const query = useResidentActivities({
    tenantId,
    actorKey,
    filters: {
      search: debouncedSearch || undefined,
      status: status === "all" ? undefined : status,
      category: category === "all" ? undefined : category,
      upcomingOnly: upcomingOnly ? true : undefined,
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

  const hasActiveFilter =
    Boolean(debouncedSearch) ||
    status !== "all" ||
    category !== "all" ||
    upcomingOnly ||
    sortOption !== "start_at:asc"

  function handleResetFilters() {
    setSearchInput("")
    setDebouncedSearch("")
    setStatus("all")
    setCategory("all")
    setUpcomingOnly(false)
    setSortOption("start_at:asc")
    setPage(1)
  }

  return (
    <ResidentContainer className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="font-heading text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Kegiatan Warga
          </h1>
          <p className="text-sm text-muted-foreground">
            Lihat jadwal kegiatan RT, cek kuota peserta, dan daftarkan diri
            Anda.
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href="/resident/activities/my" />}
          className="h-10 shrink-0"
        >
          <HistoryIcon className="size-4" />
          <span>Kegiatan &amp; Riwayat Saya</span>
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Cari judul atau lokasi kegiatan..."
              aria-label="Cari kegiatan warga"
              className="h-10 pl-9"
            />
          </div>

          <div className="grid gap-2.5 sm:grid-cols-3">
            <select
              aria-label="Filter Kategori Kegiatan"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value as "all" | ActivityCategory)
                setPage(1)
              }}
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-2xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
            >
              <option value="all">Semua Kategori</option>
              {ACTIVITY_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {ACTIVITY_CATEGORY_LABELS[cat]}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter Status Kegiatan"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as "all" | ActivityStatus)
                setPage(1)
              }}
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-2xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
            >
              <option value="all">Semua Status</option>
              {ACTIVITY_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {ACTIVITY_STATUS_LABELS[st]}
                </option>
              ))}
            </select>

            <select
              aria-label="Urutkan Jadwal Kegiatan"
              value={sortOption}
              onChange={(e) => {
                setSortOption(
                  e.target.value as "start_at:asc" | "start_at:desc"
                )
                setPage(1)
              }}
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-2xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
            >
              <option value="start_at:asc">Jadwal Terdekat</option>
              <option value="start_at:desc">Jadwal Terbaru</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground">
              <Checkbox
                checked={upcomingOnly}
                onCheckedChange={(checked) => {
                  setUpcomingOnly(checked === true)
                  setPage(1)
                }}
              />
              <span>Hanya kegiatan akan datang</span>
            </label>

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
        </CardContent>
      </Card>

      {/* Activity Feed */}
      {query.isLoading && !data ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-3 p-4">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-9 w-full rounded-lg" />
              </CardContent>
            </Card>
          ))}
        </div>
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
              <span>Muat Ulang</span>
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
                  ? "Coba ubah filter atau kata kunci pencarian."
                  : "Kegiatan RT yang dipublikasikan pengurus akan tampil di sini."}
              </p>
            </div>
            {hasActiveFilter && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleResetFilters}
              >
                <RotateCcwIcon className="size-3.5" />
                <span>Reset Filter</span>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {data.items.map((item) => (
            <Card key={item.id} className="transition-colors hover:border-primary/40">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant={getActivityCategoryBadgeVariant(item.category)}
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
                    {item.isFull && (
                      <Badge variant="destructive" size="sm">
                        Kuota Penuh
                      </Badge>
                    )}
                    {item.myRegistration && (
                      <Badge
                        variant={getParticipantStatusBadgeVariant(
                          item.myRegistration.rsvpStatus
                        )}
                        size="sm"
                      >
                        Status Anda:{" "}
                        {formatActivityParticipantStatusLabel(
                          item.myRegistration.rsvpStatus
                        )}
                      </Badge>
                    )}
                  </div>
                </div>
                <CardTitle className="pt-1 text-base leading-snug">
                  <Link
                    href={`/resident/activities/${item.id}`}
                    className="hover:text-primary hover:underline"
                  >
                    {item.title}
                  </Link>
                </CardTitle>
                {item.description && (
                  <CardDescription className="line-clamp-2 text-xs">
                    {item.description}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div className="space-y-1.5 text-xs text-muted-foreground">
                  <p className="flex items-center gap-1.5 text-foreground">
                    <CalendarDaysIcon className="size-3.5 shrink-0 text-primary" />
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
                      {formatActivityQuotaSummary(
                        item.activeParticipantCount,
                        item.maxParticipants
                      )}
                    </span>
                  </p>
                  {item.registrationDeadline && (
                    <p className="flex items-center gap-1.5">
                      <ClockIcon className="size-3.5 shrink-0" />
                      <span>
                        Batas daftar:{" "}
                        {formatJakartaDateTimeShort(item.registrationDeadline)}
                      </span>
                    </p>
                  )}
                </div>

                <Button
                  type="button"
                  variant={item.canRegister ? "default" : "outline"}
                  size="sm"
                  className="h-10 w-full justify-between"
                  nativeButton={false}
                  render={<Link href={`/resident/activities/${item.id}`} />}
                >
                  <span>
                    {item.canRegister
                      ? "Lihat Detail & Daftar"
                      : "Lihat Detail Kegiatan"}
                  </span>
                  <ChevronRightIcon className="size-4" />
                </Button>
              </CardContent>
            </Card>
          ))}

          {/* Pagination */}
          {data.totalPages > 1 && (
            <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
              <span>
                Halaman {data.page} dari {data.totalPages} ({data.totalCount}{" "}
                kegiatan)
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9"
                  disabled={data.page <= 1 || query.isFetching}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeftIcon className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9"
                  disabled={data.page >= data.totalPages || query.isFetching}
                  onClick={() =>
                    setPage((p) => Math.min(data.totalPages, p + 1))
                  }
                >
                  <ChevronRightIcon className="size-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </ResidentContainer>
  )
}

