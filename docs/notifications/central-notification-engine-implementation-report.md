# Smart RT — Central Notification Engine: Implementation & Remediation Report

**Date:** 2026-11-17  
**Branch:** `staging`  
**Supabase Staging:** `szghujzhiyndeuhepsax` (migrations `0001`–`0029` applied)  
**Deliverables:**
1. `docs/notifications/business-event-notification-matrix.md`
2. `docs/notifications/central-notification-engine-architecture.md`
3. `docs/notifications/central-notification-engine-implementation-report.md` (this report)

---

## 1. Remediation Summary (6 Final-Verification Defects)

| # | Severity | Defect | Remediation Applied | Status |
|---|---|---|---|---|
| 1 | **P0** | No automatic outbox runner / scheduler | Added `pg_cron` (`* * * * *`, job `smart_rt_notification_outbox_worker`) + `pg_net` (`dispatch_notification_outbox_cron()`) + Vault URL (`NOTIFICATION_DISPATCHER_URL`) calling `send-fcm-notification` (`mode: "process_outbox"`) authenticated via single-use 244-bit DB nonce (`notification_dispatch_nonces` / `consume_notification_dispatch_nonce`). Verified live on staging (`HTTP 200`, `pending` → `sent`). | **FIXED & VERIFIED** |
| 2 | **P0** | Shape B silent RPC failure / non-atomic enqueue (`announcements.ts`, `finance.ts`, `complaints.ts`) | Added durable in-transaction DB triggers (`trg_bills_enqueue_notification`, `trg_complaint_replies_enqueue_notification`, `trg_announcements_enqueue_notification`, `trg_announcement_recipients_enqueue_notification`) so outbox rows commit atomically with the business write. Replaced silent `try/catch` RPC calls in all 3 Server Actions with `invokeNotificationEnqueueRpc()` inspecting `{ error }`. | **FIXED & VERIFIED** |
| 3 | **P1** | Idempotency key collisions (`complaint.reply`, `payment.*`, `ronda_schedule.assigned`) | Extended `_enqueue_notification` with explicit `p_idempotency_key`. `complaint.reply` keys on `reply_id` (`complaint.reply:<reply_id>:<user_id>`); `verify_payment` / `reject_payment` / `refund_payment` key on `payment_id` / `refund_id`; `upsert_ronda_schedule_with_roster` keys on `schedule_id` + MD5 content fingerprint (`date\|shift\|start\|end\|meeting_point`). | **FIXED & VERIFIED** |
| 4 | **P1** | No lease recovery for crashed workers stuck in `'processing'` | Added `locked_at`, `lease_expires_at`, and `claim_token` fencing to `notification_outbox`. `claim_pending_notification_outbox_batch` reaps expired leases exceeding `max_attempts` → `'dead'`, recovers recoverable expired `'processing'` rows with `attempt_count + 1` via `FOR UPDATE SKIP LOCKED`, and issues a fresh `claim_token`. `record_notification_outbox_result` ignores stale `claim_token` completions. | **FIXED & VERIFIED** |
| 5 | **P1** | 4 Community Feed events bypassed `notification_outbox` | Updated `create_community_post_comment`, `moderate_community_post`, and `moderate_community_comment` in migration `0028` to route through `_enqueue_notification` with per-comment / per-audit-event idempotency keys and self-notify exclusion. | **FIXED & VERIFIED** |
| 6 | **P2** | `complaint.reply` to staff hardcoded resident deep link | Added server-validated `target_scope` (`'resident' \| 'admin'`) on `notification_outbox`, set `'admin'` for resident-authored complaint replies to staff (`ketua_rt`/`sekretaris`/`pengurus`) and `'resident'` for staff replies to reporters. Updated `buildPushNavigationPayload()`, `dispatcher.ts`, and `send-fcm-notification` to route `'admin'` → `/pengaduan/:id` and `'resident'` → `/resident/complaints/:id`. | **FIXED & VERIFIED** |

---

## 2. Migrations & Configuration Added

1. **`supabase/migrations/20261117002800_remediate_notification_engine.sql`** (applied to staging):
   - Adds `locked_at`, `lease_expires_at`, `claim_token`, `target_scope` + partial index `idx_notification_outbox_processing_lease` on `notification_outbox`.
   - Updates `_enqueue_notification`, `claim_pending_notification_outbox_batch`, `record_notification_outbox_result` (fencing + lease recovery).
   - Fixes idempotency keys in `verify_payment`, `reject_payment`, `refund_payment`, `upsert_ronda_schedule_with_roster`.
   - Adds durable triggers & shared helpers for `bills`, `complaint_replies`, `announcements`, and `announcement_recipients`.
   - Integrates the 4 Community Feed events (`create_community_post_comment`, `moderate_community_post`, `moderate_community_comment`) into `_enqueue_notification`.
   - Enables `pg_cron` and `pg_net` (with hardened `net.http_request_queue` ACLs) and creates `dispatch_notification_outbox_cron()`.
2. **`supabase/migrations/20261117002900_notification_dispatch_nonce_auth.sql`** (applied to staging):
   - Adds `public.notification_dispatch_nonces` (RLS enabled, 0 policies for `anon`/`authenticated`) and `service_role`-only RPC `consume_notification_dispatch_nonce(p_nonce)` so `pg_cron` authenticates `mode: "process_outbox"` calls with single-use 244-bit SHA-256 nonces (TTL 90s) without storing static secrets or `service_role` keys in Vault or `net.http_request_queue`.
3. **Edge Function `send-fcm-notification`** (deployed to staging, `ACTIVE`):
   - Added `mode: "process_outbox"` worker path sharing Firebase OAuth2 token exchange, HTTP v1 push dispatch, stale-token deactivation, and claim-token-fenced result recording.
4. **Supabase Vault & Cron on Staging**:
   - Vault holds `NOTIFICATION_DISPATCHER_URL` (no `SUPABASE_SERVICE_ROLE_KEY` or static secrets stored).
   - Cron job `smart_rt_notification_outbox_worker` active on schedule `* * * * *` (`SELECT public.dispatch_notification_outbox_cron();`).
5. **Next.js Code Updates**:
   - `src/lib/notifications/enqueue-rpc.ts`: Checked RPC wrapper (`invokeNotificationEnqueueRpc`).
   - `src/app/actions/announcements.ts`, `src/app/actions/finance.ts`, `src/app/actions/complaints.ts`: Updated to inspect `{ error }`.
   - `src/lib/notifications/push-payload.ts`, `src/lib/notifications/dispatcher.ts`: Added server-validated `target_scope` and `claim_token` fencing.

---

## 3. Worker & Scheduler Verification + Operational Inspection

### Live Staging Verification Evidence
- **`cron.job`**: Job ID `1`, `smart_rt_notification_outbox_worker`, schedule `* * * * *`, `active: true`.
- **`cron.job_run_details`**: Recurring minute ticks recorded with `status = 'succeeded'`.
- **Automated Probe Execution**:
  - Inserted synthetic `pending` row `c3370f41-6d62-453e-8218-ccf3e5c51902` (`target_scope: 'admin'`) for active tenant member `0c0445e4-efce-4173-91e3-b2de82d1d510` (0 active device tokens).
  - Without manual invocation, at `2026-11-17 12:29:00 UTC` `pg_cron` → `pg_net` dispatched `POST` to `send-fcm-notification`, receiving `status_code: 200`:
    `{"ok":true,"mode":"process_outbox","claimed_count":1,"sent_count":1,"failed_count":0,"groups_processed":1,"deactivated_tokens":0}`.
  - Outbox row transitioned automatically to `status = 'sent'`, `sent_at = '2026-11-17 12:29:02.289767+00'`. Synthetic probe row cleaned up afterward.
- **Staging DB Integration Assertions**:
  - Executed `DO $test$` block against staging DB verifying:
    - Two distinct replies (`reply1`, `reply2`) on the same complaint both enqueue cleanly; duplicate `reply1` is deduplicated; non-member cross-tenant user is rejected.
    - `target_scope = 'admin'` persisted.
    - Expired `'processing'` lease (`lease_expires_at < now()`) recovered with `attempt_count = 1` and new `claim_token`.
    - Stale `claim_token` completion ignored (fenced); valid `claim_token` failure transitions to `'failed'` with `attempt_count = 2` and future `next_attempt_at`.

### How to Inspect Worker & Scheduler Status
Run these read-only SQL checks in Supabase SQL Editor or `npx supabase db query --remote --read-only`:

```sql
-- 1. Check scheduler registration & active flag
SELECT jobid, jobname, schedule, command, active
FROM cron.job
WHERE jobname = 'smart_rt_notification_outbox_worker';

-- 2. Check recent cron executions
SELECT runid, jobid, status, return_message, start_time, end_time
FROM cron.job_run_details
ORDER BY runid DESC
LIMIT 10;

-- 3. Check recent pg_net HTTP worker responses (6h retention)
SELECT id, status_code, content, created
FROM net._http_response
ORDER BY created DESC
LIMIT 10;

-- 4. Check outbox backlog & dead-letter health
SELECT status, count(*) AS total, min(created_at) AS oldest, max(updated_at) AS latest_update
FROM public.notification_outbox
GROUP BY status;
```

---

## 4. Automated Test Results

| Suite | Command | Result | Scope |
|---|---|---|---|
| **Central Notification Engine Unit Suite** | `node --test tests/notifications/central-notification-engine.test.mjs` | **22/22 PASS** | Deep link mapping (resident + admin across all 8 domains), `target_scope` isolation, batch grouping, `claim_token` forwarding, FCM failure backoff recording, Shape B `{ error }` detection (`invokeNotificationEnqueueRpc`). |
| **FCM Edge Function Deno Suite** | `deno test supabase/functions/send-fcm-notification/send-fcm-notification.test.mjs` | **8/8 PASS** | JWT signing, OAuth2 token exchange, FCM v1 dispatch, stale token deactivation, unauthorized rejection, `mode: "process_outbox"` via single-use nonce + admin/resident path resolution + `p_claim_token`. |
| **Deep Link & Return Path Tests** | `node --test tests/deep-links/push-payload.unit.test.mjs tests/deep-links/next-path.unit.test.mjs` | **12/12 PASS** | Verified in prior run; unchanged contracts preserved. |
| **TypeScript & ESLint** | `npm run typecheck && npm run lint` | **PASS (0 errors, 0 warnings)** | Full Next.js project after all final edits. |

---

## 5. Event Coverage Matrix (16/16 Events Across 8 Domains)

| # | Domain | Business Event | Trigger / Integration | Outbox + Push | Deep Link Scope & Path |
|---|---|---|---|---|---|
| 1 | **Announcements** | Published | `trg_announcements_enqueue_notification` / `trg_announcement_recipients_enqueue_notification` + `notify_announcement_published` | **Integrated** | `resident` → `/resident/announcements/:id` |
| 2 | **Bills** | Issued (single & bulk) | `trg_bills_enqueue_notification` + `notify_bill_issued` | **Integrated** | `resident` → `/resident/bills/:id` |
| 3 | **Payments** | Verified | `verify_payment` (`idempotency_key` via `payment_id`) | **Integrated** | `resident` → `/resident/bills/:id` |
| 4 | **Payments** | Rejected | `reject_payment` (`idempotency_key` via `payment_id`) | **Integrated** | `resident` → `/resident/bills/:id` |
| 5 | **Payments** | Refunded | `refund_payment` (`idempotency_key` via `refund_id`) | **Integrated** | `resident` → `/resident/bills/:id` |
| 6 | **Letters** | Reviewed (approved/rejected) | `review_letter_request` | **Integrated** | `resident` → `/resident/letters/:id` |
| 7 | **Letters** | Issued (PDF ready) | `issue_letter` | **Integrated** | `resident` → `/resident/letters/:id` |
| 8 | **Complaints** | Replied by staff | `trg_complaint_replies_enqueue_notification` + `notify_complaint_reply` (`reply_id` key) | **Integrated** | `resident` → `/resident/complaints/:id` |
| 9 | **Complaints** | Replied by resident | `trg_complaint_replies_enqueue_notification` + `notify_complaint_reply` (`reply_id` key) | **Integrated** | `admin` → `/pengaduan/:id` |
| 10 | **Complaints** | Status resolved/rejected | `transition_complaint_status` | **Integrated** | `resident` → `/resident/complaints/:id` |
| 11 | **Activities** | Created / Scheduled | `create_activity` | **Integrated** | `resident` → `/resident/activities/:id` |
| 12 | **Activities** | Cancelled | `transition_activity_status` | **Integrated** | `resident` → `/resident/activities/:id` |
| 13 | **Ronda** | Schedule assigned / updated | `upsert_ronda_schedule_with_roster` (content fingerprint key) | **Integrated** | `resident` → `/resident/ronda/:id` |
| 14 | **Community** | Comment on post | `create_community_post_comment` (`comment_id` key) | **Integrated** | `resident` → `/resident/feed` |
| 15 | **Community** | Reply to comment | `create_community_post_comment` (`comment_id` key) | **Integrated** | `resident` → `/resident/feed` |
| 16 | **Community** | Post/comment hidden/restored | `moderate_community_post` / `moderate_community_comment` (`audit_id` key) | **Integrated** | `resident` → `/resident/feed` |

---

## 6. Real FCM E2E Status & Remaining Blockers

- **Backend & Automated Outbox Pipeline (DB Trigger/RPC → `notification_outbox` → `pg_cron` → `pg_net` → `send-fcm-notification` worker → `status = 'sent'`):** **PASS** (verified live on Supabase staging `szghujzhiyndeuhepsax`).
- **Physical Device Real FCM E2E (Foreground, Background, Terminated, Notification Tap, Valid/Expired Session across event categories):** **BLOCKED** — `adb devices` reports no attached physical Android device (`List of devices attached` is empty). Physical device verification cannot be claimed PASS until the Android test device is reconnected and live push reception is observed per category.
