"use client"

import * as React from "react"
import { ArchiveIcon, AlertTriangleIcon } from "lucide-react"

import { softDeleteResidentAction } from "@/app/actions/residents"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

interface ResidentArchiveDialogProps {
  residentId: string
  residentName: string
}

export function ResidentArchiveDialog({
  residentId,
  residentName,
}: ResidentArchiveDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  const handleConfirm = () => {
    setError(null)
    startTransition(async () => {
      const formData = new FormData()
      formData.set("residentId", residentId)
      const result = await softDeleteResidentAction(formData)
      if (result?.error) {
        setError(result.error)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="destructive" size="sm">
            <ArchiveIcon data-icon="inline-start" />
            Arsipkan Warga
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive-text">
            <AlertTriangleIcon className="size-5" />
            Arsipkan Data Warga?
          </DialogTitle>
          <DialogDescription>
            Warga <strong>{residentName}</strong> akan ditandai nonaktif dan
            diarsipkan dari direktori aktif. Data historis tetap tersimpan sesuai
            kebijakan retensi RT.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md border border-destructive-border bg-destructive-subtle px-3 py-2 text-xs text-destructive-text">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Batal
          </Button>
          <Button
            type="button"
            variant="destructive"
            loading={isPending}
            onClick={handleConfirm}
          >
            {isPending ? "Mengarsipkan..." : "Ya, Arsipkan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

