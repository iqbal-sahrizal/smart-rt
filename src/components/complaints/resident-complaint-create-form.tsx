"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  CheckCircle2Icon,
  ImagePlusIcon,
  RefreshCwIcon,
  SendIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { ResidentContainer } from "@/components/resident/resident-container"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { COMPLAINT_CATEGORIES } from "@/lib/complaints/constants"
import { formatComplaintFileSize } from "@/lib/complaints/formatters"
import {
  useCreateComplaintMutation,
  useUploadComplaintPhotoMutation,
} from "@/lib/complaints/hooks"
import { createComplaintSchema } from "@/lib/complaints/schemas"
import { validateComplaintPhotoFile } from "@/lib/complaints/storage"
import type { Complaint, ComplaintCategory } from "@/lib/complaints/types"

interface ResidentComplaintCreateFormProps {
  tenantId: string
  tenantName: string
}

interface FieldErrors {
  category?: string
  title?: string
  description?: string
  photo?: string
}

export function ResidentComplaintCreateForm({
  tenantId,
  tenantName,
}: ResidentComplaintCreateFormProps) {
  const router = useRouter()
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const previewUrlRef = React.useRef<string | null>(null)

  const [category, setCategory] = React.useState<ComplaintCategory>(
    COMPLAINT_CATEGORIES[0]
  )
  const [title, setTitle] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({})
  const [submitError, setSubmitError] = React.useState<string | null>(null)

  // Track persisted complaint if Step 1 succeeded and Step 2 (photo upload) failed
  const [createdComplaint, setCreatedComplaint] =
    React.useState<Complaint | null>(null)
  const [photoUploadError, setPhotoUploadError] = React.useState<string | null>(
    null
  )

  const createMutation = useCreateComplaintMutation(tenantId)
  const uploadPhotoMutation = useUploadComplaintPhotoMutation(tenantId)
  const isSubmitting =
    createMutation.isPending || uploadPhotoMutation.isPending

  React.useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
        previewUrlRef.current = null
      }
    }
  }, [])

  function clearSelectedPhoto() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
    setPreviewUrl(null)
    setSelectedFile(null)
    setFieldErrors((prev) => ({ ...prev, photo: undefined }))
    setPhotoUploadError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    if (!file) {
      clearSelectedPhoto()
      return
    }

    const validation = await validateComplaintPhotoFile(file)
    if (!validation.ok) {
      clearSelectedPhoto()
      setFieldErrors((prev) => ({ ...prev, photo: validation.error }))
      return
    }

    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
    }
    const nextUrl = URL.createObjectURL(file)
    previewUrlRef.current = nextUrl
    setSelectedFile(file)
    setPreviewUrl(nextUrl)
    setFieldErrors((prev) => ({ ...prev, photo: undefined }))
    setPhotoUploadError(null)
  }

  async function uploadPhotoForCreatedComplaint(
    complaintId: string,
    file: File
  ): Promise<boolean> {
    const validation = await validateComplaintPhotoFile(file)
    if (!validation.ok) {
      setFieldErrors((prev) => ({ ...prev, photo: validation.error }))
      setPhotoUploadError(validation.error)
      return false
    }

    const formData = new FormData()
    formData.append("complaintId", complaintId)
    formData.append("photo", file)

    try {
      await uploadPhotoMutation.mutateAsync(formData)
      return true
    } catch (err) {
      setPhotoUploadError(
        err instanceof Error
          ? err.message
          : "Gagal mengunggah foto pengaduan. Silakan coba lagi."
      )
      return false
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (isSubmitting) return

    // If the complaint was already created, retrying form submit only retries photo upload
    if (createdComplaint) {
      if (selectedFile) {
        setPhotoUploadError(null)
        const ok = await uploadPhotoForCreatedComplaint(
          createdComplaint.id,
          selectedFile
        )
        if (ok) {
          toast.success("Pengaduan dan foto berhasil disimpan")
          router.push(`/resident/complaints/${createdComplaint.id}`)
          router.refresh()
        }
      }
      return
    }

    setSubmitError(null)
    setPhotoUploadError(null)

    const parsed = createComplaintSchema.safeParse({
      category,
      title,
      description,
    })

    const nextErrors: FieldErrors = {}
    if (!parsed.success) {
      const flattened = parsed.error.flatten().fieldErrors
      nextErrors.category = flattened.category?.[0]
      nextErrors.title = flattened.title?.[0]
      nextErrors.description = flattened.description?.[0]
    }

    if (selectedFile) {
      const photoCheck = await validateComplaintPhotoFile(selectedFile)
      if (!photoCheck.ok) {
        nextErrors.photo = photoCheck.error
      }
    }

    if (
      nextErrors.category ||
      nextErrors.title ||
      nextErrors.description ||
      nextErrors.photo
    ) {
      setFieldErrors(nextErrors)
      return
    }

    setFieldErrors({})

    let created: Complaint
    try {
      created = await createMutation.mutateAsync({
        category: parsed.data!.category,
        title: parsed.data!.title,
        description: parsed.data!.description,
      })
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : "Gagal mengirim pengaduan. Silakan coba lagi."
      )
      return
    }

    if (!selectedFile) {
      toast.success("Pengaduan berhasil dikirim")
      router.push(`/resident/complaints/${created.id}`)
      router.refresh()
      return
    }

    // Step 2: Upload optional photo after complaint row exists
    const uploaded = await uploadPhotoForCreatedComplaint(
      created.id,
      selectedFile
    )
    if (!uploaded) {
      // Preserve created complaint so retry never duplicates it
      setCreatedComplaint(created)
      toast.warning("Pengaduan tersimpan, namun foto gagal diunggah")
      return
    }

    toast.success("Pengaduan beserta foto berhasil dikirim")
    router.push(`/resident/complaints/${created.id}`)
    router.refresh()
  }

  async function handleRetryPhotoUpload() {
    if (!createdComplaint || !selectedFile || isSubmitting) return
    setPhotoUploadError(null)
    const ok = await uploadPhotoForCreatedComplaint(
      createdComplaint.id,
      selectedFile
    )
    if (ok) {
      toast.success("Foto pengaduan berhasil diunggah")
      router.push(`/resident/complaints/${createdComplaint.id}`)
      router.refresh()
    }
  }

  return (
    <ResidentContainer>
      <div className="space-y-2">
        <div>
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/resident/complaints" />}
            className="-ml-2 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" />
            <span>Kembali ke Pengaduan Saya</span>
          </Button>
        </div>

        <h1 className="font-heading text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          Buat Pengaduan Baru
        </h1>
        <p className="text-sm text-muted-foreground">
          Kirim laporan keluhan untuk pengurus {tenantName}. Pengaduan baru akan
          dicatat dengan status Menunggu dan prioritas Sedang.
        </p>
      </div>

      {createdComplaint && (
        <Card
          data-testid="partial-photo-upload-recovery"
          className="border-warning-border bg-warning-subtle/40"
        >
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-foreground">
              <CheckCircle2Icon className="size-4 text-success-text" />
              <span>Pengaduan Berhasil Disimpan, Foto Belum Terunggah</span>
            </CardTitle>
            <CardDescription className="text-xs leading-relaxed text-foreground/80">
              Laporan <strong>{createdComplaint.title}</strong> sudah tersimpan
              di sistem.{" "}
              {photoUploadError
                ? `Unggah foto gagal: ${photoUploadError}`
                : "Anda dapat mencoba mengunggah foto kembali tanpa membuat pengaduan duplikat."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 pt-0">
            {selectedFile && (
              <Button
                type="button"
                size="sm"
                onClick={handleRetryPhotoUpload}
                disabled={isSubmitting}
                data-testid="retry-photo-upload-btn"
              >
                <RefreshCwIcon className="size-3.5" />
                <span>
                  {uploadPhotoMutation.isPending
                    ? "Mengunggah Ulang..."
                    : "Coba Unggah Foto Lagi"}
                </span>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <Link href={`/resident/complaints/${createdComplaint.id}`} />
              }
              data-testid="continue-without-photo-link"
            >
              <span>Lihat Detail Pengaduan</span>
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Formulir Pengaduan</CardTitle>
          <CardDescription>
            Lengkapi kategori, judul, deskripsi masalah, dan foto pendukung jika
            ada.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {/* Kategori */}
            <div className="space-y-1.5">
              <label
                htmlFor="complaint-category"
                className="text-sm font-medium text-foreground"
              >
                Kategori <span className="text-destructive">*</span>
              </label>
              <select
                id="complaint-category"
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value as ComplaintCategory)
                  setFieldErrors((prev) => ({ ...prev, category: undefined }))
                }}
                disabled={isSubmitting || Boolean(createdComplaint)}
                aria-invalid={Boolean(fieldErrors.category)}
                className="h-[var(--size-control-md)] w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted/60 disabled:opacity-60"
                data-testid="create-complaint-category"
              >
                {COMPLAINT_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
              {fieldErrors.category && (
                <p className="text-xs text-destructive" role="alert">
                  {fieldErrors.category}
                </p>
              )}
            </div>

            {/* Judul */}
            <div className="space-y-1.5">
              <label
                htmlFor="complaint-title"
                className="text-sm font-medium text-foreground"
              >
                Judul Pengaduan <span className="text-destructive">*</span>
              </label>
              <Input
                id="complaint-title"
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value)
                  if (fieldErrors.title) {
                    setFieldErrors((prev) => ({ ...prev, title: undefined }))
                  }
                }}
                placeholder="Contoh: Lampu penerangan gang 2 padam"
                maxLength={150}
                disabled={isSubmitting || Boolean(createdComplaint)}
                aria-invalid={Boolean(fieldErrors.title)}
                data-testid="create-complaint-title"
              />
              <div className="flex items-center justify-between gap-2 text-xs">
                {fieldErrors.title ? (
                  <span className="text-destructive" role="alert">
                    {fieldErrors.title}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    Minimal 5 karakter, maksimal 150 karakter.
                  </span>
                )}
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {title.trim().length}/150
                </span>
              </div>
            </div>

            {/* Deskripsi */}
            <div className="space-y-1.5">
              <label
                htmlFor="complaint-description"
                className="text-sm font-medium text-foreground"
              >
                Deskripsi Pengaduan <span className="text-destructive">*</span>
              </label>
              <Textarea
                id="complaint-description"
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value)
                  if (fieldErrors.description) {
                    setFieldErrors((prev) => ({
                      ...prev,
                      description: undefined,
                    }))
                  }
                }}
                placeholder="Jelaskan lokasi kejadian, kondisi yang dikeluhkan, dan informasi penting lainnya..."
                maxLength={2000}
                rows={4}
                disabled={isSubmitting || Boolean(createdComplaint)}
                aria-invalid={Boolean(fieldErrors.description)}
                data-testid="create-complaint-description"
              />
              <div className="flex items-center justify-between gap-2 text-xs">
                {fieldErrors.description ? (
                  <span className="text-destructive" role="alert">
                    {fieldErrors.description}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    Minimal 10 karakter, maksimal 2000 karakter.
                  </span>
                )}
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {description.trim().length}/2000
                </span>
              </div>
            </div>

            {/* Foto Opsional */}
            <div className="space-y-2">
              <label
                htmlFor="complaint-photo"
                className="text-sm font-medium text-foreground"
              >
                Foto Pendukung (Opsional)
              </label>
              <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4">
                <input
                  ref={fileInputRef}
                  id="complaint-photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleFileChange}
                  disabled={isSubmitting}
                  className="sr-only"
                  data-testid="create-complaint-photo-input"
                />

                {!selectedFile ? (
                  <div className="flex flex-col items-center justify-center gap-2 text-center">
                    <ImagePlusIcon className="size-7 text-muted-foreground" />
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium text-foreground">
                        Pilih foto kondisi lapangan
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Format JPEG, PNG, atau WebP (maksimum 5 MiB).
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isSubmitting}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <ImagePlusIcon className="size-4" />
                      <span>Pilih Foto</span>
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {previewUrl && (
                      <div className="overflow-hidden rounded-md border border-border bg-background">
                        {/* eslint-disable-next-line @next/next/no-img-element -- Local blob preview before private storage upload */}
                        <img
                          src={previewUrl}
                          alt="Pratinjau foto pengaduan"
                          className="max-h-64 w-full object-contain"
                        />
                      </div>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">
                          {selectedFile.name}
                        </p>
                        <p className="text-muted-foreground">
                          {formatComplaintFileSize(selectedFile.size)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isSubmitting}
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <span>Ganti Foto</span>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={isSubmitting}
                          onClick={clearSelectedPhoto}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2Icon className="size-4" />
                          <span>Hapus</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {fieldErrors.photo && (
                <p className="text-xs text-destructive" role="alert">
                  {fieldErrors.photo}
                </p>
              )}
            </div>

            {submitError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-xs text-destructive"
              >
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                <span>{submitError}</span>
              </div>
            )}

            <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link href="/resident/complaints" />}
                disabled={isSubmitting}
              >
                Batal
              </Button>
              {!createdComplaint && (
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  data-testid="submit-create-complaint-btn"
                >
                  <SendIcon className="size-4" />
                  <span>
                    {createMutation.isPending
                      ? "Menyimpan Pengaduan..."
                      : uploadPhotoMutation.isPending
                        ? "Mengunggah Foto..."
                        : "Kirim Pengaduan"}
                  </span>
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </ResidentContainer>
  )
}

