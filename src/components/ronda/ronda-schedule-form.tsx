"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  CheckIcon,
  ClockIcon,
  PlusIcon,
  SearchIcon,
  UsersIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

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
import { Textarea } from "@/components/ui/textarea"
import {
  addResidentToRoster,
  formatRondaTimeRange,
  removeResidentFromRoster,
  type SelectedOfficerItem,
} from "@/lib/ronda/formatters"
import { upsertRondaScheduleSchema } from "@/lib/ronda/schemas"
import type {
  RondaResidentCandidate,
  RondaScheduleWithRoster,
} from "@/lib/ronda/types"
import {
  useRondaResidentCandidates,
  useUpsertRondaScheduleMutation,
} from "@/lib/ronda/use-ronda"

interface RondaScheduleFormProps {
  tenantId: string
  mode: "create" | "edit"
  initialDate?: string
  initialSchedule?: RondaScheduleWithRoster
  initialCandidates: RondaResidentCandidate[]
  candidatesError?: string | null
}

function toTimeInputValue(dbTime: string | null | undefined): string {
  if (!dbTime) return ""
  return dbTime.slice(0, 5)
}

export function RondaScheduleForm({
  tenantId,
  mode,
  initialDate,
  initialSchedule,
  initialCandidates,
  candidatesError,
}: RondaScheduleFormProps) {
  const router = useRouter()
  const upsertMutation = useUpsertRondaScheduleMutation({ tenantId })

  const [scheduleDate, setScheduleDate] = React.useState(
    initialSchedule?.schedule.scheduleDate ?? initialDate ?? ""
  )
  const [shiftLabel, setShiftLabel] = React.useState(
    initialSchedule?.schedule.shiftLabel ?? "Ronda Malam"
  )
  const [startTime, setStartTime] = React.useState(
    toTimeInputValue(initialSchedule?.schedule.startTime) || "22:00"
  )
  const [endTime, setEndTime] = React.useState(
    toTimeInputValue(initialSchedule?.schedule.endTime) || "04:00"
  )
  const [meetingPoint, setMeetingPoint] = React.useState(
    initialSchedule?.schedule.meetingPoint ?? ""
  )
  const [notes, setNotes] = React.useState(initialSchedule?.schedule.notes ?? "")
  const [selectedOfficers, setSelectedOfficers] = React.useState<
    SelectedOfficerItem[]
  >(() =>
    initialSchedule
      ? initialSchedule.roster
          .filter((officer): officer is typeof officer & { residentId: string } =>
            Boolean(officer.residentId)
          )
          .map((officer) => ({
            residentId: officer.residentId,
            fullName: officer.residentNameSnapshot,
            householdLabel: officer.householdLabelSnapshot,
            attendanceStatus: officer.attendanceStatus,
          }))
      : []
  )

  const [candidateSearch, setCandidateSearch] = React.useState("")
  const [debouncedSearch, setDebouncedSearch] = React.useState("")
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>(
    {}
  )
  const [submitError, setSubmitError] = React.useState<string | null>(null)

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(candidateSearch.trim())
    }, 250)
    return () => clearTimeout(timer)
  }, [candidateSearch])

  const candidatesQuery = useRondaResidentCandidates({
    tenantId,
    search: debouncedSearch || undefined,
    initialData: debouncedSearch === "" ? initialCandidates : undefined,
  })

  const candidates =
    candidatesQuery.data ?? (debouncedSearch === "" ? initialCandidates : [])

  const selectedIds = React.useMemo(
    () => new Set(selectedOfficers.map((item) => item.residentId)),
    [selectedOfficers]
  )

  const timePreview = formatRondaTimeRange(
    startTime || null,
    endTime || null
  )

  function handleAddCandidate(candidate: RondaResidentCandidate) {
    setSelectedOfficers((prev) => addResidentToRoster(prev, candidate))
    setFieldErrors((prev) => {
      if (!prev.residentIds) return prev
      const next = { ...prev }
      delete next.residentIds
      return next
    })
  }

  function handleRemoveOfficer(residentId: string) {
    setSelectedOfficers((prev) => removeResidentFromRoster(prev, residentId))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (upsertMutation.isPending) return

    setFieldErrors({})
    setSubmitError(null)

    const payload = {
      scheduleId: mode === "edit" ? initialSchedule?.schedule.id : undefined,
      scheduleDate: scheduleDate.trim(),
      shiftLabel: shiftLabel.trim() || "Ronda Malam",
      startTime: startTime.trim() || "22:00",
      endTime: endTime.trim() || "04:00",
      meetingPoint: meetingPoint.trim() ? meetingPoint.trim() : null,
      notes: notes.trim() ? notes.trim() : null,
      residentIds: selectedOfficers.map((o) => o.residentId),
    }

    const parsed = upsertRondaScheduleSchema.safeParse(payload)
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form")
        if (!nextErrors[key]) {
          nextErrors[key] = issue.message
        }
      }
      setFieldErrors(nextErrors)
      setSubmitError(
        parsed.error.issues[0]?.message ?? "Periksa kembali data jadwal ronda."
      )
      return
    }

    try {
      const saved = await upsertMutation.mutateAsync(parsed.data)
      toast.success(
        mode === "edit"
          ? "Jadwal ronda berhasil diperbarui"
          : "Jadwal ronda berhasil dibuat"
      )
      router.push(`/ronda/${saved.id}`)
      router.refresh()
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : "Terjadi kesalahan saat menyimpan jadwal ronda."
      )
    }
  }

  const backHref =
    mode === "edit" && initialSchedule
      ? `/ronda/${initialSchedule.schedule.id}`
      : "/ronda"

  return (
    <PageContainer className="flex flex-col gap-[var(--space-6)]">
      <div className="flex flex-col gap-3">
        <div>
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href={backHref} />}
          >
            <ArrowLeftIcon className="size-4" />
            <span>Kembali</span>
          </Button>
        </div>
        <PageHeader
          title={
            mode === "edit" ? "Ubah Jadwal Ronda" : "Tambah Jadwal Ronda Baru"
          }
          description={
            mode === "edit"
              ? "Perbarui tanggal, waktu shift, titik kumpul, atau daftar petugas ronda."
              : "Tentukan tanggal ronda dan pilih warga aktif yang bertugas secara manual."
          }
        />
      </div>

      {submitError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive-subtle px-4 py-3 text-sm text-destructive"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
          <span>{submitError}</span>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        noValidate
        className="grid gap-[var(--space-6)] lg:grid-cols-5"
      >
        {/* Left: Schedule Fields */}
        <div className="flex flex-col gap-[var(--space-6)] lg:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Informasi Sesi Ronda</CardTitle>
              <CardDescription>
                Setiap tanggal hanya dapat memiliki satu sesi jadwal ronda.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="ronda-schedule-date"
                    className="text-sm font-medium text-foreground"
                  >
                    Tanggal Ronda <span className="text-destructive">*</span>
                  </label>
                  <Input
                    id="ronda-schedule-date"
                    type="date"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    aria-invalid={Boolean(fieldErrors.scheduleDate)}
                    required
                  />
                  {fieldErrors.scheduleDate && (
                    <p className="text-xs text-destructive">
                      {fieldErrors.scheduleDate}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="ronda-shift-label"
                    className="text-sm font-medium text-foreground"
                  >
                    Nama Shift <span className="text-destructive">*</span>
                  </label>
                  <Input
                    id="ronda-shift-label"
                    type="text"
                    maxLength={100}
                    placeholder="Contoh: Ronda Malam"
                    value={shiftLabel}
                    onChange={(e) => setShiftLabel(e.target.value)}
                    aria-invalid={Boolean(fieldErrors.shiftLabel)}
                    required
                  />
                  {fieldErrors.shiftLabel && (
                    <p className="text-xs text-destructive">
                      {fieldErrors.shiftLabel}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="ronda-start-time"
                    className="text-sm font-medium text-foreground"
                  >
                    Jam Mulai
                  </label>
                  <Input
                    id="ronda-start-time"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    aria-invalid={Boolean(fieldErrors.startTime)}
                  />
                  {fieldErrors.startTime && (
                    <p className="text-xs text-destructive">
                      {fieldErrors.startTime}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="ronda-end-time"
                    className="text-sm font-medium text-foreground"
                  >
                    Jam Selesai
                  </label>
                  <Input
                    id="ronda-end-time"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    aria-invalid={Boolean(fieldErrors.endTime)}
                  />
                  {fieldErrors.endTime && (
                    <p className="text-xs text-destructive">
                      {fieldErrors.endTime}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <ClockIcon className="size-3.5 text-primary" />
                <span>Pratinjau jam tugas: {timePreview.label}</span>
                {timePreview.isOvernight && (
                  <Badge variant="accent" size="sm">
                    Lintas Hari (+1 hari)
                  </Badge>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="ronda-meeting-point"
                  className="text-sm font-medium text-foreground"
                >
                  Titik Kumpul
                </label>
                <Input
                  id="ronda-meeting-point"
                  type="text"
                  maxLength={200}
                  placeholder="Contoh: Pos Kamling RT 01"
                  value={meetingPoint}
                  onChange={(e) => setMeetingPoint(e.target.value)}
                  aria-invalid={Boolean(fieldErrors.meetingPoint)}
                />
                {fieldErrors.meetingPoint && (
                  <p className="text-xs text-destructive">
                    {fieldErrors.meetingPoint}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="ronda-notes"
                    className="text-sm font-medium text-foreground"
                  >
                    Catatan Tambahan
                  </label>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {notes.length}/1000
                  </span>
                </div>
                <Textarea
                  id="ronda-notes"
                  maxLength={1000}
                  rows={3}
                  placeholder="Arahan rute patroli, perlengkapan senter, atau catatan khusus lainnya..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  aria-invalid={Boolean(fieldErrors.notes)}
                />
                {fieldErrors.notes && (
                  <p className="text-xs text-destructive">
                    {fieldErrors.notes}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Selected Roster Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <UsersIcon className="size-4 text-primary" />
                  <span>Petugas Terpilih</span>
                </span>
                <Badge variant="default">
                  {selectedOfficers.length} petugas
                </Badge>
              </CardTitle>
              <CardDescription>
                Jumlah petugas fleksibel (minimal 1 warga aktif). Urutan dapat
                disesuaikan sebelum disimpan.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {fieldErrors.residentIds && (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-xs text-destructive"
                >
                  {fieldErrors.residentIds}
                </p>
              )}

              {selectedOfficers.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  Belum ada petugas terpilih. Pilih warga aktif dari daftar
                  kandidat di samping.
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {selectedOfficers.map((officer, index) => (
                    <li
                      key={officer.residentId}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-muted-foreground tabular-nums">
                            #{index + 1}
                          </span>
                          <span className="truncate text-sm font-medium text-foreground">
                            {officer.fullName}
                          </span>
                          {officer.attendanceStatus && (
                            <Badge variant="info" size="sm">
                              Kehadiran tercatat
                            </Badge>
                          )}
                        </div>
                        {officer.householdLabel && (
                          <p className="truncate pl-6 text-xs text-muted-foreground">
                            {officer.householdLabel}
                          </p>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Hapus ${officer.fullName} dari petugas`}
                        onClick={() => handleRemoveOfficer(officer.residentId)}
                      >
                        <XIcon className="size-4 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: Eligible Resident Picker */}
        <div className="flex flex-col gap-[var(--space-6)] lg:col-span-2">
          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle className="text-base">Pilih Warga Bertugas</CardTitle>
              <CardDescription>
                Menampilkan warga berstatus aktif dari rumah tangga aktif.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  aria-label="Cari warga aktif untuk petugas ronda"
                  placeholder="Cari nama warga atau alamat rumah..."
                  value={candidateSearch}
                  onChange={(e) => setCandidateSearch(e.target.value)}
                  className="pl-9"
                />
              </div>

              {candidatesError || candidatesQuery.error ? (
                <div
                  role="alert"
                  className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-3 text-xs text-destructive"
                >
                  <span>
                    {candidatesQuery.error instanceof Error
                      ? candidatesQuery.error.message
                      : candidatesError}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => candidatesQuery.refetch()}
                  >
                    Muat Ulang Kandidat
                  </Button>
                </div>
              ) : candidatesQuery.isLoading && candidates.length === 0 ? (
                <div className="space-y-2 py-2">
                  {Array.from({ length: 4 }).map((_, idx) => (
                    <div
                      key={idx}
                      className="h-12 animate-pulse rounded-md bg-muted/40"
                    />
                  ))}
                </div>
              ) : candidates.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
                  {debouncedSearch
                    ? `Tidak ada warga aktif yang cocok dengan "${debouncedSearch}".`
                    : "Belum ada warga aktif yang memenuhi syarat penugasan."}
                </div>
              ) : (
                <ul className="flex max-h-[420px] flex-col gap-2 overflow-y-auto pr-1">
                  {candidates.map((candidate) => {
                    const isSelected = selectedIds.has(candidate.id)
                    return (
                      <li
                        key={candidate.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-background px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-foreground">
                            {candidate.fullName}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {candidate.householdLabel ?? "Rumah tangga aktif"}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant={isSelected ? "secondary" : "outline"}
                          size="sm"
                          disabled={isSelected}
                          onClick={() => handleAddCandidate(candidate)}
                        >
                          {isSelected ? (
                            <>
                              <CheckIcon className="size-3.5" />
                              <span>Terpilih</span>
                            </>
                          ) : (
                            <>
                              <PlusIcon className="size-3.5" />
                              <span>Pilih</span>
                            </>
                          )}
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              )}

              <div className="mt-2 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  disabled={upsertMutation.isPending}
                  onClick={() => router.push(backHref)}
                >
                  Batal
                </Button>
                <Button type="submit" disabled={upsertMutation.isPending}>
                  {upsertMutation.isPending
                    ? "Menyimpan..."
                    : mode === "edit"
                      ? "Simpan Perubahan"
                      : "Simpan Jadwal Ronda"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </form>
    </PageContainer>
  )
}
