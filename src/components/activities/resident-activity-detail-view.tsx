"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  BanIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  ClockIcon,
  InfoIcon,
  MapPinIcon,
  UsersIcon,
} from "lucide-react"
import { toast } from "sonner"

import { ActivityDocumentPanel } from "@/components/activities/activity-document-panel"
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { MAX_ACTIVITY_NOTES_LENGTH } from "@/lib/activities/constants"
import {
  formatActivityCategoryLabel,
  formatActivityDateTimeRange,
  formatActivityParticipantStatusLabel,
  formatActivityQuotaSummary,
  formatActivityStatusLabel,
} from "@/lib/activities/formatters"
import {
  useCancelActivityRegistrationMutation,
  useRegisterForActivityMutation,
  useResidentActivityDetail,
} from "@/lib/activities/hooks"
import {
  cancelActivityRegistrationSchema,
  registerForActivitySchema,
} from "@/lib/activities/schemas"
import type { ResidentActivityDetail } from "@/lib/activities/types"
import {
  formatJakartaDateTimeShort,
  getActivityCategoryBadgeVariant,
  getActivityStatusBadgeVariant,
  getParticipantStatusBadgeVariant,
} from "@/lib/activities/ui-helpers"

export function ResidentActivityDetailView({
  tenantId,
  actorKey,
  activityId,
  initialDetail,
}: {
  tenantId: string
  actorKey: string
  activityId: string
  initialDetail: ResidentActivityDetail
}) {
  const router = useRouter()
  const detailQuery = useResidentActivityDetail({
    tenantId,
    actorKey,
    activityId,
    initialData: initialDetail,
  })

  const registerMutation = useRegisterForActivityMutation(tenantId)
  const cancelMutation = useCancelActivityRegistrationMutation(tenantId)

  const detail = detailQuery.data ?? initialDetail
  const { activity, myRegistration, isEligibleResident } = detail

  const [notes, setNotes] = React.useState("")
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [cancelOpen, setCancelOpen] = React.useState(false)
  const [cancelReason, setCancelReason] = React.useState("")
  const [cancelError, setCancelError] = React.useState<string | null>(null)

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    if (registerMutation.isPending) return

    const parsed = registerForActivitySchema.safeParse({
      activityId: activity.id,
      notes: notes.trim() || null,
    })

    if (!parsed.success) {
      setActionError(
        parsed.error.issues[0]?.message ?? "Catatan pendaftaran tidak valid."
      )
      return
    }

    setActionError(null)
    try {
      await registerMutation.mutateAsync(parsed.data)
      toast.success("Anda berhasil terdaftar sebagai peserta kegiatan.")
      setNotes("")
      router.refresh()
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : "Gagal mendaftar kegiatan. Silakan coba lagi."
      )
    }
  }

  async function handleCancelRegistration(e: React.FormEvent) {
    e.preventDefault()
    if (cancelMutation.isPending) return

    const parsed = cancelActivityRegistrationSchema.safeParse({
      activityId: activity.id,
      reason: cancelReason.trim() || null,
    })

    if (!parsed.success) {
      setCancelError(
        parsed.error.issues[0]?.message ??
          "Alasan pembatalan maksimal 500 karakter."
      )
      return
    }

    setCancelError(null)
    try {
      await cancelMutation.mutateAsync(parsed.data)
      toast.success("Pendaftaran kegiatan Anda dibatalkan.")
      setCancelReason("")
      setCancelOpen(false)
      router.refresh()
    } catch (err) {
      setCancelError(
        err instanceof Error
          ? err.message
          : "Gagal membatalkan pendaftaran. Silakan coba lagi."
      )
    }
  }

  return (
    <ResidentContainer className="flex flex-col gap-5">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href="/resident/activities" />}
          className="h-9"
        >
          <ArrowLeftIcon className="size-4" />
          <span>Daftar Kegiatan</span>
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href="/resident/activities/my" />}
          className="h-9 text-primary"
        >
          <span>Kegiatan Saya</span>
        </Button>
      </div>

      {/* Main Info */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant={getActivityCategoryBadgeVariant(activity.category)}
              size="sm"
            >
              {formatActivityCategoryLabel(activity.category)}
            </Badge>
            <Badge
              variant={getActivityStatusBadgeVariant(activity.status)}
              size="sm"
            >
              {formatActivityStatusLabel(activity.status)}
            </Badge>
            {activity.isFull && (
              <Badge variant="destructive" size="sm">
                Kuota Penuh
              </Badge>
            )}
          </div>
          <CardTitle className="pt-1 text-lg leading-snug sm:text-xl">
            {activity.title}
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          {activity.status === "cancelled" && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-xl border border-destructive-border bg-destructive-subtle/40 px-3.5 py-2.5 text-xs text-destructive-text"
            >
              <BanIcon className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">Kegiatan Ini Dibatalkan</p>
                {activity.cancellationReason && (
                  <p className="mt-0.5">Alasan: {activity.cancellationReason}</p>
                )}
              </div>
            </div>
          )}

          {activity.description && (
            <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
              {activity.description}
            </p>
          )}

          <div className="grid gap-3 rounded-xl border border-border bg-muted/20 p-3.5 sm:grid-cols-2">
            <div className="flex items-start gap-2">
              <CalendarDaysIcon className="mt-0.5 size-4 shrink-0 text-primary" />
              <div>
                <p className="text-[11px] font-medium text-muted-foreground">
                  Jadwal Pelaksanaan
                </p>
                <p className="text-xs font-medium text-foreground sm:text-sm">
                  {formatActivityDateTimeRange(
                    activity.startAt,
                    activity.endAt
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <MapPinIcon className="mt-0.5 size-4 shrink-0 text-primary" />
              <div>
                <p className="text-[11px] font-medium text-muted-foreground">
                  Lokasi
                </p>
                <p className="text-xs font-medium text-foreground sm:text-sm">
                  {activity.location}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <UsersIcon className="mt-0.5 size-4 shrink-0 text-primary" />
              <div>
                <p className="text-[11px] font-medium text-muted-foreground">
                  Jumlah Peserta
                </p>
                <p className="text-xs font-medium text-foreground tabular-nums sm:text-sm">
                  {formatActivityQuotaSummary(
                    activity.activeParticipantCount,
                    activity.maxParticipants
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <ClockIcon className="mt-0.5 size-4 shrink-0 text-primary" />
              <div>
                <p className="text-[11px] font-medium text-muted-foreground">
                  Pendaftaran
                </p>
                <p className="text-xs font-medium text-foreground sm:text-sm">
                  {activity.allowSelfRegistration
                    ? activity.registrationDeadline
                      ? `Batas: ${formatJakartaDateTimeShort(
                          activity.registrationDeadline
                        )}`
                      : "Terbuka hingga kegiatan berakhir"
                    : "Dikelola pengurus RT"}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Own Registration Card (NO other resident PII!) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Status Pendaftaran Anda
          </CardTitle>
          <CardDescription>
            Informasi keikutsertaan pribadi Anda pada kegiatan ini.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {myRegistration ? (
            <div className="space-y-2 rounded-xl border border-border bg-surface p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Status Saat Ini
                </span>
                <Badge
                  variant={getParticipantStatusBadgeVariant(
                    myRegistration.rsvpStatus
                  )}
                >
                  {formatActivityParticipantStatusLabel(
                    myRegistration.rsvpStatus
                  )}
                </Badge>
              </div>

              <p className="text-xs text-muted-foreground">
                Terdaftar pada:{" "}
                <span className="font-medium text-foreground">
                  {formatJakartaDateTimeShort(myRegistration.registeredAt)}
                </span>
              </p>

              {myRegistration.registrationNotes && (
                <p className="text-xs text-muted-foreground">
                  Catatan:{" "}
                  <span className="text-foreground">
                    {myRegistration.registrationNotes}
                  </span>
                </p>
              )}

              {myRegistration.rsvpStatus === "cancelled" && (
                <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  Anda membatalkan pendaftaran ini secara mandiri (
                  {formatJakartaDateTimeShort(myRegistration.cancelledAt)}
                  {myRegistration.cancellationReason
                    ? ` — ${myRegistration.cancellationReason}`
                    : ""}
                  ). Riwayat pembatalan mandiri tetap tercatat dan berbeda dari
                  status presensi Hadir / Tidak Hadir.
                </p>
              )}

              {myRegistration.rsvpStatus === "attended" && (
                <div className="flex items-center gap-2 text-xs font-medium text-success-text">
                  <CheckCircle2Icon className="size-4" />
                  <span>Kehadiran Anda sudah dicatat oleh pengurus.</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/20 p-3.5 text-xs text-muted-foreground">
              <InfoIcon className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>Anda belum terdaftar pada kegiatan ini.</span>
            </div>
          )}

          {actionError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive-border bg-destructive-subtle/40 px-3 py-2 text-xs text-destructive-text"
            >
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
              <span>{actionError}</span>
            </div>
          )}

          {activity.canRegister ? (
            <form onSubmit={handleRegister} className="space-y-3">
              <div className="space-y-1.5">
                <label
                  htmlFor="resident-activity-notes"
                  className="text-xs font-medium text-foreground"
                >
                  Catatan Kehadiran / Perlengkapan (opsional)
                </label>
                <Textarea
                  id="resident-activity-notes"
                  rows={2}
                  maxLength={MAX_ACTIVITY_NOTES_LENGTH}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Contoh: Bawa cangkul atau konsumsi ringan"
                  disabled={registerMutation.isPending}
                />
              </div>
              <Button
                type="submit"
                className="h-11 w-full"
                disabled={registerMutation.isPending}
              >
                {registerMutation.isPending
                  ? "Memproses Pendaftaran..."
                  : myRegistration?.rsvpStatus === "cancelled"
                    ? "Daftar Ulang Kegiatan"
                    : "Daftar Ikut Kegiatan"}
              </Button>
            </form>
          ) : (
            !activity.canCancelRegistration &&
            activity.registrationBlockReason && (
              <p className="text-xs text-muted-foreground">
                {!isEligibleResident
                  ? "Akun Anda belum terhubung sebagai warga aktif pada rumah tangga aktif di RT ini."
                  : activity.registrationBlockReason}
              </p>
            )
          )}

          {activity.canCancelRegistration && (
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full border-destructive-border text-destructive hover:bg-destructive-subtle/40"
              disabled={cancelMutation.isPending}
              onClick={() => {
                setCancelError(null)
                setCancelOpen(true)
              }}
            >
              <BanIcon className="size-4" />
              <span>Batalkan Pendaftaran Saya</span>
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Read-Only Documentation via Private Authenticated Proxy */}
      <ActivityDocumentPanel
        tenantId={tenantId}
        activityId={activity.id}
        documents={activity.documents}
        permissions={{
          canUploadDocuments: false,
          canRemoveDocuments: false,
        }}
      />

      {/* Cancel Registration Dialog */}
      <Dialog
        open={cancelOpen}
        onOpenChange={(nextOpen) => {
          if (cancelMutation.isPending) return
          if (!nextOpen) {
            setCancelReason("")
            setCancelError(null)
          }
          setCancelOpen(nextOpen)
        }}
      >
        <DialogContent>
          <form
            onSubmit={handleCancelRegistration}
            className="flex flex-col gap-4"
          >
            <DialogHeader>
              <DialogTitle>Batalkan Pendaftaran Kegiatan?</DialogTitle>
              <DialogDescription>
                Kursi Anda pada kegiatan &ldquo;{activity.title}&rdquo; akan
                dikosongkan untuk warga lain. Riwayat pembatalan mandiri Anda
                tetap tersimpan dengan status Dibatalkan Mandiri.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5">
              <label
                htmlFor="resident-cancel-reason"
                className="text-sm font-medium text-foreground"
              >
                Alasan Pembatalan (opsional)
              </label>
              <Textarea
                id="resident-cancel-reason"
                rows={3}
                maxLength={500}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Contoh: Ada keperluan keluarga mendadak."
                disabled={cancelMutation.isPending}
              />
            </div>

            {cancelError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-destructive-border bg-destructive-subtle/40 px-3 py-2 text-xs text-destructive-text"
              >
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                <span>{cancelError}</span>
              </div>
            )}

            <DialogFooter>
              <DialogClose
                render={
                  <Button
                    type="button"
                    variant="outline"
                    disabled={cancelMutation.isPending}
                  />
                }
              >
                Tetap Terdaftar
              </DialogClose>
              <Button
                type="submit"
                variant="destructive"
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending
                  ? "Membatalkan..."
                  : "Ya, Batalkan Pendaftaran"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </ResidentContainer>
  )
}

