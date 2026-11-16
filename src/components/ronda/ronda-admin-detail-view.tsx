"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  ClockIcon,
  InfoIcon,
  MapPinIcon,
  PencilIcon,
  RotateCcwIcon,
  UsersIcon,
} from "lucide-react"
import { toast } from "sonner"

import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { RondaDeleteDialog } from "@/components/ronda/ronda-delete-dialog"
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
  formatRondaDateLong,
  formatRondaDateTime,
  formatRondaTimeRange,
  summarizeRondaAttendance,
} from "@/lib/ronda/formatters"
import {
  getRondaAttendanceBadgeVariant,
  RONDA_ATTENDANCE_STATUSES,
  RONDA_ATTENDANCE_STATUS_LABELS,
  type RondaAttendanceStatus,
  type RondaScheduleWithRoster,
} from "@/lib/ronda/types"
import {
  useAdminRondaScheduleDetail,
  useRecordRondaAttendanceMutation,
} from "@/lib/ronda/use-ronda"

interface RondaAdminDetailViewProps {
  tenantId: string
  scheduleId: string
  canManage: boolean
  canReadAttendance: boolean
  todayDate: string
  initialSchedule: RondaScheduleWithRoster
  notice?: string | null
}

export function RondaAdminDetailView({
  tenantId,
  scheduleId,
  canManage,
  canReadAttendance,
  todayDate,
  initialSchedule,
  notice,
}: RondaAdminDetailViewProps) {
  const detailQuery = useAdminRondaScheduleDetail({
    tenantId,
    scheduleId,
    initialData: initialSchedule,
  })
  const attendanceMutation = useRecordRondaAttendanceMutation({ tenantId })

  const detail = detailQuery.data ?? initialSchedule
  const { schedule, roster } = detail
  const timeInfo = formatRondaTimeRange(schedule.startTime, schedule.endTime)
  const isToday = schedule.scheduleDate === todayDate
  const isPast = schedule.scheduleDate < todayDate

  // Per-assignment editable notes draft state (only meaningful when canManage)
  const [noteDrafts, setNoteDrafts] = React.useState<Record<string, string>>(
    () => {
      const initial: Record<string, string> = {}
      for (const officer of initialSchedule.roster) {
        initial[officer.id] = officer.attendanceNotes ?? ""
      }
      return initial
    }
  )

  React.useEffect(() => {
    setNoteDrafts((prev) => {
      const next = { ...prev }
      for (const officer of roster) {
        if (!(officer.id in next)) {
          next[officer.id] = officer.attendanceNotes ?? ""
        }
      }
      return next
    })
  }, [roster])

  const [pendingAssignmentId, setPendingAssignmentId] = React.useState<
    string | null
  >(null)
  const [rowErrors, setRowErrors] = React.useState<Record<string, string>>({})

  const attendanceStats = React.useMemo(
    () =>
      canReadAttendance
        ? summarizeRondaAttendance(
            roster.map((officer) => ({
              attendanceStatus: officer.attendanceStatus ?? null,
            }))
          )
        : null,
    [canReadAttendance, roster]
  )

  async function handleSaveAttendance(
    assignmentId: string,
    nextStatus: RondaAttendanceStatus,
    overrideNotes?: string | null
  ) {
    if (!canManage || pendingAssignmentId) return

    const rawNote =
      overrideNotes !== undefined
        ? overrideNotes
        : (noteDrafts[assignmentId] ?? "")
    const cleanNote = rawNote && rawNote.trim() ? rawNote.trim() : null

    if (cleanNote && cleanNote.length > 300) {
      setRowErrors((prev) => ({
        ...prev,
        [assignmentId]: "Catatan kehadiran maksimal 300 karakter.",
      }))
      return
    }

    setPendingAssignmentId(assignmentId)
    setRowErrors((prev) => {
      const next = { ...prev }
      delete next[assignmentId]
      return next
    })

    try {
      await attendanceMutation.mutateAsync({
        assignmentId,
        attendanceStatus: nextStatus,
        attendanceNotes: nextStatus === null ? null : cleanNote,
      })

      if (nextStatus === null) {
        setNoteDrafts((prev) => ({ ...prev, [assignmentId]: "" }))
      }

      toast.success(
        nextStatus === null
          ? "Status kehadiran direset"
          : `Kehadiran tercatat: ${RONDA_ATTENDANCE_STATUS_LABELS[nextStatus]}`
      )
    } catch (err) {
      setRowErrors((prev) => ({
        ...prev,
        [assignmentId]:
          err instanceof Error
            ? err.message
            : "Gagal menyimpan kehadiran. Silakan coba lagi.",
      }))
    } finally {
      setPendingAssignmentId(null)
    }
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
            <span>Kembali ke Daftar Ronda</span>
          </Button>
        </div>

        <PageHeader
          title={formatRondaDateLong(schedule.scheduleDate)}
          description={`Detail sesi ${schedule.shiftLabel} dan daftar petugas yang dijadwalkan.`}
          actions={
            canManage ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link href={`/ronda/${schedule.id}/edit`} />}
                >
                  <PencilIcon className="size-4" />
                  <span>Ubah Jadwal</span>
                </Button>
                <RondaDeleteDialog
                  tenantId={tenantId}
                  scheduleId={schedule.id}
                  scheduleDate={schedule.scheduleDate}
                  shiftLabel={schedule.shiftLabel}
                />
              </div>
            ) : undefined
          }
        />
      </div>

      {notice === "readonly" && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning-subtle px-4 py-3 text-sm text-warning"
        >
          <InfoIcon className="size-4 shrink-0" />
          <span>
            Peran Anda hanya memiliki akses lihat untuk detail jadwal ronda.
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
            Mode lihat: pengelolaan petugas dan pencatatan kehadiran hanya
            tersedia bagi Ketua RT dan Sekretaris.
          </span>
        </div>
      )}

      {/* Schedule Info Card */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">{schedule.shiftLabel}</CardTitle>
            {isToday ? (
              <Badge variant="default">Hari Ini</Badge>
            ) : isPast ? (
              <Badge variant="secondary">Terlewati</Badge>
            ) : (
              <Badge variant="info">Akan Datang</Badge>
            )}
            {timeInfo.isOvernight && (
              <Badge variant="accent">Lintas Hari</Badge>
            )}
          </div>
          <CardDescription>
            Informasi waktu pelaksanaan, titik kumpul, dan catatan sesi ronda.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="flex items-start gap-2.5">
            <CalendarDaysIcon className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <div className="text-xs font-medium text-muted-foreground">
                Tanggal
              </div>
              <div className="text-sm font-medium text-foreground">
                {formatRondaDateLong(schedule.scheduleDate)}
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <ClockIcon className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <div className="text-xs font-medium text-muted-foreground">
                Jam Tugas
              </div>
              <div className="text-sm font-medium text-foreground">
                {timeInfo.label}
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <MapPinIcon className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <div className="text-xs font-medium text-muted-foreground">
                Titik Kumpul
              </div>
              <div className="text-sm font-medium text-foreground">
                {schedule.meetingPoint ?? "Belum ditentukan"}
              </div>
            </div>
          </div>

          {schedule.notes && (
            <div className="rounded-lg border border-border-subtle bg-muted/30 px-3.5 py-2.5 text-sm text-foreground sm:col-span-3">
              <span className="font-medium text-muted-foreground">
                Catatan:{" "}
              </span>
              {schedule.notes}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Attendance Summary Strip (Strictly ONLY ketua_rt / sekretaris) */}
      {canReadAttendance && attendanceStats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <CardContent className="py-3">
              <div className="text-xs text-muted-foreground">Hadir</div>
              <div className="mt-1 text-xl font-bold text-success tabular-nums">
                {attendanceStats.present}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <div className="text-xs text-muted-foreground">Tidak Hadir</div>
              <div className="mt-1 text-xl font-bold text-destructive tabular-nums">
                {attendanceStats.absent}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <div className="text-xs text-muted-foreground">Izin</div>
              <div className="mt-1 text-xl font-bold text-warning tabular-nums">
                {attendanceStats.excused}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <div className="text-xs text-muted-foreground">Belum Dicatat</div>
              <div className="mt-1 text-xl font-bold text-muted-foreground tabular-nums">
                {attendanceStats.unrecorded}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Roster & Attendance Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              <UsersIcon className="size-4 text-primary" />
              <span>Daftar Petugas ({roster.length} warga)</span>
            </span>
          </CardTitle>
          <CardDescription>
            {canManage
              ? "Catat atau perbarui status kehadiran serta catatan masing-masing petugas."
              : "Daftar warga yang dijadwalkan bertugas pada sesi ini."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {roster.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              Belum ada petugas pada sesi ini.
            </div>
          ) : (
            roster.map((officer, idx) => {
              const isSaving = pendingAssignmentId === officer.id
              const currentStatus = officer.attendanceStatus ?? null
              const statusKey = currentStatus ?? "unrecorded"
              const noteValue = noteDrafts[officer.id] ?? ""
              const rowError = rowErrors[officer.id]

              return (
                <div
                  key={officer.id}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-muted-foreground tabular-nums">
                          #{idx + 1}
                        </span>
                        <span className="text-sm font-semibold text-foreground">
                          {officer.residentNameSnapshot}
                        </span>
                        {canReadAttendance && (
                          <Badge
                            variant={getRondaAttendanceBadgeVariant(
                              currentStatus
                            )}
                          >
                            {RONDA_ATTENDANCE_STATUS_LABELS[statusKey]}
                          </Badge>
                        )}
                      </div>
                      <div className="pl-6 text-xs text-muted-foreground">
                        {officer.householdLabelSnapshot ?? "Rumah tangga aktif"}
                        {canReadAttendance && officer.attendanceRecordedAt && (
                          <span>
                            {" "}
                            · Dicatat{" "}
                            {formatRondaDateTime(officer.attendanceRecordedAt)}
                          </span>
                        )}
                      </div>
                    </div>

                    {canManage && (
                      <div className="flex flex-wrap items-center gap-1.5 pl-6 sm:pl-0">
                        {RONDA_ATTENDANCE_STATUSES.map((statusOption) => {
                          const isActive = currentStatus === statusOption
                          return (
                            <Button
                              key={statusOption}
                              type="button"
                              size="sm"
                              variant={isActive ? "default" : "outline"}
                              disabled={isSaving}
                              onClick={() =>
                                handleSaveAttendance(officer.id, statusOption)
                              }
                            >
                              {isActive && (
                                <CheckCircle2Icon className="size-3.5" />
                              )}
                              <span>
                                {RONDA_ATTENDANCE_STATUS_LABELS[statusOption]}
                              </span>
                            </Button>
                          )
                        })}
                        {currentStatus !== null && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={isSaving}
                            onClick={() =>
                              handleSaveAttendance(officer.id, null, null)
                            }
                            title="Reset status kehadiran ke Belum Dicatat"
                          >
                            <RotateCcwIcon className="size-3.5" />
                            <span>Reset</span>
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  {canManage && (
                    <div className="flex flex-col gap-2 pl-0 sm:flex-row sm:items-center sm:pl-6">
                      <div className="relative flex-1">
                        <Input
                          type="text"
                          size="sm"
                          maxLength={300}
                          aria-label={`Catatan kehadiran ${officer.residentNameSnapshot}`}
                          placeholder={
                            currentStatus
                              ? "Catatan kehadiran (opsional, maks. 300 karakter)..."
                              : "Pilih status Hadir/Tidak Hadir/Izin untuk menyimpan catatan..."
                          }
                          value={noteValue}
                          disabled={isSaving}
                          onChange={(e) =>
                            setNoteDrafts((prev) => ({
                              ...prev,
                              [officer.id]: e.target.value,
                            }))
                          }
                        />
                      </div>
                      {currentStatus !== null && (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={
                            isSaving ||
                            noteValue.trim() ===
                              (officer.attendanceNotes ?? "").trim()
                          }
                          onClick={() =>
                            handleSaveAttendance(officer.id, currentStatus)
                          }
                        >
                          {isSaving ? "Menyimpan..." : "Simpan Catatan"}
                        </Button>
                      )}
                    </div>
                  )}

                  {rowError && (
                    <div
                      role="alert"
                      className="flex items-center gap-1.5 pl-6 text-xs text-destructive"
                    >
                      <AlertCircleIcon className="size-3.5 shrink-0" />
                      <span>{rowError}</span>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </CardContent>
      </Card>
    </PageContainer>
  )
}
