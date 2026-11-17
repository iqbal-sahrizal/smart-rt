package id.smartrt.resident.navigation

import id.smartrt.resident.security.PathValidationResult
import id.smartrt.resident.security.TrustedOriginPolicy
import java.net.URI

sealed class DeepLinkDecision {
    data class Load(val url: String) : DeepLinkDecision()
    object Ignore : DeepLinkDecision()
}

/**
 * Smart RT — Notification Tap Navigation Decision (Phase 5.2)
 *
 * Pure, stateful-but-Android-free decision logic consumed by MainActivity from both
 * `onCreate` (cold/terminated launch) and `onNewIntent` (foreground/background tap).
 *
 * Responsibilities:
 * - Re-validates `target_url` independently of how the Intent was produced. MainActivity is
 *   an exported launcher activity, so this cannot assume the extra only ever came from our
 *   own FCM-built PendingIntent.
 * - Deduplicates repeated `onNewIntent` delivery for the same notification tap (e.g. Activity
 *   recreation, redundant intent redelivery) via an opaque `navToken`, so the same tap can
 *   never trigger more than one navigation.
 * - Never inspects or resolves business-level routing (which announcement/bill a reference ID
 *   maps to) — that remains server-side. This only answers "is this a safe, same-origin,
 *   Resident-scoped target to load, and have we already handled it".
 */
class NotificationDeepLinkResolver(
    private val trustedOriginPolicy: TrustedOriginPolicy
) {
    private var lastHandledNavToken: String? = null

    /**
     * @param targetUrl the `target_url` intent extra (full absolute URL, or null/absent).
     * @param navToken opaque per-notification identifier (`nav_token` intent extra), used only
     *   for duplicate-delivery detection — never trusted for authorization.
     * @param isNewIntent true when called from `onNewIntent` (foreground/background tap),
     *   false when called from `onCreate` (cold/terminated launch).
     */
    fun resolve(targetUrl: String?, navToken: String?, isNewIntent: Boolean): DeepLinkDecision {
        if (targetUrl.isNullOrBlank()) {
            return DeepLinkDecision.Ignore
        }

        if (isNewIntent && navToken != null && navToken == lastHandledNavToken) {
            return DeepLinkDecision.Ignore
        }

        if (!trustedOriginPolicy.isTrustedOrigin(targetUrl)) {
            return DeepLinkDecision.Ignore
        }

        val path = extractPathAndQuery(targetUrl)
        val validated = trustedOriginPolicy.validateNotificationPath(path)
        if (validated !is PathValidationResult.Valid) {
            return DeepLinkDecision.Ignore
        }

        if (navToken != null) {
            lastHandledNavToken = navToken
        }
        return DeepLinkDecision.Load(targetUrl)
    }

    /** Resets duplicate-detection state. Exposed for tests; not required in normal operation. */
    fun resetToken() {
        lastHandledNavToken = null
    }

    private fun extractPathAndQuery(rawUrl: String): String {
        return try {
            val uri = URI(rawUrl)
            val path = uri.path ?: "/"
            if (uri.query != null) "$path?${uri.query}" else path
        } catch (_: Exception) {
            "/"
        }
    }
}
