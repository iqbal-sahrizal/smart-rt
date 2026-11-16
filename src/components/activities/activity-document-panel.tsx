"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  AlertCircleIcon,
  DownloadIcon,
  EyeIcon,
  FileIcon,
  FileTextIcon,
  ImageIcon,
  PaperclipIcon,
  RefreshCwIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { MAX_ACTIVITY_DOCS } from "@/lib/activities/constants"
import {
  useRemoveActivityDocMutation,
  useUploadActivityDocMutation,
} from "@/lib/activities/hooks"
import type {
  ActivityDocument,
  ActivityPermissions,
} from "@/lib/activities/types"

export function ActivityDocumentPanel({
  tenantId,
  activityId,
  documents,
  permissions,
}: {
  tenantId: string
  activityId: string
  documents: readonly ActivityDocument[]
  permissions: Pick<
    ActivityPermissions,
    "canUploadDocuments" | "canRemoveDocuments"
  >
}) {
  const router = useRouter()
  const uploadMutation = useUploadActivityDocMutation(tenantId)
  const removeMutation = useRemoveActivityDocMutation(tenantId)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  const [selectedFile, setSelectedFile] = React.useState<File | null>(null)
  const [uploadError, setUploadError] = React.useState<string | null>(null)

  const [previewDoc, setPreviewDoc] = React.useState<ActivityDocument | null>(
    null
  )
  const [previewAttempt, setPreviewAttempt] = React.useState(0)
  const [previewLoading, setPreviewLoading] = React.useState(false)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [previewObjectUrl, setPreviewObjectUrl] = React.useState<string | null>(
    null
  )

  const [docToDelete, setDocToDelete] = React.useState<ActivityDocument | null>(
    null
  )
  const [deleteError, setDeleteError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!previewDoc) return

    const activeDoc = previewDoc
    const controller = new AbortController()
    let objectUrl: string | null = null

    async function loadDoc() {
      setPreviewLoading(true)
      setPreviewError(null)
      try {
        const sep = activeDoc.viewUrl.includes("?") ? "&" : "?"
        const url =
          previewAttempt > 0
            ? `${activeDoc.viewUrl}${sep}retry=${previewAttempt}`
            : activeDoc.viewUrl
        const res = await fetch(url, {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { error?: string }
            | null
          throw new Error(
            body?.error ?? "Gagal memuat berkas dokumentasi kegiatan."
          )
        }
        const blob = await res.blob()
        objectUrl = URL.createObjectURL(blob)
        if (!controller.signal.aborted) {
          setPreviewObjectUrl(objectUrl)
          setPreviewLoading(false)
        }
      } catch (err) {
        if (controller.signal.aborted) return
        setPreviewError(
          err instanceof Error
            ? err.message
            : "Gagal mengambil berkas dokumentasi."
        )
        setPreviewLoading(false)
      }
    }

    loadDoc()

    return () => {
      controller.abort()
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [previewDoc, previewAttempt])

  function handleOpenPreview(doc: ActivityDocument) {
    setPreviewObjectUrl(null)
    setPreviewError(null)
    setPreviewLoading(true)
    setPreviewDoc(doc)
    setPreviewAttempt((n) => n + 1)
  }

  function handleClosePreview(nextOpen: boolean) {
    if (!nextOpen) {
      if (previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl)
      }
      setPreviewObjectUrl(null)
      setPreviewError(null)
      setPreviewLoading(false)
      setPreviewDoc(null)
    }
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedFile || uploadMutation.isPending) return

    setUploadError(null)
    const formData = new FormData()
    formData.set("activityId", activityId)
    formData.set("file", selectedFile)

    try {
      await uploadMutation.mutateAsync(formData)
      toast.success("Dokumentasi kegiatan berhasil diunggah.")
      setSelectedFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
      router.refresh()
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Gagal mengunggah dokumentasi."
      )
    }
  }

  async function handleConfirmDelete() {
    if (!docToDelete || removeMutation.isPending) return

    setDeleteError(null)
    try {
      await removeMutation.mutateAsync({
        activityId,
        fileId: docToDelete.fileId,
        reason: "user_requested",
      })
      toast.success("Dokumentasi kegiatan dihapus.")
      setDocToDelete(null)
      router.refresh()
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Gagal menghapus dokumentasi."
      )
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <PaperclipIcon className="size-4 text-primary" />
                <span>Dokumentasi Kegiatan</span>
                <Badge variant="outline" size="sm" className="tabular-nums">
                  {documents.length} / {MAX_ACTIVITY_DOCS}
                </Badge>
              </CardTitle>
              <CardDescription>
                Foto atau berkas PDF dokumentasi kegiatan disimpan secara
                privat melalui proxy terautentikasi.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {permissions.canUploadDocuments && (
            <form
              onSubmit={handleUpload}
              className="flex flex-col gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-3 sm:flex-row sm:items-end"
            >
              <div className="flex-1 space-y-1.5">
                <label
                  htmlFor="activity-doc-upload"
                  className="text-xs font-medium text-foreground"
                >
                  Unggah Dokumentasi (JPEG, PNG, WebP, atau PDF — maks. 10 MiB)
                </label>
                <Input
                  ref={fileInputRef}
                  id="activity-doc-upload"
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null
                    setSelectedFile(file)
                    setUploadError(null)
                  }}
                  disabled={uploadMutation.isPending}
                />
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={!selectedFile || uploadMutation.isPending}
              >
                <UploadIcon className="size-4" />
                <span>
                  {uploadMutation.isPending ? "Mengunggah..." : "Unggah Berkas"}
                </span>
              </Button>
            </form>
          )}

          {uploadError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive-border bg-destructive-subtle/40 px-3 py-2 text-xs text-destructive-text"
            >
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
              <span>{uploadError}</span>
            </div>
          )}

          {documents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
              <FileIcon className="mx-auto mb-2 size-7 text-muted-foreground/60" />
              <p className="text-sm font-medium text-foreground">
                Belum ada dokumentasi
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {permissions.canUploadDocuments
                  ? "Unggah foto atau laporan kegiatan setelah pelaksanaan."
                  : "Dokumentasi akan muncul di sini setelah diunggah oleh pengurus."}
              </p>
            </div>
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2">
              {documents.map((doc) => {
                const isPdf = doc.contentType === "application/pdf"
                return (
                  <div
                    key={doc.fileId}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary">
                        {isPdf ? (
                          <FileTextIcon className="size-4" />
                        ) : (
                          <ImageIcon className="size-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {doc.fileName}
                        </p>
                        <p className="text-[11px] uppercase text-muted-foreground">
                          {doc.extension}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Lihat ${doc.fileName}`}
                        onClick={() => handleOpenPreview(doc)}
                      >
                        <EyeIcon className="size-3.5" />
                        <span className="hidden sm:inline">Lihat</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Unduh ${doc.fileName}`}
                        nativeButton={false}
                        render={
                          <a href={doc.downloadUrl} download={doc.fileName} />
                        }
                      >
                        <DownloadIcon className="size-3.5" />
                      </Button>
                      {permissions.canRemoveDocuments && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Hapus ${doc.fileName}`}
                          className="text-destructive hover:bg-destructive-subtle/60 hover:text-destructive"
                          onClick={() => {
                            setDeleteError(null)
                            setDocToDelete(doc)
                          }}
                        >
                          <Trash2Icon className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview Dialog */}
      <Dialog open={previewDoc !== null} onOpenChange={handleClosePreview}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{previewDoc?.fileName ?? "Pratinjau Berkas"}</DialogTitle>
            <DialogDescription>
              Diakses melalui proxy dokumen privat RT dengan sesi terautentikasi.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-64 rounded-xl border border-border bg-muted/30 p-3">
            {previewLoading ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-56 w-full rounded-lg" />
              </div>
            ) : previewError ? (
              <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-center">
                <AlertCircleIcon className="size-7 text-destructive" />
                <p className="text-sm text-destructive-text">{previewError}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setPreviewAttempt((n) => n + 1)}
                >
                  <RefreshCwIcon className="size-3.5" />
                  <span>Coba Lagi</span>
                </Button>
              </div>
            ) : previewObjectUrl && previewDoc ? (
              previewDoc.contentType === "application/pdf" ? (
                <iframe
                  title={previewDoc.fileName}
                  src={previewObjectUrl}
                  className="h-[60vh] w-full rounded-lg border border-border bg-white"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewObjectUrl}
                  alt={previewDoc.fileName}
                  className="mx-auto max-h-[60vh] rounded-lg object-contain"
                />
              )
            ) : null}
          </div>

          <DialogFooter>
            {previewDoc && (
              <Button
                type="button"
                variant="outline"
                nativeButton={false}
                render={
                  <a
                    href={previewDoc.downloadUrl}
                    download={previewDoc.fileName}
                  />
                }
              >
                <DownloadIcon className="size-4" />
                <span>Unduh</span>
              </Button>
            )}
            <DialogClose render={<Button type="button" />}>Tutup</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={docToDelete !== null}
        onOpenChange={(nextOpen) => {
          if (removeMutation.isPending) return
          if (!nextOpen) {
            setDocToDelete(null)
            setDeleteError(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus Dokumentasi Kegiatan</DialogTitle>
            <DialogDescription>
              Berkas{" "}
              <span className="font-medium text-foreground">
                {docToDelete?.fileName}
              </span>{" "}
              akan dilepas dari kegiatan dan dijadwalkan untuk dihapus dari
              penyimpanan privat.
            </DialogDescription>
          </DialogHeader>

          {deleteError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive-border bg-destructive-subtle/40 px-3 py-2 text-xs text-destructive-text"
            >
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
              <span>{deleteError}</span>
            </div>
          )}

          <DialogFooter>
            <DialogClose
              render={
                <Button
                  type="button"
                  variant="outline"
                  disabled={removeMutation.isPending}
                />
              }
            >
              Batal
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={removeMutation.isPending}
              onClick={handleConfirmDelete}
            >
              {removeMutation.isPending ? "Menghapus..." : "Hapus Berkas"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

