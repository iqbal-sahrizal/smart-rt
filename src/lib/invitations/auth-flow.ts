export interface AuthStepErrorLike {
  code?: string | null
  message?: string | null
  status?: number | null
}

export const RATE_LIMIT_ACTIVATION_MESSAGE =
  "Terlalu banyak percobaan aktivasi. Silakan tunggu beberapa saat lalu coba lagi."

export const EMAIL_CONFIRMATION_REQUIRED_MESSAGE =
  "Tautan konfirmasi email telah dikirim ke alamat email undangan Anda. Buka kotak masuk dan klik tautan verifikasi untuk melanjutkan aktivasi akun."

export const NEUTRAL_ACTIVATION_AUTH_MESSAGE =
  "Aktivasi belum dapat langsung memverifikasi sesi. Jika Anda baru mendaftar, periksa kotak masuk email undangan untuk tautan konfirmasi; jika email ini sudah memiliki akun Smart RT dengan kata sandi lain, masuk melalui halaman Login terlebih dahulu."

export function isRateLimitAuthError(
  error: AuthStepErrorLike | null | undefined
): boolean {
  if (!error) return false
  const code = (error.code ?? "").toLowerCase()
  const msg = (error.message ?? "").toLowerCase()
  return (
    error.status === 429 ||
    code.includes("rate_limit") ||
    msg.includes("rate limit")
  )
}

export function isAlreadyRegisteredAuthError(
  error: AuthStepErrorLike | null | undefined
): boolean {
  if (!error) return false
  const code = (error.code ?? "").toLowerCase()
  const msg = (error.message ?? "").toLowerCase()
  return (
    code === "user_already_exists" ||
    msg.includes("already registered") ||
    msg.includes("already been registered")
  )
}

export function isEmailNotConfirmedAuthError(
  error: AuthStepErrorLike | null | undefined
): boolean {
  if (!error) return false
  const code = (error.code ?? "").toLowerCase()
  const msg = (error.message ?? "").toLowerCase()
  return code === "email_not_confirmed" || msg.includes("email not confirmed")
}

export type SignUpFollowUpDecision =
  | { action: "redeem_now" }
  | { action: "attempt_sign_in" }
  | { action: "fail"; error: string }

export function resolveActivationSignUpOutcome({
  signUpError,
  hasSignUpSession,
}: {
  signUpError: AuthStepErrorLike | null | undefined
  hasSignUpSession: boolean
}): SignUpFollowUpDecision {
  if (hasSignUpSession && !signUpError) {
    return { action: "redeem_now" }
  }

  if (signUpError) {
    if (isRateLimitAuthError(signUpError)) {
      return { action: "fail", error: RATE_LIMIT_ACTIVATION_MESSAGE }
    }
    if (isAlreadyRegisteredAuthError(signUpError)) {
      return { action: "attempt_sign_in" }
    }
    return {
      action: "fail",
      error:
        "Gagal membuat kredensial akun. Pastikan kata sandi memenuhi syarat keamanan.",
    }
  }

  // No error and no session occurs when Confirm Email is enabled for a new signup
  // or when GoTrue obfuscates an existing account to prevent user enumeration.
  return { action: "attempt_sign_in" }
}

export type SignInFollowUpDecision =
  | { action: "redeem_now" }
  | { action: "needs_email_confirmation"; message: string }
  | { action: "fail"; error: string }

export function resolveActivationSignInOutcome({
  signInError,
  hasSignInSession,
}: {
  signInError: AuthStepErrorLike | null | undefined
  hasSignInSession: boolean
}): SignInFollowUpDecision {
  if (hasSignInSession && !signInError) {
    return { action: "redeem_now" }
  }

  if (signInError) {
    if (isRateLimitAuthError(signInError)) {
      return { action: "fail", error: RATE_LIMIT_ACTIVATION_MESSAGE }
    }
    if (isEmailNotConfirmedAuthError(signInError)) {
      return {
        action: "needs_email_confirmation",
        message: EMAIL_CONFIRMATION_REQUIRED_MESSAGE,
      }
    }
  }

  return {
    action: "fail",
    error: NEUTRAL_ACTIVATION_AUTH_MESSAGE,
  }
}

export function buildActivationEmailRedirectTo(
  origin: string | null | undefined,
  token: string
): string | undefined {
  if (!origin) return undefined
  try {
    const parsed = new URL(origin)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined
    }
    const nextTarget = `/activate-account?token=${token}`
    return `${parsed.origin}/auth/callback?next=${encodeURIComponent(nextTarget)}`
  } catch {
    return undefined
  }
}

