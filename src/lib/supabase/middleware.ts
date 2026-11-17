import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

import { getSupabaseConfig, isSupabaseConfigured } from "@/lib/supabase/config"

export const PUBLIC_PATHS = [
  "/login",
  "/activate-account",
  "/auth/callback",
  "/.well-known",
]

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

function redirectWithCookies(
  request: NextRequest,
  supabaseResponse: NextResponse,
  destinationPath: string
): NextResponse {
  const redirectUrl = new URL(destinationPath, request.url)
  const response = NextResponse.redirect(redirectUrl)
  supabaseResponse.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie)
  })
  return response
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })
  const pathname = request.nextUrl.pathname

  if (!isSupabaseConfigured()) {
    if (!isPublicPath(pathname) && !pathname.startsWith("/api/")) {
      return NextResponse.redirect(new URL("/login?error=config", request.url))
    }
    return supabaseResponse
  }

  const { url, anonKey } = getSupabaseConfig()

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value)
        })
        supabaseResponse = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options)
        })
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user && !isPublicPath(pathname) && !pathname.startsWith("/api/")) {
    // Phase 5.2: preserve the original Resident destination (e.g. a notification deep link)
    // as a safe `next` return target, so login can send the resident back after re-auth.
    // Scoped to `/resident` only, and re-validated again by resolveSafeNextPath() on the
    // consuming end (src/app/login/page.tsx, src/app/actions/auth.ts) — this is not itself
    // the authorization boundary, just a convenience carried through an already-safe path.
    const canReturnToDestination = pathname.startsWith("/resident") && !pathname.includes("..")
    const loginDestination = canReturnToDestination
      ? `/login?next=${encodeURIComponent(pathname + request.nextUrl.search)}`
      : "/login"
    return redirectWithCookies(request, supabaseResponse, loginDestination)
  }

  return supabaseResponse
}
