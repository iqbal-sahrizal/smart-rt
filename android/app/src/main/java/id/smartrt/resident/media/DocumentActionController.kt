package id.smartrt.resident.media

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.webkit.CookieManager
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import id.smartrt.resident.BuildConfig
import id.smartrt.resident.security.PathValidationResult
import id.smartrt.resident.security.TrustedOriginPolicy
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Smart RT — Authenticated Document Download & PDF Preview Controller
 *
 * Handles requests from the Native Bridge to download and preview private documents.
 *
 * Security:
 * - Only paths validated by [TrustedOriginPolicy.validateDocumentPath] are accepted.
 * - Base URL is from [BuildConfig.WEB_BASE_URL] — never from JavaScript payload.
 * - Session cookies are forwarded only to the trusted origin; never logged.
 * - External redirects from the server are rejected.
 * - Content-Type from server is validated before writing to disk.
 * - Temporary files are stored in app-private cache and cleaned up after viewing.
 *
 * PDF Preview:
 * - After download, the PDF is opened via Intent.ACTION_VIEW with MIME "application/pdf".
 * - If no PDF viewer is installed, a user-friendly error is shown.
 * - The temp file is NOT exposed publicly — only via FileProvider content URI.
 */
class DocumentActionController(
    private val activity: AppCompatActivity,
    private val trustedOriginPolicy: TrustedOriginPolicy
) {

    companion object {
        private const val TAG = "DocumentActionController"
    }

    private val downloader = AuthenticatedDownloader(activity, trustedOriginPolicy)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    /**
     * Handles a document action (preview or download) requested via the Native Bridge.
     *
     * [validatedPath] must already be validated by [TrustedOriginPolicy.validateDocumentPath].
     * [fileName] must already be sanitized by the bridge processor.
     * [mimeType] is the MIME type declared by the JavaScript caller.
     * [isDownload] indicates whether the user requested a download (vs. in-app preview).
     */
    fun handleDocumentAction(
        validatedPath: String,
        fileName: String,
        mimeType: String,
        isDownload: Boolean
    ) {
        // Double-check path validation as a defence-in-depth guard.
        val pathCheck = trustedOriginPolicy.validateDocumentPath(validatedPath)
        if (pathCheck !is PathValidationResult.Valid) {
            showError("Permintaan dokumen tidak valid.")
            return
        }

        // Sanitize filename again at this layer.
        val safeName = sanitizeFileName(fileName, mimeType)

        // Get current session cookies for the trusted origin (never log the value).
        val cookieHeader = CookieManager.getInstance()
            .getCookie(BuildConfig.WEB_BASE_URL)

        val progressDialog = showProgressDialog()

        scope.launch {
            val result = withContext(Dispatchers.IO) {
                downloader.download(
                    validatedRelativePath = validatedPath,
                    cookieHeader = cookieHeader,
                    sanitizedFileName = safeName,
                    expectedMimeType = mimeType
                )
            }

            progressDialog.dismiss()

            when (result) {
                is AuthenticatedDownloader.DownloadResult.Success -> {
                    if (isDownload) {
                        openWithExternalViewer(result.contentUri, result.mimeType)
                        showToast("Dokumen berhasil diunduh")
                    } else {
                        openWithExternalViewer(result.contentUri, result.mimeType)
                    }

                    // Schedule cleanup after viewer is opened.
                    scheduleFileCleanup(result.file.name)
                }

                is AuthenticatedDownloader.DownloadResult.Failure -> {
                    if (result.isAuthError) {
                        showError(result.reason)
                    } else {
                        showError(result.reason)
                    }
                }
            }
        }
    }

    /**
     * Opens a file identified by [contentUri] using the system's default viewer.
     * For PDFs, this launches the PDF viewer. For images, the gallery or photo viewer.
     * Shows a user-friendly error if no suitable app is found.
     */
    private fun openWithExternalViewer(contentUri: Uri, mimeType: String) {
        try {
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(contentUri, mimeType)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activity.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            if (mimeType == "application/pdf") {
                showError("Aplikasi PDF tidak ditemukan. Pasang aplikasi PDF viewer untuk membuka dokumen ini.")
            } else {
                showError("Tidak ada aplikasi yang dapat membuka file ini.")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to open viewer: ${e.javaClass.simpleName}")
            showError("Gagal membuka dokumen.")
        }
    }

    private fun showProgressDialog(): androidx.appcompat.app.AlertDialog {
        val padding = (24 * activity.resources.displayMetrics.density).toInt()
        val progressBar = android.widget.ProgressBar(activity).apply {
            isIndeterminate = true
            setPadding(padding, padding, padding, padding)
        }
        return androidx.appcompat.app.AlertDialog.Builder(activity)
            .setMessage("Memuat dokumen...")
            .setView(progressBar)
            .setCancelable(false)
            .show()
    }

    private fun showToast(message: String) {
        Toast.makeText(activity, message, Toast.LENGTH_SHORT).show()
    }

    private fun showError(message: String) {
        Toast.makeText(activity, message, Toast.LENGTH_LONG).show()
    }

    /**
     * Schedules cleanup of the downloaded temp file after a short delay.
     * The delay allows the viewer intent to initialize before the file is removed.
     */
    private fun scheduleFileCleanup(fileName: String) {
        scope.launch {
            kotlinx.coroutines.delay(30_000) // 30 seconds — viewer should have loaded by then
            CameraFileManager.cleanupPrivateDocsCache(activity)
        }
    }

    /**
     * Sanitizes a filename to prevent path traversal and filesystem special characters.
     * Appends the correct extension for the given MIME type if missing.
     */
    fun sanitizeFileName(rawName: String, mimeType: String): String {
        // Strip any directory traversal components — extract basename only
        val basename = rawName.substringAfterLast('/').substringAfterLast('\\')
        // Replace .. and anything not alphanumeric, dash, underscore, or dot
        val safe = basename.replace("..", "_")
            .replace(Regex("[^a-zA-Z0-9._\\-]"), "_")
            .take(100) // Limit length
            .trimEnd('.')
            .ifBlank { "document" }

        // Ensure correct extension.
        val expectedExtension = mimeToExtension(mimeType) ?: return safe
        return if (safe.endsWith(".$expectedExtension", ignoreCase = true)) safe
        else "${safe}.$expectedExtension"
    }

    private fun mimeToExtension(mimeType: String): String? = when (mimeType) {
        "application/pdf" -> "pdf"
        "image/jpeg", "image/jpg" -> "jpg"
        "image/png" -> "png"
        "image/webp" -> "webp"
        else -> null
    }

    fun destroy() {
        scope.cancel()
    }
}

