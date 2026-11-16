"use client"

import * as React from "react"
import { Trash2Icon } from "lucide-react"

import { deleteDuesAction } from "@/app/actions/finance"
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

interface DuesDeleteDialogProps {
  dueId: string
  dueName: string
  billCount?: number
  triggerSize?: "sm" | "default"
}

export function DuesDeleteDialog({
  dueId,
  dueName,
  billCount = 0,
  triggerSize = "default",
}: DuesDeleteDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  const handleConfirmDelete = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isPending) return

    setError(null)
    const formData = new FormData()
    formData.set("dueId", dueId)

    startTransition(async () => {
      const result = await deleteDuesAction(formData)
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
            data-testid={`delete-due-${dueId}`}
          />
        }
      >
        <Trash2Icon className="size-4" />
        <span>Hapus</span>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hapus Konfigurasi Iuran</DialogTitle>
          <DialogDescription>
            {billCount > 0
              ? `Konfigurasi iuran "${dueName}" sudah memiliki ${billCount} tagihan terkait sehingga tidak dapat dihapus permanen. Ubah status menjadi Nonaktif jika iuran tidak lagi berlaku.`
              : `Konfigurasi iuran "${dueName}" akan dihapus secara permanen. Tindakan ini tidak dapat dibatalkan.`}
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
              Tutup
            </DialogClose>
            <Button
              type="submit"
              variant="destructive"
              disabled={isPending || billCount > 0}
              data-testid="confirm-delete-due"
            >
              {isPending ? "Menghapus..." : "Ya, Hapus"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

