"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertCircleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  ClockIcon,
  EyeIcon,
  EyeOffIcon,
  HomeIcon,
  LockIcon,
  LogOutIcon,
  MailCheckIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  UserCheckIcon,
} from "lucide-react"

import {
  redeemInvitationAction,
  resendInvitationConfirmationAction,
  signOutToSwitchInvitationAccountAction,
} from "@/app/actions/invitations"
import { SmartRtLogo } from "@/components/layout/smart-rt-logo"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import type {
  InvitationValidationPreview,
  InvitationValidationReason,
  RedeemInvitationActionState,
} from "@/lib/invitations/types"

const INITIAL_REDEEM_STATE: RedeemInvitationActionState = {
  error: null,
}

function formatDateTimeId(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  })
}

function getInvalidReasonCopy(reason: InvitationValidationReason): {
  title: string
  description: string
} {
  switch (reason) {
    case "expired":
      return {
        title: "Undangan Telah Kedaluwarsa",
        description:
          "Batas waktu tautan aktivasi ini telah berakhir. Hubungi Ketua RT atau Sekretaris untuk menerbitkan ulang undangan baru.",
      }
    case "revoked":
      return {
        title: "Undangan Dibatalkan",
        description:
          "Undangan aktivasi ini telah dibatalkan oleh pengurus RT dan tidak dapat digunakan lagi.",
      }
    case "redeemed":
      return {
        title: "Undangan Sudah Digunakan",
        description:
          "Akun warga dari undangan ini telah diaktifkan sebelumnya. Silakan langsung masuk ke Smart RT menggunakan email dan kata sandi Anda.",
      }
    case "already_linked":
      return {
        title: "Akun Warga Sudah Terhubung",
        description:
          "Data warga ini sudah terhubung dengan akun aktif di Portal Warga. Silakan masuk melalui halaman login.",
      }
    case "inactive_resident":
      return {
        title: "Data Warga Tidak Aktif",
        description:
          "Data warga atau lingkungan RT untuk undangan ini sedang tidak aktif. Hubungi pengurus RT untuk informasi lebih lanjut.",
      }
    default:
      return {
        title: "Tautan Undangan Tidak Valid",
        description:
          "Tautan aktivasi tidak ditemukan atau format token tidak lengkap. Pastikan Anda membuka tautan lengkap dari pengurus RT.",
      }
  }
}

interface ActivateAccountViewProps {
  token: string
  preview: InvitationValidationPreview
  signedInEmail: string | null
  signedInMatchState: "unauthenticated" | "match" | "mismatch"
  emailConfirmError?: boolean
}

export function ActivateAccountView({
  token,
  preview,
  signedInEmail,
  signedInMatchState,
  emailConfirmError = false,
}: ActivateAccountViewProps) {
  const [state, formAction, isPending] = React.useActionState(
    redeemInvitationAction,
    INITIAL_REDEEM_STATE
  )
  const [resendState, resendAction, isResending] = React.useActionState(
    resendInvitationConfirmationAction,
    INITIAL_REDEEM_STATE
  )
  const [showPassword, setShowPassword] = React.useState(false)
  const [showConfirm, setShowConfirm] = React.useState(false)

  const activated = state.ok && state.activated ? state.activated : null
  const needsEmailConfirmation =
    Boolean(state.needsEmailConfirmation) ||
    Boolean(resendState.needsEmailConfirmation)
  const confirmationMessage =
    resendState.confirmationMessage ??
    state.confirmationMessage ??
    "Tautan konfirmasi email telah dikirim ke alamat email undangan Anda. Buka kotak masuk dan klik tautan verifikasi untuk melanjutkan aktivasi akun."
  const activeError = resendState.error ?? state.error

  if (activated) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center bg-background px-[var(--space-4)] py-[var(--space-8)]">
        <div className="w-full max-w-md">
          <div className="mb-[var(--space-6)] flex justify-center">
            <SmartRtLogo badgeText="Warga" subtitle="Aktivasi Akun Berhasil" />
          </div>

          <Card data-testid="activation-confirmation-card">
            <CardHeader className="items-center text-center">
              <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-success-subtle text-success-text">
                <CheckCircle2Icon className="size-6" />
              </div>
              <CardTitle className="text-xl font-semibold">
                Akun Warga Aktif
              </CardTitle>
              <CardDescription>
                Selamat datang,{" "}
                <strong className="text-foreground">
                  {activated.residentName}
                </strong>
                . Akun Anda kini terhubung ke Portal Warga{" "}
                <strong className="text-foreground">
                  {activated.tenantName}
                </strong>
                .
              </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-subtle p-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Lingkungan RT
                  </span>
                  <span className="font-medium text-foreground">
                    {activated.tenantName} (RT {activated.rtNumber} / RW{" "}
                    {activated.rwNumber})
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Peran Diberikan
                  </span>
                  <Badge variant="success">Warga</Badge>
                </div>
              </div>

              <Button
                size="lg"
                className="w-full"
                nativeButton={false}
                render={<Link href="/resident" />}
              >
                <span>Masuk ke Portal Warga</span>
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  const invalidCopy = !preview.valid
    ? getInvalidReasonCopy(preview.reason)
    : null
  const formattedExpiry = formatDateTimeId(preview.expiresAt)
  const passwordError = state.fieldErrors?.password?.[0]
  const confirmError = state.fieldErrors?.confirmPassword?.[0]
  const loginRedirectUrl = `/login?next=${encodeURIComponent(
    `/activate-account?token=${token}`
  )}`

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-background px-[var(--space-4)] py-[var(--space-8)]">
      <div className="w-full max-w-md">
        <div className="mb-[var(--space-6)] flex justify-center">
          <SmartRtLogo badgeText="Aktivasi" subtitle="Portal Mandiri Warga" />
        </div>

        {!preview.valid && invalidCopy ? (
          <Card data-testid="activation-invalid-card">
            <CardHeader className="items-center text-center">
              <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-warning-subtle text-warning-text">
                <ShieldAlertIcon className="size-6" />
              </div>
              <CardTitle className="text-lg font-semibold">
                {invalidCopy.title}
              </CardTitle>
              <CardDescription>{invalidCopy.description}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Button
                size="lg"
                className="w-full"
                nativeButton={false}
                render={<Link href="/login" />}
              >
                Ke Halaman Masuk
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card data-testid="activation-valid-card">
            <CardHeader className="text-center">
              <CardTitle className="text-xl font-semibold">
                Aktivasi Akun Warga
              </CardTitle>
              <CardDescription>
                Selesaikan aktivasi untuk mengakses tagihan, pembayaran, dan
                pengumuman RT Anda.
              </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-4">
              {/* Invitation Summary */}
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-subtle p-4 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <HomeIcon className="size-3.5" />
                    Wilayah RT
                  </span>
                  <span className="text-right font-medium text-foreground">
                    {preview.tenantName}
                    {preview.rtNumber
                      ? ` (RT ${preview.rtNumber} / RW ${preview.rwNumber ?? "-"})`
                      : ""}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    Nama Warga
                  </span>
                  <span className="font-medium text-foreground">
                    {preview.residentName}
                  </span>
                </div>
                {preview.emailMasked && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      Email Undangan
                    </span>
                    <span className="font-mono text-xs font-medium text-foreground">
                      {preview.emailMasked}
                    </span>
                  </div>
                )}
                {formattedExpiry && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <ClockIcon className="size-3.5" />
                      Berlaku Hingga
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formattedExpiry} WIB
                    </span>
                  </div>
                )}
              </div>

              {emailConfirmError && !activeError && !needsEmailConfirmation && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-lg border border-warning-border bg-warning-subtle px-3 py-2.5 text-xs text-warning-text"
                >
                  <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Tautan konfirmasi email tidak valid atau sudah kedaluwarsa.
                    Silakan kirim ulang verifikasi atau masuk jika akun Anda
                    sudah terkonfirmasi.
                  </span>
                </div>
              )}

              {activeError && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-lg border border-destructive-border bg-destructive-subtle px-3 py-2.5 text-xs text-destructive-text"
                >
                  <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                  <span>{activeError}</span>
                </div>
              )}

              {signedInEmail && signedInMatchState === "mismatch" ? (
                <div className="flex flex-col gap-3 rounded-lg border border-warning-border bg-warning-subtle p-4 text-xs text-warning-text">
                  <div className="flex items-start gap-2">
                    <ShieldAlertIcon className="mt-0.5 size-4 shrink-0" />
                    <p>
                      Anda saat ini masuk sebagai{" "}
                      <strong className="text-foreground">
                        {signedInEmail}
                      </strong>
                      , yang berbeda dari email undangan ({preview.emailMasked}
                      ). Keluar terlebih dahulu untuk melanjutkan aktivasi dengan
                      akun yang sesuai.
                    </p>
                  </div>
                  <form action={signOutToSwitchInvitationAccountAction}>
                    <input type="hidden" name="token" value={token} />
                    <Button
                      type="submit"
                      variant="outline"
                      size="sm"
                      className="w-full"
                    >
                      <LogOutIcon data-icon="inline-start" />
                      Keluar & Ganti Akun
                    </Button>
                  </form>
                </div>
              ) : signedInEmail && signedInMatchState === "match" ? (
                <form action={formAction} className="flex flex-col gap-3">
                  <input type="hidden" name="token" value={token} />
                  <div className="flex items-start gap-2 rounded-lg border border-success-border bg-success-subtle p-3.5 text-xs text-success-text">
                    <UserCheckIcon className="mt-0.5 size-4 shrink-0" />
                    <span>
                      Anda sudah masuk sebagai{" "}
                      <strong>{signedInEmail}</strong>. Klik tombol di bawah
                      untuk menautkan data warga ini ke akun Anda dengan peran{" "}
                      <strong>Warga</strong>.
                    </span>
                  </div>
                  <Button type="submit" size="lg" loading={isPending} className="w-full">
                    <ShieldCheckIcon data-icon="inline-start" />
                    {isPending
                      ? "Mengaktifkan Akun..."
                      : "Aktifkan & Tautkan Akun Saya"}
                  </Button>
                </form>
              ) : needsEmailConfirmation ? (
                <div
                  data-testid="activation-email-confirmation-card"
                  className="flex flex-col gap-3 rounded-lg border border-info-border bg-info-subtle p-4 text-xs text-info-text"
                >
                  <div className="flex items-start gap-2.5">
                    <MailCheckIcon className="mt-0.5 size-4 shrink-0" />
                    <div className="flex flex-col gap-1">
                      <p className="font-semibold text-foreground">
                        Konfirmasi Email Diperlukan
                      </p>
                      <p className="leading-relaxed">{confirmationMessage}</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <form action={resendAction}>
                      <input type="hidden" name="token" value={token} />
                      <Button
                        type="submit"
                        variant="outline"
                        size="sm"
                        loading={isResending}
                        className="w-full"
                      >
                        {isResending
                          ? "Mengirim Ulang..."
                          : "Kirim Ulang Email Konfirmasi"}
                      </Button>
                    </form>
                    <Button
                      size="sm"
                      className="w-full"
                      nativeButton={false}
                      render={<Link href={loginRedirectUrl} />}
                    >
                      Sudah Konfirmasi? Masuk untuk Melanjutkan
                    </Button>
                  </div>
                </div>
              ) : (
                <form
                  action={formAction}
                  noValidate
                  className="flex flex-col gap-4"
                >
                  <input type="hidden" name="token" value={token} />

                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="activate-password"
                      className="text-sm font-medium text-foreground"
                    >
                      Kata Sandi
                    </label>
                    <div className="relative">
                      <LockIcon className="pointer-events-none absolute top-1/2 left-3 size-[var(--size-icon-sm)] -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="activate-password"
                        name="password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        placeholder="Minimal 8 karakter"
                        required
                        aria-invalid={Boolean(passwordError) || undefined}
                        disabled={isPending}
                        className="pr-10 pl-9"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        aria-label={
                          showPassword
                            ? "Sembunyikan kata sandi"
                            : "Tampilkan kata sandi"
                        }
                        disabled={isPending}
                        className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? (
                          <EyeOffIcon className="size-4" />
                        ) : (
                          <EyeIcon className="size-4" />
                        )}
                      </button>
                    </div>
                    {passwordError && (
                      <p className="text-xs text-destructive-text">
                        {passwordError}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="activate-confirm-password"
                      className="text-sm font-medium text-foreground"
                    >
                      Konfirmasi Kata Sandi
                    </label>
                    <div className="relative">
                      <LockIcon className="pointer-events-none absolute top-1/2 left-3 size-[var(--size-icon-sm)] -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="activate-confirm-password"
                        name="confirmPassword"
                        type={showConfirm ? "text" : "password"}
                        autoComplete="new-password"
                        placeholder="Ulangi kata sandi"
                        required
                        aria-invalid={Boolean(confirmError) || undefined}
                        disabled={isPending}
                        className="pr-10 pl-9"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirm((prev) => !prev)}
                        aria-label={
                          showConfirm
                            ? "Sembunyikan konfirmasi kata sandi"
                            : "Tampilkan konfirmasi kata sandi"
                        }
                        disabled={isPending}
                        className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground"
                      >
                        {showConfirm ? (
                          <EyeOffIcon className="size-4" />
                        ) : (
                          <EyeIcon className="size-4" />
                        )}
                      </button>
                    </div>
                    {confirmError && (
                      <p className="text-xs text-destructive-text">
                        {confirmError}
                      </p>
                    )}
                  </div>

                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Jika email undangan ini sudah pernah terdaftar di Smart RT,
                    masukkan kata sandi akun Anda saat ini atau{" "}
                    <Link
                      href={loginRedirectUrl}
                      className="font-medium text-primary hover:underline"
                    >
                      masuk terlebih dahulu
                    </Link>{" "}
                    untuk menautkan akun secara aman.
                  </p>

                  <Button
                    type="submit"
                    size="lg"
                    loading={isPending}
                    className="w-full"
                  >
                    {isPending
                      ? "Memproses Aktivasi..."
                      : "Aktifkan Akun Warga"}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

