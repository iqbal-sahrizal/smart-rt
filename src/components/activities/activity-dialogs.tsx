"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { AlertCircleIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { EligibleActivityResidentOption } from "@/lib/activities/admin-candidates"
import { ACTIVITY_ROSTER_REMOVAL_SEMANTICS_NOTE } from "@/lib/activities/formatters"
import {
  useAddActivityParticipantMutation,
  useRemoveActivityParticipantMutation,
  useSoftDeleteActivityMutation,
  useTransitionActivityStatusMutation,
} from "@/lib/activities/hooks"
import type {
  ActivityManualParticipantStatus,
  ActivityParticipant,
  ActivityStatus,
} from "@/lib/activities/types"

const TRANSITION_META: Record<
  Exclude<ActivityStatus, "scheduled">,
  {
    title: string
    description: string
    confirmLabel: string
    reasonRequired: boolean
    reasonLabel: string
    reasonPlaceholder: string
    variant: "default" | "destructive"
  }
> = {
  ongoing: {
    title: "Mulai Kegiatan Sekarang",
    description:
      "Status kegiatan akan berubah menjadi Berlangsung. Warga dan pengurus tetap dapat memantau kehadiran kegiatan.",
    confirmLabel: "Mulai Kegiatan",
    reasonRequired: false,
    reasonLabel: "Catatan Pelaksanaan (opsional)",
    reasonPlaceholder: "Contoh: Dimulai tepat waktu di pos kamling.",
    variant: "default",
  },
  completed: {
    title: "Tandai Kegiatan Selesai",
    description:
      "Status kegiatan akan berubah menjadi Selesai. Pendaftaran baru ditutup, namun catatan presensi dan dokumentasi tetap dapat diakses.",
    confirmLabel: "Selesaikan Kegiatan",
    reasonRequired: false,
    reasonLabel: "Ringkasan Penutupan (opsional)",
    reasonPlaceholder: "Contoh: Seluruh agenda berjalan lancar.",
    variant: "default",
  },
  cancelled: {
    title: "Batalkan Kegiatan Warga",
    description:
      "Kegiatan akan berstatus Dibatalkan. Pendaftaran mandiri dan unggahan dokumentasi baru akan ditutup.",
    confirmLabel: "Batalkan Kegiatan",
    reasonRequired: true,
    reasonLabel: "Alasan Pembatalan",
    reasonPlaceholder: "Contoh: Hujan deras dan kondisi lapangan tidak aman.",
    variant: "destructive",
  },
}

export function ActivityStatusTransitionDialog({
  tenantId,
  activityId,
  targetStatus,
  open,
  onOpenChange,
  onSuccess,
}: {
  tenantId: string
  activityId: string
  targetStatus: Exclude<ActivityStatus, "scheduled"> | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}) {
  const router = useRouter()
  const [reason, setReason] = React.useState("")
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const mutation = useTransitionActivityStatusMutation(tenantId)

  if (!targetStatus) return null

  const meta = TRANSITION_META[targetStatus]

  function handleClose(nextOpen: boolean) {
    if (mutation.isPending) return
    if (!nextOpen) {
      setReason("")
      setErrorMessage(null)
    }
    onOpenChange(nextOpen)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!targetStatus || mutation.isPending) return

    const trimmed = reason.trim()
    if (meta.reasonRequired && trimmed.length < 3) {
      setErrorMessage("Alasan pembatalan wajib diisi minimal 3 karakter.")
      return
    }

    setErrorMessage(null)
    try {
      await mutation.mutateAsync({
        activityId,
        newStatus: targetStatus,
        reason: trimmed || null,
      })
      toast.success("Status kegiatan berhasil diperbarui.")
      setReason("")
      onOpenChange(false)
      router.refresh()
      onSuccess?.()
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Gagal memperbarui status kegiatan."
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{meta.title}</DialogTitle>
            <DialogDescription>{meta.description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label
              htmlFor="activity-transition-reason"
              className="text-sm font-medium text-foreground"
            >
              {meta.reasonLabel}
              {meta.reasonRequired ? (
                <span className="text-destructive"> *</span>
              ) : null}
            </label>
            <Textarea
              id="activity-transition-reason"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={meta.reasonPlaceholder}
              disabled={mutation.isPending}
            />
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive-border bg-destructive-subtle/40 px-3 py-2 text-xs text-destructive-text"
            >
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <DialogFooter>
            <DialogClose
              render={
                <Button
                  type="button"
                  variant="outline"
                  disabled={mutation.isPending}
                />
              }
            >
              Batal
            </DialogClose>
            <Button
              type="submit"
              variant={meta.variant}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Memproses..." : meta.confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ActivitySoftDeleteDialog({
  tenantId,
  activityId,
  activityTitle,
  open,
  onOpenChange,
  onSuccess,
}: {
  tenantId: string
  activityId: string
  activityTitle: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}) {
  const router = useRouter()
  const [reason, setReason] = React.useState("")
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const deleteMutation = useSoftDeleteActivityMutation(tenantId)

  function handleClose(nextOpen: boolean) {
    if (deleteMutation.isPending) return
    if (!nextOpen) {
      setReason("")
      setErrorMessage(null)
    }
    onOpenChange(nextOpen)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (deleteMutation.isPending) return

    setErrorMessage(null)
    try {
      await deleteMutation.mutateAsync({
        activityId,
        reason: reason.trim() || null,
      })
      toast.success("Kegiatan berhasil diarsipkan (soft delete).")
      onOpenChange(false)
      onSuccess?.()
      router.push("/kegiatan?deleted=1")
      router.refresh()
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Gagal mengarsipkan kegiatan."
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Arsipkan Kegiatan Warga</DialogTitle>
            <DialogDescription>
              Kegiatan &ldquo;{activityTitle}&rdquo; akan disembunyikan dari
              portal warga dan daftar aktif pengurus. Data audit tetap tercatat
              secara aman.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label
              htmlFor="activity-delete-reason"
              className="text-sm font-medium text-foreground"
            >
              Alasan Pengarsipan (opsional)
            </label>
            <Textarea
              id="activity-delete-reason"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Contoh: Kegiatan duplikat atau sudah selesai diarsipkan."
              disabled={deleteMutation.isPending}
            />
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive-border bg-destructive-subtle/40 px-3 py-2 text-xs text-destructive-text"
            >
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <DialogFooter>
            <DialogClose
              render={
                <Button
                  type="button"
                  variant="outline"
                  disabled={deleteMutation.isPending}
                />
              }
            >
              Batal
            </DialogClose>
            <Button
              type="submit"
              variant="destructive"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Mengarsipkan..." : "Arsipkan Kegiatan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ActivityAddParticipantDialog({
  tenantId,
  activityId,
  eligibleResidents,
  existingResidentIds,
  open,
  onOpenChange,
  onSuccess,
}: {
  tenantId: string
  activityId: string
  eligibleResidents: readonly EligibleActivityResidentOption[]
  existingResidentIds: ReadonlySet<string>
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}) {
  const router = useRouter()
  const addMutation = useAddActivityParticipantMutation(tenantId)
  const [search, setSearch] = React.useState("")
  const [selectedResidentId, setSelectedResidentId] = React.useState("")
  const [rsvpStatus, setRsvpStatus] =
    React.useState<ActivityManualParticipantStatus>("attending")
  const [notes, setNotes] = React.useState("")
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  const filteredResidents = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return eligibleResidents.filter((item) => {
      if (!q) return true
      return (
        item.fullName.toLowerCase().includes(q) ||
        item.householdLabel.toLowerCase().includes(q)
      )
    })
  }, [eligibleResidents, search])

  function handleClose(nextOpen: boolean) {
    if (addMutation.isPending) return
    if (!nextOpen) {
      setSearch("")
      setSelectedResidentId("")
      setNotes("")
      setErrorMessage(null)
    }
    onOpenChange(nextOpen)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (addMutation.isPending) return

    if (!selectedResidentId) {
      setErrorMessage("Pilih salah satu warga aktif terlebih dahulu.")
      return
    }

    setErrorMessage(null)
    try {
      await addMutation.mutateAsync({
        activityId,
        residentId: selectedResidentId,
        rsvpStatus,
        notes: notes.trim() || null,
      })
      toast.success("Peserta berhasil ditambahkan ke kegiatan.")
      handleClose(false)
      router.refresh()
      onSuccess?.()
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Gagal menambahkan peserta."
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Tambah Peserta Kegiatan</DialogTitle>
            <DialogDescription>
              Pilih warga aktif pada RT ini untuk didaftarkan atau diundang
              secara manual oleh Ketua RT / Sekretaris.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label
                htmlFor="participant-resident-search"
                className="text-sm font-medium text-foreground"
              >
                Cari Warga Aktif
              </label>
              <Input
                id="participant-resident-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ketik nama warga atau blok/unit..."
                disabled={addMutation.isPending}
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="participant-resident-select"
                className="text-sm font-medium text-foreground"
              >
                Warga <span className="text-destructive">*</span>
              </label>
              <select
                id="participant-resident-select"
                value={selectedResidentId}
                onChange={(e) => setSelectedResidentId(e.target.value)}
                disabled={addMutation.isPending}
                className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-2xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
              >
                <option value="">-- Pilih warga aktif --</option>
                {filteredResidents.map((opt) => {
                  const alreadyInRoster = existingResidentIds.has(
                    opt.residentId
                  )
                  return (
                    <option key={opt.residentId} value={opt.residentId}>
                      {opt.fullName} ({opt.householdLabel})
                      {alreadyInRoster ? " — Sudah ada di daftar" : ""}
                    </option>
                  )
                })}
              </select>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="participant-manual-status"
                className="text-sm font-medium text-foreground"
              >
                Status Awal
              </label>
              <select
                id="participant-manual-status"
                value={rsvpStatus}
                onChange={(e) =>
                  setRsvpStatus(
                    e.target.value as ActivityManualParticipantStatus
                  )
                }
                disabled={addMutation.isPending}
                className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-2xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
              >
                <option value="attending">Terdaftar / Hadir</option>
                <option value="invited">Diundang</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="participant-manual-notes"
                className="text-sm font-medium text-foreground"
              >
                Catatan (opsional)
              </label>
              <Input
                id="participant-manual-notes"
                maxLength={500}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Contoh: Koordinator perlengkapan"
                disabled={addMutation.isPending}
              />
            </div>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive-border bg-destructive-subtle/40 px-3 py-2 text-xs text-destructive-text"
            >
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <DialogFooter>
            <DialogClose
              render={
                <Button
                  type="button"
                  variant="outline"
                  disabled={addMutation.isPending}
                />
              }
            >
              Batal
            </DialogClose>
            <Button type="submit" disabled={addMutation.isPending}>
              {addMutation.isPending ? "Menyimpan..." : "Tambah Peserta"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ActivityRemoveParticipantDialog({
  tenantId,
  activityId,
  participant,
  open,
  onOpenChange,
  onSuccess,
}: {
  tenantId: string
  activityId: string
  participant: ActivityParticipant | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}) {
  const router = useRouter()
  const removeMutation = useRemoveActivityParticipantMutation(tenantId)
  const [reason, setReason] = React.useState("")
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  if (!participant) return null

  function handleClose(nextOpen: boolean) {
    if (removeMutation.isPending) return
    if (!nextOpen) {
      setReason("")
      setErrorMessage(null)
    }
    onOpenChange(nextOpen)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!participant || removeMutation.isPending) return

    setErrorMessage(null)
    try {
      await removeMutation.mutateAsync({
        activityId,
        participantId: participant.id,
        reason: reason.trim() || null,
      })
      toast.success("Peserta dihapus dari daftar peserta aktif.")
      handleClose(false)
      router.refresh()
      onSuccess?.()
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Gagal menghapus peserta."
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Hapus Peserta dari Daftar Aktif</DialogTitle>
            <DialogDescription>
              Anda akan menghapus{" "}
              <span className="font-medium text-foreground">
                {participant.residentNameSnapshot}
              </span>{" "}
              ({participant.householdLabelSnapshot}) dari daftar peserta
              kegiatan ini.
            </DialogDescription>
          </DialogHeader>

          <p className="rounded-lg border border-warning-border bg-warning-subtle/40 px-3 py-2 text-xs leading-relaxed text-foreground">
            {ACTIVITY_ROSTER_REMOVAL_SEMANTICS_NOTE}
          </p>

          <div className="space-y-1.5">
            <label
              htmlFor="remove-participant-reason"
              className="text-sm font-medium text-foreground"
            >
              Catatan Penghapusan (opsional)
            </label>
            <Input
              id="remove-participant-reason"
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Contoh: Salah pencatatan nama peserta"
              disabled={removeMutation.isPending}
            />
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive-border bg-destructive-subtle/40 px-3 py-2 text-xs text-destructive-text"
            >
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <DialogFooter>
            <DialogClose
              render={
                <Button
                  type="button"
                  variant="outline"
                  disabled={removeMutation.isPending}
                />
              }
            >
              Batal
            </DialogClose>
            <Button
              type="submit"
              variant="destructive"
              disabled={removeMutation.isPending}
            >
              {removeMutation.isPending ? "Menghapus..." : "Hapus dari Daftar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

