package id.smartrt.resident.navigation

import id.smartrt.resident.security.TrustedOriginPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Phase 5.2 — covers notification tap navigation decisions across the three delivery states:
 * terminated/cold launch (`isNewIntent = false`), and foreground/background tap, which Android
 * both deliver through `onNewIntent` (`isNewIntent = true`) once the Activity process exists.
 */
class NotificationDeepLinkResolverTest {

    private val host = "smart-rt-staging.vercel.app"
    private lateinit var policy: TrustedOriginPolicy
    private lateinit var resolver: NotificationDeepLinkResolver

    @Before
    fun setUp() {
        policy = TrustedOriginPolicy(allowedHost = host)
        resolver = NotificationDeepLinkResolver(policy)
    }

    @Test
    fun resolve_loadsValidResidentUrl_onColdLaunch() {
        val url = "https://$host/resident/announcements/uuid-123"
        val decision = resolver.resolve(url, navToken = "1", isNewIntent = false)
        assertTrue(decision is DeepLinkDecision.Load)
        assertEquals(url, (decision as DeepLinkDecision.Load).url)
    }

    @Test
    fun resolve_loadsValidResidentUrl_onForegroundOrBackgroundTap() {
        val url = "https://$host/resident/bills/uuid-456"
        val decision = resolver.resolve(url, navToken = "2", isNewIntent = true)
        assertTrue(decision is DeepLinkDecision.Load)
        assertEquals(url, (decision as DeepLinkDecision.Load).url)
    }

    @Test
    fun resolve_ignoresAbsentTarget() {
        assertEquals(DeepLinkDecision.Ignore, resolver.resolve(null, null, isNewIntent = false))
        assertEquals(DeepLinkDecision.Ignore, resolver.resolve("", null, isNewIntent = true))
    }

    @Test
    fun resolve_ignoresExternalDomain() {
        val decision = resolver.resolve("https://evil.com/resident", "3", isNewIntent = true)
        assertEquals(DeepLinkDecision.Ignore, decision)
    }

    @Test
    fun resolve_ignoresJavascriptAndFileSchemes() {
        assertEquals(
            DeepLinkDecision.Ignore,
            resolver.resolve("javascript:alert(1)", "4", isNewIntent = true)
        )
        assertEquals(
            DeepLinkDecision.Ignore,
            resolver.resolve("file:///etc/passwd", "5", isNewIntent = true)
        )
    }

    @Test
    fun resolve_ignoresBackofficeRoute() {
        val decision = resolver.resolve("https://$host/bills", "6", isNewIntent = true)
        assertEquals(DeepLinkDecision.Ignore, decision)
    }

    @Test
    fun resolve_ignoresEncodedTraversal() {
        val decision = resolver.resolve(
            "https://$host/resident/%2e%2e/%2e%2e/admin",
            "7",
            isNewIntent = true
        )
        assertEquals(DeepLinkDecision.Ignore, decision)
    }

    @Test
    fun resolve_preventsDuplicateNavigationForSameNavToken() {
        val url = "https://$host/resident/bills/uuid-456"

        val first = resolver.resolve(url, navToken = "dup-1", isNewIntent = true)
        assertTrue(first is DeepLinkDecision.Load)

        // Same token redelivered (e.g. Activity recreated, or the Intent is redelivered) must
        // not trigger a second navigation.
        val second = resolver.resolve(url, navToken = "dup-1", isNewIntent = true)
        assertEquals(DeepLinkDecision.Ignore, second)
    }

    @Test
    fun resolve_allowsNavigationForDifferentNavTokenAfterDuplicateIgnored() {
        val urlA = "https://$host/resident/bills/uuid-456"
        val urlB = "https://$host/resident/announcements/uuid-789"

        resolver.resolve(urlA, navToken = "a", isNewIntent = true)
        resolver.resolve(urlA, navToken = "a", isNewIntent = true) // duplicate, ignored

        val third = resolver.resolve(urlB, navToken = "b", isNewIntent = true)
        assertTrue("A genuinely new tap must still navigate", third is DeepLinkDecision.Load)
    }

    @Test
    fun resolve_doesNotDeduplicateOnColdLaunchPath() {
        // isNewIntent = false represents onCreate; dedup only applies to onNewIntent delivery,
        // since onCreate only ever runs once per process lifetime for a given instance.
        val url = "https://$host/resident"
        resolver.resolve(url, navToken = "same", isNewIntent = false)
        val decision = resolver.resolve(url, navToken = "same", isNewIntent = false)
        assertTrue(decision is DeepLinkDecision.Load)
    }

    @Test
    fun resolveAppLink_acceptsValidInvitationUrl_andStripsExtraQueryParams() {
        val validToken = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        val incoming = "https://$host/activate-account?token=$validToken&utm_source=whatsapp"
        val decision = resolver.resolveAppLink(incoming, "https://$host", isNewIntent = false)
        assertTrue(decision is DeepLinkDecision.Load)
        assertEquals(
            "https://$host/activate-account?token=$validToken",
            (decision as DeepLinkDecision.Load).url
        )

        val schemeInjected = "https://$host/activate-account?token=$validToken&next=https://evil.com"
        assertEquals(
            DeepLinkDecision.Ignore,
            resolver.resolveAppLink(schemeInjected, "https://$host", isNewIntent = false)
        )
    }

    @Test
    fun resolveAppLink_rejectsUntrustedDomainAndHttpAndDisallowedRoutes() {
        val validToken = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        assertEquals(
            DeepLinkDecision.Ignore,
            resolver.resolveAppLink("https://evil.com/activate-account?token=$validToken", "https://$host", false)
        )
        assertEquals(
            DeepLinkDecision.Ignore,
            resolver.resolveAppLink("http://$host/activate-account?token=$validToken", "https://$host", false)
        )
        assertEquals(
            DeepLinkDecision.Ignore,
            resolver.resolveAppLink("https://$host/bills?token=$validToken", "https://$host", false)
        )
        assertEquals(
            DeepLinkDecision.Ignore,
            resolver.resolveAppLink("https://$host/activate-account?token=short", "https://$host", false)
        )
        assertEquals(
            DeepLinkDecision.Ignore,
            resolver.resolveAppLink("https://$host/%2e%2e/activate-account?token=$validToken", "https://$host", false)
        )
    }

    @Test
    fun resolveAppLink_deduplicatesOnNewIntent_andAllowsOnColdLaunch() {
        val validToken = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        val incoming = "https://$host/activate-account?token=$validToken"
        assertTrue(resolver.resolveAppLink(incoming, "https://$host", isNewIntent = false) is DeepLinkDecision.Load)
        assertEquals(DeepLinkDecision.Ignore, resolver.resolveAppLink(incoming, "https://$host", isNewIntent = true))
    }
}
