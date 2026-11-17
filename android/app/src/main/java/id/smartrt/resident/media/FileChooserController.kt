package id.smartrt.resident.media

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.MediaStore
import android.util.Log
import android.webkit.MimeTypeMap
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import androidx.activity.result.ActivityResult
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity

/**
 * Smart RT — WebView File Chooser Controller
 *
 * Handles [WebChromeClient.onShowFileChooser] callbacks for the WebView.
 *
 * Responsibilities:
 * - Parses accept types from [WebChromeClient.FileChooserParams].
 * - Launches Photo Picker (images) or SAF document picker (documents/PDF).
 * - Launches camera capture via FileProvider when `capture` is requested.
 * - Validates selected URIs through [UploadMimeValidator] before returning to WebView.
 * - Ensures [ValueCallback] is completed exactly once.
 * - Handles cancellation, unavailable app, and validation failure.
 *
 * Security:
 * - `allowFileAccess = false` is preserved in WebView settings.
 * - Files are referenced by content:// URIs only — no file:// or filesystem paths.
 * - WebView receives content URIs, not raw filesystem paths.
 * - Sensitive file paths and URI values are not written to logs.
 */
class FileChooserController(private val activity: AppCompatActivity) {

    companion object {
        private const val TAG = "FileChooserController"
    }

    // Currently pending callback — must be completed exactly once.
    private var pendingCallback: ValueCallback<Array<Uri>>? = null

    // Pending camera capture URI (FileProvider URI for the temp file).
    private var pendingCameraUri: Uri? = null

    // Tracks whether callback has been completed to prevent double invocation.
    private var callbackCompleted = false

    // --- Activity Result Launchers (registered in Activity.onCreate) ---

    private val photoPickerLauncher: ActivityResultLauncher<Intent> =
        activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            handlePickerResult(result)
        }

    private val documentPickerLauncher: ActivityResultLauncher<Intent> =
        activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            handlePickerResult(result)
        }

    private val cameraLauncher: ActivityResultLauncher<Intent> =
        activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            handleCameraResult(result)
        }

    // -------------------------------------------------------------------------
    // Public entry point — called from SmartRtWebChromeClient.onShowFileChooser
    // -------------------------------------------------------------------------

    /**
     * Entry point for WebChromeClient file chooser.
     *
     * Returns true if the chooser was launched (WebView expects the app to handle it).
     * Returns false if unable to handle (WebView falls back to its own handling, if any).
     */
    fun onShowFileChooser(
        filePathCallback: ValueCallback<Array<Uri>>,
        fileChooserParams: WebChromeClient.FileChooserParams
    ): Boolean {
        // Abort any stale pending callback before starting a new one.
        abortPendingCallback()

        pendingCallback = filePathCallback
        callbackCompleted = false

        val acceptTypes = fileChooserParams.acceptTypes?.joinToString(",") ?: ""
        val allowMultiple = fileChooserParams.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE
        val captureRequested = fileChooserParams.isCaptureEnabled

        return when {
            captureRequested && isImageAccepted(acceptTypes) -> launchCamera()
            isOnlyPdfAccepted(acceptTypes) -> launchDocumentPicker(acceptTypes)
            isImageAccepted(acceptTypes) -> launchPhotoPicker(allowMultiple)
            acceptTypes.isBlank() -> launchPhotoPicker(allowMultiple) // Default to photo picker
            else -> launchDocumentPicker(acceptTypes)
        }
    }

    // -------------------------------------------------------------------------
    // Launchers
    // -------------------------------------------------------------------------

    private fun launchCamera(): Boolean {
        val captureUri = CameraFileManager.createCameraCaptureUri(activity)
        if (captureUri == null) {
            Log.e(TAG, "Failed to create camera capture URI")
            completeCallback(null)
            return false
        }

        pendingCameraUri = captureUri

        return try {
            val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                putExtra(MediaStore.EXTRA_OUTPUT, captureUri)
                addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            }
            cameraLauncher.launch(intent)
            true
        } catch (_: ActivityNotFoundException) {
            Log.w(TAG, "No camera app available")
            pendingCameraUri = null
            completeCallback(null)
            false
        }
    }

    private fun launchPhotoPicker(allowMultiple: Boolean): Boolean {
        return try {
            // Use Photo Picker (ACTION_PICK_IMAGES) on API 33+; fall back to ACTION_GET_CONTENT.
            val intent = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                Intent(android.provider.MediaStore.ACTION_PICK_IMAGES).apply {
                    if (allowMultiple) putExtra(android.provider.MediaStore.EXTRA_PICK_IMAGES_MAX, 10)
                    type = "image/*"
                }
            } else {
                Intent(Intent.ACTION_GET_CONTENT).apply {
                    type = "image/*"
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, allowMultiple)
                    addCategory(Intent.CATEGORY_OPENABLE)
                }
            }
            photoPickerLauncher.launch(intent)
            true
        } catch (_: ActivityNotFoundException) {
            Log.w(TAG, "No photo picker app available")
            completeCallback(null)
            false
        }
    }

    private fun launchDocumentPicker(acceptTypes: String): Boolean {
        return try {
            val mimeTypes = parseMimeTypesForSaf(acceptTypes)
            val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                type = if (mimeTypes.size == 1) mimeTypes[0] else "*/*"
                if (mimeTypes.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes.toTypedArray())
                addCategory(Intent.CATEGORY_OPENABLE)
            }
            documentPickerLauncher.launch(intent)
            true
        } catch (_: ActivityNotFoundException) {
            Log.w(TAG, "No document picker app available")
            completeCallback(null)
            false
        }
    }

    // -------------------------------------------------------------------------
    // Result handlers
    // -------------------------------------------------------------------------

    private fun handlePickerResult(result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) {
            completeCallback(null)
            return
        }

        val data = result.data
        val uris = mutableListOf<Uri>()

        // Multiple selection (ClipData).
        val clipData = data?.clipData
        if (clipData != null && clipData.itemCount > 0) {
            for (i in 0 until clipData.itemCount) {
                clipData.getItemAt(i).uri?.let { uris.add(it) }
            }
        } else {
            // Single selection.
            data?.data?.let { uris.add(it) }
        }

        if (uris.isEmpty()) {
            completeCallback(null)
            return
        }

        // Validate all URIs.
        val validatedUris = uris.filter { uri ->
            val validationResult = UploadMimeValidator.validate(activity, uri, "")
            if (validationResult is UploadMimeValidator.ValidationResult.Invalid) {
                Log.w(TAG, "File rejected by validator: ${validationResult.reason}")
            }
            validationResult is UploadMimeValidator.ValidationResult.Valid
        }

        if (validatedUris.isEmpty()) {
            activity.runOnUiThread {
                android.widget.Toast.makeText(
                    activity,
                    "File tidak valid atau tidak didukung",
                    android.widget.Toast.LENGTH_LONG
                ).show()
            }
            completeCallback(null)
        } else {
            completeCallback(validatedUris.toTypedArray())
        }
    }

    private fun handleCameraResult(result: ActivityResult) {
        val captureUri = pendingCameraUri
        pendingCameraUri = null

        if (result.resultCode != Activity.RESULT_OK || captureUri == null) {
            // User cancelled camera — clean up the empty temp file.
            CameraFileManager.cleanupCameraCache(activity)
            completeCallback(null)
            return
        }

        // Validate the captured image.
        val validationResult = UploadMimeValidator.validate(activity, captureUri, "image/*")
        if (validationResult is UploadMimeValidator.ValidationResult.Invalid) {
            Log.w(TAG, "Camera capture rejected: ${validationResult.reason}")
            activity.runOnUiThread {
                android.widget.Toast.makeText(
                    activity,
                    "Foto tidak valid: ${validationResult.reason}",
                    android.widget.Toast.LENGTH_LONG
                ).show()
            }
            CameraFileManager.cleanupCameraCache(activity)
            completeCallback(null)
            return
        }

        completeCallback(arrayOf(captureUri))
    }

    // -------------------------------------------------------------------------
    // Callback management — guaranteed single completion
    // -------------------------------------------------------------------------

    /**
     * Completes the pending [ValueCallback] exactly once.
     * Null [uris] signals cancellation to the WebView.
     */
    private fun completeCallback(uris: Array<Uri>?) {
        if (callbackCompleted) {
            Log.w(TAG, "completeCallback called after already completed — ignored")
            return
        }
        callbackCompleted = true
        val callback = pendingCallback
        pendingCallback = null
        // Null array = user cancelled; empty array is also treated as cancelled by Chrome.
        callback?.onReceiveValue(uris ?: emptyArray())
    }

    /**
     * Aborts any pending callback before starting a new chooser.
     * Required if a previous chooser was not properly dismissed.
     */
    private fun abortPendingCallback() {
        if (pendingCallback != null && !callbackCompleted) {
            Log.w(TAG, "Aborting stale pending file chooser callback")
            callbackCompleted = true
            pendingCallback?.onReceiveValue(emptyArray())
            pendingCallback = null
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private fun isImageAccepted(acceptTypes: String): Boolean {
        if (acceptTypes.isBlank()) return true
        return acceptTypes.contains("image/", ignoreCase = true) ||
            acceptTypes.contains(".jpg", ignoreCase = true) ||
            acceptTypes.contains(".jpeg", ignoreCase = true) ||
            acceptTypes.contains(".png", ignoreCase = true) ||
            acceptTypes.contains(".webp", ignoreCase = true)
    }

    private fun isOnlyPdfAccepted(acceptTypes: String): Boolean {
        if (acceptTypes.isBlank()) return false
        val parts = acceptTypes.split(",").map { it.trim().lowercase() }
        return parts.all { it == "application/pdf" || it == ".pdf" }
    }

    private fun parseMimeTypesForSaf(acceptTypes: String): List<String> {
        if (acceptTypes.isBlank()) return listOf("*/*")
        return acceptTypes.split(",").mapNotNull { raw ->
            val accept = raw.trim().lowercase()
            when {
                accept.startsWith(".") -> {
                    MimeTypeMap.getSingleton().getMimeTypeFromExtension(accept.drop(1))
                }
                accept.contains("/") -> accept
                else -> null
            }
        }.filter { UploadMimeValidator.ALL_ALLOWED_MIMES.contains(it) }
            .ifEmpty { listOf("*/*") }
    }
}

