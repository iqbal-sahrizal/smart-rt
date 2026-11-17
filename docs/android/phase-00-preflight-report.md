# Smart RT — Phase 0 Preflight & Architecture Audit Report

**Date:** 17 November 2026  
**Phase:** Phase 0 — Architecture Audit & Implementation Plan  
**Overall Preflight Status:** **PASS WITH WARNINGS**  
**Architecture Specification:** [`docs/android/web-first-hybrid-architecture.md`](./web-first-hybrid-architecture.md)

---

## 1. Executive Summary

Phase 0 audited the existing Smart RT Next.js 16 App Router repository, Supabase SSR authentication model, private storage upload/download pipelines, security headers, deployment configuration, and local macOS Android build environment to establish the readiness for a **Web-First Hybrid Android Resident Application**.

**Verdict: PASS WITH WARNINGS.**  
No architectural blockers prevent building the thin Kotlin Android WebView shell on top of the existing Next.js Resident application. All 16 resident routes (`/resident/*`), server-side authentication guards, multi-workspace selectors, and private storage proxy endpoints are already mobile-responsive and production-hardened. Several targeted technical warnings (such as missing PWA manifest/service worker files, Android `WebView` lack of inline `<iframe>` PDF rendering, strict filename-extension validators on `content://` URIs, and default shell `PATH` pointing to JDK 11 while JDK 17 is installed in Homebrew/Android Studio) have been identified with concrete mitigations scheduled for Phases 1–3.

---

## 2. Audit Results by Task (Tasks 1–12)

### Task 1 & 2: Existing PWA Implementation, Manifest, Service Worker & Caching

| Check | Audit Finding | Status |
|---|---|---|
| **Web App Manifest** | Search across `src/` and `public/` found only `src/app/favicon.ico` and SVG placeholders (`file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`). No `src/app/manifest.ts`, `public/manifest.json`, or `192x192`/`512x512` PNG icons exist yet. | **Warning (Phase 1 Task)** |
| **Service Worker** | No `public/sw.js` or service worker registration exists yet. | **Warning (Phase 1 Task)** |
| **Viewport & Safe Area Metadata** | `src/app/layout.tsx` exports `metadata: Metadata` (`title: "Smart RT"`) but does not export `viewport: Viewport` with `viewportFit: "cover"` or `themeColor`. | **Warning (Phase 1 Task)** |
| **Next.js Caching Configuration** | `next.config.ts` enables `cacheComponents: true` and `partialPrefetching: true`. All dynamic resident pages call `await connection()` (`src/app/(resident)/resident/layout.tsx`, `src/lib/auth/server.ts`) and private API routes set `Cache-Control: private, no-store`, ensuring dynamic data is never served stale. | **PASS** |

---

### Task 3: Resident Routes & Mobile Responsiveness

| Check | Audit Finding | Status |
|---|---|---|
| **Resident Layout & Shell** | `src/app/(resident)/resident/layout.tsx` wraps all resident routes in `ResidentShell` (`src/components/resident/resident-shell.tsx`), consisting of sticky `ResidentHeader`, `<main className="flex-1">`, and fixed mobile `ResidentBottomNav` (`md:hidden`). | **PASS** |
| **Mobile Bottom Navigation** | `src/components/resident/resident-bottom-nav.tsx` renders a 6-column mobile bar (`Beranda`, `Feed`, `Tagihan`, `Pengumuman`, `Layanan`, `Profil`) with `min-h-[52px]` touch targets, `pb-[env(safe-area-inset-bottom)]`, and responsive typography down to `<360px` width. | **PASS** |
| **Content Bottom Padding** | `src/components/resident/resident-container.tsx` applies `pb-24 md:pb-[var(--space-8)]`, preventing fixed bottom-nav overlap on mobile viewports. | **PASS** |
| **Complete Route Coverage** | All 21 files under `src/app/(resident)/resident/*` were verified: Dashboard (`/resident`), Community Feed (`/resident/feed`), Bills list & detail (`/resident/bills`, `/resident/bills/[id]`), Announcements list & detail (`/resident/announcements`, `/resident/announcements/[id]`), Services hub (`/resident/layanan`), Letters list/create/detail (`/resident/letters`, `/resident/letters/new`, `/resident/letters/[id]`), Complaints list/create/detail (`/resident/complaints`, `/resident/complaints/new`, `/resident/complaints/[id]`), Activities list/my/detail (`/resident/activities`, `/resident/activities/my`, `/resident/activities/[id]`), Ronda list/detail (`/resident/ronda`, `/resident/ronda/[id]`), Profile (`/resident/profile`), Household (`/resident/household`), and Notifications (`/resident/notifications`). | **PASS** |

---

### Task 4: Supabase SSR Authentication & Cookie Behavior in WebView

| Check | Audit Finding | Status |
|---|---|---|
| **Supabase Client Architecture** | Uses `@supabase/ssr` (`^0.12.7`) and `@supabase/supabase-js` (`^2.109.0`). Server client (`src/lib/supabase/server.ts`) and request proxy (`src/proxy.ts` -> `src/lib/supabase/middleware.ts`) read and write first-party chunked auth cookies (`sb-szghujzhiyndeuhepsax-auth-token`). | **PASS** |
| **Workspace Selection Cookie** | `src/lib/auth/cookies.ts` manages `smart_rt_workspace` (`httpOnly: true, sameSite: "lax", secure: isHttpsOrigin(), path: "/", maxAge: 2592000`). Validated against live DB memberships on every request in `getAuthContext()`. | **PASS** |
| **Email Confirmation & Activation Callback** | `src/app/auth/callback/route.ts` handles `code` (`exchangeCodeForSession`) and `token_hash` (`verifyOtp`), redirecting safely via `resolveSafeNextPath` to `/activate-account?token=...` or `/login`. | **PASS** |
| **WebView Cookie Persistence Risk** | Android `CookieManager` buffers `Set-Cookie` mutations in memory and writes to disk asynchronously. Because Supabase uses single-use Refresh Token Rotation, an un-flushed cookie on app termination would invalidate the user's session. **Mitigation:** Android shell must call `CookieManager.getInstance().flush()` in `onPageFinished()`, `onPause()`, and `onStop()`. | **Warning (Handled in Architecture)** |

---

### Task 5: File Upload & Download Flows

| Workflow | Source Files Audited | Key WebView Integration Finding | Status |
|---|---|---|---|
| **Payment Proof Upload & View** | `src/lib/finance/storage.ts`, `src/components/finance/resident-bills-views.tsx` | Accepts `.jpg`, `.jpeg`, `.png`, `.pdf` up to 5 MiB (`<input type="file">`). View link uses `<a href="/api/payments/[id]/proof" target="_blank">`. Native shell must intercept `target="_blank"` on `/api/*` to download/view with cookies. | **PASS (Handled in Design)** |
| **Complaint Photo Upload & View** | `src/lib/complaints/storage.ts`, `src/components/complaints/resident-complaint-create-form.tsx` | Accepts `image/jpeg,image/png,image/webp` up to 5 MiB. **Strict validator:** `validateComplaintPhotoFile` requires `fileEntry.name` to end with `.jpg`, `.jpeg`, `.png`, or `.webp` in addition to magic-byte inspection. Native `FileChooserCoordinator` must normalize `content://` URIs lacking extensions into properly named cached files. | **Warning (Handled in Design)** |
| **Community Feed Multi-Image Upload** | `src/lib/community-feed/storage.ts`, `src/components/community-feed/community-post-composer-dialog.tsx` | Uses `<input type="file" accept="image/jpeg,image/png,image/webp" multiple />` (up to 4 images, 5 MiB each). Native `onShowFileChooser` must support `FileChooserParams.MODE_OPEN_MULTIPLE`. | **PASS (Handled in Design)** |
| **Letters Supporting Docs & Official Issued PDF** | `src/lib/letters/storage.ts`, `src/components/letters/resident-letter-create-form.tsx`, `src/components/letters/letter-document-viewer.tsx` | Supporting docs require `.jpg/.jpeg/.png/.pdf` extension on `fileEntry.name` (up to 5 files, 5 MiB each). `LetterDocumentViewer` previews PDFs via `<iframe src={previewObjectUrl}>` (`blob:` URL) and downloads via `<a href="/api/letters/[id]/issued?download=1">`. **Critical WebView quirk:** Android WebView does not render PDFs inside `<iframe>` and cannot pass `blob:` URLs to system `DownloadManager`. Phase 1 + Phase 3 will delegate PDF preview/download in Android WebView to the native authenticated document handler. | **Warning (Handled in Design)** |
| **Activity Documentation View/Download** | `src/lib/activities/storage.ts`, `src/components/activities/activity-document-panel.tsx` | Same pattern as `LetterDocumentViewer`: images render in `<img>`, PDFs render in `<iframe>` with `<a download>` links to `/api/activities/[id]/documents/[fileId]?download=1`. | **Warning (Handled in Design)** |
| **HTTP `Permissions-Policy` Header** | `src/lib/security/headers.ts` | Sends `Permissions-Policy: camera=(), microphone=(), geolocation=()`. This blocks in-page `navigator.mediaDevices.getUserMedia()`, which is desirable for security. It does **not** block `<input type="file">` camera/gallery intents handled natively by `WebChromeClient.onShowFileChooser`. | **PASS** |

---

### Task 6: Deployment URL & Environment Configuration

*(Note: No secret values or environment variable values were printed or logged during this audit.)*

| Item | Configuration Audited | Status |
|---|---|---|
| **Vercel Configuration (`vercel.json`)** | Configured with `"framework": "nextjs"`, `"buildCommand": "next build --webpack"`, and `"regions": ["sin1"]` (Singapore, co-located with Supabase Staging `ap-southeast-1`). | **PASS** |
| **Vercel Project Metadata (`.vercel/project.json`)** | Linked to project `smart-rt` (`prj_yenXvQsWcyfKRy1xB7jkt6C4IxtF`). | **PASS** |
| **Supabase Staging Target** | Project `smart-rt-staging`, Ref `szghujzhiyndeuhepsax`, Region `ap-southeast-1`. | **PASS** |
| **Server Action Body Size Limit** | `next.config.ts` sets `experimental.serverActions.bodySizeLimit: "16mb"`, accommodating 10 MiB max document uploads plus multipart overhead. | **PASS** |
| **Healthcheck Endpoint** | `/api/health` returns `{ "status": "ok", "configured": true }` with `Cache-Control: no-store` and leaks zero env values. | **PASS** |

---

### Task 7: Android Tooling & Host Environment Availability

Audited local macOS (`Darwin 24.3.0 arm64`) development environment:

| Tool / Component | Local Path / Version Found | Assessment |
|---|---|---|
| **Android Studio** | `/Applications/Android Studio.app` | **Installed** |
| **Android SDK Directory** | `/Users/iqbalsahrizal/Library/Android/sdk` | **Directory Present** (Managed via Android Studio) |
| **Android Debug Bridge (`adb`)** | `/opt/homebrew/bin/adb` — Version `1.0.41` (`37.0.1-15733141`) | **Installed & Ready** |
| **Default Shell `java` (`PATH`)** | `/opt/homebrew/opt/openjdk@11/bin/java` (`OpenJDK 11.0.27`) | **Warning:** Default `PATH` points to JDK 11, whereas Android Gradle Plugin (AGP) 8.x requires **JDK 17+**. |
| **Homebrew OpenJDK 17** | `/opt/homebrew/opt/openjdk@17/bin/java` (`OpenJDK 17.0.16`) | **Installed & Ready** — Configure portable Gradle Java Toolchain (`jvmToolchain(17)`) in `build.gradle.kts` and set `JAVA_HOME` in the local shell environment (never hardcode machine-specific paths in shared `gradle.properties`). |
| **Android Studio Embedded JBR 17** | `/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java` (`OpenJDK 17.0.9`) | **Installed & Ready** |
| **Homebrew OpenJDK 24** | `/opt/homebrew/opt/openjdk/bin/java` (`OpenJDK 24.0.1`) | **Installed** |
| **System `gradle` CLI** | Not on global `PATH` (`gradle not found`) | **Expected:** Standard Android projects use the committed Gradle Wrapper (`./gradlew`), which will be generated in `android/` during Phase 2. |

---

### Tasks 8–12: Architecture, Native Bridge, FCM, Responsibilities & Security Risks

Completed and documented in full in [`docs/android/web-first-hybrid-architecture.md`](./web-first-hybrid-architecture.md):
- **Task 8 (Kotlin Android Shell Architecture):** Section 3 & Section 11 of `web-first-hybrid-architecture.md`.
- **Task 9 (Minimal Secure Native Bridge):** Section 6 of `web-first-hybrid-architecture.md`.
- **Task 10 (FCM Device Registration & Notification Delivery):** Section 8 of `web-first-hybrid-architecture.md`.
- **Task 11 (Native vs. Web Responsibilities):** Section 1.2 of `web-first-hybrid-architecture.md`.
- **Task 12 (Security, Privacy, and Lifecycle Risks):** Section 10 of `web-first-hybrid-architecture.md` and Section 4 below.

---

## 3. Development Prerequisites for Phase 1 & Phase 2

1. **Java 17 Selection for Gradle Builds:**
   - Use portable Gradle Java Toolchain configuration (`kotlin { jvmToolchain(17) }` / `compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }`) in `build.gradle.kts` and configure `JAVA_HOME` locally in the developer's shell environment (or git-ignored local settings) rather than hardcoding machine-specific JDK paths in shared `gradle.properties`.
2. **Android SDK Platform 35 & Build-Tools:**
   - Ensure Android SDK Platform 35 (`android-35`) and Build-Tools `35.0.0` are installed via Android Studio SDK Manager (`~/Library/Android/sdk`) and `sdk.dir=/Users/iqbalsahrizal/Library/Android/sdk` is written to `android/local.properties` (git-ignored).
3. **Staging Deployment URL:**
   - Confirm the live Vercel staging HTTPS hostname (e.g., `https://smart-rt.vercel.app` or branch alias) to populate `ALLOWED_WEB_HOST` and `WEB_BASE_URL` in the `staging` product flavor of `android/app/build.gradle.kts`.

---

## 4. Identified Risks, Warnings & Mitigations

| # | Risk / Warning | Severity | Mitigation Strategy |
|---|---|---|---|
| **R-01** | **In-App PDF Preview (`<iframe src="blob:...">`) Blank in Android WebView:** Chromium WebView does not bundle a PDF renderer plugin for `<iframe>`. Residents viewing issued letters (`LetterDocumentViewer`) or activity PDFs (`ActivityDocumentPanel`) would see an empty box if left unadjusted. | **High** | In Phase 1, detect `SmartRTAndroid` WebView / `window.SmartRTNative` and route "Pratinjau PDF" & "Unduh PDF" to `SmartRTNative.openOrDownloadPrivateDocument()`, which fetches the private PDF using the WebView's cookies and opens it in Android's native PDF viewer via `FileProvider` (`Intent.ACTION_VIEW`) or saves to `MediaStore.Downloads`. |
| **R-02** | **Strict Filename Extension Validation on Android `content://` Pickers:** `validateComplaintPhotoFile` and `validateLetterAttachmentFile` reject files whose `file.name` does not end with `.jpg/.jpeg/.png/.webp/.pdf` even when magic bytes are valid. Some Android `content://` providers return extensionless display names (`image:10294`). | **High** | In Phase 3, `UploadUriNormalizer` in the Android shell inspects `DISPLAY_NAME` and `ContentResolver.getType(uri)`; if the filename lacks the canonical extension, it copies the stream to a temporary file with the proper extension in `cacheDir/upload_staging/` before passing the `FileProvider` URI to `filePathCallback`. |
| **R-03** | **Supabase Refresh Token Rotation vs. Asynchronous `CookieManager` Disk Sync:** If `src/proxy.ts` rotates the Supabase refresh token and the app process is killed before `CookieManager` flushes RAM cookies to SQLite, the user's session is lost on next cold start. | **High** | Call `CookieManager.getInstance().flush()` in `SmartRtWebViewClient.onPageFinished()`, `MainActivity.onPause()`, and `MainActivity.onStop()`. |
| **R-04** | **Unresolved `filePathCallback` Freezes File Inputs:** If a user cancels the Android camera or document picker and `onShowFileChooser` does not call `filePathCallback.onReceiveValue(null)`, WebView permanently ignores future `<input type="file">` clicks. | **Medium** | Centralize picker lifecycle in `FileChooserCoordinator` using `ActivityResultLauncher` and guarantee `onReceiveValue(null)` on cancellation, permission denial, or new picker invocation. |
| **R-05** | **Dual-Role (`pengurus` + `warga`) Navigation into Backoffice Routes:** A resident who is also an RT admin might select an Admin workspace on `/select-tenant`, loading desktop-oriented Backoffice routes inside the Resident app. | **Medium** | `SmartRtWebViewClient.shouldOverrideUrlLoading` restricts in-app paths to Resident and Auth routes (`/resident/*`, `/login`, `/select-tenant`, `/activate-account`, `/auth/callback`, `/no-access`), redirecting Backoffice paths back to `/select-tenant` or `/resident` with a toast message. |
| **R-06** | **Shared Device Notification / Document Cache Leakage After Logout:** Temporary previewed PDFs or active push tokens could remain on device after a resident logs out. | **Medium** | On `notifyLogout()` or navigation to `/login` post-signout, wipe `context.cacheDir/doc_preview/` and `context.cacheDir/upload_staging/`, flush `CookieManager`, and (in Phase 4) deactivate the device's FCM token. |
| **R-07** | **Default macOS Shell `java` Points to OpenJDK 11:** Running `./gradlew` without specifying `JAVA_HOME` fails under AGP 8.x. | **Low** | Configure portable Gradle `jvmToolchain(17)` in `build.gradle.kts` and export `JAVA_HOME` locally in the developer's environment (never hardcode machine-specific JDK paths into committed project files). |

---

## 5. Explicit Gate Decision

- **Preflight Status:** **PASS WITH WARNINGS**
- **Blockers:** **None (0 Blockers)**
- **Next Step:** Review `docs/android/web-first-hybrid-architecture.md` and this preflight report. Upon approval, proceed to **Phase 1 (Web/PWA Enhancement & Hybrid Readiness)** followed by **Phase 2 (Kotlin Android Shell Scaffolding)**.

