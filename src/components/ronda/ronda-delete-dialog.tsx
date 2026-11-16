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
import { formatRondaDateLong } from "@/lib/ronda/formatters"
import { useDeleteRondaScheduleMutation } from "@/lib/ronda/use-ronda"

interface RondaDeleteDialogProps {
  tenantId: string
  scheduleId: string
  scheduleDate: string
  shiftLabel: string
  variant?: "default" | "outline" | "destructive" | "ghost"
  size?: "default" | "sm" | "icon"
}

export function RondaDeleteDialog({
  tenantId,
  scheduleId,
  scheduleDate,
  shiftLabel,
  variant = "destructive",
  size = "default",
}: RondaDeleteDialogProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const deleteMutation = useDeleteRondaScheduleMutation({ tenantId })

  async function handleConfirmDelete() {
    if (deleteMutation.isPending) return
    setErrorMessage(null)

    try {
      await deleteMutation.mutateAsync(scheduleId)
      setOpen(false)
      toast.success("Jadwal ronda berhasil dihapus")
      router.push("/ronda?deleted=1")
      router.refresh()
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Gagal menghapus jadwal ronda. Silakan coba lagi."
      )
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (deleteMutation.isPending) return
        setOpen(nextOpen)
        if (!nextOpen) setErrorMessage(null)
      }}
    >
      <DialogTrigger
        render={
          <Button
            type="button"
            variant={variant}
            size={size}
            aria-label="Hapus jadwal ronda"
          >
            <Trash2Icon className="size-4" />
            <span>Hapus Jadwal</span>
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hapus Jadwal Ronda?</DialogTitle>
          <DialogDescription>
            Anda akan menghapus jadwal{" "}
            <strong className="font-semibold text-foreground">
              {shiftLabel}
            </strong>{" "}
            pada{" "}
            <strong className="font-semibold text-foreground">
              {formatRondaDateLong(scheduleDate)}
            </strong>{" "}
            beserta seluruh daftar petugas dan catatan kehadiran pada sesi ini.
            Tindakan ini tidak dapat dibatalkan.
          </DialogDescription>
        </DialogHeader>

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
            type="button"
            variant="destructive"
            disabled={deleteMutation.isPending}
            onClick={handleConfirmDelete}
          >
            {deleteMutation.isPending ? "Menghapus..." : "Ya, Hapus Jadwal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
