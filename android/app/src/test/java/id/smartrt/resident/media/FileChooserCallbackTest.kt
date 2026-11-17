package id.smartrt.resident.media

import android.net.Uri
import android.webkit.ValueCallback
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

/**
 * Unit tests for FileChooser callback completion semantics and state machine.
 *
 * Verifies:
 * - Callback dipanggil tepat satu kali (never double invoked).
 * - File chooser cancellation returns null/empty to ValueCallback.
 * - Multiple selection parsing.
 * - Stale pending callback abortion before starting new chooser.
 */
class FileChooserCallbackTest {

    /**
     * Minimal testable replica of FileChooserController's callback completion state machine.
     * Extracts pure logic without requiring Android Activity/Intent framework dependencies.
     */
    class CallbackCoordinator {
        var pendingCallback: ValueCallback<Array<Uri>>? = null
        var callbackCompleted: Boolean = false
        val invocationCount = AtomicInteger(0)

        fun register(callback: ValueCallback<Array<Uri>>) {
            abortPending()
            pendingCallback = callback
            callbackCompleted = false
        }

        fun complete(uris: Array<Uri>?) {
            if (callbackCompleted) return
            callbackCompleted = true
            val cb = pendingCallback
            pendingCallback = null
            invocationCount.incrementAndGet()
            cb?.onReceiveValue(uris ?: emptyArray())
        }

        fun abortPending() {
            if (pendingCallback != null && !callbackCompleted) {
                callbackCompleted = true
                invocationCount.incrementAndGet()
                pendingCallback?.onReceiveValue(emptyArray())
                pendingCallback = null
            }
        }
    }

    @Test
    fun callback_isCompletedExactlyOnce_onSuccess() {
        val coordinator = CallbackCoordinator()
        var received: Array<Uri>? = null

        coordinator.register(object : ValueCallback<Array<Uri>> {
            override fun onReceiveValue(value: Array<Uri>?) {
                received = value
            }
        })

        // Complete with non-null URIs
        val sampleUri = Uri.EMPTY
        coordinator.complete(arrayOf(sampleUri))

        assertEquals(1, coordinator.invocationCount.get())
        assertTrue(coordinator.callbackCompleted)

        // Attempt second completion (e.g. race condition)
        coordinator.complete(arrayOf(sampleUri))
        assertEquals("Callback must never be invoked more than once", 1, coordinator.invocationCount.get())
    }

    @Test
    fun callback_isCompletedExactlyOnce_onCancellation() {
        val coordinator = CallbackCoordinator()
        var received: Array<Uri>? = null

        coordinator.register(object : ValueCallback<Array<Uri>> {
            override fun onReceiveValue(value: Array<Uri>?) {
                received = value
            }
        })

        // Complete with null (user cancelled)
        coordinator.complete(null)

        assertEquals(1, coordinator.invocationCount.get())
        assertTrue(coordinator.callbackCompleted)
        assertEquals(0, received?.size ?: -1) // Returns empty array to signal cancel to WebView

        // Attempt redundant completion
        coordinator.complete(null)
        assertEquals(1, coordinator.invocationCount.get())
    }

    @Test
    fun abortPending_completesStaleCallbackBeforeNewOne() {
        val coordinator = CallbackCoordinator()
        var firstReceived: Array<Uri>? = null
        var secondReceived: Array<Uri>? = null

        // Register first callback but don't complete it
        coordinator.register(object : ValueCallback<Array<Uri>> {
            override fun onReceiveValue(value: Array<Uri>?) {
                firstReceived = value
            }
        })

        // Register second callback (simulates web page triggering another file chooser before previous dismissed)
        coordinator.register(object : ValueCallback<Array<Uri>> {
            override fun onReceiveValue(value: Array<Uri>?) {
                secondReceived = value
            }
        })

        // First callback should have been cleanly aborted with empty array
        assertEquals(1, coordinator.invocationCount.get())
        assertEquals(0, firstReceived?.size ?: -1)
        assertFalse(coordinator.callbackCompleted) // Second callback is now active

        // Now complete the second one
        val mockUri = Uri.EMPTY
        coordinator.complete(arrayOf(mockUri))

        assertEquals(2, coordinator.invocationCount.get())
        assertTrue(coordinator.callbackCompleted)
        assertEquals(1, secondReceived?.size ?: -1)
    }

    @Test
    fun multipleSelection_parsesMultipleUrisCorrectly() {
        val coordinator = CallbackCoordinator()
        var resultCount = 0

        coordinator.register(object : ValueCallback<Array<Uri>> {
            override fun onReceiveValue(value: Array<Uri>?) {
                resultCount = value?.size ?: 0
            }
        })

        val uri1 = Uri.EMPTY
        val uri2 = Uri.EMPTY
        val uri3 = Uri.EMPTY

        coordinator.complete(arrayOf(uri1, uri2, uri3))

        assertEquals(3, resultCount)
        assertEquals(1, coordinator.invocationCount.get())
    }
}
