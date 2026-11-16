import type { EmailOtpType } from "@supabase/supabase-js"
import { NextResponse, type NextRequest } from "next/server"

import { resolveSafeNextPath } from "@/lib/auth/cookies"
import { createClient } from "@/lib/supabase/server"

const ALLOWED_OTP_TYPES = new Set<EmailOtpType>([
  "signup",
  "email",
  "recovery",
  "invite",
  "email_change",
])

function buildRedirectTarget(request: NextRequest, path: string): URL {
  return new URL(path, request.url)
}

function appendConfirmError(path: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}confirm_error=1`
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get("code")?.trim() ?? ""
  const tokenHash = searchParams.get("token_hash")?.trim() ?? ""
  const typeParam = searchParams.get("type")?.trim() ?? ""
  const safeNext = resolveSafeNextPath(searchParams.get("next"))

  const supabase = await createClient()

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(
        buildRedirectTarget(request, safeNext ?? "/login")
      )
    }
    return NextResponse.redirect(
      buildRedirectTarget(
        request,
        safeNext ? appendConfirmError(safeNext) : "/login?error=auth_callback"
      )
    )
  }

  if (tokenHash && ALLOWED_OTP_TYPES.has(typeParam as EmailOtpType)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: typeParam as EmailOtpType,
    })
    if (!error) {
      return NextResponse.redirect(
        buildRedirectTarget(request, safeNext ?? "/login")
      )
    }
    return NextResponse.redirect(
      buildRedirectTarget(
        request,
        safeNext ? appendConfirmError(safeNext) : "/login?error=auth_callback"
      )
    )
  }

  return NextResponse.redirect(
    buildRedirectTarget(
      request,
      safeNext ? appendConfirmError(safeNext) : "/login?error=auth_callback"
    )
  )
}

