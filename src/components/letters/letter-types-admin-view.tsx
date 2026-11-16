"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  CheckSquareIcon,
  InfoIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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
import { Textarea } from "@/components/ui/textarea"
import type { RoleCode } from "@/lib/auth/types"
import { MAX_LETTER_REQUIRED_DOCS_ITEMS } from "@/lib/letters/constants"
import {
  formatLetterDateShort,
  getLetterRoleBannerNotice,
} from "@/lib/letters/formatters"
import {
  useAdminLetterTypes,
  useCreateLetterTypeMutation,
  useDeleteLetterTypeMutation,
  useUpdateLetterTypeMutation,
} from "@/lib/letters/hooks"
import {
  createLetterTypeSchema,
  updateLetterTypeSchema,
} from "@/lib/letters/schemas"
import type { LetterType } from "@/lib/letters/types"

interface LetterTypesAdminViewProps {
  tenantId: string
  actorKey: string
  roles: readonly RoleCode[]
  initialData: { items: LetterType[]; canManage: boolean } | null
  initialError: string | null
}

interface FormFieldErrors {
  code?: string
  name?: string
  description?: string
  requiredDocuments?: string
  form?: string
}

export function LetterTypesAdminView({
  tenantId,
  actorKey,
  roles,
  initialData,
  initialError,
}: LetterTypesAdminViewProps) {
  const router = useRouter()
  const typesQuery = useAdminLetterTypes({
    tenantId,
    actorKey,
    initialData: initialData ?? undefined,
  })

  const createMutation = useCreateLetterTypeMutation(tenantId)
  const updateMutation = useUpdateLetterTypeMutation(tenantId)
  const deleteMutation = useDeleteLetterTypeMutation(tenantId)

  const items = typesQuery.data?.items ?? initialData?.items ?? []
  const canManage = typesQuery.data?.canManage ?? initialData?.canManage ?? false
  const errorMessage = typesQuery.error?.message ?? initialError
  const roleNotice = getLetterRoleBannerNotice(roles)

  // Modal state for Create / Edit
  const [formOpen, setFormOpen] = React.useState(false)
  const [editingType, setEditingType] = React.useState<LetterType | null>(null)
  const [code, setCode] = React.useState("")
  const [name, setName] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [isActive, setIsActive] = React.useState(true)
  const [requiredDocs, setRequiredDocs] = React.useState<string[]>([])
  const [newDocInput, setNewDocInput] = React.useState("")
  const [fieldErrors, setFieldErrors] = React.useState<FormFieldErrors>({})

  // Delete dialog state
  const [typeToDelete, setTypeToDelete] = React.useState<LetterType | null>(
    null
  )
  const [deleteError, setDeleteError] = React.useState<string | null>(null)

  const isSaving = createMutation.isPending || updateMutation.isPending

  function openCreateDialog() {
    if (!canManage) return
    setEditingType(null)
    setCode("")
    setName("")
    setDescription("")
    setIsActive(true)
    setRequiredDocs([])
    setNewDocInput("")
    setFieldErrors({})
    setFormOpen(true)
  }

  function openEditDialog(lt: LetterType) {
    if (!canManage) return
    setEditingType(lt)
    setCode(lt.code)
    setName(lt.name)
    setDescription(lt.description ?? "")
    setIsActive(lt.isActive)
    setRequiredDocs([...lt.requiredDocuments])
    setNewDocInput("")
    setFieldErrors({})
    setFormOpen(true)
  }

  function handleAddRequiredDoc() {
    const trimmed = newDocInput.trim()
    if (!trimmed) return
    if (trimmed.length > 100) {
      setFieldErrors((prev) => ({
        ...prev,
        requiredDocuments: "Nama syarat dokumen maksimal 100 karakter.",
      }))
      return
    }
    if (requiredDocs.length >= MAX_LETTER_REQUIRED_DOCS_ITEMS) {
      setFieldErrors((prev) => ({
        ...prev,
        requiredDocuments: `Maksimal ${MAX_LETTER_REQUIRED_DOCS_ITEMS} syarat dokumen per jenis surat.`,
      }))
      return
    }
    if (requiredDocs.some((d) => d.toLowerCase() === trimmed.toLowerCase())) {
      setFieldErrors((prev) => ({
        ...prev,
        requiredDocuments: "Syarat dokumen tersebut sudah ada di daftar.",
      }))
      return
    }

    setRequiredDocs((prev) => [...prev, trimmed])
    setNewDocInput("")
    setFieldErrors((prev) => ({ ...prev, requiredDocuments: undefined }))
  }

  function handleRemoveRequiredDoc(index: number) {
    setRequiredDocs((prev) => prev.filter((_, idx) => idx !== index))
    setFieldErrors((prev) => ({ ...prev, requiredDocuments: undefined }))
  }

  async function handleSubmitForm(event: React.FormEvent) {
    event.preventDefault()
    if (!canManage || isSaving) return

    const pendingDoc = newDocInput.trim()
    const finalDocs =
      pendingDoc &&
      pendingDoc.length <= 100 &&
      requiredDocs.length < MAX_LETTER_REQUIRED_DOCS_ITEMS &&
      !requiredDocs.some((d) => d.toLowerCase() === pendingDoc.toLowerCase())
        ? [...requiredDocs, pendingDoc]
        : requiredDocs

    const basePayload = {
      code,
      name,
      description: description.trim() ? description.trim() : null,
      requiredDocuments: finalDocs,
      isActive,
    }

    if (editingType) {
      const parsed = updateLetterTypeSchema.safeParse({
        letterTypeId: editingType.id,
        ...basePayload,
      })

      if (!parsed.success) {
        const flat = parsed.error.flatten().fieldErrors
        setFieldErrors({
          code: flat.code?.[0],
          name: flat.name?.[0],
          description: flat.description?.[0],
          requiredDocuments: flat.requiredDocuments?.[0],
          form: parsed.error.issues[0]?.message,
        })
        return
      }

      setFieldErrors({})
      try {
        await updateMutation.mutateAsync(parsed.data)
        toast.success("Jenis surat berhasil diperbarui")
        setFormOpen(false)
        router.refresh()
      } catch (err) {
        setFieldErrors({
          form:
            err instanceof Error
              ? err.message
              : "Gagal memperbarui jenis surat. Silakan coba lagi.",
        })
      }
      return
    }

    const parsed = createLetterTypeSchema.safeParse(basePayload)
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors
      setFieldErrors({
        code: flat.code?.[0],
        name: flat.name?.[0],
        description: flat.description?.[0],
        requiredDocuments: flat.requiredDocuments?.[0],
        form: parsed.error.issues[0]?.message,
      })
      return
    }

    setFieldErrors({})
    try {
      await createMutation.mutateAsync(parsed.data)
      toast.success("Jenis surat baru berhasil ditambahkan")
      setFormOpen(false)
      router.refresh()
    } catch (err) {
      setFieldErrors({
        form:
          err instanceof Error
            ? err.message
            : "Gagal menambahkan jenis surat. Silakan coba lagi.",
      })
    }
  }

  async function handleConfirmDelete() {
    if (!canManage || !typeToDelete || deleteMutation.isPending) return
    setDeleteError(null)
    try {
      await deleteMutation.mutateAsync({ letterTypeId: typeToDelete.id })
      toast.success("Jenis surat berhasil dihapus")
      setTypeToDelete(null)
      router.refresh()
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Gagal menghapus jenis surat."
      )
    }
  }

  return (
    <PageContainer className="flex flex-col gap-[var(--space-6)]">
      <div className="flex flex-col gap-3">
        <div>
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/surat" />}
          >
            <ArrowLeftIcon className="size-4" />
            <span>Kembali ke Daftar Surat</span>
          </Button>
        </div>

        <PageHeader
          title="Jenis Surat Pengantar"
          description="Atur jenis surat yang tersedia untuk warga beserta daftar persyaratan dokumen."
          actions={
            canManage ? (
              <Button type="button" size="sm" onClick={openCreateDialog}>
                <PlusIcon className="size-4" />
                <span>Tambah Jenis Surat</span>
              </Button>
            ) : undefined
          }
        />
      </div>

      {roleNotice && (
        <div
          role="status"
          data-testid="letter-types-role-notice"
          className="flex items-start gap-3 rounded-xl border border-info/30 bg-info-subtle/40 px-4 py-3 text-sm text-foreground"
        >
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-info" />
          <div className="space-y-0.5">
            <p className="font-medium">{roleNotice.title}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Anda dapat melihat daftar jenis surat yang terdaftar. Penambahan,
              perubahan, dan penghapusan hanya tersedia untuk Ketua RT dan
              Sekretaris.
            </p>
          </div>
        </div>
      )}

      {errorMessage && (
        <Card className="border-destructive/40 bg-destructive-subtle/20">
          <CardContent className="flex flex-col items-start justify-between gap-3 p-4 sm:flex-row sm:items-center">
            <div className="flex items-start gap-2.5 text-sm text-destructive">
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => typesQuery.refetch()}
            >
              <RefreshCwIcon className="size-3.5" />
              <span>Coba Lagi</span>
            </Button>
          </CardContent>
        </Card>
      )}

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-surface-subtle text-muted-foreground">
              <CheckSquareIcon className="size-6" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                Belum ada jenis surat terdaftar
              </p>
              <p className="max-w-md text-xs text-muted-foreground">
                Tambahkan jenis surat pengantar (mis. Surat Keterangan Domisili)
                agar warga dapat mengajukan permohonan surat.
              </p>
            </div>
            {canManage && (
              <Button type="button" size="sm" onClick={openCreateDialog}>
                <PlusIcon className="size-4" />
                <span>Tambah Jenis Surat</span>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-[var(--space-4)] md:grid-cols-2">
          {items.map((lt) => (
            <Card key={lt.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" size="sm">
                      {lt.code}
                    </Badge>
                    <Badge
                      variant={lt.isActive ? "success" : "secondary"}
                      size="sm"
                    >
                      {lt.isActive ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </div>
                  <CardTitle className="text-base">{lt.name}</CardTitle>
                  {lt.description && (
                    <CardDescription className="text-xs leading-relaxed">
                      {lt.description}
                    </CardDescription>
                  )}
                </div>

                {canManage && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Ubah ${lt.name}`}
                      onClick={() => openEditDialog(lt)}
                    >
                      <PencilIcon className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Hapus ${lt.name}`}
                      className="text-destructive hover:bg-destructive-subtle hover:text-destructive"
                      onClick={() => {
                        setDeleteError(null)
                        setTypeToDelete(lt)
                      }}
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  </div>
                )}
              </CardHeader>

              <CardContent className="space-y-3 pt-0">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Dokumen Persyaratan ({lt.requiredDocuments.length})
                  </p>
                  {lt.requiredDocuments.length === 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Tidak ada syarat dokumen khusus.
                    </p>
                  ) : (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {lt.requiredDocuments.map((doc, idx) => (
                        <Badge
                          key={`${doc}-${idx}`}
                          variant="secondary"
                          size="sm"
                        >
                          {doc}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                <p className="text-[11px] text-muted-foreground">
                  Diperbarui: {formatLetterDateShort(lt.updatedAt)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Letter Type Modal */}
      {canManage && (
        <Dialog
          open={formOpen}
          onOpenChange={(nextOpen) => {
            if (isSaving) return
            setFormOpen(nextOpen)
          }}
        >
          <DialogContent className="sm:max-w-lg">
            <form onSubmit={handleSubmitForm} className="space-y-4">
              <DialogHeader>
                <DialogTitle>
                  {editingType ? "Ubah Jenis Surat" : "Tambah Jenis Surat"}
                </DialogTitle>
                <DialogDescription>
                  Kode harus unik (normalisasi huruf/angka) dalam satu RT.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="letter-type-code"
                    className="block text-sm font-medium text-foreground"
                  >
                    Kode Jenis Surat
                  </label>
                  <Input
                    id="letter-type-code"
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value)
                      setFieldErrors((prev) => ({
                        ...prev,
                        code: undefined,
                        form: undefined,
                      }))
                    }}
                    placeholder="Contoh: SK-DOM atau SKTM"
                    maxLength={32}
                    disabled={isSaving}
                  />
                  {fieldErrors.code && (
                    <p className="text-xs text-destructive">
                      {fieldErrors.code}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="letter-type-name"
                    className="block text-sm font-medium text-foreground"
                  >
                    Nama Jenis Surat
                  </label>
                  <Input
                    id="letter-type-name"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value)
                      setFieldErrors((prev) => ({
                        ...prev,
                        name: undefined,
                        form: undefined,
                      }))
                    }}
                    placeholder="Contoh: Surat Keterangan Domisili"
                    maxLength={120}
                    disabled={isSaving}
                  />
                  {fieldErrors.name && (
                    <p className="text-xs text-destructive">
                      {fieldErrors.name}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="letter-type-desc"
                    className="block text-sm font-medium text-foreground"
                  >
                    Deskripsi (Opsional)
                  </label>
                  <Textarea
                    id="letter-type-desc"
                    value={description}
                    onChange={(e) => {
                      setDescription(e.target.value)
                      setFieldErrors((prev) => ({
                        ...prev,
                        description: undefined,
                        form: undefined,
                      }))
                    }}
                    placeholder="Penjelasan singkat kegunaan surat ini..."
                    rows={2}
                    maxLength={500}
                    disabled={isSaving}
                  />
                  {fieldErrors.description && (
                    <p className="text-xs text-destructive">
                      {fieldErrors.description}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="letter-type-req-doc"
                    className="block text-sm font-medium text-foreground"
                  >
                    Dokumen Persyaratan (Opsional)
                  </label>
                  <div className="flex gap-2">
                    <Input
                      id="letter-type-req-doc"
                      value={newDocInput}
                      onChange={(e) => setNewDocInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          handleAddRequiredDoc()
                        }
                      }}
                      placeholder="Contoh: Fotokopi KTP"
                      maxLength={100}
                      disabled={isSaving}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isSaving || !newDocInput.trim()}
                      onClick={handleAddRequiredDoc}
                    >
                      Tambah
                    </Button>
                  </div>

                  {requiredDocs.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {requiredDocs.map((doc, idx) => (
                        <Badge
                          key={`${doc}-${idx}`}
                          variant="secondary"
                          size="sm"
                          className="gap-1 pr-1"
                        >
                          <span>{doc}</span>
                          <button
                            type="button"
                            aria-label={`Hapus syarat ${doc}`}
                            onClick={() => handleRemoveRequiredDoc(idx)}
                            className="rounded-full p-0.5 hover:bg-muted"
                          >
                            <XIcon className="size-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}

                  {fieldErrors.requiredDocuments && (
                    <p className="text-xs text-destructive">
                      {fieldErrors.requiredDocuments}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2.5 pt-1">
                  <Checkbox
                    id="letter-type-active"
                    checked={isActive}
                    disabled={isSaving}
                    onCheckedChange={(checked) =>
                      setIsActive(Boolean(checked))
                    }
                  />
                  <label
                    htmlFor="letter-type-active"
                    className="text-sm text-foreground"
                  >
                    Aktif (dapat dipilih oleh warga saat mengajukan surat)
                  </label>
                </div>
              </div>

              {fieldErrors.form && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive-subtle px-3 py-2 text-xs text-destructive"
                >
                  <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                  <span>{fieldErrors.form}</span>
                </div>
              )}

              <DialogFooter>
                <DialogClose
                  render={
                    <Button type="button" variant="outline" disabled={isSaving} />
                  }
                >
                  Batal
                </DialogClose>
                <Button type="submit" disabled={isSaving}>
                  {isSaving
                    ? "Menyimpan..."
                    : editingType
                      ? "Simpan Perubahan"
                      : "Simpan Jenis Surat"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete Confirmation Dialog */}
      {canManage && (
        <Dialog
          open={typeToDelete !== null}
          onOpenChange={(nextOpen) => {
            if (deleteMutation.isPending) return
            if (!nextOpen) {
              setTypeToDelete(null)
              setDeleteError(null)
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Hapus Jenis Surat?</DialogTitle>
              <DialogDescription>
                Anda akan menghapus jenis surat{" "}
                <strong className="font-semibold text-foreground">
                  {typeToDelete?.name} ({typeToDelete?.code})
                </strong>
                . Jenis surat yang sudah memiliki permohonan tidak dapat
                dihapus dan sebaiknya dinonaktifkan.
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
                    disabled={deleteMutation.isPending}
                  />
                }
              >
                Batal
              </DialogClose>
              <Button
                type="button"
                variant="destructive"
                disabled={deleteMutation.isPending}
                onClick={handleConfirmDelete}
              >
                {deleteMutation.isPending ? "Menghapus..." : "Ya, Hapus"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </PageContainer>
  )
}

