# Smart RT Android — Phase 5.2.1: Real Notification Tap Verification Report

**Date:** 2026-11-17
**Scope:** Additional verification only, on top of the already-completed Phase 5.2 implementation and crafted-intent device tests. No architecture, security design, migration, RLS, secret, or deployment changes were made in this phase.
**Review decision:** ACCEPTED WITH WARNINGS. Phase 5.2.1 is **complete** on this basis — Test A's BLOCKED status and Test B's NOT TESTED expired-session item are accepted as outstanding, documented limitations rather than failures requiring rework. No further implementation work is queued; the next phase requires explicit approval before starting.

---

## 1. Summary

| Test | Result | Nature of evidence |
|---|---|---|
| **A — Real FCM notification tap** (producer-dispatched push → shade → tap → navigation) | **BLOCKED** | No access to `FCM_FUNCTION_SECRET` / `SUPABASE_SERVICE_ROLE_KEY`; rotating the secret myself to unblock it was declined (same constraint as Phase 5.1.1). The authorized dispatch path (`send-fcm-notification`) exists and was not modified; no new trigger was invented. |
| **B — Unauthenticated access → login → return to destination** | **PASS** | Operator-reported browser observations (manual Incognito walkthrough) + independently-captured server-side evidence (curl against the same local server) |
| **B — Backoffice access restriction while authenticated as Resident** | **PASS** (narrow) | Operator-reported; a single observed redirect, not a full authorization audit |
| **B — Genuine expired-session scenario** (previously-valid session that then expires mid-use) | **NOT TESTED** | Explicitly out of scope for this walkthrough — see §4 |

No code, database, RLS policy, migration, secret, or deployment configuration was changed to produce these results.

---

## 2. Test A — Real Notification Tap: BLOCKED

**Objective:** Verify an actual FCM push (sent through the existing, authorized `send-fcm-notification` Edge Function, carrying the Phase 5.2 `data.path` navigation contract) is received on the physical device and that tapping it from the real notification shade navigates correctly.

**What exists and was confirmed not to need any change:**
- The Edge Function `send-fcm-notification` is deployed and ACTIVE on the staging project (confirmed again in Phase 5.1.1 — not re-audited here, per instruction not to repeat that audit).
- It already accepts an arbitrary `data` object, so dispatching with `data: { path: "/resident/bills" }` requires zero code changes.
- Calling it requires an `Authorization: Bearer <FCM_FUNCTION_SECRET or SUPABASE_SERVICE_ROLE_KEY>` header.

**Why this is BLOCKED, not FAIL or SKIPPED:**
- The Supabase CLI deliberately only exposes a SHA-256 digest of each secret (`supabase secrets list`), never the plaintext — by design, there is no way to retrieve the real value through tooling.
- Setting a *new* secret value (which I could then use) was attempted in Phase 5.1.1 and was explicitly denied by the harness's auto-mode classifier as a destructive action on a production secret, even though nothing else in the codebase references that secret. The same constraint applies here, and this phase's instructions explicitly forbid inventing a new dispatch trigger or treating a workaround as a substitute.
- This time, given the choice between (a) running the dispatch `curl` yourself, or (b) reporting BLOCKED, you chose (b).

**Per this phase's own instruction** — *"If no authorized notification dispatch path exists, report BLOCKED rather than creating a new dispatch trigger"* — this is reported as **BLOCKED**. The authorized path exists; it's the credential, not the mechanism, that's missing. No new trigger was created. No secret was rotated. No crafted-Intent workaround is substituted for this — that would misrepresent an already-completed Phase 5.2 test as a new one, and Phase 5.2.1's own objective is specifically the *real* FCM path, which was not exercised here.

**What remains unverified as a direct result:**
- Real FCM delivery → system tray → tap → `PendingIntent` → `MainActivity` → WebView, with an actual Google-delivered push (as opposed to a locally-crafted `Intent`, which Phase 5.2 already verified thoroughly).
- Foreground/background/terminated tap behavior specifically triggered by a *real* push notification (Phase 5.2's crafted-intent tests already verified the `MainActivity`/`NotificationDeepLinkResolver` logic itself is correct for all three states; what's still open is only the FCM-to-shade leg, which Phase 5.1.1 already verified in isolation without the Phase 5.2 navigation payload).

---

## 3. Test B — Unauthenticated Access, Login, and Return-to-Destination

**Classification note (per explicit instruction):** this exercises the *unauthenticated-access → login → return* path. It is **not** a genuine expired-session test (a previously-valid, authenticated session that expires mid-use and is then recovered) — that scenario was not constructed or tested here. See §4.

**Environment:**
- Local Next.js dev server (`npm run dev`, Turbopack), auto-selected port **3001** (port 3000 was already occupied by an unrelated process on the operator's machine — confirmed via the dev server's own startup log, not touched).
- `.env.local` confirmed (`NEXT_PUBLIC_SUPABASE_URL=https://szghujzhiyndeuhepsax.supabase.co`) to point at the same Supabase Cloud **staging** project used throughout this feature — not a new or separate project.
- No production deployment was made or touched.

**Provenance of evidence — read this before the results table:**
- Steps 1–2 below were independently re-confirmed by me via `curl` against the same running local server, immediately before handing off the walkthrough.
- Steps 3–6 (actual login form submission and post-login navigation) were performed manually by the operator in a real Incognito browser window — I have no tool-level access to that browser session, so these are **operator-reported observations**, not independently captured by me. They are reported here exactly as given, attributed as such.

| # | Step | Independently confirmed (curl) | Operator-reported (browser) | Result |
|---|---|---|---|---|
| 1 | Logged-out `GET /resident/bills` | `HTTP/1.1 307` → `location: /login?next=%2Fresident%2Fbills` | Matches: redirected to `/login?next=%2Fresident%2Fbills` | **PASS** |
| 2 | `next` parameter preserved through to the login page | Login page HTML contains `<input type="hidden" name="next" value="/resident/bills"/>` | Confirmed preserved | **PASS** |
| 3 | Manual login with an existing staging Resident account | *(not independently observable — real credentials, real browser session)* | "Resident login succeeds" | **PASS** (operator-reported) |
| 4 | Landing page immediately after login | *(not independently observable)* | "the application correctly redirects back to `/resident/bills`. Confirmed manually in the browser." | **PASS** (operator-reported) |
| 5 | While authenticated as Resident, `GET /bills` (admin-only Backoffice route) | *(not independently observable in this session — requires the operator's real authenticated cookies)* | "accessing `/bills` redirects to `/resident`" | **PASS** (operator-reported, narrow — a single observed redirect behavior, not a full role/authorization audit) |

**What this confirms, precisely:**
- The middleware change from Phase 5.2 (`src/lib/supabase/middleware.ts`) correctly scopes the `next` carry-through to `/resident/...` paths and correctly omits it for non-Resident paths (independently verified by curl in Phase 5.2 and reconfirmed here).
- The extended `resolveSafeNextPath()` (`src/lib/auth/next-path.ts`) correctly accepts the Resident-scoped `next` value and the login page correctly threads it into the form (independently verified by curl here).
- The real login Server Action (`src/app/actions/auth.ts`) and the real `(resident)` layout guard (`requireResidentContext()`) behave as designed end-to-end with a real account and a real browser session, per the operator's direct observation — this is the one piece that genuinely could not be verified without a real browser and real credentials, and it was not fabricated or assumed.
- `requireResidentContext()` / the Backoffice route's own guard still enforced server-side authorization while using this flow (step 5) — the `next` convenience did not bypass it, consistent with requirement 6 from Phase 5.2.

---

## 4. Explicitly NOT Tested

- **Genuine expired-session scenario.** What was tested is "never authenticated, hits a protected page, logs in, returns" — not "was authenticated, session expires/invalidates mid-use (e.g. token revoked, cookie cleared by the browser, Supabase session timeout), hits a protected page again, re-authenticates, returns." These exercise the same code path (the middleware's unauthenticated branch doesn't distinguish *why* `supabase.auth.getUser()` returned no user), so the underlying mechanism is the same, but the two scenarios were not treated as equivalent and the expired-session variant specifically was not constructed or observed.
- **Real FCM notification tap** (Test A) — BLOCKED, see §2.
- **Full Backoffice authorization audit** — step 5 above observed one redirect for one account on one route; it is not a substitute for a role/permission matrix audit.

---

## 5. Constraints Honored

- No production deployment.
- No migration or RLS change.
- No change to the already-passing FCM delivery flow (`send-fcm-notification` was not touched; no new dispatch trigger was created).
- No secrets, tokens, or credentials were requested, logged, or embedded in this report or in any command run during this verification.
- No unnecessary refactoring — zero application code files were modified in this phase (confirmed via `git status`: only this report and its predecessor are new).
- No scenario is marked PASS without either independent tooling evidence or an explicit, attributed operator observation; Test A is reported BLOCKED rather than worked around.
