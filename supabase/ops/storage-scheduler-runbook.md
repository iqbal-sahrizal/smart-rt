# Smart RT Storage Scheduler & Monitoring Runbook

> Operational runbook for `pg_cron` + `pg_net` + Supabase Vault integration driving [`storage-deletion-worker`](../functions/storage-deletion-worker/index.ts) and [`storage-orphan-scan`](../functions/storage-orphan-scan/index.ts).

---

## 1. Architecture & Network Boundary

- **Two asynchronous `pg_cron` schedules** dispatch HTTP `POST` requests via `net.http_post()` (`timeout_milliseconds => 120000`):
  1. `smart_rt_storage_deletion_worker` (`*/5 * * * *`): sends `{"mode":"process"}` (default batch settings) to `/functions/v1/storage-deletion-worker`.
  2. `smart_rt_storage_orphan_scan` (`*/15 * * * *`): sends `{}` (no `cursor`, `scan_token`, `buckets`, or `object_path`) to `/functions/v1/storage-orphan-scan`.
- **Internal Docker URL rule (Local Supabase):** Inside container `supabase_db_smart-rt`, `localhost` / `127.0.0.1` resolves to the Postgres container itself — **not** Kong or the host Mac. All `pg_net` dispatches on the local Docker network (`supabase_network_smart-rt`) must route through Kong:
  - `STORAGE_ORPHAN_SCAN_URL`: `http://supabase_kong_smart-rt:8000/functions/v1/storage-orphan-scan`
  - Derived worker URL: `http://supabase_kong_smart-rt:8000/functions/v1/storage-deletion-worker`
- **Secret isolation:**
  - Vault stores **only** `STORAGE_DELETION_WORKER_SECRET` (>= 32 UTF-8 bytes) and `STORAGE_ORPHAN_SCAN_URL`.
  - `SUPABASE_SERVICE_ROLE_KEY` is **never** stored in Vault, `cron.job`, or request payloads — it lives strictly in the Edge Function runtime environment.
  - Direct table access to `net.http_request_queue` (contains queued `Authorization` headers) and `net._http_response` is revoked from `PUBLIC`, `anon`, `authenticated`, and `service_role`.
- **Asynchronous contract:** `net.http_post()` only enqueues an outbound HTTP request and returns `request_id`. Cron dispatch success does **not** prove Edge Function or deletion success; actual completion is verified through `public.get_storage_deletion_health_summary()`, `public.audit_logs`, and Edge Function logs.

---

## 2. Pending Activation Checklist (When Edge Runtime Becomes Available)

If Edge Runtime (`supabase_edge_runtime_smart-rt`) is stopped (`npx supabase status` shows `Stopped services: [... supabase_edge_runtime_smart-rt ...]`), cron jobs must remain unscheduled (`activate_jobs=false`) to prevent continuous `503` failures.

Once Edge Runtime is ready:

1. **Generate & load a strong shared secret (`>= 32` random bytes)** into Edge Runtime's non-committed env file (e.g., `supabase/functions/.env`, covered by `.gitignore` `.env*`):
   - Set `STORAGE_DELETION_WORKER_SECRET` (never commit `.env*` to Git).
2. **Start local Edge Runtime with secrets loaded** (never pass `--no-verify-jwt` bypasses manually — [supabase/config.toml](../config.toml) already sets `verify_jwt = false` for internal Bearer-authenticated functions):
   ```bash
   npx supabase functions serve --env-file supabase/functions/.env
   ```
3. **Sync the identical secret interactively into Supabase Vault** (keeping `activate_jobs=false` until the Readiness Gate passes):
   ```bash
   docker exec -it supabase_db_smart-rt psql -U supabase_admin -d postgres \
     -v orphan_scan_url='http://supabase_kong_smart-rt:8000/functions/v1/storage-orphan-scan' \
     -v activate_jobs=false \
     -f - < supabase/ops/storage-scheduler-setup.sql
   ```
   *(Or pipe interactively without passing the secret on the CLI so `\prompt` captures it cleanly.)*
4. **Run the 7-point Endpoint Readiness Gate via `pg_net` (as `postgres`):**
   - Dispatch valid Bearer `POST` and intentionally invalid Bearer `POST` to **both** `storage-deletion-worker` and `storage-orphan-scan` using `net.http_post(...)`.
   - Wait 2–3 seconds and inspect `net._http_response` (`status_code`, `timed_out`, `error_msg`, `content` — confirm **200** for valid Bearer, **401** for invalid Bearer, zero secrets in `content` or Edge Runtime stdout logs):
   ```sql
   SELECT id, status_code, timed_out, error_msg, content
   FROM net._http_response
   ORDER BY id DESC
   LIMIT 10;
   ```
5. **Activate both cron jobs idempotently** only after all Readiness Gate checks pass:
   ```bash
   docker exec -i supabase_db_smart-rt psql -U supabase_admin -d postgres \
     -v orphan_scan_url='http://supabase_kong_smart-rt:8000/functions/v1/storage-orphan-scan' \
     -v worker_secret='' \
     -v activate_jobs=true \
     < supabase/ops/storage-scheduler-setup.sql
   ```

---

## 3. Operational Monitoring Procedures

### 3.1 Check Active Cron Jobs & Recent Runs
```sql
SELECT jobid, jobname, schedule, active, database, username
FROM cron.job
WHERE jobname IN ('smart_rt_storage_deletion_worker', 'smart_rt_storage_orphan_scan')
ORDER BY jobname;

SELECT j.jobname, d.runid, d.status, d.return_message, d.start_time, d.end_time
FROM cron.job_run_details d
JOIN cron.job j ON j.jobid = d.jobid
WHERE j.jobname IN ('smart_rt_storage_deletion_worker', 'smart_rt_storage_orphan_scan')
ORDER BY d.start_time DESC
LIMIT 20;
```

### 3.2 Check `pg_net` Queue & Transient HTTP Responses (~6h TTL)
```sql
-- Outbound queue backlog (DO NOT select headers in shared logs/terminals)
SELECT id, method, url, timeout_milliseconds
FROM net.http_request_queue
ORDER BY id DESC
LIMIT 20;

-- Recent HTTP responses (pg_net.ttl defaults to 6 hours)
SELECT id, status_code, content_type, timed_out, error_msg, created
FROM net._http_response
ORDER BY created DESC
LIMIT 20;
```

### 3.3 Distinguish Dispatch Failure vs Worker / Domain Failure

| Symptom | Source to Check | Root Cause & Action |
|---|---|---|
| `cron.job_run_details.status <> 'succeeded'` | `cron.job_run_details.return_message` | SQL / Vault lookup / cron trigger failure (Vault secret missing or `net` permission error). |
| `net._http_response` missing rows or `error_msg` set / `timed_out = true` | `net._http_response`, `net.http_request_queue` | Network, DNS, or HTTP timeout before Edge Function returned (check `supabase_kong_smart-rt` & `supabase_edge_runtime_smart-rt` health). |
| `status_code = 503` (`name resolution failed`) | `net._http_response.content`, `npx supabase status` | Edge Runtime (`supabase_edge_runtime_smart-rt`) is stopped or unreachable behind Kong. |
| `status_code = 401` or `500` | `net._http_response.content`, Edge Function logs | Bearer secret mismatch between Vault and Edge Function env (`401`), or missing `STORAGE_DELETION_WORKER_SECRET` / `SUPABASE_SERVICE_ROLE_KEY` (`500`). |
| `status_code = 200`, yet `pending_count` / `failed_count` / `exhausted_count` rises | `get_storage_deletion_health_summary()`, `list_storage_deletion_jobs_needing_attention(50)`, Edge Function structured logs | Dispatch succeeded, but storage removal or DB finalization encountered an application/Storage error (`storage_unauthorized_403`, `object_still_present`, etc.). |

### 3.4 Check Health Summary, Orphan Cursor & Lease State
`public.get_storage_deletion_health_summary()` is an authenticated `super_admin`-gated `SECURITY DEFINER` RPC (`public.is_super_admin()`). Call it via an authenticated `super_admin` session (or in SQL as `postgres` by binding a `super_admin` JWT `sub` under `SET LOCAL ROLE authenticated`):
```sql
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub', '<super_admin_uuid>', 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', '<super_admin_uuid>', true);
SET LOCAL ROLE authenticated;
SELECT * FROM public.get_storage_deletion_health_summary();
COMMIT;
```
*(Note: In Migration `0016`, `get_storage_deletion_health_summary()` checks `current_user <> 'service_role'` inside a `SECURITY DEFINER` function owned by `postgres`, so raw `service_role` calls without a `super_admin` `sub` return `42501 Forbidden`; use an authenticated `super_admin` session.)*
Key indicators:
- `orphan_lease_active` / `orphan_lease_expires_at`: `true` while an `orphan_scan` run holds the singleton lease (default 5 min, max 15 min).
- `orphan_has_cursor`: `true` when resuming mid-cycle across buckets/pages; `false` cleanly after `orphan_cycle_completed_at` finishes a full 6-bucket sweep.
- `pending_count`, `oldest_pending_age`: backlog depth and age (`WARNING` if `> 200` or `> 30 minutes`; `CRITICAL` if `> 2 hours`).
- `expired_processing_count`: jobs stuck in `processing` past `lease_expires_at`.
- `failed_count`, `exhausted_count`: transient retries vs jobs at `>= 10` attempts (`CRITICAL` if `exhausted_count > 0`).
- `quarantined_invalid_path_count`: invalid Storage paths quarantined for operator inspection.

*(Note: `get_orphan_scan_cursor()` is `service_role`-only; operators should use `get_storage_deletion_health_summary()`.)*

### 3.5 Inspect Pending, Failed, & Exhausted Jobs
Requires `super_admin` session (authenticated) or SQL check via `public.list_storage_deletion_jobs_needing_attention(50)` / `public.storage_deletion_queue` / `public.audit_logs`:
```sql
SELECT id, tenant_id, bucket_id, object_path, status, attempt_count,
       lease_expires_at, next_attempt_at, last_error, requested_at
FROM public.storage_deletion_queue
WHERE status IN ('pending', 'processing', 'failed', 'exhausted')
ORDER BY
  CASE status WHEN 'exhausted' THEN 1 WHEN 'failed' THEN 2 WHEN 'processing' THEN 3 ELSE 4 END,
  requested_at ASC
LIMIT 50;
```

### 3.6 Handle Expired Leases Safely
- **Queue job leases (`storage_deletion_queue`):** `claim_storage_deletion_jobs()` automatically reclaims `processing` rows whose `lease_expires_at <= clock_timestamp()` on the next worker tick (`FOR UPDATE SKIP LOCKED`) and fences stale `claim_token` writers. Do **not** manually delete `processing` rows.
- **Orphan scan lease (`storage_orphan_scan_state`):** Automatically expires at `lease_expires_at` (`<= 5 minutes` default, max `15 minutes`), preserving the last valid `cursor` and rejecting late stale writers (`stale_orphan_scan_lease`). Wait for TTL expiry rather than clearing active leases mid-flight.

### 3.7 Safely Retry Exhausted Jobs
1. Identify the job and inspect `last_error` in `storage_deletion_queue` or `audit_logs` (`action = 'storage_deletion.exhausted'`).
2. Confirm the underlying Storage/config issue is resolved and inspect whether the object is still active in `storage.objects` (`archived_at IS NULL AND is_delete_marker = false`).
3. Re-queue atomically via `retry_storage_deletion_job` (sets `status = 'pending'`, resets `attempt_count = 0`, clears `claim_token`/`lease_expires_at`/`last_error`, and records `storage_deletion.manual_retry` in `audit_logs`):
   ```sql
   SELECT public.retry_storage_deletion_job('<job-uuid>'::uuid);
   ```

---

## 4. Safe Teardown (Stop & Remove Only Smart RT Cron Jobs)

To pause or remove Smart RT's cron schedules **without** altering domain tables, `storage_deletion_queue`, `storage_orphan_scan_state`, `audit_logs`, `storage.objects`, or unrelated cron jobs:

```bash
docker exec -i supabase_db_smart-rt psql -U supabase_admin -d postgres \
  -v remove_vault_secrets=false \
  < supabase/ops/storage-scheduler-teardown.sql
```

Pass `-v remove_vault_secrets=true` only when you intentionally want to remove `STORAGE_DELETION_WORKER_SECRET` and `STORAGE_ORPHAN_SCAN_URL` from `vault.secrets` as well.
