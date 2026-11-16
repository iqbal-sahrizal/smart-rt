"use client"

import * as React from "react"
import { AlertCircleIcon, EyeOffIcon } from "lucide-react"
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
import { useModerateCommunityContentMutation } from "@/lib/community-feed/hooks"
import type { CommunityReportTargetType } from "@/lib/community-feed/types"

interface CommunityModerateHideDialogProps {
  tenantId: string
  actorKey: string
  targetType: CommunityReportTargetType
  targetId: string
  reportId?: string | null
  trigger?: React.ReactElement
}

export function CommunityModerateHideDialog({
  tenantId,
  actorKey,
  targetType,
  targetId,
  reportId,
  trigger,
}: CommunityModerateHideDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const moderateMutation = useModerateCommunityContentMutation(
    tenantId,
    actorKey
  )

  async function handleConfirm(event: React.FormEvent) {
    event.preventDefault()
    if (moderateMutation.isPending) return

    const trimmed = reason.trim()
    if (trimmed.length < 3) {
      setError("Alasan moderasi minimal 3 karakter.")
      return
    }

    try {
      await moderateMutation.mutateAsync({
        targetType,
        targetId,
        action: "hide",
        reason: trimmed,
        reportId: reportId ?? null,
      })
      setOpen(false)
      setReason("")
      setError(null)
      toast.success(
        targetType === "post"
          ? "Postingan berhasil disembunyikan"
          : "Komentar berhasil disembunyikan"
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memoderasi konten.")
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (moderateMutation.isPending) return
        setOpen(next)
        if (!next) {
          setReason("")
          setError(null)
        }
      }}
    >
      <DialogTrigger
        render={
          trigger ?? (
            <Button variant="destructive" size="sm">
              <EyeOffIcon className="size-4" />
              <span>Sembunyikan</span>
            </Button>
          )
        }
      />
      <DialogContent>
        <form onSubmit={handleConfirm} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              Sembunyikan {targetType === "post" ? "Postingan" : "Komentar"}?
            </DialogTitle>
            <DialogDescription>
              Konten ini akan disembunyikan dari feed warga. Tindakan ini
              tercatat dalam jejak audit moderasi.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              Alasan Moderasi <span className="text-destructive">*</span>
            </label>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Jelaskan alasan menyembunyikan konten ini..."
              maxLength={500}
              rows={3}
              disabled={moderateMutation.isPending}
              autoFocus
            />
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-xs text-destructive"
            >
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <DialogFooter>
            <DialogClose
              render={
                <Button
                  type="button"
                  variant="outline"
                  disabled={moderateMutation.isPending}
                >
                  Batal
                </Button>
              }
            />
            <Button
              type="submit"
              variant="destructive"
              disabled={moderateMutation.isPending}
            >
              {moderateMutation.isPending ? "Memproses..." : "Sembunyikan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
