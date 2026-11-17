package id.smartrt.resident.webview

import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests verifying user agent string augmentation.
 */
class SmartRtWebViewConfigTest {

    @Test
    fun buildUserAgent_appendsSmartRtTokenCorrectly() {
        val original = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36"
        val custom = SmartRtWebViewConfig.buildUserAgent(original)

        assertTrue(custom.startsWith(original))
        assertTrue(custom.contains("SmartRTAndroid/"))
        assertTrue(custom.contains("Build/"))
    }

    @Test
    fun buildUserAgent_handlesNullOriginalSafely() {
        val custom = SmartRtWebViewConfig.buildUserAgent(null)
        assertTrue(custom.contains("SmartRTAndroid/"))
    }
}

