/**
 * Centralized Supabase configuration & environment validation.
 * Never hardcode credentials or expose service_role keys here.
 */

export interface SupabaseConfig {
  url: string
  anonKey: string
}

function getRawConfig(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ""
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? ""
  return { url, anonKey }
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    const isHttp = parsed.protocol === "http:" || parsed.protocol === "https:"
    const hasRestSuffix = parsed.pathname.replace(/\/+$/, "").endsWith("/rest/v1")
    return isHttp && !hasRestSuffix
  } catch {
    return false
  }
}

/**
 * Returns true when both Supabase URL and public anon/publishable key
 * are configured with valid values. Safe to call during build or proxy checks.
 */
export function isSupabaseConfigured(): boolean {
  const { url, anonKey } = getRawConfig()
  return Boolean(url && anonKey && isValidHttpUrl(url))
}

/**
 * Validates and returns the Supabase configuration.
 * Throws a descriptive error if environment variables are missing or invalid.
 */
export function getSupabaseConfig(): SupabaseConfig {
  const { url, anonKey } = getRawConfig()

  if (!url) {
    throw new Error(
      "Missing environment variable: NEXT_PUBLIC_SUPABASE_URL. " +
        "Copy .env.example to .env.local and set your Supabase Project URL."
    )
  }

  if (!isValidHttpUrl(url)) {
    throw new Error(
      "Invalid NEXT_PUBLIC_SUPABASE_URL. Expected a root http:// or https:// Supabase project URL without /rest/v1 suffix."
    )
  }

  if (!anonKey) {
    throw new Error(
      "Missing environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Copy .env.example to .env.local and set your Supabase anon or publishable key."
    )
  }

  return { url, anonKey }
}

