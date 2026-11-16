"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertCircleIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  Trash2Icon,
  UserCheckIcon,
  UsersIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  ActivityAddParticipantDialog,
  ActivityRemoveParticipantDialog,
} from "@/components/activities/activity-dialogs"
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
import type { EligibleActivityResidentOption } from "@/lib/activities/admin-candidates"
import {
  ACTIVITY_PARTICIPANT_STATUS_LABELS,
  ACTIVITY_PARTICIPANT_STATUSES,
} from "@/lib/activities/constants"
import {
  formatActivityParticipantStatusLabel,
  formatActivityQuotaSummary,
} from "@/lib/activities/formatters"
import {
  useAdminActivityParticipants,
  useRecordActivityAttendanceMutation,
} from "@/lib/activities/hooks"
import type {
  ActivityParticipant,
  ActivityParticipantsPageResult,
  ActivityParticipantStatus,
  ActivityPermissions,
} from "@/lib/activities/types"
import {
  formatJakartaDateTimeShort,
  getParticipantStatusBadgeVariant,
} from "@/lib/activities/ui-helpers"

export function ActivityParticipantsPanel({
  tenantId,
  actorKey,
  activityId,
  maxParticipants,
  activeParticipantCount,
  permissions,
  eligibleResidents,
  initialData,
  initialError = null,
  showFullManagementLink = false,
}: {
  tenantId: string
  actorKey: string
  activityId: string
  maxParticipants: number | null
  activeParticipantCount: number
  permissions: Pick<
    ActivityPermissions,
    "canManageParticipants" | "canRecordAttendance"
  >
  eligibleResidents: readonly EligibleActivityResidentOption[]
  initialData: ActivityParticipantsPageResult | null
  initialError?: string | null
  showFullManagementLink?: boolean
}) {
  const router = useRouter()
  const attendanceMutation = useRecordActivityAttendanceMutation(tenantId)

  const [searchInput, setSearchInput] = React.useState("")
  const [debouncedSearch, setDebouncedSearch] = React.useState("")
  const [rsvpStatus, setRsvpStatus] = React.useState<
    "all" | ActivityParticipantStatus
  >("all")
  const [page, setPage] = React.useState(1)

  const [addDialogOpen, setAddDialogOpen] = React.useState(false)
  const [participantToRemove, setParticipantToRemove] =
    React.useState<ActivityParticipant | null>(null)
  const [walkInResidentId, setWalkInResidentId] = React.useState("")
  const [walkInStatus, setWalkInStatus] =
    React.useState<ActivityParticipantStatus>("attended")
  const [pendingParticipantId, setPendingParticipantId] = React.useState<
    string | null
  >(null)

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
    debouncedSearch === "" && rsvpStatus === "all" && page === 1

  const query = useAdminActivityParticipants({
    tenantId,
    actorKey,
    activityId,
    filters: {
      search: debouncedSearch || undefined,
      rsvpStatus: rsvpStatus === "all" ? undefined : rsvpStatus,
      page,
      pageSize: 10,
    },
    initialData: isInitialState ? (initialData ?? undefined) : undefined,
  })

  const data = query.data ?? (isInitialState ? initialData : null)
  const errorMessage =
    query.error?.message ?? (isInitialState ? initialError : null)

  const existingResidentIds = React.useMemo(() => {
    const ids = new Set<string>()
    for (const item of data?.items ?? []) {
      if (item.residentId) ids.add(item.residentId)
    }
    return ids
  }, [data?.items])

  async function handleQuickAttendance(
    participant: ActivityParticipant,
    nextStatus: "attended" | "absent"
  ) {
    if (!participant.residentId || attendanceMutation.isPending) return
    setPendingParticipantId(participant.id)
    try {
      await attendanceMutation.mutateAsync({
        activityId,
        residentId: participant.residentId,
        rsvpStatus: nextStatus,
      })
      toast.success(
        `Presensi ${participant.residentNameSnapshot} dicatat (${formatActivityParticipantStatusLabel(nextStatus)}).`
      )
      router.refresh()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Gagal mencatat presensi."
      )
    } finally {
      setPendingParticipantId(null)
    }
  }

  async function handleWalkInAttendance(e: React.FormEvent) {
    e.preventDefault()
    if (!walkInResidentId || attendanceMutation.isPending) return
    try {
      await attendanceMutation.mutateAsync({
        activityId,
        residentId: walkInResidentId,
        rsvpStatus: walkInStatus,
      })
      toast.success("Presensi warga langsung berhasil dicatat.")
      setWalkInResidentId("")
      router.refresh()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Gagal mencatat presensi warga."
      )
    }
  }

  const summary = data?.summary ?? {
    invited: 0,
    attending: 0,
    cancelled: 0,
    attended: 0,
    absent: 0,
    activeSeats: activeParticipantCount,
    total: 0,
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <UsersIcon className="size-4 text-primary" />
                <span>Daftar Peserta &amp; Presensi</span>
                <Badge variant="outline" size="sm" className="tabular-nums">
                  {formatActivityQuotaSummary(
                    summary.activeSeats,
                    maxParticipants
                  )}
                </Badge>
              </CardTitle>
              <CardDescription className="mt-1">
                Hanya menampilkan nama dan label unit rumah dari snapshot tanpa
                data kependudukan sensitif.
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {showFullManagementLink && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<Link href={`/kegiatan/${activityId}/participants`} />}
                >
                  <UserCheckIcon className="size-3.5" />
                  <span>Kelola Peserta Penuh</span>
                </Button>
              )}
              {permissions.canManageParticipants && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setAddDialogOpen(true)}
                >
                  <PlusIcon className="size-4" />
                  <span>Tambah Peserta</span>
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Status Summary Chips */}
          <div className="flex flex-wrap gap-2">
            {ACTIVITY_PARTICIPANT_STATUSES.map((st) => (
              <Badge
                key={st}
                variant={getParticipantStatusBadgeVariant(st)}
                size="sm"
                className="tabular-nums"
              >
                {ACTIVITY_PARTICIPANT_STATUS_LABELS[st]}: {summary[st]}
              </Badge>
            ))}
          </div>

          {/* Quick Walk-In Attendance (Ket RT, Sekretaris, Pengurus) */}
          {permissions.canRecordAttendance && eligibleResidents.length > 0 && (
            <form
              onSubmit={handleWalkInAttendance}
              className="flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-3 lg:flex-row lg:items-end"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <label
                  htmlFor="walkin-resident-select"
                  className="text-xs font-medium text-foreground"
                >
                  Catat Kehadiran Warga Langsung (Walk-in / Perbarui Status)
                </label>
                <select
                  id="walkin-resident-select"
                  value={walkInResidentId}
                  onChange={(e) => setWalkInResidentId(e.target.value)}
                  disabled={attendanceMutation.isPending}
                  className="flex h-9 w-full min-w-0 max-w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-2xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
                >
                  <option value="">-- Pilih warga aktif --</option>
                  {eligibleResidents.map((opt) => (
                    <option key={opt.residentId} value={opt.residentId}>
                      {opt.fullName} ({opt.householdLabel})
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-full space-y-1 lg:w-48">
                <label
                  htmlFor="walkin-status-select"
                  className="text-xs font-medium text-foreground"
                >
                  Status Presensi
                </label>
                <select
                  id="walkin-status-select"
                  value={walkInStatus}
                  onChange={(e) =>
                    setWalkInStatus(e.target.value as ActivityParticipantStatus)
                  }
                  disabled={attendanceMutation.isPending}
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-2xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
                >
                  <option value="attended">Hadir</option>
                  <option value="absent">Tidak Hadir</option>
                  <option value="attending">Terdaftar / Hadir</option>
                </select>
              </div>
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                disabled={!walkInResidentId || attendanceMutation.isPending}
              >
                <UserCheckIcon className="size-4" />
                <span>Catat Presensi</span>
              </Button>
            </form>
          )}

          {/* Filter Bar */}
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Cari nama peserta, blok/unit, atau catatan..."
                aria-label="Cari peserta kegiatan"
                className="pl-9"
              />
            </div>
            <select
              aria-label="Filter Status Peserta"
              value={rsvpStatus}
              onChange={(e) => {
                setRsvpStatus(
                  e.target.value as "all" | ActivityParticipantStatus
                )
                setPage(1)
              }}
              className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-2xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 sm:w-52"
            >
              <option value="all">Semua Status Peserta</option>
              {ACTIVITY_PARTICIPANT_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {ACTIVITY_PARTICIPANT_STATUS_LABELS[st]}
                </option>
              ))}
            </select>
            {(searchInput || rsvpStatus !== "all") && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchInput("")
                  setDebouncedSearch("")
                  setRsvpStatus("all")
                  setPage(1)
                }}
              >
                <RotateCcwIcon className="size-3.5" />
                <span>Reset</span>
              </Button>
            )}
          </div>

          {/* Content */}
          {query.isLoading && !data ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : errorMessage && !data ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-destructive-border bg-destructive-subtle/30 p-6 text-center">
              <AlertCircleIcon className="size-6 text-destructive" />
              <p className="text-sm text-destructive-text">{errorMessage}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => query.refetch()}
              >
                <RefreshCwIcon className="size-3.5" />
                <span>Muat Ulang</span>
              </Button>
            </div>
          ) : !data || data.items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
              <UsersIcon className="mx-auto mb-2 size-7 text-muted-foreground/60" />
              <p className="text-sm font-medium text-foreground">
                Belum ada peserta yang sesuai
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Warga yang mendaftar mandiri atau ditambahkan pengurus akan
                muncul di sini.
              </p>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden overflow-hidden rounded-xl border border-border md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nama Warga</TableHead>
                      <TableHead>Unit / Blok</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Catatan</TableHead>
                      <TableHead>Terdaftar</TableHead>
                      {(permissions.canRecordAttendance ||
                        permissions.canManageParticipants) && (
                          <TableHead className="text-right">Aksi</TableHead>
                        )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((participant) => {
                      const canMarkResident =
                        permissions.canRecordAttendance &&
                        participant.residentId !== null
                      const isRowPending =
                        pendingParticipantId === participant.id
                      return (
                        <TableRow key={participant.id}>
                          <TableCell className="font-medium text-foreground">
                            {participant.residentNameSnapshot}
                            {participant.residentId === null && (
                              <span className="ml-1.5 text-[11px] text-muted-foreground">
                                (Riwayat Arsip)
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {participant.householdLabelSnapshot}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={getParticipantStatusBadgeVariant(
                                participant.rsvpStatus
                              )}
                              size="sm"
                            >
                              {formatActivityParticipantStatusLabel(
                                participant.rsvpStatus
                              )}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                            {participant.cancellationReason
                              ? `Batal: ${participant.cancellationReason}`
                              : participant.registrationNotes ?? "-"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground tabular-nums">
                            {formatJakartaDateTimeShort(
                              participant.registeredAt
                            )}
                          </TableCell>
                          {(permissions.canRecordAttendance ||
                            permissions.canManageParticipants) && (
                              <TableCell className="text-right">
                                <div className="inline-flex items-center justify-end gap-1">
                                  {canMarkResident && (
                                    <>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant={
                                          participant.rsvpStatus === "attended"
                                            ? "default"
                                            : "outline"
                                        }
                                        disabled={
                                          attendanceMutation.isPending ||
                                          isRowPending
                                        }
                                        onClick={() =>
                                          handleQuickAttendance(
                                            participant,
                                            "attended"
                                          )
                                        }
                                      >
                                        <CheckIcon className="size-3.5" />
                                        <span>Hadir</span>
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant={
                                          participant.rsvpStatus === "absent"
                                            ? "destructive"
                                            : "outline"
                                        }
                                        disabled={
                                          attendanceMutation.isPending ||
                                          isRowPending
                                        }
                                        onClick={() =>
                                          handleQuickAttendance(
                                            participant,
                                            "absent"
                                          )
                                        }
                                      >
                                        <XIcon className="size-3.5" />
                                        <span>Absen</span>
                                      </Button>
                                    </>
                                  )}
                                  {permissions.canManageParticipants && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      aria-label={`Hapus ${participant.residentNameSnapshot}`}
                                      className="text-destructive hover:bg-destructive-subtle/60 hover:text-destructive"
                                      onClick={() =>
                                        setParticipantToRemove(participant)
                                      }
                                    >
                                      <Trash2Icon className="size-3.5" />
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            )}
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Cards */}
              <div className="space-y-3 md:hidden">
                {data.items.map((participant) => {
                  const canMarkResident =
                    permissions.canRecordAttendance &&
                    participant.residentId !== null
                  const isRowPending = pendingParticipantId === participant.id
                  return (
                    <div
                      key={participant.id}
                      className="space-y-2.5 rounded-xl border border-border bg-surface p-3.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {participant.residentNameSnapshot}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {participant.householdLabelSnapshot}
                          </p>
                        </div>
                        <Badge
                          variant={getParticipantStatusBadgeVariant(
                            participant.rsvpStatus
                          )}
                          size="sm"
                        >
                          {formatActivityParticipantStatusLabel(
                            participant.rsvpStatus
                          )}
                        </Badge>
                      </div>

                      {(participant.registrationNotes ||
                        participant.cancellationReason) && (
                          <p className="text-xs text-muted-foreground">
                            {participant.cancellationReason
                              ? `Alasan batal: ${participant.cancellationReason}`
                              : participant.registrationNotes}
                          </p>
                        )}

                      {(canMarkResident ||
                        permissions.canManageParticipants) && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            {canMarkResident && (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={
                                    participant.rsvpStatus === "attended"
                                      ? "default"
                                      : "outline"
                                  }
                                  disabled={
                                    attendanceMutation.isPending || isRowPending
                                  }
                                  onClick={() =>
                                    handleQuickAttendance(participant, "attended")
                                  }
                                >
                                  <CheckIcon className="size-3.5" />
                                  <span>Hadir</span>
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={
                                    participant.rsvpStatus === "absent"
                                      ? "destructive"
                                      : "outline"
                                  }
                                  disabled={
                                    attendanceMutation.isPending || isRowPending
                                  }
                                  onClick={() =>
                                    handleQuickAttendance(participant, "absent")
                                  }
                                >
                                  <XIcon className="size-3.5" />
                                  <span>Absen</span>
                                </Button>
                              </>
                            )}
                            {permissions.canManageParticipants && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="text-destructive"
                                onClick={() =>
                                  setParticipantToRemove(participant)
                                }
                              >
                                <Trash2Icon className="size-3.5" />
                                <span>Hapus</span>
                              </Button>
                            )}
                          </div>
                        )}
                    </div>
                  )
                })}
              </div>

              {/* Pagination */}
              {data.totalPages > 1 && (
                <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
                  <span>
                    Halaman {data.page} dari {data.totalPages} ({data.totalCount}{" "}
                    peserta)
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
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={
                        data.page >= data.totalPages || query.isFetching
                      }
                      onClick={() =>
                        setPage((p) => Math.min(data.totalPages, p + 1))
                      }
                    >
                      <ChevronRightIcon className="size-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Legend */}
          <div className="rounded-xl border border-border bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Keterangan Status:</span>{" "}
            <strong className="text-foreground">Dibatalkan Mandiri</strong> berarti
            warga membatalkan pendaftarannya sendiri dan baris tetap tersimpan;{" "}
            <strong className="text-foreground">Hadir / Tidak Hadir</strong>{" "}
            adalah hasil presensi pelaksanaan; sedangkan tombol hapus peserta{" "}
            <strong className="text-foreground">
              menghapus peserta dari daftar aktif
            </strong>{" "}
            (tercatat pada log audit).
          </div>
        </CardContent>
      </Card>

      <ActivityAddParticipantDialog
        tenantId={tenantId}
        activityId={activityId}
        eligibleResidents={eligibleResidents}
        existingResidentIds={existingResidentIds}
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
      />

      <ActivityRemoveParticipantDialog
        tenantId={tenantId}
        activityId={activityId}
        participant={participantToRemove}
        open={participantToRemove !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setParticipantToRemove(null)
        }}
      />
    </>
  )
}
