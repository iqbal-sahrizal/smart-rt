package id.smartrt.resident.webview

import android.graphics.Bitmap
import android.net.http.SslError
import android.webkit.CookieManager
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import id.smartrt.resident.security.TrustedOriginPolicy
import java.net.URI

interface SmartRtWebViewListener {
    fun onPageLoadingStarted(url: String?)
    fun onPageLoadingFinished(url: String?)
    fun onNetworkError(errorCode: Int, description: String?, failingUrl: String?)
    fun onSslError(description: String?, failingUrl: String?)
    fun onOpenExternalUrl(url: String)
    fun onOpenExternalIntent(intentUri: String)
    fun onBackofficeRouteAttempted(path: String)
}

/**
 * Smart RT — WebViewClient with Strict Origin Isolation & SSL Cancellation
 */
class SmartRtWebViewClient(
    private val trustedOriginPolicy: TrustedOriginPolicy,
    private val listener: SmartRtWebViewListener
) : WebViewClient() {

    override fun shouldOverrideUrlLoading(
        view: WebView?,
        request: WebResourceRequest?
    ): Boolean {
        val targetUri = request?.url ?: return false
        val targetUrl = targetUri.toString()

        // 1. External application intents (tel:, mailto:, whatsapp:, wa.me/)
        if (trustedOriginPolicy.isExternalIntentScheme(targetUrl)) {
            listener.onOpenExternalIntent(targetUrl)
            return true
        }

        // 2. Allowlisted Smart RT origin
        if (trustedOriginPolicy.isTrustedOrigin(targetUrl)) {
            val path = extractPath(targetUrl)

            // Intercept Backoffice management URLs that belong to web desktop
            if (trustedOriginPolicy.isBackofficeRoute(path)) {
                listener.onBackofficeRouteAttempted(path)
                return true
            }

            // Allow resident PWA navigation internally
            return false
        }

        // 3. Untrusted / External web origins: open in device's default web browser
        listener.onOpenExternalUrl(targetUrl)
        return true
    }

    override fun onReceivedSslError(
        view: WebView?,
        handler: SslErrorHandler?,
        error: SslError?
    ) {
        // SECURITY REQUIREMENT: Never bypass SSL certificate errors under any circumstance.
        // Handler MUST be cancelled to protect residents from MitM attacks.
        handler?.cancel()

        val failingUrl = error?.url ?: view?.url
        val primaryError = error?.primaryError ?: -1
        val desc = "SSL Certificate Verification Failed (Error code: $primaryError)"
        listener.onSslError(desc, failingUrl)
    }

    override fun onReceivedError(
        view: WebView?,
        request: WebResourceRequest?,
        error: WebResourceError?
    ) {
        super.onReceivedError(view, request, error)

        // Only surface full-screen error when the main document frame fails to load
        if (request?.isForMainFrame == true) {
            val code = error?.errorCode ?: 0
            val desc = error?.description?.toString() ?: "Network request failed"
            val failingUrl = request.url?.toString()
            listener.onNetworkError(code, desc, failingUrl)
        }
    }

    override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
        listener.onPageLoadingStarted(url)
    }

    override fun onPageFinished(view: WebView?, url: String?) {
        super.onPageFinished(view, url)

        // Ensure rotated Supabase session cookies are committed to persistent disk storage
        try {
            CookieManager.getInstance().flush()
        } catch (_: Exception) {
            // Ignore during teardown
        }

        listener.onPageLoadingFinished(url)
    }

    private fun extractPath(rawUrl: String): String {
        return try {
            val path = URI(rawUrl).path
            if (path.isNullOrBlank()) "/" else path
        } catch (_: Exception) {
            "/"
        }
    }
}

