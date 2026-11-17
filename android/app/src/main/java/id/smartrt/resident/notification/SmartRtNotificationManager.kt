package id.smartrt.resident.notification

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessaging
import id.smartrt.resident.BuildConfig
import id.smartrt.resident.MainActivity
import id.smartrt.resident.R
import id.smartrt.resident.security.TrustedOriginPolicy

/**
 * Smart RT Resident — Notification Manager
 *
 * Enforces:
 * - Notification Channel creation for Android 8.0+ (API 26+)
 * - Foreground & background system notification dispatch
 * - Local token persistence in private SharedPreferences
 * - Safe PendingIntent construction targeting MainActivity with FLAG_IMMUTABLE
 */
object SmartRtNotificationManager {

    private const val TAG = "SmartRtNotification"
    const val CHANNEL_ID = "smartrt_resident_notifications"
    private const val PREFS_NAME = "smartrt_notification_prefs"
    private const val KEY_FCM_TOKEN = "fcm_device_token"

    /**
     * Initializes the notification channel. Safe to call multiple times (idempotent).
     */
    fun initChannels(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val name = "Notifikasi Warga"
            val descriptionText = "Notifikasi pengumuman, pengaduan, surat, dan kegiatan RT"
            val importance = NotificationManager.IMPORTANCE_HIGH
            val channel = NotificationChannel(CHANNEL_ID, name, importance).apply {
                description = descriptionText
                enableVibration(true)
                setShowBadge(true)
            }
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            notificationManager?.createNotificationChannel(channel)
            Log.d(TAG, "Notification channel '$CHANNEL_ID' initialized.")
        }
    }

    /**
     * Saves FCM token to private SharedPreferences.
     */
    fun saveFcmToken(context: Context, token: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_FCM_TOKEN, token).apply()
        Log.d(TAG, "FCM token persisted locally (length: ${token.length})")
    }

    /**
     * Retrieves locally cached FCM token.
     */
    fun getStoredFcmToken(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_FCM_TOKEN, null)
    }

    /**
     * Fetches FCM token asynchronously from FirebaseMessaging instance.
     */
    fun fetchFcmToken(onComplete: (String?) -> Unit) {
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (task.isSuccessful) {
                val token = task.result
                Log.d(TAG, "Fetched FCM token successfully")
                onComplete(token)
            } else {
                Log.w(TAG, "Failed to fetch FCM token", task.exception)
                onComplete(null)
            }
        }
    }

    /**
     * Shows a system notification with title, body, and payload data.
     */
    fun showNotification(
        context: Context,
        title: String,
        body: String,
        data: Map<String, String> = emptyMap()
    ) {
        initChannels(context)

        // Phase 5.2: notification ID also doubles as the nav_token used by
        // NotificationDeepLinkResolver to detect duplicate onNewIntent delivery for the
        // same tap. Computed once, up front, so both the PendingIntent request code and the
        // notify() ID are consistent with the token carried in the Intent extras.
        val notificationId = (System.currentTimeMillis() % Int.MAX_VALUE).toInt()
        val navToken = notificationId.toString()

        val trustedOriginPolicy = TrustedOriginPolicy(allowedHost = BuildConfig.ALLOWED_HOST)
        val targetUrl = PushNavigationResolver.resolveTargetUrl(
            trustedOriginPolicy = trustedOriginPolicy,
            webBaseUrl = BuildConfig.WEB_BASE_URL,
            data = data
        )
        if (data.containsKey("path") && targetUrl == null) {
            // Do not log the raw path value itself — only that a rejection occurred.
            Log.w(TAG, "Notification navigation path failed validation; tap will open default dashboard")
        }

        // Build intent to bring MainActivity to front
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("nav_token", navToken)
            targetUrl?.let { putExtra("target_url", it) }
        }

        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val pendingIntent = PendingIntent.getActivity(context, notificationId, intent, flags)

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        try {
            val notificationManager = NotificationManagerCompat.from(context)
            if (notificationManager.areNotificationsEnabled()) {
                notificationManager.notify(notificationId, notification)
                Log.d(TAG, "Notification displayed successfully (ID: $notificationId)")
            } else {
                Log.w(TAG, "Notifications are disabled in system settings for this app")
            }
        } catch (e: SecurityException) {
            Log.w(TAG, "POST_NOTIFICATIONS permission not granted; cannot display notification: ${e.message}")
        }
    }
}

