package id.smartrt.resident.webview

import android.webkit.WebView
import id.smartrt.resident.bridge.BridgeInstallResult
import id.smartrt.resident.bridge.NativeBridgeMessageProcessor
import id.smartrt.resident.bridge.SmartRtNativeBridge
import id.smartrt.resident.media.FileChooserController
import id.smartrt.resident.security.TrustedOriginPolicy

/**
 * Smart RT — WebView Assembler Factory
 */
object SmartRtWebViewFactory {

    fun configure(
        webView: WebView,
        trustedOriginPolicy: TrustedOriginPolicy,
        webListener: SmartRtWebViewListener,
        chromeListener: SmartRtWebChromeListener,
        bridgeCallbacks: NativeBridgeMessageProcessor.Callbacks,
        fileChooserController: FileChooserController? = null,
        tokenProvider: (() -> String?)? = null
    ): BridgeInstallResult {
        // 1. Apply security-hardened WebSettings & CookieManager
        SmartRtWebViewConfig.applyWebSettings(webView)

        // 2. Attach specialized clients
        webView.webViewClient = SmartRtWebViewClient(trustedOriginPolicy, webListener)
        webView.webChromeClient = SmartRtWebChromeClient(chromeListener, fileChooserController)

        // 3. Register secure WebMessageListener bridge with exact allowedOriginRules
        val processor = NativeBridgeMessageProcessor(
            originPolicy = trustedOriginPolicy,
            callbacks = bridgeCallbacks,
            tokenProvider = { tokenProvider?.invoke() }
        )
        val originRules = setOf(trustedOriginPolicy.getAllowedOriginRule())
        return SmartRtNativeBridge.install(webView, originRules, processor)
    }
}
