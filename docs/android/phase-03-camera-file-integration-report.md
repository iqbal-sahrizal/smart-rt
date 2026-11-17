# Smart RT Android — Phase 3: Camera, Gallery & File Integration Report

**Date:** 2026-11-17  
**Branch:** `staging`  
**Status:** ✅ **PASS**  
**Device Testing:** **NOT RUN** (no emulator or physical device attached to host)

---

## Executive Summary

Phase 3 implements native device integration for Camera capture, Photo Picker / Gallery, SAF document picker, file chooser bridge via `WebChromeClient.onShowFileChooser`, authenticated private document downloads, and secure PDF preview for the Smart RT Resident hybrid Android application.

In strict adherence to the **Web-First Hybrid Architecture**:
- The Next.js Resident PWA remains the single source of truth for all business logic, validation, upload mutators, and authentication.
- Android native code only exposes scoped hardware capabilities and file bridging.
- Zero changes were made to Next.js components, Supabase schemas, RLS, or Backoffice routes.
- Build targets: `compileDebugKotlin`, `lintDebug`, `testDebugUnitTest` (78 tests), `assembleDebug`, `assembleStaging`, and `assembleRelease` all succeeded with zero errors.

---

## 1. Preflight Audit

Prior to implementation, the Resident PWA codebase was audited for file inputs, upload patterns, MIME types, and document download mechanisms:

| Route / Component | Input Type | Web `accept` Attribute | Upload Handler / Destination |
|---|---|---|---|
| `/resident/complaints/new` (`resident-complaint-create-form.tsx`) | `<input type="file">` | `image/jpeg,image/png,image/webp` | Supabase Storage (`complaints/` bucket via `/api/complaints/[id]/photo`) |
| `/resident/bills` (`resident-bills-views.tsx`) | `<input type="file">` | `.jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf` | Payment proof upload (`/api/payments/[id]/proof`) |
| `/resident/feed` (`community-post-composer-dialog.tsx`) | `<input type="file" multiple>` | `image/jpeg,image/png,image/webp` | Multi-image upload (`/api/community-feed/upload`) |
| `/resident/letters/[id]` (`resident-letter-detail-view.tsx`) | Link / View action | N/A (Download/View) | Authenticated private PDF (`/api/letters/[id]/issued`) |
| `/resident/activities/[id]` (`activity-document-panel.tsx`) | Link / View action | N/A (Download/View) | Authenticated private docs (`/api/activities/[id]/documents/[fileId]`) |

### Key Preflight Findings
1. **Camera intent handling:** Forms do not declare explicit HTML `capture` attributes, but users on mobile expect camera options alongside gallery selection.
2. **Accept string complexity:** Finance forms combine both extension format (`.jpg,.pdf`) and MIME types (`image/jpeg,application/pdf`).
3. **Private document authentication:** Documents cannot be fetched via anonymous public URLs or Android `DownloadManager` without session cookies. Supabase SSR cookies must be attached when fetching private files.
4. **Iframe / Blob preview limitations:** Android WebView does not natively render inline PDF documents in `<iframe>` or `blob:` objects without third-party JS engines (e.g. PDF.js). Native intent invocation (`Intent.ACTION_VIEW`) with `FileProvider` is required for reliable PDF viewing.

---

## 2. Camera Integration

Camera capture was implemented using modern Android Activity Result APIs and private caching:

- **Component:** `CameraFileManager.kt` and `FileChooserController.kt`
- **Contract:** `ActivityResultContracts.StartActivityForResult()` with `MediaStore.ACTION_IMAGE_CAPTURE`.
- **Target URI:** Generated dynamically using `FileProvider.getUriForFile()` with authority `id.smartrt.resident.fileprovider`.
- **Storage Path:** Private application cache (`context.cacheDir/camera/capture_*.jpg`). External or shared storage is never accessed.
- **Manifest Permissions:**
  ```xml
  <uses-permission android:name="android.permission.CAMERA" />
  <uses-feature android:name="android.hardware.camera" android:required="false" />
  <uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />
  ```
  `android:required="false"` ensures devices without camera hardware can still install the application.
- **Lifecycle Cleanup:**
  - Cancelled captures delete the pre-allocated empty file immediately.
  - `CameraFileManager.cleanupCameraCache(context)` is invoked on `MainActivity.onDestroy()` and on capture rejection.
  - Captured content is never stored permanently by the native shell.

---

## 3. Gallery & Photo Picker

The gallery and media selection flow leverages Android 13+ Photo Picker with seamless fallback:

- **API 33+ (Tiramisu):** `MediaStore.ACTION_PICK_IMAGES` (Photo Picker). Respects `allowMultiple` (`EXTRA_PICK_IMAGES_MAX`). No storage permissions needed.
- **Pre-API 33:** `Intent.ACTION_GET_CONTENT` with `CATEGORY_OPENABLE` and `image/*`.
- **MIME Scope:** Filtered to image types matching `UploadMimeValidator.ALLOWED_IMAGE_MIMES`.
- **Cancellation:** Cleanly completed via `ValueCallback.onReceiveValue(emptyArray())` if user dismisses picker or cancels.

---

## 4. File Chooser Implementation

- **Component:** `FileChooserController.kt` registered to `SmartRtWebChromeClient.onShowFileChooser`.
- **Accept Type Routing:**
  - If `accept` contains image types: routes to Photo Picker.
  - If `accept` strictly requests PDF: routes to SAF Document Picker (`ACTION_GET_CONTENT` with `application/pdf`).
  - If `capture` attribute is present: routes directly to Camera.
  - If multi-type (e.g. `.jpg,.pdf` in payment proofs): SAF Document Picker is invoked with allowed MIME array `[image/jpeg, image/png, application/pdf]`.
- **Single-Completion Invariant:**
  - Protected by atomic `callbackCompleted` guard and `abortPendingCallback()` mechanism.
  - Verified in unit tests: `ValueCallback<Array<Uri>>` is **guaranteed to be invoked exactly once**. Double-invocation or leaked pending callbacks are completely prevented.

---

## 5. Upload Compatibility & Validation

- **Component:** `UploadMimeValidator.kt`
- **Validation Guard:** Invoked before any `content://` URI is handed back to the WebView's JavaScript engine:
  1. **Scheme check:** Only `content://` URIs are permitted. Direct `file://` URIs are rejected.
  2. **MIME check:** Must match `UploadMimeValidator.ALL_ALLOWED_MIMES` (`image/jpeg`, `image/jpg`, `image/png`, `image/webp`, `application/pdf`).
  3. **Page accept check:** Must satisfy the specific `accept` attribute of the requesting input element. Supports wildcard (`image/*`), extension notation (`.jpg`), and comma-separated lists.
  4. **Extension consistency:** Prevents extension spoofing (e.g. `malware.pdf` with image MIME).
  5. **Size check:** Maximum 10 MB per file (`MAX_FILE_SIZE_BYTES`). Zero-byte files rejected.
- **Fail-Closed:** Invalid files trigger localized user feedback via Indonesian Toast and resolve the callback with an empty array, prompting the web UI to re-prompt gracefully.

---

## 6. Authenticated Download Architecture

- **Component:** `AuthenticatedDownloader.kt`
- **Protocol:**
  1. Native Bridge receives `openOrDownloadPrivateDocument` action with relative path.
  2. Relative path is validated through `TrustedOriginPolicy.validateDocumentPath()` (enforcing Phase 2.1 & 2.2 traversal and allowlist constraints).
  3. Target URL is constructed strictly as `${BuildConfig.WEB_BASE_URL}${validatedPath}`. Host/scheme from payload is ignored.
  4. WebView's active session cookie for the trusted origin (`CookieManager.getInstance().getCookie(...)`) is forwarded in the `Cookie` header.
  5. `HttpURLConnection` connects over HTTPS only with redirect following disabled (`instanceFollowRedirects = false`).
  6. **Redirect Security:** If the server returns a 3xx redirect, the `Location` header is parsed and must resolve strictly to the identical trusted host (`allowedHost`). External redirects are immediately aborted, preventing auth cookie leakage.
  7. **Stream Buffer:** Written to private cache (`cacheDir/private_docs/`). Enforces 20 MB size limit during streaming.
  8. **Zero Logging:** Cookie values, sensitive auth headers, and full document URLs are never printed to Android Logcat.

---

## 7. PDF Preview Implementation

- **Component:** `DocumentActionController.kt`
- **Execution Flow:**
  1. Document is downloaded via `AuthenticatedDownloader`.
  2. Stored in app-private storage (`cacheDir/private_docs/`).
  3. Filename is sanitized via `sanitizeFileName()`: extracts basename, strips traversal sequences (`..`, `/`, `\`), enforces alphanumeric/safe characters, and caps length to 100 characters.
  4. Content URI is generated via `FileProvider.getUriForFile()`.
  5. Intent launched:
     ```kotlin
     val intent = Intent(Intent.ACTION_VIEW).apply {
         setDataAndType(contentUri, mimeType)
         addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
         addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
     }
     ```
  6. **Graceful Error Handling:** If no PDF viewer app is installed (`ActivityNotFoundException`), the user is notified with an Indonesian toast: *"Aplikasi PDF tidak ditemukan. Pasang aplikasi PDF viewer untuk membuka dokumen ini."*
  7. **Lifecycle Cleanup:** Temporary files in `cacheDir/private_docs/` are automatically deleted 30 seconds after opening and upon `MainActivity.onDestroy()`.

---

## 8. Native Bridge API Specification

The Native Bridge maintains the `WebViewCompat.addWebMessageListener` architecture established in Phase 2.1 under interface name `SmartRTNative`:

### Document Action Message Schema
```json
{
  "id": "req-12345",
  "action": "openOrDownloadPrivateDocument",
  "payload": {
    "path": "/api/letters/c8d5781a-96e0-4a88-8742-fa327c191a22/issued",
    "fileName": "Surat_Keterangan_Domisili.pdf",
    "mimeType": "application/pdf",
    "mode": "view"
  }
}
```

### Bridge Response Schema
```json
{
  "success": true,
  "action": "openOrDownloadPrivateDocument",
  "id": "req-12345",
  "data": {
    "accepted": true,
    "path": "/api/letters/c8d5781a-96e0-4a88-8742-fa327c191a22/issued",
    "fileName": "Surat_Keterangan_Domisili.pdf",
    "isDownload": false
  }
}
```

---

## 9. Security Assessment

| Threat Vector | Mitigation Strategy | Verification |
|---|---|---|
| Arbitrary File Chooser Exploit | `allowFileAccess = false` preserved; only `content://` URIs accepted; FileProvider paths isolated to cache | `UploadMimeValidatorTest`, `file_provider_paths.xml` |
| Malicious File Extension Spoofing | `isMimeExtensionConsistent` matches resolved MIME against extension | `UploadMimeValidatorTest` |
| Large File Denial-of-Service | 10 MB upload guard; 20 MB download stream buffer ceiling | `UploadMimeValidatorTest`, `AuthenticatedDownloader` |
| Auth Cookie Leakage | Cookies forwarded only to configured `BuildConfig.ALLOWED_HOST`; manual redirect inspection aborts external redirects | `AuthenticatedDownloadSecurityTest` |
| Path Traversal in Download Filename | `sanitizeFileName` extracts basename, strips `..`, slashes, backslashes, replaces special characters | `DocumentActionControllerTest` |
| Double Invocation / Deadlock | `FileChooserCallbackTest` ensures `ValueCallback` completes exactly once | `FileChooserCallbackTest` |
| File Provider Exposure | Provider `exported="false"`, `grantUriPermissions="true"`, only subdirectories of cache exposed | `AndroidManifest.xml` |

---

## 10. Unit Test & Build Results

### Unit Test Execution
- **Command:** `./gradlew compileDebugKotlin testDebugUnitTest`
- **Result:** **BUILD SUCCESSFUL** (78 tests, 0 failures, 0 skipped)

| Test Suite | Tests | Failures | Focus |
|---|---|---|---|
| `TrustedOriginPolicyTest` | 23 | 0 | Origin rules, 4-layer traversal, double-encoding, allowlist prefixes |
| `UploadMimeValidatorTest` | 14 | 0 | Accept strings, MIME consistency, extensions, file size limits |
| `SmartRtNativeBridgeTest` | 12 | 0 | WebMessageListener, iframe rejection, JSON action routing |
| `DocumentActionControllerTest` | 11 | 0 | Filename sanitization, traversal stripping, MIME-extension mapping |
| `WebViewBackNavigationTest` | 7 | 0 | Back press hierarchy, root route debounce, exit confirmation |
| `AuthenticatedDownloadSecurityTest` | 5 | 0 | Trusted URL construction, redirect abort, status classification |
| `FileChooserCallbackTest` | 4 | 0 | Exactly-once completion, cancelation, multiple URI parsing |
| `SmartRtWebViewConfigTest` | 2 | 0 | User-Agent token decoration, WebView settings |
| **Total** | **78** | **0** | **100% Passing** |

### Lint Execution
- **Command:** `./gradlew lintDebug`
- **Result:** **BUILD SUCCESSFUL** (0 Errors)

### Build Targets Execution
- **Command:** `./gradlew assembleDebug assembleStaging assembleRelease`
- **Result:** **BUILD SUCCESSFUL** in 9s (122 actionable tasks)

| Variant | Artifact Path | Size | Status |
|---|---|---|---|
| Debug | `app/build/outputs/apk/debug/app-debug.apk` | 3.58 MB | Built |
| Staging | `app/build/outputs/apk/staging/app-staging.apk` | 3.58 MB | Built |
| Release | `app/build/outputs/apk/release/app-release-unsigned.apk` | 2.63 MB | Built |

---

## 11. Device Testing Results

- **Status:** **NOT RUN**
- **Reason:** No Android emulator or physical device was attached during automated execution (`adb devices` returned 0 attached devices).
- End-to-end user interaction (camera shutter, external PDF viewer app switching, and live Supabase file uploads) must be confirmed during on-device staging QA.

---

## 12. Known Limitations

1. **Third-Party PDF Viewers:** Android does not include a system-level built-in PDF viewer activity on all AOSP builds. Devices without Google Drive, Google Chrome, or a dedicated PDF viewer will receive the Indonesian fallback toast instructing them to install a viewer.
2. **Release APK Unsigned:** `app-release-unsigned.apk` requires a production keystore for Google Play Store installation. Staging and Debug APKs use standard debug keystores.
3. **Download Notification:** Downloads are executed in-app and handed directly to external viewers via `FileProvider`. System notification drawer progress is deferred to a future phase if long-running background downloads are requested.

---

## 13. Phase 4 Recommendations

With Phase 3 complete and verified:
1. **FCM Push Notifications:** Integrate Firebase Cloud Messaging, notification channels (announcements, billing dues, emergency alerts), and token registration bridge.
2. **Deep Links / App Links:** Configure `assetlinks.json` and intent filters for `/resident/bills/*`, `/resident/feed/*`, `/resident/letters/*`.
3. **On-Device Staging QA:** Execute full end-to-end resident user flows on physical Android 11, 13, and 14+ devices.

