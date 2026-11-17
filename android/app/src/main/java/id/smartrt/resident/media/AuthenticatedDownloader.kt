package id.smartrt.resident.media

import android.content.Context
import android.net.Uri
import android.util.Log
import id.smartrt.resident.BuildConfig
import id.smartrt.resident.security.TrustedOriginPolicy
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Smart RT — Authenticated Private Document Downloader
 *
 * Downloads private documents from Smart RT backend endpoints using the WebView's
 * existing session cookies (Supabase SSR auth) forwarded via the Cookie header.
 *
 * Security constraints (all enforced by callers):
 * - Only relative paths validated by [TrustedOriginPolicy.validateDocumentPath] are accepted.
 * - The base URL is constructed from [BuildConfig.WEB_BASE_URL] — never from JavaScript payload.
 * - Supabase tokens are NEVER extracted, logged, or forwarded to external origins.
 * - Redirect policy: follow only to the same trusted host; external redirects are aborted.
 * - Content-Type is validated against the MIME allowlist before writing to disk.
 * - File size is bounded by [MAX_DOWNLOAD_SIZE_BYTES].
 * - Temporary files land in app-private cache via [CameraFileManager.createPrivateDocUri].
 * - No URL, cookie value, or file path is printed to Android Log at any severity level.
 *
 * Authentication:
 * - The downloader copies the current WebView session cookie for the trusted origin.
 * - This reuses the authenticated session already established by the PWA — no separate login.
 * - Cookie values are forwarded only to the trusted origin — never logged or stored separately.
 */
class AuthenticatedDownloader(
    private val context: Context,
    private val trustedOriginPolicy: TrustedOriginPolicy
) {

    companion object {
        private const val TAG = "AuthenticatedDownloader"
        private const val MAX_DOWNLOAD_SIZE_BYTES = 20 * 1024 * 1024L // 20 MB
        private const val CONNECT_TIMEOUT_MS = 15_000
        private const val READ_TIMEOUT_MS = 30_000

        private val ALLOWED_CONTENT_TYPES = setOf(
            "application/pdf",
            "image/jpeg",
            "image/jpg",
            "image/png",
            "image/webp"
        )

        private val ALLOWED_CONTENT_TYPE_PREFIXES = listOf(
            "application/pdf",
            "image/jpeg",
            "image/jpg",
            "image/png",
            "image/webp"
        )
    }

    sealed class DownloadResult {
        data class Success(
            val file: File,
            val contentUri: Uri,
            val mimeType: String,
            val fileSizeBytes: Long
        ) : DownloadResult()

        data class Failure(val reason: String, val isAuthError: Boolean = false) : DownloadResult()
    }

    /**
     * Downloads a private document identified by [validatedRelativePath].
     *
     * [validatedRelativePath] MUST already be validated by [TrustedOriginPolicy.validateDocumentPath].
     * [cookieHeader] is the raw Cookie header string from the WebView's CookieManager for the
     * trusted origin — forwarded verbatim to the request, never logged.
     * [sanitizedFileName] is the sanitized filename for the local temp file.
     * [expectedMimeType] is the MIME type declared by the JavaScript caller.
     */
    fun download(
        validatedRelativePath: String,
        cookieHeader: String?,
        sanitizedFileName: String,
        expectedMimeType: String
    ): DownloadResult {
        // Build absolute URL from trusted base — never from JS payload.
        val absoluteUrl = "${BuildConfig.WEB_BASE_URL}$validatedRelativePath"

        val (tempFile, contentUri) = CameraFileManager.createPrivateDocUri(context, sanitizedFileName)
            ?: return DownloadResult.Failure("Gagal membuat file sementara untuk dokumen")

        var connection: HttpURLConnection? = null
        return try {
            connection = openTrustedConnection(absoluteUrl, cookieHeader)
                ?: return DownloadResult.Failure("Gagal membuka koneksi ke server")

            val responseCode = connection.responseCode
            when (responseCode) {
                HttpURLConnection.HTTP_OK -> { /* continue */ }
                HttpURLConnection.HTTP_UNAUTHORIZED -> {
                    tempFile.delete()
                    return DownloadResult.Failure(
                        "Sesi tidak valid. Silakan login kembali.",
                        isAuthError = true
                    )
                }
                HttpURLConnection.HTTP_FORBIDDEN -> {
                    tempFile.delete()
                    return DownloadResult.Failure(
                        "Akses ke dokumen ini tidak diizinkan.",
                        isAuthError = true
                    )
                }
                HttpURLConnection.HTTP_NOT_FOUND -> {
                    tempFile.delete()
                    return DownloadResult.Failure("Dokumen tidak ditemukan di server.")
                }
                else -> {
                    tempFile.delete()
                    return DownloadResult.Failure("Server mengembalikan error ($responseCode).")
                }
            }

            // Validate Content-Type from server response.
            val serverContentType = connection.contentType?.split(";")?.firstOrNull()
                ?.lowercase()?.trim()
                ?: run {
                    tempFile.delete()
                    return DownloadResult.Failure("Server tidak mengembalikan jenis konten yang valid.")
                }

            if (!ALLOWED_CONTENT_TYPES.contains(serverContentType)) {
                tempFile.delete()
                return DownloadResult.Failure(
                    "Server mengembalikan jenis konten yang tidak diizinkan: $serverContentType"
                )
            }

            // Cross-check with the expected MIME type declared by JavaScript caller.
            if (expectedMimeType.isNotBlank() && serverContentType != expectedMimeType) {
                // Allow image/jpg <-> image/jpeg aliasing.
                val normalizeJpeg = { m: String -> if (m == "image/jpg") "image/jpeg" else m }
                if (normalizeJpeg(serverContentType) != normalizeJpeg(expectedMimeType)) {
                    Log.w(TAG, "Server content-type mismatch with expected MIME")
                    // Log warning but proceed — server content-type wins.
                }
            }

            // Validate Content-Length if provided.
            val contentLength = connection.contentLengthLong
            if (contentLength > MAX_DOWNLOAD_SIZE_BYTES) {
                tempFile.delete()
                return DownloadResult.Failure(
                    "Dokumen terlalu besar untuk diunduh (maks 20MB)."
                )
            }

            // Stream to temp file with size guard.
            var totalBytes = 0L
            FileOutputStream(tempFile).use { output ->
                connection.inputStream.use { input ->
                    val buffer = ByteArray(8192)
                    var bytesRead: Int
                    while (input.read(buffer).also { bytesRead = it } != -1) {
                        totalBytes += bytesRead
                        if (totalBytes > MAX_DOWNLOAD_SIZE_BYTES) {
                            output.close()
                            tempFile.delete()
                            return DownloadResult.Failure("Dokumen melampaui batas ukuran maksimum.")
                        }
                        output.write(buffer, 0, bytesRead)
                    }
                }
            }

            if (totalBytes == 0L) {
                tempFile.delete()
                return DownloadResult.Failure("Dokumen yang diunduh kosong.")
            }

            DownloadResult.Success(
                file = tempFile,
                contentUri = contentUri,
                mimeType = serverContentType,
                fileSizeBytes = totalBytes
            )
        } catch (e: Exception) {
            tempFile.delete()
            Log.e(TAG, "Download failed with exception type: ${e.javaClass.simpleName}")
            DownloadResult.Failure("Gagal mengunduh dokumen. Periksa koneksi internet Anda.")
        } finally {
            connection?.disconnect()
        }
    }

    /**
     * Opens an [HttpURLConnection] to [absoluteUrl] restricted to the trusted host.
     *
     * Redirect policy: follows redirects only within the same trusted host.
     * External redirects are rejected to prevent cookie forwarding to untrusted origins.
     *
     * Cookie header is forwarded only to the initial trusted origin request.
     * No cookie values are written to logs at any point.
     */
    private fun openTrustedConnection(
        absoluteUrl: String,
        cookieHeader: String?
    ): HttpURLConnection? {
        return try {
            val url = URL(absoluteUrl)

            // Reject non-HTTPS even before connecting (belt-and-suspenders).
            if (url.protocol != "https") return null

            // Validate host belongs to trusted origin.
            if (!url.host.equals(trustedOriginPolicy.allowedHost, ignoreCase = true)) return null

            val connection = url.openConnection() as HttpURLConnection
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = READ_TIMEOUT_MS
            connection.instanceFollowRedirects = false // Manual redirect handling below

            // Forward session cookies to trusted origin only. Never log cookie values.
            if (!cookieHeader.isNullOrBlank()) {
                connection.setRequestProperty("Cookie", cookieHeader)
            }
            connection.setRequestProperty("Accept", ALLOWED_CONTENT_TYPE_PREFIXES.joinToString(", "))

            // Handle redirect manually to enforce host policy.
            val responseCode = connection.responseCode
            if (responseCode in 301..308) {
                val location = connection.getHeaderField("Location") ?: return null
                connection.disconnect()

                val redirectUrl = URL(url, location) // Resolve relative redirects
                if (redirectUrl.protocol != "https") return null
                if (!redirectUrl.host.equals(trustedOriginPolicy.allowedHost, ignoreCase = true)) {
                    Log.w(TAG, "Redirect to external host rejected")
                    return null
                }

                val redirectConn = redirectUrl.openConnection() as HttpURLConnection
                redirectConn.connectTimeout = CONNECT_TIMEOUT_MS
                redirectConn.readTimeout = READ_TIMEOUT_MS
                redirectConn.instanceFollowRedirects = false
                if (!cookieHeader.isNullOrBlank()) {
                    redirectConn.setRequestProperty("Cookie", cookieHeader)
                }
                return redirectConn
            }

            connection
        } catch (e: Exception) {
            Log.e(TAG, "Connection setup failed: ${e.javaClass.simpleName}")
            null
        }
    }
}

