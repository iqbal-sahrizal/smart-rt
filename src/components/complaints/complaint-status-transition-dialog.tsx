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
import { Textarea } from "@/components/ui/textarea"
import { getComplaintTransitionActionMeta } from "@/lib/complaints/formatters"
import { useTransitionComplaintStatusMutation } from "@/lib/complaints/hooks"
import { transitionComplaintStatusSchema } from "@/lib/complaints/schemas"
import type { ComplaintTransitionTarget } from "@/lib/complaints/types"

interface ComplaintStatusTransitionDialogProps {
  tenantId: string
  complaintId: string
  targetStatus: ComplaintTransitionTarget | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function ComplaintStatusTransitionDialog({
  tenantId,
  complaintId,
  targetStatus,
  open,
  onOpenChange,
  onSuccess,
}: ComplaintStatusTransitionDialogProps) {
  const router = useRouter()
  const [reason, setReason] = React.useState("")
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const transitionMutation = useTransitionComplaintStatusMutation(tenantId)

  if (!targetStatus) {
    return null
  }

  const meta = getComplaintTransitionActionMeta(targetStatus)

  function handleCloseDialog(nextOpen: boolean) {
    if (transitionMutation.isPending) return
    if (!nextOpen) {
      setReason("")
      setErrorMessage(null)
    }
    onOpenChange(nextOpen)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!targetStatus || transitionMutation.isPending) return

    const trimmedReason = reason.trim()
    if (trimmedReason.length < 3) {
      setErrorMessage(
        "Alasan perubahan status wajib diisi minimal 3 karakter."
      )
      return
    }

    const parsed = transitionComplaintStatusSchema.safeParse({
      complaintId,
      newStatus: targetStatus,
      reason: trimmedReason,
    })

    if (!parsed.success) {
      setErrorMessage(
        parsed.error.issues[0]?.message ??
          "Periksa kembali alasan perubahan status."
      )
      return
    }

    setErrorMessage(null)

    try {
      await transitionMutation.mutateAsync({
        complaintId,
        newStatus: targetStatus,
        reason: trimmedReason,
      })
      toast.success("Status pengaduan berhasil diperbarui")
      setReason("")
      setErrorMessage(null)
      onOpenChange(false)
      router.refresh()
      onSuccess?.()
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Gagal memperbarui status pengaduan. Silakan coba lagi."
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleCloseDialog}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{meta.dialogTitle}</DialogTitle>
            <DialogDescription>{meta.dialogDescription}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label
              htmlFor="complaint-transition-reason"
              className="text-sm font-medium text-foreground"
            >
              Alasan perubahan status <span className="text-destructive">*</span>
            </label>
            <Textarea
              id="complaint-transition-reason"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value)
                if (errorMessage) setErrorMessage(null)
              }}
              placeholder="Tuliskan catatan tindak lanjut atau alasan perubahan status (3–500 karakter)..."
              maxLength={500}
              rows={3}
              disabled={transitionMutation.isPending}
              aria-invalid={Boolean(errorMessage)}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Wajib diisi untuk jejak riwayat status.</span>
              <span className="tabular-nums">{reason.trim().length}/500</span>
            </div>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-xs text-destructive"
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
                  disabled={transitionMutation.isPending}
                >
                  Batal
                </Button>
              }
            />
            <Button
              type="submit"
              variant={
                meta.buttonVariant === "destructive" ? "destructive" : "default"
              }
              disabled={transitionMutation.isPending}
              data-testid={`confirm-status-${targetStatus}`}
            >
              {transitionMutation.isPending ? "Menyimpan..." : meta.confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
