package id.smartrt.resident.webview

import android.net.Uri
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import id.smartrt.resident.BuildConfig
import id.smartrt.resident.media.FileChooserController

interface SmartRtWebChromeListener {
    fun onProgressChanged(progress: Int)
}

/**
 * Smart RT — WebChromeClient managing page load progress, diagnostics, and file chooser.
 *
 * File chooser integration:
 * - Delegates to [FileChooserController] when the web page requests a file input.
 * - If [fileChooserController] is null, the chooser is cancelled (returns false).
 * - Callback is guaranteed to be completed exactly once by [FileChooserController].
 */
class SmartRtWebChromeClient(
    private val listener: SmartRtWebChromeListener,
    private val fileChooserController: FileChooserController? = null
) : WebChromeClient() {

    companion object {
        private const val TAG = "SmartRtWebChrome"
    }

    override fun onProgressChanged(view: WebView?, newProgress: Int) {
        super.onProgressChanged(view, newProgress)
        listener.onProgressChanged(newProgress)
    }

    override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
        // Redact console messages in release builds to prevent accidental log leakage
        if (BuildConfig.DEBUG && consoleMessage != null) {
            val level = consoleMessage.messageLevel()
            val msg = "[WebConsole] ${consoleMessage.message()} -- From line ${consoleMessage.lineNumber()} of ${consoleMessage.sourceId()}"
            when (level) {
                ConsoleMessage.MessageLevel.ERROR -> Log.e(TAG, msg)
                ConsoleMessage.MessageLevel.WARNING -> Log.w(TAG, msg)
                else -> Log.d(TAG, msg)
            }
        }
        return true
    }

    /**
     * Called when the web page requests a file input (e.g. <input type="file">).
     *
     * Returns true if [FileChooserController] accepted the request (chooser launched).
     * Returns false if no controller is available, causing the WebView to cancel the chooser.
     *
     * The [filePathCallback] MUST be completed exactly once — this is enforced by
     * [FileChooserController.onShowFileChooser].
     */
    override fun onShowFileChooser(
        webView: WebView?,
        filePathCallback: ValueCallback<Array<Uri>>,
        fileChooserParams: FileChooserParams
    ): Boolean {
        val controller = fileChooserController
        if (controller == null) {
            // No controller registered — cancel immediately.
            filePathCallback.onReceiveValue(emptyArray())
            return false
        }
        return controller.onShowFileChooser(filePathCallback, fileChooserParams)
    }
}
