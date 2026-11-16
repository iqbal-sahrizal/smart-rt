"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  CalendarClockIcon,
  HistoryIcon,
  ImagePlusIcon,
  MessageSquareIcon,
  PencilIcon,
  SendIcon,
  TagIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { ComplaintPhotoViewer } from "@/components/complaints/complaint-photo-viewer"
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
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { COMPLAINT_CATEGORIES } from "@/lib/complaints/constants"
import {
  buildComplaintStatusHistoryDescription,
  formatComplaintDateTime,
  formatComplaintFileSize,
  getComplaintPriorityBadgeVariant,
  getComplaintPriorityLabel,
  getComplaintStatusBadgeVariant,
  getComplaintStatusLabel,
} from "@/lib/complaints/formatters"
import {
  useCreateComplaintReplyMutation,
  useDeleteComplaintPhotoMutation,
  useResidentComplaintDetail,
  useUpdateComplaintMutation,
  useUploadComplaintPhotoMutation,
} from "@/lib/complaints/hooks"
import {
  createComplaintReplySchema,
  updateComplaintSchema,
} from "@/lib/complaints/schemas"
import { validateComplaintPhotoFile } from "@/lib/complaints/storage"
import type { ComplaintCategory, ComplaintDetail } from "@/lib/complaints/types"

interface ResidentComplaintDetailViewProps {
  tenantId: string
  actorKey: string
  complaintId: string
  initialDetail: ComplaintDetail
}

export function ResidentComplaintDetailView({
  tenantId,
  actorKey,
  complaintId,
  initialDetail,
}: ResidentComplaintDetailViewProps) {
  const router = useRouter()
  const detailQuery = useResidentComplaintDetail({
    tenantId,
    actorKey,
    complaintId,
    initialData: initialDetail,
  })
  const updateMutation = useUpdateComplaintMutation(tenantId)
  const replyMutation = useCreateComplaintReplyMutation(tenantId)
  const uploadPhotoMutation = useUploadComplaintPhotoMutation(tenantId)
  const deletePhotoMutation = useDeleteComplaintPhotoMutation(tenantId)

  const detail = detailQuery.data ?? initialDetail
  const { complaint, replies, statusHistory, permissions } = detail

  // Edit state (only active when permissions.canEdit)
  const [isEditing, setIsEditing] = React.useState(false)
  const [editCategory, setEditCategory] = React.useState<ComplaintCategory>(
    COMPLAINT_CATEGORIES.includes(complaint.category as ComplaintCategory)
      ? (complaint.category as ComplaintCategory)
      : COMPLAINT_CATEGORIES[0]
  )
  const [editTitle, setEditTitle] = React.useState(complaint.title)
  const [editDescription, setEditDescription] = React.useState(
    complaint.description
  )
  const [editFieldErrors, setEditFieldErrors] = React.useState<{
    category?: string
    title?: string
    description?: string
  }>({})
  const [editError, setEditError] = React.useState<string | null>(null)

  // Photo management state (only active when permissions.canManagePhoto)
  const photoInputRef = React.useRef<HTMLInputElement | null>(null)
  const photoPreviewUrlRef = React.useRef<string | null>(null)
  const [pendingPhotoFile, setPendingPhotoFile] = React.useState<File | null>(
    null
  )
  const [pendingPhotoPreview, setPendingPhotoPreview] = React.useState<
    string | null
  >(null)
  const [photoError, setPhotoError] = React.useState<string | null>(null)
  const [deletePhotoOpen, setDeletePhotoOpen] = React.useState(false)
  const [deletePhotoError, setDeletePhotoError] = React.useState<string | null>(
    null
  )

  // Reply state
  const [replyText, setReplyText] = React.useState("")
  const [replyError, setReplyError] = React.useState<string | null>(null)

  React.useEffect(() => {
    return () => {
      if (photoPreviewUrlRef.current) {
        URL.revokeObjectURL(photoPreviewUrlRef.current)
        photoPreviewUrlRef.current = null
      }
    }
  }, [])

  function openEditMode() {
    setEditCategory(
      COMPLAINT_CATEGORIES.includes(complaint.category as ComplaintCategory)
        ? (complaint.category as ComplaintCategory)
        : COMPLAINT_CATEGORIES[0]
    )
    setEditTitle(complaint.title)
    setEditDescription(complaint.description)
    setEditFieldErrors({})
    setEditError(null)
    setIsEditing(true)
  }

  function clearPendingPhoto() {
    if (photoPreviewUrlRef.current) {
      URL.revokeObjectURL(photoPreviewUrlRef.current)
      photoPreviewUrlRef.current = null
    }
    setPendingPhotoFile(null)
    setPendingPhotoPreview(null)
    setPhotoError(null)
    if (photoInputRef.current) {
      photoInputRef.current.value = ""
    }
  }

  async function handleSelectNewPhoto(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0] ?? null
    if (!file) {
      clearPendingPhoto()
      return
    }

    const validated = await validateComplaintPhotoFile(file)
    if (!validated.ok) {
      clearPendingPhoto()
      setPhotoError(validated.error)
      return
    }

    if (photoPreviewUrlRef.current) {
      URL.revokeObjectURL(photoPreviewUrlRef.current)
    }
    const nextUrl = URL.createObjectURL(file)
    photoPreviewUrlRef.current = nextUrl
    setPendingPhotoFile(file)
    setPendingPhotoPreview(nextUrl)
    setPhotoError(null)
  }

  async function handleUploadPendingPhoto() {
    if (
      !permissions.canManagePhoto ||
      !pendingPhotoFile ||
      uploadPhotoMutation.isPending
    ) {
      return
    }

    const validated = await validateComplaintPhotoFile(pendingPhotoFile)
    if (!validated.ok) {
      setPhotoError(validated.error)
      return
    }

    setPhotoError(null)
    const formData = new FormData()
    formData.append("complaintId", complaint.id)
    formData.append("photo", pendingPhotoFile)

    try {
      await uploadPhotoMutation.mutateAsync(formData)
      clearPendingPhoto()
      toast.success("Foto pengaduan berhasil diunggah")
      await detailQuery.refetch()
      router.refresh()
    } catch (err) {
      setPhotoError(
        err instanceof Error
          ? err.message
          : "Gagal mengunggah foto pengaduan. Silakan coba lagi."
      )
    }
  }

  async function handleConfirmDeletePhoto() {
    if (!permissions.canManagePhoto || deletePhotoMutation.isPending) return
    setDeletePhotoError(null)

    try {
      await deletePhotoMutation.mutateAsync({
        complaintId: complaint.id,
        reason: "user_requested",
      })
      setDeletePhotoOpen(false)
      toast.success("Permintaan hapus foto berhasil diproses")
      await detailQuery.refetch()
      router.refresh()
    } catch (err) {
      setDeletePhotoError(
        err instanceof Error
          ? err.message
          : "Gagal menghapus foto pengaduan. Silakan coba lagi."
      )
    }
  }

  async function handleSaveEdit(event: React.FormEvent) {
    event.preventDefault()
    if (!permissions.canEdit || updateMutation.isPending) return

    const parsed = updateComplaintSchema.safeParse({
      complaintId: complaint.id,
      category: editCategory,
      title: editTitle,
      description: editDescription,
    })

    if (!parsed.success) {
      const flattened = parsed.error.flatten().fieldErrors
      setEditFieldErrors({
        category: flattened.category?.[0],
        title: flattened.title?.[0],
        description: flattened.description?.[0],
      })
      return
    }

    setEditFieldErrors({})
    setEditError(null)

    try {
      await updateMutation.mutateAsync(parsed.data)
      setIsEditing(false)
      toast.success("Pengaduan berhasil diperbarui")
      await detailQuery.refetch()
      router.refresh()
    } catch (err) {
      setEditError(
        err instanceof Error
          ? err.message
          : "Gagal memperbarui pengaduan. Silakan coba lagi."
      )
    }
  }

  async function handleSubmitReply(event: React.FormEvent) {
    event.preventDefault()
    if (!permissions.canReply || replyMutation.isPending) return

    const trimmed = replyText.trim()
    const parsed = createComplaintReplySchema.safeParse({
      complaintId: complaint.id,
      message: trimmed,
    })

    if (!parsed.success) {
      setReplyError(
        parsed.error.issues[0]?.message ??
          "Pesan balasan wajib diisi minimal 2 karakter."
      )
      return
    }

    setReplyError(null)

    try {
      await replyMutation.mutateAsync({
        complaintId: complaint.id,
        message: trimmed,
        scope: "resident",
      })
      setReplyText("")
      toast.success("Balasan berhasil dikirim")
      await detailQuery.refetch()
    } catch (err) {
      setReplyError(
        err instanceof Error
          ? err.message
          : "Gagal mengirim balasan pengaduan. Silakan coba lagi."
      )
    }
  }

  const sortedReplies = React.useMemo(
    () =>
      [...replies].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      ),
    [replies]
  )

  const sortedHistory = React.useMemo(
    () =>
      [...statusHistory].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      ),
    [statusHistory]
  )

  const isClosed =
    complaint.status === "resolved" || complaint.status === "rejected"

  const photoFooter = permissions.canManagePhoto ? (
    complaint.hasPhoto ? (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          Selama status Menunggu, Anda dapat menghapus lampiran foto ini.
        </span>
        <Dialog
          open={deletePhotoOpen}
          onOpenChange={(nextOpen) => {
            if (deletePhotoMutation.isPending) return
            setDeletePhotoOpen(nextOpen)
            if (!nextOpen) setDeletePhotoError(null)
          }}
        >
          <DialogTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                data-testid="resident-delete-photo-trigger"
              >
                <Trash2Icon className="size-3.5" />
                <span>Hapus Foto</span>
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Hapus Foto Pengaduan?</DialogTitle>
              <DialogDescription>
                Lampiran foto pada pengaduan ini akan dihapus dan tidak lagi
                ditampilkan ke pengurus. Tindakan ini dapat dilakukan selama
                status pengaduan masih Menunggu.
              </DialogDescription>
            </DialogHeader>

            {deletePhotoError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-xs text-destructive"
              >
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                <span>{deletePhotoError}</span>
              </div>
            )}

            <DialogFooter>
              <DialogClose
                render={
                  <Button
                    type="button"
                    variant="outline"
                    disabled={deletePhotoMutation.isPending}
                  >
                    Batal
                  </Button>
                }
              />
              <Button
                type="button"
                variant="destructive"
                disabled={deletePhotoMutation.isPending}
                onClick={handleConfirmDeletePhoto}
                data-testid="resident-confirm-delete-photo-btn"
              >
                {deletePhotoMutation.isPending
                  ? "Menghapus..."
                  : "Konfirmasi Hapus Foto"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    ) : (
      <div className="space-y-3" data-testid="resident-attach-photo-box">
        <input
          ref={photoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleSelectNewPhoto}
          disabled={uploadPhotoMutation.isPending}
          className="sr-only"
          data-testid="resident-detail-photo-input"
        />

        {!pendingPhotoFile ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              Anda dapat melampirkan 1 foto (JPEG, PNG, atau WebP, maks. 5 MiB)
              selama status masih Menunggu.
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploadPhotoMutation.isPending}
              onClick={() => photoInputRef.current?.click()}
            >
              <ImagePlusIcon className="size-3.5" />
              <span>Unggah Foto</span>
            </Button>
          </div>
        ) : (
          <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
            {pendingPhotoPreview && (
              <div className="overflow-hidden rounded-md border border-border bg-background">
                {/* eslint-disable-next-line @next/next/no-img-element -- Local blob preview before private storage upload */}
                <img
                  src={pendingPhotoPreview}
                  alt="Pratinjau foto baru"
                  className="max-h-56 w-full object-contain"
                />
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">
                  {pendingPhotoFile.name}
                </p>
                <p className="text-muted-foreground">
                  {formatComplaintFileSize(pendingPhotoFile.size)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploadPhotoMutation.isPending}
                  onClick={clearPendingPhoto}
                >
                  Batal
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={uploadPhotoMutation.isPending}
                  onClick={handleUploadPendingPhoto}
                  data-testid="resident-detail-upload-photo-btn"
                >
                  <ImagePlusIcon className="size-3.5" />
                  <span>
                    {uploadPhotoMutation.isPending
                      ? "Mengunggah..."
                      : "Simpan Foto"}
                  </span>
                </Button>
              </div>
            </div>
          </div>
        )}

        {photoError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-xs text-destructive"
          >
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
            <span>{photoError}</span>
          </div>
        )}
      </div>
    )
  ) : undefined

  return (
    <ResidentContainer>
      {/* Header & Navigation */}
      <div className="flex flex-col gap-3">
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

        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0 space-y-2">
            <h1 className="font-heading text-xl font-bold tracking-tight break-words text-foreground sm:text-2xl">
              {complaint.title}
            </h1>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                variant={getComplaintStatusBadgeVariant(complaint.status)}
                size="default"
                data-testid="resident-detail-status-badge"
              >
                {getComplaintStatusLabel(complaint.status)}
              </Badge>
              <Badge
                variant={getComplaintPriorityBadgeVariant(complaint.priority)}
                size="default"
                data-testid="resident-detail-priority-badge"
              >
                Prioritas {getComplaintPriorityLabel(complaint.priority)}
              </Badge>
              <Badge variant="outline" size="default">
                <TagIcon className="size-3" />
                <span>{complaint.category}</span>
              </Badge>
            </div>
          </div>

          {permissions.canEdit && !isEditing && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={openEditMode}
              className="w-full shrink-0 sm:w-auto"
              data-testid="resident-edit-complaint-btn"
            >
              <PencilIcon className="size-4" />
              <span>Ubah Pengaduan</span>
            </Button>
          )}
        </div>
      </div>

      {detailQuery.error instanceof Error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive-subtle/40 px-4 py-3 text-sm text-destructive"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
          <span>{detailQuery.error.message}</span>
        </div>
      )}

      {/* Form Edit (hanya saat status === open) */}
      {permissions.canEdit && isEditing ? (
        <Card data-testid="resident-edit-complaint-form-card">
          <CardHeader>
            <CardTitle className="text-base">Ubah Pengaduan</CardTitle>
            <CardDescription>
              Anda dapat mengubah kategori, judul, dan deskripsi selama status
              pengaduan masih Menunggu.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveEdit} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <label
                  htmlFor="edit-complaint-category"
                  className="text-sm font-medium text-foreground"
                >
                  Kategori
                </label>
                <select
                  id="edit-complaint-category"
                  value={editCategory}
                  onChange={(event) => {
                    setEditCategory(event.target.value as ComplaintCategory)
                    setEditFieldErrors((prev) => ({
                      ...prev,
                      category: undefined,
                    }))
                  }}
                  disabled={updateMutation.isPending}
                  className="h-[var(--size-control-md)] w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                  data-testid="edit-complaint-category"
                >
                  {COMPLAINT_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
                {editFieldErrors.category && (
                  <p className="text-xs text-destructive" role="alert">
                    {editFieldErrors.category}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="edit-complaint-title"
                  className="text-sm font-medium text-foreground"
                >
                  Judul
                </label>
                <Input
                  id="edit-complaint-title"
                  value={editTitle}
                  onChange={(event) => {
                    setEditTitle(event.target.value)
                    setEditFieldErrors((prev) => ({
                      ...prev,
                      title: undefined,
                    }))
                  }}
                  maxLength={150}
                  disabled={updateMutation.isPending}
                  aria-invalid={Boolean(editFieldErrors.title)}
                  data-testid="edit-complaint-title"
                />
                {editFieldErrors.title && (
                  <p className="text-xs text-destructive" role="alert">
                    {editFieldErrors.title}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="edit-complaint-description"
                  className="text-sm font-medium text-foreground"
                >
                  Deskripsi
                </label>
                <Textarea
                  id="edit-complaint-description"
                  value={editDescription}
                  onChange={(event) => {
                    setEditDescription(event.target.value)
                    setEditFieldErrors((prev) => ({
                      ...prev,
                      description: undefined,
                    }))
                  }}
                  maxLength={2000}
                  rows={4}
                  disabled={updateMutation.isPending}
                  aria-invalid={Boolean(editFieldErrors.description)}
                  data-testid="edit-complaint-description"
                />
                {editFieldErrors.description && (
                  <p className="text-xs text-destructive" role="alert">
                    {editFieldErrors.description}
                  </p>
                )}
              </div>

              {editError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-xs text-destructive"
                >
                  <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                  <span>{editError}</span>
                </div>
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={updateMutation.isPending}
                  onClick={() => setIsEditing(false)}
                >
                  Batal
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={updateMutation.isPending}
                  data-testid="save-edit-complaint-btn"
                >
                  {updateMutation.isPending
                    ? "Menyimpan..."
                    : "Simpan Perubahan"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Informasi Pengaduan</CardTitle>
            <CardDescription>
              Detail laporan dan waktu pengajuan Anda.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground">
                {complaint.description}
              </p>
            </div>

            <dl className="grid gap-3 border-t border-border pt-3 text-sm sm:grid-cols-2">
              <div className="space-y-1">
                <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <CalendarClockIcon className="size-3.5" />
                  <span>Dibuat pada</span>
                </dt>
                <dd className="text-foreground">
                  {formatComplaintDateTime(complaint.createdAt)}
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <CalendarClockIcon className="size-3.5" />
                  <span>Terakhir diperbarui</span>
                </dt>
                <dd className="text-foreground">
                  {formatComplaintDateTime(complaint.updatedAt)}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      )}

      {/* Lampiran Foto */}
      <ComplaintPhotoViewer
        complaint={complaint}
        permissions={permissions}
        description="Bukti visual yang Anda lampirkan pada pengaduan ini."
        footer={photoFooter}
      />

      {/* Thread Balasan */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquareIcon className="size-4 text-muted-foreground" />
            <span>Percakapan &amp; Balasan</span>
          </CardTitle>
          <CardDescription>
            Tanya jawab dan pembaruan antara Anda dan pengurus RT (hanya teks).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {sortedReplies.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
              Belum ada balasan pada pengaduan ini.
            </div>
          ) : (
            <div
              className="space-y-3"
              data-testid="resident-complaint-replies-list"
            >
              {sortedReplies.map((reply) => (
                <div
                  key={reply.id}
                  data-testid={`resident-complaint-reply-${reply.id}`}
                  className={
                    reply.isStaffReply
                      ? "rounded-lg border border-primary/20 bg-primary-subtle/30 p-3.5"
                      : "rounded-lg border border-border bg-muted/30 p-3.5"
                  }
                >
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {reply.authorLabel}
                      </span>
                      <Badge
                        variant={reply.isStaffReply ? "info" : "outline"}
                        size="sm"
                      >
                        {reply.isStaffReply ? "Pengurus" : "Anda"}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatComplaintDateTime(reply.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground">
                    {reply.message}
                  </p>
                </div>
              ))}
            </div>
          )}

          {permissions.canReply ? (
            <form
              onSubmit={handleSubmitReply}
              className="space-y-3 border-t border-border pt-4"
              data-testid="resident-complaint-reply-form"
            >
              <div className="space-y-2">
                <label
                  htmlFor="resident-complaint-reply"
                  className="text-sm font-medium text-foreground"
                >
                  Kirim Balasan
                </label>
                <Textarea
                  id="resident-complaint-reply"
                  value={replyText}
                  onChange={(event) => {
                    setReplyText(event.target.value)
                    if (replyError) setReplyError(null)
                  }}
                  placeholder="Tulis informasi tambahan atau balasan untuk pengurus RT (2–1500 karakter)..."
                  maxLength={1500}
                  rows={3}
                  disabled={replyMutation.isPending}
                  aria-invalid={Boolean(replyError)}
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Hanya pesan teks yang didukung pada balasan.</span>
                  <span className="tabular-nums">
                    {replyText.trim().length}/1500
                  </span>
                </div>
              </div>

              {replyError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-xs text-destructive"
                >
                  <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                  <span>{replyError}</span>
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  type="submit"
                  size="sm"
                  disabled={replyMutation.isPending}
                  data-testid="resident-submit-reply-btn"
                >
                  <SendIcon className="size-3.5" />
                  <span>
                    {replyMutation.isPending ? "Mengirim..." : "Kirim Balasan"}
                  </span>
                </Button>
              </div>
            </form>
          ) : isClosed ? (
            <div
              data-testid="resident-complaint-readonly-notice"
              className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground"
            >
              Pengaduan ini berstatus{" "}
              <strong>{getComplaintStatusLabel(complaint.status)}</strong>.
              Percakapan ditampilkan dalam mode baca-saja dan balasan baru tidak
              dapat ditambahkan.
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Riwayat Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HistoryIcon className="size-4 text-muted-foreground" />
            <span>Riwayat Status</span>
          </CardTitle>
          <CardDescription>
            Perkembangan penanganan pengaduan Anda oleh pengurus RT.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sortedHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada perubahan status tercatat.
            </p>
          ) : (
            <ol
              className="space-y-4"
              data-testid="resident-complaint-status-history"
            >
              {sortedHistory.map((item, idx) => (
                <li
                  key={item.id}
                  className="relative pl-5 before:absolute before:top-2 before:left-1 before:size-2 before:rounded-full before:bg-primary"
                >
                  {idx < sortedHistory.length - 1 && (
                    <span
                      aria-hidden="true"
                      className="absolute top-4 bottom-[-16px] left-[7px] w-px bg-border"
                    />
                  )}
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={getComplaintStatusBadgeVariant(item.newStatus)}
                        size="sm"
                      >
                        {getComplaintStatusLabel(item.newStatus)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatComplaintDateTime(item.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs font-medium text-foreground">
                      {buildComplaintStatusHistoryDescription({
                        previousStatus: item.previousStatus,
                        newStatus: item.newStatus,
                      })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Oleh:{" "}
                      <span className="font-medium text-foreground">
                        {item.changedByLabel}
                      </span>
                    </p>
                    {item.reason && (
                      <div className="rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs break-words whitespace-pre-wrap text-foreground">
                        {item.reason}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </ResidentContainer>
  )
}

