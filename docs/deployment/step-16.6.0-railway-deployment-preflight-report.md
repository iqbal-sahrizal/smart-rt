# Step 16.6.0 — Railway Staging Deployment Preflight Report

**Date:** 2026-11-16  
**Step:** 16.6.0 — Railway Staging Deployment Preflight  
**Executed By:** Antigravity Agent (Read-Only Audit)  
**Target:** Railway STAGING ONLY — `iqbal-sahrizal/smart-rt` branch `staging`

---

## Overall Preflight Status

| Phase | Area | Status |
|---|---|---|
| Phase 1 | Git Readiness | ⚠️ ACTION REQUIRED |
| Phase 2 | Docker & Build Readiness | ✅ PASS |
| Phase 3 | Railway CLI & Project | ⚠️ ACTION REQUIRED |
| Phase 4 | Environment Variable Matrix | ✅ DOCUMENTED |

> **Deployment is BLOCKED pending operator actions in Phase 1 and Phase 3.**  
> Docker and build configuration are production-ready. No auto-migration risk detected.

---

## Phase 1 — Git Readiness ⚠️ ACTION REQUIRED

### Branch & Remote

| Check | Result | Status |
|---|---|---|
| Current branch | `staging` | ✅ PASS |
| Remote `origin` | `git@github.com:iqbal-sahrizal/smart-rt.git` | ✅ PASS |
| `staging` branch at remote | `remotes/origin/staging` exists | ✅ PASS |
| Local HEAD = `origin/staging` | `0 ahead, 0 behind` | ✅ PASS |
| Latest commit | `b7559d3 chore: prepare Railway staging deployment` | ✅ PASS |

### Working Tree Status

| Check | Result | Status |
|---|---|---|
| Staged changes | None | ✅ PASS |
| Modified tracked files | None | ✅ PASS |
| Untracked files in `docs/deployment/` | **17 files** — not committed | ⚠️ ACTION REQUIRED |

#### Untracked deployment docs (17 files)

```
docs/deployment/step-16.3-remote-compatibility-audit.md
docs/deployment/step-16.3-staging-preflight-report.md
docs/deployment/step-16.3.1-storage-acl-impact-assessment.md
docs/deployment/step-16.3.2-final-migration-readiness.md
docs/deployment/step-16.3.3-staging-migration-apply-report.md
docs/deployment/step-16.4.0-staging-provisioning-preflight.md
docs/deployment/step-16.4.1-staging-provisioning-execution-package.md
docs/deployment/step-16.4.1.1-provisioning-safety-review.md
docs/deployment/step-16.4.1.2-provisioning-integrity-review.md
docs/deployment/step-16.4.1.3-final-verification-closure-report.md
docs/deployment/step-16.4.1.4-final-compensation-integrity-closure-report.md
docs/deployment/step-16.4.1.5-targeted-final-review-report.md
docs/deployment/step-16.4.2.1-global-roles-provisioning-report.md
docs/deployment/step-16.4.2.2-tenant-provisioning-report.md
docs/deployment/step-16.4.2.3-admin-membership-provisioning-report.md
docs/deployment/step-16.4.2.4-final-provisioning-verification-report.md
docs/deployment/step-16.5.0-local-cloud-staging-smoke-test-report.md
```

> These files are NOT required for the Railway build (`.dockerignore` excludes `docs/`), but they should be committed for auditability and traceability on the `staging` branch before deployment.

### Secret & Environment File Safety

| Check | Result | Status |
|---|---|---|
| `.env.local` tracked by git | ❌ Not tracked — gitignored | ✅ PASS |
| `.env.staging` tracked by git | ❌ Not tracked — gitignored | ✅ PASS |
| `.env*` rules in `.gitignore` | `.env*` ignored, `!.env.example` allowed | ✅ PASS |
| `.env.example` tracked | ✅ Tracked — contains no real values | ✅ PASS |
| `service_role` key in source | ❌ Not found anywhere in `src/` | ✅ PASS |
| Credentials in git history | Not detected in recent commits | ✅ PASS |

### Required Operator Action — Phase 1

```bash
cd "/Users/iqbalsahrizal/Documents/CODING/Personal Project/smart-rt"

# 1. Stage all deployment docs
git add docs/deployment/

# 2. Commit
git commit -m "docs: add deployment reports step-16.3 through step-16.6.0"

# 3. Push to remote staging
git push origin staging
```

> ⚠️ This commit is **recommended before deployment** for audit traceability.  
> The Railway build itself does **not** depend on `docs/` (it's excluded by `.dockerignore`).  
> You may proceed to deploy without this commit if you prefer to commit docs separately after deployment.

---

## Phase 2 — Docker & Build Readiness ✅ PASS

### Dockerfile Audit

**File:** `Dockerfile` (multi-stage build)

| Check | Finding | Status |
|---|---|---|
| Builder image | `node:22-bookworm-slim` | ✅ PASS |
| Node.js version | Node 22 LTS (matches `engines.node: "22.x"`) | ✅ PASS |
| Multi-stage build | `deps` → `prod-deps` → `builder` → `runner` | ✅ PASS |
| Non-root execution | `USER nextjs` (uid 1001, gid 1001) | ✅ PASS |
| Port exposure | `EXPOSE 3000` | ✅ PASS |
| Hostname binding | `CMD ... start -H 0.0.0.0` | ✅ PASS |
| Telemetry disabled | `NEXT_TELEMETRY_DISABLED=1` | ✅ PASS |
| NODE_ENV set | `NODE_ENV=production` | ✅ PASS |
| `NEXT_PUBLIC_*` as build ARG | Both Supabase vars declared as `ARG` + `ENV` | ✅ PASS |
| Auto-migration at startup | ❌ Not present — CMD is `next start` only | ✅ PASS |
| `postinstall` script | ❌ Not set | ✅ PASS |
| `prestart` script | ❌ Not set | ✅ PASS |

### `.dockerignore` Audit

| Check | Finding | Status |
|---|---|---|
| `.env*` excluded | ✅ `.env` and `.env.*` excluded | ✅ PASS |
| `.env.example` allowed | ✅ `!.env.example` exception | ✅ PASS |
| `node_modules` excluded | ✅ Rebuilt cleanly inside container | ✅ PASS |
| `.next` excluded | ✅ Rebuilt inside container | ✅ PASS |
| `supabase/` excluded | ✅ Migrations not included | ✅ PASS |
| `docs/` excluded | ✅ Deployment docs not in image | ✅ PASS |
| `.git` excluded | ✅ | ✅ PASS |

### `railway.toml` Audit

| Check | Finding | Status |
|---|---|---|
| Builder | `DOCKERFILE` | ✅ PASS |
| Dockerfile path | `Dockerfile` | ✅ PASS |
| Start command | `node node_modules/next/dist/bin/next start -H 0.0.0.0` | ✅ PASS |
| Health check path | `/api/health` | ✅ PASS |
| Health check timeout | `60s` | ✅ PASS |
| Restart policy | `ON_FAILURE`, max retries `5` | ✅ PASS |

### Health Check Endpoint (`/api/health`)

| Check | Finding | Status |
|---|---|---|
| Endpoint exists | `src/app/api/health/route.ts` | ✅ PASS |
| Returns `200 OK` when configured | `{"status":"ok","configured":true}` ✅ | ✅ PASS |
| Returns `503` when unconfigured | Correctly returns `degraded` state | ✅ PASS |
| No DB query in health check | ✅ Config check only — no Supabase round-trip | ✅ PASS |
| No secrets in response | ✅ Returns `configured: true/false` only | ✅ PASS |
| `Cache-Control: no-store` | ✅ | ✅ PASS |

### `next.config.ts` Audit

| Check | Finding | Status |
|---|---|---|
| Security headers | `buildGlobalSecurityHeaders()` applied globally | ✅ PASS |
| `serverActions.bodySizeLimit` | `16mb` (for document uploads) | ✅ PASS |
| `cacheComponents` | `true` | ✅ PASS |
| `partialPrefetching` | `true` | ✅ PASS |
| Auto-migration in config | ❌ Not present | ✅ PASS |

### Environment Variables Referenced in Source

Scan of all `process.env.*` references in `src/`:

| Variable | Used In | Category |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `src/lib/supabase/config.ts` | Public / Build-time |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `src/lib/supabase/config.ts` | Public / Build-time |
| `NODE_ENV` | `src/lib/security/headers.ts`, `next.config.ts` | Runtime (auto-set) |

> **No server-only runtime secrets** (e.g., `SUPABASE_SERVICE_ROLE_KEY`) are referenced in the Next.js application source. The app requires only the two public Supabase variables.

---

## Phase 3 — Railway Readiness ⚠️ ACTION REQUIRED

| Check | Result | Status |
|---|---|---|
| Railway CLI installed | `railway 4.23.2` | ✅ PASS |
| Railway CLI authenticated | ❌ `Unauthorized. Please login with railway login` | ⚠️ ACTION REQUIRED |
| Railway project linked | ❌ No `.railway` directory found | ⚠️ ACTION REQUIRED |
| Railway staging project exists | ❌ Cannot verify — not authenticated | 🚫 BLOCKED |
| Railway staging service exists | ❌ Cannot verify — not authenticated | 🚫 BLOCKED |
| GitHub repo connected | ❌ Cannot verify — not authenticated | 🚫 BLOCKED |

> **Note:** Railway CLI v4.23.2 is installed but outdated. Latest is v5.74.0. Update is optional for this deployment but recommended.

### Required Operator Actions — Phase 3

#### Step 3A — Login to Railway CLI (required)

```bash
railway login
```

Follow the browser prompt to authenticate.

#### Step 3B — Create or link Railway project (if not yet created)

**Option A: Create new Railway project via dashboard**
1. Go to https://railway.com/new
2. Select **"Deploy from GitHub repo"**
3. Connect `iqbal-sahrizal/smart-rt`
4. Set branch to **`staging`**
5. Name the service `smart-rt-staging`
6. Set environment to `staging`

**Option B: Link existing project via CLI**
```bash
cd "/Users/iqbalsahrizal/Documents/CODING/Personal Project/smart-rt"
railway link
```
Follow the prompts to select project and environment.

#### Step 3C — Set environment variables in Railway

After project is linked, set the two required build-time and runtime variables:

```bash
railway variables set NEXT_PUBLIC_SUPABASE_URL="https://szghujzhiyndeuhepsax.supabase.co"
railway variables set NEXT_PUBLIC_SUPABASE_ANON_KEY="<value from your .env.local>"
```

> ⚠️ **Do not paste the anon key value here.** Copy it from `.env.local` and set it directly via CLI or the Railway dashboard Variables tab.

#### Step 3D — (Optional) Update Railway CLI

```bash
npm install -g @railway/cli
```

---

## Phase 4 — Environment Variable Matrix

### Build-Time Variables (injected as Docker `ARG` during `next build`)

> These are baked into the browser bundle at build time. Must be set **before** the first deploy.

| Variable | Value (staging) | Required | Set In |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://szghujzhiyndeuhepsax.supabase.co` | ✅ Yes | Railway → Variables |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `<anon/publishable key from .env.local>` | ✅ Yes | Railway → Variables |

### Runtime Variables (available to Node.js server process)

| Variable | Value | Required | Notes |
|---|---|---|---|
| `NODE_ENV` | `production` | ✅ Auto-set | Set by Dockerfile `ENV NODE_ENV=production` |
| `NEXT_TELEMETRY_DISABLED` | `1` | ✅ Auto-set | Set by Dockerfile |
| `PORT` | (Railway injects automatically) | ✅ Auto-injected | App reads from Railway via `next start` default |
| `HOSTNAME` | `0.0.0.0` | ✅ Auto-set | Set by Dockerfile |

### Server-Only Variables (NOT used by Next.js app)

> These are referenced only in Edge Functions and PostgreSQL vault — **not** required for Railway deployment.

| Variable | Used By | Required for Railway | Notes |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions only | ❌ No | Never set as `NEXT_PUBLIC_*` |
| `STORAGE_DELETION_WORKER_SECRET` | Edge Functions + DB vault | ❌ No | Supabase Edge Functions only |

### Variables NOT Required for Staging

| Variable | Reason |
|---|---|
| `DATABASE_URL` / `POSTGRES_URL` | App uses Supabase JS client only, not direct Postgres |
| Any migration credentials | No auto-migration at startup |
| Any JWT secret | Handled by Supabase Auth server-side |

---

## Deployment Blockers

| # | Blocker | Severity | Resolution |
|---|---|---|---|
| 1 | Railway CLI not authenticated | 🔴 High | Run `railway login` |
| 2 | Railway project not linked | 🔴 High | Create project & run `railway link` |
| 3 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` not set in Railway | 🔴 High | Set via `railway variables set` or dashboard |
| 4 | 17 `docs/deployment/` files untracked | 🟡 Low | Commit before or after deploy (not build-blocking) |

---

## Manual Actions Summary

| # | Action | Who | When |
|---|---|---|---|
| 1 | `railway login` | Operator | Before deployment |
| 2 | Create Railway project OR `railway link` | Operator | Before deployment |
| 3 | Set `NEXT_PUBLIC_SUPABASE_URL` in Railway | Operator | Before deployment |
| 4 | Set `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Railway | Operator | Before deployment |
| 5 | Commit `docs/deployment/` to staging branch | Operator | Before or after deployment |
| 6 | (Optional) Update Railway CLI to v5.74.0 | Operator | Optional |

---

## Recommended Next Steps

1. **Commit docs** (optional but recommended before deploy):
   ```bash
   git add docs/deployment/
   git commit -m "docs: add deployment reports step-16.3 through step-16.6.0"
   git push origin staging
   ```

2. **Login to Railway:**
   ```bash
   railway login
   ```

3. **Create Railway project** via dashboard (https://railway.com/new) connected to `iqbal-sahrizal/smart-rt` branch `staging`, or link an existing project via `railway link`.

4. **Set environment variables** in Railway dashboard or via CLI.

5. **Approve deployment** — notify me when Railway is linked and variables are set, and I will proceed to Step 16.6.1 (staged Railway deployment execution).

---

## Final Verdict

> **⚠️ DEPLOYMENT BLOCKED — PREFLIGHT INCOMPLETE**
>
> Docker configuration, build scripts, health check, security headers, and `.dockerignore` are all **production-ready** ✅.  
> No auto-migration risk. No secrets in source. No server-only keys exposed to browser.  
>
> Deployment is currently blocked by:
> - Railway CLI not authenticated
> - Railway project not linked
> - Build-time environment variables not configured in Railway
>
> All blockers are operator-action items. No code changes required.

---

*Report generated: 2026-11-16 · Step 16.6.0 · smart-rt-staging*

