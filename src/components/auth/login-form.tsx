"use client"

import * as React from "react"
import { AlertCircleIcon, EyeIcon, EyeOffIcon, LockIcon, MailIcon } from "lucide-react"

import { loginAction, type LoginActionState } from "@/app/actions/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const INITIAL_STATE: LoginActionState = {
  error: null,
}

export function LoginForm({
  configError = false,
  nextPath = null,
}: {
  configError?: boolean
  nextPath?: string | null
}) {
  const [state, formAction, isPending] = React.useActionState(
    loginAction,
    INITIAL_STATE
  )
  const [showPassword, setShowPassword] = React.useState(false)

  const emailError = state.fieldErrors?.email?.[0]
  const passwordError = state.fieldErrors?.password?.[0]
  const bannerError =
    state.error ??
    (configError
      ? "Konfigurasi autentikasi belum tersedia. Periksa environment Supabase."
      : null)

  return (
    <form action={formAction} noValidate className="flex flex-col gap-[var(--space-4)]">
      {nextPath && <input type="hidden" name="next" value={nextPath} />}
      {bannerError && (
        <div
          role="alert"
          className="flex items-start gap-[var(--space-2-5)] rounded-lg border border-destructive-border bg-destructive-subtle px-[var(--space-3)] py-[var(--space-2-5)] text-xs text-destructive-text"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{bannerError}</span>
        </div>
      )}

      <div className="flex flex-col gap-[var(--space-1-5)]">
        <label
          htmlFor="email"
          className="text-sm font-medium text-foreground"
        >
          Email
        </label>
        <div className="relative">
          <MailIcon
            className="pointer-events-none absolute top-1/2 left-3 size-[var(--size-icon-sm)] -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="nama@contoh.id"
            required
            aria-invalid={Boolean(emailError) || undefined}
            aria-describedby={emailError ? "email-error" : undefined}
            disabled={isPending}
            className="pl-9"
          />
        </div>
        {emailError && (
          <p id="email-error" className="text-xs text-destructive-text">
            {emailError}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-[var(--space-1-5)]">
        <label
          htmlFor="password"
          className="text-sm font-medium text-foreground"
        >
          Kata Sandi
        </label>
        <div className="relative">
          <LockIcon
            className="pointer-events-none absolute top-1/2 left-3 size-[var(--size-icon-sm)] -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Masukkan kata sandi"
            required
            aria-invalid={Boolean(passwordError) || undefined}
            aria-describedby={passwordError ? "password-error" : undefined}
            disabled={isPending}
            className="pr-10 pl-9"
          />
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
            disabled={isPending}
            className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            {showPassword ? (
              <EyeOffIcon className="size-4" aria-hidden="true" />
            ) : (
              <EyeIcon className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
        {passwordError && (
          <p id="password-error" className="text-xs text-destructive-text">
            {passwordError}
          </p>
        )}
      </div>

      <Button
        type="submit"
        size="lg"
        loading={isPending}
        className="mt-[var(--space-1)] w-full"
      >
        {isPending ? "Memverifikasi..." : "Masuk"}
      </Button>
    </form>
  )
}

