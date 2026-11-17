# Smart RT — Central Notification Engine Architecture (Phase 2)

**Date:** 2026-11-17
**Depends on:** `business-event-notification-matrix.md` (Phase 1). Every decision below traces back to a specific row or foundational fact in that document.

---

## 1. Design goals, restated against what already exists

| Goal | How it's met without duplicating anything |
|---|---|
| Business event dispatcher | Each business-mutation RPC (already `SECURITY DEFINER`) calls one shared internal helper on its success path — exactly the shape Community Feed already uses, just factored through one function instead of 4 hand-copies. |
| Tenant-aware recipient resolver | Lives **inside Postgres**, in the same transaction as the business mutation, using the exact `tenant_members` / `member_roles` / `roles` join pattern already used by `has_tenant_role()`. Never trusts a client-supplied tenant/user/recipient ID — every recipient is re-derived from the business row itself. |
| Notification payload builder | Reuses the **existing** `resolveNotificationDestination()` (TS) for deep-link paths — extended with new `reference_type` cases (Phase 5), not reimplemented. |
| Persistent outbox/queue | New table, `public.notification_outbox` — because retry/backoff/attempt-tracking has no precedent anywhere in this schema and bolting it onto `public.notifications` would couple the simple in-app bell table to push-delivery mechanics it doesn't need. |
| FCM dispatcher using existing Edge Function | `send-fcm-notification` is called exactly as-is — **zero changes to it**. A new TS module turns outbox rows into calls against it. |
| Retry + exponential backoff + attempt cap | `notification_outbox.attempt_count` / `max_attempts` / `next_attempt_at`, computed by a dispatcher-side RPC — same shape as the existing `storage_deletion_jobs` retry machinery (`retry_storage_deletion_job`, `renew_storage_deletion_lease` in `20261114001500_storage_and_atomic_rpcs.sql`), reused as a pattern, not copied verbatim (different domain, same idea: claim → attempt → backoff → cap → dead-letter). |
| Idempotency key | `UNIQUE (idempotency_key)` constraint + `ON CONFLICT DO NOTHING` at enqueue time. Key shape per event, defined in §4. |
| Delivery status / audit log | `notification_outbox.status` lifecycle + reuse of the **existing** `public.audit_logs` table for the business-mutation side (already written by every RPC above); outbox rows themselves are the push-specific audit trail. |
| Invalid token handling | Already implemented in `send-fcm-notification` (deactivates on `UNREGISTERED`/`NOT_FOUND`/404) — **unchanged**, just reused. |
| Deep link to Resident page | `PushNavigationResolver` / `NotificationDeepLinkResolver` (Android, Phase 5.2) + `buildPushNavigationPayload()` (Next.js, Phase 5.2) — **unchanged**, just fed more `reference_type` cases. |
| Never trust client-supplied IDs | Every enqueue path takes a **business row ID** (e.g. `p_bill_id`, `p_reply_id`), not a recipient ID — the recipient is always re-derived server-side from that row via the `tenant_members` join. |
| FCM failure must not cancel the business transaction | The outbox insert happens in the **same transaction** as the business mutation for the 9 already-RPC events (true atomicity — if the outbox insert fails, the whole business call fails too, which is the correct fail-closed behavior for "don't lose an event," not "don't let push break business logic"). The actual **push send** happens later, in a separate process (the dispatcher), entirely decoupled from the business transaction — an FCM outage can only ever affect `notification_outbox.status`, never `bills`/`payments`/`letter_requests`/etc. |

---

## 1.1 Integration mechanism — two rules, chosen per event's actual write shape

Every event in the Phase 1 matrix falls into exactly one of two shapes, and each gets a different, deliberately-chosen integration mechanism:

**Rule A — the mutation already happens inside a `SECURITY DEFINER` RPC (9 of 16 events: `verify_payment`, `reject_payment`, `refund_payment`, `review_letter_request`, `issue_letter`, `transition_complaint_status`, `create_activity`, `transition_activity_status`, `upsert_ronda_schedule_with_roster`).**
Extend that exact function via `CREATE OR REPLACE FUNCTION`, reproducing its existing body byte-for-byte and appending one notification block immediately before `RETURN`/the end of the function. This is maximally atomic — the enqueue happens in the *same transaction* as the business write, so it is architecturally impossible for the business mutation to succeed while the notification silently fails to enqueue, or vice versa. The risk here is purely mechanical (a transcription slip while reproducing an existing body), mitigated by diffing every reproduced function against its original source line-by-line before this migration is finalized (done for all 9 — see the migration file's own revision history below).

**Rule B — the mutation is a plain, multi-statement `supabase.from().insert()`/`.update()` sequence from a Server Action, not a single RPC (3 of 16 events: Bills via `createBillAction`/`generateBillsAction`, Announcements via `createAnnouncementAction`/`updateAnnouncementAction`, Complaint replies via `createComplaintReplyAction`).**
Add one small, dedicated wrapper RPC per event (`notify_bill_issued`, `notify_announcement_published`, `notify_complaint_reply`), and one new line in the relevant Server Action calling it **immediately after** the existing (unmodified) business write already succeeded. This is not perfectly atomic with the business write (two separate round-trips to Postgres) — a crash in the narrow window between them would lose the notification, not the business data. This trade-off is accepted deliberately rather than solved with a table trigger, for a concrete reason found while tracing Announcements' exact execution order: `announcement_recipients` rows are written in a *separate statement after* `announcements` is committed, and for `target_type = 'all'` **no `announcement_recipients` rows are ever written at all** (`buildRecipientInsertRows` returns `[]` for `'all'`). A trigger on either table alone cannot see the full picture at the right moment; the wrapper RPC sidesteps this cleanly by being called explicitly *after* the entire create/update sequence (announcement + its recipients, if any) has finished, and resolving `'all'` vs role/household targeting itself at that point via a single `EXISTS` check against `announcement_recipients`.

Both rules funnel into the same `_enqueue_business_notification()` helper (§3), with an idempotency key of `'<event>:<business_row_id>:<recipient_user_id>'`. This also absorbs a real edge case for free: editing an already-published announcement re-triggers its wrapper call every time (the action unconditionally clears-and-reinserts recipients and the caller always re-invokes the wrapper on any successful save) — `ON CONFLICT (idempotency_key) DO NOTHING` on the outbox makes every repeat call a safe no-op instead of a duplicate push, with zero special-casing needed in the wrapper itself.

## 2. Schema (new migration — rationale & impact analysis)

**Why a new migration is needed:** no existing table supports retryable, idempotent, status-tracked push dispatch; no existing function provides a shared, tenant-validated recipient resolver; 12 of 16 identified business events currently create zero notification record at all (Phase 1, §5).

**Impact analysis:**
- **No existing migration file, table, or RLS policy is edited.** Per §1.1 Rule A, 9 existing RPCs are redefined via `CREATE OR REPLACE FUNCTION` — same signature, same return type, same authorization checks, same business logic; the only change is one notification block appended at the end of each body. Every existing caller (`src/lib/*/repository.ts`) continues to call them identically — **zero TypeScript changes for these 9 events.**
- Per §1.1 Rule B, **3 new, narrowly-scoped wrapper RPCs** (`notify_bill_issued`, `notify_announcement_published`, `notify_complaint_reply`) are added, each called from exactly the Server Action(s) that already perform that event's business write — one new line per call site, immediately after the existing (unmodified) insert/update already succeeded.
- **1 new table** (`notification_outbox`), RLS-enabled with **zero policies** for `anon`/`authenticated` (deny-by-default — only `SECURITY DEFINER` functions touch it), mirroring the existing `storage_deletion_jobs` isolation pattern.
- **No existing RLS policy is weakened.** The new table adds a *new* restricted surface; nothing already-accessible becomes more accessible.
- **Blast radius:** additive only. A rollback would mean dropping the new table and reverting the 9 `CREATE OR REPLACE FUNCTION` bodies to their prior version (trivial — no data migration, no backfill needed, since this is net-new enqueueing of future events).

```sql
CREATE TABLE public.notification_outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    recipient_user_id uuid NOT NULL,
    notification_id uuid NULL REFERENCES public.notifications (id) ON DELETE SET NULL,
    event_type text NOT NULL,
    reference_type text NULL,
    reference_id uuid NULL,
    title text NOT NULL,
    body text NOT NULL,
    idempotency_key text NOT NULL,
    status text NOT NULL DEFAULT 'pending'
        CONSTRAINT chk_notification_outbox_status CHECK (
            status IN ('pending', 'processing', 'sent', 'failed', 'dead')
        ),
    attempt_count integer NOT NULL DEFAULT 0
        CONSTRAINT chk_notification_outbox_attempt_count CHECK (attempt_count >= 0),
    max_attempts integer NOT NULL DEFAULT 5
        CONSTRAINT chk_notification_outbox_max_attempts CHECK (max_attempts >= 1),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    last_error text NULL,
    claimed_at timestamptz NULL,
    sent_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_notification_outbox_idempotency_key UNIQUE (idempotency_key),
    -- Structurally impossible to enqueue a row for a non-member of this exact
    -- tenant — the same guarantee public.notifications already enforces.
    CONSTRAINT fk_notification_outbox_member
        FOREIGN KEY (tenant_id, recipient_user_id)
        REFERENCES public.tenant_members (tenant_id, user_id)
        ON DELETE CASCADE
);

CREATE INDEX idx_notification_outbox_claimable
    ON public.notification_outbox (status, next_attempt_at)
    WHERE status IN ('pending', 'failed');
CREATE INDEX idx_notification_outbox_tenant
    ON public.notification_outbox (tenant_id, created_at);

ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: no client role (anon/authenticated) can read or
-- write this table directly. All access is via SECURITY DEFINER functions,
-- matching the existing storage_deletion_jobs isolation pattern.
```

---

## 3. The shared enqueue helper

```sql
CREATE OR REPLACE FUNCTION public._enqueue_notification(
    p_tenant_id uuid,
    p_recipient_user_id uuid,
    p_event_type text,
    p_reference_type text,
    p_reference_id uuid,
    p_title text,
    p_body text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_idempotency_key text;
    v_outbox_id uuid;
    v_notification_id uuid;
BEGIN
    -- Fail closed: never enqueue for a user who is not an active member of
    -- this exact tenant. Never raises — a notification failure must never
    -- abort the caller's already-successful business transaction.
    IF NOT EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = p_tenant_id
          AND tm.user_id = p_recipient_user_id
          AND tm.status = 'active'
    ) THEN
        RETURN;
    END IF;

    v_idempotency_key := p_event_type || ':' || COALESCE(p_reference_id::text, 'none') || ':' || p_recipient_user_id::text;

    INSERT INTO public.notification_outbox (
        tenant_id, recipient_user_id, event_type,
        reference_type, reference_id, title, body, idempotency_key
    )
    VALUES (
        p_tenant_id, p_recipient_user_id, p_event_type,
        p_reference_type, p_reference_id, p_title, p_body, v_idempotency_key
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_outbox_id;

    -- The in-app bell row is only created when the outbox insert was
    -- genuinely new — a retried/duplicate caller can never produce two bell
    -- notifications either, not just never two pushes.
    IF v_outbox_id IS NOT NULL THEN
        INSERT INTO public.notifications (
            tenant_id, recipient_user_id, title, body, type, reference_type, reference_id
        )
        VALUES (
            p_tenant_id, p_recipient_user_id, p_title, p_body, p_event_type, p_reference_type, p_reference_id
        )
        RETURNING id INTO v_notification_id;

        UPDATE public.notification_outbox
        SET notification_id = v_notification_id
        WHERE id = v_outbox_id;
    END IF;
END;
$$;

ALTER FUNCTION public._enqueue_notification(uuid, uuid, text, text, uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._enqueue_notification(uuid, uuid, text, text, uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
-- No GRANT at all: this is an internal helper, only ever called from within another
-- SECURITY DEFINER function's body (which executes as the owning role) — Postgres
-- does not require the top-level caller's role to hold EXECUTE for that. Never
-- exposed over PostgREST. Naming convention (leading underscore) matches the
-- existing `_enqueue_storage_deletion_under_lock` / `_community_get_member_display_name` pattern.
```

**Idempotency key convention:** `'<event_type>:<reference_id>:<recipient_user_id>'`, e.g. `'bill.issued:<bill_id>:<user_id>'`, `'payment.verified:<payment_id>:<user_id>'`. This guarantees a retried Server Action or a duplicate RPC call can never produce two outbox rows (and thus never two pushes, and never two bell notifications) for the same (event, recipient) pair — directly satisfying "no duplicate notifications."

---

## 4. Recipient resolution per event shape

Three shapes cover all 16 events (Phase 1, §2) — no event needs a shape beyond these:

1. **Single recipient, resident_id known** (Payments verify/reject/refund, Letters review/issue, Complaints status-transition): `SELECT user_id FROM tenant_members WHERE tenant_id = ? AND resident_id = ? AND status = 'active'` (or `*_member_id = tenant_members.id` directly for complaints/community-feed, where the business row already stores the member id).
2. **Household fan-out** (Bills with `resident_id IS NULL`, `household_id` set): `SELECT tm.user_id FROM tenant_members tm JOIN residents r ON r.id = tm.resident_id AND r.tenant_id = tm.tenant_id WHERE tm.tenant_id = ? AND r.household_id = ? AND tm.status = 'active'` — loop, call the enqueue helper once per row.
3. **Role-filtered broadcast** (Activities created → all `warga`; Complaints reply-by-resident → all `ketua_rt`/`sekretaris`/`pengurus`): `SELECT tm.user_id FROM tenant_members tm JOIN member_roles mr ON mr.member_id = tm.id AND mr.tenant_id = tm.tenant_id JOIN roles r ON r.id = mr.role_id WHERE tm.tenant_id = ? AND tm.status = 'active' AND r.code = ANY(?)` — loop, call the enqueue helper once per row.

All three shapes query `tenant_members`/`member_roles`/`roles` directly — the **same tables** `has_tenant_role()` already uses. No new recipient-storage concept is introduced.

---

## 5. The dispatcher (push-send side)

### 5.1 Claim / complete RPCs

```sql
CREATE OR REPLACE FUNCTION public.claim_pending_notification_outbox_batch(p_limit integer DEFAULT 20)
RETURNS SETOF public.notification_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
BEGIN
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
        RAISE EXCEPTION 'p_limit must be between 1 and 200' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    UPDATE public.notification_outbox o
    SET status = 'processing', claimed_at = now(), updated_at = now()
    WHERE o.id IN (
        SELECT id FROM public.notification_outbox
        WHERE status IN ('pending', 'failed') AND next_attempt_at <= now()
        ORDER BY next_attempt_at
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    RETURNING o.*;
END;
$$;
ALTER FUNCTION public.claim_pending_notification_outbox_batch(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_pending_notification_outbox_batch(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_notification_outbox_batch(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.record_notification_outbox_result(
    p_outbox_id uuid, p_success boolean, p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_row record;
    v_backoff_seconds integer;
BEGIN
    SELECT * INTO v_row FROM public.notification_outbox WHERE id = p_outbox_id FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;

    IF p_success THEN
        UPDATE public.notification_outbox
        SET status = 'sent', sent_at = now(), updated_at = now(), last_error = NULL
        WHERE id = p_outbox_id;
        RETURN;
    END IF;

    IF v_row.attempt_count + 1 >= v_row.max_attempts THEN
        UPDATE public.notification_outbox
        SET status = 'dead', attempt_count = attempt_count + 1, last_error = p_error, updated_at = now()
        WHERE id = p_outbox_id;
    ELSE
        -- Exponential backoff: 60s, 120s, 240s, 480s... capped at 1 hour.
        v_backoff_seconds := LEAST(3600, (power(2, v_row.attempt_count + 1) * 30)::integer);
        UPDATE public.notification_outbox
        SET status = 'failed', attempt_count = attempt_count + 1,
            next_attempt_at = now() + make_interval(secs => v_backoff_seconds),
            last_error = p_error, updated_at = now()
        WHERE id = p_outbox_id;
    END IF;
END;
$$;
ALTER FUNCTION public.record_notification_outbox_result(uuid, boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_notification_outbox_result(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_notification_outbox_result(uuid, boolean, text) TO service_role;
```

These are deliberately **`service_role`-only**, not `authenticated` — `claim_pending_notification_outbox_batch` returns other users' `recipient_user_id`, `title`, and `body` across every tenant. Granting this to `authenticated` would be a direct cross-tenant information leak (violates Phase 4's "Tidak ada kebocoran antar-tenant" outright); it would also let any anon-key holder silently claim-and-fake-mark-as-sent every pending notification tenant-wide, a denial-of-service on the notification system itself. This is a hard security requirement, not a style choice.

### 5.2 The TS dispatcher module

A new `src/lib/notifications/dispatcher.ts`, structured exactly like `supabase/functions/send-fcm-notification/index.ts` already is — pure functions with injected dependencies (`supabaseAdmin`, `fetchImpl`), fully unit-testable without a live network or database:

```
processNotificationOutbox(deps: { supabaseAdmin, fetchImpl, fcmFunctionUrl, fcmFunctionSecret }):
  1. rows = supabaseAdmin.rpc('claim_pending_notification_outbox_batch', { p_limit: N })
  2. group rows by (tenant_id, reference_type, reference_id, title, body) -- send-fcm-notification
     already supports multiple recipient_user_ids per call; batching identical notifications
     reduces OAuth2/token-exchange overhead against the Edge Function.
  3. for each group: call send-fcm-notification (unchanged) with { tenant_id, recipient_user_ids, title, body, data: { path } }
  4. for each outbox row: supabaseAdmin.rpc('record_notification_outbox_result', { p_outbox_id, p_success, p_error })
```

`path` in `data` is resolved via the **existing** `resolveNotificationDestination("resident", reference_type, reference_id)` (through `buildPushNavigationPayload`, Phase 5.2) — reusing the Phase 5.2 contract exactly as built; the dispatcher does not invent a second path-resolution mechanism.

### 5.3 The one piece requiring an operator decision

`claim_pending_notification_outbox_batch` / `record_notification_outbox_result` are `service_role`-only by design (§5.1's security requirement is non-negotiable). The Next.js server currently holds **no `SUPABASE_SERVICE_ROLE_KEY`** anywhere (confirmed: `grep -rln "SUPABASE_SERVICE_ROLE_KEY" src/` → zero matches, and neither `.env.local` nor `.env.staging` defines one — every existing Server Action deliberately uses the user's own session-scoped client). Making `processNotificationOutbox()` actually runnable therefore requires **one of**:

- **(a) Vercel Cron → Next.js API route**, with `SUPABASE_SERVICE_ROLE_KEY` and the existing `FCM_FUNCTION_SECRET` added to Vercel's environment. This introduces a new, powerful secret into the Vercel/Next.js trust boundary that does not exist there today.
- **(b) Supabase-side scheduling** (`pg_cron` + `pg_net`), keeping both secrets entirely inside Supabase (where `FCM_FUNCTION_SECRET` already lives) and never touching Vercel at all. Confirmed via repo-wide grep: **no `pg_cron`/`pg_net`/Vault usage exists anywhere today** — this would be new Postgres-extension surface on the staging project, not an extension of something already running.

Per the standing constraint from Phase 5.1.1 onward — I do not have the plaintext value of any Supabase secret, cannot retrieve one through tooling by design, and rotating one to produce a usable value was explicitly declined as a destructive action on a production-equivalent secret — **neither path can be wired to actually fire on a schedule by me in this session.** This is flagged here, explicitly, as the one decision requiring operator input before Phase 3's dispatch-trigger becomes live; it does not block building and testing everything up to "a correct, idempotent, retryable row sits in the outbox," which has no secret dependency at all.

---

## 6. Security model (Phase 4 requirements, mapped)

| Requirement | Mechanism |
|---|---|
| Recipient always from the correct tenant | Every recipient query is `WHERE tenant_id = <business row's own tenant_id>` — never a client-supplied tenant ID (business RPCs already re-derive `tenant_id` from the locked row, e.g. `v_pay.tenant_id`, `v_act.tenant_id`). |
| Warga only receives relevant notifications | Role-filtered broadcast (shape 3, §4) restricts activity/announcement pushes to `r.code = 'warga'`. |
| Pengurus receives notifications based on role | Complaint-reply-by-resident targets `ketua_rt`/`sekretaris`/`pengurus` specifically, not all staff indiscriminately. |
| No cross-tenant leakage | `_enqueue_business_notification` re-validates tenant+recipient+active status itself (defense in depth); `claim_notification_outbox_batch` is `service_role`-only. |
| Inactive users never receive | `tm.status = 'active'` filter in every resolution shape AND re-checked again inside the enqueue helper. |
| Device tokens never sent to client | Unchanged — `user_device_tokens` already has no client-facing read path beyond the owner's own row; the dispatcher only ever reads tokens inside `send-fcm-notification` (server-side, existing, unchanged). |
| No `service_role`/FCM secret in frontend | The dispatcher is server-only code (`src/lib/notifications/dispatcher.ts`, invoked only from a server-only API route) — never imported by client components. |
| RLS stays strict | No existing policy altered; the new table ships with RLS enabled and zero grants to `anon`/`authenticated`. |

---

## 7. Deep link coverage (Phase 5 — extending the existing, unchanged contract)

`resolveNotificationDestination()` (`src/lib/notifications/types.ts`) gets new resident-scope cases — **additive only**, existing cases (`announcements`, `bills`, `payments`, `households`, `residents`) untouched:

| `reference_type` | Resolves to |
|---|---|
| `letter_requests` / `letter_request` | `/resident/letters/:id` |
| `complaints` / `complaint` | `/resident/complaints/:id` |
| `activities` / `activity` | `/resident/activities/:id` |
| `ronda_schedules` / `ronda_schedule` | `/resident/ronda/:id` |

Community Feed's existing `reference_type` values (`community_post`) also get a case added (`/resident/feed`, since there's no per-post detail route — confirmed by the route list; the feed page itself is the correct target) — this closes the "gap" noted in Phase 1 §2, row 1-4, without inventing a page that doesn't exist.

All existing Android-side validation (`TrustedOriginPolicy.validateNotificationPath`, `NotificationDeepLinkResolver`, `PushNavigationResolver`) is **unchanged** — it already validates any path under `/resident`, so new reference types flow through the exact same, already-tested security boundary with zero Android code changes.

Session-expiry handling (login → return to destination) is **unchanged** from Phase 5.2 — `resolveSafeNextPath()` already accepts any `/resident/...` path, so no new event type needs new login-redirect logic.

Fallback for a deleted/unavailable resource: `resolveNotificationDestination` already falls back to the list route when `referenceId` fails `isValidUuid` or (for the new cases) can be extended to fall back to the list route if the specific ID segment is absent — the *page itself* (e.g. `/resident/complaints/:id`) is responsible for its own "not found" rendering if the row was since deleted; this is unchanged, existing Next.js behavior (not part of the notification engine's concern).
