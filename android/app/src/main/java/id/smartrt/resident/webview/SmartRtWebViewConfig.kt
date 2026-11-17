package id.smartrt.resident.webview

import android.annotation.SuppressLint
import android.webkit.CookieManager
import android.webkit.WebSettings
import android.webkit.WebView
import id.smartrt.resident.BuildConfig

/**
 * Smart RT — Security-Hardened WebView Configuration
 */
object SmartRtWebViewConfig {

    fun buildUserAgent(originalUserAgent: String?): String {
        val base = originalUserAgent ?: ""
        return "$base SmartRTAndroid/${BuildConfig.VERSION_NAME} (Build/${BuildConfig.VERSION_CODE})"
    }

    @SuppressLint("SetJavaScriptEnabled")
    fun applyWebSettings(webView: WebView, isDebug: Boolean = BuildConfig.DEBUG) {
        // WebView remote debugging restricted strictly to debug builds
        WebView.setWebContentsDebuggingEnabled(isDebug)

        webView.settings.apply {
            // Enable modern PWA execution capabilities
            javaScriptEnabled = true
            domStorageEnabled = true

            // Strict file & content sandbox lockdown
            allowFileAccess = false
            allowContentAccess = false

            // Enforce HTTPS-only, zero mixed content
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW

            // Security & window behavior
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(true)

            // Zoom controls & layout preservation
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100

            // Cache mode: respects HTTP Cache-Control (no-store for sensitive APIs, cache-first for chunks)
            cacheMode = WebSettings.LOAD_DEFAULT

            // Safe Browsing — enabled unconditionally (minSdk = 26 = O)
            safeBrowsingEnabled = true

            // Append capability token for server-side hybrid identification
            userAgentString = buildUserAgent(userAgentString)
        }

        applyCookieSettings(webView)
    }

    fun applyCookieSettings(webView: WebView) {
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            // Disable third-party cookies for privacy and CSRF protection
            setAcceptThirdPartyCookies(webView, false)
        }
    }
}
