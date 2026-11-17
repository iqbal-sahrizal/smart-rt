package id.smartrt.resident.bridge

import android.annotation.SuppressLint
import android.net.Uri
import android.os.Build
import android.util.Log
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import id.smartrt.resident.BuildConfig
import id.smartrt.resident.security.PathValidationResult
import id.smartrt.resident.security.TrustedOriginPolicy
import org.json.JSONObject

sealed class BridgeInstallResult {
    object Installed : BridgeInstallResult()
    data class Unsupported(val reason: String) : BridgeInstallResult()
}

sealed class NativeBridgeResponse {
    data class Success(val action: String, val data: JSONObject, val id: String? = null) : NativeBridgeResponse() {
        override fun toJsonString(): String {
            return JSONObject().apply {
                put("success", true)
                put("action", action)
                if (id != null) put("id", id)
                put("data", data)
            }.toString()
        }
    }

    data class Error(val error: String, val action: String? = null, val id: String? = null) : NativeBridgeResponse() {
        override fun toJsonString(): String {
            return JSONObject().apply {
                put("success", false)
                if (action != null) put("action", action)
                if (id != null) put("id", id)
                put("error", error)
            }.toString()
        }
    }

    abstract fun toJsonString(): String
}

/**
 * Pure message processor enforcing:
 * - Top-level main-frame only (rejects all iframes)
 * - Source origin verification (must match trusted origin)
 * - Payload size boundaries (max 4096 bytes)
 * - Strict JSON schema and action catalog
 * - Document path allowlisting via URI parser
 */
class NativeBridgeMessageProcessor(
    private val originPolicy: TrustedOriginPolicy,
    private val callbacks: Callbacks,
    private val tokenProvider: () -> String? = { null }
) {
    interface Callbacks {
        fun onLogoutNotified()
        fun onNotificationPermissionRequested()
        fun onDocumentActionRequested(path: String, fileName: String, mimeType: String, isDownload: Boolean)
    }

    companion object {
        const val BRIDGE_VERSION = 2
        private val ALLOWED_DOCUMENT_MIMES = setOf(
            "application/pdf",
            "image/jpeg",
            "image/png",
            "image/webp"
        )
    }

    fun processIncomingMessage(
        rawMessage: String?,
        sourceOrigin: String?,
        isMainFrame: Boolean
    ): NativeBridgeResponse {
        // 1. Iframe rejection: strictly block all iframe communications
        if (!isMainFrame) {
            return NativeBridgeResponse.Error(
                error = "Bridge invocation is strictly restricted to top-level main frame documents",
                id = null
            )
        }

        // 2. Origin verification: must match exact allowlisted origin
        if (sourceOrigin == null || !originPolicy.isTrustedOrigin(sourceOrigin)) {
            return NativeBridgeResponse.Error(
                error = "Unauthorized message origin: ${sourceOrigin ?: "null"}",
                id = null
            )
        }

        // 3. Payload size check
        if (!originPolicy.isPayloadSizeSafe(rawMessage)) {
            return NativeBridgeResponse.Error(
                error = "Payload size exceeds maximum allowed limit (4096 bytes)",
                id = null
            )
        }

        if (rawMessage.isNullOrBlank()) {
            return NativeBridgeResponse.Error(
                error = "Empty message payload",
                id = null
            )
        }

        // 4. JSON parsing and action routing
        return try {
            val json = JSONObject(rawMessage)
            val action = json.optString("action", "").trim()
            val messageId = if (json.has("id")) json.optString("id") else null
            val payload = json.optJSONObject("payload")

            if (action.isEmpty()) {
                return NativeBridgeResponse.Error(
                    error = "Missing required 'action' field in bridge message",
                    id = messageId
                )
            }

            when (action) {
                "getAppInfo" -> {
                    val data = JSONObject().apply {
                        put("bridgeVersion", BRIDGE_VERSION)
                        put("appVersion", BuildConfig.VERSION_NAME)
                        put("buildCode", BuildConfig.VERSION_CODE)
                        put("platform", "android")
                        put("sdkInt", Build.VERSION.SDK_INT)
                        put("bridgeMechanism", "WebMessageListener")
                    }
                    NativeBridgeResponse.Success(action, data, messageId)
                }

                "notifyLogout" -> {
                    callbacks.onLogoutNotified()
                    val data = JSONObject().apply {
                        put("acknowledged", true)
                    }
                    NativeBridgeResponse.Success(action, data, messageId)
                }

                "requestNotificationPermission" -> {
                    callbacks.onNotificationPermissionRequested()
                    val data = JSONObject().apply {
                        put("status", "requested")
                    }
                    NativeBridgeResponse.Success(action, data, messageId)
                }

                "getPushToken" -> {
                    val token = tokenProvider()
                    val data = JSONObject().apply {
                        put("token", token ?: "")
                        put("hasToken", !token.isNullOrEmpty())
                        put("platform", "android")
                    }
                    NativeBridgeResponse.Success(action, data, messageId)
                }

                "openOrDownloadPrivateDocument" -> {
                    if (payload == null) {
                        return NativeBridgeResponse.Error(
                            error = "Missing 'payload' object for document action",
                            action = action,
                            id = messageId
                        )
                    }

                    val rawPath = payload.optString("path", "")
                    val fileName = payload.optString("fileName", "")
                    val mimeType = payload.optString("mimeType", "").lowercase().trim()

                    // Strict document path validation using URI parsing
                    when (val pathResult = originPolicy.validateDocumentPath(rawPath)) {
                        is PathValidationResult.Invalid -> {
                            NativeBridgeResponse.Error(
                                error = "Forbidden document path: ${pathResult.reason}",
                                action = action,
                                id = messageId
                            )
                        }
                        is PathValidationResult.Valid -> {
                            if (!ALLOWED_DOCUMENT_MIMES.contains(mimeType)) {
                                return NativeBridgeResponse.Error(
                                    error = "Unsupported document MIME type: $mimeType",
                                    action = action,
                                    id = messageId
                                )
                            }

                            val safeFileName = fileName.replace(Regex("[^a-zA-Z0-9._-]"), "_")
                            val isDownload = pathResult.isDownload || payload.optString("mode", "").equals("download", ignoreCase = true)

                            callbacks.onDocumentActionRequested(
                                pathResult.path,
                                safeFileName,
                                mimeType,
                                isDownload
                            )

                            val data = JSONObject().apply {
                                put("accepted", true)
                                put("path", pathResult.path)
                                put("fileName", safeFileName)
                                put("isDownload", isDownload)
                            }
                            NativeBridgeResponse.Success(action, data, messageId)
                        }
                    }
                }

                else -> {
                    NativeBridgeResponse.Error(
                        error = "Unsupported or unrecognized bridge action: $action",
                        action = action,
                        id = messageId
                    )
                }
            }
        } catch (_: Exception) {
            NativeBridgeResponse.Error(
                error = "Malformed JSON message format",
                id = null
            )
        }
    }
}

/**
 * Smart RT — Modern WebMessageListener Bridge
 *
 * Utilizes AndroidX WebViewCompat.addWebMessageListener for channel security.
 * Origin rules are verified by the Chromium engine itself.
 */
object SmartRtNativeBridge {

    const val INTERFACE_NAME = "SmartRTNative"
    private const val TAG = "SmartRtNativeBridge"

    class WebMessageBridge(
        private val processor: NativeBridgeMessageProcessor
    ) : WebViewCompat.WebMessageListener {
        // JavaScriptReplyProxy.postMessage is only reachable because onPostMessage was
        // triggered by a WebViewCompat.addWebMessageListener registration, which itself
        // is guarded by WebViewFeature.isFeatureSupported(WEB_MESSAGE_LISTENER) in
        // SmartRtNativeBridge.install(). The @SuppressLint is therefore safe by construction.
        @SuppressLint("RequiresFeature")
        override fun onPostMessage(
            view: WebView,
            message: WebMessageCompat,
            sourceOrigin: Uri,
            isMainFrame: Boolean,
            replyProxy: JavaScriptReplyProxy
        ) {
            val rawData = message.data ?: return
            val response = processor.processIncomingMessage(
                rawMessage = rawData,
                sourceOrigin = sourceOrigin.toString(),
                isMainFrame = isMainFrame
            )
            replyProxy.postMessage(response.toJsonString())
        }
    }

    /**
     * Installs WebMessageListener if supported by the system WebView provider.
     * If unsupported, native capabilities are DISABLED. No silent fallback to addJavascriptInterface.
     */
    fun install(
        webView: WebView,
        allowedOriginRules: Set<String>,
        processor: NativeBridgeMessageProcessor
    ): BridgeInstallResult {
        return if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(
                webView,
                INTERFACE_NAME,
                allowedOriginRules,
                WebMessageBridge(processor)
            )
            Log.i(TAG, "WebMessageListener installed successfully for origins: $allowedOriginRules")
            BridgeInstallResult.Installed
        } else {
            Log.w(
                TAG,
                "WebViewFeature.WEB_MESSAGE_LISTENER is NOT supported on this device. " +
                    "Native bridge capabilities are disabled for security."
            )
            BridgeInstallResult.Unsupported(
                "System WebView provider lacks WebViewFeature.WEB_MESSAGE_LISTENER support"
            )
        }
    }
}
