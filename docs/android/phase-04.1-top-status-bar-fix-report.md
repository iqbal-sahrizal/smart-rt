# Smart RT Android — Phase 4.1: Top Status Bar Overlap Fix Report

**Date:** 2026-11-17  
**Branch:** `staging`  
**Status:** ✅ **PASS**  
**Physical Device Validation:** ✅ **PASS (Verified on Google Pixel 9 Pro XL via adb screencap)**

---

## 1. Problem & Root Cause Analysis

### The Bug
On the Smart RT Android hybrid shell, the Resident web portal's top app bar / header (`ResidentHeader`) was rendered behind the system status bar, causing the RT logo, tenant title, notification bell, and resident avatar to be partially obscured by the system clock, battery indicator, Wi-Fi icon, and front camera punch-hole cutout.

### Root Cause
In `MainActivity.kt`:
```kotlin
// Previous faulty implementation:
WindowCompat.setDecorFitsSystemWindows(window, false)
ViewCompat.setOnApplyWindowInsetsListener(binding.rootContainer) { _, insets ->
    val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
    binding.progressBar.setPadding(0, systemBars.top, 0, 0)
    insets
}
```
1. **Edge-to-Edge Enabled Without Container Offset:** Calling `WindowCompat.setDecorFitsSystemWindows(window, false)` directed Android to draw the window content edge-to-edge behind the system status bar and navigation bar.
2. **Missing Inset Application on WebView/Container:** The `OnApplyWindowInsetsListener` only applied `systemBars.top` padding to `binding.progressBar` (a 3dp horizontal loading bar).
3. **WebView Positioned at `y = 0`:** Because neither `binding.rootContainer` (`FrameLayout`) nor `binding.webView` received any top insets or padding, the WebView was rendered starting at physical coordinate `(0, 0)`, placing the top 24–48dp of the web page directly underneath the translucent Android system status bar.
4. **CSS Safe Area Top Unused:** The Next.js Resident PWA deliberately does not apply `padding-top: env(safe-area-inset-top)` to `<header>` (only `env(safe-area-inset-bottom)` is used on bottom navigation). Consequently, without native container offset, the web header had no top buffer.

---

## 2. Implementation & Solution

The issue was resolved cleanly at the native Android layout layer without modifying any web routing, business logic, bottom navigation, or Supabase authentication.

### Files Modified

1. **`android/app/src/main/java/id/smartrt/resident/MainActivity.kt`**
   - Updated `ViewCompat.setOnApplyWindowInsetsListener` to apply `WindowInsetsCompat.Type.statusBars().top` to `binding.rootContainer`.
   - Removed duplicate padding from `binding.progressBar` to prevent double-spacing.
   - Enforced high-contrast dark status bar icons via `WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = true`.

   ```kotlin
   // Fixed implementation:
   WindowCompat.setDecorFitsSystemWindows(window, false)
   ViewCompat.setOnApplyWindowInsetsListener(binding.rootContainer) { view, insets ->
       val statusBarInsets = insets.getInsets(WindowInsetsCompat.Type.statusBars())
       view.setPadding(0, statusBarInsets.top, 0, 0)
       insets
   }

   // Ensure status bar icons have high contrast (dark icons on light surface)
   WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = true
   ```

2. **`android/app/src/main/res/layout/activity_main.xml`**
   - Changed `rootContainer` background from `@color/brand_background` (`#F8FAFC`) to `@color/brand_surface` (`#FFFFFF`).
   - This ensures the status bar padding area seamlessly renders pure white (`#FFFFFF`), matching the light status bar and the Resident header background (`bg-surface/95`).

### Architectural Guarantees
- **Exact Single Application:** The top inset is applied strictly once on `binding.rootContainer`. Child views (`webView`, `progressBar`, `errorContainer`) naturally inherit the correct coordinate space without duplicate padding.
- **Dynamic Inset:** Zero hardcoded values; dynamically adapts across devices, notches, cutouts, and status bar heights.
- **No Web CSS Collision:** Web CSS does not use `env(safe-area-inset-top)`, preventing double spacing.
- **Scope Isolation:** Bottom insets and navigation are completely untouched. Bottom navigation continues to respect `pb-[env(safe-area-inset-bottom)]`.

---

## 3. Validation & Test Results

### 3.1 Android Build & Unit Tests
- **Unit Tests:** `./gradlew compileDebugKotlin testDebugUnitTest`  
  **Result:** ✅ **BUILD SUCCESSFUL** (78 unit tests, 0 failures, 0 skipped)
- **Android Lint:** `./gradlew lintDebug`  
  **Result:** ✅ **BUILD SUCCESSFUL** (0 errors)
- **Staging APK Assembly:** `./gradlew assembleStaging`  
  **Result:** ✅ **BUILD SUCCESSFUL** (`app-staging.apk` generated at `3.4 MB`)

### 3.2 Frontend Build & Static Checks
- **Typecheck:** `npm run typecheck` (`tsc --noEmit`)  
  **Result:** ✅ **PASS** (0 TypeScript errors)
- **Lint:** `npm run lint` (`eslint`)  
  **Result:** ✅ **PASS** (0 ESLint warnings/errors)
- **Production Build:** `npx next build --webpack`  
  **Result:** ✅ **PASS** (All 89 routes generated successfully)

### 3.3 Physical Device Validation
- **Device Model:** Google Pixel 9 Pro XL (`ro.product.model: Pixel 9 Pro XL`)
- **Device Serial:** `47151FDASOO7DB`
- **OS Version:** Android 16/17 (Baklava preview, API 35+)
- **Installation:** `adb -s 47151FDASOO7DB install -r app-staging.apk` (Success)
- **Visual Verification Method:** Live screen capture via `adb shell screencap` pulled and visually inspected in multimodal viewer.
- **Visual Inspection Findings:**
  1. **Header Positioning:** The Resident Header (`Keluarga Besar RT 06/02`, badge `WARGA`, notification bell, avatar) sits directly beneath the Android status bar.
  2. **No Overlap:** Zero overlap with the system clock (`10.59`), Wi-Fi, cell signal, battery icons, or camera cutout.
  3. **No Excessive Gap:** The header starts immediately below the status bar with zero dead whitespace.
  4. **Icon Contrast:** Status bar icons are dark grey/black on clean white surface, providing high legibility.
  5. **Scrolling & Touch:** WebView scrolling and interaction operate smoothly beneath the fixed status bar offset.

---

## 4. Conclusion

The top status bar overlap bug is completely resolved. The fix is strictly localized to native window insets in `MainActivity.kt` and `activity_main.xml`. All platform tests and on-device visual inspections have passed.

