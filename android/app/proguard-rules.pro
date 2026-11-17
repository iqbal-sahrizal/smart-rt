# Smart RT Resident — Proguard / R8 Rules

# Preserve JavascriptInterfaces for WebView bridge
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Preserve SmartRtNativeBridge
-keepclassmembers class id.smartrt.resident.bridge.SmartRtNativeBridge {
    <methods>;
}

# Preserve WebKit callbacks
-keepclassmembers class * extends android.webkit.WebViewClient {
    <methods>;
}
-keepclassmembers class * extends android.webkit.WebChromeClient {
    <methods>;
}

