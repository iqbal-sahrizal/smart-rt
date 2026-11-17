import { resolveNotificationDestination } from "@/lib/notifications/types"

/**
 * Phase 5.2 — Push Notification Navigation Payload Contract
 *
 * The explicit, validated contract between this backend and the Android Resident shell for
 * notification-tap navigation. Whatever triggers a push (via the existing
 * `send-fcm-notification` Supabase Edge Function — unchanged by this phase) MUST build its
 * `data` object with this helper rather than passing an arbitrary URL:
 *
 *   data: buildPushNavigationPayload(referenceType, referenceId) ?? undefined
 *
 * This carries only a single relative `path` field — the exact same Resident-scoped,
 * reference-resolved path already used by the web notification center
 * (`resolveNotificationDestination`). It is never a full URL and never contains a token or
 * credential. The Android client re-validates this path independently before navigating
 * (see `PushNavigationResolver` / `TrustedOriginPolicy.validateNotificationPath` in the
 * Android source) and always combines it with its own compiled-in trusted origin — the
 * origin is never taken from this payload.
 */
export interface PushNavigationPayload {
  path: string
}

export function buildPushNavigationPayload(
  referenceType: string | null,
  referenceId: string | null
): PushNavigationPayload | null {
  const path = resolveNotificationDestination("resident", referenceType, referenceId)
  if (!path) return null
  return { path }
}
