"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertCircleIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  ClockIcon,
  EyeIcon,
  InfoIcon,
  MapPinIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
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
import { Input } from "@/components/ui/input"
import {
  buildRondaMonthCalendar,
  formatMonthTitle,
  formatRondaDateLong,
  formatRondaTimeRange,
  getMonthDateRange,
  getMonthKeyFromDate,
  shiftMonthKey,
} from "@/lib/ronda/formatters"
import type { RondaSchedulePageResult } from "@/lib/ronda/types"
import { useAdminRondaSchedules } from "@/lib/ronda/use-ronda"

interface RondaAdminListViewProps {
  tenantId: string
  canManage: boolean
  canReadAttendanceSummary: boolean
  todayDate: string
  initialFilters: {
    fromDate: string
    toDate: string
    page: number
    viewMonth: string
  }
  initialData: RondaSchedulePageResult | null
  initialError: string | null
  notice?: string | null
}

const WEEKDAY_HEADERS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"]

export function RondaAdminListView({
  tenantId,
  canManage,
  canReadAttendanceSummary,
  todayDate,
  initialFilters,
  initialData,
  initialError,
  notice,
}: RondaAdminListViewProps) {
  const [viewMonth, setViewMonth] = React.useState(initialFilters.viewMonth)
  const [fromDate, setFromDate] = React.useState(initialFilters.fromDate)
  const [toDate, setToDate] = React.useState(initialFilters.toDate)
  const [page, setPage] = React.useState(initialFilters.page)
  const [draftFromDate, setDraftFromDate] = React.useState(
    initialFilters.fromDate
  )
  const [draftToDate, setDraftToDate] = React.useState(initialFilters.toDate)

  const isInitialState =
    fromDate === initialFilters.fromDate &&
    toDate === initialFilters.toDate &&
    page === initialFilters.page

  const scheduleQuery = useAdminRondaSchedules({
    tenantId,
    filters: {
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      page,
      pageSize: 20,
    },
    initialData: isInitialState ? (initialData ?? undefined) : undefined,
  })

  // Query separate month items for the calendar grid when viewing month without same bounds
  const monthBounds = React.useMemo(
    () => getMonthDateRange(viewMonth),
    [viewMonth]
  )
  const calendarCoversSameRange =
    fromDate === monthBounds.fromDate &&
    toDate === monthBounds.toDate &&
    page === 1

  const calendarQuery = useAdminRondaSchedules({
    tenantId,
    filters: {
      fromDate: monthBounds.fromDate,
      toDate: monthBounds.toDate,
      page: 1,
      pageSize: 31,
    },
    initialData:
      calendarCoversSameRange && initialData ? initialData : undefined,
    enabled: !calendarCoversSameRange,
  })

  const data = scheduleQuery.data ?? (isInitialState ? initialData : undefined)
  const items = React.useMemo(() => data?.items ?? [], [data?.items])
  const totalCount = data?.totalCount ?? 0
  const totalPages = data?.totalPages ?? 1
  const errorMessage =
    scheduleQuery.error instanceof Error
      ? scheduleQuery.error.message
      : isInitialState
        ? initialError
        : null

  const calendarItems = React.useMemo(
    () =>
      calendarCoversSameRange ? items : (calendarQuery.data?.items ?? []),
    [calendarCoversSameRange, items, calendarQuery.data?.items]
  )
  const calendarCells = React.useMemo(
    () => buildRondaMonthCalendar(viewMonth, calendarItems),
    [viewMonth, calendarItems]
  )

  function handleSelectMonth(nextMonth: string) {
    setViewMonth(nextMonth)
    const range = getMonthDateRange(nextMonth)
    setFromDate(range.fromDate)
    setToDate(range.toDate)
    setDraftFromDate(range.fromDate)
    setDraftToDate(range.toDate)
    setPage(1)
  }

  function handleApplyFilter(e: React.FormEvent) {
    e.preventDefault()
    setFromDate(draftFromDate)
    setToDate(draftToDate)
    if (draftFromDate) {
      setViewMonth(getMonthKeyFromDate(draftFromDate))
    }
    setPage(1)
  }

  function handleResetFilter() {
    const defaultMonth = getMonthKeyFromDate(todayDate)
    const range = getMonthDateRange(defaultMonth)
    setViewMonth(defaultMonth)
    setFromDate(range.fromDate)
    setToDate(range.toDate)
    setDraftFromDate(range.fromDate)
    setDraftToDate(range.toDate)
    setPage(1)
  }

  function handleShowUpcoming() {
    setFromDate(todayDate)
    setToDate("")
    setDraftFromDate(todayDate)
    setDraftToDate("")
    setViewMonth(getMonthKeyFromDate(todayDate))
    setPage(1)
  }

  function handleShowAll() {
    setFromDate("")
    setToDate("")
    setDraftFromDate("")
    setDraftToDate("")
    setPage(1)
  }

  return (
    <PageContainer className="flex flex-col gap-[var(--space-6)]">
      <PageHeader
        title="Jadwal Ronda"
        description="Atur jadwal ronda malam manual dan daftar warga yang bertugas di lingkungan RT."
        actions={
          <div className="flex flex-wrap items-center gap-[var(--space-2)]">
            {canReadAttendanceSummary && (
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link href="/ronda/attendance" />}
              >
                <ClipboardListIcon className="size-4" />
                <span>Rekap Kehadiran</span>
              </Button>
            )}
            {canManage && (
              <Button nativeButton={false} render={<Link href="/ronda/new" />}>
                <PlusIcon className="size-4" />
                <span>Tambah Jadwal</span>
              </Button>
            )}
          </div>
        }
      />

      {notice === "deleted" && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-success/30 bg-success-subtle px-4 py-3 text-sm text-success"
        >
          <CheckCircle2Icon className="size-4 shrink-0" />
          <span>Jadwal ronda berhasil dihapus.</span>
        </div>
      )}

      {notice === "readonly" && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning-subtle px-4 py-3 text-sm text-warning"
        >
          <InfoIcon className="size-4 shrink-0" />
          <span>
            Peran Anda hanya memiliki akses lihat untuk daftar jadwal ronda.
          </span>
        </div>
      )}

      {!canManage && notice !== "readonly" && (
        <div
          role="note"
          className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
        >
          <InfoIcon className="size-4 shrink-0 text-foreground" />
          <span>
            Mode lihat: pengelolaan jadwal dan pencatatan kehadiran hanya
            tersedia bagi Ketua RT dan Sekretaris.
          </span>
        </div>
      )}

      {/* Calendar Navigator */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDaysIcon className="size-4 text-primary" />
              <span>Kalender {formatMonthTitle(viewMonth)}</span>
            </CardTitle>
            <CardDescription>
              Klik tanggal terjadwal untuk melihat detail petugas
              {canManage
                ? ", atau klik tanggal kosong untuk menambah jadwal."
                : "."}
            </CardDescription>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleSelectMonth(shiftMonthKey(viewMonth, -1))}
              aria-label="Bulan sebelumnya"
            >
              <ChevronLeftIcon className="size-4" />
              <span className="hidden sm:inline">Sebelumnya</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleResetFilter}
            >
              Bulan Ini
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleSelectMonth(shiftMonthKey(viewMonth, 1))}
              aria-label="Bulan berikutnya"
            >
              <span className="hidden sm:inline">Berikutnya</span>
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground sm:gap-1.5 sm:text-xs">
            {WEEKDAY_HEADERS.map((day) => (
              <div key={day} className="py-1">
                {day}
              </div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1 sm:gap-1.5">
            {calendarCells.map((cell) => {
              const isToday = cell.isoDate === todayDate
              const hasSchedule = Boolean(cell.schedule)
              const baseClass = [
                "flex min-h-12 flex-col justify-between rounded-lg border p-1 text-left transition-colors sm:min-h-14 sm:p-1.5",
                cell.inCurrentMonth
                  ? "bg-surface text-foreground"
                  : "bg-muted/30 text-muted-foreground/60",
                isToday ? "ring-2 ring-primary/50" : "",
                hasSchedule
                  ? "border-primary/40 bg-primary-subtle/30 hover:bg-primary-subtle/60"
                  : canManage
                    ? "border-border-subtle hover:border-primary/30 hover:bg-muted/40"
                    : "border-border-subtle",
              ]
                .filter(Boolean)
                .join(" ")

              if (cell.schedule) {
                return (
                  <Link
                    key={cell.isoDate}
                    href={`/ronda/${cell.schedule.id}`}
                    className={baseClass}
                    title={`${cell.schedule.shiftLabel} (${cell.schedule.assignedCount} petugas)`}
                  >
                    <div className="flex items-center justify-between gap-0.5">
                      <span className="text-[11px] font-semibold tabular-nums sm:text-xs">
                        {cell.dayNumber}
                      </span>
                      {isToday && (
                        <>
                          <span
                            className="size-1.5 rounded-full bg-primary sm:hidden"
                            aria-label="Hari ini"
                          />
                          <span className="hidden rounded bg-primary px-1 text-[10px] font-medium text-primary-foreground sm:inline">
                            Hari Ini
                          </span>
                        </>
                      )}
                    </div>
                    <div className="truncate text-[10px] font-medium text-primary sm:text-[11px]">
                      <span>{cell.schedule.assignedCount}</span>
                      <span className="hidden sm:inline"> petugas</span>
                    </div>
                  </Link>
                )
              }

              if (canManage && cell.inCurrentMonth) {
                return (
                  <Link
                    key={cell.isoDate}
                    href={`/ronda/new?date=${cell.isoDate}`}
                    className={baseClass}
                    title={`Tambah jadwal ronda ${cell.isoDate}`}
                  >
                    <div className="flex items-center justify-between gap-0.5">
                      <span className="text-[11px] font-medium tabular-nums sm:text-xs">
                        {cell.dayNumber}
                      </span>
                      {isToday && (
                        <>
                          <span
                            className="size-1.5 rounded-full bg-primary sm:hidden"
                            aria-label="Hari ini"
                          />
                          <span className="hidden rounded bg-primary px-1 text-[10px] font-medium text-primary-foreground sm:inline">
                            Hari Ini
                          </span>
                        </>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground opacity-60 transition-opacity hover:opacity-100">
                      +<span className="hidden sm:inline"> Tambah</span>
                    </span>
                  </Link>
                )
              }

              return (
                <div key={cell.isoDate} className={baseClass}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium tabular-nums">
                      {cell.dayNumber}
                    </span>
                    {isToday && (
                      <span className="rounded bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                        Hari Ini
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Date Range Filter */}
      <Card>
        <CardContent className="pt-4">
          <form
            onSubmit={handleApplyFilter}
            className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"
          >
            <div className="grid flex-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="ronda-from-date"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Dari Tanggal
                </label>
                <Input
                  id="ronda-from-date"
                  type="date"
                  value={draftFromDate}
                  onChange={(e) => setDraftFromDate(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="ronda-to-date"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Sampai Tanggal
                </label>
                <Input
                  id="ronda-to-date"
                  type="date"
                  value={draftToDate}
                  onChange={(e) => setDraftToDate(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm">
                Terapkan Filter
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleShowUpcoming}
              >
                Akan Datang
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleShowAll}
              >
                Semua Jadwal
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleResetFilter}
              >
                <RotateCcwIcon className="size-3.5" />
                <span>Reset</span>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Schedule List */}
      <section aria-label="Daftar Jadwal Ronda" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            Daftar Sesi Ronda ({totalCount})
          </h2>
          {scheduleQuery.isFetching && (
            <span className="text-xs text-muted-foreground">Memuat...</span>
          )}
        </div>

        {errorMessage ? (
          <Card className="border-destructive/40 bg-destructive-subtle/40">
            <CardContent className="flex flex-col items-start justify-between gap-3 py-5 sm:flex-row sm:items-center">
              <div className="flex items-start gap-2.5 text-sm text-destructive">
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => scheduleQuery.refetch()}
              >
                Coba Lagi
              </Button>
            </CardContent>
          </Card>
        ) : scheduleQuery.isLoading && !data ? (
          <div className="grid gap-3">
            {Array.from({ length: 3 }).map((_, idx) => (
              <Card key={idx}>
                <CardContent className="h-24 animate-pulse bg-muted/30" />
              </Card>
            ))}
          </div>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <ShieldCheckIcon className="size-10 text-muted-foreground/60" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  Belum ada jadwal ronda pada periode ini
                </p>
                <p className="text-xs text-muted-foreground">
                  {canManage
                    ? "Buat jadwal baru secara manual untuk memilih tanggal dan petugas warga."
                    : "Belum ada sesi ronda yang dijadwalkan untuk rentang tanggal yang dipilih."}
                </p>
              </div>
              {canManage && (
                <Button
                  size="sm"
                  nativeButton={false}
                  render={<Link href="/ronda/new" />}
                >
                  <PlusIcon className="size-4" />
                  <span>Tambah Jadwal</span>
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {items.map((item) => {
              const timeInfo = formatRondaTimeRange(
                item.startTime,
                item.endTime
              )
              const isToday = item.scheduleDate === todayDate
              const isPast = item.scheduleDate < todayDate

              return (
                <Card
                  key={item.id}
                  className={
                    isToday ? "border-primary/50 bg-primary-subtle/15" : ""
                  }
                >
                  <CardContent className="flex flex-col gap-4 py-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/ronda/${item.id}`}
                          className="text-base font-semibold text-foreground hover:text-primary hover:underline"
                        >
                          {formatRondaDateLong(item.scheduleDate)}
                        </Link>
                        {isToday ? (
                          <Badge variant="default">Hari Ini</Badge>
                        ) : isPast ? (
                          <Badge variant="secondary">Terlewati</Badge>
                        ) : (
                          <Badge variant="info">Akan Datang</Badge>
                        )}
                        <Badge variant="outline">{item.shiftLabel}</Badge>
                        {timeInfo.isOvernight && (
                          <Badge variant="accent">Lintas Hari</Badge>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <ClockIcon className="size-3.5" />
                          {timeInfo.label}
                        </span>
                        {item.meetingPoint && (
                          <span className="inline-flex items-center gap-1">
                            <MapPinIcon className="size-3.5" />
                            {item.meetingPoint}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 font-medium text-foreground">
                          <UsersIcon className="size-3.5 text-primary" />
                          {item.assignedCount} petugas
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {item.officers.map((officer) => (
                          <Badge key={officer.id} variant="secondary" size="sm">
                            {officer.residentNameSnapshot}
                            {officer.householdLabelSnapshot
                              ? ` (${officer.householdLabelSnapshot})`
                              : ""}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        render={<Link href={`/ronda/${item.id}`} />}
                      >
                        <EyeIcon className="size-3.5" />
                        <span>Detail</span>
                      </Button>
                      {canManage && (
                        <Button
                          variant="outline"
                          size="sm"
                          nativeButton={false}
                          render={<Link href={`/ronda/${item.id}/edit`} />}
                        >
                          <PencilIcon className="size-3.5" />
                          <span>Ubah</span>
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-muted-foreground">
              Halaman {page} dari {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Sebelumnya
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Berikutnya
              </Button>
            </div>
          </div>
        )}
      </section>
    </PageContainer>
  )
}
