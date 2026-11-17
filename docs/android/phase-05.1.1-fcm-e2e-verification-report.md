# Smart RT Android — Phase 5.1.1: FCM Staging End-to-End Verification Report

**Date:** 2026-11-17
**Backend:** Supabase Cloud Staging (`szghujzhiyndeuhepsax`)
**Edge Function:** `send-fcm-notification` (v2, ACTIVE)
**Device:** Google Pixel 9 Pro XL, Android 17 (real hardware, connected via `adb`, serial `47151FDASOO7DB`)
**APK:** `android/app/build/outputs/apk/staging/app-staging.apk` (`id.smartrt.resident.staging`, versionCode 1 / versionName 1.0.0)
**Testing method:** Mixed — infrastructure/backend checks performed via tooling (Supabase CLI, `adb`) in this session; the FCM dispatch call and the three device-reception scenarios were executed **manually by the developer** on the physical device. This report distinguishes tool-verified evidence from developer-reported results, and marks anything neither party captured as **NOT VERIFIED**.

---

## 1. Summary Table

| # | Scenario | Result | Evidence source |
|---|---|---|---|
| 1 | Migration `20261117002600_create_user_device_tokens.sql` applied on staging | **PASS** | Tool-verified |
| 2 | Edge Function `send-fcm-notification` deployed | **PASS** | Tool-verified |
| 3 | Required Supabase Secrets present (values not displayed) | **PASS** | Tool-verified |
| 4 | Latest staging APK installed on device | **PASS** | Tool-verified |
| 5 | Login as Resident demo account | **PASS** (pre-existing session) | Tool-verified (device screen state) |
| 6 | FCM token created & registered in `user_device_tokens` | **PASS** | Tool-verified (DB query) |
| 7 | Token correctly scoped to user + tenant | **PASS** | Tool-verified (DB query) |
| 8 | Test notification sent via official backend path | **PASS** | Developer-reported (HTTP response JSON) |
| 9a | Notification received — App foreground | **PASS** | Developer-reported only |
| 9b | Notification received — App background | **PASS** | Developer-reported only |
| 9c | Notification received — App terminated | **PASS** | Developer-reported **and** independently corroborated (logcat + `dumpsys notification`) |
| 10 | Tap notification — behavior recorded | **NOT VERIFIED** | Not captured by either party |
| 11 | Logout deactivates device registration | **NOT VERIFIED** | Not tested in this session |
| 12 | Re-login restores registration | **NOT VERIFIED** | Not tested in this session |
| 13 | Sanitized logs checked for credential/token leakage | **PASS** (within captured buffer) | Tool-verified |

Security checks (service account key exposure, public endpoint auth, cross-tenant leakage, duplicate dispatch, invalid-token handling): see Section 5.

---

## 2. Backend Infrastructure Verification (Tool-Verified)

### 2.1 Migration applied on staging
`supabase migration list --remote` (target: `smart-rt-staging` / `szghujzhiyndeuhepsax`) shows migration `20261117002600` present in both `local` and `remote` columns, alongside all prior migrations through `20261116002500`. **No pending/unapplied migrations.**

### 2.2 Edge Function deployed
`supabase functions list` returned:
```
slug: send-fcm-notification
status: ACTIVE
version: 2
verify_jwt: false
```
Function is live on the staging project.

### 2.3 Required secrets present
`supabase secrets list` was used in its default form, which returns only secret **names** and a SHA-256 **digest** of each value (never the plaintext) — satisfying the "without displaying values" requirement. All secrets referenced by `supabase/functions/send-fcm-notification/index.ts` are present on the staging project:

- `FCM_FUNCTION_SECRET`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_PROJECT_ID`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`, `SUPABASE_JWKS`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS` (Supabase-managed defaults)

No secret values were printed, copied, or rotated as part of this verification.

### 2.4 APK on device matches latest staging build
`adb shell dumpsys package id.smartrt.resident.staging`:
```
versionCode=1  versionName=1.0.0
lastUpdateTime=2026-11-17 12:20:27
```
Local build artifact `android/app/build/outputs/apk/staging/app-staging.apk` has filesystem mtime `2026-11-17 12:20`, matching the installed package's `lastUpdateTime`. The APK currently installed on the Pixel 9 Pro XL is the latest staging build.

---

## 3. Device Registration Verification (Tool-Verified, via read-only DB queries)

### 3.1 Login / session state
The app was already authenticated on the device at the start of this verification (persisted session). Screen capture confirmed the Resident dashboard rendered for tenant **"Keluarga Besar RT 06/02"**, user initials "IS", unit 303 — i.e., a functioning authenticated Resident session, consistent with Phase 4's documented demo account. No separate login/logout cycle was performed as part of *this* verification pass (see Section 6, open items).

### 3.2 Token registration
Read-only query against `public.user_device_tokens` on the staging project:

| field | value |
|---|---|
| `id` | `99b03289-0a47-4f2e-a2f7-5309cd034fd5` |
| `platform` | `android` |
| `is_active` | `true` |
| `created_at` / `last_seen_at` | `2026-11-17 05:28:14 UTC` |
| `tenant_id` | `d2e09c1a-24a0-4700-8029-ebb934d27de8` (tenant code `rt-01-rw-01-staging`, name "Keluarga Besar RT 06/02") |
| `user_id` | `8a23361e-f612-45c9-b936-dc2e41a1a557` |

Exactly **one** active token exists for this device/user — no stale or duplicate rows.

### 3.3 Tenant/user scoping correctness
Cross-checked against `public.tenant_members`: the same `user_id` has exactly one `active` membership row, for the same `tenant_id` (`d2e09c1a-24a0-4700-8029-ebb934d27de8`). Token tenant and user match the account's actual, sole tenant membership — **no cross-tenant association found.**

---

## 4. FCM Dispatch & Reception (Developer-Executed)

### 4.1 Dispatch call
Per security policy, the `FCM_FUNCTION_SECRET` bearer value was not retrieved or displayed in this session (the Supabase CLI only exposes a digest, by design). The developer executed the dispatch call directly against the deployed Edge Function endpoint using the official code path (`POST /functions/v1/send-fcm-notification`, authenticated with the internal function secret, targeting the registered tenant + recipient above).

**Developer-reported response:**
```json
{"ok":true,"total_recipients":1,"total_tokens":1,"success_count":1,"failure_count":0,"deactivated_tokens":0}
```
This indicates exactly 1 recipient resolved to exactly 1 active token, with 1 successful FCM v1 dispatch and 0 failures/deactivations. This HTTP response was **not independently captured by tooling in this session** — it is reported by the developer who ran the call.

### 4.2 Reception scenarios
The developer manually tested notification delivery across three app states and reported all three as successful (notification appeared on the Pixel 9 Pro XL):

- **Foreground:** PASS (developer-reported; no independent screenshot/log captured for this specific run).
- **Background:** PASS (developer-reported; no independent screenshot/log captured for this specific run).
- **Terminated:** PASS (developer-reported) **and corroborated independently** — see 4.3.

### 4.3 Independent corroboration (Terminated scenario)
While inspecting the device after the developer's manual test run, the following real, unmodified artifacts were found (not fabricated, not re-triggered):

**`adb logcat`:**
```
12:49:18.665  ActivityManager: Start proc 26689:id.smartrt.resident.staging/u0a361
              for broadcast {id.smartrt.resident.staging/com.google.firebase.iid.FirebaseInstanceIdReceiver}
...
12:51:11.205  Notify_NotificPush: onNotificationRemoved ... StatusBarNotification(
              pkg=id.smartrt.resident.staging tag=FCM-Notification:91301566
              Notification(channel=smartrt_resident_notifications ... color=0xff1e3a8a
              template=android.app.Notification$BigTextStyle))
12:51:11.209  Notify_NotificPush: removed msg when: 1794894558991, postTime: 1794894559018
```

**`adb shell dumpsys notification --noredact`** (still-retained record at inspection time):
```
tag=FCM-Notification:91301566  channel=smartrt_resident_notifications
android.title = "Smart RT — Terminated"
android.bigText = "FCM test scenario: Terminated"
color = 0xff1e3a8a   (matches the Edge Function's android.notification.color field)
```

`postTime` `1794894559018` ms converts to **2026-11-17 12:49:19 WIB**, one second after the `FirebaseInstanceIdReceiver` broadcast woke the (previously terminated) app process at `12:49:18.665`. This is independent, timestamp-consistent evidence that:
1. The app process was genuinely dead/terminated beforehand (it had to be cold-started by the Firebase broadcast receiver).
2. FCM delivery woke the process and a notification was posted immediately after, via the correct channel (`smartrt_resident_notifications`) with content matching the dispatched payload.

Note: `posttimeToFirstClickMs=-1` in the retained stats indicates this notification record was **not** tapped before it was removed — see Section 4.4 / item 10 below.

No equivalent log/dumpsys trace survived for the Foreground or Background runs by the time this inspection occurred (the on-device log buffer is shared with all other apps on this physical phone and rotates quickly), so those two remain developer-reported only.

### 4.4 Tap behavior (Step 10)
**NOT VERIFIED.** Neither the developer's report nor the captured logs confirm a tap interaction — the one notification record inspected shows `posttimeToFirstClickMs=-1` (never clicked) before being removed. Deep-link routing is explicitly out of scope for this phase per the task constraints, so this is recorded as an open item rather than a failure.

---

## 5. Security Checks

| Check | Result | Notes |
|---|---|---|
| No Firebase service account private key in APK/frontend | **PASS** (carried over from Phase 5.1) | Credentials only exist as Supabase Edge Function secrets (`FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`), confirmed present as secrets (Section 2.3), never bundled client-side. Not re-audited byte-for-byte in this pass. |
| No public endpoint without authorization | **PASS** | `send-fcm-notification` requires a bearer token matching `FCM_FUNCTION_SECRET` or `SUPABASE_SERVICE_ROLE_KEY`; confirmed from source (`index.ts` lines 274–284). `verify_jwt: false` is expected/intentional since the function implements its own bearer check. |
| No cross-tenant notification | **PASS** | Query in Section 3.3 confirms the only token in the table is scoped to the tenant the user actually belongs to; the Edge Function's token lookup additionally filters by `tenant_id=eq.&user_id=in.()` (source, line 334). |
| No duplicate notifications from payload + manual dispatch | **PASS** (by design inspection) | No DB trigger, webhook, or `pg_net` call to `send-fcm-notification` exists anywhere in `supabase/migrations/` — confirmed via repo search. Dispatch is only possible through the explicit manual/backend call tested in Section 4.1, so no dual-path duplication exists yet. |
| Invalid FCM token handling | **NOT VERIFIED in this pass** | Code path exists (`shouldDeactivateToken` on 404/`UNREGISTERED`/`NOT_FOUND`/`INVALID_ARGUMENT`, source lines 196–207, 416–436) and was unit-tested per Phase 5.1's `send-fcm-notification.test.mjs`, but was not re-exercised against a real stale token on staging in this session. |
| Sanitized logs free of credentials/tokens | **PASS (within captured buffer)** | Full `adb logcat -d` buffer (10,602 lines) and `dumpsys notification --noredact` output captured during this session were grep-scanned for `bearer`, `authorization`, `access_token`, `private_key`, `service_role`, JWT-like (`eyJ...`) strings, and `password` — **zero matches** on any `smartrt`/`fcm`-tagged line. Caveat: the Android log buffer is finite and shared with all other apps on this physical device, so this does not guarantee no leakage ever occurred outside the retained window — only that nothing in the window inspected leaked. |

---

## 6. Open Items / Not Verified

The developer's test run covered dispatch + reception (items 1–9, 13). The following steps from the verification plan were **not exercised** in this session and are explicitly flagged rather than assumed:

- **Tap-to-open behavior** (step 10) — no tap was recorded in the inspected evidence.
- **Logout deactivates device registration** (step 11) — not tested.
- **Re-login restores registration** (step 12) — not tested.
- **Invalid/stale token handling against a real token** — covered by unit tests only, not exercised live on staging.

No code, database schema, migrations, secrets, or configuration were modified during this verification. No additional FCM sends were triggered beyond the single developer-executed dispatch reported in Section 4.1.

---

## 7. Conclusion

Core infrastructure (migration, Edge Function, secrets, APK build, token registration, tenant scoping) is independently **tool-verified and PASS**. The end-to-end push delivery itself is **PASS** based on the developer's direct manual test on the Pixel 9 Pro XL, with the Terminated-state scenario additionally corroborated by independent, timestamp-consistent device logs captured during this session. Tap behavior, logout/re-login registration lifecycle, and live invalid-token handling remain open for a follow-up pass.
