package id.smartrt.resident.notification

import id.smartrt.resident.security.PathValidationResult
import id.smartrt.resident.security.TrustedOriginPolicy

/**
 * Smart RT — Push Notification Navigation Payload Contract (Phase 5.2)
 *
 * Defines the explicit, validated contract between the backend and this app for
 * notification-tap navigation:
 *
 *   FCM `data.path` = a single, pre-resolved, Resident-scoped RELATIVE path
 *   (e.g. "/resident/announcements/<id>"), produced server-side by
 *   `resolveNotificationDestination("resident", referenceType, referenceId)`
 *   (see src/lib/notifications/push-payload.ts).
 *
 * The backend NEVER sends a full URL or any token/credential in the payload — only a path.
 * This function re-validates that path against [TrustedOriginPolicy.validateNotificationPath]
 * before it is ever written into a PendingIntent extra, and only then combines it with the
 * app's own compiled-in, trusted origin ([webBaseUrl]) to form the final URL. The origin
 * is never taken from the push payload itself.
 */
object PushNavigationResolver {

    private const val KEY_PATH = "path"

    /**
     * @return a fully-qualified, trusted-origin URL safe to store as a `target_url` intent
     *   extra, or null if [data] carries no path or the path fails validation.
     */
    fun resolveTargetUrl(
        trustedOriginPolicy: TrustedOriginPolicy,
        webBaseUrl: String,
        data: Map<String, String>
    ): String? {
        val rawPath = data[KEY_PATH]?.trim()
        if (rawPath.isNullOrBlank()) return null

        val validated = trustedOriginPolicy.validateNotificationPath(rawPath)
        if (validated !is PathValidationResult.Valid) return null

        return "$webBaseUrl${validated.path}"
    }
}
