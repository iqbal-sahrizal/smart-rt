# Smart RT Android — Phase 2.1: Security & Compatibility Closure Report

**Date:** 2026-11-17  
**Branch:** `staging`  
**Scope:** Android native shell only. No Next.js, Supabase, or backend changes.

---

## Status: ✅ PASS

All required build targets completed successfully. All 36 unit tests pass with zero failures.  
Instrumentation tests: **NOT RUN** — no emulator or physical device attached. This is expected at this phase.

---

## 1. Source Code Audit Findings

### 1.1 `addJavascriptInterface` — Root Problem

Phase 2 used `addJavascriptInterface` with per-method origin verification via `webView.url`.  
This approach has a fundamental security flaw:

- `webView.url` is a property read on the **calling thread** (typically the UI thread), but the WebView's actual navigation state belongs to the renderer process.
- A malicious page can begin navigation to a trusted URL after triggering a bridge call, causing `webView.url` to reflect the new destination rather than the actual call origin.
- Even without race conditions, `webView.url` returns the last committed URL, not the actual origin of the JavaScript executing the call.
- Result: origin verification via `webView.url` provides **false security**.

### 1.2 `WebViewCompat.addWebMessageListener` — Why It Is Correct

`WebViewCompat.addWebMessageListener` enforces origin at the **Chromium engine level**:

- The `Uri sourceOrigin` parameter in `onPostMessage` is populated by the renderer process, not the host application.
- It is cryptographically tied to the actual execution origin of the message sender.
- It cannot be spoofed by JavaScript, page navigation, or race conditions.
- `isMainFrame: Boolean` enforces that only top-level documents can communicate through the bridge — iframes are structurally rejected.
- `allowedOriginRules: Set<String>` are enforced by the Chromium engine before `onPostMessage` is even called.

### 1.3 Document Path Validation — Original Weakness

Phase 2 used `rawPath.startsWith("/api/...")` on user-provided strings.  
This fails against:

| Attack Vector | Example | Old Behavior |
|---|---|---|
| Encoded traversal | `/api/letters/%2e%2e/etc/passwd` | Passes `startsWith` |
| Double encoding | `/api/letters/%252e%252e/secrets` | Passes `startsWith` |
| Backslash traversal | `/api/letters/..\\config` | Passes `startsWith` |
| Scheme injection in query | `/api/letters/x?redirect=http://evil.com` | Not caught |
| Absolute URI disguised | `http://evil.com/api/letters/` | Might pass |

Phase 2.1 replaces all string-based checks with `java.net.URI` parsing.

---

## 2. Changes Made

### 2.1 `TrustedOriginPolicy.kt` — Complete Rewrite

**File:** `android/app/src/main/java/id/smartrt/resident/security/TrustedOriginPolicy.kt`

Changes:
- Added `getAllowedOriginRule(): String` returning `"$allowedScheme://$allowedHost"` — the exact format required by `WebViewCompat.addWebMessageListener`.
- Added `PathValidationResult` sealed class: `Valid(path, isDownload)` / `Invalid(reason)`.
- Added `validateDocumentPath(rawPath: String): PathValidationResult` using `java.net.URI` parsing:
  - Rejects null, blank, or empty inputs.
  - Rejects paths containing encoded traversal sequences: `%2e`, `%2f`, `%5c` (case-insensitive).
  - Rejects paths containing `..` after normalization.
  - Rejects paths that parse as absolute URIs (have a scheme or authority component).
  - Rejects paths containing `userInfo` or `host` components.
  - Normalizes the URI path before allowlist prefix checking.
  - Rejects paths with query parameters containing absolute URIs (scheme injection in query).
  - Checks normalized path against allowlist using `startsWith` on the **normalized, parsed path only** — not on the raw input.
- Changed `allowedHost` and `allowedScheme` visibility from `private val` to `internal val` for test access.

### 2.2 `SmartRtNativeBridge.kt` — Complete Rewrite

**File:** `android/app/src/main/java/id/smartrt/resident/bridge/SmartRtNativeBridge.kt`

Changes:
- **Removed `addJavascriptInterface` entirely.** No fallback, no compatibility path.
- Added `NativeBridgeMessageProcessor` class (pure, Android-framework-free, fully unit-testable):
  - Accepts `rawMessage: String?`, `sourceOrigin: String?`, `isMainFrame: Boolean`.
  - Rejects all iframe calls (`isMainFrame == false`) before any other processing.
  - Validates origin via `originPolicy.isTrustedOrigin()`.
  - Enforces 4096-byte payload size cap.
  - Parses JSON and routes to known action handlers only.
  - Document path validation delegates to `originPolicy.validateDocumentPath()` (URI parser).
- Added `SmartRtNativeBridge.install()` using `WebViewCompat.addWebMessageListener`:
  - Checks `WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)` first.
  - If **unsupported**: returns `BridgeInstallResult.Unsupported`. No silent fallback.
  - If **supported**: installs listener with exact origin rules from `TrustedOriginPolicy.getAllowedOriginRule()`.
- `BridgeInstallResult` sealed class: `Installed` / `Unsupported(reason)`.
- Bridge version incremented to `2`. `bridgeMechanism` field set to `"WebMessageListener"`.
- Added `@SuppressLint("RequiresFeature")` on `onPostMessage` with explicit rationale: `replyProxy.postMessage` is only reachable because `addWebMessageListener` was registered — which itself is guarded by `WebViewFeature.isFeatureSupported`. The suppression is safe by construction.

### 2.3 `SmartRtWebViewFactory.kt` — Updated

**File:** `android/app/src/main/java/id/smartrt/resident/webview/SmartRtWebViewFactory.kt`

Changes:
- Updated bridge installation to call `SmartRtNativeBridge.install()` with `NativeBridgeMessageProcessor.Callbacks`.
- Returns `BridgeInstallResult` instead of old `SmartRtNativeBridge` reference.

### 2.4 `MainActivity.kt` — Updated

**File:** `android/app/src/main/java/id/smartrt/resident/MainActivity.kt`

Changes:
- Updated `createBridgeCallbacks()` return type from `SmartRtNativeBridge.Callbacks` → `NativeBridgeMessageProcessor.Callbacks`.
- Added import for `NativeBridgeMessageProcessor`.

### 2.5 `SmartRtWebViewConfig.kt` — Cleanup

**File:** `android/app/src/main/java/id/smartrt/resident/webview/SmartRtWebViewConfig.kt`

Changes:
- **Removed** deprecated `databaseEnabled = true` (deprecated API 26+, Web SQL removed from Chrome).
- **Removed** deprecated `allowFileAccessFromFileURLs = false` (deprecated API 26+, always false in modern WebView).
- **Removed** deprecated `allowUniversalAccessFromFileURLs = false` (deprecated API 26+, always false in modern WebView).
- **Removed** obsolete `Build.VERSION.SDK_INT >= Build.VERSION_CODES.O` guard on `safeBrowsingEnabled` — minSdk is 26 (= O), so the check is always true. `safeBrowsingEnabled = true` is now set unconditionally.
- **Removed** unused `import android.os.Build` after the guard removal.
- Retained all security-critical settings: `allowFileAccess = false`, `allowContentAccess = false`, `mixedContentMode = MIXED_CONTENT_NEVER_ALLOW`, `javaScriptCanOpenWindowsAutomatically = false`.

### 2.6 `build.gradle.kts` (root) — AGP Upgrade

**File:** `android/build.gradle.kts`

Changes:
- Android Gradle Plugin upgraded from `8.5.1` → `8.6.0`.
- AGP 8.6.0 adds official `compileSdk = 35` support. No suppression flags needed.

### 2.7 `gradle.properties` — Suppression Flag Removed

**File:** `android/gradle.properties`

Changes:
- Removed `android.suppressUnsupportedCompileSdk=35` — no longer needed with AGP 8.6.0.

---

## 3. Bridge Mechanism Rationale

### Why `WebViewCompat.addWebMessageListener` is superior

| Property | `addJavascriptInterface` | `addWebMessageListener` |
|---|---|---|
| Origin verification | App reads `webView.url` (raceable, stale) | Chromium engine provides `Uri sourceOrigin` (cryptographically tied to actual sender) |
| Iframe isolation | Must be manually implemented | `isMainFrame` enforced by engine before callback |
| Origin scope | All pages loaded in WebView | Restricted to `allowedOriginRules` set by host |
| Minimum API | API 1 | API 24+ (via AndroidX WebKit) |
| Feature check required | No | `WebViewFeature.WEB_MESSAGE_LISTENER` |

### Feature availability

`WebViewFeature.WEB_MESSAGE_LISTENER` is available in AndroidX WebKit 1.4.0+.  
This project targets `androidx.webkit:webkit:1.11.0` with `minSdk = 26`.  
Virtually all Android 8.0+ devices with an up-to-date system WebView provider support this feature.

### Fallback policy

> If `WebViewFeature.WEB_MESSAGE_LISTENER` is NOT supported, native bridge capabilities are **disabled**. There is no silent fallback to `addJavascriptInterface`.

This is a deliberate security decision. A device that cannot support the secure bridge mechanism does not receive native capabilities. The PWA continues to function through the WebView as a web application without the native bridge.

---

## 4. Toolchain Compatibility

| Component | Phase 2 | Phase 2.1 | Status |
|---|---|---|---|
| Android Gradle Plugin | 8.5.1 | **8.6.0** | ✅ Upgraded |
| Gradle | 8.7 | 8.7 | ✅ Unchanged |
| Kotlin | 2.0.20 | 2.0.20 | ✅ Unchanged |
| compileSdk | 35 | 35 | ✅ Now officially supported |
| targetSdk | 35 | 35 | ✅ No change |
| minSdk | 26 | 26 | ✅ No change |
| JDK | 17 | 17 | ✅ No change |
| `suppressUnsupportedCompileSdk` | Present | **Removed** | ✅ No longer needed |

---

## 5. WebView Configuration Audit

### Settings removed (deprecated, no longer meaningful)

| Setting | Reason Removed |
|---|---|
| `databaseEnabled = true` | Web SQL Database removed from Chromium. Deprecated in Android API 26+. Setting has no effect. |
| `allowFileAccessFromFileURLs = false` | Deprecated in Android API 26+. Always false in modern WebView regardless. |
| `allowUniversalAccessFromFileURLs = false` | Deprecated in Android API 26+. Always false in modern WebView regardless. |

### Settings retained and their rationale

| Setting | Value | Rationale |
|---|---|---|
| `javaScriptEnabled` | `true` | Required for PWA execution |
| `domStorageEnabled` | `true` | Required for PWA session storage and localStorage |
| `allowFileAccess` | `false` | Prevents WebView from reading `file://` URIs from device filesystem |
| `allowContentAccess` | `false` | Prevents WebView from reading `content://` URIs from ContentProviders |
| `mixedContentMode` | `MIXED_CONTENT_NEVER_ALLOW` | Enforces HTTPS-only resource loading |
| `javaScriptCanOpenWindowsAutomatically` | `false` | Blocks popup window creation without user gesture |
| `setSupportMultipleWindows` | `true` | Enables `SmartRtWebChromeClient` to control new window handling |
| `builtInZoomControls` | `false` | PWA manages its own viewport |
| `displayZoomControls` | `false` | Hides native zoom UI |
| `textZoom` | `100` | Locks system font scale to prevent layout breakage |
| `cacheMode` | `LOAD_DEFAULT` | Respects HTTP Cache-Control headers. API responses with `no-store` are not cached. |
| `safeBrowsingEnabled` | `true` | Google Safe Browsing for malicious URL detection |

### CookieManager lifecycle

| Event | Action |
|---|---|
| `onPageFinished` | `CookieManager.getInstance().flush()` — persists session cookies to disk |
| `onPause` (Activity) | `CookieManager.getInstance().flush()` — flush before process may be backgrounded |
| `onStop` (Activity) | `CookieManager.getInstance().flush()` — additional safety flush |
| `notifyLogout` (bridge) | `CookieManager.getInstance().removeAllCookies()` — clears session on explicit logout |
| `onDestroy` | WebView destroyed, `webView = null` reference released |

No auth tokens are written to Android `Log` output at any severity level.

---

## 6. Lint Report

**Run:** `./gradlew lintDebug`  
**Result:** BUILD SUCCESSFUL — zero Errors.

Remaining warnings are all informational and do not indicate defects:

| Lint ID | Severity | Description | Action |
|---|---|---|---|
| `RequiresFeature` | Warning | `replyProxy.postMessage` inside `onPostMessage` | Suppressed with `@SuppressLint("RequiresFeature")` and rationale: reachable only after `install()` guards on `WebViewFeature.isFeatureSupported` |
| `ObsoleteSdkInt` | Warning | `Build.VERSION.SDK_INT >= O` guard in `SmartRtWebViewConfig` | Fixed: guard removed, `safeBrowsingEnabled = true` set unconditionally since minSdk = 26 |
| `OldTargetApi` | Warning | Lint suggests checking against latest Android version | Acknowledged. compileSdk/targetSdk = 35. Will be revisited when API 36 is stable. |
| `GradleDependency` | Warning (×4) | Newer versions of `core-ktx`, `appcompat`, `activity-ktx`, `webkit` | Deferred. Dependency upgrades are out of scope for Phase 2.1. |
| `DataExtractionRules` | Warning | `android:allowBackup` deprecated in API 31+ | Deferred to a future manifest hardening phase. |
| `UnusedResources` | Warning (×6) | Reserved brand colors and string resources not yet used in code | Deferred. Resources are intentionally pre-declared for future theming use. |
| `IconLauncherShape` | Warning | Round launcher icon is not circular | Deferred. Launcher icons are placeholder assets. |
| `MonochromeLauncherIcon` | Warning (×2) | Adaptive icon missing monochrome tag | Deferred. Monochrome icon support is not yet designed. |
| `Overdraw` | Warning | Root layout background + theme background | Deferred. Minor visual optimization, no functional impact. |

---

## 7. Test Results

### Unit Tests

**Run:** `./gradlew testDebugUnitTest`  
**Result:** BUILD SUCCESSFUL

| Test Suite | Tests | Skipped | Failures | Errors |
|---|---|---|---|---|
| `SmartRtNativeBridgeTest` | 12 | 0 | 0 | 0 |
| `TrustedOriginPolicyTest` | 15 | 0 | 0 | 0 |
| `WebViewBackNavigationTest` | 7 | 0 | 0 | 0 |
| `SmartRtWebViewConfigTest` | 2 | 0 | 0 | 0 |
| **Total** | **36** | **0** | **0** | **0** |

### Key test cases added in Phase 2.1

**`TrustedOriginPolicyTest`:**
- Trusted origin accepted (staging, production)
- Lookalike origin rejected (`resident.smart-rt.evil.com`)
- HTTP rejected (non-HTTPS)
- Subdomain of trusted host rejected
- Empty / null origin rejected
- Build variant origin isolation (staging bridge cannot call production origin)
- Document path: valid paths accepted for all five allowlisted prefixes
- Document path: `../` traversal rejected
- Document path: `%2e%2e` encoded traversal rejected
- Document path: scheme injection in query rejected
- Document path: absolute URI rejected
- Document path: forbidden path rejected

**`SmartRtNativeBridgeTest`:**
- Iframe call rejected (`isMainFrame = false`)
- Untrusted / lookalike origin rejected
- `getAppInfo` returns `bridgeMechanism = "WebMessageListener"` and `bridgeVersion = 2`
- `notifyLogout` triggers callback and returns `acknowledged = true`
- Untrusted origin cannot call `notifyLogout`
- Encoded path traversal rejected in `openOrDownloadPrivateDocument`
- Scheme injection in document path rejected
- Oversized payload (>4096 bytes) rejected
- Unknown action returns structured error

### Instrumentation Tests

**Status: NOT RUN** — no emulator or physical device attached at time of this phase.  
Instrumentation tests are out of scope for Phase 2.1 and will be validated on-device in a future phase.

---

## 8. Build Artifacts

**Run:** `./gradlew assembleDebug assembleStaging assembleRelease`  
**Result:** BUILD SUCCESSFUL (122 tasks)

| Variant | APK |
|---|---|
| Debug | `app/build/outputs/apk/debug/app-debug.apk` |
| Staging | `app/build/outputs/apk/staging/app-staging.apk` |
| Release | `app/build/outputs/apk/release/app-release-unsigned.apk` |

Release APK is unsigned — signing configuration is not set up at this phase. AAB (Android App Bundle) for Play Store submission is deferred to a release phase.

---

## 9. Authentication & CookieManager Notes

The following cannot be verified without a running emulator or device:

- Supabase Auth cookie round-trips through WebView CookieManager.
- Cookie persistence across activity restarts.
- Session invalidation behavior on `notifyLogout`.
- Safe Browsing interaction with staging URLs.

These will be validated during on-device integration testing.

---

## 10. Known Open Risks

| Risk | Severity | Notes |
|---|---|---|
| `WEB_MESSAGE_LISTENER` unavailable on old WebView provider | Low | Per policy: capabilities disabled, not degraded. Device must update WebView. AndroidX WebKit 1.11.0 with minSdk 26 makes this extremely rare. |
| Release APK unsigned | Expected | Signing is deferred to release phase. Debug and staging APKs are debug-signed. |
| Instrumentation tests not run | Accepted | No emulator attached. Will be tested on-device. |
| Launcher icons are placeholder assets | Accepted | Deferred to design asset integration phase. |
| `android:allowBackup` deprecation | Low | No `dataExtractionRules` XML defined. Deferred to manifest hardening phase. |

---

## 11. Files Changed in Phase 2.1

| File | Change |
|---|---|
| `android/build.gradle.kts` | AGP 8.5.1 → 8.6.0 |
| `android/gradle.properties` | Removed `android.suppressUnsupportedCompileSdk=35` |
| `android/app/src/main/java/id/smartrt/resident/security/TrustedOriginPolicy.kt` | Rewritten: URI-based path validation, `getAllowedOriginRule()`, `PathValidationResult` |
| `android/app/src/main/java/id/smartrt/resident/bridge/SmartRtNativeBridge.kt` | Rewritten: `addJavascriptInterface` removed, `WebViewCompat.addWebMessageListener`, `NativeBridgeMessageProcessor` |
| `android/app/src/main/java/id/smartrt/resident/webview/SmartRtWebViewFactory.kt` | Updated: new bridge install API, `BridgeInstallResult` |
| `android/app/src/main/java/id/smartrt/resident/MainActivity.kt` | Updated: `NativeBridgeMessageProcessor.Callbacks` type |
| `android/app/src/main/java/id/smartrt/resident/webview/SmartRtWebViewConfig.kt` | Deprecated fields removed, obsolete SDK guard removed |
| `android/app/src/test/.../TrustedOriginPolicyTest.kt` | Rewritten: 15 tests including encoded traversal, scheme injection |
| `android/app/src/test/.../SmartRtNativeBridgeTest.kt` | Rewritten: 12 tests including iframe isolation, oversized payload |

---

## 12. Next Phase

Phase 2.1 is complete. No Phase 3 work has been started.

**Recommended Phase 3 scope (pending user review and approval):**
- FCM device registration and notification delivery.
- Camera and gallery integration via `ActivityResultContracts`.
- File chooser and download integration (`WebChromeClient.onShowFileChooser`, `DownloadManager`).
- Deep link handling and intent filter configuration.
- On-device integration testing with an emulator or physical device.

