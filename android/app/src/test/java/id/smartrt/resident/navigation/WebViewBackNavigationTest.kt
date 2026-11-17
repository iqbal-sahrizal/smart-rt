package id.smartrt.resident.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Unit tests verifying Android back press logic, exit confirmation cooldown, and error handling.
 */
class WebViewBackNavigationTest {

    private lateinit var backNav: WebViewBackNavigation

    private var goBackCalled = false
    private var exitAppCalled = false
    private var exitWarningMessage: String? = null

    private val testCallbacks = object : WebViewBackNavigation.Callbacks {
        override fun onGoBackInWebView() {
            goBackCalled = true
        }

        override fun onExitApp() {
            exitAppCalled = true
        }

        override fun onShowExitWarning(message: String) {
            exitWarningMessage = message
        }
    }

    @Before
    fun setUp() {
        backNav = WebViewBackNavigation(backPressCooldownMs = 2000L)
        goBackCalled = false
        exitAppCalled = false
        exitWarningMessage = null
    }

    @Test
    fun handleBackPress_navigatesBackWhenNestedRouteHasHistory() {
        val handled = backNav.handleBackPress(
            currentUrl = "https://smart-rt-staging.vercel.app/resident/bills/bill-123",
            canGoBack = true,
            isErrorStateVisible = false,
            callbacks = testCallbacks,
            currentTimeMs = 1000L
        )

        assertTrue(handled)
        assertTrue("Should navigate back in WebView history", goBackCalled)
        assertEquals(null, exitWarningMessage)
        assertEquals(false, exitAppCalled)
    }

    @Test
    fun handleBackPress_warnsOnFirstPressAtResidentRoot() {
        val handled = backNav.handleBackPress(
            currentUrl = "https://smart-rt-staging.vercel.app/resident",
            canGoBack = true,
            isErrorStateVisible = false,
            callbacks = testCallbacks,
            currentTimeMs = 1000L
        )

        assertTrue(handled)
        assertEquals("Tekan sekali lagi untuk keluar dari Smart RT", exitWarningMessage)
        assertEquals(false, exitAppCalled)
        assertEquals(false, goBackCalled)
    }

    @Test
    fun handleBackPress_exitsOnSecondPressWithinCooldownAtResidentRoot() {
        // First press at t = 1000ms
        backNav.handleBackPress(
            currentUrl = "https://smart-rt-staging.vercel.app/resident",
            canGoBack = true,
            isErrorStateVisible = false,
            callbacks = testCallbacks,
            currentTimeMs = 1000L
        )

        // Second press at t = 1500ms (within 2000ms cooldown)
        exitAppCalled = false
        val handled = backNav.handleBackPress(
            currentUrl = "https://smart-rt-staging.vercel.app/resident",
            canGoBack = true,
            isErrorStateVisible = false,
            callbacks = testCallbacks,
            currentTimeMs = 1500L
        )

        assertTrue(handled)
        assertTrue("Should exit app on double back press within cooldown", exitAppCalled)
    }

    @Test
    fun handleBackPress_resetsCooldownIfSecondPressIsAfterCooldown() {
        // First press at t = 1000ms
        backNav.handleBackPress(
            currentUrl = "https://smart-rt-staging.vercel.app/resident",
            canGoBack = true,
            isErrorStateVisible = false,
            callbacks = testCallbacks,
            currentTimeMs = 1000L
        )

        // Second press at t = 3500ms (> 2000ms cooldown)
        exitWarningMessage = null
        val handled = backNav.handleBackPress(
            currentUrl = "https://smart-rt-staging.vercel.app/resident",
            canGoBack = true,
            isErrorStateVisible = false,
            callbacks = testCallbacks,
            currentTimeMs = 3500L
        )

        assertTrue(handled)
        assertEquals(false, exitAppCalled)
        assertEquals("Tekan sekali lagi untuk keluar dari Smart RT", exitWarningMessage)
    }

    @Test
    fun handleBackPress_exitsImmediatelyWhenErrorOverlayIsVisible() {
        val handled = backNav.handleBackPress(
            currentUrl = "https://smart-rt-staging.vercel.app/resident",
            canGoBack = true,
            isErrorStateVisible = true,
            callbacks = testCallbacks,
            currentTimeMs = 1000L
        )

        assertTrue(handled)
        assertTrue("Should exit app immediately when error overlay is visible", exitAppCalled)
    }

    @Test
    fun handleBackPress_exitsImmediatelyAtLoginWithoutHistory() {
        val handled = backNav.handleBackPress(
            currentUrl = "https://smart-rt-staging.vercel.app/login",
            canGoBack = false,
            isErrorStateVisible = false,
            callbacks = testCallbacks,
            currentTimeMs = 1000L
        )

        assertTrue(handled)
        assertTrue("Should exit app when back is pressed at login without history", exitAppCalled)
    }

    @Test
    fun extractPath_extractsCleanUrlPath() {
        assertEquals("/resident/bills", backNav.extractPath("https://smart-rt-staging.vercel.app/resident/bills?a=1#section"))
        assertEquals("/resident", backNav.extractPath("https://smart-rt-staging.vercel.app/resident"))
        assertEquals("/", backNav.extractPath("https://smart-rt-staging.vercel.app"))
        assertEquals("/", backNav.extractPath(null))
    }
}

