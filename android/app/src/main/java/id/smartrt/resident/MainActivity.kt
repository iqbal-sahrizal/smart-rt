package id.smartrt.resident

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import id.smartrt.resident.bridge.NativeBridgeMessageProcessor
import id.smartrt.resident.bridge.SmartRtNativeBridge
import id.smartrt.resident.databinding.ActivityMainBinding
import id.smartrt.resident.media.CameraFileManager
import id.smartrt.resident.media.DocumentActionController
import id.smartrt.resident.media.FileChooserController
import id.smartrt.resident.navigation.DeepLinkDecision
import id.smartrt.resident.navigation.NotificationDeepLinkResolver
import id.smartrt.resident.navigation.WebViewBackNavigation
import id.smartrt.resident.notification.SmartRtNotificationManager
import id.smartrt.resident.security.TrustedOriginPolicy
import id.smartrt.resident.ui.SplashScreen
import id.smartrt.resident.webview.SmartRtWebChromeListener
import id.smartrt.resident.webview.SmartRtWebViewFactory
import id.smartrt.resident.webview.SmartRtWebViewListener

/**
 * Smart RT Resident — Single-Activity Native Shell Host
 *
 * Phase 3 additions:
 * - [FileChooserController]: handles <input type="file"> from WebView (camera, gallery, SAF).
 * - [DocumentActionController]: handles authenticated download and PDF preview via Native Bridge.
 * - Camera/gallery launchers registered here via Activity Result API.
 * - Temp file cleanup on destroy.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var trustedOriginPolicy: TrustedOriginPolicy
    private lateinit var backNavigation: WebViewBackNavigation
    private lateinit var deepLinkResolver: NotificationDeepLinkResolver

    // Phase 3 controllers
    private lateinit var fileChooserController: FileChooserController
    private lateinit var documentActionController: DocumentActionController

    // Phase 5.1: Android 13+ Notification Permission Launcher
    private val notificationPermissionLauncher = registerForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (isGranted) {
            SmartRtNotificationManager.fetchFcmToken { token ->
                token?.let { SmartRtNotificationManager.saveFcmToken(this, it) }
            }
        }
    }

    private var isErrorStateVisible: Boolean = false
    private var isPullToRefreshLocked: Boolean = false

    override fun onCreate(savedInstanceState: Bundle?) {
        // 1. Install splash screen transition before super.onCreate
        SplashScreen(this).install()
        super.onCreate(savedInstanceState)

        // 2. View binding setup
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // 3. Edge-to-edge system insets handling — offset WebView container below status bar
        WindowCompat.setDecorFitsSystemWindows(window, false)
        ViewCompat.setOnApplyWindowInsetsListener(binding.rootContainer) { view, insets ->
            val statusBarInsets = insets.getInsets(WindowInsetsCompat.Type.statusBars())
            view.setPadding(0, statusBarInsets.top, 0, 0)
            insets
        }

        // Ensure status bar icons have high contrast (dark icons on light surface)
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = true

        // 4. Initialize security policy and navigation controller
        trustedOriginPolicy = TrustedOriginPolicy(allowedHost = BuildConfig.ALLOWED_HOST)
        backNavigation = WebViewBackNavigation()
        deepLinkResolver = NotificationDeepLinkResolver(trustedOriginPolicy)

        // 5. Initialize Phase 3 controllers
        //    FileChooserController registers Activity Result launchers — must be before setContentView
        //    is called, but AppCompatActivity calls onCreate before the ContentView is set, so
        //    we initialize here (after super.onCreate but the launchers are registered via
        //    registerForActivityResult which requires the activity to be in INITIALIZED state,
        //    which is satisfied here).
        fileChooserController = FileChooserController(this)
        documentActionController = DocumentActionController(this, trustedOriginPolicy)

        // 6. Configure WebView via factory (includes FileChooserController and FCM token provider)
        SmartRtWebViewFactory.configure(
            webView = binding.webView,
            trustedOriginPolicy = trustedOriginPolicy,
            webListener = createWebListener(),
            chromeListener = createChromeListener(),
            bridgeCallbacks = createBridgeCallbacks(),
            fileChooserController = fileChooserController,
            tokenProvider = { SmartRtNotificationManager.getStoredFcmToken(this) }
        )

        // 6.1 Configure Pull-to-Refresh wrapper (active only when WebView is scrolled to top)
        setupPullToRefresh()

        // 7. Initialize FCM channels & token pre-fetch
        SmartRtNotificationManager.initChannels(this)
        SmartRtNotificationManager.fetchFcmToken { token ->
            token?.let { SmartRtNotificationManager.saveFcmToken(this, it) }
        }
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            if (androidx.core.content.ContextCompat.checkSelfPermission(
                    this,
                    android.Manifest.permission.POST_NOTIFICATIONS
                ) != android.content.pm.PackageManager.PERMISSION_GRANTED
            ) {
                notificationPermissionLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        // 8. Set up modern back press dispatcher
        setupBackNavigation()

        // 9. Error recovery retry button
        binding.btnRetry.setOnClickListener {
            hideErrorOverlay()
            binding.webView.reload()
        }

        // 10. Load initial Resident portal URL (or handle deep link / notification tap)
        if (savedInstanceState == null) {
            handleDeepLinkIntent(intent, isNewIntent = false)
        } else {
            binding.webView.restoreState(savedInstanceState)
        }
    }

    /**
     * Phase 5.2 — Notification Tap Navigation
     *
     * Delegates the actual safety decision to [NotificationDeepLinkResolver], which
     * independently re-validates `target_url` (MainActivity is exported, so this intent may
     * not have originated from our own FCM-built PendingIntent) and deduplicates repeated
     * delivery of the same notification tap via `nav_token`.
     *
     * On cold/terminated launch ([isNewIntent] = false) an invalid or absent target falls back
     * to the default Resident dashboard. On a tap while already running ([isNewIntent] = true)
     * an invalid/duplicate target is simply ignored — the app just comes to the foreground on
     * whatever page it already had open, with no navigation and no page reload.
     */
    private fun handleDeepLinkIntent(intent: Intent?, isNewIntent: Boolean) {
        if (intent?.action == Intent.ACTION_VIEW && intent.data != null) {
            when (
                val decision = deepLinkResolver.resolveAppLink(
                    rawUrl = intent.dataString,
                    webBaseUrl = BuildConfig.WEB_BASE_URL,
                    isNewIntent = isNewIntent
                )
            ) {
                is DeepLinkDecision.Load -> binding.webView.loadUrl(decision.url)
                DeepLinkDecision.Ignore -> if (!isNewIntent) {
                    binding.webView.loadUrl("${BuildConfig.WEB_BASE_URL}/resident")
                }
            }
            return
        }

        val targetUrl = intent?.getStringExtra("target_url")
        val navToken = intent?.getStringExtra("nav_token")

        when (val decision = deepLinkResolver.resolve(targetUrl, navToken, isNewIntent)) {
            is DeepLinkDecision.Load -> binding.webView.loadUrl(decision.url)
            DeepLinkDecision.Ignore -> if (!isNewIntent) {
                binding.webView.loadUrl("${BuildConfig.WEB_BASE_URL}/resident")
            }
        }
    }

    @android.annotation.SuppressLint("ClickableViewAccessibility")
    private fun setupPullToRefresh() {
        binding.swipeRefreshLayout.setColorSchemeResources(R.color.brand_primary)
        binding.swipeRefreshLayout.setOnChildScrollUpCallback { _, _ ->
            isPullToRefreshLocked ||
                (binding.webView.url?.contains("/resident/chat") == true) ||
                !canTriggerPullToRefresh(binding.webView.scrollY, isErrorStateVisible)
        }
        binding.webView.setOnTouchListener { v, _ ->
            if (isPullToRefreshLocked || (binding.webView.url?.contains("/resident/chat") == true)) {
                v.parent?.requestDisallowInterceptTouchEvent(true)
            }
            false
        }
        binding.swipeRefreshLayout.setOnRefreshListener {
            val blocked = isPullToRefreshLocked || (binding.webView.url?.contains("/resident/chat") == true)
            if (!blocked && canTriggerPullToRefresh(binding.webView.scrollY, isErrorStateVisible)) {
                binding.webView.reload()
            } else {
                binding.swipeRefreshLayout.isRefreshing = false
            }
        }
    }

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                backNavigation.handleBackPress(
                    currentUrl = binding.webView.url,
                    canGoBack = binding.webView.canGoBack(),
                    isErrorStateVisible = isErrorStateVisible,
                    callbacks = object : WebViewBackNavigation.Callbacks {
                        override fun onGoBackInWebView() {
                            binding.webView.goBack()
                        }

                        override fun onExitApp() {
                            finish()
                        }

                        override fun onShowExitWarning(message: String) {
                            Toast.makeText(this@MainActivity, message, Toast.LENGTH_SHORT).show()
                        }
                    }
                )
            }
        })
    }

    private fun createWebListener(): SmartRtWebViewListener {
        return object : SmartRtWebViewListener {
            override fun onPageLoadingStarted(url: String?) {
                hideErrorOverlay()
                isPullToRefreshLocked = false
                binding.swipeRefreshLayout.isEnabled = true
                binding.progressBar.visibility = View.VISIBLE
            }

            override fun onPageLoadingFinished(url: String?) {
                binding.progressBar.visibility = View.GONE
                binding.swipeRefreshLayout.isRefreshing = false
            }

            override fun onNetworkError(errorCode: Int, description: String?, failingUrl: String?) {
                showErrorOverlay(
                    title = getString(R.string.network_error_title),
                    message = getString(R.string.network_error_message),
                    iconRes = R.drawable.ic_wifi_off
                )
            }

            override fun onSslError(description: String?, failingUrl: String?) {
                showErrorOverlay(
                    title = getString(R.string.ssl_error_title),
                    message = getString(R.string.ssl_error_message),
                    iconRes = R.drawable.ic_wifi_off
                )
            }

            override fun onOpenExternalUrl(url: String) {
                try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    startActivity(intent)
                } catch (_: Exception) {
                    Toast.makeText(this@MainActivity, "Gagal membuka tautan eksternal", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onOpenExternalIntent(intentUri: String) {
                try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(intentUri))
                    startActivity(intent)
                } catch (_: Exception) {
                    Toast.makeText(this@MainActivity, "Aplikasi tidak ditemukan untuk aksi ini", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onBackofficeRouteAttempted(path: String) {
                Toast.makeText(
                    this@MainActivity,
                    "Fitur pengelolaan RT diakses melalui web browser.",
                    Toast.LENGTH_LONG
                ).show()
                binding.webView.loadUrl("${BuildConfig.WEB_BASE_URL}/resident")
            }
        }
    }

    private fun createChromeListener(): SmartRtWebChromeListener {
        return object : SmartRtWebChromeListener {
            override fun onProgressChanged(progress: Int) {
                binding.progressBar.progress = progress
                if (progress >= 100) {
                    binding.progressBar.visibility = View.GONE
                } else if (!isErrorStateVisible) {
                    binding.progressBar.visibility = View.VISIBLE
                }
            }
        }
    }

    private fun createBridgeCallbacks(): NativeBridgeMessageProcessor.Callbacks {
        return object : NativeBridgeMessageProcessor.Callbacks {
            override fun onLogoutNotified() {
                runOnUiThread {
                    try {
                        CookieManager.getInstance().flush()
                    } catch (_: Exception) {
                    }
                }
            }

            override fun onNotificationPermissionRequested() {
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                    runOnUiThread {
                        notificationPermissionLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                    }
                }
            }

            override fun onDocumentActionRequested(
                path: String,
                fileName: String,
                mimeType: String,
                isDownload: Boolean
            ) {
                // Phase 3: delegate to DocumentActionController on the UI thread.
                runOnUiThread {
                    documentActionController.handleDocumentAction(
                        validatedPath = path,
                        fileName = fileName,
                        mimeType = mimeType,
                        isDownload = isDownload
                    )
                }
            }

            override fun onPullToRefreshLockChanged(locked: Boolean) {
                runOnUiThread {
                    isPullToRefreshLocked = locked
                    binding.swipeRefreshLayout.isEnabled = !locked
                    binding.webView.parent?.requestDisallowInterceptTouchEvent(locked)
                    if (locked) {
                        binding.swipeRefreshLayout.isRefreshing = false
                    }
                }
            }
        }
    }

    private fun showErrorOverlay(title: String, message: String, iconRes: Int) {
        isErrorStateVisible = true
        binding.progressBar.visibility = View.GONE
        binding.swipeRefreshLayout.isRefreshing = false
        binding.webView.visibility = View.GONE

        binding.errorTitle.text = title
        binding.errorMessage.text = message
        binding.errorIcon.setImageResource(iconRes)
        binding.errorContainer.visibility = View.VISIBLE
    }

    private fun hideErrorOverlay() {
        isErrorStateVisible = false
        binding.errorContainer.visibility = View.GONE
        binding.webView.visibility = View.VISIBLE
    }

    override fun onPause() {
        super.onPause()
        try {
            CookieManager.getInstance().flush()
            binding.webView.onPause()
        } catch (_: Exception) {
        }
    }

    override fun onResume() {
        super.onResume()
        try {
            binding.webView.onResume()
        } catch (_: Exception) {
        }
    }

    override fun onStop() {
        super.onStop()
        try {
            CookieManager.getInstance().flush()
        } catch (_: Exception) {
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        binding.webView.saveState(outState)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleDeepLinkIntent(intent, isNewIntent = true)
    }

    override fun onDestroy() {
        documentActionController.destroy()
        try {
            binding.webView.destroy()
        } catch (_: Exception) {
        }
        // Clean up any residual camera temp files from this session.
        CameraFileManager.cleanupCameraCache(this)
        CameraFileManager.cleanupPrivateDocsCache(this)
        super.onDestroy()
    }

    companion object {
        internal fun canTriggerPullToRefresh(
            scrollY: Int,
            isErrorStateVisible: Boolean
        ): Boolean {
            return scrollY == 0 && !isErrorStateVisible
        }
    }
}
