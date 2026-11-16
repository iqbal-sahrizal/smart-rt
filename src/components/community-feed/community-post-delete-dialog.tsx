"use client"

import * as React from "react"
import { Trash2Icon } from "lucide-react"
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
import { useSoftDeleteCommunityPostMutation } from "@/lib/community-feed/hooks"

interface CommunityPostDeleteDialogProps {
  tenantId: string
  actorKey: string
  postId: string
  trigger?: React.ReactElement
}

export function CommunityPostDeleteDialog({
  tenantId,
  actorKey,
  postId,
  trigger,
}: CommunityPostDeleteDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const deleteMutation = useSoftDeleteCommunityPostMutation(tenantId, actorKey)

  async function handleConfirm() {
    if (deleteMutation.isPending) return
    setError(null)
    try {
      await deleteMutation.mutateAsync({ postId })
      setOpen(false)
      toast.success("Postingan berhasil dihapus")
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal menghapus postingan."
      )
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (deleteMutation.isPending) return
        setOpen(next)
        if (!next) setError(null)
      }}
    >
      <DialogTrigger
        render={
          trigger ?? (
            <Button variant="ghost" size="sm" className="text-destructive">
              <Trash2Icon className="size-4" />
              <span>Hapus</span>
            </Button>
          )
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hapus Postingan?</DialogTitle>
          <DialogDescription>
            Postingan ini akan dihapus dari feed komunitas dan tidak dapat
            dikembalikan.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
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
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? "Menghapus..." : "Hapus Postingan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
