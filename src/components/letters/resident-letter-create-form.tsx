"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  CheckCircle2Icon,
  CheckSquareIcon,
  FilePlus2Icon,
  FileTextIcon,
  RefreshCwIcon,
  SendIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

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
import { Textarea } from "@/components/ui/textarea"
import {
  MAX_LETTER_PURPOSE_LENGTH,
  MAX_LETTER_SUPPORTING_DOCS,
} from "@/lib/letters/constants"
import { formatLetterFileSize } from "@/lib/letters/formatters"
import {
  useCreateLetterRequestMutation,
  useUploadLetterSupportingDocMutation,
} from "@/lib/letters/hooks"
import { createLetterRequestSchema } from "@/lib/letters/schemas"
import { validateLetterAttachmentFile } from "@/lib/letters/storage"
import type { LetterRequest, LetterType } from "@/lib/letters/types"

interface ResidentLetterCreateFormProps {
  tenantId: string
  tenantName: string
  activeLetterTypes: LetterType[]
  letterTypesError?: string | null
}

interface QueuedDocItem {
  localId: string
  file: File
  previewUrl: string | null
  status: "pending" | "uploading" | "uploaded" | "failed"
  error: string | null
}

export function ResidentLetterCreateForm({
  tenantId,
  tenantName,
  activeLetterTypes,
  letterTypesError = null,
}: ResidentLetterCreateFormProps) {
  const router = useRouter()
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const objectUrlsRef = React.useRef<Set<string>>(new Set())

  const [letterTypeId, setLetterTypeId] = React.useState<string>(
    activeLetterTypes[0]?.id ?? ""
  )
  const [purpose, setPurpose] = React.useState("")
  const [queuedDocs, setQueuedDocs] = React.useState<QueuedDocItem[]>([])

  const [fieldErrors, setFieldErrors] = React.useState<{
    letterTypeId?: string
    purpose?: string
    file?: string
  }>({})
  const [submitError, setSubmitError] = React.useState<string | null>(null)

  // Persisted stage-1 request so retrying failed attachment uploads never creates a duplicate request
  const [createdRequest, setCreatedRequest] =
    React.useState<LetterRequest | null>(null)

  const createMutation = useCreateLetterRequestMutation(tenantId)
  const uploadMutation = useUploadLetterSupportingDocMutation(tenantId)
  const isBusy = createMutation.isPending || uploadMutation.isPending

  React.useEffect(() => {
    const urls = objectUrlsRef.current
    return () => {
      for (const url of urls) {
        URL.revokeObjectURL(url)
      }
      urls.clear()
    }
  }, [])

  const selectedLetterType = React.useMemo(
    () => activeLetterTypes.find((lt) => lt.id === letterTypeId) ?? null,
    [activeLetterTypes, letterTypeId]
  )

  const remainingUploadable = React.useMemo(
    () => queuedDocs.filter((doc) => doc.status !== "uploaded"),
    [queuedDocs]
  )

  async function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const fileList = Array.from(event.target.files ?? [])
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
    if (fileList.length === 0) return

    const currentCount = queuedDocs.length
    const availableSlots = MAX_LETTER_SUPPORTING_DOCS - currentCount
    if (availableSlots <= 0) {
      setFieldErrors((prev) => ({
        ...prev,
        file: `Maksimal ${MAX_LETTER_SUPPORTING_DOCS} dokumen pendukung per permohonan.`,
      }))
      return
    }

    const candidates = fileList.slice(0, availableSlots)
    const nextItems: QueuedDocItem[] = []
    let firstError: string | undefined

    for (const file of candidates) {
      const validation = await validateLetterAttachmentFile(file)
      if (!validation.ok) {
        if (!firstError) firstError = validation.error
        continue
      }

      const previewUrl =
        validation.file.mimeType === "image/jpeg" ||
        validation.file.mimeType === "image/png"
          ? URL.createObjectURL(file)
          : null
      if (previewUrl) {
        objectUrlsRef.current.add(previewUrl)
      }

      nextItems.push({
        localId: `${file.name}-${file.size}-${crypto.randomUUID()}`,
        file,
        previewUrl,
        status: "pending",
        error: null,
      })
    }

    if (fileList.length > availableSlots && !firstError) {
      firstError = `Hanya ${availableSlots} file pertama yang ditambahkan karena batas maksimal ${MAX_LETTER_SUPPORTING_DOCS} dokumen.`
    }

    setFieldErrors((prev) => ({ ...prev, file: firstError }))
    if (nextItems.length > 0) {
      setQueuedDocs((prev) => [...prev, ...nextItems])
    }
  }

  function handleRemoveQueuedDoc(localId: string) {
    setQueuedDocs((prev) => {
      const target = prev.find((item) => item.localId === localId)
      if (target?.status === "uploaded") return prev
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl)
        objectUrlsRef.current.delete(target.previewUrl)
      }
      return prev.filter((item) => item.localId !== localId)
    })
    setFieldErrors((prev) => ({ ...prev, file: undefined }))
  }

  async function uploadRemainingAttachments(
    targetRequestId: string,
    items: QueuedDocItem[]
  ): Promise<boolean> {
    let allSucceeded = true

    for (const item of items) {
      if (item.status === "uploaded") continue

      setQueuedDocs((prev) =>
        prev.map((q) =>
          q.localId === item.localId
            ? { ...q, status: "uploading", error: null }
            : q
        )
      )

      const formData = new FormData()
      formData.append("requestId", targetRequestId)
      formData.append("file", item.file)

      try {
        await uploadMutation.mutateAsync(formData)
        setQueuedDocs((prev) =>
          prev.map((q) =>
            q.localId === item.localId
              ? { ...q, status: "uploaded", error: null }
              : q
          )
        )
      } catch (err) {
        allSucceeded = false
        const message =
          err instanceof Error
            ? err.message
            : "Gagal mengunggah dokumen pendukung."
        setQueuedDocs((prev) =>
          prev.map((q) =>
            q.localId === item.localId
              ? { ...q, status: "failed", error: message }
              : q
          )
        )
      }
    }

    return allSucceeded
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (isBusy) return

    // Stage 2 retry path if Stage 1 already persisted the request
    if (createdRequest) {
      setSubmitError(null)
      const ok = await uploadRemainingAttachments(
        createdRequest.id,
        queuedDocs
      )
      if (ok) {
        toast.success("Permohonan surat dan dokumen pendukung berhasil dikirim")
        router.push(`/resident/letters/${createdRequest.id}`)
        router.refresh()
      } else {
        setSubmitError(
          "Sebagian dokumen gagal diunggah. Anda dapat mencoba mengunggah ulang berkas yang gagal tanpa membuat permohonan baru."
        )
      }
      return
    }

    const parsed = createLetterRequestSchema.safeParse({
      letterTypeId,
      purpose,
    })

    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors
      setFieldErrors({
        letterTypeId: flat.letterTypeId?.[0],
        purpose: flat.purpose?.[0],
      })
      return
    }

    setFieldErrors({})
    setSubmitError(null)

    let persistedRequest: LetterRequest
    try {
      persistedRequest = await createMutation.mutateAsync(parsed.data)
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : "Gagal mengajukan permohonan surat. Silakan coba lagi."
      )
      return
    }

    if (queuedDocs.length === 0) {
      toast.success("Permohonan surat berhasil diajukan")
      router.push(`/resident/letters/${persistedRequest.id}`)
      router.refresh()
      return
    }

    // Store Stage 1 request immediately before starting Stage 2 uploads
    setCreatedRequest(persistedRequest)
    const ok = await uploadRemainingAttachments(persistedRequest.id, queuedDocs)
    if (ok) {
      toast.success("Permohonan surat beserta lampiran berhasil diajukan")
      router.push(`/resident/letters/${persistedRequest.id}`)
      router.refresh()
    } else {
      toast.error(
        "Permohonan berhasil dibuat, namun ada lampiran yang gagal diunggah"
      )
      setSubmitError(
        "Permohonan Anda sudah tercatat. Silakan klik tombol 'Lanjutkan Unggah Dokumen' di bawah tanpa membuat pengajuan baru."
      )
    }
  }

  return (
    <ResidentContainer className="flex flex-col gap-[var(--space-5)]">
      <div className="space-y-2">
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href="/resident/letters" />}
        >
          <ArrowLeftIcon className="size-4" />
          <span>Kembali ke Daftar Surat</span>
        </Button>

        <div>
          <h1 className="font-heading text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Ajukan Surat Pengantar
          </h1>
          <p className="text-sm text-muted-foreground">
            Formulir pengajuan surat pengantar untuk warga di {tenantName}.
          </p>
        </div>
      </div>

      {letterTypesError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive-subtle/40 px-4 py-3 text-sm text-destructive"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
          <span>{letterTypesError}</span>
        </div>
      )}

      {activeLetterTypes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
            <FileTextIcon className="size-8 text-muted-foreground/70" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                Belum ada jenis surat aktif
              </p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Ketua RT atau Sekretaris belum menambahkan jenis surat pengantar
                yang aktif untuk RT ini.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/resident/letters" />}
            >
              Kembali
            </Button>
          </CardContent>
        </Card>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-[var(--space-5)]">
          {/* Partial Stage-1 Success Banner */}
          {createdRequest && (
            <div
              role="status"
              data-testid="letter-created-retry-banner"
              className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning-subtle/30 p-4 text-sm"
            >
              <div className="flex items-start gap-2.5">
                <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-warning" />
                <div className="space-y-1">
                  <p className="font-semibold text-foreground">
                    Permohonan Surat Sudah Terbentuk
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Permohonan untuk{" "}
                    <strong className="text-foreground">
                      {createdRequest.letterTypeName}
                    </strong>{" "}
                    telah tersimpan dengan status Diajukan. Lanjutkan unggah
                    lampiran yang gagal atau buka detail permohonan.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<Link href={`/resident/letters/${createdRequest.id}`} />}
                >
                  Buka Detail Permohonan
                </Button>
              </div>
            </div>
          )}

          {/* Stage 1 Fields */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">1. Jenis &amp; Keperluan</CardTitle>
              <CardDescription>
                Pilih jenis surat dan jelaskan keperluan pengajuan dengan jelas.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="resident-letter-type"
                  className="block text-sm font-medium text-foreground"
                >
                  Jenis Surat
                </label>
                <select
                  id="resident-letter-type"
                  value={letterTypeId}
                  disabled={isBusy || createdRequest !== null}
                  onChange={(e) => {
                    setLetterTypeId(e.target.value)
                    setFieldErrors((prev) => ({
                      ...prev,
                      letterTypeId: undefined,
                    }))
                  }}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-2xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {activeLetterTypes.map((lt) => (
                    <option key={lt.id} value={lt.id}>
                      {lt.name} ({lt.code})
                    </option>
                  ))}
                </select>
                {fieldErrors.letterTypeId && (
                  <p className="text-xs text-destructive">
                    {fieldErrors.letterTypeId}
                  </p>
                )}
              </div>

              {selectedLetterType && (
                <div className="rounded-lg border border-border bg-surface-subtle/50 p-3.5 text-xs">
                  <p className="flex items-center gap-1.5 font-medium text-foreground">
                    <CheckSquareIcon className="size-3.5 text-primary" />
                    <span>Persyaratan Dokumen ({selectedLetterType.name})</span>
                  </p>
                  {selectedLetterType.description && (
                    <p className="mt-1 text-muted-foreground">
                      {selectedLetterType.description}
                    </p>
                  )}
                  {selectedLetterType.requiredDocuments.length === 0 ? (
                    <p className="mt-1.5 text-muted-foreground">
                      Tidak ada dokumen persyaratan khusus.
                    </p>
                  ) : (
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-foreground">
                      {selectedLetterType.requiredDocuments.map((reqDoc, i) => (
                        <li key={`${reqDoc}-${i}`}>{reqDoc}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <label
                  htmlFor="resident-letter-purpose"
                  className="block text-sm font-medium text-foreground"
                >
                  Keperluan Pengajuan
                </label>
                <Textarea
                  id="resident-letter-purpose"
                  value={purpose}
                  disabled={isBusy || createdRequest !== null}
                  onChange={(e) => {
                    setPurpose(e.target.value)
                    setFieldErrors((prev) => ({ ...prev, purpose: undefined }))
                  }}
                  placeholder="Contoh: Untuk pengurusan perpanjangan KTP / administrasi bank / pendaftaran sekolah..."
                  rows={4}
                  maxLength={MAX_LETTER_PURPOSE_LENGTH}
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {fieldErrors.purpose ? (
                      <span className="text-destructive">
                        {fieldErrors.purpose}
                      </span>
                    ) : (
                      "Keperluan wajib diisi."
                    )}
                  </span>
                  <span className="tabular-nums">
                    {purpose.length}/{MAX_LETTER_PURPOSE_LENGTH}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Stage 2 Attachments */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                2. Dokumen Pendukung (Opsional, Maks.{" "}
                {MAX_LETTER_SUPPORTING_DOCS} berkas)
              </CardTitle>
              <CardDescription>
                Format JPEG, PNG, atau PDF maksimal 5 MiB per berkas. Dapat
                ditambahkan atau diubah selama permohonan masih berstatus
                Diajukan.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {queuedDocs.length < MAX_LETTER_SUPPORTING_DOCS && (
                <div>
                  <input
                    ref={fileInputRef}
                    id="resident-letter-files"
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf"
                    disabled={isBusy}
                    onChange={handleFileSelect}
                    className="sr-only"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isBusy}
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full border-dashed"
                  >
                    <FilePlus2Icon className="size-4" />
                    <span>
                      Pilih Dokumen Pendukung ({queuedDocs.length}/
                      {MAX_LETTER_SUPPORTING_DOCS})
                    </span>
                  </Button>
                </div>
              )}

              {fieldErrors.file && (
                <p role="alert" className="text-xs text-destructive">
                  {fieldErrors.file}
                </p>
              )}

              {queuedDocs.length > 0 && (
                <ul className="space-y-2.5">
                  {queuedDocs.map((item) => (
                    <li
                      key={item.localId}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background p-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        {item.previewUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element -- Local revocable File blob preview before upload */
                          <img
                            src={item.previewUrl}
                            alt={item.file.name}
                            className="size-10 shrink-0 rounded-md border border-border object-cover"
                          />
                        ) : (
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
                            <FileTextIcon className="size-4" />
                          </span>
                        )}
                        <div className="min-w-0 space-y-0.5">
                          <p className="truncate text-sm font-medium text-foreground">
                            {item.file.name}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>{formatLetterFileSize(item.file.size)}</span>
                            {item.status === "uploaded" && (
                              <Badge variant="success" size="sm">
                                Terunggah
                              </Badge>
                            )}
                            {item.status === "uploading" && (
                              <Badge variant="info" size="sm">
                                Mengunggah...
                              </Badge>
                            )}
                            {item.status === "failed" && (
                              <Badge variant="destructive" size="sm">
                                Gagal diunggah
                              </Badge>
                            )}
                          </div>
                          {item.error && (
                            <p className="text-xs text-destructive">
                              {item.error}
                            </p>
                          )}
                        </div>
                      </div>

                      {item.status !== "uploaded" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={isBusy}
                          onClick={() => handleRemoveQueuedDoc(item.localId)}
                        >
                          <Trash2Icon className="size-4 text-destructive" />
                          <span className="sr-only">Hapus berkas</span>
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {submitError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive-subtle/40 px-4 py-3 text-sm text-destructive"
            >
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href="/resident/letters" />}
              disabled={isBusy}
            >
              Batal
            </Button>

            <Button type="submit" disabled={isBusy}>
              {isBusy ? (
                "Memproses Pengajuan..."
              ) : createdRequest && remainingUploadable.length > 0 ? (
                <>
                  <RefreshCwIcon className="size-4" />
                  <span>Lanjutkan Unggah Dokumen</span>
                </>
              ) : (
                <>
                  <SendIcon className="size-4" />
                  <span>Kirim Permohonan Surat</span>
                </>
              )}
            </Button>
          </div>
        </form>
      )}
    </ResidentContainer>
  )
}

