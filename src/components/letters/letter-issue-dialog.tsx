"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { AlertCircleIcon, FileUpIcon, Trash2Icon } from "lucide-react"
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
import { formatLetterFileSize } from "@/lib/letters/formatters"
import { useIssueLetterMutation } from "@/lib/letters/hooks"
import { validateIssuedLetterPdfFile } from "@/lib/letters/storage"

interface LetterIssueDialogProps {
  tenantId: string
  requestId: string
  residentName: string
  letterTypeName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function LetterIssueDialog({
  tenantId,
  requestId,
  residentName,
  letterTypeName,
  open,
  onOpenChange,
  onSuccess,
}: LetterIssueDialogProps) {
  const router = useRouter()
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const issueMutation = useIssueLetterMutation(tenantId)

  function clearFile() {
    setSelectedFile(null)
    setErrorMessage(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (issueMutation.isPending) return
    if (!nextOpen) {
      clearFile()
    }
    onOpenChange(nextOpen)
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    if (!file) {
      clearFile()
      return
    }

    const validation = await validateIssuedLetterPdfFile(file)
    if (!validation.ok) {
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ""
      setErrorMessage(validation.error)
      return
    }

    setSelectedFile(file)
    setErrorMessage(null)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (issueMutation.isPending) return

    if (!selectedFile) {
      setErrorMessage(
        "Silakan pilih berkas PDF surat resmi yang telah ditandatangani."
      )
      return
    }

    const validation = await validateIssuedLetterPdfFile(selectedFile)
    if (!validation.ok) {
      setErrorMessage(validation.error)
      return
    }

    setErrorMessage(null)

    const formData = new FormData()
    formData.append("requestId", requestId)
    formData.append("file", selectedFile)

    try {
      const result = await issueMutation.mutateAsync(formData)
      toast.success(
        `Surat berhasil diterbitkan dengan nomor ${result.letterNumber}`
      )
      clearFile()
      onOpenChange(false)
      router.refresh()
      onSuccess?.()
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Gagal menerbitkan surat. Silakan coba lagi."
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Terbitkan Surat Resmi</DialogTitle>
            <DialogDescription>
              Unggah file PDF{" "}
              <strong className="font-semibold text-foreground">
                {letterTypeName}
              </strong>{" "}
              untuk{" "}
              <strong className="font-semibold text-foreground">
                {residentName}
              </strong>{" "}
              yang sudah ditandatangani. Sistem akan menghasilkan nomor surat
              otomatis dan menandai permohonan sebagai Selesai.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label
              htmlFor="issued-letter-pdf-input"
              className="block text-sm font-medium text-foreground"
            >
              File PDF Surat Resmi (Maks. 10 MiB)
            </label>

            <input
              ref={fileInputRef}
              id="issued-letter-pdf-input"
              type="file"
              accept="application/pdf,.pdf"
              disabled={issueMutation.isPending}
              onChange={handleFileChange}
              className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary-subtle file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary hover:file:bg-primary-subtle/80"
            />

            {selectedFile && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-subtle/60 px-3 py-2 text-xs">
                <div className="flex min-w-0 items-center gap-2">
                  <FileUpIcon className="size-4 shrink-0 text-primary" />
                  <span className="truncate font-medium text-foreground">
                    {selectedFile.name}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    ({formatLetterFileSize(selectedFile.size)})
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={issueMutation.isPending}
                  onClick={clearFile}
                >
                  <Trash2Icon className="size-3.5 text-destructive" />
                  <span className="sr-only">Hapus file terpilih</span>
                </Button>
              </div>
            )}
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
                  disabled={issueMutation.isPending}
                />
              }
            >
              Batal
            </DialogClose>
            <Button type="submit" disabled={issueMutation.isPending || !selectedFile}>
              {issueMutation.isPending
                ? "Mengunggah & Menerbitkan..."
                : "Terbitkan Surat"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

