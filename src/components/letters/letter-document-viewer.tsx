"use client"

import * as React from "react"
import {
  AlertCircleIcon,
  DownloadIcon,
  ExternalLinkIcon,
  EyeIcon,
  FileCheck2Icon,
  FileIcon,
  FileTextIcon,
  LockIcon,
  PaperclipIcon,
  RefreshCwIcon,
  Trash2Icon,
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
import { Skeleton } from "@/components/ui/skeleton"
import {
  formatLetterDateTime,
  getLetterDocumentsPresentation,
} from "@/lib/letters/formatters"
import { useRemoveLetterSupportingDocMutation } from "@/lib/letters/hooks"
import type {
  LetterRequest,
  LetterRequestAttachment,
  LetterRequestPermissions,
} from "@/lib/letters/types"

interface LetterDocumentViewerProps {
  tenantId: string
  request: Pick<
    LetterRequest,
    | "id"
    | "letterNumber"
    | "issuedAt"
    | "attachments"
    | "hasIssuedPdf"
    | "issuedPdfUrl"
    | "issuedDownloadUrl"
  >
  permissions: Pick<
    LetterRequestPermissions,
    "isMetadataOnly" | "canAccessDocuments" | "canRemoveDocs"
  >
  supportingHeaderAction?: React.ReactNode
}

type PreviewTarget =
  | {
      kind: "image" | "pdf"
      title: string
      fetchUrl: string
      downloadUrl: string
      fileName: string
    }
  | null

export function LetterDocumentViewer({
  tenantId,
  request,
  permissions,
  supportingHeaderAction,
}: LetterDocumentViewerProps) {
  const presentation = getLetterDocumentsPresentation({ request, permissions })
  const removeMutation = useRemoveLetterSupportingDocMutation(tenantId)

  const [previewTarget, setPreviewTarget] = React.useState<PreviewTarget>(null)
  const [previewAttempt, setPreviewAttempt] = React.useState(0)
  const [previewLoading, setPreviewLoading] = React.useState(false)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [previewObjectUrl, setPreviewObjectUrl] = React.useState<string | null>(
    null
  )

  const [attachmentToDelete, setAttachmentToDelete] =
    React.useState<LetterRequestAttachment | null>(null)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (
      !previewTarget ||
      presentation.kind === "restricted" ||
      permissions.isMetadataOnly ||
      !permissions.canAccessDocuments
    ) {
      return
    }

    const activeTarget = previewTarget
    const controller = new AbortController()
    let activeObjectUrl: string | null = null

    async function loadPrivateDocument() {
      try {
        const separator = activeTarget.fetchUrl.includes("?") ? "&" : "?"
        const requestUrl =
          previewAttempt > 0
            ? `${activeTarget.fetchUrl}${separator}retry=${previewAttempt}`
            : activeTarget.fetchUrl

        const res = await fetch(requestUrl, {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        })

        if (!res.ok) {
          throw new Error("Dokumen tidak dapat dimuat atau akses ditolak.")
        }

        const blob = await res.blob()
        if (controller.signal.aborted) return

        activeObjectUrl = URL.createObjectURL(blob)
        setPreviewObjectUrl(activeObjectUrl)
      } catch (err) {
        if (controller.signal.aborted) return
        setPreviewError(
          err instanceof Error
            ? err.message
            : "Gagal memuat dokumen. Silakan coba muat ulang."
        )
      } finally {
        if (!controller.signal.aborted) {
          setPreviewLoading(false)
        }
      }
    }

    void loadPrivateDocument()

    return () => {
      controller.abort()
      if (activeObjectUrl) {
        URL.revokeObjectURL(activeObjectUrl)
      }
    }
  }, [
    previewTarget,
    previewAttempt,
    presentation.kind,
    permissions.isMetadataOnly,
    permissions.canAccessDocuments,
  ])

  function closePreview() {
    setPreviewTarget(null)
    setPreviewLoading(false)
    setPreviewError(null)
    setPreviewObjectUrl(null)
  }

  function retryPreview() {
    setPreviewLoading(true)
    setPreviewError(null)
    setPreviewObjectUrl(null)
    setPreviewAttempt((prev) => prev + 1)
  }

  function openAttachmentPreview(att: LetterRequestAttachment) {
    if (permissions.isMetadataOnly || !permissions.canAccessDocuments) return
    setPreviewLoading(true)
    setPreviewError(null)
    setPreviewObjectUrl(null)
    setPreviewAttempt(0)
    setPreviewTarget({
      kind: att.contentType === "application/pdf" ? "pdf" : "image",
      title: att.fileName,
      fetchUrl: att.downloadUrl,
      downloadUrl: att.downloadUrl,
      fileName: att.fileName,
    })
  }

  function openIssuedPdfPreview() {
    if (
      permissions.isMetadataOnly ||
      !permissions.canAccessDocuments ||
      !request.issuedPdfUrl
    ) {
      return
    }
    setPreviewLoading(true)
    setPreviewError(null)
    setPreviewObjectUrl(null)
    setPreviewAttempt(0)
    setPreviewTarget({
      kind: "pdf",
      title: request.letterNumber
        ? `Surat Terbit (${request.letterNumber})`
        : "PDF Surat Resmi Terbit",
      fetchUrl: request.issuedPdfUrl,
      downloadUrl:
        request.issuedDownloadUrl ?? `${request.issuedPdfUrl}?download=1`,
      fileName: request.letterNumber
        ? `${request.letterNumber.replace(/[^A-Za-z0-9_-]+/g, "-")}.pdf`
        : "surat-terbit.pdf",
    })
  }

  async function handleConfirmDeleteAttachment() {
    if (!attachmentToDelete || removeMutation.isPending) return
    setDeleteError(null)
    try {
      await removeMutation.mutateAsync({
        requestId: request.id,
        fileId: attachmentToDelete.fileId,
      })
      toast.success("Lampiran dokumen berhasil dihapus")
      setAttachmentToDelete(null)
    } catch (err) {
      setDeleteError(
        err instanceof Error
          ? err.message
          : "Gagal menghapus lampiran dokumen."
      )
    }
  }

  if (presentation.kind === "restricted") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <LockIcon className="size-4 text-muted-foreground" />
            <span>Dokumen Permohonan &amp; Surat Terbit</span>
          </CardTitle>
          <CardDescription>
            Akses berkas lampiran dan dokumen terbit melalui proxy privat.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            data-testid="letter-documents-restricted"
            className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground"
          >
            <LockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              <p className="font-medium text-foreground">
                Akses Dokumen Dibatasi
              </p>
              <p className="text-xs leading-relaxed">{presentation.message}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-[var(--space-5)]">
      {/* Issued Official Letter PDF */}
      {presentation.hasIssuedPdf && presentation.issuedPdfUrl && (
        <Card className="border-success/35 bg-success-subtle/15">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-base text-foreground">
                <FileCheck2Icon className="size-4 text-success" />
                <span>Dokumen PDF Surat Terbit</span>
              </CardTitle>
              <CardDescription>
                Nomor Surat:{" "}
                <span className="font-medium text-foreground">
                  {request.letterNumber ?? "-"}
                </span>
                {request.issuedAt
                  ? ` • Terbit ${formatLetterDateTime(request.issuedAt)}`
                  : ""}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={openIssuedPdfPreview}
              >
                <EyeIcon className="size-3.5" />
                <span>Pratinjau PDF</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={
                  <a
                    href={presentation.issuedPdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
              >
                <ExternalLinkIcon className="size-3.5" />
                <span>Buka Tab Baru</span>
              </Button>
              <Button
                size="sm"
                nativeButton={false}
                render={
                  <a
                    href={
                      presentation.issuedDownloadUrl ??
                      `${presentation.issuedPdfUrl}?download=1`
                    }
                  />
                }
              >
                <DownloadIcon className="size-3.5" />
                <span>Unduh PDF</span>
              </Button>
            </div>
          </CardHeader>
        </Card>
      )}

      {/* Supporting Documents */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <PaperclipIcon className="size-4 text-muted-foreground" />
              <span>
                Dokumen Pendukung ({presentation.attachments.length}/5)
              </span>
            </CardTitle>
            <CardDescription>
              Berkas persyaratan dari pemohon diakses secara aman melalui proxy
              privat terautentikasi.
            </CardDescription>
          </div>
          {supportingHeaderAction}
        </CardHeader>
        <CardContent>
          {presentation.attachments.length === 0 ? (
            <div
              data-testid="letter-attachments-empty"
              className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground"
            >
              <FileIcon className="size-6 text-muted-foreground/70" />
              <span>Belum ada dokumen pendukung yang dilampirkan.</span>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {presentation.attachments.map((att) => (
                <li
                  key={att.fileId}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
                      <FileTextIcon className="size-4" />
                    </span>
                    <div className="min-w-0 space-y-0.5">
                      <p className="truncate text-sm font-medium text-foreground">
                        {att.fileName}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" size="sm">
                          {att.extension.toUpperCase()}
                        </Badge>
                        <span>Dokumen persyaratan</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openAttachmentPreview(att)}
                    >
                      <EyeIcon className="size-3.5" />
                      <span>Lihat</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={<a href={att.downloadUrl} download={att.fileName} />}
                    >
                      <DownloadIcon className="size-3.5" />
                      <span>Unduh</span>
                    </Button>
                    {permissions.canRemoveDocs && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive-subtle hover:text-destructive"
                        onClick={() => {
                          setDeleteError(null)
                          setAttachmentToDelete(att)
                        }}
                      >
                        <Trash2Icon className="size-3.5" />
                        <span>Hapus</span>
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Authenticated Preview Modal (Revokes ObjectURL cleanly) */}
      <Dialog
        open={previewTarget !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            closePreview()
          }
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">
              {previewTarget?.title ?? "Pratinjau Dokumen"}
            </DialogTitle>
            <DialogDescription>
              Dokumen dimuat melalui endpoint proxy privat terautentikasi.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-[260px]">
            {previewLoading && (
              <div className="space-y-3">
                <Skeleton className="h-[360px] w-full rounded-lg" />
              </div>
            )}

            {!previewLoading && previewError && (
              <div
                role="alert"
                className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive-subtle/40 px-4 py-10 text-center text-sm text-destructive"
              >
                <AlertCircleIcon className="size-6 shrink-0" />
                <p>{previewError}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={retryPreview}
                >
                  <RefreshCwIcon className="size-3.5" />
                  <span>Coba Muat Ulang</span>
                </Button>
              </div>
            )}

            {!previewLoading &&
              !previewError &&
              previewObjectUrl &&
              previewTarget?.kind === "image" && (
                <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
                  {/* eslint-disable-next-line @next/next/no-img-element -- Revocable blob URL from authenticated private proxy */}
                  <img
                    src={previewObjectUrl}
                    alt={previewTarget.title}
                    className="max-h-[65vh] w-full object-contain"
                  />
                </div>
              )}

            {!previewLoading &&
              !previewError &&
              previewObjectUrl &&
              previewTarget?.kind === "pdf" && (
                <div className="overflow-hidden rounded-lg border border-border bg-muted/20">
                  <iframe
                    src={previewObjectUrl}
                    title={previewTarget.title}
                    className="h-[65vh] w-full"
                  />
                </div>
              )}
          </div>

          <DialogFooter className="gap-2">
            {previewTarget && (
              <Button
                variant="outline"
                nativeButton={false}
                render={
                  <a
                    href={previewTarget.downloadUrl}
                    download={previewTarget.fileName}
                  />
                }
              >
                <DownloadIcon className="size-4" />
                <span>Unduh Berkas</span>
              </Button>
            )}
            <DialogClose render={<Button variant="secondary" />}>
              Tutup
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Supporting Attachment Confirmation Dialog */}
      <Dialog
        open={attachmentToDelete !== null}
        onOpenChange={(nextOpen) => {
          if (removeMutation.isPending) return
          if (!nextOpen) {
            setAttachmentToDelete(null)
            setDeleteError(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus Dokumen Pendukung?</DialogTitle>
            <DialogDescription>
              Lampiran{" "}
              <strong className="font-semibold text-foreground">
                {attachmentToDelete?.fileName}
              </strong>{" "}
              akan dilepas dari permohonan surat dan dijadwalkan untuk dihapus
              dari penyimpanan privat.
            </DialogDescription>
          </DialogHeader>

          {deleteError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive-subtle px-3 py-2 text-xs text-destructive"
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
              onClick={handleConfirmDeleteAttachment}
            >
              {removeMutation.isPending ? "Menghapus..." : "Ya, Hapus Lampiran"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
