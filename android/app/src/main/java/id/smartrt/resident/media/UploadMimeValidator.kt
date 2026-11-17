package id.smartrt.resident.media

import android.content.Context
import android.net.Uri
import android.webkit.MimeTypeMap

/**
 * Smart RT — Upload MIME Type & File Validator
 *
 * Validates files selected by the user before they are handed to the WebView.
 * Does NOT modify file content or spoof MIME types.
 * Server-side validation remains the authoritative last line of defence.
 */
object UploadMimeValidator {

    // Maximum file size accepted from the native picker (10 MB).
    // Server may impose a stricter limit — this is a client-side guard only.
    const val MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024L // 10 MB

    // MIME types permitted for image uploads (complaints, community feed, payment proof).
    val ALLOWED_IMAGE_MIMES = setOf(
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp"
    )

    // MIME types permitted for document uploads (payment proof PDF, letter attachments).
    val ALLOWED_DOCUMENT_MIMES = setOf(
        "application/pdf"
    )

    // All MIME types permitted across the entire application.
    val ALL_ALLOWED_MIMES = ALLOWED_IMAGE_MIMES + ALLOWED_DOCUMENT_MIMES

    // Extension allowlist — must match MIME allowlist.
    val ALLOWED_EXTENSIONS = setOf(
        "jpg", "jpeg", "png", "webp", "pdf"
    )

    private val EXTENSION_TO_MIME = mapOf(
        "jpg" to "image/jpeg",
        "jpeg" to "image/jpeg",
        "png" to "image/png",
        "webp" to "image/webp",
        "pdf" to "application/pdf"
    )

    fun getMimeFromExtension(ext: String): String? {
        val cleanExt = ext.lowercase().trim().removePrefix(".")
        return EXTENSION_TO_MIME[cleanExt] ?: try {
            MimeTypeMap.getSingleton()?.getMimeTypeFromExtension(cleanExt)?.lowercase()
        } catch (e: Exception) {
            null
        }
    }

    sealed class ValidationResult {
        data class Valid(val resolvedMime: String, val fileSizeBytes: Long) : ValidationResult()
        data class Invalid(val reason: String) : ValidationResult()
    }

    /**
     * Validates a content URI before it is passed to the WebView's ValueCallback.
     *
     * Checks:
     * 1. URI is not null and is a content:// URI.
     * 2. MIME type (from ContentResolver) is in the allowlist.
     * 3. Extension (from display name or URI path) is in the allowlist.
     * 4. MIME type and extension are consistent.
     * 5. File size is within the allowed limit.
     *
     * Does NOT:
     * - Read file content.
     * - Modify or re-encode the file.
     * - Spoof or override MIME types.
     */
    fun validate(context: Context, uri: Uri, acceptTypes: String): ValidationResult {
        // 1. Only content:// URIs are accepted from the picker.
        if (uri.scheme != "content") {
            return ValidationResult.Invalid(
                "Hanya file dari galeri atau kamera yang diizinkan (URI skema tidak valid)"
            )
        }

        val resolver = context.contentResolver

        // 2. Resolve MIME type from ContentResolver (authoritative for content:// URIs).
        val resolvedMime = resolver.getType(uri)?.lowercase()?.trim()
            ?: return ValidationResult.Invalid("Jenis file tidak dapat diidentifikasi")

        // 3. Check MIME type against global allowlist.
        if (!ALL_ALLOWED_MIMES.contains(resolvedMime)) {
            return ValidationResult.Invalid(
                "Jenis file '$resolvedMime' tidak diizinkan. Gunakan JPG, PNG, WEBP, atau PDF."
            )
        }

        // 4. Check MIME type against page-specific accept attribute (web contract compatibility).
        if (acceptTypes.isNotBlank() && !isAcceptedByWebPage(resolvedMime, acceptTypes)) {
            return ValidationResult.Invalid(
                "File tidak sesuai dengan jenis yang diterima halaman ini"
            )
        }

        // 5. Extension consistency check.
        val extension = getExtension(context, uri)
        if (extension != null && !ALLOWED_EXTENSIONS.contains(extension.lowercase())) {
            return ValidationResult.Invalid(
                "Ekstensi file '.$extension' tidak diizinkan"
            )
        }
        if (extension != null && !isMimeExtensionConsistent(resolvedMime, extension.lowercase())) {
            return ValidationResult.Invalid(
                "Ekstensi file '.$extension' tidak sesuai dengan jenis file '$resolvedMime'"
            )
        }

        // 6. File size check.
        val fileSizeBytes = getFileSize(context, uri)
        if (fileSizeBytes > MAX_FILE_SIZE_BYTES) {
            val sizeMb = fileSizeBytes / (1024 * 1024)
            return ValidationResult.Invalid(
                "Ukuran file (${sizeMb}MB) melebihi batas maksimum 10MB"
            )
        }
        if (fileSizeBytes <= 0L) {
            return ValidationResult.Invalid("File kosong atau tidak dapat dibaca")
        }

        return ValidationResult.Valid(resolvedMime, fileSizeBytes)
    }

    /**
     * Checks if [mimeType] is accepted by the web page's accept attribute string.
     * Handles MIME types, extensions (.jpg), and wildcards (e.g. image wildcard).
     */
    fun isAcceptedByWebPage(mimeType: String, acceptTypes: String): Boolean {
        if (acceptTypes.isBlank()) return true
        val accepts = acceptTypes.split(",").map { it.trim().lowercase() }
        return accepts.any { accept ->
            when {
                accept == mimeType -> true
                accept.endsWith("/*") -> mimeType.startsWith(accept.dropLast(1))
                accept.startsWith(".") -> {
                    val ext = accept.drop(1)
                    val expectedMime = getMimeFromExtension(ext)
                    expectedMime == mimeType
                }
                else -> false
            }
        }
    }

    /**
     * Returns the file extension from the display name or URI path.
     * Returns null if no extension is found.
     */
    fun getExtension(context: Context, uri: Uri): String? {
        // Try display name from cursor first (most reliable for content:// URIs).
        try {
            context.contentResolver.query(
                uri,
                arrayOf(android.provider.OpenableColumns.DISPLAY_NAME),
                null, null, null
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIdx = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                    if (nameIdx >= 0) {
                        val name = cursor.getString(nameIdx)
                        val dot = name?.lastIndexOf('.')
                        if (dot != null && dot >= 0 && dot < name.length - 1) {
                            return name.substring(dot + 1)
                        }
                    }
                }
            }
        } catch (_: Exception) { /* fall through to URI path */ }

        // Fall back to URI last path segment.
        val path = uri.lastPathSegment ?: return null
        val dot = path.lastIndexOf('.')
        return if (dot >= 0 && dot < path.length - 1) path.substring(dot + 1) else null
    }

    /**
     * Returns file size in bytes from ContentResolver. Returns 0 if unavailable.
     */
    fun getFileSize(context: Context, uri: Uri): Long {
        try {
            context.contentResolver.query(
                uri,
                arrayOf(android.provider.OpenableColumns.SIZE),
                null, null, null
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val sizeIdx = cursor.getColumnIndex(android.provider.OpenableColumns.SIZE)
                    if (sizeIdx >= 0) return cursor.getLong(sizeIdx)
                }
            }
        } catch (_: Exception) { /* ignore */ }
        return 0L
    }

    /**
     * Checks MIME type and extension consistency.
     * Avoids accepting e.g. a file named "malware.pdf" with MIME "image/jpeg".
     */
    fun isMimeExtensionConsistent(mimeType: String, extension: String): Boolean {
        val mappedMime = getMimeFromExtension(extension)
            ?: return true // Cannot verify — allow (server validates)

        // Normalize: image/jpg -> image/jpeg
        val normalizedResolved = if (mimeType == "image/jpg") "image/jpeg" else mimeType
        val normalizedMapped = if (mappedMime == "image/jpg") "image/jpeg" else mappedMime

        return normalizedResolved == normalizedMapped
    }
}

