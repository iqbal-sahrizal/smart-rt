# Step 16.6.0.1 — Render Free Migration Preparation Report

**Date:** 2026-11-16  
**Step:** 16.6.0.1 — Render Free Migration Preparation  
**Executed By:** Antigravity Agent (Read-Only Audit)  
**Context:** Railway staging deployment cancelled (trial expired). Migrating to Render Free.  
**Repository:** `iqbal-sahrizal/smart-rt` · branch `staging`  
**Supabase Staging:** `szghujzhiyndeuhepsax` · `https://szghujzhiyndeuhepsax.supabase.co`

---

## Overall Status

| Phase | Area | Status |
|---|---|---|
| Phase 1 | Git & Documentation | ⚠️ ACTION REQUIRED |
| Phase 2 | Docker Compatibility | ✅ PASS (1 note) |
| Phase 3 | Environment Variables | ✅ PASS |
| Phase 4 | Render Configuration | ✅ DOCUMENTED |
| Phase 5 | Supabase Auth Redirect | ✅ DOCUMENTED (pending Render URL) |

> **No deployment blockers in code or Docker configuration.**  
> Two operator actions required: commit untracked docs, then set env vars in Render dashboard.

---

## Phase 1 — Git & Documentation ⚠️ ACTION REQUIRED

### Branch & Remote

| Check | Result | Status |
|---|---|---|
| Current branch | `staging` | ✅ PASS |
| Remote `origin` | `git@github.com:iqbal-sahrizal/smart-rt.git` | ✅ PASS |
| `staging` at remote | `remotes/origin/staging` exists | ✅ PASS |
| Local HEAD = `origin/staging` | 0 ahead, 0 behind | ✅ PASS |
| Latest commit | `b7559d3 chore: prepare Railway staging deployment` | ✅ PASS |
| Staged changes | None | ✅ PASS |
| Modified tracked files | None | ✅ PASS |

### Untracked Deployment Documentation

**18 files** in `docs/deployment/` are untracked and not yet committed:

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
docs/deployment/step-16.6.0-railway-deployment-preflight-report.md
```

> `docs/` is excluded in `.dockerignore` — these files do **not** affect the Docker build or deployment.  
> Committing them is recommended for auditability before the first Render deployment.

### Secret & Credential Safety

| Check | Result | Status |
|---|---|---|
| `.env.local` tracked | ❌ Gitignored (`.env*` rule) | ✅ PASS |
| `.env.staging` tracked | ❌ Gitignored | ✅ PASS |
| `.env.example` tracked | ✅ — contains no real values | ✅ PASS |
| `service_role` key in `src/` | ❌ Not found | ✅ PASS |
| Credentials in git history | Not detected | ✅ PASS |

### Required Operator Action — Phase 1

```bash
cd "/Users/iqbalsahrizal/Documents/CODING/Personal Project/smart-rt"
git add docs/deployment/
git commit -m "docs: add deployment reports step-16.3 through step-16.6.0.1"
git push origin staging
```

---

## Phase 2 — Docker Compatibility ✅ PASS

### Dockerfile Audit

| Check | Finding | Status |
|---|---|---|
| Builder image | `node:22-bookworm-slim` | ✅ PASS |
| Node.js version | Node 22 LTS (matches `engines.node: "22.x"`) | ✅ PASS |
| Multi-stage build | `deps → prod-deps → builder → runner` | ✅ PASS |
| Non-root execution | `USER nextjs` (uid 1001) | ✅ PASS |
| Hostname binding | `CMD ... start -H 0.0.0.0` | ✅ PASS |
| `PORT` env var support | `next start` has `.env('PORT')` — reads `$PORT` automatically | ✅ PASS |
| `EXPOSE` | `EXPOSE 3000` (Render ignores this; uses injected `PORT`) | ✅ PASS |
| Telemetry disabled | `NEXT_TELEMETRY_DISABLED=1` | ✅ PASS |
| `NODE_ENV=production` | Set in both `builder` and `runner` stages | ✅ PASS |
| `NEXT_PUBLIC_*` as `ARG` | Both Supabase vars declared as `ARG` + `ENV` in `builder` | ✅ PASS |
| Auto-migration at startup | ❌ Not present — CMD is `next start` only | ✅ PASS |
| `postinstall` / `prestart` | ❌ Not configured | ✅ PASS |
| Local filesystem writes | ❌ No `writeFile`, `diskStorage`, or local uploads — all storage via Supabase Storage | ✅ PASS |
| Next.js standalone output | Not configured — standard `.next/` output | ⚠️ NOTE (see below) |

> **Note — PORT handling verified:** `next start`'s CLI source confirms `.env('PORT')` is registered. When Render injects the `PORT` environment variable at runtime, `next start -H 0.0.0.0` will automatically bind to that port. **No `-p $PORT` flag needed in CMD.**

> **Note — Standalone output:** The Dockerfile uses standard `next start` (not `output: 'standalone'`). This is fully compatible with Render Docker deployment. Standalone would reduce image size but is not required. No change needed.

> **Note — `railway.toml`:** This file is safe to leave in the repository. Render does **not** read `railway.toml`. It will be silently ignored. No deletion needed.

### `.dockerignore` Audit

| Check | Finding | Status |
|---|---|---|
| `.env*` excluded | ✅ | ✅ PASS |
| `!.env.example` allowed | ✅ | ✅ PASS |
| `node_modules` excluded | ✅ Rebuilt inside container | ✅ PASS |
| `.next` excluded | ✅ Rebuilt inside container | ✅ PASS |
| `supabase/` excluded | ✅ Migrations not in image | ✅ PASS |
| `docs/` excluded | ✅ | ✅ PASS |
| `.git` excluded | ✅ | ✅ PASS |

### Render Docker ARG Behavior

> Render automatically translates environment variables configured in its dashboard into Docker build arguments (`--build-arg`) during the image build.  
> **Requirement:** The `ARG` names in the Dockerfile must match the env var names configured in Render.

| Dockerfile `ARG` | Must match Render env var name | Status |
|---|---|---|
| `ARG NEXT_PUBLIC_SUPABASE_URL` | `NEXT_PUBLIC_SUPABASE_URL` | ✅ Names match |
| `ARG NEXT_PUBLIC_SUPABASE_ANON_KEY` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ Names match |

No Dockerfile changes are needed.

### Health Check

| Check | Result | Status |
|---|---|---|
| Endpoint | `/api/health` | ✅ PASS |
| Live response (local) | `{"status":"ok","configured":true}` HTTP 200 | ✅ PASS |
| No DB round-trip | Config check only — no Supabase query | ✅ PASS |
| No secrets in response | Returns `configured: true/false` only | ✅ PASS |

---

## Phase 3 — Next.js Environment Variable Audit ✅ PASS

### Complete `process.env.*` References in `src/`

Only **3** environment variables are referenced anywhere in the application source:

| Variable | Public? | Build-time? | Runtime? | Required? | Sensitive? |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ Public | ✅ Yes (baked into browser bundle) | ✅ Yes (server reads it too) | ✅ Required | ❌ No — public staging URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ Public | ✅ Yes (baked into browser bundle) | ✅ Yes | ✅ Required | ⚠️ Publishable — safe for browser, still treat as credential |
| `NODE_ENV` | — | — | ✅ Auto-set by Dockerfile | ✅ Auto | ❌ No |

### Variables Referenced in `.env.example` (not used in `src/`)

These are Edge Function / PostgreSQL vault variables only. They are **NOT** used by the Next.js application and must **NOT** be set in Render:

| Variable | Used By | Required in Render? |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Edge Functions only | ❌ Never |
| `STORAGE_DELETION_WORKER_SECRET` | Edge Functions + DB vault | ❌ Never |
| `DATABASE_URL` / `POSTGRES_URL` | Not used (app uses Supabase JS client) | ❌ Never |

### Security Checks

| Check | Result | Status |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` = staging URL | `https://szghujzhiyndeuhepsax.supabase.co` | ✅ PASS |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` = staging key | Confirmed from `.env.local` (not printed) | ✅ PASS |
| No `service_role` key in `src/` | ❌ Not found | ✅ PASS |
| No server-only key with `NEXT_PUBLIC_` prefix | ❌ Not found | ✅ PASS |
| No production Supabase URL in codebase | ❌ Not found | ✅ PASS |

---

## Phase 4 — Render Service Configuration

### Recommended Render Web Service Settings

| Setting | Value |
|---|---|
| **Service Type** | Web Service |
| **Source** | GitHub |
| **Repository** | `iqbal-sahrizal/smart-rt` |
| **Branch** | `staging` |
| **Runtime** | Docker |
| **Dockerfile Path** | `./Dockerfile` (default — auto-detected) |
| **Instance Type** | Free |
| **Health Check Path** | `/api/health` |
| **Auto-Deploy** | Enabled on push to `staging` branch (recommended) |
| **Region** | Singapore (`sgp1`) — closest to Supabase `ap-southeast-1` |

### Environment Variables to Set in Render Dashboard

> Set these in **Render Dashboard → Service → Environment** before the first deploy.

| Variable | Value | Build-time? | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://szghujzhiyndeuhepsax.supabase.co` | ✅ Yes | Must match Dockerfile ARG name exactly |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | *(copy from `.env.local`)* | ✅ Yes | Must match Dockerfile ARG name exactly |

> **Render automatically passes environment variables as `--build-arg` during Docker build** when the variable names match the Dockerfile `ARG` declarations. The existing Dockerfile ARG names already match.

> ⚠️ Do NOT add `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, or any server-only variables to Render.

### Free Tier Limitations to Be Aware Of

| Limitation | Detail | Impact |
|---|---|---|
| **Cold start** | Free instances spin down after ~15 min inactivity | First request after idle takes 30–60s |
| **Build time limit** | 500 build minutes/month on free plan | Sufficient for staging |
| **No persistent disk** | Ephemeral filesystem only | ✅ Not an issue — all storage via Supabase Storage |
| **Single instance** | No horizontal scaling | ✅ Acceptable for staging |
| **Custom domain** | Requires paid plan or use `*.onrender.com` subdomain | Use Render-provided URL for staging |

### `railway.toml` Disposition

Render **does not** read `railway.toml`. It will be silently ignored. No action required — do not delete it.

---

## Phase 5 — Supabase Auth Redirect Preparation

### How Redirect URLs Are Constructed

The application dynamically derives the callback origin from incoming HTTP headers:
- **Primary:** `Origin` header
- **Fallback:** `X-Forwarded-Host` + `X-Forwarded-Proto` headers
- **Last resort:** `Host` header

The callback URL is constructed as:
```
{origin}/auth/callback?next=/activate-account?token={token}
```

Render sets `X-Forwarded-Host` and `X-Forwarded-Proto` correctly for proxied requests. No hardcoded `NEXT_PUBLIC_SITE_URL` env var is needed.

### Supabase Auth Configuration

**After** the Render service is created and its URL is known (e.g., `https://smart-rt-staging.onrender.com`), the operator must add it to the Supabase Auth allowlist.

**Where to configure:**
> Supabase Dashboard → Project `smart-rt-staging` → Authentication → URL Configuration

| Field | Value to add |
|---|---|
| **Site URL** | `https://smart-rt-staging.onrender.com` *(replace with actual Render URL)* |
| **Redirect URLs** (add all): | `https://smart-rt-staging.onrender.com/**` |
| | `http://localhost:3000/**` *(keep for local dev)* |

> ⚠️ Do not remove `localhost` redirect entries — they are needed for local development.  
> Do not change Supabase Auth configuration before the actual Render URL is known.

---

## Deployment Blockers

| # | Blocker | Severity | Resolution |
|---|---|---|---|
| 1 | 18 `docs/deployment/` files untracked | 🟡 Low | Commit before first deploy (not build-blocking) |
| 2 | Render service not yet created | 🔴 High | Create service in Render dashboard |
| 3 | `NEXT_PUBLIC_SUPABASE_URL` not set in Render | 🔴 High | Set in Render dashboard env vars |
| 4 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` not set in Render | 🔴 High | Set in Render dashboard env vars |
| 5 | Supabase Auth redirect URL unknown | 🟡 Low | Add Render URL after service creation |

**No code changes required. No Dockerfile changes required.**

---

## Exact Manual Operator Actions

### Step 1 — Commit deployment docs (recommended before deploy)

```bash
cd "/Users/iqbalsahrizal/Documents/CODING/Personal Project/smart-rt"
git add docs/deployment/
git commit -m "docs: add deployment reports step-16.3 through step-16.6.0.1"
git push origin staging
```

### Step 2 — Create Render Web Service

1. Go to https://dashboard.render.com/new/web
2. Connect GitHub account if not connected.
3. Select repository: `iqbal-sahrizal/smart-rt`
4. Configure:
   - **Name:** `smart-rt-staging` (or similar)
   - **Branch:** `staging`
   - **Runtime:** `Docker`
   - **Region:** `Singapore (sgp1)`
   - **Instance Type:** `Free`
   - **Health Check Path:** `/api/health`

### Step 3 — Set Environment Variables in Render

In the Render service → **Environment** tab, add:

| Key | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://szghujzhiyndeuhepsax.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | *(paste from `.env.local` — do not share in chat)* |

### Step 4 — Deploy

After setting env vars, trigger the first deploy (Render will auto-deploy, or click **Deploy** manually).

### Step 5 — Add Supabase Auth Redirect (after deploy)

Once the Render URL is known:

1. Supabase Dashboard → `smart-rt-staging` → Authentication → URL Configuration
2. Set **Site URL** to `https://<your-render-url>.onrender.com`
3. Add to **Redirect URLs:**
   - `https://<your-render-url>.onrender.com/**`
   - `http://localhost:3000/**`

### Step 6 — Verify health check

```bash
curl https://<your-render-url>.onrender.com/api/health
# Expected: {"status":"ok","configured":true}
```

---

## Recommended Next Step

> **Commit docs → Create Render service → Set env vars → First deploy → Verify `/api/health` → Add Supabase redirect → Smoke test**

Notify me after the Render service is created and the first deploy completes. I will execute Step 16.6.1 — Render Staging Deployment Verification.

---

## Final Verdict

> **✅ READY FOR DEPLOYMENT — pending operator actions only**
>
> Docker configuration is fully compatible with Render Free.  
> No code changes, no Dockerfile changes, and no migration work required.  
> `railway.toml` can remain in the repository without conflict.  
> All 5 blockers are operator-action items — set env vars in Render dashboard and create the service.

---

*Report generated: 2026-11-16 · Step 16.6.0.1 · smart-rt-staging → Render Free*

