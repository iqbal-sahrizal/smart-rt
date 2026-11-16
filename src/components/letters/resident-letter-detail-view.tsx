"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  BanIcon,
  CalendarClockIcon,
  CheckSquareIcon,
  FileCheck2Icon,
  FilePlus2Icon,
  MessageSquareIcon,
} from "lucide-react"
import { toast } from "sonner"

import { LetterDocumentViewer } from "@/components/letters/letter-document-viewer"
import { ResidentContainer } from "@/components/resident/resident-container"
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
import { Textarea } from "@/components/ui/textarea"
import { MAX_LETTER_SUPPORTING_DOCS } from "@/lib/letters/constants"
import {
  formatLetterDateTime,
  getLetterRequestCode,
  getLetterRequestStatusBadgeVariant,
  getLetterRequestStatusLabel,
  getLetterStatusExplanation,
} from "@/lib/letters/formatters"
import {
  useCancelLetterRequestMutation,
  useResidentLetterRequestDetail,
  useUploadLetterSupportingDocMutation,
} from "@/lib/letters/hooks"
import { cancelLetterRequestSchema } from "@/lib/letters/schemas"
import { validateLetterAttachmentFile } from "@/lib/letters/storage"
import type { LetterRequestDetail } from "@/lib/letters/types"

interface ResidentLetterDetailViewProps {
  tenantId: string
  actorKey: string
  requestId: string
  initialDetail: LetterRequestDetail
}

export function ResidentLetterDetailView({
  tenantId,
  actorKey,
  requestId,
  initialDetail,
}: ResidentLetterDetailViewProps) {
  const router = useRouter()
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  const detailQuery = useResidentLetterRequestDetail({
    tenantId,
    actorKey,
    requestId,
    initialData: initialDetail,
  })

  const uploadMutation = useUploadLetterSupportingDocMutation(tenantId)
  const cancelMutation = useCancelLetterRequestMutation(tenantId)

  const detail = detailQuery.data ?? initialDetail
  const { request, letterType, permissions } = detail

  const [uploadError, setUploadError] = React.useState<string | null>(null)
  const [cancelOpen, setCancelOpen] = React.useState(false)
  const [cancelReason, setCancelReason] = React.useState("")
  const [cancelError, setCancelError] = React.useState<string | null>(null)

  const requiredDocs = letterType?.requiredDocuments ?? []

  async function handleUploadNewAttachment(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0] ?? null
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
    if (!file || !permissions.canAttachDocs || uploadMutation.isPending) return

    const validation = await validateLetterAttachmentFile(file)
    if (!validation.ok) {
      setUploadError(validation.error)
      return
    }

    setUploadError(null)
    const formData = new FormData()
    formData.append("requestId", request.id)
    formData.append("file", file)

    try {
      await uploadMutation.mutateAsync(formData)
      toast.success("Dokumen pendukung berhasil diunggah")
      router.refresh()
    } catch (err) {
      setUploadError(
        err instanceof Error
          ? err.message
          : "Gagal mengunggah dokumen pendukung. Silakan coba lagi."
      )
    }
  }

  async function handleConfirmCancel(event: React.FormEvent) {
    event.preventDefault()
    if (!permissions.canCancel || cancelMutation.isPending) return

    const trimmed = cancelReason.trim()
    const parsed = cancelLetterRequestSchema.safeParse({
      requestId: request.id,
      reason: trimmed.length > 0 ? trimmed : null,
    })

    if (!parsed.success) {
      setCancelError(
        parsed.error.issues[0]?.message ?? "Alasan pembatalan tidak valid."
      )
      return
    }

    setCancelError(null)

    try {
      await cancelMutation.mutateAsync(parsed.data)
      toast.success("Permohonan surat berhasil dibatalkan")
      setCancelReason("")
      setCancelOpen(false)
      router.refresh()
    } catch (err) {
      setCancelError(
        err instanceof Error
          ? err.message
          : "Gagal membatalkan permohonan surat."
      )
    }
  }

  return (
    <ResidentContainer className="flex flex-col gap-[var(--space-5)]">
      {/* Header */}
      <div className="space-y-3">
        <div>
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/resident/letters" />}
          >
            <ArrowLeftIcon className="size-4" />
            <span>Kembali ke Daftar Surat</span>
          </Button>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={getLetterRequestStatusBadgeVariant(request.status)}
                size="sm"
              >
                {getLetterRequestStatusLabel(request.status)}
              </Badge>
              <Badge variant="outline" size="sm">
                {request.letterTypeCode}
              </Badge>
              <span className="text-xs font-medium text-muted-foreground">
                {request.letterNumber ?? getLetterRequestCode(request.id)}
              </span>
            </div>
            <h1 className="font-heading text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              {request.letterTypeName}
            </h1>
            <p className="text-sm text-muted-foreground">
              {getLetterStatusExplanation(request.status)}
            </p>
          </div>

          {permissions.canCancel && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive-subtle hover:text-destructive"
              onClick={() => {
                setCancelError(null)
                setCancelOpen(true)
              }}
            >
              <BanIcon className="size-4" />
              <span>Batalkan Permohonan</span>
            </Button>
          )}
        </div>
      </div>

      {/* Rejection / Review Admin Notes */}
      {request.adminNotes && (
        <div
          role="status"
          className={
            request.status === "rejected"
              ? "rounded-xl border border-destructive/40 bg-destructive-subtle/30 p-4 text-sm"
              : "rounded-xl border border-border bg-muted/40 p-4 text-sm"
          }
        >
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {request.status === "rejected"
              ? "Alasan Penolakan"
              : "Catatan Pengurus"}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-foreground">
            {request.adminNotes}
          </p>
        </div>
      )}

      {/* Request Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquareIcon className="size-4 text-muted-foreground" />
            <span>Rincian Pengajuan</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Keperluan
            </p>
            <p className="mt-1 rounded-lg border border-border bg-surface-subtle/40 p-3 whitespace-pre-wrap text-foreground">
              {request.purpose}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-start gap-2">
              <CalendarClockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">
                  Tanggal Pengajuan
                </p>
                <p className="font-medium text-foreground">
                  {formatLetterDateTime(request.createdAt)}
                </p>
              </div>
            </div>

            {request.reviewedAt && (
              <div className="flex items-start gap-2">
                <CalendarClockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">
                    Terakhir Ditinjau
                    {request.reviewedByLabel
                      ? ` (${request.reviewedByLabel})`
                      : ""}
                  </p>
                  <p className="font-medium text-foreground">
                    {formatLetterDateTime(request.reviewedAt)}
                  </p>
                </div>
              </div>
            )}

            {request.issuedAt && request.letterNumber && (
              <div className="flex items-start gap-2 sm:col-span-2">
                <FileCheck2Icon className="mt-0.5 size-4 shrink-0 text-success" />
                <div>
                  <p className="text-xs text-muted-foreground">
                    Nomor Surat Resmi &amp; Tanggal Terbit
                  </p>
                  <p className="font-semibold text-foreground">
                    {request.letterNumber} •{" "}
                    {formatLetterDateTime(request.issuedAt)}
                  </p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Required Documents Checklist */}
      {requiredDocs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckSquareIcon className="size-4 text-muted-foreground" />
              <span>Syarat Dokumen ({request.letterTypeName})</span>
            </CardTitle>
            <CardDescription className="text-xs">
              Pastikan dokumen persyaratan berikut telah diunggah bila masih
              berstatus Diajukan.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
              {requiredDocs.map((docLabel, idx) => (
                <li key={`${docLabel}-${idx}`}>{docLabel}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Upload Error Alert (above viewer so user never thinks failed upload attached) */}
      {uploadError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive-subtle/40 px-4 py-3 text-sm text-destructive"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
          <span>{uploadError}</span>
        </div>
      )}

      {/* Documents & Issued PDF */}
      <LetterDocumentViewer
        tenantId={tenantId}
        request={request}
        permissions={permissions}
        supportingHeaderAction={
          permissions.canAttachDocs &&
          request.attachmentCount < MAX_LETTER_SUPPORTING_DOCS ? (
            <div>
              <input
                ref={fileInputRef}
                id="resident-detail-upload-doc"
                type="file"
                accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf"
                disabled={uploadMutation.isPending}
                onChange={handleUploadNewAttachment}
                className="sr-only"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploadMutation.isPending}
                onClick={() => fileInputRef.current?.click()}
              >
                <FilePlus2Icon className="size-4" />
                <span>
                  {uploadMutation.isPending
                    ? "Mengunggah..."
                    : "Tambah Dokumen"}
                </span>
              </Button>
            </div>
          ) : undefined
        }
      />

      {/* Cancel Request Confirmation Dialog */}
      {permissions.canCancel && (
        <Dialog
          open={cancelOpen}
          onOpenChange={(nextOpen) => {
            if (cancelMutation.isPending) return
            setCancelOpen(nextOpen)
            if (!nextOpen) setCancelError(null)
          }}
        >
          <DialogContent>
            <form onSubmit={handleConfirmCancel} className="space-y-4">
              <DialogHeader>
                <DialogTitle>Batalkan Permohonan Surat?</DialogTitle>
                <DialogDescription>
                  Permohonan yang dibatalkan tidak dapat diajukan ulang dengan ID
                  yang sama. Lampiran yang ada akan dibersihkan otomatis sesuai
                  kebijakan penyimpanan.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2">
                <label
                  htmlFor="cancel-letter-reason"
                  className="block text-sm font-medium text-foreground"
                >
                  Alasan Pembatalan (Opsional)
                </label>
                <Textarea
                  id="cancel-letter-reason"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Contoh: Data keperluan berubah atau surat tidak lagi diperlukan..."
                  rows={3}
                  maxLength={500}
                  disabled={cancelMutation.isPending}
                />
              </div>

              {cancelError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive-subtle px-3 py-2 text-xs text-destructive"
                >
                  <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                  <span>{cancelError}</span>
                </div>
              )}

              <DialogFooter>
                <DialogClose
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      disabled={cancelMutation.isPending}
                    />
                  }
                >
                  Kembali
                </DialogClose>
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={cancelMutation.isPending}
                >
                  {cancelMutation.isPending
                    ? "Membatalkan..."
                    : "Ya, Batalkan Permohonan"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </ResidentContainer>
  )
}

