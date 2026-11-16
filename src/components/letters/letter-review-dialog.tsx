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
import { getLetterReviewActionMeta } from "@/lib/letters/formatters"
import { useReviewLetterRequestMutation } from "@/lib/letters/hooks"
import { reviewLetterRequestSchema } from "@/lib/letters/schemas"
import type { LetterReviewDecision } from "@/lib/letters/types"

interface LetterReviewDialogProps {
  tenantId: string
  requestId: string
  decision: LetterReviewDecision | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function LetterReviewDialog({
  tenantId,
  requestId,
  decision,
  open,
  onOpenChange,
  onSuccess,
}: LetterReviewDialogProps) {
  const router = useRouter()
  const [adminNotes, setAdminNotes] = React.useState("")
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const reviewMutation = useReviewLetterRequestMutation(tenantId)

  if (!decision) {
    return null
  }

  const meta = getLetterReviewActionMeta(decision)

  function handleOpenChange(nextOpen: boolean) {
    if (reviewMutation.isPending) return
    if (!nextOpen) {
      setAdminNotes("")
      setErrorMessage(null)
    }
    onOpenChange(nextOpen)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!decision || reviewMutation.isPending) return

    const trimmedNotes = adminNotes.trim()
    const parsed = reviewLetterRequestSchema.safeParse({
      requestId,
      decision,
      adminNotes: trimmedNotes.length > 0 ? trimmedNotes : null,
    })

    if (!parsed.success) {
      setErrorMessage(
        parsed.error.issues[0]?.message ??
          "Periksa kembali keputusan peninjauan dan catatan."
      )
      return
    }

    setErrorMessage(null)

    try {
      await reviewMutation.mutateAsync({
        requestId,
        decision: parsed.data.decision,
        adminNotes: parsed.data.adminNotes,
      })
      toast.success(
        decision === "rejected"
          ? "Permohonan surat ditolak"
          : decision === "approved"
            ? "Permohonan surat disetujui"
            : "Permohonan surat ditandai sedang ditinjau"
      )
      setAdminNotes("")
      setErrorMessage(null)
      onOpenChange(false)
      router.refresh()
      onSuccess?.()
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Gagal memperbarui status permohonan surat."
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{meta.dialogTitle}</DialogTitle>
            <DialogDescription>{meta.dialogDescription}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label
              htmlFor="letter-review-notes"
              className="block text-sm font-medium text-foreground"
            >
              {meta.requiresNotes
                ? "Alasan Penolakan (Wajib)"
                : "Catatan Pengurus (Opsional)"}
            </label>
            <Textarea
              id="letter-review-notes"
              value={adminNotes}
              onChange={(e) => {
                setAdminNotes(e.target.value)
                if (errorMessage) setErrorMessage(null)
              }}
              placeholder={
                meta.requiresNotes
                  ? "Jelaskan alasan penolakan (mis. dokumen KTP buram atau tidak sesuai)..."
                  : "Tambahkan catatan singkat jika diperlukan..."
              }
              rows={3}
              maxLength={500}
              disabled={reviewMutation.isPending}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {meta.requiresNotes
                  ? "Catatan ini wajib diisi dan dapat dibaca oleh pemohon."
                  : "Catatan bersifat opsional."}
              </span>
              <span className="tabular-nums">{adminNotes.length}/500</span>
            </div>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive-subtle px-3 py-2 text-xs text-destructive"
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
                  disabled={reviewMutation.isPending}
                />
              }
            >
              Batal
            </DialogClose>
            <Button
              type="submit"
              variant={meta.buttonVariant}
              disabled={reviewMutation.isPending}
            >
              {reviewMutation.isPending ? "Memproses..." : meta.confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

