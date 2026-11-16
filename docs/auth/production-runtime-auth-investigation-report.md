# Production Runtime Auth Investigation Report

## Final Status: **PASS** — no application regression; root cause isolated and fixed in test infrastructure only

Deployment is **not blocked** by this issue. The authenticated-session failure
observed in 6 integration/SSR test suites was caused by a test-harness
assumption that does not hold for Next.js, not by any defect in the
application, `@supabase/ssr`, `@supabase/supabase-js`, or Next.js 16.4.6. No
application code, middleware, Supabase client factory, or dependency version
was changed. `package.json` / `package-lock.json` are untouched (verified:
`git diff --stat` on every auth-related file and both lockfiles returns
empty).

## 1. Reproduction

A minimal, Community-Feed-independent script reproduced the failure outside
any test file:

1. Create a fresh user via the local Supabase Admin API.
2. Sign in with `@supabase/ssr`'s `createServerClient`, capturing the
   `Set-Cookie` the way a real browser would.
3. Run `npm run build` (whatever `.env.local` currently contains) then
   `next start -p 3999`.
4. `GET /api/activities` with that cookie.

Result: `401 {"error":"Sesi login tidak ditemukan."}` for every role, even
though the user was genuinely signed in seconds earlier.

## 2. Evidence Trail

Each step below narrowed the cause until it was unambiguous. All temporary
debug code was reverted immediately after use; `git diff` on every touched
source file was empty before the next step.

1. **The cookie reaches the route handler intact.** A temporary debug log in
   `getAuthContext()` (reverted immediately after, confirmed via `git diff` ==
   empty) printed `cookies().getAll()` inside the live request: the exact
   `sb-127-auth-token` cookie, correct length, was present. `supabase.auth
   .getUser()` still threw `AuthSessionMissingError` on the very same request.
2. **The cookie/session is valid on its own.** Outside of Next.js entirely —
   same `@supabase/ssr` version, same cookie value, plain Node script — a
   fresh `createServerClient(...).auth.getUser()` resolved the user
   successfully, and a direct `fetch` to GoTrue's `/auth/v1/user` with the
   embedded access token returned `200` with the full user object. The token
   and cookie encoding are both fine.
3. **The storage *key* `@supabase/ssr` looked for didn't match the cookie
   *name* that was sent.** A temporary one-line diagnostic added to the
   installed `@supabase/ssr` package (`node_modules`, never committed,
   reinstalled clean via `npm install @supabase/ssr@0.12.7 --no-save`
   immediately after) printed the exact key the storage adapter queried on
   each request:
   ```
   [SSR_DEBUG] getItem key= "sb-szghujzhiyndeuhepsax-auth-token" allCookies= [{"name":"sb-127-auth-token", ...}]
   ```
   The server was looking for a cookie named for the **Supabase Cloud staging
   project's ref** (`szghujzhiyndeuhepsax`), while the test's signed-in
   session cookie was named for the **local Supabase instance**
   (`sb-127-auth-token`, derived from `127.0.0.1:54321`). Two different
   projects, two different derived cookie names — a pure name mismatch, not a
   session, chunking, encoding, PKCE, or framework bug.
4. **Why the names differed: `NEXT_PUBLIC_*` is a build-time constant.**
   Next.js inlines `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   into the compiled bundle at `next build` time — it is **not** read from
   `process.env` at request time in a production (`next start`) server. The
   failing tests' `startNextServer()` helper only passed these as **runtime**
   env vars to the spawned `next start` process; it never controlled what the
   already-existing `.next/` build had been compiled with. Since this
   session's `.env.local` currently points at the Cloud staging project, the
   last `npm run build` baked in `szghujzhiyndeuhepsax` as the project ref —
   and every `@supabase/ssr` storage key computed inside that bundle uses that
   ref, regardless of what the test spawns the server with afterward.
5. **Definitive confirmation.** Rebuilding with
   `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` /
   `NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon key>` set **before** `npm run
   build`, then repeating the exact same reproduction script unmodified: the
   same cookie now resolved correctly and the API returned `403` (forbidden —
   the correct, expected answer for that role) instead of `401`. A second,
   independent confirmation specifically for Community Feed (`GET
   /api/community-feed`, real tenant/member fixture, real cookie) returned
   `401` unauthenticated / `200` with a correct feed payload authenticated —
   proving the mechanism, not just the activities route, is sound once build
   and runtime targets agree.

## 3. Root Cause

**Not** a dependency incompatibility, **not** a Next.js 16 breaking change,
**not** a `@supabase/ssr` bug, **not** an application code defect. It is an
environment/precondition mismatch specific to how these 6 test suites are
invoked:

- They assume the existing `.next/` build was already compiled against the
  **local** Supabase instance (the normal local-dev setup).
- They do not rebuild before spawning `next start`; they only override env
  vars at spawn time, which has no effect on already-inlined
  `NEXT_PUBLIC_*` references.
- In this session, `.env.local` is currently pointed at the Cloud **staging**
  project (expected, given the broader staging-verification task), so the
  pre-existing `.next/` build's inlined storage-key ref no longer matched the
  local Supabase test users these suites sign in against.

Nothing about this affects a real deployment: Vercel injects its own
configured `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` **before**
running `next build` for that environment, so the browser's sign-in cookie
name and the server's lookup key are always derived from the *same* value in
a real deployment. There is no code path in this app where they could diverge
outside of this specific local test-harness assumption.

## 4. Files Changed

**Application code: none.** `src/lib/auth/server.ts`,
`src/lib/supabase/{server,middleware,config}.ts`, `src/proxy.ts`,
`package.json`, `package-lock.json` — all unchanged (`git diff --stat`
confirmed empty for all of them).

**Test infrastructure only** — added a rebuild step to `startNextServer()` in
the 6 files that spawn a production Next.js server, so each test's build
target actually matches the env it signs in against, regardless of what
`.env.local` currently points at:

- `tests/activities/activities.integration.test.mjs`
- `tests/activities/activities.ui.test.mjs`
- `tests/activities/activities-resident.ui.test.mjs`
- `tests/complaints/complaints.integration.test.mjs`
- `tests/letters/letters.integration.test.mjs`
- `tests/ronda/ronda.integration.test.mjs`

The change in each file is identical and minimal:

```js
// Before:
async function startNextServer(port, envOverrides) {
  const proc = spawn("npx", ["next", "start", "-p", String(port)], {
    cwd: process.cwd(), // or ROOT
    env: { ...process.env, ...envOverrides },
    stdio: ["ignore", "pipe", "pipe"],
  })
  ...

// After:
async function startNextServer(port, envOverrides) {
  // NEXT_PUBLIC_* is inlined at `next build` time, not read at runtime.
  execFileSync("npx", ["next", "build"], {
    cwd: process.cwd(), // or ROOT
    env: { ...process.env, ...envOverrides },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const proc = spawn("npx", ["next", "start", "-p", String(port)], {
    cwd: process.cwd(), // or ROOT
    env: { ...process.env, ...envOverrides },
    stdio: ["ignore", "pipe", "pipe"],
  })
  ...
```

No `getUser()` → `getSession()` substitution, no middleware changes, no
dependency version changes, no weakening of any route guard — exactly as
constrained.

**One operational note for running these tests going forward:** because all
6 files now call `next build` against the same shared `.next/` output
directory, running them together via a glob (`node --test tests/**/*.test.mjs`)
can race ("Another next build process is already running") since Node's test
runner parallelizes across files by default. Run them with
`node --test --test-concurrency=1 tests/**/*.test.mjs`, or one file at a time,
which is also how they behave correctly today.

## 5. Before / After Test Results

| | Before | After |
|---|---|---|
| Step 12.2 (ronda integration) | FAIL (401 instead of 403) | **PASS** |
| Step 13.2 (complaints integration) | FAIL | **PASS** |
| Step 14.2 (letters integration) | FAIL | **PASS** |
| Step 15.2 (activities integration) | FAIL | **PASS** |
| Step 15.3 (activities admin SSR) | FAIL | **PASS** |
| Step 15.4 (activities resident SSR) | FAIL | **PASS** |
| Full suite (`node --test --test-concurrency=1 tests/**/*.test.mjs`) | 86 pass / 10 fail (90/6 after an earlier, unrelated nav-slot fix) | **96 / 96 pass** |
| `npm run typecheck` | — | PASS |
| `npm run lint` | — | PASS |
| `npm run build` | — | PASS |

## 6. Regression Coverage Against the Required Scenarios

| Scenario | Status |
|---|---|
| Fresh login → authenticated request on `next start` | **Verified** — all 6 fixed suites do exactly this against admin and resident routes; all pass. |
| Existing session across page navigation | Implicitly covered — each test reuses one signed-in cookie across multiple sequential HTTP calls to different endpoints within the same run; all succeed. Not a dedicated single-purpose test. |
| Expired access token with valid refresh token | **Not covered** by any existing or new test. No code on this path (`@supabase/ssr` refresh logic, middleware, client factories) was touched, so no risk was introduced, but this scenario has no dedicated regression test today — recommend adding one separately. |
| Invalid or missing session | **Verified** — the "unauthenticated → 401 on every endpoint" checks in the fixed suites pass, plus a dedicated unauthenticated check in the new Community Feed HTTP confirmation. |
| Logout → subsequent protected-route access | **Not covered** by any existing or new test. Same as above: no code on this path was touched. |
| Resident and Backoffice authenticated routes | **Verified** — both admin (`/api/activities`, `/api/complaints`, `/api/letters`, `/api/ronda`) and resident (`/api/resident/...`) routes are exercised across the fixed suites. |
| Existing Community Feed authenticated operations | **Verified directly** — a dedicated confirmation (real tenant/member fixture, real signed-in cookie, matching build target) against `GET /api/community-feed` returned `401` unauthenticated and `200` with a correct feed payload (`{"items":[],"hasMore":false,"nextCursor":null}`) authenticated. |

## 7. Remaining Risks

1. **Logout and token-refresh paths have no dedicated test coverage** (pre-existing gap, not introduced or touched here). Low risk given no related code changed, but worth closing separately.
2. **The 6 fixed test files now take longer to run** (each does a full `next build` before `next start`). This is a deliberate, necessary trade-off for correctness and only affects local/CI test run time, not the application.
3. **Running the fixed suites concurrently via a glob races on the shared `.next/` build lock.** Documented above; use `--test-concurrency=1` or run files individually.
4. This investigation did not change, and did not need to change, anything about how the real Vercel deployment will build or behave — that risk surface is unaffected by today's finding.

## 8. Explicit Deployment Recommendation

**PASS.** There is no authentication regression in the application. The
6 previously-failing suites were a false signal caused by a local test-harness
precondition (build-time env vars) not matching the currently-configured
`.env.local` target (Cloud staging) — now fixed in the test harness itself,
with zero application or dependency changes. Deployment planning (Vercel
staging) can proceed on its own merits; this investigation does not block it
and does not need to be re-run before deploying.
