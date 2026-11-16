"use client"

import * as React from "react"
import {
  AlertCircleIcon,
  ImagePlusIcon,
  PencilIcon,
  PlusIcon,
  XIcon,
} from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"
import { MAX_COMMUNITY_MEDIA_COUNT } from "@/lib/community-feed/constants"
import { formatCommunityFileSize } from "@/lib/community-feed/formatters"
import {
  cleanupOrphanCommunityMedia,
  uploadCommunityMediaFile,
  useCreateCommunityPostMutation,
  useUpdateCommunityPostMutation,
} from "@/lib/community-feed/hooks"
import { validateCommunityImageFile } from "@/lib/community-feed/storage"
import type { CommunityPostItem, CommunityPostMediaItem } from "@/lib/community-feed/types"

interface PendingFile {
  key: string
  file: File
  previewUrl: string
}

interface CommunityPostComposerDialogProps {
  tenantId: string
  actorKey: string
  mode: "create" | "edit"
  post?: CommunityPostItem
  trigger?: React.ReactElement
}

export function CommunityPostComposerDialog({
  tenantId,
  actorKey,
  mode,
  post,
  trigger,
}: CommunityPostComposerDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [caption, setCaption] = React.useState(post?.caption ?? "")
  const [existingMedia, setExistingMedia] = React.useState<
    CommunityPostMediaItem[]
  >(post?.media ?? [])
  const [pendingFiles, setPendingFiles] = React.useState<PendingFile[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [isUploading, setIsUploading] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  const createMutation = useCreateCommunityPostMutation(tenantId, actorKey)
  const updateMutation = useUpdateCommunityPostMutation(tenantId, actorKey)
  const isSubmitting =
    isUploading || createMutation.isPending || updateMutation.isPending

  const totalMediaCount = existingMedia.length + pendingFiles.length
  const remainingSlots = MAX_COMMUNITY_MEDIA_COUNT - totalMediaCount

  React.useEffect(() => {
    return () => {
      pendingFiles.forEach((p) => URL.revokeObjectURL(p.previewUrl))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function resetState() {
    pendingFiles.forEach((p) => URL.revokeObjectURL(p.previewUrl))
    setCaption(post?.caption ?? "")
    setExistingMedia(post?.media ?? [])
    setPendingFiles([])
    setError(null)
  }

  async function handleFilesSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ""
    if (files.length === 0) return

    if (files.length > remainingSlots) {
      setError(
        `Maksimal ${MAX_COMMUNITY_MEDIA_COUNT} foto per postingan. Anda dapat menambah ${remainingSlots} foto lagi.`
      )
      return
    }

    const next: PendingFile[] = []
    for (const file of files) {
      const validation = await validateCommunityImageFile(file)
      if (!validation.ok) {
        setError(validation.error)
        return
      }
      next.push({
        key: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
        file,
        previewUrl: URL.createObjectURL(file),
      })
    }

    setError(null)
    setPendingFiles((prev) => [...prev, ...next])
  }

  function removeExistingMedia(mediaId: string) {
    setExistingMedia((prev) => prev.filter((m) => m.id !== mediaId))
  }

  function removePendingFile(key: string) {
    setPendingFiles((prev) => {
      const target = prev.find((p) => p.key === key)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((p) => p.key !== key)
    })
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (isSubmitting) return

    const trimmedCaption = caption.trim()
    if (!trimmedCaption && totalMediaCount === 0) {
      setError("Tulis keterangan atau unggah minimal satu foto.")
      return
    }

    setError(null)

    const uploadedPaths: string[] = []
    const uploadedItems: {
      storagePath: string
      mimeType: "image/jpeg" | "image/png" | "image/webp"
      fileSizeBytes: number
    }[] = []

    if (pendingFiles.length > 0) {
      setIsUploading(true)
      try {
        for (const pending of pendingFiles) {
          const uploaded = await uploadCommunityMediaFile(pending.file)
          uploadedPaths.push(uploaded.storagePath)
          uploadedItems.push({
            storagePath: uploaded.storagePath,
            mimeType: uploaded.mimeType as
              | "image/jpeg"
              | "image/png"
              | "image/webp",
            fileSizeBytes: uploaded.fileSizeBytes,
          })
        }
      } catch (err) {
        await cleanupOrphanCommunityMedia(uploadedPaths)
        setIsUploading(false)
        setError(
          err instanceof Error ? err.message : "Gagal mengunggah foto."
        )
        return
      }
      setIsUploading(false)
    }

    try {
      if (mode === "create") {
        await createMutation.mutateAsync({
          caption: trimmedCaption || null,
          mediaItems: uploadedItems,
        })
        toast.success("Postingan berhasil dipublikasikan")
      } else if (post) {
        await updateMutation.mutateAsync({
          postId: post.id,
          caption: trimmedCaption || null,
          keepMediaIds: existingMedia.map((m) => m.id),
          newMediaItems: uploadedItems,
        })
        toast.success("Postingan berhasil diperbarui")
      }
      setOpen(false)
      resetState()
    } catch (err) {
      if (uploadedPaths.length > 0) {
        await cleanupOrphanCommunityMedia(uploadedPaths)
      }
      setError(
        err instanceof Error ? err.message : "Gagal menyimpan postingan."
      )
    }
  }

  const defaultTrigger =
    mode === "create" ? (
      <Button data-testid="open-create-post-dialog">
        <PlusIcon className="size-4" />
        <span>Buat Postingan</span>
      </Button>
    ) : (
      <Button variant="ghost" size="sm">
        <PencilIcon className="size-4" />
        <span>Ubah</span>
      </Button>
    )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isSubmitting) return
        setOpen(next)
        if (!next) resetState()
      }}
    >
      <DialogTrigger render={trigger ?? defaultTrigger} />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              {mode === "create" ? "Buat Postingan Baru" : "Ubah Postingan"}
            </DialogTitle>
            <DialogDescription>
              Bagikan aktivitas atau momen Anda dengan warga lainnya.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Textarea
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              placeholder="Apa yang terjadi di lingkungan Anda?"
              maxLength={2200}
              rows={4}
              disabled={isSubmitting}
              data-testid="post-caption-input"
            />
            <div className="flex justify-end text-xs text-muted-foreground tabular-nums">
              {caption.trim().length}/2200
            </div>
          </div>

          <div className="space-y-2">
            {(existingMedia.length > 0 || pendingFiles.length > 0) && (
              <div className="grid grid-cols-3 gap-2">
                {existingMedia.map((media) => (
                  <div
                    key={media.id}
                    className="relative aspect-square overflow-hidden rounded-md border border-border bg-muted"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- authenticated private media proxy */}
                    <img
                      src={media.url}
                      alt="Foto postingan"
                      className="size-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeExistingMedia(media.id)}
                      disabled={isSubmitting}
                      aria-label="Hapus foto"
                      className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-black/60 text-white"
                    >
                      <XIcon className="size-3.5" />
                    </button>
                  </div>
                ))}
                {pendingFiles.map((pending) => (
                  <div
                    key={pending.key}
                    className="relative aspect-square overflow-hidden rounded-md border border-border bg-muted"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview before upload */}
                    <img
                      src={pending.previewUrl}
                      alt="Pratinjau foto baru"
                      className="size-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removePendingFile(pending.key)}
                      disabled={isSubmitting}
                      aria-label="Batalkan foto"
                      className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-black/60 text-white"
                    >
                      <XIcon className="size-3.5" />
                    </button>
                    <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">
                      {formatCommunityFileSize(pending.file.size)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={handleFilesSelected}
              disabled={isSubmitting || remainingSlots <= 0}
              className="sr-only"
              data-testid="post-media-input"
            />
            {remainingSlots > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isSubmitting}
                onClick={() => fileInputRef.current?.click()}
              >
                <ImagePlusIcon className="size-4" />
                <span>
                  Tambah Foto ({totalMediaCount}/{MAX_COMMUNITY_MEDIA_COUNT})
                </span>
              </Button>
            )}
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-xs text-destructive"
            >
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline" disabled={isSubmitting}>
                  Batal
                </Button>
              }
            />
            <Button type="submit" disabled={isSubmitting} data-testid="submit-post-btn">
              {isUploading
                ? "Mengunggah Foto..."
                : isSubmitting
                  ? "Menyimpan..."
                  : mode === "create"
                    ? "Publikasikan"
                    : "Simpan Perubahan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
