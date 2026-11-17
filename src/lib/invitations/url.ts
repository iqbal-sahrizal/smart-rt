const ALLOWED_CANONICAL_HOSTS = new Set([
  "smart-rt-nine.vercel.app",
  "resident.smartrt.id",
])

function normalizeOriginCandidate(raw: string | undefined | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const withScheme =
    trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? trimmed
      : `https://${trimmed}`

  try {
    const parsed = new URL(withScheme)
    if (parsed.protocol === "https:") {
      return parsed.origin
    }
    if (
      parsed.protocol === "http:" &&
      process.env.NODE_ENV === "development" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    ) {
      return parsed.origin
    }
    return null
  } catch {
    return null
  }
}

/**
 * Resolves the canonical HTTPS origin for invitation links without trusting
 * unvalidated Host headers. Never returns localhost in non-development builds.
 */
export function resolveCanonicalAppOrigin(): string | null {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
  ]

  for (const candidate of candidates) {
    const normalized = normalizeOriginCandidate(candidate)
    if (normalized) return normalized
  }

  if (process.env.NODE_ENV === "production") {
    return "https://smart-rt-nine.vercel.app"
  }

  return null
}

/**
 * Validates a request-derived origin strictly against allowlisted hosts when
 * explicit canonical env vars are absent (never trusts arbitrary Host headers).
 */
export function isTrustedAppOrigin(origin: string | null | undefined): boolean {
  const normalized = normalizeOriginCandidate(origin)
  if (!normalized) return false
  try {
    const parsed = new URL(normalized)
    if (ALLOWED_CANONICAL_HOSTS.has(parsed.hostname.toLowerCase())) {
      return parsed.protocol === "https:"
    }
    return (
      process.env.NODE_ENV === "development" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    )
  } catch {
    return false
  }
}

export function buildCanonicalActivationUrl(token: string): string {
  const path = `/activate-account?token=${encodeURIComponent(token.trim())}`
  const origin = resolveCanonicalAppOrigin()
  return origin ? `${origin}${path}` : path
}

