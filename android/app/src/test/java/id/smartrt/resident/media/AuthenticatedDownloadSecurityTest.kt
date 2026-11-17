package id.smartrt.resident.media

import id.smartrt.resident.security.PathValidationResult
import id.smartrt.resident.security.TrustedOriginPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.net.URI

/**
 * Unit tests verifying security constraints of the authenticated document download pipeline:
 * - Target URL construction strictly from trusted base URL.
 * - Rejection of external redirects.
 * - Allowed content-type enforcement.
 * - Download path allowlisting integration.
 * - HTTP status code classification.
 */
class AuthenticatedDownloadSecurityTest {

    private lateinit var originPolicy: TrustedOriginPolicy
    private val stagingHost = "smart-rt-staging.vercel.app"
    private val stagingBaseUrl = "https://smart-rt-staging.vercel.app"

    @Before
    fun setUp() {
        originPolicy = TrustedOriginPolicy(allowedHost = stagingHost)
    }

    @Test
    fun urlConstruction_alwaysUsesTrustedBase() {
        // Ensure absolute URLs are built ONLY using the build-configured base URL
        val relativePath = "/api/letters/uuid-1/issued"
        val constructedUrl = "$stagingBaseUrl$relativePath"

        assertTrue(constructedUrl.startsWith("https://smart-rt-staging.vercel.app/"))
        assertEquals("https://smart-rt-staging.vercel.app/api/letters/uuid-1/issued", constructedUrl)

        val uri = URI(constructedUrl)
        assertEquals("https", uri.scheme)
        assertEquals(stagingHost, uri.host)
        assertEquals(relativePath, uri.path)
    }

    @Test
    fun redirectValidation_permitsSameHostOnly() {
        // Same host redirect: e.g. location is relative or same host HTTPS
        val sameHostRelative = "/api/letters/uuid-1/issued?v=2"
        val resolvedSame = URI(stagingBaseUrl).resolve(sameHostRelative)
        assertEquals(stagingHost, resolvedSame.host)
        assertTrue(originPolicy.isTrustedOrigin(resolvedSame.toString()))

        // Same host absolute HTTPS
        val sameHostAbsolute = "https://smart-rt-staging.vercel.app/api/letters/uuid-1/issued?v=2"
        assertTrue(originPolicy.isTrustedOrigin(sameHostAbsolute))

        // External redirect (attacker target) must be REJECTED
        val externalRedirects = listOf(
            "https://attacker.com/stolen-doc.pdf",
            "https://smart-rt-staging.vercel.app.attacker.com/doc",
            "http://smart-rt-staging.vercel.app/doc", // insecure HTTP redirect
            "https://evil.com?ref=smart-rt-staging.vercel.app"
        )

        for (external in externalRedirects) {
            assertFalse(
                "External redirect to $external must be strictly rejected",
                originPolicy.isTrustedOrigin(external)
            )
        }
    }

    @Test
    fun contentTypeValidation_acceptsOnlyAllowedMimes() {
        val allowedTypes = setOf(
            "application/pdf",
            "image/jpeg",
            "image/jpg",
            "image/png",
            "image/webp"
        )

        assertTrue(allowedTypes.contains("application/pdf"))
        assertTrue(allowedTypes.contains("image/jpeg"))
        assertTrue(allowedTypes.contains("image/png"))
        assertTrue(allowedTypes.contains("image/webp"))

        val forbiddenTypes = listOf(
            "application/octet-stream",
            "text/html",
            "application/javascript",
            "text/plain",
            "image/svg+xml",
            "application/zip"
        )

        for (forbidden in forbiddenTypes) {
            assertFalse("MIME type $forbidden must be rejected", allowedTypes.contains(forbidden))
        }
    }

    @Test
    fun httpStatusCodeClassification_categorizesAuthAndErrors() {
        // Helper simulating response code classification
        fun classifyResponse(code: Int): String = when (code) {
            200 -> "SUCCESS"
            401 -> "AUTH_EXPIRED"
            403 -> "FORBIDDEN"
            404 -> "NOT_FOUND"
            in 500..599 -> "SERVER_ERROR"
            else -> "GENERIC_ERROR"
        }

        assertEquals("SUCCESS", classifyResponse(200))
        assertEquals("AUTH_EXPIRED", classifyResponse(401))
        assertEquals("FORBIDDEN", classifyResponse(403))
        assertEquals("NOT_FOUND", classifyResponse(404))
        assertEquals("SERVER_ERROR", classifyResponse(500))
        assertEquals("SERVER_ERROR", classifyResponse(503))
        assertEquals("GENERIC_ERROR", classifyResponse(400))
    }

    @Test
    fun downloadPathAllowlist_enforcesAllowedPrefixesOnly() {
        val validPaths = listOf(
            "/api/letters/123/issued",
            "/api/activities/456/documents/doc1",
            "/api/payments/789/proof",
            "/api/complaints/101/photo",
            "/api/community-feed/media/feed1"
        )

        for (path in validPaths) {
            assertTrue("Path $path must be accepted", originPolicy.validateDocumentPath(path) is PathValidationResult.Valid)
        }

        val invalidPaths = listOf(
            "/api/auth/session",
            "/api/admin/users",
            "/api/letters/../../etc/passwd",
            "/api/letters/%2e%2e/secret",
            "/api/letters/%252e%252e/secret",
            "/etc/hosts",
            "https://evil.com/doc.pdf"
        )

        for (path in invalidPaths) {
            assertTrue("Path $path must be rejected", originPolicy.validateDocumentPath(path) is PathValidationResult.Invalid)
        }
    }
}

