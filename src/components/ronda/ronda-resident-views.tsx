"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  ClockIcon,
  MapPinIcon,
  ShieldCheckIcon,
  UserCheckIcon,
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
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  formatRondaDateLong,
  formatRondaDateTime,
  formatRondaTimeRange,
} from "@/lib/ronda/formatters"
import {
  getRondaAttendanceBadgeVariant,
  RONDA_ATTENDANCE_STATUS_LABELS,
  type RondaMyAttendanceRecord,
  type RondaScheduleListItem,
  type RondaSchedulePageResult,
  type RondaScheduleWithRoster,
} from "@/lib/ronda/types"
import {
  useMyRondaAttendance,
  useResidentRondaScheduleDetail,
  useResidentRondaSchedules,
} from "@/lib/ronda/use-ronda"

interface RondaResidentListViewProps {
  tenantId: string
  todayDate: string
  initialSchedules: RondaSchedulePageResult | null
  initialMyAttendance: RondaMyAttendanceRecord[]
  initialError: string | null
}

type ResidentTab = "upcoming" | "history" | "all"

export function RondaResidentListView({
  tenantId,
  todayDate,
  initialSchedules,
  initialMyAttendance,
  initialError,
}: RondaResidentListViewProps) {
  const [activeTab, setActiveTab] = React.useState<ResidentTab>("upcoming")
  const [searchDate, setSearchDate] = React.useState("")
  const [page, setPage] = React.useState(1)

  const filterBounds = React.useMemo(() => {
    if (searchDate) {
      return { fromDate: searchDate, toDate: searchDate }
    }
    if (activeTab === "upcoming") {
      return { fromDate: todayDate, toDate: undefined }
    }
    if (activeTab === "history") {
      return { fromDate: undefined, toDate: todayDate }
    }
    return { fromDate: undefined, toDate: undefined }
  }, [activeTab, searchDate, todayDate])

  const isInitialState =
    activeTab === "upcoming" && !searchDate && page === 1

  const schedulesQuery = useResidentRondaSchedules({
    tenantId,
    filters: {
      fromDate: filterBounds.fromDate,
      toDate: filterBounds.toDate,
      page,
      pageSize: 20,
    },
    initialData: isInitialState ? (initialSchedules ?? undefined) : undefined,
  })

  const initialAttendanceMap = React.useMemo(() => {
    const map = new Map<string, RondaMyAttendanceRecord>()
    for (const rec of initialMyAttendance) {
      map.set(rec.scheduleId, rec)
    }
    return map
  }, [initialMyAttendance])

  const data =
    schedulesQuery.data ?? (isInitialState ? initialSchedules : undefined)
  const items: RondaScheduleListItem[] = React.useMemo(() => {
    const raw = data?.items ?? []
    if (!searchDate && activeTab === "history") {
      return raw.filter((item) => item.scheduleDate < todayDate)
    }
    return raw
  }, [data?.items, searchDate, activeTab, todayDate])

  const totalPages = data?.totalPages ?? 1
  const errorMessage =
    schedulesQuery.error instanceof Error
      ? schedulesQuery.error.message
      : isInitialState
        ? initialError
        : null

  return (
    <ResidentContainer className="flex flex-col gap-[var(--space-5)]">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <ShieldCheckIcon className="size-5 text-primary" />
          <h1 className="font-heading text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Jadwal Ronda
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Lihat jadwal jaga malam warga dan status kehadiran pribadi Anda.
        </p>
      </div>

      {/* Tabs + Quick Date Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          value={activeTab}
          onValueChange={(nextValue) => {
            setActiveTab(nextValue as ResidentTab)
            setPage(1)
          }}
        >
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="upcoming">Akan Datang</TabsTrigger>
            <TabsTrigger value="history">Riwayat</TabsTrigger>
            <TabsTrigger value="all">Semua</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <Input
            type="date"
            aria-label="Filter tanggal jadwal ronda"
            value={searchDate}
            onChange={(e) => {
              setSearchDate(e.target.value)
              setPage(1)
            }}
            className="w-full sm:w-44"
          />
          {searchDate && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchDate("")
                setPage(1)
              }}
            >
              Reset
            </Button>
          )}
        </div>
      </div>

      {errorMessage ? (
        <Card className="border-destructive/40 bg-destructive-subtle/40">
          <CardContent className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => schedulesQuery.refetch()}
            >
              Coba Lagi
            </Button>
          </CardContent>
        </Card>
      ) : schedulesQuery.isLoading && !data ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, idx) => (
            <Card key={idx}>
              <CardContent className="h-28 animate-pulse bg-muted/30" />
            </Card>
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <CalendarDaysIcon className="size-9 text-muted-foreground/60" />
            <p className="text-sm font-semibold text-foreground">
              Belum ada jadwal ronda
            </p>
            <p className="max-w-xs text-xs text-muted-foreground">
              {searchDate
                ? "Tidak ditemukan jadwal ronda pada tanggal yang dipilih."
                : activeTab === "upcoming"
                  ? "Pengurus RT belum menambahkan jadwal ronda mendatang."
                  : "Belum ada riwayat jadwal ronda yang tercatat."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => {
            const timeInfo = formatRondaTimeRange(item.startTime, item.endTime)
            const isToday = item.scheduleDate === todayDate
            const myRecord =
              item.myAttendance ?? initialAttendanceMap.get(item.id) ?? null
            const myStatusKey = myRecord
              ? (myRecord.attendanceStatus ?? "unrecorded")
              : null

            return (
              <Card
                key={item.id}
                className={
                  myRecord
                    ? "border-primary/40 bg-primary-subtle/15"
                    : undefined
                }
              >
                <CardContent className="flex flex-col gap-3 py-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link
                          href={`/resident/ronda/${item.id}`}
                          className="text-base font-semibold text-foreground hover:text-primary hover:underline"
                        >
                          {formatRondaDateLong(item.scheduleDate)}
                        </Link>
                        {isToday && <Badge variant="default">Hari Ini</Badge>}
                        {myRecord && (
                          <Badge variant="navy">
                            <UserCheckIcon className="size-3" />
                            <span>Tugas Anda</span>
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {item.shiftLabel}
                        </span>
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
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon-sm"
                      nativeButton={false}
                      render={
                        <Link
                          href={`/resident/ronda/${item.id}`}
                          aria-label={`Lihat detail jadwal ${formatRondaDateLong(item.scheduleDate)}`}
                        />
                      }
                    >
                      <ChevronRightIcon className="size-4" />
                    </Button>
                  </div>

                  {/* Personal Attendance ONLY (never neighbors' attendance) */}
                  {myRecord && myStatusKey && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs">
                      <span className="font-medium text-foreground">
                        Status Kehadiran Anda:
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={getRondaAttendanceBadgeVariant(
                            myRecord.attendanceStatus
                          )}
                        >
                          {RONDA_ATTENDANCE_STATUS_LABELS[myStatusKey]}
                        </Badge>
                      </div>
                      {myRecord.attendanceNotes && (
                        <p className="w-full text-muted-foreground">
                          Catatan: {myRecord.attendanceNotes}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Roster Names Only */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                      <UsersIcon className="size-3.5" />
                      {item.assignedCount} petugas:
                    </span>
                    {item.officers.map((officer) => (
                      <Badge key={officer.id} variant="secondary" size="sm">
                        {officer.residentNameSnapshot}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
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
    </ResidentContainer>
  )
}

interface RondaResidentDetailViewProps {
  tenantId: string
  scheduleId: string
  todayDate: string
  initialSchedule: RondaScheduleWithRoster
  initialMyAttendance: RondaMyAttendanceRecord | null
}

export function RondaResidentDetailView({
  tenantId,
  scheduleId,
  todayDate,
  initialSchedule,
  initialMyAttendance,
}: RondaResidentDetailViewProps) {
  const detailQuery = useResidentRondaScheduleDetail({
    tenantId,
    scheduleId,
    initialData: initialSchedule,
  })
  const myAttendanceQuery = useMyRondaAttendance({
    tenantId,
    scheduleId,
    initialData: initialMyAttendance,
  })

  const detail = detailQuery.data ?? initialSchedule
  const { schedule, roster } = detail
  const myRecord =
    myAttendanceQuery.data ?? detail.myAttendance ?? initialMyAttendance
  const myStatusKey = myRecord
    ? (myRecord.attendanceStatus ?? "unrecorded")
    : null
  const timeInfo = formatRondaTimeRange(schedule.startTime, schedule.endTime)
  const isToday = schedule.scheduleDate === todayDate

  return (
    <ResidentContainer className="flex flex-col gap-[var(--space-5)]">
      <div>
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href="/resident/ronda" />}
        >
          <ArrowLeftIcon className="size-4" />
          <span>Kembali ke Jadwal Ronda</span>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-lg">
              {formatRondaDateLong(schedule.scheduleDate)}
            </CardTitle>
            {isToday && <Badge variant="default">Hari Ini</Badge>}
            <Badge variant="outline">{schedule.shiftLabel}</Badge>
          </div>
          <CardDescription>
            Detail sesi ronda malam dan daftar petugas warga.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex items-center gap-2.5 text-foreground">
            <ClockIcon className="size-4 shrink-0 text-primary" />
            <span>{timeInfo.label}</span>
            {timeInfo.isOvernight && (
              <Badge variant="accent" size="sm">
                Lintas Hari
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2.5 text-foreground">
            <MapPinIcon className="size-4 shrink-0 text-primary" />
            <span>{schedule.meetingPoint ?? "Titik kumpul belum ditentukan"}</span>
          </div>
          {schedule.notes && (
            <div className="rounded-lg border border-border-subtle bg-muted/30 px-3 py-2.5 text-sm text-foreground">
              <span className="font-medium text-muted-foreground">
                Catatan:{" "}
              </span>
              {schedule.notes}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Personal Attendance Card ONLY when caller is assigned */}
      {myRecord && myStatusKey && (
        <Card className="border-primary/40 bg-primary-subtle/15">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <UserCheckIcon className="size-4 text-primary" />
                <span>Kehadiran Pribadi Anda</span>
              </span>
              <Badge
                variant={getRondaAttendanceBadgeVariant(
                  myRecord.attendanceStatus
                )}
              >
                {RONDA_ATTENDANCE_STATUS_LABELS[myStatusKey]}
              </Badge>
            </CardTitle>
            <CardDescription>
              Status ini bersifat pribadi dan hanya terlihat oleh akun Anda.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {myRecord.attendanceNotes ? (
              <p className="text-foreground">
                <span className="font-medium text-muted-foreground">
                  Catatan pengurus:{" "}
                </span>
                {myRecord.attendanceNotes}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Tidak ada catatan kehadiran dari pengurus.
              </p>
            )}
            {myRecord.attendanceRecordedAt && (
              <p className="text-xs text-muted-foreground">
                Diperbarui {formatRondaDateTime(myRecord.attendanceRecordedAt)}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Roster Names Only (no neighbors' attendance) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UsersIcon className="size-4 text-primary" />
            <span>Petugas Bertugas ({roster.length} warga)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {roster.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada petugas terdaftar pada sesi ini.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {roster.map((officer, idx) => (
                <li
                  key={officer.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">
                      {idx + 1}. {officer.residentNameSnapshot}
                    </div>
                    {officer.householdLabelSnapshot && (
                      <div className="text-xs text-muted-foreground">
                        {officer.householdLabelSnapshot}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </ResidentContainer>
  )
}
