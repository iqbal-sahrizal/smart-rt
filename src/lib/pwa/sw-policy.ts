/**
 * Smart RT — PWA Service Worker Caching & Update Policy
 *
 * Pure policy functions shared between the application test suite and `public/sw.js`.
 * Enforces strict exclusion of authenticated APIs, Supabase endpoints, private media/documents,
 * Server Actions, RSC payloads, and authenticated HTML documents.
 */

export const SW_CACHE_PREFIX = "smart-rt-static-"
export const SW_CACHE_VERSION = "v1"
export const SW_STATIC_CACHE_NAME = `${SW_CACHE_PREFIX}${SW_CACHE_VERSION}`
export const SW_OFFLINE_FALLBACK_URL = "/offline.html"

export const SW_PRECACHE_URLS: readonly string[] = [
  "/offline.html",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png",
  "/icons/icon-maskable-192x192.png",
  "/icons/icon-maskable-512x512.png",
  "/icons/apple-touch-icon.png",
] as const

export type SwCacheStrategy =
  | "bypass"
  | "network-only-navigate"
  | "cache-first-immutable"
  | "stale-while-revalidate-static"

export interface ClassifyRequestInput {
  method: string
  url: string
  appOrigin: string
  mode?: string
  headers?: Record<string, string | null | undefined>
}

export interface ResponseCacheCheckInput {
  status: number
  type?: string
  cacheControl?: string | null
  hasSetCookie?: boolean
}

const STATIC_REVALIDATE_PATHS = new Set<string>([
  "/favicon.ico",
  "/manifest.webmanifest",
  "/offline.html",
])

function getHeaderCaseInsensitive(
  headers: Record<string, string | null | undefined> | undefined,
  targetName: string
): string {
  if (!headers) return ""
  const lowerTarget = targetName.toLowerCase()
  for (const [key, val] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerTarget && typeof val === "string") {
      return val.trim()
    }
  }
  return ""
}

/**
 * Classifies an incoming HTTP request into a conservative Service Worker handling strategy.
 * - Never caches non-GET requests or Server Actions.
 * - Never caches cross-origin requests (e.g. Supabase Auth, REST, Storage).
 * - Never caches `/api/*` or `/auth/*` routes (including private documents and Community Feed media).
 * - Never caches Next.js RSC payloads (`_rsc`, `RSC: 1`).
 * - Never caches HTML navigation responses; navigations use `network-only-navigate` with `/offline.html` fallback on network failure.
 */
export function classifyRequestForCache(
  input: ClassifyRequestInput
): SwCacheStrategy {
  const method = (input.method || "GET").toUpperCase()
  if (method !== "GET") {
    return "bypass"
  }

  let parsed: URL
  try {
    parsed = new URL(input.url)
  } catch {
    return "bypass"
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "bypass"
  }

  // Strictly restrict to same-origin requests; never intercept Supabase or external domains
  if (parsed.origin !== input.appOrigin) {
    return "bypass"
  }

  const pathname = parsed.pathname

  // Never intercept the service worker script itself
  if (pathname === "/sw.js") {
    return "bypass"
  }

  // Never intercept or cache API routes, auth callbacks, or private storage proxies
  if (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/auth" ||
    pathname.startsWith("/auth/")
  ) {
    return "bypass"
  }

  // Never intercept or cache Next.js RSC flight requests, prefetches, Server Actions, or range/auth requests
  if (parsed.searchParams.has("_rsc")) {
    return "bypass"
  }

  const rscHeader = getHeaderCaseInsensitive(input.headers, "rsc")
  const nextActionHeader = getHeaderCaseInsensitive(input.headers, "next-action")
  const routerPrefetchHeader = getHeaderCaseInsensitive(
    input.headers,
    "next-router-prefetch"
  )
  const routerStateHeader = getHeaderCaseInsensitive(
    input.headers,
    "next-router-state-tree"
  )
  const authHeader = getHeaderCaseInsensitive(input.headers, "authorization")
  const rangeHeader = getHeaderCaseInsensitive(input.headers, "range")

  if (
    rscHeader === "1" ||
    nextActionHeader !== "" ||
    routerPrefetchHeader !== "" ||
    routerStateHeader !== "" ||
    authHeader !== "" ||
    rangeHeader !== ""
  ) {
    return "bypass"
  }

  // Immutable content-hashed Next.js build artifacts
  if (pathname.startsWith("/_next/static/")) {
    return "cache-first-immutable"
  }

  // Never cache Next.js dynamic image optimizer or internal data routes
  if (pathname.startsWith("/_next/")) {
    return "bypass"
  }

  // Public brand icons, manifest, and offline fallback document
  if (
    pathname.startsWith("/icons/") &&
    /\.(?:png|svg|ico|webp)$/i.test(pathname)
  ) {
    return "stale-while-revalidate-static"
  }

  if (STATIC_REVALIDATE_PATHS.has(pathname)) {
    return "stale-while-revalidate-static"
  }

  // Document navigations: always fetch fresh from network, never store authenticated HTML in cache,
  // and fall back to precached /offline.html only when the network is unreachable.
  const acceptHeader = getHeaderCaseInsensitive(input.headers, "accept")
  if (input.mode === "navigate" || acceptHeader.includes("text/html")) {
    return "network-only-navigate"
  }

  return "bypass"
}

/**
 * Verifies whether a network response for a static asset is safe to write into Cache Storage.
 * Rejects non-200 responses, opaque/cross-origin responses, responses setting cookies,
 * and responses marked `private` or `no-store`.
 */
export function isResponseSafeToCache(input: ResponseCacheCheckInput): boolean {
  if (input.status !== 200) {
    return false
  }
  if (input.type && input.type !== "basic") {
    return false
  }
  if (input.hasSetCookie) {
    return false
  }
  const cc = (input.cacheControl ?? "").toLowerCase()
  if (cc.includes("no-store") || cc.includes("private")) {
    return false
  }
  return true
}

/**
 * Returns only obsolete Smart RT static asset cache names (`smart-rt-static-*`)
 * that do not match `activeCacheName`. Unrelated caches are never touched.
 */
export function getObsoleteCacheNames(
  existingCacheNames: readonly string[],
  activeCacheName: string = SW_STATIC_CACHE_NAME
): string[] {
  return existingCacheNames.filter(
    (name) => name.startsWith(SW_CACHE_PREFIX) && name !== activeCacheName
  )
}

export interface UpdateReloadDecisionInput {
  hasExistingController: boolean
  userConfirmedUpdate: boolean
  alreadyReloaded: boolean
}

/**
 * Prevents unexpected reloads on initial Service Worker installation and prevents infinite reload loops.
 */
export function shouldReloadOnControllerChange(
  input: UpdateReloadDecisionInput
): boolean {
  return (
    input.hasExistingController &&
    input.userConfirmedUpdate &&
    !input.alreadyReloaded
  )
}

