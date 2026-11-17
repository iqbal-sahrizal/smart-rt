/**
 * Validates internal post-login redirect targets to avoid open-redirect attacks.
 *
 * Extracted as a dependency-free module (no `server-only`, no `next/headers`) so this pure
 * validation logic can be exercised directly by the Node test runner, independent of the
 * server-only cookie helpers in `@/lib/auth/cookies`.
 *
 * Phase 5.2 extends this beyond the original `/activate-account` allowance to also accept
 * Resident deep-link return targets (`/resident`, `/resident/...`), so a notification tap
 * that hits an expired session can be returned to its original destination after re-login
 * (see `src/lib/supabase/middleware.ts` for where this `next` value is produced).
 */
export function resolveSafeNextPath(rawNext: unknown): string | null {
  if (typeof rawNext !== "string") return null
  const trimmed = rawNext.trim()
  if (!trimmed.startsWith("/")) return null
  if (trimmed.startsWith("//") || trimmed.includes("\\")) return null
  // Dot-segment traversal could otherwise resolve (client-side, same-origin) to a path
  // outside the intended allowlisted scope once the browser normalizes the URL.
  if (trimmed.includes("..")) return null

  if (trimmed === "/activate-account" || trimmed.startsWith("/activate-account?")) {
    return trimmed
  }

  if (
    trimmed === "/resident" ||
    trimmed.startsWith("/resident/") ||
    trimmed.startsWith("/resident?")
  ) {
    return trimmed
  }

  return null
}
