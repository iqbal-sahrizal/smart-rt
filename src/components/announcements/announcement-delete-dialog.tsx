"use client"

import * as React from "react"
import { Trash2Icon } from "lucide-react"

import { deleteAnnouncementAction } from "@/app/actions/announcements"
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

interface AnnouncementDeleteDialogProps {
  announcementId: string
  announcementTitle: string
  hasAttachment?: boolean
  triggerSize?: "sm" | "default"
  triggerLabel?: string
}

export function AnnouncementDeleteDialog({
  announcementId,
  announcementTitle,
  hasAttachment = false,
  triggerSize = "default",
  triggerLabel = "Hapus",
}: AnnouncementDeleteDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  const handleConfirmDelete = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isPending) return

    setError(null)
    const formData = new FormData()
    formData.set("announcementId", announcementId)

    startTransition(async () => {
      const result = await deleteAnnouncementAction(formData)
      if (result?.error) {
        setError(result.error)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="destructive"
            size={triggerSize}
            data-testid={`delete-announcement-${announcementId}`}
          />
        }
      >
        <Trash2Icon className="size-4" />
        <span>{triggerLabel}</span>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {hasAttachment ? "Arsipkan Pengumuman" : "Hapus Pengumuman"}
          </DialogTitle>
          <DialogDescription>
            {hasAttachment
              ? `Pengumuman "${announcementTitle}" memiliki lampiran sehingga akan diarsipkan (soft delete) dan tidak lagi tampil di feed warga.`
              : `Pengumuman "${announcementTitle}" akan dihapus secara permanen dari daftar pengumuman RT. Tindakan ini tidak dapat dibatalkan.`}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <form onSubmit={handleConfirmDelete}>
          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline" disabled={isPending} />
              }
            >
              Batal
            </DialogClose>
            <Button
              type="submit"
              variant="destructive"
              disabled={isPending}
              data-testid="confirm-delete-announcement"
            >
              {isPending
                ? "Memproses..."
                : hasAttachment
                  ? "Ya, Arsipkan"
                  : "Ya, Hapus"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

