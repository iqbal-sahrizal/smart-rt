package id.smartrt.resident.ui

import android.app.Activity
import id.smartrt.resident.R

/**
 * Smart RT — Native Splash Screen Controller
 *
 * Smoothly transitions from the native window background splash
 * to the interactive theme once the activity layout is mounted.
 */
class SplashScreen(private val activity: Activity) {

    fun install() {
        activity.setTheme(R.style.Theme_SmartRT)
    }
}

