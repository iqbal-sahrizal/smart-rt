"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { AlertCircleIcon, ArrowLeftIcon, SaveIcon } from "lucide-react"
import { toast } from "sonner"

import { PageContainer, PageHeader } from "@/components/layout/page-container"
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
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_CATEGORY_LABELS,
  MAX_ACTIVITY_DESCRIPTION_LENGTH,
  MAX_ACTIVITY_LOCATION_LENGTH,
  MAX_ACTIVITY_TITLE_LENGTH,
} from "@/lib/activities/constants"
import {
  useCreateActivityMutation,
  useUpdateActivityMutation,
} from "@/lib/activities/hooks"
import {
  createActivitySchema,
  updateActivitySchema,
} from "@/lib/activities/schemas"
import type { ActivityCategory, ActivityItem } from "@/lib/activities/types"
import {
  isoToJakartaDatetimeLocal,
  jakartaDatetimeLocalToIso,
} from "@/lib/activities/ui-helpers"

interface ActivityFormProps {
  tenantId: string
  mode: "create" | "edit"
  initialActivity?: ActivityItem
}

export function ActivityForm({
  tenantId,
  mode,
  initialActivity,
}: ActivityFormProps) {
  const router = useRouter()
  const createMutation = useCreateActivityMutation(tenantId)
  const updateMutation = useUpdateActivityMutation(tenantId)
  const isSubmitting = createMutation.isPending || updateMutation.isPending

  const initialValues = React.useMemo(
    () => ({
      title: initialActivity?.title ?? "",
      description: initialActivity?.description ?? "",
      category: (initialActivity?.category ?? "lainnya") as ActivityCategory,
      location: initialActivity?.location ?? "",
      startLocal: isoToJakartaDatetimeLocal(initialActivity?.startAt),
      endLocal: isoToJakartaDatetimeLocal(initialActivity?.endAt),
      maxParticipants:
        initialActivity?.maxParticipants !== null &&
        initialActivity?.maxParticipants !== undefined
          ? String(initialActivity.maxParticipants)
          : "",
      deadlineLocal: isoToJakartaDatetimeLocal(
        initialActivity?.registrationDeadline
      ),
      allowSelfRegistration:
        initialActivity?.allowSelfRegistration ?? true,
    }),
    [initialActivity]
  )

  const [title, setTitle] = React.useState(initialValues.title)
  const [description, setDescription] = React.useState(
    initialValues.description
  )
  const [category, setCategory] = React.useState<ActivityCategory>(
    initialValues.category
  )
  const [location, setLocation] = React.useState(initialValues.location)
  const [startLocal, setStartLocal] = React.useState(initialValues.startLocal)
  const [endLocal, setEndLocal] = React.useState(initialValues.endLocal)
  const [maxParticipants, setMaxParticipants] = React.useState(
    initialValues.maxParticipants
  )
  const [deadlineLocal, setDeadlineLocal] = React.useState(
    initialValues.deadlineLocal
  )
  const [allowSelfRegistration, setAllowSelfRegistration] = React.useState(
    initialValues.allowSelfRegistration
  )

  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>(
    {}
  )
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [leaveConfirmOpen, setLeaveConfirmOpen] = React.useState(false)

  const isDirty =
    title !== initialValues.title ||
    description !== initialValues.description ||
    category !== initialValues.category ||
    location !== initialValues.location ||
    startLocal !== initialValues.startLocal ||
    endLocal !== initialValues.endLocal ||
    maxParticipants !== initialValues.maxParticipants ||
    deadlineLocal !== initialValues.deadlineLocal ||
    allowSelfRegistration !== initialValues.allowSelfRegistration

  React.useEffect(() => {
    if (!isDirty || isSubmitting) return

    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
    }

    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [isDirty, isSubmitting])

  const cancelHref =
    mode === "edit" && initialActivity
      ? `/kegiatan/${initialActivity.id}`
      : "/kegiatan"

  function handleNavigateBack() {
    if (isSubmitting) return
    if (isDirty) {
      setLeaveConfirmOpen(true)
      return
    }
    router.push(cancelHref)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isSubmitting) return

    const errors: Record<string, string> = {}

    const startIso = jakartaDatetimeLocalToIso(startLocal)
    if (!startIso) {
      errors.startAt = "Tanggal dan waktu mulai kegiatan wajib diisi."
    }

    let endIso: string | null = null
    if (endLocal.trim()) {
      endIso = jakartaDatetimeLocalToIso(endLocal)
      if (!endIso) {
        errors.endAt = "Format tanggal dan waktu selesai tidak valid."
      }
    }

    let deadlineIso: string | null = null
    if (deadlineLocal.trim()) {
      deadlineIso = jakartaDatetimeLocalToIso(deadlineLocal)
      if (!deadlineIso) {
        errors.registrationDeadline =
          "Format batas waktu pendaftaran tidak valid."
      }
    }

    let parsedMaxParticipants: number | null = null
    if (maxParticipants.trim()) {
      const n = Number(maxParticipants.trim())
      if (!Number.isInteger(n) || n <= 0) {
        errors.maxParticipants =
          "Kuota peserta harus berupa bilangan bulat lebih dari 0."
      } else {
        parsedMaxParticipants = n
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setSubmitError("Periksa kembali kolom formulir yang ditandai merah.")
      return
    }

    const basePayload = {
      title,
      description: description || null,
      category,
      location,
      startAt: startIso!,
      endAt: endIso,
      allowSelfRegistration,
      maxParticipants: parsedMaxParticipants,
      registrationDeadline: deadlineIso,
    }

    if (mode === "edit" && initialActivity) {
      const parsed = updateActivitySchema.safeParse({
        activityId: initialActivity.id,
        ...basePayload,
      })
      if (!parsed.success) {
        const nextErrs: Record<string, string> = {}
        for (const issue of parsed.error.issues) {
          const key = String(issue.path[0] ?? "form")
          if (!nextErrs[key]) nextErrs[key] = issue.message
        }
        setFieldErrors(nextErrs)
        setSubmitError(
          parsed.error.issues[0]?.message ?? "Data pembaruan tidak valid."
        )
        return
      }

      setFieldErrors({})
      setSubmitError(null)
      try {
        await updateMutation.mutateAsync(parsed.data)
        toast.success("Informasi kegiatan berhasil diperbarui.")
        router.push(`/kegiatan/${initialActivity.id}`)
        router.refresh()
      } catch (err) {
        setSubmitError(
          err instanceof Error
            ? err.message
            : "Gagal memperbarui informasi kegiatan."
        )
      }
      return
    }

    const parsed = createActivitySchema.safeParse(basePayload)
    if (!parsed.success) {
      const nextErrs: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form")
        if (!nextErrs[key]) nextErrs[key] = issue.message
      }
      setFieldErrors(nextErrs)
      setSubmitError(
        parsed.error.issues[0]?.message ?? "Data kegiatan baru tidak valid."
      )
      return
    }

    setFieldErrors({})
    setSubmitError(null)
    try {
      const created = await createMutation.mutateAsync(parsed.data)
      toast.success("Kegiatan warga baru berhasil dibuat.")
      router.push(`/kegiatan/${created.activity.id}`)
      router.refresh()
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Gagal membuat kegiatan warga."
      )
    }
  }

  return (
    <PageContainer className="space-y-6">
      <PageHeader
        title={mode === "edit" ? "Ubah Kegiatan Warga" : "Buat Kegiatan Warga"}
        description={
          mode === "edit"
            ? "Perbarui jadwal, lokasi, kuota, atau pengaturan pendaftaran kegiatan."
            : "Jadwalkan agenda kegiatan RT baru dan atur pendaftaran peserta warga."
        }
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleNavigateBack}
            disabled={isSubmitting}
          >
            <ArrowLeftIcon className="size-4" />
            <span>Kembali</span>
          </Button>
        }
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Informasi Utama</CardTitle>
            <CardDescription>
              Seluruh waktu menggunakan zona waktu Asia/Jakarta (WIB).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <label
                htmlFor="activity-title"
                className="text-sm font-medium text-foreground"
              >
                Judul Kegiatan <span className="text-destructive">*</span>
              </label>
              <Input
                id="activity-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={MAX_ACTIVITY_TITLE_LENGTH}
                placeholder="Contoh: Kerja Bakti Pembersihan Saluran Air"
                disabled={isSubmitting}
                aria-invalid={Boolean(fieldErrors.title)}
              />
              {fieldErrors.title && (
                <p className="text-xs text-destructive">{fieldErrors.title}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="activity-category"
                className="text-sm font-medium text-foreground"
              >
                Kategori <span className="text-destructive">*</span>
              </label>
              <select
                id="activity-category"
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value as ActivityCategory)
                }
                disabled={isSubmitting}
                className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-2xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
              >
                {ACTIVITY_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {ACTIVITY_CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="activity-location"
                className="text-sm font-medium text-foreground"
              >
                Lokasi <span className="text-destructive">*</span>
              </label>
              <Input
                id="activity-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                maxLength={MAX_ACTIVITY_LOCATION_LENGTH}
                placeholder="Contoh: Balai Warga RT 04 / Lapangan Blok B"
                disabled={isSubmitting}
                aria-invalid={Boolean(fieldErrors.location)}
              />
              {fieldErrors.location && (
                <p className="text-xs text-destructive">
                  {fieldErrors.location}
                </p>
              )}
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <label
                htmlFor="activity-description"
                className="text-sm font-medium text-foreground"
              >
                Deskripsi &amp; Agenda (opsional)
              </label>
              <Textarea
                id="activity-description"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={MAX_ACTIVITY_DESCRIPTION_LENGTH}
                placeholder="Jelaskan agenda kegiatan, perlengkapan yang perlu dibawa warga, atau catatan penting..."
                disabled={isSubmitting}
                aria-invalid={Boolean(fieldErrors.description)}
              />
              {fieldErrors.description && (
                <p className="text-xs text-destructive">
                  {fieldErrors.description}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Jadwal &amp; Pendaftaran Peserta
            </CardTitle>
            <CardDescription>
              Atur waktu pelaksanaan (WIB), batas peserta, dan opsi pendaftaran
              mandiri warga.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor="activity-start-at"
                className="text-sm font-medium text-foreground"
              >
                Waktu Mulai (WIB) <span className="text-destructive">*</span>
              </label>
              <Input
                id="activity-start-at"
                type="datetime-local"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                disabled={isSubmitting}
                aria-invalid={Boolean(fieldErrors.startAt)}
              />
              {fieldErrors.startAt && (
                <p className="text-xs text-destructive">
                  {fieldErrors.startAt}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="activity-end-at"
                className="text-sm font-medium text-foreground"
              >
                Waktu Selesai (WIB, opsional)
              </label>
              <Input
                id="activity-end-at"
                type="datetime-local"
                value={endLocal}
                onChange={(e) => setEndLocal(e.target.value)}
                disabled={isSubmitting}
                aria-invalid={Boolean(fieldErrors.endAt)}
              />
              {fieldErrors.endAt && (
                <p className="text-xs text-destructive">{fieldErrors.endAt}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="activity-max-participants"
                className="text-sm font-medium text-foreground"
              >
                Batas Maksimal Peserta (opsional)
              </label>
              <Input
                id="activity-max-participants"
                type="number"
                min={1}
                step={1}
                value={maxParticipants}
                onChange={(e) => setMaxParticipants(e.target.value)}
                placeholder="Kosongkan bila tanpa batas kuota"
                disabled={isSubmitting}
                aria-invalid={Boolean(fieldErrors.maxParticipants)}
              />
              {fieldErrors.maxParticipants && (
                <p className="text-xs text-destructive">
                  {fieldErrors.maxParticipants}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="activity-deadline"
                className="text-sm font-medium text-foreground"
              >
                Batas Waktu Pendaftaran (WIB, opsional)
              </label>
              <Input
                id="activity-deadline"
                type="datetime-local"
                value={deadlineLocal}
                onChange={(e) => setDeadlineLocal(e.target.value)}
                disabled={isSubmitting}
                aria-invalid={Boolean(fieldErrors.registrationDeadline)}
              />
              {fieldErrors.registrationDeadline && (
                <p className="text-xs text-destructive">
                  {fieldErrors.registrationDeadline}
                </p>
              )}
            </div>

            <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 p-3.5 sm:col-span-2">
              <Checkbox
                id="activity-allow-self-reg"
                checked={allowSelfRegistration}
                onCheckedChange={(checked) =>
                  setAllowSelfRegistration(checked === true)
                }
                disabled={isSubmitting}
              />
              <div className="space-y-0.5">
                <label
                  htmlFor="activity-allow-self-reg"
                  className="cursor-pointer text-sm font-medium text-foreground"
                >
                  Izinkan pendaftaran mandiri oleh warga
                </label>
                <p className="text-xs text-muted-foreground">
                  Jika dinonaktifkan, hanya Ketua RT atau Sekretaris yang dapat
                  mendaftarkan atau mengundang peserta.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {submitError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-destructive-border bg-destructive-subtle/40 px-4 py-3 text-sm text-destructive-text"
          >
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
            <span>{submitError}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleNavigateBack}
            disabled={isSubmitting}
          >
            Batal
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            <SaveIcon className="size-4" />
            <span>
              {isSubmitting
                ? "Menyimpan..."
                : mode === "edit"
                  ? "Simpan Perubahan"
                  : "Publikasikan Kegiatan"}
            </span>
          </Button>
        </div>
      </form>

      <Dialog open={leaveConfirmOpen} onOpenChange={setLeaveConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tinggalkan Perubahan Belum Disimpan?</DialogTitle>
            <DialogDescription>
              Anda memiliki perubahan pada formulir kegiatan yang belum disimpan.
              Jika meninggalkan halaman ini, perubahan akan hilang.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Tetap di Halaman Ini
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              onClick={() => router.push(cancelHref)}
            >
              Tinggalkan Perubahan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}

