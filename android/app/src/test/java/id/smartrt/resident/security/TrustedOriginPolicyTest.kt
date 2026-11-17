package id.smartrt.resident.security

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Unit tests verifying exact origin matching, anti-spoofing, path filtering,
 * encoded path traversal rejection, and document allowlist boundaries.
 */
class TrustedOriginPolicyTest {

    private lateinit var policy: TrustedOriginPolicy
    private val stagingHost = "smart-rt-staging.vercel.app"
    private val releaseHost = "resident.smartrt.id"

    @Before
    fun setUp() {
        policy = TrustedOriginPolicy(allowedHost = stagingHost)
    }

    @Test
    fun isTrustedOrigin_acceptsExactHttpsHost() {
        assertTrue(policy.isTrustedOrigin("https://smart-rt-staging.vercel.app"))
        assertTrue(policy.isTrustedOrigin("https://smart-rt-staging.vercel.app/"))
        assertTrue(policy.isTrustedOrigin("https://smart-rt-staging.vercel.app/resident"))
        assertTrue(policy.isTrustedOrigin("https://smart-rt-staging.vercel.app/resident/bills?status=unpaid"))
        assertTrue(policy.isTrustedOrigin("https://SMART-RT-STAGING.VERCEL.APP/resident")) // case-insensitive
    }

    @Test
    fun isTrustedOrigin_rejectsInsecureHttpScheme() {
        assertFalse(
            "Plain HTTP must be strictly rejected",
            policy.isTrustedOrigin("http://smart-rt-staging.vercel.app/resident")
        )
    }

    @Test
    fun isTrustedOrigin_rejectsLookalikeAndAttackerDomains() {
        assertFalse(policy.isTrustedOrigin("https://smart-rt-staging.vercel.app.attacker.com/resident"))
        assertFalse(policy.isTrustedOrigin("https://evilsmart-rt-staging.vercel.app/resident"))
        assertFalse(policy.isTrustedOrigin("https://sub.smart-rt-staging.vercel.app/resident"))
        assertFalse(policy.isTrustedOrigin("https://google.com"))
    }

    @Test
    fun isTrustedOrigin_rejectsCredentialUserInfoInjection() {
        assertFalse(
            "URLs containing userinfo credentials must be rejected",
            policy.isTrustedOrigin("https://smart-rt-staging.vercel.app@attacker.com/resident")
        )
        assertFalse(
            policy.isTrustedOrigin("https://user:password@smart-rt-staging.vercel.app/resident")
        )
    }

    @Test
    fun isTrustedOrigin_rejectsDangerousPseudoSchemes() {
        assertFalse(policy.isTrustedOrigin("javascript:alert(1)"))
        assertFalse(policy.isTrustedOrigin("file:///android_asset/index.html"))
        assertFalse(policy.isTrustedOrigin("data:text/html,<html></html>"))
        assertFalse(policy.isTrustedOrigin("content://media/external/images/media/1"))
        assertFalse(policy.isTrustedOrigin(""))
        assertFalse(policy.isTrustedOrigin(null))
        assertFalse(policy.isTrustedOrigin("not_a_valid_url"))
    }

    @Test
    fun buildVariantOriginSeparation_isolatesStagingAndReleaseOrigins() {
        val stagingPolicy = TrustedOriginPolicy(allowedHost = stagingHost)
        val releasePolicy = TrustedOriginPolicy(allowedHost = releaseHost)

        assertEquals("https://smart-rt-staging.vercel.app", stagingPolicy.getAllowedOriginRule())
        assertEquals("https://resident.smartrt.id", releasePolicy.getAllowedOriginRule())

        // Staging accepts staging, rejects release
        assertTrue(stagingPolicy.isTrustedOrigin("https://smart-rt-staging.vercel.app/resident"))
        assertFalse(stagingPolicy.isTrustedOrigin("https://resident.smartrt.id/resident"))

        // Release accepts release, rejects staging
        assertTrue(releasePolicy.isTrustedOrigin("https://resident.smartrt.id/resident"))
        assertFalse(releasePolicy.isTrustedOrigin("https://smart-rt-staging.vercel.app/resident"))
    }

    @Test
    fun isAllowedResidentPath_classifiesResidentRoutesCorrectly() {
        assertTrue(policy.isAllowedResidentPath("/resident"))
        assertTrue(policy.isAllowedResidentPath("/resident/bills"))
        assertTrue(policy.isAllowedResidentPath("/resident/feed"))
        assertTrue(policy.isAllowedResidentPath("/resident/letters/123"))
        assertTrue(policy.isAllowedResidentPath("/login"))
        assertTrue(policy.isAllowedResidentPath("/select-tenant"))
        assertTrue(policy.isAllowedResidentPath("/auth/callback"))
        assertTrue(policy.isAllowedResidentPath("/api/letters/uuid/issued"))
        assertTrue(policy.isAllowedResidentPath("/_next/static/chunks/app.js"))
        assertTrue(policy.isAllowedResidentPath("/offline.html"))
        assertTrue(policy.isAllowedResidentPath("/manifest.webmanifest"))
    }

    @Test
    fun isBackofficeRoute_identifiesAdminOnlyRoutes() {
        assertTrue(policy.isBackofficeRoute("/"))
        assertTrue(policy.isBackofficeRoute("/bills"))
        assertTrue(policy.isBackofficeRoute("/bills/new"))
        assertTrue(policy.isBackofficeRoute("/residents"))
        assertTrue(policy.isBackofficeRoute("/pengaduan"))
        assertTrue(policy.isBackofficeRoute("/surat"))
        assertTrue(policy.isBackofficeRoute("/super-admin"))

        assertFalse(policy.isBackofficeRoute("/resident"))
        assertFalse(policy.isBackofficeRoute("/resident/bills"))
        assertFalse(policy.isBackofficeRoute("/login"))
    }

    @Test
    fun isExternalIntentScheme_detectsSystemActionSchemes() {
        assertTrue(policy.isExternalIntentScheme("tel:+6281234567890"))
        assertTrue(policy.isExternalIntentScheme("mailto:warga@smartrt.id"))
        assertTrue(policy.isExternalIntentScheme("whatsapp://send?phone=6281234567890"))
        assertTrue(policy.isExternalIntentScheme("https://wa.me/6281234567890?text=Halo"))

        assertFalse(policy.isExternalIntentScheme("https://smart-rt-staging.vercel.app/resident"))
    }

    @Test
    fun isPayloadSizeSafe_enforcesFourKilobyteBoundaries() {
        assertTrue(policy.isPayloadSizeSafe(null))
        assertTrue(policy.isPayloadSizeSafe("{}"))
        assertTrue(policy.isPayloadSizeSafe("A".repeat(4096)))
        assertFalse(policy.isPayloadSizeSafe("A".repeat(4097)))
    }

    // --- Document Path Allowlist & Traversal Security Tests ---

    @Test
    fun validateDocumentPath_acceptsValidRelativePaths() {
        // Letters
        val letterResult = policy.validateDocumentPath("/api/letters/uuid-123/issued")
        assertTrue(letterResult is PathValidationResult.Valid)
        val validLetter = letterResult as PathValidationResult.Valid
        assertEquals("/api/letters/uuid-123/issued", validLetter.path)
        assertFalse(validLetter.isDownload)

        // Letters with download parameter
        val letterDlResult = policy.validateDocumentPath("/api/letters/uuid-123/issued?download=1")
        assertTrue(letterDlResult is PathValidationResult.Valid)
        assertTrue((letterDlResult as PathValidationResult.Valid).isDownload)

        // Activities
        val actResult = policy.validateDocumentPath("/api/activities/act-456/documents/file-1")
        assertTrue(actResult is PathValidationResult.Valid)

        // Payments
        val payResult = policy.validateDocumentPath("/api/payments/pay-789/proof")
        assertTrue(payResult is PathValidationResult.Valid)

        // Complaints
        val compResult = policy.validateDocumentPath("/api/complaints/comp-101/photo")
        assertTrue(compResult is PathValidationResult.Valid)

        // Community Feed Media
        val feedResult = policy.validateDocumentPath("/api/community-feed/media/feed-202")
        assertTrue(feedResult is PathValidationResult.Valid)
    }

    // -------------------------------------------------------------------------
    // Phase 2.1 traversal tests (retained as regression baseline)
    // -------------------------------------------------------------------------

    @Test
    fun validateDocumentPath_rejectsSingleEncodedPathTraversal() {
        // %2e%2e is single-encoded ".."
        val res1 = policy.validateDocumentPath("/api/letters/%2e%2e/admin/secrets")
        assertTrue("Single-encoded %2e%2e must be rejected", res1 is PathValidationResult.Invalid)

        // %2e%2e%2f (encoded dot-dot-slash)
        val res2 = policy.validateDocumentPath("/api/activities/%2E%2E%2Fprivate")
        assertTrue("%2E%2E%2F must be rejected", res2 is PathValidationResult.Invalid)

        // Standard literal ..
        val res3 = policy.validateDocumentPath("/api/letters/../../etc/passwd")
        assertTrue("Literal .. traversal must be rejected", res3 is PathValidationResult.Invalid)

        // Literal backslash traversal
        val res4 = policy.validateDocumentPath("/api/payments\\..\\config")
        assertTrue("Literal backslash traversal must be rejected", res4 is PathValidationResult.Invalid)

        // Encoded backslash %5c
        val res5 = policy.validateDocumentPath("/api/payments%5csecrets")
        assertTrue("Encoded backslash %5c must be rejected", res5 is PathValidationResult.Invalid)

        // Mixed literal dot + encoded slash
        val res6 = policy.validateDocumentPath("/api/letters/..%2fsecrets")
        assertTrue("..%2f (encoded slash) must be rejected", res6 is PathValidationResult.Invalid)

        // Encoded dot + encoded backslash
        val res7 = policy.validateDocumentPath("/api/letters/%2e%2e%5csecrets")
        assertTrue("%2e%2e%5c must be rejected", res7 is PathValidationResult.Invalid)
    }

    @Test
    fun validateDocumentPath_rejectsSchemeAndHostInjection() {
        // Absolute URL with https scheme
        val res1 = policy.validateDocumentPath("https://attacker.com/api/letters/123/issued")
        assertTrue(res1 is PathValidationResult.Invalid)

        // Plain http scheme
        val res2 = policy.validateDocumentPath("http://localhost/api/letters/123/issued")
        assertTrue(res2 is PathValidationResult.Invalid)

        // File scheme
        val res3 = policy.validateDocumentPath("file:///android_asset/database.sqlite")
        assertTrue(res3 is PathValidationResult.Invalid)

        // Scheme-relative URL with double leading slashes
        val res4 = policy.validateDocumentPath("//attacker.com/api/letters/123/issued")
        assertTrue(res4 is PathValidationResult.Invalid)

        // Encoded double slashes
        val res5 = policy.validateDocumentPath("/%2f%2fattacker.com")
        assertTrue(res5 is PathValidationResult.Invalid)
    }

    @Test
    fun validateDocumentPath_rejectsQuerySchemeInjection() {
        // External redirect scheme in query
        val res1 = policy.validateDocumentPath("/api/letters/123/issued?redirect=https://evil.com")
        assertTrue(res1 is PathValidationResult.Invalid)

        // Encoded scheme injection in query
        val res2 = policy.validateDocumentPath("/api/letters/123/issued?target=https%3A%2F%2Fattacker.com")
        assertTrue(res2 is PathValidationResult.Invalid)
    }

    @Test
    fun validateDocumentPath_rejectsForbiddenPrefixesAndEmptyInput() {
        assertTrue(policy.validateDocumentPath("") is PathValidationResult.Invalid)
        assertTrue(policy.validateDocumentPath(null) is PathValidationResult.Invalid)
        assertTrue(policy.validateDocumentPath("/admin/users") is PathValidationResult.Invalid)
        assertTrue(policy.validateDocumentPath("/api/unauthorized/endpoint") is PathValidationResult.Invalid)
        assertTrue(policy.validateDocumentPath("A".repeat(5000)) is PathValidationResult.Invalid)
    }

    // -------------------------------------------------------------------------
    // Phase 2.2 — Double-encoding and multi-layer traversal tests (NEW)
    // -------------------------------------------------------------------------

    @Test
    fun validateDocumentPath_rejectsDoubleEncodedDotSegments() {
        // %252e%252e — double-encoded: %25 decodes to %, giving %2e%2e, which decodes to ..
        // Layer 0 catches this immediately: %25 in path component is forbidden.
        val res1 = policy.validateDocumentPath("/api/letters/%252e%252e/secrets")
        assertTrue(
            "Double-encoded %252e%252e must be rejected",
            res1 is PathValidationResult.Invalid
        )

        // %25252e%25252e — triple-encoded
        val res2 = policy.validateDocumentPath("/api/letters/%25252e%25252e/secrets")
        assertTrue(
            "Triple-encoded %25252e%25252e must be rejected",
            res2 is PathValidationResult.Invalid
        )

        // %252e%252e%252f — double-encoded dot-dot-slash
        val res3 = policy.validateDocumentPath("/api/letters/%252e%252e%252fconfig")
        assertTrue(
            "Double-encoded %252e%252e%252f must be rejected",
            res3 is PathValidationResult.Invalid
        )
    }

    @Test
    fun validateDocumentPath_rejectsDoubleEncodedBackslash() {
        // %255c%255c — double-encoded backslash (Windows path separator)
        val res = policy.validateDocumentPath("/api/letters/%255c%255cconfig")
        assertTrue(
            "Double-encoded backslash %255c%255c must be rejected",
            res is PathValidationResult.Invalid
        )
    }

    @Test
    fun validateDocumentPath_rejectsMalformedPercentEncoding() {
        // Incomplete percent sequence: %2 (missing second hex digit)
        val res1 = policy.validateDocumentPath("/api/letters/file%2")
        assertTrue(
            "Malformed percent encoding %2 (incomplete) must be rejected",
            res1 is PathValidationResult.Invalid
        )

        // Lone percent sign (not a valid percent-encoded sequence)
        val res2 = policy.validateDocumentPath("/api/letters/file%ZZname")
        assertTrue(
            "Invalid percent sequence %ZZ must be rejected",
            res2 is PathValidationResult.Invalid
        )

        // Truncated escape at end of string
        val res3 = policy.validateDocumentPath("/api/letters/file%")
        assertTrue(
            "Truncated percent at end of string must be rejected",
            res3 is PathValidationResult.Invalid
        )
    }

    @Test
    fun validateDocumentPath_rejectsEncodedNullByte() {
        // %00 — encoded null byte in path
        val res1 = policy.validateDocumentPath("/api/letters/file%00name")
        assertTrue(
            "Encoded null byte %00 must be rejected",
            res1 is PathValidationResult.Invalid
        )

        // %2500 — double-encoded null byte (%25 -> %, giving %00 after second decode)
        // Layer 0 catches this: %25 is forbidden in path component.
        val res2 = policy.validateDocumentPath("/api/letters/file%2500name")
        assertTrue(
            "Double-encoded null byte %2500 must be rejected",
            res2 is PathValidationResult.Invalid
        )
    }

    @Test
    fun validateDocumentPath_rejectsEncodedSlashVariants() {
        // %2f — single-encoded forward slash (decoded to / which could create //)
        // Combined with preceding slash to attempt //
        val res1 = policy.validateDocumentPath("/api/letters/%2fattacker.com/secret")
        assertTrue(
            "Encoded slash %2f creating path ambiguity must be rejected",
            res1 is PathValidationResult.Invalid
        )

        // %5c — single-encoded backslash
        val res2 = policy.validateDocumentPath("/api/letters/%5cwindows%5csystem32")
        assertTrue(
            "Encoded backslash %5c must be rejected",
            res2 is PathValidationResult.Invalid
        )
    }

    @Test
    fun validateDocumentPath_rejectsAbsoluteUrlAndSchemeInjection() {
        // Full absolute URL passed as document path
        val res1 = policy.validateDocumentPath("https://evil.com/api/letters/x")
        assertTrue("Absolute https URL must be rejected", res1 is PathValidationResult.Invalid)

        // javascript: pseudo-scheme
        val res2 = policy.validateDocumentPath("javascript:alert(document.cookie)")
        assertTrue("javascript: scheme must be rejected", res2 is PathValidationResult.Invalid)

        // data: URI
        val res3 = policy.validateDocumentPath("data:text/html,<script>evil()</script>")
        assertTrue("data: URI must be rejected", res3 is PathValidationResult.Invalid)

        // Encoded scheme separator in path: %3A = ':', so this becomes "http://..."
        // URLDecoder on %3A produces ':', which together with // becomes absolute URL.
        val res4 = policy.validateDocumentPath("/api/letters/x?url=http%3A//evil.com")
        assertTrue(
            "Scheme injection via encoded colon in query must be rejected",
            res4 is PathValidationResult.Invalid
        )
    }

    @Test
    fun validateDocumentPath_allFiveAllowedPrefixesStillAccepted() {
        // Regression: ensure all five allowlisted document endpoints still pass after hardening.
        assertTrue(
            "Letters endpoint must still be accepted",
            policy.validateDocumentPath("/api/letters/uuid-abc/issued") is PathValidationResult.Valid
        )
        assertTrue(
            "Activities endpoint must still be accepted",
            policy.validateDocumentPath("/api/activities/act-123/documents/doc-1") is PathValidationResult.Valid
        )
        assertTrue(
            "Payments endpoint must still be accepted",
            policy.validateDocumentPath("/api/payments/pay-456/proof") is PathValidationResult.Valid
        )
        assertTrue(
            "Complaints endpoint must still be accepted",
            policy.validateDocumentPath("/api/complaints/comp-789/photo") is PathValidationResult.Valid
        )
        assertTrue(
            "Community feed media endpoint must still be accepted",
            policy.validateDocumentPath("/api/community-feed/media/feed-101") is PathValidationResult.Valid
        )
    }

    @Test
    fun validateDocumentPath_downloadFlagStillDetected() {
        // Regression: download query param detection must survive the new hardening.
        val result = policy.validateDocumentPath("/api/letters/uuid-123/issued?download=1")
        assertTrue(result is PathValidationResult.Valid)
        assertTrue((result as PathValidationResult.Valid).isDownload)
    }

    // -------------------------------------------------------------------------
    // Phase 5.2 — Notification deep-link navigation path validator
    // -------------------------------------------------------------------------

    @Test
    fun validateNotificationPath_acceptsResidentRouteVariants() {
        assertTrue(policy.validateNotificationPath("/resident") is PathValidationResult.Valid)
        assertTrue(
            policy.validateNotificationPath("/resident/announcements/uuid-123") is PathValidationResult.Valid
        )
        assertTrue(policy.validateNotificationPath("/resident/bills/uuid-456") is PathValidationResult.Valid)
        assertTrue(policy.validateNotificationPath("/resident/complaints") is PathValidationResult.Valid)
        assertTrue(
            policy.validateNotificationPath("/resident/bills?status=unpaid") is PathValidationResult.Valid
        )

        val result = policy.validateNotificationPath("/resident/letters/uuid-789") as PathValidationResult.Valid
        assertEquals("/resident/letters/uuid-789", result.path)
        assertFalse("Navigation targets are never flagged as downloads", result.isDownload)
    }

    @Test
    fun validateNotificationPath_rejectsOutsideResidentRoot() {
        assertTrue(policy.validateNotificationPath("/") is PathValidationResult.Invalid)
        assertTrue(policy.validateNotificationPath("/login") is PathValidationResult.Invalid)
        assertTrue(policy.validateNotificationPath("/api/letters/uuid/issued") is PathValidationResult.Invalid)
        // Lookalike admin route sharing the "/resident" prefix as a raw substring.
        assertTrue(
            "Must not match /resident-invitations via loose prefix matching",
            policy.validateNotificationPath("/resident-invitations") is PathValidationResult.Invalid
        )
    }

    @Test
    fun validateNotificationPath_rejectsBackofficeRoutes() {
        assertTrue(policy.validateNotificationPath("/bills") is PathValidationResult.Invalid)
        assertTrue(policy.validateNotificationPath("/residents") is PathValidationResult.Invalid)
        assertTrue(policy.validateNotificationPath("/super-admin") is PathValidationResult.Invalid)
    }

    @Test
    fun validateNotificationPath_rejectsSchemeAndHostInjection() {
        assertTrue(
            policy.validateNotificationPath("https://attacker.com/resident") is PathValidationResult.Invalid
        )
        assertTrue(
            policy.validateNotificationPath("javascript:alert(1)") is PathValidationResult.Invalid
        )
        assertTrue(
            policy.validateNotificationPath("file:///etc/passwd") is PathValidationResult.Invalid
        )
        assertTrue(
            policy.validateNotificationPath("//attacker.com/resident") is PathValidationResult.Invalid
        )
    }

    @Test
    fun validateNotificationPath_rejectsTraversalAndEncodedTraversal() {
        assertTrue(
            policy.validateNotificationPath("/resident/../../etc/passwd") is PathValidationResult.Invalid
        )
        assertTrue(
            policy.validateNotificationPath("/resident/%2e%2e/%2e%2e/admin") is PathValidationResult.Invalid
        )
        assertTrue(
            policy.validateNotificationPath("/resident/%252e%252e/secrets") is PathValidationResult.Invalid
        )
        assertTrue(
            policy.validateNotificationPath("/resident\\..\\secrets") is PathValidationResult.Invalid
        )
    }

    @Test
    fun validateNotificationPath_rejectsQuerySchemeInjection() {
        assertTrue(
            policy.validateNotificationPath("/resident/bills?next=https://evil.com") is PathValidationResult.Invalid
        )
        assertTrue(
            policy.validateNotificationPath(
                "/resident/bills?next=https%3A%2F%2Fevil.com"
            ) is PathValidationResult.Invalid
        )
    }

    @Test
    fun validateNotificationPath_rejectsEmptyAndOversizedInput() {
        assertTrue(policy.validateNotificationPath(null) is PathValidationResult.Invalid)
        assertTrue(policy.validateNotificationPath("") is PathValidationResult.Invalid)
        assertTrue(policy.validateNotificationPath("/resident/" + "a".repeat(5000)) is PathValidationResult.Invalid)
    }
}
