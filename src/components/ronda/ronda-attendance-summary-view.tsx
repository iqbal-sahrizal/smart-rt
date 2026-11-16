"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  formatRondaDateLong,
  formatRondaDateTime,
  summarizeRondaAttendance,
} from "@/lib/ronda/formatters"
import {
  getRondaAttendanceBadgeVariant,
  RONDA_ATTENDANCE_STATUS_LABELS,
  type RondaAttendanceAdminRecord,
} from "@/lib/ronda/types"
import { useAdminRondaAttendance } from "@/lib/ronda/use-ronda"

interface RondaAttendanceSummaryViewProps {
  tenantId: string
  initialFilters: {
    fromDate: string
    toDate: string
  }
  initialRecords: RondaAttendanceAdminRecord[]
  initialError: string | null
}

type StatusFilter = "all" | "present" | "absent" | "excused" | "unrecorded"

export function RondaAttendanceSummaryView({
  tenantId,
  initialFilters,
  initialRecords,
  initialError,
}: RondaAttendanceSummaryViewProps) {
  const [fromDate, setFromDate] = React.useState(initialFilters.fromDate)
  const [toDate, setToDate] = React.useState(initialFilters.toDate)
  const [draftFromDate, setDraftFromDate] = React.useState(
    initialFilters.fromDate
  )
  const [draftToDate, setDraftToDate] = React.useState(initialFilters.toDate)
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all")
  const [searchQuery, setSearchQuery] = React.useState("")

  const isInitialState =
    fromDate === initialFilters.fromDate && toDate === initialFilters.toDate

  const attendanceQuery = useAdminRondaAttendance({
    tenantId,
    params: {
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
    },
    initialData: isInitialState && !initialError ? initialRecords : undefined,
  })

  const records = React.useMemo(
    () => attendanceQuery.data ?? (isInitialState ? initialRecords : []),
    [attendanceQuery.data, isInitialState, initialRecords]
  )
  const errorMessage =
    attendanceQuery.error instanceof Error
      ? attendanceQuery.error.message
      : isInitialState
        ? initialError
        : null

  const summary = React.useMemo(
    () => summarizeRondaAttendance(records),
    [records]
  )

  const filteredRecords = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return records.filter((rec) => {
      const recStatus = rec.attendanceStatus ?? "unrecorded"
      if (statusFilter !== "all" && recStatus !== statusFilter) return false
      if (!q) return true
      return (
        rec.residentNameSnapshot.toLowerCase().includes(q) ||
        (rec.householdLabelSnapshot ?? "").toLowerCase().includes(q) ||
        rec.scheduleDate.toLowerCase().includes(q)
      )
    })
  }, [records, statusFilter, searchQuery])

  function handleApplyFilter(e: React.FormEvent) {
    e.preventDefault()
    setFromDate(draftFromDate)
    setToDate(draftToDate)
  }

  function handleReset() {
    setFromDate(initialFilters.fromDate)
    setToDate(initialFilters.toDate)
    setDraftFromDate(initialFilters.fromDate)
    setDraftToDate(initialFilters.toDate)
    setStatusFilter("all")
    setSearchQuery("")
  }

  return (
    <PageContainer className="flex flex-col gap-[var(--space-6)]">
      <div className="flex flex-col gap-3">
        <div>
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/ronda" />}
          >
            <ArrowLeftIcon className="size-4" />
            <span>Kembali ke Jadwal Ronda</span>
          </Button>
        </div>

        <PageHeader
          title="Rekap Kehadiran Ronda"
          description="Pantau riwayat kehadiran petugas ronda berdasarkan periode. Khusus Ketua RT dan Sekretaris."
        />
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Card>
          <CardContent className="py-3">
            <div className="text-xs text-muted-foreground">Total Penugasan</div>
            <div className="mt-1 text-xl font-bold text-foreground tabular-nums">
              {summary.total}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="text-xs text-muted-foreground">Hadir</div>
            <div className="mt-1 text-xl font-bold text-success tabular-nums">
              {summary.present}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="text-xs text-muted-foreground">Tidak Hadir</div>
            <div className="mt-1 text-xl font-bold text-destructive tabular-nums">
              {summary.absent}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="text-xs text-muted-foreground">Izin</div>
            <div className="mt-1 text-xl font-bold text-warning tabular-nums">
              {summary.excused}
            </div>
          </CardContent>
        </Card>
        <Card className="col-span-2 sm:col-span-1">
          <CardContent className="py-3">
            <div className="text-xs text-muted-foreground">
              Tingkat Kehadiran
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xl font-bold text-primary tabular-nums">
              <CheckCircle2Icon className="size-4" />
              <span>{summary.attendanceRatePercent}%</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <form
            onSubmit={handleApplyFilter}
            className="flex flex-col gap-3 lg:flex-row lg:items-end"
          >
            <div className="grid flex-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="att-from"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Dari Tanggal
                </label>
                <Input
                  id="att-from"
                  type="date"
                  value={draftFromDate}
                  onChange={(e) => setDraftFromDate(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="att-to"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Sampai Tanggal
                </label>
                <Input
                  id="att-to"
                  type="date"
                  value={draftToDate}
                  onChange={(e) => setDraftToDate(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="att-status"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Status Kehadiran
                </label>
                <select
                  id="att-status"
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(e.target.value as StatusFilter)
                  }
                  className="h-[var(--size-control-md)] w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
                >
                  <option value="all">Semua Status</option>
                  <option value="present">Hadir</option>
                  <option value="absent">Tidak Hadir</option>
                  <option value="excused">Izin</option>
                  <option value="unrecorded">Belum Dicatat</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="att-search"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Cari Petugas
                </label>
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="att-search"
                    type="search"
                    placeholder="Nama warga..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button type="submit" size="sm">
                Terapkan
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleReset}
              >
                <RotateCcwIcon className="size-3.5" />
                <span>Reset</span>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Attendance List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardCheckIcon className="size-4 text-primary" />
            <span>Catatan Kehadiran ({filteredRecords.length})</span>
          </CardTitle>
          <CardDescription>
            Klik tanggal ronda untuk membuka halaman sesi dan memperbarui status
            kehadiran.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {errorMessage ? (
            <div
              role="alert"
              className="flex flex-col items-start justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive-subtle/40 px-4 py-4 sm:flex-row sm:items-center"
            >
              <div className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => attendanceQuery.refetch()}
              >
                Coba Lagi
              </Button>
            </div>
          ) : attendanceQuery.isLoading && records.length === 0 ? (
            <div className="space-y-2 py-4">
              {Array.from({ length: 4 }).map((_, idx) => (
                <div
                  key={idx}
                  className="h-12 animate-pulse rounded-md bg-muted/40"
                />
              ))}
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              Tidak ada data kehadiran yang cocok dengan filter saat ini.
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tanggal Ronda</TableHead>
                      <TableHead>Petugas</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Catatan</TableHead>
                      <TableHead>Waktu Catat</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRecords.map((rec) => {
                      const statusKey = rec.attendanceStatus ?? "unrecorded"
                      return (
                        <TableRow key={rec.assignmentId}>
                          <TableCell>
                            <Link
                              href={`/ronda/${rec.scheduleId}`}
                              className="font-medium text-primary hover:underline"
                            >
                              {formatRondaDateLong(rec.scheduleDate)}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium text-foreground">
                              {rec.residentNameSnapshot}
                            </div>
                            {rec.householdLabelSnapshot && (
                              <div className="text-xs text-muted-foreground">
                                {rec.householdLabelSnapshot}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={getRondaAttendanceBadgeVariant(
                                rec.attendanceStatus
                              )}
                            >
                              {RONDA_ATTENDANCE_STATUS_LABELS[statusKey]}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-xs text-xs text-muted-foreground">
                            {rec.attendanceNotes ?? "-"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatRondaDateTime(rec.attendanceRecordedAt)}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Cards */}
              <div className="flex flex-col gap-3 md:hidden">
                {filteredRecords.map((rec) => {
                  const statusKey = rec.attendanceStatus ?? "unrecorded"
                  return (
                    <div
                      key={rec.assignmentId}
                      className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-foreground">
                            {rec.residentNameSnapshot}
                          </div>
                          {rec.householdLabelSnapshot && (
                            <div className="text-xs text-muted-foreground">
                              {rec.householdLabelSnapshot}
                            </div>
                          )}
                        </div>
                        <Badge
                          variant={getRondaAttendanceBadgeVariant(
                            rec.attendanceStatus
                          )}
                        >
                          {RONDA_ATTENDANCE_STATUS_LABELS[statusKey]}
                        </Badge>
                      </div>
                      <Link
                        href={`/ronda/${rec.scheduleId}`}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        {formatRondaDateLong(rec.scheduleDate)}
                      </Link>
                      {rec.attendanceNotes && (
                        <p className="text-xs text-muted-foreground">
                          Catatan: {rec.attendanceNotes}
                        </p>
                      )}
                      <div className="text-[11px] text-muted-foreground">
                        Dicatat: {formatRondaDateTime(rec.attendanceRecordedAt)}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  )
}
