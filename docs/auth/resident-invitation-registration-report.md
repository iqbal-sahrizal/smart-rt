# Smart RT — Resident Registration (No Email Verification) & Invitation Deep Linking Report

**Date:** 2026-11-17  
**Branch:** `staging`  
**Supabase Staging:** `szghujzhiyndeuhepsax` (`activate-invited-resident` Edge Function `ACTIVE`)  
**Android Staging App:** `id.smartrt.resident.staging` (verified on Google Pixel 9 Pro XL `47151FDASOO7DB`)

---

## 1. Root Cause Analysis

1. **Email Verification Blocking Resident Activation:**
   - `redeemInvitationAction` (`src/app/actions/invitations.ts`) previously called `supabase.auth.signUp()` using the public `anon` SSR client.
   - Because global **Confirm Email** is enabled on Supabase Auth (preserved for Backoffice/non-invitation flows), `signUp()` created auth users with `email_confirmed_at = NULL`, dispatched a confirmation email, and returned `session = null`.
   - `redeem_resident_invitation` (`20261115001900_resident_invitations.sql`) enforces `u.email_confirmed_at IS NOT NULL`, causing `signInWithPassword` to fail with `email_not_confirmed` and forcing residents into the email confirmation UI.
2. **Potential Localhost / Untrusted Host Redirect:**
   - `resolveSafeRequestOrigin()` in `src/app/actions/invitations.ts` read raw `origin`, `x-forwarded-host`, and `host` headers directly without an allowlist check, and `ActivationLinkBanner` constructed copyable URLs solely from `window.location.origin`. If invoked on localhost or behind unconfigured proxy headers, invitation/redirect URLs resolved to `http://localhost` instead of the canonical HTTPS domain.

---

## 2. Authentication Changes (No Email Verification + Direct Session)

- **New Edge Function (`supabase/functions/activate-invited-resident/index.ts`, deployed to staging):**
  - Validates the 256-bit invitation token and password (`8–72` chars) strictly on the server.
  - Re-validates the invitation against `get_resident_invitation_claim_target` (using `SUPABASE_ANON_KEY`, matching its `REVOKE ... FROM service_role` ACL). Rejects invalid, expired, revoked, already redeemed, inactive resident/tenant, or already-linked invitations (`HTTP 400`).
  - Creates the Auth user via GoTrue Admin (`POST /auth/v1/admin/users` using `SUPABASE_SERVICE_ROLE_KEY` exclusively inside Edge Runtime) with `email_confirm: true` and `user_metadata.full_name` from DB — **no verification email is sent** and global Confirm Email stays enabled for Backoffice.
  - **Account Takeover Protection:** If `email` already exists (`422`), never overwrites the existing user's password; returns `status: "existing_user"` so `redeemInvitationAction` enforces `signInWithPassword` ownership verification.
- **Server Action (`src/app/actions/invitations.ts`):**
  - `redeemInvitationAction` calls `activate-invited-resident`, immediately executes `supabase.auth.signInWithPassword(...)` to issue real SSR session cookies, runs atomic `redeem_resident_invitation` (`warga`-only role + `tenant_members` active), sets `profiles.active_tenant_id` and `resident:<tenant_id>` workspace cookie, and executes `redirect("/resident")` directly to the Resident dashboard.
- **Canonical Invitation URLs (`src/lib/invitations/url.ts`, `ActivationLinkBanner`):**
  - Resolves canonical HTTPS origin (`NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_SITE_URL` / `VERCEL_PROJECT_PRODUCTION_URL` / allowlisted production hosts `smart-rt-nine.vercel.app`, `resident.smartrt.id`), rejecting untrusted Host headers and `localhost` outside `NODE_ENV === "development"`.

---

## 3. Android App Links & Asset Links Changes

- **`/.well-known/assetlinks.json` (`src/app/.well-known/assetlinks.json/route.ts` & `src/lib/supabase/middleware.ts`):**
  - Added `"/.well-known"` to `PUBLIC_PATHS` in `middleware.ts` so requests are never redirected to `/login`.
  - Route handler returns `HTTP 200`, `Content-Type: application/json; charset=utf-8`, `Cache-Control: public, max-age=3600` with `id.smartrt.resident.staging` and `id.smartrt.resident.debug` bound to verified keystore SHA-256 `39:85:FE:F3:F4:27:1E:5E:8B:32:39:AD:53:64:E3:06:12:E6:5C:01:FD:A8:E6:8D:1A:00:86:4E:A8:DC:20:AD`. Optional `ANDROID_RELEASE_SHA256_FINGERPRINTS` env var supports `id.smartrt.resident` release signing without fabricating fingerprints.
- **Android Manifest & Build Variants (`android/app/build.gradle.kts`, `AndroidManifest.xml`):**
  - Added `manifestPlaceholders["appLinksHost"]` (`smart-rt-nine.vercel.app` for `debug`/`staging`, `resident.smartrt.id` for `release`).
  - Added `<intent-filter android:autoVerify="true">` on `MainActivity` restricted strictly to `https`, `${appLinksHost}`, and `android:path="/activate-account"`.
- **Fail-Closed Validation & Navigation (`TrustedOriginPolicy.kt`, `NotificationDeepLinkResolver.kt`, `MainActivity.kt`):**
  - Added `TrustedOriginPolicy.validateInvitationAppLink()` enforcing strict HTTPS origin, exact `/activate-account` normalized path, traversal/`%25`/`%00`/fragment/scheme-injection rejection, strict token regex (`^[A-Za-z0-9_-]{32,128}$`), and query stripping (returns canonical `/activate-account?token=<token>` only, eliminating open redirects).
  - Added `NotificationDeepLinkResolver.resolveAppLink()` reconstructing URL from compiled-in `BuildConfig.WEB_BASE_URL` with `onNewIntent` deduplication and zero token logging.

---

## 4. Files Changed / Added

- `supabase/functions/activate-invited-resident/index.ts` *(new)*
- `supabase/functions/activate-invited-resident/activate-invited-resident.test.mjs` *(new)*
- `src/lib/invitations/url.ts` *(new)*
- `src/lib/invitations/types.ts`
- `src/app/actions/invitations.ts`
- `src/components/invitations/activation-link-banner.tsx`
- `src/components/invitations/resident-invitations-view.tsx`
- `src/components/invitations/resident-invitation-panel.tsx`
- `src/lib/supabase/middleware.ts`
- `src/app/.well-known/assetlinks.json/route.ts` *(new)*
- `android/app/build.gradle.kts`
- `android/app/src/main/AndroidManifest.xml`
- `android/app/src/main/java/id/smartrt/resident/security/TrustedOriginPolicy.kt`
- `android/app/src/main/java/id/smartrt/resident/navigation/NotificationDeepLinkResolver.kt`
- `android/app/src/main/java/id/smartrt/resident/MainActivity.kt`
- `android/app/src/test/java/id/smartrt/resident/navigation/NotificationDeepLinkResolverTest.kt`
- `tests/invitations/resident-activation-applink.test.mjs` *(new)*
- **Database migrations added:** None (0).

---

## 5. Automated & Staging E2E Test Results

| Check | Result | Evidence |
|---|---|---|
| **Edge Function Deno Suite** (`activate-invited-resident.test.mjs`) | **4/4 PASS** | Verified `email_confirm: true` user creation, invalid/expired/redeemed/revoked rejection (`400`), existing-user password preservation, and malformed token/password rejection. |
| **Next.js URL & Middleware Suite** (`resident-activation-applink.test.mjs`) | **3/3 PASS** | Verified canonical HTTPS URL generation without localhost, untrusted-origin rejection, and `/.well-known/assetlinks.json` public bypass. |
| **Android Unit Tests, Lint & Staging Build** (`./gradlew testDebugUnitTest lintDebug assembleStaging`) | **107/107 PASS** | Includes new `NotificationDeepLinkResolverTest` cases (valid token + extra-param stripping, `?next=https://evil.com` rejection, untrusted domain/HTTP/route/traversal rejection, `onNewIntent` deduplication). |
| **Next.js Typecheck, Lint & Production Build** (`npm run typecheck && npm run lint && npx next build --webpack`) | **PASS** | Zero TS/ESLint errors; `/.well-known/assetlinks.json` built cleanly and verified locally (`HTTP 200`, `application/json`, exact JSON statements). |
| **Live Staging E2E Registration (No Email Verification)** | **PASS** | Created temporary synthetic resident & pending invitation (`99999999-...-9901`/`9902`); `activate-invited-resident` returned `200 { ok: true, status: "created" }`; immediate `signInWithPassword` returned `200` with `access_token` and `email_confirmed_at: "2026-11-17T13:07:19.053848Z"`; `redeem_resident_invitation` returned `200` (`assigned_role: "warga"`); token reuse returned `400 { reason: "redeemed" }`. Synthetic test data deleted afterward. |
| **Android Physical Device App Link Test** (Pixel 9 Pro XL `47151FDASOO7DB`) | **PASS (Intent/WebView)** | Terminated launch (`ACTION_VIEW` with invalid token) opened app to `/activate-account` invalid card; warm launch (`onNewIntent` with valid synthetic token) opened app directly to `Aktivasi Akun Warga` showing `Keluarga Besar (RT 06 / RW 02)`, `Warga Uji Aktivasi`, `uj***@example.com`. |
| **Web Browser Fallback** (`curl -sI https://smart-rt-nine.vercel.app/activate-account?...`) | **PASS** | Returns `HTTP/2 200` (`text/html`), accessible without app installation. |

---

## 6. Belum Diverifikasi / Catatan Deployment

1. **Android `autoVerify` Domain Verification (`smart-rt-nine.vercel.app`):**
   - `adb shell pm get-app-links id.smartrt.resident.staging` currently reports state `1024` (unverified) because `https://smart-rt-nine.vercel.app/.well-known/assetlinks.json` currently returns `HTTP 307 -> /login` from the prior Vercel production deployment (deployment to production was withheld per constraint *"Jangan deploy production"*). Once these Next.js changes are deployed to `smart-rt-nine.vercel.app`, `/.well-known/assetlinks.json` will return `HTTP 200` and Android `autoVerify` will resolve automatically.
2. **Release Keystore SHA-256:**
   - No release keystore exists in the repository. Production release verification requires setting `ANDROID_RELEASE_SHA256_FINGERPRINTS` in the hosting environment to match the release signing certificate.

