package id.smartrt.resident.security

import java.net.URI
import java.net.URLDecoder

sealed class PathValidationResult {
    data class Valid(val path: String, val isDownload: Boolean) : PathValidationResult()
    data class Invalid(val reason: String) : PathValidationResult()
}

/**
 * Smart RT — Trusted Origin & Navigation Security Policy
 *
 * Enforces strict HTTPS origin boundaries, path filtering, and document path allowlisting
 * to ensure the WebView shell only executes trusted code from the authorized Next.js deployment.
 */
class TrustedOriginPolicy(
    val allowedHost: String,
    val allowedScheme: String = "https"
) {

    /**
     * Returns the exact origin rule string required by WebViewCompat.addWebMessageListener
     * (e.g. "https://smart-rt-staging.vercel.app").
     */
    fun getAllowedOriginRule(): String {
        return "$allowedScheme://$allowedHost"
    }

    /**
     * Validates whether a raw URL string belongs strictly to the allowlisted HTTPS origin.
     * Rejects:
     * - Non-HTTPS schemes (e.g. http:, file:, javascript:, data:, content:)
     * - Lookalike domains (e.g. smart-rt-staging.vercel.app.attacker.com, evilsmartrt.id)
     * - Subdomain tricks / substring matches
     * - UserInfo credentials (e.g. https://user:pass@host)
     * - Malformed URLs
     */
    fun isTrustedOrigin(rawUrl: String?): Boolean {
        if (rawUrl.isNullOrBlank()) return false

        return try {
            val uri = URI(rawUrl.trim())

            // Strict scheme check
            val scheme = uri.scheme ?: return false
            if (!scheme.equals(allowedScheme, ignoreCase = true)) return false

            // Reject URLs containing userinfo (credential injection attempt)
            if (uri.userInfo != null) return false

            // Strict exact host check (case-insensitive, no substring / lookalike tolerance)
            val host = uri.host ?: return false
            host.equals(allowedHost, ignoreCase = true)
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Checks if the target path is an authorized resident application route.
     */
    fun isAllowedResidentPath(path: String?): Boolean {
        if (path.isNullOrBlank()) return false
        val normalized = if (path.startsWith("/")) path else "/$path"
        val cleanPath = normalized.substringBefore("?").substringBefore("#")

        return ALLOWED_RESIDENT_PREFIXES.any { prefix ->
            cleanPath == prefix || cleanPath.startsWith("$prefix/")
        }
    }

    /**
     * Identifies Backoffice-only management routes.
     */
    fun isBackofficeRoute(path: String?): Boolean {
        if (path.isNullOrBlank()) return false
        val normalized = if (path.startsWith("/")) path else "/$path"
        val cleanPath = normalized.substringBefore("?").substringBefore("#")

        if (cleanPath == "/") return true

        return BACKOFFICE_ROUTES.any { route ->
            route != "/" && (cleanPath == route || cleanPath.startsWith("$route/"))
        }
    }

    /**
     * Checks if a URL scheme should be delegated to an external system app (e.g. phone call, email, WhatsApp).
     */
    fun isExternalIntentScheme(rawUrl: String?): Boolean {
        if (rawUrl.isNullOrBlank()) return false
        return try {
            val scheme = URI(rawUrl).scheme?.lowercase() ?: return false
            ALLOWED_EXTERNAL_SCHEMES.contains(scheme) ||
                (scheme == "https" && rawUrl.startsWith("https://wa.me/"))
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Validates bridge payload size to prevent memory exhaustion.
     */
    fun isPayloadSizeSafe(payload: String?): Boolean {
        if (payload == null) return true
        return payload.toByteArray(Charsets.UTF_8).size <= MAX_PAYLOAD_SIZE
    }

    /**
     * Strict document path validator with multi-pass decode hardening.
     *
     * Enforces fail-closed policy at every layer:
     *
     * Layer 0 — Raw pattern rejection:
     *   Rejects %25-encoded sequences that could survive a single decode pass and emerge as
     *   dangerous sequences in a second pass (%252e, %255c, %2500 etc.). Any path containing
     *   a bare %25 (encoded percent sign) in the path component is immediately rejected.
     *
     * Layer 1 — Iterative decode loop (up to MAX_DECODE_ITERATIONS passes):
     *   Decodes the path repeatedly until it stabilises. If the decoded form ever contains
     *   traversal sequences or control characters the path is rejected immediately.
     *   Malformed percent sequences from any single pass cause immediate rejection.
     *
     * Layer 2 — URI structure validation:
     *   Rejects absolute URIs, scheme presence, authority/host/userinfo presence,
     *   scheme-relative double-slash paths, and encoded double-slash variants.
     *
     * Layer 3 — Normalized path allowlist check:
     *   URI.normalize() collapses dot-segments. Allowlist prefix matching is performed
     *   only on the fully-normalized path, never on the raw input.
     *
     * Layer 4 — Query parameter inspection:
     *   Rejects scheme injection patterns in query values. Does NOT decode query values
     *   to prevent redirect-param manipulation.
     *
     * Permitted path prefixes (unchanged):
     *   /api/letters/, /api/activities/, /api/payments/, /api/complaints/,
     *   /api/community-feed/media/
     */
    fun validateDocumentPath(rawPath: String?): PathValidationResult {
        if (rawPath.isNullOrBlank()) {
            return PathValidationResult.Invalid("Path is empty or null")
        }

        if (!isPayloadSizeSafe(rawPath)) {
            return PathValidationResult.Invalid("Path exceeds size limit")
        }

        val trimmed = rawPath.trim()

        // --- LAYER 0: Raw pattern rejection before any decoding ---

        // Reject null bytes in raw input (before any decoding).
        if (trimmed.contains('\u0000')) {
            return PathValidationResult.Invalid("Null byte detected in raw path")
        }

        // Extract only the path component (before '?') for raw pattern checks.
        val rawPathComponent = trimmed.substringBefore('?')

        // Reject any %25 sequence in the path component. %25 is an encoded percent-sign.
        // Its presence indicates attempted double-encoding (%252e -> %2e -> '.', etc.).
        // Legitimate API paths in this application never require a literal '%' character.
        if (RAW_ENCODED_PERCENT.containsMatchIn(rawPathComponent)) {
            return PathValidationResult.Invalid(
                "Double-encoded or percent-encoded percent sign detected in path (%25); " +
                    "path traversal via multi-layer encoding is not permitted"
            )
        }

        // Reject encoded null bytes in raw input (%00, case-insensitive).
        if (RAW_ENCODED_NULL.containsMatchIn(rawPathComponent)) {
            return PathValidationResult.Invalid("Encoded null byte detected in path")
        }

        // Reject double leading slashes in the raw input (scheme-relative URL injection).
        if (trimmed.startsWith("//")) {
            return PathValidationResult.Invalid("Scheme-relative path (double leading slash) is not permitted")
        }

        // --- LAYER 1: Iterative decode until stable, reject traversal at each pass ---

        var current = rawPathComponent
        repeat(MAX_DECODE_ITERATIONS) {
            val next = try {
                URLDecoder.decode(current, "UTF-8")
            } catch (_: Exception) {
                return PathValidationResult.Invalid("Malformed percent encoding detected during iterative decode")
            }

            // Check for traversal sequences, backslashes, null bytes after each decode pass.
            if (next.contains("..") ||
                next.contains('\\') ||
                next.contains('\u0000') ||
                next.contains("//")
            ) {
                return PathValidationResult.Invalid(
                    "Path traversal, backslash, null byte, or double slash detected after decode pass"
                )
            }

            // Stable — no further decoding changes the string; break early.
            if (next == current) return@repeat
            current = next
        }

        // Final fully-decoded path component.
        val fullyDecodedPath = current

        // --- LAYER 2: URI structure validation ---

        val uri = try {
            URI(trimmed)
        } catch (_: Exception) {
            return PathValidationResult.Invalid("Invalid URI format")
        }

        if (uri.isAbsolute) {
            return PathValidationResult.Invalid("Absolute URIs with scheme are not permitted")
        }
        if (uri.scheme != null) {
            return PathValidationResult.Invalid("Explicit scheme is not permitted")
        }
        if (uri.authority != null || uri.host != null || uri.userInfo != null || uri.port != -1) {
            return PathValidationResult.Invalid("Host, authority, or userinfo injection is not permitted")
        }

        // Double slashes after decode (URI parser may not catch all variants).
        if (fullyDecodedPath.contains("//")) {
            return PathValidationResult.Invalid("Double slash in decoded path is not permitted")
        }

        // --- LAYER 3: Normalized path allowlist check ---

        uri.path ?: return PathValidationResult.Invalid("Path component missing after URI parse")
        val normalizedPath = uri.normalize().path
            ?: return PathValidationResult.Invalid("Path normalization failed")

        // Dot-segment collapse: if normalization produces traversal sequences it is a defect.
        if (normalizedPath.contains("..") || normalizedPath.contains('\\')) {
            return PathValidationResult.Invalid("Dot-segment traversal detected in normalized path")
        }

        val isPrefixAllowed = ALLOWED_DOCUMENT_PREFIXES.any { prefix ->
            normalizedPath.startsWith(prefix)
        }
        if (!isPrefixAllowed) {
            return PathValidationResult.Invalid("Path does not match any allowed document endpoint prefix")
        }

        // --- LAYER 4: Query parameter inspection (no decoding of query values) ---

        val query = uri.query
        var isDownload = false
        if (query != null) {
            // Reject literal scheme injection in query values.
            if (query.contains("://")) {
                return PathValidationResult.Invalid("Query parameter contains forbidden scheme injection (literal)")
            }
            // Reject encoded scheme separators (%3A%2F%2F = ://, case-insensitive).
            if (query.contains("%3A%2F%2F", ignoreCase = true)) {
                return PathValidationResult.Invalid("Query parameter contains forbidden scheme injection (encoded)")
            }
            if (query.contains("download=1") || query.contains("download=true")) {
                isDownload = true
            }
        }

        val fullRelativePath = if (query != null) "$normalizedPath?$query" else normalizedPath
        return PathValidationResult.Valid(fullRelativePath, isDownload)
    }

    /**
     * Strict notification deep-link path validator (Phase 5.2).
     *
     * Validates a path extracted from a push-notification navigation payload before it is
     * ever loaded into the WebView. This is deliberately independent from
     * [validateDocumentPath] — it targets the Resident content root (`/resident`) rather than
     * the document API endpoints, and is re-run at the point of consumption (not just at the
     * point the notification was built) because [id.smartrt.resident.MainActivity] is an
     * exported launcher activity: any component on the device can start it with an arbitrary
     * `target_url` extra, so this check cannot assume the path only ever came from our own
     * Firebase Cloud Messaging payload.
     *
     * Applies the same fail-closed layering as [validateDocumentPath]:
     *  - Layer 0: raw pattern rejection (encoded percent/null, scheme-relative `//`).
     *  - Layer 1: iterative decode loop rejecting traversal/backslash/null/double-slash.
     *  - Layer 2: URI structural validation (no scheme, authority, userinfo, or port).
     *  - Layer 3: normalized-path allowlist check against the Resident root only.
     *  - Layer 4: query literal/encoded scheme-injection rejection (no download flag — this
     *    is navigation, not document retrieval).
     *
     * Backoffice routes are rejected explicitly as well, even though they cannot overlap with
     * the `/resident` root by construction — this is a deliberate redundant check.
     */
    fun validateNotificationPath(rawPath: String?): PathValidationResult {
        if (rawPath.isNullOrBlank()) {
            return PathValidationResult.Invalid("Path is empty or null")
        }

        if (!isPayloadSizeSafe(rawPath)) {
            return PathValidationResult.Invalid("Path exceeds size limit")
        }

        val trimmed = rawPath.trim()

        // --- LAYER 0: Raw pattern rejection before any decoding ---

        if (trimmed.contains('\u0000')) {
            return PathValidationResult.Invalid("Null byte detected in raw path")
        }

        val rawPathComponent = trimmed.substringBefore('?')

        if (RAW_ENCODED_PERCENT.containsMatchIn(rawPathComponent)) {
            return PathValidationResult.Invalid(
                "Double-encoded or percent-encoded percent sign detected in path (%25); " +
                    "path traversal via multi-layer encoding is not permitted"
            )
        }

        if (RAW_ENCODED_NULL.containsMatchIn(rawPathComponent)) {
            return PathValidationResult.Invalid("Encoded null byte detected in path")
        }

        if (trimmed.startsWith("//")) {
            return PathValidationResult.Invalid("Scheme-relative path (double leading slash) is not permitted")
        }

        // --- LAYER 1: Iterative decode until stable, reject traversal at each pass ---

        var current = rawPathComponent
        repeat(MAX_DECODE_ITERATIONS) {
            val next = try {
                URLDecoder.decode(current, "UTF-8")
            } catch (_: Exception) {
                return PathValidationResult.Invalid("Malformed percent encoding detected during iterative decode")
            }

            if (next.contains("..") ||
                next.contains('\\') ||
                next.contains('\u0000') ||
                next.contains("//")
            ) {
                return PathValidationResult.Invalid(
                    "Path traversal, backslash, null byte, or double slash detected after decode pass"
                )
            }

            if (next == current) return@repeat
            current = next
        }

        val fullyDecodedPath = current

        // --- LAYER 2: URI structure validation ---

        val uri = try {
            URI(trimmed)
        } catch (_: Exception) {
            return PathValidationResult.Invalid("Invalid URI format")
        }

        if (uri.isAbsolute) {
            return PathValidationResult.Invalid("Absolute URIs with scheme are not permitted")
        }
        if (uri.scheme != null) {
            return PathValidationResult.Invalid("Explicit scheme is not permitted")
        }
        if (uri.authority != null || uri.host != null || uri.userInfo != null || uri.port != -1) {
            return PathValidationResult.Invalid("Host, authority, or userinfo injection is not permitted")
        }

        if (fullyDecodedPath.contains("//")) {
            return PathValidationResult.Invalid("Double slash in decoded path is not permitted")
        }

        // --- LAYER 3: Normalized path allowlist check (Resident root only) ---

        uri.path ?: return PathValidationResult.Invalid("Path component missing after URI parse")
        val normalizedPath = uri.normalize().path
            ?: return PathValidationResult.Invalid("Path normalization failed")

        if (normalizedPath.contains("..") || normalizedPath.contains('\\')) {
            return PathValidationResult.Invalid("Dot-segment traversal detected in normalized path")
        }

        val isResidentRoot = normalizedPath == NOTIFICATION_DEEPLINK_ROOT ||
            normalizedPath.startsWith("$NOTIFICATION_DEEPLINK_ROOT/")
        if (!isResidentRoot) {
            return PathValidationResult.Invalid("Path is outside the Resident navigation root")
        }
        if (isBackofficeRoute(normalizedPath)) {
            return PathValidationResult.Invalid("Path matches a Backoffice-only route")
        }

        // --- LAYER 4: Query parameter inspection (no decoding of query values) ---

        val query = uri.query
        if (query != null) {
            if (query.contains("://")) {
                return PathValidationResult.Invalid("Query parameter contains forbidden scheme injection (literal)")
            }
            if (query.contains("%3A%2F%2F", ignoreCase = true)) {
                return PathValidationResult.Invalid("Query parameter contains forbidden scheme injection (encoded)")
            }
        }

        val fullRelativePath = if (query != null) "$normalizedPath?$query" else normalizedPath
        return PathValidationResult.Valid(fullRelativePath, isDownload = false)
    }

    /**
     * Strict Android App Link validator for Resident account activation URLs.
     *
     * Enforces fail-closed validation:
     * - Must match trusted HTTPS origin ([isTrustedOrigin]).
     * - Rejects raw/encoded traversal (`..`, `%25`, `%00`, `\`, `//`) and fragments.
     * - Path must normalize strictly to `/activate-account`.
     * - Query must contain a single valid `token` matching `[A-Za-z0-9_-]{32,128}`
     *   with no scheme injection (`://` / `%3A%2F%2F`).
     * - Returns ONLY the reconstructed canonical `/activate-account?token=<token>`
     *   path (stripping any extra query parameters to eliminate open redirects).
     */
    fun validateInvitationAppLink(rawUrl: String?): PathValidationResult {
        if (rawUrl.isNullOrBlank()) {
            return PathValidationResult.Invalid("App link URL is empty or null")
        }

        if (!isPayloadSizeSafe(rawUrl)) {
            return PathValidationResult.Invalid("App link URL exceeds size limit")
        }

        val trimmed = rawUrl.trim()
        if (!isTrustedOrigin(trimmed)) {
            return PathValidationResult.Invalid("App link origin is not trusted")
        }

        if (trimmed.contains('\u0000') || trimmed.contains('\\')) {
            return PathValidationResult.Invalid("Forbidden control or backslash character in App link")
        }

        val uri = try {
            URI(trimmed)
        } catch (_: Exception) {
            return PathValidationResult.Invalid("Malformed App link URI")
        }

        if (uri.rawFragment != null) {
            return PathValidationResult.Invalid("Fragment is not permitted in invitation App link")
        }

        val rawPath = uri.rawPath ?: return PathValidationResult.Invalid("Missing App link path")
        if (RAW_ENCODED_PERCENT.containsMatchIn(rawPath) || RAW_ENCODED_NULL.containsMatchIn(rawPath)) {
            return PathValidationResult.Invalid("Forbidden percent or null encoding in App link path")
        }

        var decodedPath = rawPath
        repeat(MAX_DECODE_ITERATIONS) {
            val next = try {
                URLDecoder.decode(decodedPath, "UTF-8")
            } catch (_: Exception) {
                return PathValidationResult.Invalid("Malformed percent encoding in App link path")
            }
            if (next.contains("..") || next.contains('\\') || next.contains('\u0000') || next.contains("//")) {
                return PathValidationResult.Invalid("Traversal or forbidden sequence in App link path")
            }
            if (next == decodedPath) return@repeat
            decodedPath = next
        }

        val normalizedPath = uri.normalize().path ?: return PathValidationResult.Invalid("Failed to normalize App link path")
        if (normalizedPath != INVITATION_ACTIVATION_PATH) {
            return PathValidationResult.Invalid("App link route is not an allowed invitation path")
        }

        val rawQuery = uri.rawQuery ?: return PathValidationResult.Invalid("Missing invitation token query")
        if (rawQuery.contains("://") || rawQuery.contains("%3A%2F%2F", ignoreCase = true)) {
            return PathValidationResult.Invalid("Scheme injection in App link query is not permitted")
        }

        var extractedToken: String? = null
        for (pair in rawQuery.split('&')) {
            if (pair.isEmpty()) continue
            val eqIdx = pair.indexOf('=')
            if (eqIdx <= 0) continue
            val key = try {
                URLDecoder.decode(pair.substring(0, eqIdx), "UTF-8")
            } catch (_: Exception) {
                return PathValidationResult.Invalid("Malformed query key in App link")
            }
            if (key == "token") {
                if (extractedToken != null) {
                    return PathValidationResult.Invalid("Duplicate token parameter in App link")
                }
                val valDecoded = try {
                    URLDecoder.decode(pair.substring(eqIdx + 1), "UTF-8").trim()
                } catch (_: Exception) {
                    return PathValidationResult.Invalid("Malformed token encoding in App link")
                }
                if (!INVITATION_TOKEN_REGEX.matches(valDecoded)) {
                    return PathValidationResult.Invalid("Invalid invitation token format in App link")
                }
                extractedToken = valDecoded
            }
        }

        val safeToken = extractedToken ?: return PathValidationResult.Invalid("Invitation token is missing")
        return PathValidationResult.Valid("$INVITATION_ACTIVATION_PATH?token=$safeToken", isDownload = false)
    }

    companion object {
        const val MAX_PAYLOAD_SIZE = 4096
        private const val INVITATION_ACTIVATION_PATH = "/activate-account"
        private val INVITATION_TOKEN_REGEX = Regex("^[A-Za-z0-9_-]{32,128}$")

        /**
         * Root path under which all notification deep-link navigation targets must fall.
         * Boundary-checked (`== root` or `startsWith("$root/")`) so lookalike admin routes
         * such as `/resident-invitations` can never match.
         */
        private const val NOTIFICATION_DEEPLINK_ROOT = "/resident"

        /**
         * Maximum number of decode iterations for the iterative decode loop.
         * 3 passes catch triple-encoded inputs (%25252e -> %252e -> %2e -> '.').
         * Beyond this depth, encoding is pathological and rejected by default.
         */
        private const val MAX_DECODE_ITERATIONS = 3

        // Matches any %25 sequence (encoded percent sign) in a path component.
        // Presence indicates attempted double/multi-layer encoding.
        private val RAW_ENCODED_PERCENT = Regex("%25", RegexOption.IGNORE_CASE)

        // Matches encoded null byte %00 in a path component.
        private val RAW_ENCODED_NULL = Regex("%00", RegexOption.IGNORE_CASE)

        // Allowed path prefixes inside the Resident Mobile Shell
        private val ALLOWED_RESIDENT_PREFIXES = listOf(
            "/resident",
            "/login",
            "/select-tenant",
            "/activate-account",
            "/auth",
            "/no-access",
            "/api",
            "/_next",
            "/icons",
            "/manifest.webmanifest",
            "/offline.html",
            "/favicon.ico"
        )

        // Backoffice routes that should not be navigated within the Resident app
        private val BACKOFFICE_ROUTES = listOf(
            "/",
            "/bills",
            "/dues",
            "/payments",
            "/cash",
            "/residents",
            "/resident-invitations",
            "/announcements",
            "/pengaduan",
            "/surat",
            "/kegiatan",
            "/ronda",
            "/komunitas",
            "/pengaturan",
            "/super-admin"
        )

        // Allowed external intent schemes
        private val ALLOWED_EXTERNAL_SCHEMES = setOf(
            "tel",
            "mailto",
            "whatsapp",
            "geo"
        )

        // Strict allowlist of document endpoints authorized for native interaction
        private val ALLOWED_DOCUMENT_PREFIXES = listOf(
            "/api/letters/",
            "/api/activities/",
            "/api/payments/",
            "/api/complaints/",
            "/api/community-feed/media/"
        )
    }
}
