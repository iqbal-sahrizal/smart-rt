"use client"

import * as React from "react"
import Link from "next/link"
import { AlertCircleIcon, ArrowLeftIcon, LockIcon } from "lucide-react"

import {
  createResidentAction,
  updateResidentAction,
} from "@/app/actions/residents"
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
import type { HouseholdOption } from "@/lib/residents/queries"
import {
  FAMILY_ROLE_LABELS,
  GENDER_LABELS,
  RESIDENCY_STATUS_LABELS,
  STAY_STATUS_LABELS,
  type ResidentFormActionState,
  type ResidentPrivateData,
  type ResidentSummary,
} from "@/lib/residents/types"

const INITIAL_STATE: ResidentFormActionState = {
  error: null,
}

interface ResidentFormProps {
  mode: "create" | "edit"
  householdOptions: HouseholdOption[]
  resident?: ResidentSummary
  privateData?: ResidentPrivateData | null
  currentIsHead?: boolean
  cancelHref: string
}

export function ResidentForm({
  mode,
  householdOptions,
  resident,
  privateData,
  currentIsHead = false,
  cancelHref,
}: ResidentFormProps) {
  const actionFn =
    mode === "create" ? createResidentAction : updateResidentAction
  const [state, formAction, isPending] = React.useActionState(
    actionFn,
    INITIAL_STATE
  )

  const [householdMode, setHouseholdMode] = React.useState<"existing" | "new">(
    householdOptions.length > 0 ? "existing" : "new"
  )
  const [familyRole, setFamilyRole] = React.useState(
    resident?.familyRole ?? "kepala_keluarga"
  )
  const [setAsHead, setSetAsHead] = React.useState(
    mode === "create" ? true : currentIsHead
  )

  const fieldError = (name: string) => state.fieldErrors?.[name]?.[0]

  return (
    <form action={formAction} noValidate className="flex flex-col gap-6">
      {mode === "edit" && resident && (
        <input type="hidden" name="residentId" value={resident.id} />
      )}

      {state.error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-destructive-border bg-destructive-subtle px-4 py-3 text-sm text-destructive-text"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      {/* Section 1: Basic Resident Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identitas Dasar Warga</CardTitle>
          <CardDescription>
            Informasi profil utama yang digunakan dalam direktori warga dan
            layanan administrasi RT.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label
              htmlFor="fullName"
              className="text-sm font-medium text-foreground"
            >
              Nama Lengkap <span className="text-destructive">*</span>
            </label>
            <Input
              id="fullName"
              name="fullName"
              placeholder="Sesuai KTP / Kartu Keluarga"
              defaultValue={resident?.fullName ?? ""}
              required
              disabled={isPending}
              aria-invalid={Boolean(fieldError("fullName")) || undefined}
            />
            {fieldError("fullName") && (
              <p className="text-xs text-destructive-text">
                {fieldError("fullName")}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="gender"
              className="text-sm font-medium text-foreground"
            >
              Jenis Kelamin <span className="text-destructive">*</span>
            </label>
            <select
              id="gender"
              name="gender"
              defaultValue={resident?.gender ?? "L"}
              disabled={isPending}
              className="h-[var(--size-control-md)] w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
            >
              {Object.entries(GENDER_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {fieldError("gender") && (
              <p className="text-xs text-destructive-text">
                {fieldError("gender")}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="phone"
              className="text-sm font-medium text-foreground"
            >
              Nomor Telepon / WhatsApp
            </label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              placeholder="0812xxxxxxxx"
              defaultValue={resident?.phone ?? ""}
              disabled={isPending}
              aria-invalid={Boolean(fieldError("phone")) || undefined}
            />
            {fieldError("phone") && (
              <p className="text-xs text-destructive-text">
                {fieldError("phone")}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="familyRole"
              className="text-sm font-medium text-foreground"
            >
              Peran dalam Keluarga <span className="text-destructive">*</span>
            </label>
            <select
              id="familyRole"
              name="familyRole"
              value={familyRole}
              onChange={(e) => {
                const nextRole = e.target.value as typeof familyRole
                setFamilyRole(nextRole)
                if (mode === "create" && nextRole === "kepala_keluarga") {
                  setSetAsHead(true)
                }
              }}
              disabled={isPending}
              className="h-[var(--size-control-md)] w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
            >
              {Object.entries(FAMILY_ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {fieldError("familyRole") && (
              <p className="text-xs text-destructive-text">
                {fieldError("familyRole")}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="stayStatus"
              className="text-sm font-medium text-foreground"
            >
              Status Tinggal <span className="text-destructive">*</span>
            </label>
            <select
              id="stayStatus"
              name="stayStatus"
              defaultValue={resident?.stayStatus ?? "tetap"}
              disabled={isPending}
              className="h-[var(--size-control-md)] w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
            >
              {Object.entries(STAY_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="residencyStatus"
              className="text-sm font-medium text-foreground"
            >
              Status Warga <span className="text-destructive">*</span>
            </label>
            <select
              id="residencyStatus"
              name="residencyStatus"
              defaultValue={resident?.residencyStatus ?? "aktif"}
              disabled={isPending}
              className="h-[var(--size-control-md)] w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
            >
              {Object.entries(RESIDENCY_STATUS_LABELS).map(
                ([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                )
              )}
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Section 2: Household Assignment */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Kartu Keluarga & Domisili</CardTitle>
          <CardDescription>
            {mode === "create"
              ? "Tautkan warga ke Kartu Keluarga yang sudah ada atau daftarkan Kartu Keluarga baru."
              : "Pastikan warga terdaftar pada Kartu Keluarga yang sesuai."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {mode === "create" && (
            <>
              <input type="hidden" name="householdMode" value={householdMode} />
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={householdOptions.length === 0 || isPending}
                  onClick={() => setHouseholdMode("existing")}
                  className={`flex flex-col items-start gap-1 rounded-lg border p-3.5 text-left transition-colors ${
                    householdMode === "existing"
                      ? "border-primary bg-primary-subtle/50"
                      : "border-border bg-surface hover:bg-muted/40"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <span className="text-sm font-medium text-foreground">
                    Pilih Kartu Keluarga yang Sudah Ada
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {householdOptions.length > 0
                      ? `${householdOptions.length} KK aktif tersedia`
                      : "Belum ada KK terdaftar di RT ini"}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => setHouseholdMode("new")}
                  className={`flex flex-col items-start gap-1 rounded-lg border p-3.5 text-left transition-colors ${
                    householdMode === "new"
                      ? "border-primary bg-primary-subtle/50"
                      : "border-border bg-surface hover:bg-muted/40"
                  }`}
                >
                  <span className="text-sm font-medium text-foreground">
                    Buat Kartu Keluarga Baru
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Sekaligus daftarkan alamat & nomor KK baru
                  </span>
                </button>
              </div>
            </>
          )}

          {(mode === "edit" || householdMode === "existing") && (
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="householdId"
                className="text-sm font-medium text-foreground"
              >
                Kartu Keluarga <span className="text-destructive">*</span>
              </label>
              <select
                id="householdId"
                name="householdId"
                defaultValue={
                  resident?.householdId ?? householdOptions[0]?.id ?? ""
                }
                disabled={isPending}
                className="h-[var(--size-control-md)] w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
              >
                <option value="">-- Pilih Kartu Keluarga --</option>
                {householdOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.blockUnit ? `${option.blockUnit} — ` : ""}
                    {option.address} (KK: {option.kkNumber})
                  </option>
                ))}
              </select>
              {fieldError("householdId") && (
                <p className="text-xs text-destructive-text">
                  {fieldError("householdId")}
                </p>
              )}
            </div>
          )}

          {mode === "create" && householdMode === "new" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="kkNumber"
                  className="text-sm font-medium text-foreground"
                >
                  Nomor Kartu Keluarga (16 digit){" "}
                  <span className="text-destructive">*</span>
                </label>
                <Input
                  id="kkNumber"
                  name="kkNumber"
                  inputMode="numeric"
                  maxLength={16}
                  placeholder="3273xxxxxxxxxxxx"
                  disabled={isPending}
                  aria-invalid={Boolean(fieldError("kkNumber")) || undefined}
                />
                {fieldError("kkNumber") && (
                  <p className="text-xs text-destructive-text">
                    {fieldError("kkNumber")}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="blockUnit"
                  className="text-sm font-medium text-foreground"
                >
                  Blok / Nomor Rumah
                </label>
                <Input
                  id="blockUnit"
                  name="blockUnit"
                  placeholder="Mis. Blok B-12"
                  disabled={isPending}
                  aria-invalid={Boolean(fieldError("blockUnit")) || undefined}
                />
                {fieldError("blockUnit") && (
                  <p className="text-xs text-destructive-text">
                    {fieldError("blockUnit")}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label
                  htmlFor="address"
                  className="text-sm font-medium text-foreground"
                >
                  Alamat Lengkap <span className="text-destructive">*</span>
                </label>
                <Textarea
                  id="address"
                  name="address"
                  rows={2}
                  placeholder="Nama jalan, nomor rumah, RT/RW"
                  disabled={isPending}
                  aria-invalid={Boolean(fieldError("address")) || undefined}
                />
                {fieldError("address") && (
                  <p className="text-xs text-destructive-text">
                    {fieldError("address")}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="residenceStatus"
                  className="text-sm font-medium text-foreground"
                >
                  Status Hunian Rumah <span className="text-destructive">*</span>
                </label>
                <select
                  id="residenceStatus"
                  name="residenceStatus"
                  defaultValue="tetap"
                  disabled={isPending}
                  className="h-[var(--size-control-md)] w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
                >
                  {Object.entries(STAY_STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <label className="flex items-center gap-2.5 pt-1 text-sm text-foreground">
            <input
              type="checkbox"
              name="setAsHouseholdHead"
              value="true"
              checked={setAsHead}
              onChange={(e) => setSetAsHead(e.target.checked)}
              disabled={isPending}
              className="size-4 rounded border-input accent-primary"
            />
            <span>Tetapkan warga ini sebagai Kepala Keluarga pada KK terpilih</span>
          </label>
        </CardContent>
      </Card>

      {/* Section 3: Sensitive Kependudukan Data (ketua_rt & sekretaris only) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <LockIcon className="size-4 text-primary" />
            <CardTitle className="text-base">
              Data Kependudukan Terproteksi
            </CardTitle>
          </div>
          <CardDescription>
            Hanya dapat diakses oleh Ketua RT, Sekretaris, dan warga pemilik
            akun. Tidak ditampilkan pada direktori umum.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label
              htmlFor="nik"
              className="text-sm font-medium text-foreground"
            >
              NIK (16 digit){" "}
              {mode === "create" && <span className="text-destructive">*</span>}
            </label>
            <Input
              id="nik"
              name="nik"
              inputMode="numeric"
              maxLength={16}
              placeholder="3273xxxxxxxxxxxx"
              defaultValue={privateData?.nik ?? ""}
              required={mode === "create"}
              disabled={isPending}
              aria-invalid={Boolean(fieldError("nik")) || undefined}
            />
            {fieldError("nik") && (
              <p className="text-xs text-destructive-text">
                {fieldError("nik")}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="birthPlace"
              className="text-sm font-medium text-foreground"
            >
              Tempat Lahir{" "}
              {mode === "create" && <span className="text-destructive">*</span>}
            </label>
            <Input
              id="birthPlace"
              name="birthPlace"
              placeholder="Kota / Kabupaten kelahiran"
              defaultValue={privateData?.birthPlace ?? ""}
              required={mode === "create"}
              disabled={isPending}
              aria-invalid={Boolean(fieldError("birthPlace")) || undefined}
            />
            {fieldError("birthPlace") && (
              <p className="text-xs text-destructive-text">
                {fieldError("birthPlace")}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="birthDate"
              className="text-sm font-medium text-foreground"
            >
              Tanggal Lahir{" "}
              {mode === "create" && <span className="text-destructive">*</span>}
            </label>
            <Input
              id="birthDate"
              name="birthDate"
              type="date"
              defaultValue={privateData?.birthDate ?? ""}
              required={mode === "create"}
              disabled={isPending}
              aria-invalid={Boolean(fieldError("birthDate")) || undefined}
            />
            {fieldError("birthDate") && (
              <p className="text-xs text-destructive-text">
                {fieldError("birthDate")}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label
              htmlFor="extraNotes"
              className="text-sm font-medium text-foreground"
            >
              Catatan Kependudukan Tambahan
            </label>
            <Textarea
              id="extraNotes"
              name="extraNotes"
              rows={2}
              placeholder="Opsional (mis. catatan domisili atau keterangan administrasi)"
              defaultValue={privateData?.extraNotes ?? ""}
              disabled={isPending}
              aria-invalid={Boolean(fieldError("extraNotes")) || undefined}
            />
            {fieldError("extraNotes") && (
              <p className="text-xs text-destructive-text">
                {fieldError("extraNotes")}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Form Footer Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="outline"
          nativeButton={false}
          disabled={isPending}
          render={<Link href={cancelHref} />}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Batal
        </Button>

        <Button type="submit" loading={isPending}>
          {isPending
            ? "Menyimpan Data..."
            : mode === "create"
              ? "Simpan Warga Baru"
              : "Simpan Perubahan"}
        </Button>
      </div>
    </form>
  )
}

