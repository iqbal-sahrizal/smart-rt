package id.smartrt.resident.bridge

import id.smartrt.resident.security.TrustedOriginPolicy
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Unit tests verifying WebMessageListener bridge security, iframe blocking,
 * origin cryptographic isolation, and document action allowlisting.
 */
class SmartRtNativeBridgeTest {

    private lateinit var originPolicy: TrustedOriginPolicy
    private lateinit var processor: NativeBridgeMessageProcessor

    private val trustedOrigin = "https://smart-rt-staging.vercel.app"
    private val untrustedOrigin = "https://attacker.com"

    private var logoutCalled = false
    private var notifPermissionCalled = false
    private var pullToRefreshLocked: Boolean? = null
    private var lastDocAction: DocumentAction? = null

    data class DocumentAction(
        val path: String,
        val fileName: String,
        val mimeType: String,
        val isDownload: Boolean
    )

    private val testCallbacks = object : NativeBridgeMessageProcessor.Callbacks {
        override fun onLogoutNotified() {
            logoutCalled = true
        }

        override fun onNotificationPermissionRequested() {
            notifPermissionCalled = true
        }

        override fun onDocumentActionRequested(
            path: String,
            fileName: String,
            mimeType: String,
            isDownload: Boolean
        ) {
            lastDocAction = DocumentAction(path, fileName, mimeType, isDownload)
        }

        override fun onPullToRefreshLockChanged(locked: Boolean) {
            pullToRefreshLocked = locked
        }
    }

    @Before
    fun setUp() {
        originPolicy = TrustedOriginPolicy(allowedHost = "smart-rt-staging.vercel.app")
        logoutCalled = false
        notifPermissionCalled = false
        pullToRefreshLocked = null
        lastDocAction = null

        processor = NativeBridgeMessageProcessor(
            originPolicy = originPolicy,
            callbacks = testCallbacks
        )
    }

    @Test
    fun iframeIsolation_strictlyRejectsMessagesFromIframes() {
        val message = JSONObject().apply {
            put("action", "getAppInfo")
            put("id", "req-1")
        }.toString()

        // Attempt invocation from iframe hosted on the trusted origin
        val response = processor.processIncomingMessage(
            rawMessage = message,
            sourceOrigin = trustedOrigin,
            isMainFrame = false // embedded iframe
        )

        assertTrue("Response must be an Error", response is NativeBridgeResponse.Error)
        val error = response as NativeBridgeResponse.Error
        assertTrue(error.error.contains("restricted to top-level main frame"))
    }

    @Test
    fun originIsolation_strictlyRejectsMessagesFromUntrustedOrigins() {
        val message = JSONObject().apply {
            put("action", "getAppInfo")
            put("id", "req-2")
        }.toString()

        val response = processor.processIncomingMessage(
            rawMessage = message,
            sourceOrigin = untrustedOrigin,
            isMainFrame = true
        )

        assertTrue(response is NativeBridgeResponse.Error)
        val error = response as NativeBridgeResponse.Error
        assertTrue(error.error.contains("Unauthorized message origin"))
    }

    @Test
    fun originIsolation_rejectsLookalikeOrigins() {
        val lookalikeOrigin = "https://smart-rt-staging.vercel.app.malicious.net"
        val message = JSONObject().apply {
            put("action", "getAppInfo")
        }.toString()

        val response = processor.processIncomingMessage(
            rawMessage = message,
            sourceOrigin = lookalikeOrigin,
            isMainFrame = true
        )

        assertTrue(response is NativeBridgeResponse.Error)
    }

    @Test
    fun getAppInfo_succeedsForAuthorizedMainFrame() {
        val message = JSONObject().apply {
            put("action", "getAppInfo")
            put("id", "req-3")
        }.toString()

        val response = processor.processIncomingMessage(
            rawMessage = message,
            sourceOrigin = trustedOrigin,
            isMainFrame = true
        )

        assertTrue(response is NativeBridgeResponse.Success)
        val success = response as NativeBridgeResponse.Success
        assertEquals("getAppInfo", success.action)
        assertEquals("req-3", success.id)
        assertEquals(2, success.data.getInt("bridgeVersion"))
        assertEquals("android", success.data.getString("platform"))
        assertEquals("WebMessageListener", success.data.getString("bridgeMechanism"))
    }

    @Test
    fun notifyLogout_executesOnlyForAuthorizedMainFrame() {
        val message = JSONObject().apply {
            put("action", "notifyLogout")
        }.toString()

        val response = processor.processIncomingMessage(
            rawMessage = message,
            sourceOrigin = trustedOrigin,
            isMainFrame = true
        )

        assertTrue(response is NativeBridgeResponse.Success)
        assertTrue("Logout callback must be triggered", logoutCalled)

        // Attempt from untrusted origin
        logoutCalled = false
        val untrustedResponse = processor.processIncomingMessage(
            rawMessage = message,
            sourceOrigin = untrustedOrigin,
            isMainFrame = true
        )
        assertTrue(untrustedResponse is NativeBridgeResponse.Error)
        assertFalse("Logout callback must NOT be triggered on untrusted origin", logoutCalled)
    }

    @Test
    fun requestNotificationPermission_dispatchesCallback() {
        val message = JSONObject().apply {
            put("action", "requestNotificationPermission")
            put("id", "req-notif")
        }.toString()

        val response = processor.processIncomingMessage(
            rawMessage = message,
            sourceOrigin = trustedOrigin,
            isMainFrame = true
        )

        assertTrue(response is NativeBridgeResponse.Success)
        assertTrue(notifPermissionCalled)
    }

    @Test
    fun openOrDownloadPrivateDocument_acceptsValidLetterPath() {
        val message = JSONObject().apply {
            put("action", "openOrDownloadPrivateDocument")
            put("id", "doc-1")
            put("payload", JSONObject().apply {
                put("path", "/api/letters/uuid-123/issued")
                put("fileName", "Surat_Keterangan.pdf")
                put("mimeType", "application/pdf")
                put("mode", "download")
            })
        }.toString()

        val response = processor.processIncomingMessage(
            rawMessage = message,
            sourceOrigin = trustedOrigin,
            isMainFrame = true
        )

        assertTrue(response is NativeBridgeResponse.Success)
        val success = response as NativeBridgeResponse.Success
        assertTrue(success.data.getBoolean("accepted"))
        assertEquals("/api/letters/uuid-123/issued", lastDocAction?.path)
        assertEquals("Surat_Keterangan.pdf", lastDocAction?.fileName)
        assertEquals("application/pdf", lastDocAction?.mimeType)
        assertTrue(lastDocAction?.isDownload == true)
    }

    @Test
    fun openOrDownloadPrivateDocument_rejectsEncodedPathTraversal() {
        val message = JSONObject().apply {
            put("action", "openOrDownloadPrivateDocument")
            put("payload", JSONObject().apply {
                put("path", "/api/letters/%2e%2e/admin/secrets")
                put("fileName", "secrets.txt")
                put("mimeType", "application/pdf")
            })
        }.toString()

        val response = processor.processIncomingMessage(
            rawMessage = message,
            sourceOrigin = trustedOrigin,
            isMainFrame = true
        )

        assertTrue(response is NativeBridgeResponse.Error)
        val error = response as NativeBridgeResponse.Error
        assertTrue(error.error.contains("Forbidden document path"))
        assertEquals(null, lastDocAction)
    }

    @Test
    fun openOrDownloadPrivateDocument_rejectsSchemeAndHostInjection() {
        val message = JSONObject().apply {
            put("action", "openOrDownloadPrivateDocument")
            put("payload", JSONObject().apply {
                put("path", "https://attacker.com/api/letters/uuid/issued")
                put("fileName", "file.pdf")
                put("mimeType", "application/pdf")
            })
        }.toString()

        val response = processor.processIncomingMessage(
            rawMessage = message,
            sourceOrigin = trustedOrigin,
            isMainFrame = true
        )

        assertTrue(response is NativeBridgeResponse.Error)
    }

    @Test
    fun openOrDownloadPrivateDocument_rejectsUnsupportedMime() {
        val message = JSONObject().apply {
            put("action", "openOrDownloadPrivateDocument")
            put("payload", JSONObject().apply {
                put("path", "/api/letters/uuid/issued")
                put("fileName", "exploit.sh")
                put("mimeType", "application/x-sh")
            })
        }.toString()

        val response = processor.processIncomingMessage(
            rawMessage = message,
            sourceOrigin = trustedOrigin,
            isMainFrame = true
        )

        assertTrue(response is NativeBridgeResponse.Error)
        val error = response as NativeBridgeResponse.Error
        assertTrue(error.error.contains("Unsupported document MIME type"))
    }

    @Test
    fun payloadValidation_rejectsOversizedPayload() {
        val oversized = "A".repeat(5000)
        val response = processor.processIncomingMessage(
            rawMessage = oversized,
            sourceOrigin = trustedOrigin,
            isMainFrame = true
        )

        assertTrue(response is NativeBridgeResponse.Error)
        val error = response as NativeBridgeResponse.Error
        assertTrue(error.error.contains("exceeds maximum allowed limit"))
    }

    @Test
    fun unknownAction_returnsCleanErrorResponse() {
        val message = JSONObject().apply {
            put("action", "arbitraryInternalMethod")
            put("id", "unknown-1")
        }.toString()

        val response = processor.processIncomingMessage(
            rawMessage = message,
            sourceOrigin = trustedOrigin,
            isMainFrame = true
        )

        assertTrue(response is NativeBridgeResponse.Error)
        val error = response as NativeBridgeResponse.Error
        assertTrue(error.error.contains("Unsupported or unrecognized bridge action"))
        assertEquals("unknown-1", error.id)
    }

    @Test
    fun getPushToken_returnsCachedTokenWhenAvailable() {
        val testToken = "fcm_test_token_sample_12345"
        val customProcessor = NativeBridgeMessageProcessor(
            originPolicy = originPolicy,
            callbacks = testCallbacks,
            tokenProvider = { testToken }
        )

        val message = JSONObject().apply {
            put("action", "getPushToken")
            put("id", "req-fcm-1")
        }.toString()

        val response = customProcessor.processIncomingMessage(
            rawMessage = message,
            sourceOrigin = trustedOrigin,
            isMainFrame = true
        )

        assertTrue(response is NativeBridgeResponse.Success)
        val success = response as NativeBridgeResponse.Success
        assertEquals("getPushToken", success.action)
        assertEquals("req-fcm-1", success.id)
        assertEquals(testToken, success.data.getString("token"))
        assertTrue(success.data.getBoolean("hasToken"))
        assertEquals("android", success.data.getString("platform"))
    }

    @Test
    fun getPushToken_returnsEmptyWhenNoTokenCached() {
        val message = JSONObject().apply {
            put("action", "getPushToken")
            put("id", "req-fcm-empty")
        }.toString()

        val response = processor.processIncomingMessage(
            rawMessage = message,
            sourceOrigin = trustedOrigin,
            isMainFrame = true
        )

        assertTrue(response is NativeBridgeResponse.Success)
        val success = response as NativeBridgeResponse.Success
        assertEquals("getPushToken", success.action)
        assertEquals("", success.data.getString("token"))
        assertFalse(success.data.getBoolean("hasToken"))
        assertEquals("android", success.data.getString("platform"))
    }

    @Test
    fun requestNotificationPermission_triggersCallback() {
        val message = JSONObject().apply {
            put("action", "requestNotificationPermission")
            put("id", "req-notif-perm")
        }.toString()

        val response = processor.processIncomingMessage(
            rawMessage = message,
            sourceOrigin = trustedOrigin,
            isMainFrame = true
        )

        assertTrue(response is NativeBridgeResponse.Success)
        val success = response as NativeBridgeResponse.Success
        assertEquals("requestNotificationPermission", success.action)
        assertEquals("requested", success.data.getString("status"))
        assertTrue(notifPermissionCalled)
    }

    @Test
    fun setPullToRefreshLocked_updatesCallbackLockState() {
        val lockMsg = JSONObject().apply {
            put("action", "setPullToRefreshLocked")
            put("payload", JSONObject().apply { put("locked", true) })
        }.toString()

        val lockResp = processor.processIncomingMessage(
            rawMessage = lockMsg,
            sourceOrigin = trustedOrigin,
            isMainFrame = true
        )
        assertTrue(lockResp is NativeBridgeResponse.Success)
        assertEquals(true, pullToRefreshLocked)

        val unlockMsg = JSONObject().apply {
            put("action", "setPullToRefreshLocked")
            put("payload", JSONObject().apply { put("locked", false) })
        }.toString()

        val unlockResp = processor.processIncomingMessage(
            rawMessage = unlockMsg,
            sourceOrigin = trustedOrigin,
            isMainFrame = true
        )
        assertTrue(unlockResp is NativeBridgeResponse.Success)
        assertEquals(false, pullToRefreshLocked)
    }
}
