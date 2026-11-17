package id.smartrt.resident.notification

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Smart RT Resident — Firebase Cloud Messaging Service
 *
 * Handles:
 * - FCM token issuance and rotation via [onNewToken]
 * - Incoming push notifications (foreground & background data messages) via [onMessageReceived]
 */
class SmartRtFirebaseMessagingService : FirebaseMessagingService() {

    companion object {
        private const val TAG = "SmartRtFCMService"
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.i(TAG, "New FCM token received from Firebase")
        SmartRtNotificationManager.saveFcmToken(applicationContext, token)
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)
        Log.d(TAG, "Push message received from: ${remoteMessage.from}")

        val data = remoteMessage.data
        var title = remoteMessage.notification?.title
        var body = remoteMessage.notification?.body

        // Fall back to data payload if notification payload is omitted (e.g. data-only FCM push)
        if (title.isNullOrBlank()) {
            title = data["title"] ?: "Smart RT"
        }
        if (body.isNullOrBlank()) {
            body = data["body"] ?: data["message"] ?: "Anda memiliki notifikasi baru."
        }

        SmartRtNotificationManager.showNotification(
            context = applicationContext,
            title = title,
            body = body,
            data = data
        )
    }
}

