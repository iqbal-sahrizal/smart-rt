package id.smartrt.resident.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for [UploadMimeValidator] — MIME type, extension consistency,
 * accept-type compatibility, and size boundary enforcement.
 *
 * Tests that do not require a real Android Context use the pure logic methods.
 * Tests requiring ContentResolver are covered by instrumentation tests (NOT RUN — no device).
 */
class UploadMimeValidatorTest {

    // -------------------------------------------------------------------------
    // isAcceptedByWebPage
    // -------------------------------------------------------------------------

    @Test
    fun isAcceptedByWebPage_acceptsExactMimeTypeMatch() {
        assertTrue(UploadMimeValidator.isAcceptedByWebPage("image/jpeg", "image/jpeg"))
        assertTrue(UploadMimeValidator.isAcceptedByWebPage("image/png", "image/jpeg,image/png"))
        assertTrue(UploadMimeValidator.isAcceptedByWebPage("application/pdf", "application/pdf"))
    }

    @Test
    fun isAcceptedByWebPage_acceptsWildcardMimeType() {
        assertTrue(UploadMimeValidator.isAcceptedByWebPage("image/jpeg", "image/*"))
        assertTrue(UploadMimeValidator.isAcceptedByWebPage("image/webp", "image/*"))
        assertFalse(UploadMimeValidator.isAcceptedByWebPage("application/pdf", "image/*"))
    }

    @Test
    fun isAcceptedByWebPage_acceptsExtensionNotation() {
        // .jpg maps to image/jpeg via MimeTypeMap
        assertTrue(UploadMimeValidator.isAcceptedByWebPage("image/jpeg", ".jpg"))
        assertTrue(UploadMimeValidator.isAcceptedByWebPage("image/jpeg", ".jpeg"))
        assertTrue(UploadMimeValidator.isAcceptedByWebPage("image/png", ".png"))
    }

    @Test
    fun isAcceptedByWebPage_rejectsNonMatchingMimeAgainstAcceptList() {
        assertFalse(
            UploadMimeValidator.isAcceptedByWebPage(
                "application/pdf",
                "image/jpeg,image/png,image/webp"
            )
        )
        assertFalse(
            UploadMimeValidator.isAcceptedByWebPage(
                "image/jpeg",
                "application/pdf"
            )
        )
    }

    @Test
    fun isAcceptedByWebPage_acceptsBlankAcceptTypesAsUnrestricted() {
        // A blank accept string means the page doesn't restrict file types.
        assertTrue(UploadMimeValidator.isAcceptedByWebPage("image/jpeg", ""))
        assertTrue(UploadMimeValidator.isAcceptedByWebPage("application/pdf", "   "))
    }

    @Test
    fun isAcceptedByWebPage_acceptsComplexBillsAcceptString() {
        // Finance component: accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
        val accept = ".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
        assertTrue(UploadMimeValidator.isAcceptedByWebPage("image/jpeg", accept))
        assertTrue(UploadMimeValidator.isAcceptedByWebPage("image/png", accept))
        assertTrue(UploadMimeValidator.isAcceptedByWebPage("application/pdf", accept))
        assertFalse(UploadMimeValidator.isAcceptedByWebPage("image/webp", accept))
    }

    // -------------------------------------------------------------------------
    // isMimeExtensionConsistent
    // -------------------------------------------------------------------------

    @Test
    fun isMimeExtensionConsistent_acceptsMatchingPairs() {
        assertTrue(UploadMimeValidator.isMimeExtensionConsistent("image/jpeg", "jpg"))
        assertTrue(UploadMimeValidator.isMimeExtensionConsistent("image/jpeg", "jpeg"))
        assertTrue(UploadMimeValidator.isMimeExtensionConsistent("image/png", "png"))
        assertTrue(UploadMimeValidator.isMimeExtensionConsistent("image/webp", "webp"))
        assertTrue(UploadMimeValidator.isMimeExtensionConsistent("application/pdf", "pdf"))
    }

    @Test
    fun isMimeExtensionConsistent_normalizesJpgAndJpeg() {
        // image/jpg and image/jpeg should both be treated as the same type.
        assertTrue(UploadMimeValidator.isMimeExtensionConsistent("image/jpg", "jpeg"))
        assertTrue(UploadMimeValidator.isMimeExtensionConsistent("image/jpeg", "jpg"))
    }

    @Test
    fun isMimeExtensionConsistent_rejectsMismatchedPairs() {
        assertFalse(UploadMimeValidator.isMimeExtensionConsistent("image/jpeg", "pdf"))
        assertFalse(UploadMimeValidator.isMimeExtensionConsistent("application/pdf", "jpg"))
        assertFalse(UploadMimeValidator.isMimeExtensionConsistent("image/png", "pdf"))
    }

    @Test
    fun isMimeExtensionConsistent_allowsUnknownExtension() {
        // If MimeTypeMap cannot resolve the extension, we allow it (server validates).
        assertTrue(UploadMimeValidator.isMimeExtensionConsistent("image/jpeg", "unknown_ext"))
    }

    // -------------------------------------------------------------------------
    // MAX_FILE_SIZE_BYTES boundary
    // -------------------------------------------------------------------------

    @Test
    fun maxFileSizeBytes_is10MB() {
        assertEquals(10 * 1024 * 1024L, UploadMimeValidator.MAX_FILE_SIZE_BYTES)
    }

    // -------------------------------------------------------------------------
    // MIME allowlists
    // -------------------------------------------------------------------------

    @Test
    fun allowedImageMimes_containsRequiredTypes() {
        assertTrue(UploadMimeValidator.ALLOWED_IMAGE_MIMES.contains("image/jpeg"))
        assertTrue(UploadMimeValidator.ALLOWED_IMAGE_MIMES.contains("image/png"))
        assertTrue(UploadMimeValidator.ALLOWED_IMAGE_MIMES.contains("image/webp"))
    }

    @Test
    fun allowedDocumentMimes_containsPdf() {
        assertTrue(UploadMimeValidator.ALLOWED_DOCUMENT_MIMES.contains("application/pdf"))
    }

    @Test
    fun allAllowedMimes_excludesDangerousTypes() {
        assertFalse(UploadMimeValidator.ALL_ALLOWED_MIMES.contains("application/octet-stream"))
        assertFalse(UploadMimeValidator.ALL_ALLOWED_MIMES.contains("text/html"))
        assertFalse(UploadMimeValidator.ALL_ALLOWED_MIMES.contains("application/javascript"))
        assertFalse(UploadMimeValidator.ALL_ALLOWED_MIMES.contains("image/svg+xml"))
        assertFalse(UploadMimeValidator.ALL_ALLOWED_MIMES.contains("application/zip"))
    }
}

