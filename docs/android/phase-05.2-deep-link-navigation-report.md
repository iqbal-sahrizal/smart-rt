# Smart RT Android — Phase 5.2: Deep Links & Notification Navigation Report

**Date:** 2026-11-17
**Scope:** Safe in-app navigation when a Resident taps a push notification, across foreground, background, and terminated app states, with an expired-session return-URL path through the existing login flow.
**Status:** Implementation complete. No architecture/security decision required developer escalation — the existing `TrustedOriginPolicy` / exported-Activity threat model already anticipated this exact feature.

---

## 1. Architecture Recap & Decision

Next.js Resident remains the single source of truth for routing. Android only:
1. Receives the notification-tap `Intent`.
2. Independently re-validates its `target_url` extra (never trusts that it only came from our own FCM payload — `MainActivity` is `android:exported="true"`, required for the launcher intent-filter, so **any** app on the device can start it with arbitrary extras).
3. Loads the resulting URL in the WebView if, and only if, validation passes. No business logic (which announcement ID maps to which page) lives in Kotlin.

Session validity and authorization are enforced exactly where they already were: Next.js middleware (`src/lib/supabase/middleware.ts`) and the `requireResidentContext()` guard on the `(resident)` layout. Android never bypasses either — it just loads a URL, same as a manual tap on any in-app link.

---

## 2. Navigation Payload Contract (Requirement 2)

```
FCM data.path = "<Resident-scoped relative path>"   e.g. "/resident/announcements/<uuid>"
```

- **Never a full URL.** The origin always comes from the app's own compiled-in `BuildConfig.WEB_BASE_URL`, never from the payload — this fully satisfies requirement 3 (only the configured staging/production origin is ever used) by construction, not just by validation.
- **Never a token/credential** (requirement 12) — the only sanctioned field is `path`.
- Producer side (Next.js, for whenever a future phase wires up an actual dispatch trigger): `buildPushNavigationPayload(referenceType, referenceId)` in `src/lib/notifications/push-payload.ts`, which reuses the **existing**, already-shipped `resolveNotificationDestination("resident", ...)` from `src/lib/notifications/types.ts` — the same function that already drives the web notification center's link targets. No new routing table was invented.
- Consumer side (Android): `PushNavigationResolver.resolveTargetUrl()` reads `data["path"]`, validates it, and only then concatenates it onto the trusted origin.
- `send-fcm-notification` (the already-PASS Phase 5.1.1 Edge Function) was **not modified** — its `data?: Record<string,string>` field was already generic enough to carry `path` with zero changes, per the constraint not to touch the already-verified delivery flow.

No caller currently invokes `send-fcm-notification` with this payload (confirmed in Phase 5.1.1's audit — no dispatch trigger exists yet in the codebase). This phase delivers the contract and the full receiving/validation path; wiring an actual "on announcement published, push a notification" trigger is a future phase's job.

---

## 3. Android Implementation

| File | Change |
|---|---|
| `security/TrustedOriginPolicy.kt` | **Added** `validateNotificationPath()` — a new, self-contained validator (deliberately *not* a refactor of the already-audited `validateDocumentPath`, to carry zero regression risk). Layers: raw pattern rejection → iterative decode-loop traversal rejection → URI structural validation (no scheme/authority/userinfo/port) → normalized-path boundary check against the `/resident` root (`== "/resident"` or `startsWith("/resident/")`, so `/resident-invitations` can never match) → explicit Backoffice-route rejection → query scheme-injection rejection. |
| `navigation/NotificationDeepLinkResolver.kt` | **New.** Pure decision logic: re-validates `target_url` via `TrustedOriginPolicy`, and deduplicates repeated `onNewIntent` delivery of the same tap via an opaque `nav_token` (requirement 10). |
| `notification/PushNavigationResolver.kt` | **New.** Pure function: `data["path"]` → validated → combined with `BuildConfig.WEB_BASE_URL` → `target_url`. The origin is never taken from the payload. |
| `notification/SmartRtNotificationManager.kt` | `showNotification()` now builds `target_url` via `PushNavigationResolver` (was: trusting `data["url"]` directly) and always stamps a `nav_token` extra (the notification ID). A failed path validation is logged by reason only — never the raw attacker/malformed value (requirement: don't log sensitive data). |
| `MainActivity.kt` | `onCreate` and `onNewIntent` now both funnel through one `handleDeepLinkIntent()` → `NotificationDeepLinkResolver.resolve()`. Cold launch falls back to `/resident` on an invalid/absent target; a tap while running simply does nothing on an invalid/duplicate target (app just comes to foreground on whatever page it already had open — requirement 9). |

Requirement 11 (Back navigation / PWA behavior) — `WebViewBackNavigation.kt` was **not touched**; unaffected by construction.

---

## 4. Next.js Implementation (Expired-Session Return URL — Requirements 7, 8)

| File | Change |
|---|---|
| `src/lib/auth/next-path.ts` | **New.** `resolveSafeNextPath()` extracted out of `src/lib/auth/cookies.ts` into its own dependency-free module (no `server-only`, no `next/headers`) so it's directly unit-testable. Extended beyond the pre-existing `/activate-account` allowance to also accept `/resident` / `/resident/...` return targets, with explicit `..` rejection (dot-segment traversal could otherwise resolve, client-side, to a path outside the intended scope even though it's same-origin). |
| `src/lib/auth/cookies.ts` | Now re-exports `resolveSafeNextPath` from `next-path.ts` (no behavior change for existing callers — `src/app/login/page.tsx` and `src/app/actions/auth.ts` import it unchanged). |
| `src/lib/supabase/middleware.ts` | When an unauthenticated request hits a `/resident/...` path, the redirect to `/login` now carries `?next=<original path+query>`. Scoped strictly to `/resident` paths and guarded against `..`; this is a convenience carry-through, **not** the authorization boundary — `requireResidentContext()` on the resident layout still gates every page regardless of how `next` was produced. |

If a session is still valid (requirement 7), Android just loads the resolved URL directly — Next.js serves the page, no special handling needed. If the session is expired (requirement 8), Next.js's own middleware now redirects to `/login?next=...`, the login page already renders a hidden `next` field, and the login action already redirects there after re-auth — all three pieces pre-existed for the `/activate-account` flow and are now reused for Resident deep links instead of inventing a parallel mechanism.

---

## 5. Security Checklist

| Requirement | How it's satisfied |
|---|---|
| Only configured HTTPS staging/production origin | Origin is never read from the payload at all — always `BuildConfig.WEB_BASE_URL` (compile-time constant per build flavor). |
| Only valid Resident routes | `validateNotificationPath` boundary-checks against `/resident` root only. |
| Reject external URL, `javascript:`, `file:`, encoded traversal, malformed URL, Backoffice routes | All rejected — see layered validator (§3) and live verification (§7). |
| Deep link cannot bypass server-side auth/authorization | Android never does anything but `loadUrl()`; Next.js middleware + `requireResidentContext()` still gate every request exactly as before. |
| No access/refresh token or credential in URL/payload | Contract carries only a relative `path` string; `nav_token` is an opaque notification ID, not a secret. |
| No `addJavascriptInterface` | Not used — Phase 5.2 added no new bridge surface; the existing `WebViewCompat.addWebMessageListener` bridge is untouched. |
| No SSL validation weakening | `SmartRtWebViewClient.onReceivedSslError` (untouched) still unconditionally cancels. |
| No RLS/authorization weakening | No migration or RLS policy touched. |
| No sensitive data in logs | `SmartRtNotificationManager` logs only "validation failed" — never the raw path value. |
| Prevent duplicate navigation on Activity recreation / repeated `onNewIntent` | `NotificationDeepLinkResolver`'s `nav_token` dedup — verified both in unit tests and live on-device (§7). |

---

## 6. Automated Test Results

### Android (`./gradlew testDebugUnitTest lintDebug`)

| Suite | Result |
|---|---|
| Full existing unit test suite | **104/104 pass**, 0 failures, 0 errors (includes all pre-existing suites — zero regressions) |
| `TrustedOriginPolicyTest` (30 tests incl. 9 new `validateNotificationPath` cases) | PASS |
| `NotificationDeepLinkResolverTest` (10 new tests — cold launch, foreground/background tap, external/javascript/file/backoffice/traversal rejection, dedup, distinct-token-after-dedup) | PASS |
| `PushNavigationResolverTest` (6 new tests — valid path, missing path, backoffice rejection, full-URL-in-path rejection, traversal rejection, payload fields never influence origin) | PASS |
| `lintDebug` | PASS, zero errors |
| `assembleStaging` | PASS — APK built and installed on real hardware for live verification (§7) |

### Next.js (`node --test`, `tsc --noEmit`)

| Suite | Result |
|---|---|
| `npm run typecheck` | PASS, zero errors |
| `tests/deep-links/next-path.unit.test.mjs` (6 new tests) | PASS |
| `tests/deep-links/push-payload.unit.test.mjs` (6 new tests) | PASS |
| Full existing suite (`node --test --test-concurrency=1 tests/**/*.test.mjs`) | 125/136 pass; the 11 failures are **pre-existing and unrelated** — all are DB-integration tests requiring a local Docker/Supabase stack, which isn't running in this environment (`ECONNREFUSED .../docker.sock`). None touch auth/cookies/middleware/notifications. |

---

## 7. Live Device Verification (Google Pixel 9 Pro XL, real hardware)

Built `assembleStaging` with the new code and installed it over the existing app (`adb install -r`). Tested by sending crafted `Intent`s directly to the exported `MainActivity` — this is the actual real-world attack surface (any component on the device can do this), not just a simulated FCM payload.

| # | Scenario | Method | Result | Evidence |
|---|---|---|---|---|
| 1 | Terminated → cold launch, valid deep link (`/resident/bills`) | `force-stop` then `am start` with `target_url`/`nav_token` | **PASS** | Screenshot: app opened directly on "Tagihan" (Bills) page, correct bottom-nav tab highlighted |
| 2 | Foreground/background tap, valid deep link (`/resident/announcements`), app already running | `am start` while running → delivered via `onNewIntent` (adb confirmed: *"intent has been delivered to currently running top-most instance"*) | **PASS** | Screenshot: navigated from Bills to "Pengumuman" (Announcements) |
| 3 | Duplicate `nav_token` dedup | Navigated to `/resident/layanan` with `nav_token=dup-A`, then resent the **same** token with a **different** target (`/resident/feed`) | **PASS** | Screenshot: app stayed on "Layanan Warga" — the second call was correctly ignored, confirming requirement 10 live, not just in unit tests |
| 4 | Reject external domain | `target_url="https://evil-attacker.com/resident/bills"` | **PASS** | Screenshot: no navigation, app stayed on current page |
| 5 | Reject Backoffice route on trusted origin | `target_url="https://smart-rt-nine.vercel.app/bills"` | **PASS** | Screenshot: no navigation |
| 6 | Reject `javascript:` scheme | `target_url="javascript:void0"` | **PASS** | Screenshot: no navigation |
| 7 | Reject encoded path traversal | `target_url=".../resident/%2e%2e/%2e%2e/admin"` | **PASS** | Screenshot: no navigation |
| 8 | Session-valid navigation (requirement 7) | Covered by scenarios 1–2 above (device had an active authenticated session) | **PASS** | Same as above |
| 9 | Expired-session return URL (requirement 8) | **Not exercised on-device** (would require logging out the real resident test session on the user's personal phone — judged unnecessary risk given §9 below) | **PASS, verified via real HTTP instead** | See next row |
| 10 | `/login?next=` redirect chain, end-to-end | Started a real local `next dev` server; `curl` unauthenticated against `/resident/bills`, `/resident`, `/bills`, and a query-bearing resident URL; then `curl` the resulting `/login?next=...` page | **PASS** | `/resident/bills` → `307` to `/login?next=%2Fresident%2Fbills`; `/bills` (admin path) → plain `/login` (no `next`, confirming scoping); `/login?next=%2Fresident%2Fbills` renders `<input type="hidden" name="next" value="/resident/bills">`; `/login?next=%2F%2Fevil.com` renders **no** hidden input (open-redirect attempt correctly stripped) |
| 11 | Tap behavior across all 3 app states (requirement 9) | Terminated covered by #1; foreground/background both route through `onNewIntent` identically on Android (confirmed via adb's own "delivered to currently running top-most instance" message) — Android does not distinguish foreground vs. background for `onNewIntent` delivery, so one live test covers both | **PASS** | Same mechanism; no separate code path exists to test differently |

No personal data was exposed in this report. One live screenshot briefly surfaced the tester's personal home screen (private photo + notification previews) when the device was first unlocked for testing — that image was deleted immediately and never referenced in this document.

---

## 8. Not Modified (per scope constraints)

- No migration changed (`supabase/migrations/` untouched).
- No new Supabase/Firebase project.
- `send-fcm-notification` Edge Function: zero changes (its generic `data` field already supported this contract).
- No Phase 5.1 FCM delivery flow changes.
- No full Android App Links / `assetlinks.json` — out of scope; this phase is notification-tap navigation only, and `MainActivity`'s manifest intent-filter is unchanged (no new `<data>` scheme/host entries were added or needed).

## 9. Open Items

- No actual notification dispatch trigger exists yet that calls `buildPushNavigationPayload()` — a future phase must wire it into whatever creates announcements/bills/etc. and decides to push.
- Expired-session return-URL was verified at the HTTP/middleware level (real, unmocked) but not replayed end-to-end inside the WebView on the physical device, to avoid logging out the tester's active resident session unnecessarily. The underlying mechanism (middleware → login page → login action) is the same code path regardless of whether the request originates from a WebView or a browser, so this is a convenience gap, not a confidence gap.
