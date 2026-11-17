# Smart RT Android — Phase 4: On-Device Integration & Regression Testing Report

**Status:** PASS  
**Date:** 2026-11-17  
**Device:** Google Pixel 9 Pro XL (`47151FDASOO7DB`)  
**OS Version:** Android 16 / VanillaIceCream (SDK 35+)  
**App Variant:** Staging (`id.smartrt.resident.staging`)  
**Target Environment:** Staging PWA (`https://smart-rt-staging.vercel.app`)

---

## 1. Executive Summary

Phase 4 executes physical device testing to validate end-to-end integration between the native Android WebView shell (`id.smartrt.resident.staging`) and the Smart RT Resident Web-First PWA. 

Testing was performed on a physical **Google Pixel 9 Pro XL**, confirming:
1. **Authentication & Session Persistence:** Auth session (Supabase SSR cookies & localStorage) survives app close, backgrounding, force-stop, and cold relaunch without requiring re-login.
2. **Top Status Bar Overlap Fix:** Zero overlap between the native Android status bar and the PWA top header/app bar (`WindowInsetsCompat.Type.statusBars()` working seamlessly).
3. **Photo Picker Integration (`ACTION_PICK_IMAGES`):** Native Android Photo Picker opens gracefully without broad storage permissions, allows photo selection, passes the selected image back to Next.js form states, generates preview thumbnails, and cleanly handles user cancellation without hanging WebChromeClient callbacks.
4. **Community Feed Media Upload:** Photo selected via native picker successfully uploaded to Supabase Storage and published to the Community Feed with optimistic UI updates.
5. **Complaint Form (`/layanan/pengaduan`):** Multi-input form with photo attachment, category selection, and description submits cleanly; data round-trips to backend and displays in the complaint tracker.
6. **Hardware Back Button Navigation:** WebView history navigation handles internal route transitions and closes dialogs before delegating to the native activity finish/exit stack.

---

## 2. Test Environment & Matrix

| Component | Specification |
| :--- | :--- |
| **Physical Device** | Google Pixel 9 Pro XL (`47151FDASOO7DB`) |
| **Android Version** | Android 16 Preview (API level 35/36) |
| **Build Variant** | Staging (`app-staging.apk`) |
| **Package Name** | `id.smartrt.resident.staging` |
| **Backend Target** | Supabase Cloud Staging (`szghujzhiyndeuhepsax`) |
| **Web Target** | Vercel Staging (`https://smart-rt-staging.vercel.app`) |
| **Test Account** | Resident "IS" (Role: Warga, RT 06/02) |

---

## 3. Test Execution & Evidence

### Test Group A: Authentication & Session Lifecycle

| ID | Test Scenario | Steps Executed | Expected Result | Actual Result | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **AUTH-01** | Cold start login & session storage | Launched staging APK, verified initial session login. | Auth tokens stored in WebView `CookieManager` & storage. | Successfully authenticated as "IS" in "Keluarga Besar RT 06/02". | **PASS** |
| **AUTH-02** | Session persistence across cold restart | Force-stopped app (`am force-stop`), re-launched via launcher intent. | App reopens directly into authenticated dashboard without login screen. | Reopened directly to dashboard with user greeting "Halo, IS". | **PASS** |
| **AUTH-03** | Route transition authentication | Navigated across `/layanan`, `/warga/feed`, `/warga/pengaduan`. | Supabase session tokens refreshed transparently via SSR middleware. | Seamless navigation, zero auth errors or premature redirects to `/login`. | **PASS** |

---

### Test Group B: UI Layout & Status Bar Insets (Regression from Phase 4.1)

| ID | Test Scenario | Steps Executed | Expected Result | Actual Result | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **UI-01** | Top App Bar Clearance | Inspected top area of dashboard, feed, and complaint screens. | Web header starts cleanly below clock, battery, and signal icons. | Clean top inset spacing, no visual collision or double padding. | **PASS** |
| **UI-02** | System Bar Contrast | Checked status bar icon colors across light and dark theme regions. | Status bar icons adapt or maintain readable contrast. | Light status bar with dark icons matches clean white header background. | **PASS** |

---

### Test Group C: Photo Picker & Media Upload

| ID | Test Scenario | Steps Executed | Expected Result | Actual Result | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **PICK-01** | Photo Picker Invocation | Clicked media upload button (`<input type="file" accept="image/*">`) in Community Feed post composer. | Android 13+ native Photo Picker (`ACTION_PICK_IMAGES`) opens without requiring `READ_MEDIA_IMAGES` permission. | Native Photo Picker opened displaying device media gallery. | **PASS** |
| **PICK-02** | Photo Picker Cancellation | Clicked Back (`KEY_BACK`) while Photo Picker was active. | File chooser callback in `WebChromeClient` receives null and is cleanly reset without freezing future file uploads. | Picker dismissed, modal composer remained responsive, subsequent upload clicks worked immediately. | **PASS** |
| **PICK-03** | Single Photo Selection | Selected image `IMG_20261117_...` (463.1 KB) from picker. | Temporary content URI resolved and passed to WebView as `File` object. | Image selected, preview thumbnail rendered in web composer with file size indicator. | **PASS** |
| **PICK-04** | Feed Post Submission | Entered caption "Uji coba upload foto dari Android WebView shell...", submitted post. | Image uploaded to Supabase Storage bucket, post record inserted, feed refreshed. | Post appeared at the top of the Community Feed with attached image preview. | **PASS** |

---

### Test Group D: Form Integration & Document Attachments

| ID | Test Scenario | Steps Executed | Expected Result | Actual Result | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **FORM-01** | Complaint Form Photo Capture/Picker | Navigated to `/layanan/pengaduan`, clicked "Lampirkan Foto". | Photo picker opened, allowed image selection (`47501.png`, 1.2 MB). | Photo attached with preview and remove button. | **PASS** |
| **FORM-02** | Form Submission & State Reset | Filled title "Lampu Jalan Mati di Depan RT", category "Infrastruktur", submitted. | Form payload and image sent to backend API, success confirmation displayed. | Pengaduan submitted successfully, redirected to complaint list displaying new ticket. | **PASS** |

---

### Test Group E: Navigation & Back Button Handling

| ID | Test Scenario | Steps Executed | Expected Result | Actual Result | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **NAV-01** | Internal Web History Back | Navigated Dashboard -> Layanan -> Pengaduan, pressed Hardware Back. | Back action navigates webview history backward instead of quitting app. | Navigated back to Layanan, then back to Dashboard. | **PASS** |
| **NAV-02** | Root Back Press | Pressed Hardware Back on root Dashboard. | Back press finishes activity cleanly. | App minimized / closed cleanly without ANR or crash. | **PASS** |

---

## 4. Key Metrics & Observations

1. **Native Shell Performance:**
   - App cold start to interactive webview content: ~1.2s on Pixel 9 Pro XL.
   - Zero ANR or crash logs recorded in Logcat during the entire test suite.
2. **Security Compliance:**
   - No broad storage permissions (`READ_EXTERNAL_STORAGE` or `MANAGE_EXTERNAL_STORAGE`) requested. Photo picker operated strictly under privacy-preserving Android scoped storage contracts.
   - Tokens and session cookies remained inside Android WebView's sandbox and protected encrypted cookie store.
   - Zero sensitive credentials leaked in Logcat.

---

## 5. Conclusion & Next Steps

All test criteria for Phase 4 have **PASSED** on the physical Google Pixel 9 Pro XL device.

The native Android shell is now fully certified for user sessions, layout insets, hardware navigation, and scoped file/photo attachments. 

**Ready to proceed to Phase 5.1: FCM Push Notification Implementation.**

