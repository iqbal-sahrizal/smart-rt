package id.smartrt.resident.media

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.core.content.FileProvider
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Smart RT — Camera Capture File Manager
 *
 * Creates and manages temporary files for camera capture.
 * Files are stored in app-private cache (getCacheDir()/camera/).
 * They are never accessible to other apps directly — only through FileProvider content URIs.
 *
 * Cleanup policy:
 * - `cleanupCameraCache()` removes all files in the camera cache dir.
 * - Called on Activity onDestroy and after upload completes.
 * - Files are intentionally NOT persisted beyond the capture-upload lifecycle.
 */
object CameraFileManager {

    private const val TAG = "CameraFileManager"
    const val FILE_PROVIDER_AUTHORITY = "id.smartrt.resident.fileprovider"

    private const val CAMERA_CACHE_DIR = "camera"
    private const val PRIVATE_DOCS_DIR = "private_docs"

    /**
     * Creates a temporary JPEG file in app-private cache for camera capture.
     * Returns a [FileProvider] content URI suitable for passing to the camera intent.
     * Returns null if file creation fails.
     *
     * The file name encodes a timestamp — no user-identifiable data.
     */
    fun createCameraCaptureUri(context: Context): Uri? {
        return try {
            val cameraDir = File(context.cacheDir, CAMERA_CACHE_DIR).also { it.mkdirs() }
            val timestamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(Date())
            val file = File(cameraDir, "capture_$timestamp.jpg")
            FileProvider.getUriForFile(context, FILE_PROVIDER_AUTHORITY, file)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to create camera capture file")
            null
        }
    }

    /**
     * Creates a temporary file in app-private cache for a privately-downloaded document.
     * Returns a [FileProvider] content URI for use with Intent.ACTION_VIEW.
     * Returns null if file creation fails.
     *
     * [sanitizedName] must already be sanitized by the caller.
     */
    fun createPrivateDocUri(context: Context, sanitizedName: String): Pair<File, Uri>? {
        return try {
            val docsDir = File(context.cacheDir, PRIVATE_DOCS_DIR).also { it.mkdirs() }
            val file = File(docsDir, sanitizedName)
            val uri = FileProvider.getUriForFile(context, FILE_PROVIDER_AUTHORITY, file)
            Pair(file, uri)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to create private document file")
            null
        }
    }

    /**
     * Removes all files in the app-private camera cache directory.
     * Does not throw — errors are silently logged.
     */
    fun cleanupCameraCache(context: Context) {
        try {
            val cameraDir = File(context.cacheDir, CAMERA_CACHE_DIR)
            cameraDir.listFiles()?.forEach { it.delete() }
        } catch (_: Exception) {
            Log.w(TAG, "Camera cache cleanup encountered an error")
        }
    }

    /**
     * Removes all files in the app-private downloaded documents cache directory.
     */
    fun cleanupPrivateDocsCache(context: Context) {
        try {
            val docsDir = File(context.cacheDir, PRIVATE_DOCS_DIR)
            docsDir.listFiles()?.forEach { it.delete() }
        } catch (_: Exception) {
            Log.w(TAG, "Private docs cache cleanup encountered an error")
        }
    }

    /**
     * Removes a specific file from cache by its content URI.
     * Silently no-ops if the file cannot be found or deleted.
     */
    fun deleteFile(file: File) {
        try {
            file.delete()
        } catch (_: Exception) { /* ignore */ }
    }
}

