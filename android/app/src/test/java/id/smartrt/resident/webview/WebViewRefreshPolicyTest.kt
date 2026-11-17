package id.smartrt.resident.webview

import id.smartrt.resident.MainActivity
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WebViewRefreshPolicyTest {

    @Test
    fun canTriggerPullToRefresh_allowsWhenAtTopAndNoErrorOverlay() {
        assertTrue(MainActivity.canTriggerPullToRefresh(scrollY = 0, isErrorStateVisible = false))
    }

    @Test
    fun canTriggerPullToRefresh_blocksWhenScrolledDown() {
        assertFalse(MainActivity.canTriggerPullToRefresh(scrollY = 1, isErrorStateVisible = false))
        assertFalse(MainActivity.canTriggerPullToRefresh(scrollY = 480, isErrorStateVisible = false))
    }

    @Test
    fun canTriggerPullToRefresh_blocksWhenErrorOverlayVisible() {
        assertFalse(MainActivity.canTriggerPullToRefresh(scrollY = 0, isErrorStateVisible = true))
    }
}

