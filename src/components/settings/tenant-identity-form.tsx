"use client"

/* eslint-disable @next/next/no-img-element */
import * as React from "react"
import { useActionState } from "react"
import { toast } from "sonner"
import {
  BuildingIcon,
  ImageIcon,
  Loader2Icon,
  MapPinIcon,
  SaveIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import type { TenantIdentity } from "@/lib/tenants/schemas"
import {
  updateTenantIdentityAction,
  uploadTenantLogoAction,
  removeTenantLogoAction,
  type TenantActionState,
} from "@/app/actions/tenant-settings"

interface TenantIdentityFormProps {
  initialData: TenantIdentity
  canEdit: boolean
}

const initialState: TenantActionState = {
  ok: false,
}

export function TenantIdentityForm({
  initialData,
  canEdit,
}: TenantIdentityFormProps) {
  const [state, formAction, isPending] = useActionState(
    updateTenantIdentityAction,
    initialState
  )

  const [currentLogoUrl, setCurrentLogoUrl] = React.useState<string | null>(
    initialData.logoUrl
  )
  const [isUploadingLogo, setIsUploadingLogo] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (state.message && state.ok) {
      toast.success(state.message)
    } else if (state.error && !state.ok) {
      toast.error(state.error)
    }
  }, [state])

  const handleLogoFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsUploadingLogo(true)
    const formData = new FormData()
    formData.append("logoFile", file)

    try {
      const res = await uploadTenantLogoAction(formData)
      if (res.ok && res.logoUrl) {
        setCurrentLogoUrl(res.logoUrl)
        toast.success("Logo RT berhasil diperbarui.")
      } else {
        toast.error(res.error || "Gagal mengunggah logo.")
      }
    } catch {
      toast.error("Terjadi kesalahan saat mengunggah logo.")
    } finally {
      setIsUploadingLogo(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    }
  }

  const handleRemoveLogo = async () => {
    if (!confirm("Apakah Anda yakin ingin menghapus logo RT ini?")) return

    setIsUploadingLogo(true)
    try {
      const res = await removeTenantLogoAction()
      if (res.ok) {
        setCurrentLogoUrl(null)
        toast.success("Logo RT berhasil dihapus.")
      } else {
        toast.error(res.error || "Gagal menghapus logo.")
      }
    } catch {
      toast.error("Terjadi kesalahan saat menghapus logo.")
    } finally {
      setIsUploadingLogo(false)
    }
  }

  return (
    <div className="space-y-[var(--space-6)]">
      {/* Kartu Logo RT */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ImageIcon className="size-4 text-primary" />
            <span>Logo Rukun Tetangga</span>
          </CardTitle>
          <CardDescription>
            Logo akan ditampilkan di Sidebar, Header, Portal Warga, dan dokumen
            surat resmi.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
            {/* Logo Preview */}
            <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40 shadow-xs">
              {currentLogoUrl ? (
                <img
                  src={currentLogoUrl}
                  alt="Logo RT"
                  className="size-full object-contain p-1"
                />
              ) : (
                <div className="flex flex-col items-center gap-1 text-muted-foreground">
                  <ImageIcon className="size-8" />
                  <span className="text-[10px]">Belum Ada</span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-1 flex-col gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleLogoFileChange}
                disabled={!canEdit || isUploadingLogo}
              />

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canEdit || isUploadingLogo}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {isUploadingLogo ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    <UploadIcon className="size-4" />
                  )}
                  <span>
                    {currentLogoUrl ? "Ganti Logo" : "Unggah Logo RT"}
                  </span>
                </Button>

                {currentLogoUrl && canEdit && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10"
                    disabled={isUploadingLogo}
                    onClick={handleRemoveLogo}
                  >
                    <Trash2Icon className="size-4" />
                    <span>Hapus Logo</span>
                  </Button>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                Format yang didukung: PNG, JPG, atau WebP. Ukuran maksimal 2 MB.
                Rekomendasi rasio 1:1 (persegi).
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Formulir Identitas RT */}
      <form action={formAction}>
        <input type="hidden" name="logoUrl" value={currentLogoUrl ?? ""} />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BuildingIcon className="size-4 text-primary" />
              <span>Identitas & Wilayah RT</span>
            </CardTitle>
            <CardDescription>
              Informasi alamat, nomor RT/RW, dan identitas resmi lingkungan.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Nama Organisasi */}
            <div className="space-y-1.5">
              <label htmlFor="name" className="block text-sm font-medium text-foreground">
                Nama RT / Organisasi <span className="text-destructive">*</span>
              </label>
              <Input
                id="name"
                name="name"
                defaultValue={initialData.name}
                placeholder="Contoh: RT 01 / RW 01 Staging"
                disabled={!canEdit || isPending}
                required
              />
              {state.fieldErrors?.name && (
                <p className="text-xs text-destructive">
                  {state.fieldErrors.name[0]}
                </p>
              )}
            </div>

            {/* RT & RW */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="rtNumber" className="block text-sm font-medium text-foreground">
                  Nomor RT <span className="text-destructive">*</span>
                </label>
                <Input
                  id="rtNumber"
                  name="rtNumber"
                  defaultValue={initialData.rtNumber}
                  placeholder="Contoh: 01"
                  disabled={!canEdit || isPending}
                  required
                />
                {state.fieldErrors?.rtNumber && (
                  <p className="text-xs text-destructive">
                    {state.fieldErrors.rtNumber[0]}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="rwNumber" className="block text-sm font-medium text-foreground">
                  Nomor RW <span className="text-destructive">*</span>
                </label>
                <Input
                  id="rwNumber"
                  name="rwNumber"
                  defaultValue={initialData.rwNumber}
                  placeholder="Contoh: 01"
                  disabled={!canEdit || isPending}
                  required
                />
                {state.fieldErrors?.rwNumber && (
                  <p className="text-xs text-destructive">
                    {state.fieldErrors.rwNumber[0]}
                  </p>
                )}
              </div>
            </div>

            {/* Kelurahan & Kecamatan */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="kelurahan" className="block text-sm font-medium text-foreground">
                  Kelurahan / Desa <span className="text-destructive">*</span>
                </label>
                <Input
                  id="kelurahan"
                  name="kelurahan"
                  defaultValue={initialData.kelurahan}
                  placeholder="Contoh: Kelurahan Menteng"
                  disabled={!canEdit || isPending}
                  required
                />
                {state.fieldErrors?.kelurahan && (
                  <p className="text-xs text-destructive">
                    {state.fieldErrors.kelurahan[0]}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="kecamatan" className="block text-sm font-medium text-foreground">
                  Kecamatan <span className="text-destructive">*</span>
                </label>
                <Input
                  id="kecamatan"
                  name="kecamatan"
                  defaultValue={initialData.kecamatan}
                  placeholder="Contoh: Kecamatan Menteng"
                  disabled={!canEdit || isPending}
                  required
                />
                {state.fieldErrors?.kecamatan && (
                  <p className="text-xs text-destructive">
                    {state.fieldErrors.kecamatan[0]}
                  </p>
                )}
              </div>
            </div>

            {/* Kota & Provinsi */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="city" className="block text-sm font-medium text-foreground">
                  Kabupaten / Kota <span className="text-destructive">*</span>
                </label>
                <Input
                  id="city"
                  name="city"
                  defaultValue={initialData.city}
                  placeholder="Contoh: Kota Jakarta Pusat"
                  disabled={!canEdit || isPending}
                  required
                />
                {state.fieldErrors?.city && (
                  <p className="text-xs text-destructive">
                    {state.fieldErrors.city[0]}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="province" className="block text-sm font-medium text-foreground">
                  Provinsi <span className="text-destructive">*</span>
                </label>
                <Input
                  id="province"
                  name="province"
                  defaultValue={initialData.province}
                  placeholder="Contoh: DKI Jakarta"
                  disabled={!canEdit || isPending}
                  required
                />
                {state.fieldErrors?.province && (
                  <p className="text-xs text-destructive">
                    {state.fieldErrors.province[0]}
                  </p>
                )}
              </div>
            </div>

            {/* Kode Pos */}
            <div className="space-y-1.5 sm:max-w-xs">
              <label htmlFor="postalCode" className="block text-sm font-medium text-foreground">Kode Pos</label>
              <div className="relative">
                <MapPinIcon className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
                <Input
                  id="postalCode"
                  name="postalCode"
                  className="pl-9"
                  defaultValue={initialData.postalCode ?? ""}
                  placeholder="Contoh: 10310"
                  maxLength={5}
                  disabled={!canEdit || isPending}
                />
              </div>
              {state.fieldErrors?.postalCode && (
                <p className="text-xs text-destructive">
                  {state.fieldErrors.postalCode[0]}
                </p>
              )}
            </div>

            {/* Tombol Simpan */}
            {canEdit && (
              <div className="pt-2">
                <Button type="submit" disabled={isPending}>
                  {isPending ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    <SaveIcon className="size-4" />
                  )}
                  <span>Simpan Perubahan</span>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </form>
    </div>
  )
}

