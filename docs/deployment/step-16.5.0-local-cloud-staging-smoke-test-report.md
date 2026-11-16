# Step 16.5.0 — Local-to-Cloud Staging Connectivity & Smoke Test Report

**Date:** 2026-11-16  
**Step:** 16.5.0 — Local-to-Cloud Staging Connectivity & Smoke Test  
**Executed By:** Antigravity Agent  
**Project:** `smart-rt-staging` · ref `szghujzhiyndeuhepsax` · `ap-southeast-1`

---

## Status Summary

| Phase | Area | Status |
|---|---|---|
| Phase 1 | Environment Audit | ✅ PASS |
| Phase 2 | Application Connectivity | ✅ PASS |
| Phase 3 | Admin Auth (server-side data) | ✅ PASS |
| Phase 3 | Admin Auth (browser login) | ⚠️ NOT VERIFIED (browser blocked) |
| Phase 4 | Route Smoke Test (unauthenticated guard) | ✅ PASS |
| Phase 4 | Route Smoke Test (authenticated rendering) | 🚫 BLOCKED |
| Phase 5 | Authorization Architecture Review | ✅ PASS |
| Phase 6 | Supabase Staging Data Integrity | ✅ PASS |

**Overall Status: ⚠️ PASS WITH WARNINGS**

> Core connectivity, auth configuration, server-side guards, and staging data integrity are all verified PASS.  
> Authenticated browser route rendering and visual UI verification remain BLOCKED due to Chrome remote debugging being unavailable.

---

## Phase 1 — Environment Audit ✅ PASS

### Checks

| Check | Expected | Result | Status |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` present | Yes | `https://szghujzhiyndeuhepsax.supabase.co` | ✅ PASS |
| URL project ref matches staging | `szghujzhiyndeuhepsax` | ✅ Confirmed | ✅ PASS |
| Anon key present | Yes | Present (`sb_*` new Supabase format) | ✅ PASS |
| `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` | Absent | ✅ Not present | ✅ PASS |
| Total `NEXT_PUBLIC_*` keys | 2 only | 2 (URL + anon key) | ✅ PASS |
| Local Supabase URL (`localhost:54*`) | Absent | ✅ Not present | ✅ PASS |
| `127.0.0.1` Supabase URL | Absent | ✅ Not present | ✅ PASS |
| `.env.local` total lines | — | 4 lines (2 keys + 1 blank) | ✅ PASS |

**No service-role key exposed to browser. No local Supabase URL active.**

> **Note:** Anon key uses Supabase new `sb_*` publishable key format (not JWT). This is the expected format for Supabase projects provisioned after the new key system was introduced. The key is safe for browser use.

---

## Phase 2 — Application Connectivity ✅ PASS

### Next.js Dev Server

| Check | Result | Status |
|---|---|---|
| Dev server process running | PID 65375 listening on `:3000` | ✅ PASS |
| Root `/` HTTP response | `307 → /login` | ✅ PASS |
| `/login` HTTP response | `200 OK` | ✅ PASS |
| Supabase URL reachable (via app config) | Validated via `getSupabaseConfig()` | ✅ PASS |

### Auth Middleware Architecture

**File:** `src/lib/supabase/middleware.ts`

- Uses `@supabase/ssr` `createServerClient` — correct server-side Supabase client.
- Calls `supabase.auth.getUser()` — validates session server-side against Supabase Cloud (not from client-controlled JWT decode).
- Unauthenticated requests to protected paths → redirect to `/login`.
- Cookie forwarding implemented correctly via `setAll` / `getAll`.
- Public paths explicitly declared: `/login`, `/activate-account`, `/auth/callback`.

### Auth Callback

**File:** `src/app/auth/callback/route.ts`

- Handles PKCE `code` exchange and OTP `token_hash` flows.
- Uses `resolveSafeNextPath()` for safe redirect target resolution — prevents open redirect.
- Allowed OTP types explicitly allowlisted: `signup`, `email`, `recovery`, `invite`, `email_change`.
- Error paths redirect to `/login?error=auth_callback` — no stack traces or secrets in redirect.

### Supabase Config Validation

**File:** `src/lib/supabase/config.ts`

- Validates URL is a valid `http/https` URL and not a `/rest/v1` suffixed endpoint.
- Throws descriptive errors if `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` are missing.
- No service-role key referenced or used anywhere in config.

---

## Phase 3 — Admin Authentication ✅ PASS (server-side) / 🚫 BLOCKED (browser)

### Server-Side Data Verification (Supabase read-only query)

| Check | Expected | Actual | Status |
|---|---|---|---|
| Auth user exists | Yes | ✅ `true` | ✅ PASS |
| Email confirmed | Yes | ✅ `true` | ✅ PASS |
| Profile exists | Yes | ✅ `true` | ✅ PASS |
| `active_tenant_id` matches staging tenant | Yes | ✅ `true` | ✅ PASS |
| Total memberships | 1 | ✅ 1 | ✅ PASS |
| Active memberships | 1 | ✅ 1 | ✅ PASS |
| Staging memberships | 1 | ✅ 1 | ✅ PASS |
| `resident_id` | NULL | ✅ NULL (0 with resident_id) | ✅ PASS |
| Duplicate memberships | 0 | ✅ 0 | ✅ PASS |
| Total role assignments | 1 | ✅ 1 | ✅ PASS |
| Role code | `ketua_rt` | ✅ 1 `ketua_rt` | ✅ PASS |
| Cross-tenant memberships | 0 | ✅ 0 | ✅ PASS |

**Admin Auth User ID:** `0c0445e4-efce-4173-91e3-b2de82d1d510`  
**Admin Member ID:** `78f91524-3f4c-4dd9-833e-16a11304e928`  
**Tenant:** `RT 01 / RW 01 Staging` (`rt-01-rw-01-staging`) · status `active`

### Browser Login

> **Status: 🚫 BLOCKED**  
> Chrome remote debugging port 9222 was not reachable. Browser automation could not be performed. Login flow has not been visually verified.  
> Operator confirmed login was performed manually, but this cannot be recorded as a verified test result without browser automation evidence.

---

## Phase 4 — Route Smoke Test

### Unauthenticated Guard (curl, no session cookie)

| Route | HTTP Response | Redirect Target | Status |
|---|---|---|---|
| `/login` | `200 OK` | — | ✅ PASS |
| `/dashboard` | `307 → /login` | `/login` | ✅ PASS |
| `/warga` | `307 → /login` | `/login` | ✅ PASS |
| `/pengumuman` | `307 → /login` | `/login` | ✅ PASS |
| `/tagihan` | `307 → /login` | `/login` | ✅ PASS |
| `/keuangan` | `307 → /login` | `/login` | ✅ PASS |
| `/pengaduan` | `307 → /login` | `/login` | ✅ PASS |
| `/surat` | `307 → /login` | `/login` | ✅ PASS |
| `/kegiatan` | `307 → /login` | `/login` | ✅ PASS |
| `/ronda` | `307 → /login` | `/login` | ✅ PASS |

All 9 protected routes correctly redirect unauthenticated requests to `/login` via server-side middleware. Auth guard is functioning.

### Authenticated Rendering

> **Status: 🚫 BLOCKED**  
> Cannot verify authenticated route rendering without browser automation. Chrome remote debugging port 9222 was unavailable despite multiple restart attempts. Routes have not been tested with an active session cookie.

---

## Phase 5 — Authorization Architecture Review ✅ PASS

| Check | Finding | Status |
|---|---|---|
| Session validated server-side | `supabase.auth.getUser()` in middleware — calls Supabase Cloud, not client JWT | ✅ PASS |
| Tenant ID not from client-controlled header | Tenant context resolved from `profiles.active_tenant_id` populated by DB trigger, not from URL param | ✅ PASS |
| No open redirect in auth callback | `resolveSafeNextPath()` sanitizes `next` param | ✅ PASS |
| OTP type allowlist enforced | Only 5 allowed types in `ALLOWED_OTP_TYPES` Set | ✅ PASS |
| No service-role key used in browser context | Confirmed via env audit | ✅ PASS |
| RLS active on all 33 tables | `secured: 33, unsecured: 0` | ✅ PASS |

---

## Phase 6 — Supabase Staging Data Integrity ✅ PASS

Raw verification output (redacted of sensitive values):

```json
{
  "auth_check": {
    "email_confirmed": true,
    "profile_exists": true,
    "active_tenant_matches_staging": true
  },
  "tenant": {
    "code": "rt-01-rw-01-staging",
    "name": "RT 01 / RW 01 Staging",
    "status": "active"
  },
  "membership": {
    "total": 1,
    "active": 1,
    "staging": 1,
    "with_resident_id": 0
  },
  "duplicate_memberships": 0,
  "role_assignment": {
    "total": 1,
    "ketua_rt": 1
  },
  "rls": {
    "secured": 33,
    "unsecured": 0,
    "unsecured_tables": []
  },
  "cross_tenant_memberships": 0
}
```

---

## Known Limitations

| Limitation | Reason | Impact |
|---|---|---|
| Browser route rendering NOT verified | Chrome remote debugging port 9222 unavailable | Cannot confirm authenticated UI renders correctly |
| Login flow NOT visually verified | Browser automation blocked | Cannot confirm session cookie is set, dashboard loads, or role badge shows |
| No screenshot evidence | Browser blocked | Report relies on server-side verification only |
| `.next/server/middleware-manifest.json` shows empty middleware | App uses Supabase middleware via `src/lib/supabase/middleware.ts` invoked through Next.js layout/page level, not Edge middleware | Auth guards work at page level, not Edge runtime |

> **Note on middleware:** The compiled `middleware-manifest.json` is empty, indicating no Edge middleware is registered. Auth is enforced at the page/server component level via `src/lib/supabase/middleware.ts`. This is a valid pattern but means auth guard is not at the network edge. Unauthenticated redirect behavior confirmed correct via HTTP tests.

---

## Security Checks

| Check | Result |
|---|---|
| No unexpected Auth users | ✅ Exactly 1 auth user, verified by explicit UUID |
| No credentials printed | ✅ No passwords, tokens, or secrets in this report |
| No service-role key in browser env | ✅ Confirmed |
| No production touched | ✅ All queries targeted `szghujzhiyndeuhepsax` only |
| No DML executed | ✅ All queries run with `--read-only` |
| No migration, schema change, or deployment | ✅ Confirmed |

---

## Recommendations

### Immediate (before proceeding to Railway deployment)

1. **Verify authenticated route rendering manually** — Log in to `http://localhost:3000` using the staging admin account and confirm `/dashboard`, `/warga`, `/keuangan`, and `/surat` render without blank screens or error states. Note any console errors.

2. **Confirm tenant context in UI** — After login, verify the UI displays `RT 01 / RW 01 Staging` as the active tenant and `Ketua RT` as the displayed role.

3. **Re-attempt browser automation** — For a complete automated smoke test, enable Chrome remote debugging by running Chrome as a background process from a persistent terminal session before the next smoke test run.

### Next Step (pending operator approval)

- **Step 16.5.1** or equivalent: Commit all `docs/deployment/` files to `staging` branch.
- **Step 16.6.x**: Railway staging deployment.
- **Step 16.7.x**: End-to-end application smoke test against Railway staging URL (not localhost).

---

## Final Verdict

> **⚠️ PASS WITH WARNINGS**
>
> Core infrastructure is verified PASS:
> - Supabase Cloud staging connectivity ✅
> - Environment configuration ✅
> - Auth middleware and session guard ✅
> - Auth callback implementation ✅
> - Staging data integrity (roles, tenant, memberships, RLS) ✅
> - Unauthenticated route guard ✅
>
> Browser-based verification is BLOCKED due to Chrome remote debugging unavailability.  
> Authenticated UI rendering and visual route smoke test must be completed manually or in a future automated step before staging is considered fully verified.

---

*Report generated: 2026-11-16 · Step 16.5.0 · smart-rt-staging*

