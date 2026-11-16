"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { AlertCircleIcon, Trash2Icon } from "lucide-react"
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
  DialogTrigger,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { useSoftDeleteComplaintMutation } from "@/lib/complaints/hooks"
import { softDeleteComplaintSchema } from "@/lib/complaints/schemas"

interface ComplaintDeleteDialogProps {
  tenantId: string
  complaintId: string
  complaintTitle: string
  variant?: "default" | "outline" | "destructive" | "ghost"
  size?: "default" | "sm" | "icon"
}

export function ComplaintDeleteDialog({
  tenantId,
  complaintId,
  complaintTitle,
  variant = "destructive",
  size = "default",
}: ComplaintDeleteDialogProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState("")
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const deleteMutation = useSoftDeleteComplaintMutation(tenantId)

  async function handleConfirmDelete(event: React.FormEvent) {
    event.preventDefault()
    if (deleteMutation.isPending) return

    const trimmedReason = reason.trim()
    const parsed = softDeleteComplaintSchema.safeParse({
      complaintId,
      reason: trimmedReason,
    })

    if (!parsed.success) {
      setErrorMessage(
        parsed.error.issues[0]?.message ??
          "Alasan penghapusan wajib diisi (3–500 karakter)."
      )
      return
    }

    setErrorMessage(null)

    try {
      await deleteMutation.mutateAsync({
        complaintId,
        reason: trimmedReason,
      })
      setOpen(false)
      toast.success("Pengaduan berhasil dihapus")
      router.push("/pengaduan?deleted=1")
      router.refresh()
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Gagal menghapus pengaduan. Silakan coba lagi."
      )
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (deleteMutation.isPending) return
        setOpen(nextOpen)
        if (!nextOpen) {
          setReason("")
          setErrorMessage(null)
        }
      }}
    >
      <DialogTrigger
        render={
          <Button
            type="button"
            variant={variant}
            size={size}
            aria-label="Hapus pengaduan"
            data-testid="open-delete-complaint-btn"
          >
            <Trash2Icon className="size-4" />
            <span>Hapus Pengaduan</span>
          </Button>
        }
      />
      <DialogContent>
        <form onSubmit={handleConfirmDelete} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Hapus Pengaduan Warga?</DialogTitle>
            <DialogDescription>
              Anda akan menghapus pengaduan{" "}
              <strong className="font-semibold text-foreground">
                {complaintTitle}
              </strong>{" "}
              dari daftar pengaduan aktif RT. Jejak audit penghapusan akan
              tetap tercatat.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label
              htmlFor="complaint-delete-reason"
              className="text-sm font-medium text-foreground"
            >
              Alasan penghapusan <span className="text-destructive">*</span>
            </label>
            <Textarea
              id="complaint-delete-reason"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value)
                if (errorMessage) setErrorMessage(null)
              }}
              placeholder="Tuliskan alasan penghapusan pengaduan (3–500 karakter)..."
              maxLength={500}
              rows={3}
              disabled={deleteMutation.isPending}
              aria-invalid={Boolean(errorMessage)}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Minimal 3 karakter, maksimal 500 karakter.</span>
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
                  disabled={deleteMutation.isPending}
                >
                  Batal
                </Button>
              }
            />
            <Button
              type="submit"
              variant="destructive"
              disabled={deleteMutation.isPending}
              data-testid="confirm-delete-complaint-btn"
            >
              {deleteMutation.isPending ? "Menghapus..." : "Hapus Pengaduan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

