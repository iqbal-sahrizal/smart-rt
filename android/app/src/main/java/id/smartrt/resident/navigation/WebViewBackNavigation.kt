package id.smartrt.resident.navigation

import java.net.URI

/**
 * Smart RT — Android Back Navigation Controller
 *
 * Implements intuitive back navigation without trapping residents in redirect loops
 * or inadvertently closing forms while editing.
 */
class WebViewBackNavigation(
    private val backPressCooldownMs: Long = 2000L
) {

    interface Callbacks {
        fun onGoBackInWebView()
        fun onExitApp()
        fun onShowExitWarning(message: String)
    }

    private var lastBackPressTime: Long = 0

    companion object {
        private val ROOT_PATHS = setOf(
            "/resident",
            "/login",
            "/select-tenant",
            "/no-access"
        )
    }

    /**
     * Determines whether back navigation should go back in WebView history or exit the app.
     * Returns true if handled, false otherwise.
     */
    fun handleBackPress(
        currentUrl: String?,
        canGoBack: Boolean,
        isErrorStateVisible: Boolean,
        callbacks: Callbacks,
        currentTimeMs: Long = System.currentTimeMillis()
    ): Boolean {
        // If error overlay is active, exit immediately
        if (isErrorStateVisible) {
            callbacks.onExitApp()
            return true
        }

        val path = extractPath(currentUrl)

        // If the resident is at the main dashboard (/resident)
        if (path == "/resident") {
            return handleRootExit(currentTimeMs, callbacks)
        }

        // If at other entry roots with no back stack (/login, /select-tenant)
        if (ROOT_PATHS.contains(path) && !canGoBack) {
            callbacks.onExitApp()
            return true
        }

        // If WebView has history and we are on a nested route (e.g. /resident/bills/123)
        if (canGoBack) {
            callbacks.onGoBackInWebView()
            return true
        }

        // Fallback for root or non-history routes
        return handleRootExit(currentTimeMs, callbacks)
    }

    private fun handleRootExit(currentTimeMs: Long, callbacks: Callbacks): Boolean {
        val isWithinCooldown = lastBackPressTime > 0 && (currentTimeMs - lastBackPressTime < backPressCooldownMs)
        return if (isWithinCooldown) {
            lastBackPressTime = 0
            callbacks.onExitApp()
            true
        } else {
            lastBackPressTime = currentTimeMs
            callbacks.onShowExitWarning("Tekan sekali lagi untuk keluar dari Smart RT")
            true
        }
    }

    fun extractPath(rawUrl: String?): String {
        if (rawUrl.isNullOrBlank()) return "/"
        return try {
            val uri = URI(rawUrl)
            val path = uri.path
            if (path.isNullOrBlank()) "/" else path
        } catch (_: Exception) {
            "/"
        }
    }

    fun resetCooldown() {
        lastBackPressTime = 0
    }
}

