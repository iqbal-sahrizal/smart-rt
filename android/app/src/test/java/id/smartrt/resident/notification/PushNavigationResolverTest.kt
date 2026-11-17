package id.smartrt.resident.notification

import id.smartrt.resident.security.TrustedOriginPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/**
 * Phase 5.2 — covers the production side of the navigation payload contract: an incoming FCM
 * `data` map is only ever trusted for its `path` field, which must independently pass
 * [TrustedOriginPolicy.validateNotificationPath] before it is combined with the app's own
 * compiled-in origin.
 */
class PushNavigationResolverTest {

    private val host = "smart-rt-staging.vercel.app"
    private val webBaseUrl = "https://$host"
    private lateinit var policy: TrustedOriginPolicy

    @Before
    fun setUp() {
        policy = TrustedOriginPolicy(allowedHost = host)
    }

    @Test
    fun resolveTargetUrl_buildsUrlFromValidPath() {
        val url = PushNavigationResolver.resolveTargetUrl(
            policy,
            webBaseUrl,
            mapOf("path" to "/resident/announcements/uuid-123")
        )
        assertEquals("https://$host/resident/announcements/uuid-123", url)
    }

    @Test
    fun resolveTargetUrl_returnsNullWhenPathMissing() {
        assertNull(PushNavigationResolver.resolveTargetUrl(policy, webBaseUrl, emptyMap()))
        assertNull(PushNavigationResolver.resolveTargetUrl(policy, webBaseUrl, mapOf("path" to "")))
        assertNull(PushNavigationResolver.resolveTargetUrl(policy, webBaseUrl, mapOf("path" to "   ")))
    }

    @Test
    fun resolveTargetUrl_returnsNullForBackofficeRoute() {
        assertNull(
            PushNavigationResolver.resolveTargetUrl(policy, webBaseUrl, mapOf("path" to "/bills"))
        )
    }

    @Test
    fun resolveTargetUrl_returnsNullForExternalUrlInPathField() {
        // The contract requires a relative path, never a full URL — reject if one sneaks in.
        assertNull(
            PushNavigationResolver.resolveTargetUrl(
                policy,
                webBaseUrl,
                mapOf("path" to "https://evil.com/resident")
            )
        )
    }

    @Test
    fun resolveTargetUrl_returnsNullForTraversalAttempt() {
        assertNull(
            PushNavigationResolver.resolveTargetUrl(
                policy,
                webBaseUrl,
                mapOf("path" to "/resident/../../etc/passwd")
            )
        )
    }

    @Test
    fun resolveTargetUrl_neverUsesOriginFromPayload() {
        // Even if an "origin"/"host" style field were present in data, only `path` is read —
        // the final URL's origin always comes from webBaseUrl, never from the payload.
        val url = PushNavigationResolver.resolveTargetUrl(
            policy,
            webBaseUrl,
            mapOf("path" to "/resident/bills", "host" to "attacker.com", "origin" to "https://attacker.com")
        )
        assertEquals("https://$host/resident/bills", url)
    }
}
