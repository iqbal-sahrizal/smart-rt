-- =============================================================================
-- Central Notification Engine — Outbox Table & Dispatch RPCs
--
-- RATIONALE
--   Smart RT has two separate, already-working notification primitives with no
--   connective tissue between them:
--     1. public.notifications (in-app bell) — only ever written by the
--        community-feed comment RPCs (20261116002500_create_community_feed.sql).
--        No other business event (bills, payments, letters, complaints,
--        announcements) creates an in-app notification today.
--     2. user_device_tokens + the send-fcm-notification Edge Function
--        (Phase 5.1) — fully working push delivery, but nothing calls it.
--   This migration adds the missing piece: a transaction-safe outbox that lets
--   every existing atomic business RPC enqueue a notification (both in-app and
--   push-pending) in the SAME transaction as its business write, without
--   duplicating the in-app notifications table or inventing a second delivery
--   mechanism. A separate, out-of-band batch processor (not part of this
--   migration) later claims outbox rows and calls the EXISTING Edge Function.
--
-- IMPACT ANALYSIS
--   - Additive only in file terms: no existing migration file is edited.
--   - Behavioral change to five EXISTING live functions via CREATE OR REPLACE:
--     verify_payment, reject_payment, transition_complaint_status,
--     review_letter_request, issue_letter. In every case the only change is
--     one additional PERFORM public._enqueue_notification(...) call placed
--     immediately after the function's existing audit_logs insert. Parameters,
--     return values, authorization checks, and all prior business logic are
--     unchanged. This is the same kind of evolutionary redefinition this
--     project already does routinely (e.g. RLS policies redefined in later
--     migrations) — no old migration FILE is touched, only the live function
--     body, via the normal CREATE OR REPLACE mechanism.
--   - New table notification_outbox ships with RLS enabled and ZERO grants to
--     anon/authenticated — stricter than every existing table, since nothing
--     in the UI needs to read it directly. All access is through the
--     SECURITY DEFINER functions below.
--   - claim_pending_notification_outbox_batch and record_notification_outbox_result
--     are deliberately granted to service_role ONLY (not authenticated, not
--     anon). They operate across every tenant and every recipient by design
--     (that is their job as the batch processor) — granting them more broadly
--     would let any anon-key holder silently claim-and-fake-mark-as-sent every
--     pending notification tenant-wide, a real denial-of-service on the
--     notification system. Wiring an actual scheduled caller with a
--     service_role credential is an explicit, separate operator decision — see
--     docs/notifications/central-notification-engine-architecture.md §6.
--   - No existing RLS policy on any other table is touched. No secret is
--     requested, printed, or rotated by this migration.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. notification_outbox table
-- ---------------------------------------------------------------------------

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
-- write this table directly. All access is via SECURITY DEFINER functions.

-- ---------------------------------------------------------------------------
-- 2. _enqueue_notification — shared private insert path (Shape A + Shape B)
-- ---------------------------------------------------------------------------
-- Not exposed to any role via GRANT. Callable only as a plain SQL function
-- call from inside other SECURITY DEFINER functions in this schema — Postgres
-- does not require the top-level *caller's* role to hold EXECUTE for that.
-- Idempotent: the outbox insert's ON CONFLICT DO NOTHING is the single source
-- of truth for "has this already happened"; the in-app notifications row is
-- only created when the outbox insert was genuinely new, so a retried caller
-- can never produce a duplicate bell notification either.

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

-- ---------------------------------------------------------------------------
-- 3. claim_pending_notification_outbox_batch — batch processor entry point
-- ---------------------------------------------------------------------------
-- service_role only (see impact analysis above for why).

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
    SET status = 'processing',
        claimed_at = now(),
        updated_at = now()
    WHERE o.id IN (
        SELECT id FROM public.notification_outbox
        WHERE status IN ('pending', 'failed')
          AND next_attempt_at <= now()
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

-- ---------------------------------------------------------------------------
-- 4. record_notification_outbox_result — batch processor result sink
-- ---------------------------------------------------------------------------
-- Exponential backoff: 60s, 120s, 240s, 480s, ... capped at 1 hour, dead after
-- max_attempts is reached. service_role only.

CREATE OR REPLACE FUNCTION public.record_notification_outbox_result(
    p_outbox_id uuid,
    p_success boolean,
    p_error text DEFAULT NULL
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
    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF p_success THEN
        UPDATE public.notification_outbox
        SET status = 'sent', sent_at = now(), updated_at = now(), last_error = NULL
        WHERE id = p_outbox_id;
        RETURN;
    END IF;

    IF v_row.attempt_count + 1 >= v_row.max_attempts THEN
        UPDATE public.notification_outbox
        SET status = 'dead',
            attempt_count = attempt_count + 1,
            last_error = p_error,
            updated_at = now()
        WHERE id = p_outbox_id;
    ELSE
        v_backoff_seconds := LEAST(3600, (power(2, v_row.attempt_count + 1) * 30)::integer);
        UPDATE public.notification_outbox
        SET status = 'failed',
            attempt_count = attempt_count + 1,
            next_attempt_at = now() + make_interval(secs => v_backoff_seconds),
            last_error = p_error,
            updated_at = now()
        WHERE id = p_outbox_id;
    END IF;
END;
$$;

ALTER FUNCTION public.record_notification_outbox_result(uuid, boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_notification_outbox_result(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_notification_outbox_result(uuid, boolean, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. notify_announcement_published — Shape B (direct-insert business action)
-- ---------------------------------------------------------------------------
-- Re-validates independently: re-reads the announcement, re-checks the
-- caller's role, re-checks status = 'published'. Does not trust that the
-- calling Server Action already checked any of this.

CREATE OR REPLACE FUNCTION public.notify_announcement_published(p_announcement_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_ann record;
    v_title text;
    v_body text;
    v_count integer := 0;
    v_recipient record;
    v_has_targeted_rows boolean;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_ann FROM public.announcements a WHERE a.id = p_announcement_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Announcement % not found', p_announcement_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.has_tenant_role(v_ann.tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus']) THEN
        RAISE EXCEPTION 'Forbidden: requires staff role' USING ERRCODE = '42501';
    END IF;

    IF v_ann.status <> 'published' THEN
        RAISE EXCEPTION 'Announcement % is not published (status=%)', p_announcement_id, v_ann.status
            USING ERRCODE = '22023';
    END IF;

    v_title := 'Pengumuman: ' || v_ann.title;
    v_body := left(v_ann.content, 150);

    SELECT EXISTS(
        SELECT 1 FROM public.announcement_recipients r WHERE r.announcement_id = p_announcement_id
    ) INTO v_has_targeted_rows;

    IF v_has_targeted_rows THEN
        -- targetType = 'role' or 'household'
        FOR v_recipient IN
            SELECT DISTINCT tm.user_id
            FROM public.announcement_recipients r
            JOIN public.tenant_members tm ON tm.tenant_id = r.tenant_id
            WHERE r.announcement_id = p_announcement_id
              AND tm.status = 'active'
              AND (
                  (r.role_id IS NOT NULL AND EXISTS (
                      SELECT 1 FROM public.member_roles mr
                      WHERE mr.member_id = tm.id AND mr.role_id = r.role_id
                  ))
                  OR
                  (r.household_id IS NOT NULL AND EXISTS (
                      SELECT 1 FROM public.residents res
                      WHERE res.id = tm.resident_id
                        AND res.household_id = r.household_id
                        AND res.deleted_at IS NULL
                  ))
              )
        LOOP
            PERFORM public._enqueue_notification(
                v_ann.tenant_id, v_recipient.user_id, 'announcement.published',
                'announcement', p_announcement_id, v_title, v_body
            );
            v_count := v_count + 1;
        END LOOP;
    ELSE
        -- targetType = 'all'
        FOR v_recipient IN
            SELECT tm.user_id
            FROM public.tenant_members tm
            WHERE tm.tenant_id = v_ann.tenant_id AND tm.status = 'active'
        LOOP
            PERFORM public._enqueue_notification(
                v_ann.tenant_id, v_recipient.user_id, 'announcement.published',
                'announcement', p_announcement_id, v_title, v_body
            );
            v_count := v_count + 1;
        END LOOP;
    END IF;

    RETURN v_count;
END;
$$;

ALTER FUNCTION public.notify_announcement_published(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.notify_announcement_published(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.notify_announcement_published(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. notify_bill_issued — Shape B (direct-insert business action)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_bill_issued(p_bill_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_bill record;
    v_due record;
    v_title text;
    v_body text;
    v_count integer := 0;
    v_recipient record;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_bill FROM public.bills b WHERE b.id = p_bill_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bill % not found', p_bill_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.has_tenant_role(v_bill.tenant_id, ARRAY['bendahara', 'ketua_rt']) THEN
        RAISE EXCEPTION 'Forbidden: requires bendahara or ketua_rt' USING ERRCODE = '42501';
    END IF;

    SELECT d.* INTO v_due FROM public.dues d WHERE d.id = v_bill.due_id AND d.tenant_id = v_bill.tenant_id;

    v_title := 'Tagihan baru: ' || COALESCE(v_due.name, 'Iuran');
    v_body := format(
        'Periode %s/%s, jatuh tempo %s',
        lpad(v_bill.period_month::text, 2, '0'),
        v_bill.period_year,
        to_char(v_bill.due_date, 'DD Mon YYYY')
    );

    IF v_bill.resident_id IS NOT NULL THEN
        FOR v_recipient IN
            SELECT tm.user_id FROM public.tenant_members tm
            WHERE tm.tenant_id = v_bill.tenant_id
              AND tm.resident_id = v_bill.resident_id
              AND tm.status = 'active'
        LOOP
            PERFORM public._enqueue_notification(
                v_bill.tenant_id, v_recipient.user_id, 'bill.issued', 'bill', p_bill_id, v_title, v_body
            );
            v_count := v_count + 1;
        END LOOP;
    ELSIF v_bill.household_id IS NOT NULL THEN
        FOR v_recipient IN
            SELECT tm.user_id
            FROM public.tenant_members tm
            JOIN public.residents res ON res.id = tm.resident_id AND res.tenant_id = tm.tenant_id
            WHERE res.household_id = v_bill.household_id
              AND res.deleted_at IS NULL
              AND tm.status = 'active'
              AND tm.tenant_id = v_bill.tenant_id
        LOOP
            PERFORM public._enqueue_notification(
                v_bill.tenant_id, v_recipient.user_id, 'bill.issued', 'bill', p_bill_id, v_title, v_body
            );
            v_count := v_count + 1;
        END LOOP;
    END IF;

    RETURN v_count;
END;
$$;

ALTER FUNCTION public.notify_bill_issued(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.notify_bill_issued(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.notify_bill_issued(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Shape A — embed enqueue calls into existing business RPCs
--    (CREATE OR REPLACE; only one PERFORM line added per function, placed
--    immediately after the existing audit_logs insert; everything else is
--    byte-for-byte identical to 20261114001500_storage_and_atomic_rpcs.sql)
-- ---------------------------------------------------------------------------

-- 7.1 verify_payment → notify the resident who owns the bill
CREATE OR REPLACE FUNCTION public.verify_payment(
    p_payment_id uuid,
    p_cash_category_id uuid,
    p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_pay record;
    v_bill record;
    v_cat_type text;
    v_expected_tx_type text;
    v_net_paid numeric(14, 2);
    v_new_bill_status text;
    v_recipient record;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_pay
    FROM public.payments p
    WHERE p.id = p_payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment % not found', p_payment_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.has_tenant_role(v_pay.tenant_id, ARRAY['bendahara', 'ketua_rt']) THEN
        RAISE EXCEPTION 'Forbidden: requires bendahara or ketua_rt in tenant %', v_pay.tenant_id
            USING ERRCODE = '42501';
    END IF;

    IF v_pay.status IS DISTINCT FROM 'pending' THEN
        RAISE EXCEPTION 'Only pending payments can be verified (status=%)', v_pay.status
            USING ERRCODE = '22023';
    END IF;

    v_expected_tx_type := CASE WHEN v_pay.payment_type = 'payment' THEN 'income' ELSE 'expense' END;

    SELECT cc.type INTO v_cat_type
    FROM public.cash_categories cc
    WHERE cc.id = p_cash_category_id
      AND cc.tenant_id = v_pay.tenant_id
      AND cc.is_active IS TRUE;

    IF NOT FOUND OR v_cat_type IS DISTINCT FROM v_expected_tx_type THEN
        RAISE EXCEPTION 'Invalid or inactive cash_category_id % for type %', p_cash_category_id, v_expected_tx_type
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_bill
    FROM public.bills b
    WHERE b.id = v_pay.bill_id
      AND b.tenant_id = v_pay.tenant_id
    FOR UPDATE;

    -- Never overwrite payments.notes
    UPDATE public.payments p
       SET status = 'verified',
           verified_by = v_actor,
           verified_at = now()
     WHERE p.id = v_pay.id;

    INSERT INTO public.cash_transactions (
        tenant_id, category_id, payment_id, type, amount,
        transaction_date, description, created_by
    )
    VALUES (
        v_pay.tenant_id,
        p_cash_category_id,
        v_pay.id,
        v_expected_tx_type,
        v_pay.amount,
        (now() AT TIME ZONE 'Asia/Jakarta')::date,
        format('Verifikasi pembayaran tagihan %s/%s', v_bill.period_year, lpad(v_bill.period_month::text, 2, '0')),
        v_actor
    );

    SELECT COALESCE(SUM(p.amount) FILTER (WHERE p.payment_type = 'payment' AND p.status IN ('verified', 'refunded')), 0)
           - COALESCE(SUM(p.amount) FILTER (WHERE p.payment_type = 'refund' AND p.status = 'verified'), 0)
    INTO v_net_paid
    FROM public.payments p
    WHERE p.bill_id = v_bill.id
      AND p.tenant_id = v_bill.tenant_id;

    IF v_net_paid < 0 OR v_net_paid > v_bill.amount THEN
        RAISE EXCEPTION 'Invariant violation: net paid (%) out of range [0, %]', v_net_paid, v_bill.amount
            USING ERRCODE = '23514';
    END IF;

    v_new_bill_status := CASE
        WHEN v_net_paid = 0 THEN 'unpaid'
        WHEN v_net_paid >= v_bill.amount THEN 'paid'
        ELSE 'partial'
    END;

    UPDATE public.bills b
       SET paid_amount = v_net_paid,
           status = v_new_bill_status,
           paid_at = CASE WHEN v_net_paid >= v_bill.amount THEN COALESCE(b.paid_at, now()) ELSE NULL END
     WHERE b.id = v_bill.id;

    INSERT INTO public.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    VALUES (
        v_pay.tenant_id,
        v_actor,
        'payment.verified',
        'payments',
        v_pay.id,
        jsonb_build_object(
            'bill_id', v_bill.id,
            'amount', v_pay.amount,
            'cash_category_id', p_cash_category_id,
            'paid_amount', v_net_paid,
            'bill_status', v_new_bill_status,
            'reviewer_notes', p_notes
        )
    );

    FOR v_recipient IN
        SELECT tm.user_id FROM public.tenant_members tm
        WHERE tm.tenant_id = v_bill.tenant_id AND tm.status = 'active'
          AND (
              (v_bill.resident_id IS NOT NULL AND tm.resident_id = v_bill.resident_id)
              OR (v_bill.household_id IS NOT NULL AND tm.resident_id IN (
                  SELECT res.id FROM public.residents res
                  WHERE res.household_id = v_bill.household_id AND res.tenant_id = v_bill.tenant_id AND res.deleted_at IS NULL
              ))
          )
    LOOP
        PERFORM public._enqueue_notification(
            v_pay.tenant_id, v_recipient.user_id, 'payment.verified', 'bill', v_bill.id,
            'Pembayaran diverifikasi',
            format('Pembayaran tagihan %s/%s Anda telah diverifikasi.', v_bill.period_year, lpad(v_bill.period_month::text, 2, '0'))
        );
    END LOOP;

    RETURN jsonb_build_object(
        'payment_id', v_pay.id,
        'bill_id', v_bill.id,
        'paid_amount', v_net_paid,
        'bill_status', v_new_bill_status
    );
END;
$$;

ALTER FUNCTION public.verify_payment(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.verify_payment(uuid, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.verify_payment(uuid, uuid, text) TO authenticated;

-- 7.2 reject_payment → notify the resident who owns the bill
CREATE OR REPLACE FUNCTION public.reject_payment(
    p_payment_id uuid,
    p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_pay record;
    v_bill record;
    v_other_pending boolean := false;
    v_new_bill_status text;
    v_recipient record;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'Rejection reason is required' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_pay
    FROM public.payments p
    WHERE p.id = p_payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment % not found', p_payment_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.has_tenant_role(v_pay.tenant_id, ARRAY['bendahara', 'ketua_rt']) THEN
        RAISE EXCEPTION 'Forbidden: requires bendahara or ketua_rt' USING ERRCODE = '42501';
    END IF;

    IF v_pay.status IS DISTINCT FROM 'pending' THEN
        RAISE EXCEPTION 'Only pending payments can be rejected (status=%)', v_pay.status
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_bill
    FROM public.bills b
    WHERE b.id = v_pay.bill_id
      AND b.tenant_id = v_pay.tenant_id
    FOR UPDATE;

    -- Keep verified_by NULL, verified_at NULL, and do not overwrite notes
    UPDATE public.payments p
       SET status = 'rejected',
           verified_by = NULL,
           verified_at = NULL
     WHERE p.id = v_pay.id;

    v_new_bill_status := v_bill.status;
    IF v_bill.status = 'pending_verification' THEN
        SELECT EXISTS (
            SELECT 1 FROM public.payments op
            WHERE op.bill_id = v_bill.id
              AND op.tenant_id = v_bill.tenant_id
              AND op.id <> v_pay.id
              AND op.status = 'pending'
        )
        INTO v_other_pending;

        IF NOT v_other_pending THEN
            v_new_bill_status := CASE
                WHEN v_bill.paid_amount > 0 THEN 'partial'
                WHEN v_bill.due_date < CURRENT_DATE THEN 'overdue'
                ELSE 'unpaid'
            END;
            UPDATE public.bills b
               SET status = v_new_bill_status
             WHERE b.id = v_bill.id;
        END IF;
    END IF;

    INSERT INTO public.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    VALUES (
        v_pay.tenant_id,
        v_actor,
        'payment.rejected',
        'payments',
        v_pay.id,
        jsonb_build_object(
            'bill_id', v_bill.id,
            'reason', btrim(p_reason),
            'bill_status', v_new_bill_status
        )
    );

    FOR v_recipient IN
        SELECT tm.user_id FROM public.tenant_members tm
        WHERE tm.tenant_id = v_bill.tenant_id AND tm.status = 'active'
          AND (
              (v_bill.resident_id IS NOT NULL AND tm.resident_id = v_bill.resident_id)
              OR (v_bill.household_id IS NOT NULL AND tm.resident_id IN (
                  SELECT res.id FROM public.residents res
                  WHERE res.household_id = v_bill.household_id AND res.tenant_id = v_bill.tenant_id AND res.deleted_at IS NULL
              ))
          )
    LOOP
        PERFORM public._enqueue_notification(
            v_pay.tenant_id, v_recipient.user_id, 'payment.rejected', 'bill', v_bill.id,
            'Pembayaran ditolak',
            format('Pembayaran tagihan %s/%s Anda ditolak: %s', v_bill.period_year, lpad(v_bill.period_month::text, 2, '0'), btrim(p_reason))
        );
    END LOOP;

    RETURN jsonb_build_object(
        'payment_id', v_pay.id,
        'bill_id', v_bill.id,
        'status', 'rejected',
        'bill_status', v_new_bill_status
    );
END;
$$;

ALTER FUNCTION public.reject_payment(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reject_payment(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reject_payment(uuid, text) TO authenticated;

-- 7.3 transition_complaint_status → notify the reporter on terminal states only
CREATE OR REPLACE FUNCTION public.transition_complaint_status(
    p_complaint_id uuid,
    p_new_status text,
    p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_c record;
    v_member_id uuid;
    v_recipient_user_id uuid;
    v_label text;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    IF p_new_status IS NULL OR p_new_status NOT IN ('in_progress', 'resolved', 'rejected') THEN
        RAISE EXCEPTION 'Invalid target complaint status: %', p_new_status USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_c
    FROM public.complaints c
    WHERE c.id = p_complaint_id
    FOR UPDATE;

    IF NOT FOUND OR v_c.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Complaint % not found or deleted', p_complaint_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.has_tenant_role(v_c.tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus']) THEN
        RAISE EXCEPTION 'Forbidden: requires staff role' USING ERRCODE = '42501';
    END IF;

    v_member_id := public.get_my_member_id(v_c.tenant_id);
    IF v_member_id IS NULL THEN
        RAISE EXCEPTION 'Forbidden: inactive member' USING ERRCODE = '42501';
    END IF;

    -- No reopen once resolved or rejected
    IF v_c.status IN ('resolved', 'rejected') OR v_c.status = p_new_status THEN
        RAISE EXCEPTION 'Invalid complaint transition % -> %', v_c.status, p_new_status USING ERRCODE = '22023';
    END IF;

    UPDATE public.complaints c
       SET status = p_new_status
     WHERE c.id = v_c.id;

    INSERT INTO public.complaint_status_history (
        tenant_id, complaint_id, changed_by_member_id, previous_status, new_status, reason
    )
    VALUES (
        v_c.tenant_id, v_c.id, v_member_id, v_c.status, p_new_status, NULLIF(btrim(p_reason), '')
    );

    INSERT INTO public.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    VALUES (
        v_c.tenant_id,
        v_actor,
        'complaint.status_changed',
        'complaints',
        v_c.id,
        jsonb_build_object(
            'previous_status', v_c.status,
            'new_status', p_new_status,
            'reason', NULLIF(btrim(p_reason), '')
        )
    );

    -- Only terminal states are notify-worthy; 'in_progress' is an internal
    -- status change (task's own instruction: avoid notifying on those).
    IF p_new_status IN ('resolved', 'rejected') THEN
        SELECT tm.user_id INTO v_recipient_user_id
        FROM public.tenant_members tm
        WHERE tm.id = v_c.reporter_member_id
          AND tm.tenant_id = v_c.tenant_id
          AND tm.status = 'active';

        IF v_recipient_user_id IS NOT NULL THEN
            v_label := CASE WHEN p_new_status = 'resolved' THEN 'diselesaikan' ELSE 'ditolak' END;
            PERFORM public._enqueue_notification(
                v_c.tenant_id, v_recipient_user_id, 'complaint.' || p_new_status, 'complaint', v_c.id,
                'Pengaduan ' || v_label,
                format('Pengaduan "%s" Anda telah %s.', v_c.title, v_label)
            );
        END IF;
    END IF;
END;
$$;

ALTER FUNCTION public.transition_complaint_status(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.transition_complaint_status(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.transition_complaint_status(uuid, text, text) TO authenticated;

-- 7.4 review_letter_request → notify the requester on approved/rejected only
CREATE OR REPLACE FUNCTION public.review_letter_request(
    p_request_id uuid,
    p_decision text,
    p_admin_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_lr record;
    v_recipient_user_id uuid;
    v_label text;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    IF p_decision IS NULL OR p_decision NOT IN ('reviewing', 'approved', 'rejected') THEN
        RAISE EXCEPTION 'Invalid review decision: %', p_decision USING ERRCODE = '22023';
    END IF;

    IF p_decision = 'rejected' AND (p_admin_notes IS NULL OR btrim(p_admin_notes) = '') THEN
        RAISE EXCEPTION 'Admin notes are required when rejecting a letter request' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_lr
    FROM public.letter_requests lr
    WHERE lr.id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Letter request % not found', p_request_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.has_tenant_role(v_lr.tenant_id, ARRAY['ketua_rt', 'sekretaris']) THEN
        RAISE EXCEPTION 'Forbidden: requires ketua_rt or sekretaris' USING ERRCODE = '42501';
    END IF;

    IF v_lr.status NOT IN ('submitted', 'reviewing')
       OR (v_lr.status = 'reviewing' AND p_decision = 'reviewing') THEN
        RAISE EXCEPTION 'Invalid letter review transition % -> %', v_lr.status, p_decision
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.letter_requests lr
       SET status = p_decision,
           admin_notes = COALESCE(NULLIF(btrim(p_admin_notes), ''), lr.admin_notes),
           reviewed_by = v_actor,
           reviewed_at = now()
     WHERE lr.id = v_lr.id;

    INSERT INTO public.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    VALUES (
        v_lr.tenant_id,
        v_actor,
        'letter_request.reviewed',
        'letter_requests',
        v_lr.id,
        jsonb_build_object(
            'previous_status', v_lr.status,
            'new_status', p_decision,
            'admin_notes', NULLIF(btrim(p_admin_notes), '')
        )
    );

    IF p_decision IN ('approved', 'rejected') THEN
        SELECT tm.user_id INTO v_recipient_user_id
        FROM public.tenant_members tm
        WHERE tm.tenant_id = v_lr.tenant_id
          AND tm.resident_id = v_lr.resident_id
          AND tm.status = 'active';

        IF v_recipient_user_id IS NOT NULL THEN
            v_label := CASE WHEN p_decision = 'approved' THEN 'disetujui' ELSE 'ditolak' END;
            PERFORM public._enqueue_notification(
                v_lr.tenant_id, v_recipient_user_id, 'letter_request.' || p_decision, 'letter_request', v_lr.id,
                'Permohonan surat ' || v_label,
                format('Permohonan surat Anda telah %s.', v_label)
            );
        END IF;
    END IF;
END;
$$;

ALTER FUNCTION public.review_letter_request(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.review_letter_request(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.review_letter_request(uuid, text, text) TO authenticated;

-- 7.5 issue_letter → notify the requester the letter is ready
CREATE OR REPLACE FUNCTION public.issue_letter(
    p_request_id uuid,
    p_storage_path text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_lr record;
    v_type_code text;
    v_year smallint := EXTRACT(YEAR FROM now() AT TIME ZONE 'Asia/Jakarta')::smallint;
    v_seq integer;
    v_letter_number text;
    v_prev_ctx text := current_setting('app.storage_ref_ctx', true);
    v_recipient_user_id uuid;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    IF p_storage_path IS NULL
       OR p_storage_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$' THEN
        RAISE EXCEPTION 'Invalid issued letter PDF storage path: %', p_storage_path USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('storage:issued-letters/' || p_storage_path, 0));

    SELECT lr.*, lt.code AS letter_type_code
    INTO v_lr
    FROM public.letter_requests lr
    JOIN public.letter_types lt ON lt.id = lr.letter_type_id AND lt.tenant_id = lr.tenant_id
    WHERE lr.id = p_request_id
    FOR UPDATE OF lr;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Letter request % not found', p_request_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.has_tenant_role(v_lr.tenant_id, ARRAY['ketua_rt', 'sekretaris']) THEN
        RAISE EXCEPTION 'Forbidden: requires ketua_rt or sekretaris' USING ERRCODE = '42501';
    END IF;

    IF v_lr.status <> 'approved' THEN
        RAISE EXCEPTION 'Only approved letter requests can be issued (status=%)', v_lr.status
            USING ERRCODE = '22023';
    END IF;

    IF split_part(p_storage_path, '/', 1) <> v_lr.tenant_id::text
       OR split_part(p_storage_path, '/', 2) <> v_lr.id::text THEN
        RAISE EXCEPTION 'Issued letter path tenant/request segment mismatch' USING ERRCODE = '22023';
    END IF;

    IF public.is_storage_object_deletion_pending('issued-letters', p_storage_path)
       OR public.is_storage_object_path_retired('issued-letters', p_storage_path) THEN
        RAISE EXCEPTION 'Issued letter path is pending deletion or retired' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM storage.objects o
        WHERE o.bucket_id = 'issued-letters'
          AND o.name = p_storage_path
          AND o.archived_at IS NULL
          AND o.is_delete_marker = false
    ) THEN
        RAISE EXCEPTION 'Issued letter object does not exist in storage: %', p_storage_path
            USING ERRCODE = '23503';
    END IF;

    v_type_code := upper(regexp_replace(v_lr.letter_type_code, '[^A-Za-z0-9]+', '', 'g'));

    INSERT INTO public.letter_sequences (tenant_id, period_year, last_number)
    VALUES (v_lr.tenant_id, v_year, 1)
    ON CONFLICT (tenant_id, period_year)
    DO UPDATE SET last_number = public.letter_sequences.last_number + 1,
                  updated_at = now()
    RETURNING last_number INTO v_seq;

    v_letter_number := format('%s/%s/%s', lpad(v_seq::text, 3, '0'), v_type_code, v_year);

    BEGIN
        PERFORM set_config('app.storage_ref_ctx', 'rpc_authorized', true);
        UPDATE public.letter_requests lr
           SET status = 'completed',
               issued_file_path = p_storage_path,
               letter_number = v_letter_number,
               issued_at = now(),
               reviewed_by = COALESCE(lr.reviewed_by, v_actor),
               reviewed_at = COALESCE(lr.reviewed_at, now())
         WHERE lr.id = v_lr.id;
        PERFORM set_config('app.storage_ref_ctx', COALESCE(v_prev_ctx, ''), true);
    EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('app.storage_ref_ctx', COALESCE(v_prev_ctx, ''), true);
        RAISE;
    END;

    INSERT INTO public.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    VALUES (
        v_lr.tenant_id,
        v_actor,
        'letter_request.issued',
        'letter_requests',
        v_lr.id,
        jsonb_build_object(
            'letter_number', v_letter_number,
            'issued_file_path', p_storage_path,
            'sequence_year', v_year,
            'sequence_number', v_seq
        )
    );

    SELECT tm.user_id INTO v_recipient_user_id
    FROM public.tenant_members tm
    WHERE tm.tenant_id = v_lr.tenant_id
      AND tm.resident_id = v_lr.resident_id
      AND tm.status = 'active';

    IF v_recipient_user_id IS NOT NULL THEN
        PERFORM public._enqueue_notification(
            v_lr.tenant_id, v_recipient_user_id, 'letter_request.issued', 'letter_request', v_lr.id,
            'Surat Anda sudah terbit',
            format('Surat Anda dengan nomor %s sudah dapat diunduh.', v_letter_number)
        );
    END IF;

    RETURN v_letter_number;
END;
$$;

ALTER FUNCTION public.issue_letter(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_letter(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.issue_letter(uuid, text) TO authenticated;

-- 7.6 refund_payment → notify the resident who owns the bill
CREATE OR REPLACE FUNCTION public.refund_payment(
    p_parent_payment_id uuid,
    p_amount numeric,
    p_cash_category_id uuid,
    p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_parent record;
    v_bill record;
    v_cat_type text;
    v_committed_refunds numeric(14, 2);
    v_verified_refunds numeric(14, 2);
    v_refund_id uuid;
    v_net_paid numeric(14, 2);
    v_new_bill_status text;
    v_recipient record;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 OR p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'Valid refund amount and reason are required' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_parent
    FROM public.payments p
    WHERE p.id = p_parent_payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parent payment % not found', p_parent_payment_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.has_tenant_role(v_parent.tenant_id, ARRAY['bendahara', 'ketua_rt']) THEN
        RAISE EXCEPTION 'Forbidden: requires bendahara or ketua_rt' USING ERRCODE = '42501';
    END IF;

    IF v_parent.payment_type <> 'payment' OR v_parent.status NOT IN ('verified', 'refunded') THEN
        RAISE EXCEPTION 'Only verified payments can be refunded' USING ERRCODE = '22023';
    END IF;

    SELECT cc.type INTO v_cat_type
    FROM public.cash_categories cc
    WHERE cc.id = p_cash_category_id
      AND cc.tenant_id = v_parent.tenant_id
      AND cc.is_active IS TRUE;

    IF NOT FOUND OR v_cat_type IS DISTINCT FROM 'expense' THEN
        RAISE EXCEPTION 'Invalid or inactive expense cash_category_id %', p_cash_category_id
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_bill
    FROM public.bills b
    WHERE b.id = v_parent.bill_id
      AND b.tenant_id = v_parent.tenant_id
    FOR UPDATE;

    SELECT COALESCE(SUM(p.amount), 0) INTO v_committed_refunds
    FROM public.payments p
    WHERE p.tenant_id = v_parent.tenant_id
      AND p.parent_payment_id = v_parent.id
      AND p.payment_type = 'refund'
      AND p.status IN ('pending', 'verified');

    IF v_committed_refunds + p_amount > v_parent.amount THEN
        RAISE EXCEPTION 'Total refund (%) exceeds original payment amount (%)',
            v_committed_refunds + p_amount, v_parent.amount
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.payments (
        tenant_id, bill_id, payment_type, parent_payment_id, paid_by_user_id,
        amount, payment_method, status, notes, verified_by, verified_at, paid_at
    )
    VALUES (
        v_parent.tenant_id, v_parent.bill_id, 'refund', v_parent.id, v_parent.paid_by_user_id,
        p_amount, v_parent.payment_method, 'verified', btrim(p_reason), v_actor, now(), now()
    )
    RETURNING id INTO v_refund_id;

    SELECT COALESCE(SUM(p.amount), 0) INTO v_verified_refunds
    FROM public.payments p
    WHERE p.tenant_id = v_parent.tenant_id
      AND p.parent_payment_id = v_parent.id
      AND p.payment_type = 'refund'
      AND p.status = 'verified';

    IF v_verified_refunds = v_parent.amount THEN
        UPDATE public.payments p
           SET status = 'refunded'
         WHERE p.id = v_parent.id;
    END IF;

    INSERT INTO public.cash_transactions (
        tenant_id, category_id, payment_id, type, amount,
        transaction_date, description, created_by
    )
    VALUES (
        v_parent.tenant_id,
        p_cash_category_id,
        v_refund_id,
        'expense',
        p_amount,
        (now() AT TIME ZONE 'Asia/Jakarta')::date,
        format('Refund pembayaran: %s', btrim(p_reason)),
        v_actor
    );

    SELECT COALESCE(SUM(p.amount) FILTER (WHERE p.payment_type = 'payment' AND p.status IN ('verified', 'refunded')), 0)
           - COALESCE(SUM(p.amount) FILTER (WHERE p.payment_type = 'refund' AND p.status = 'verified'), 0)
    INTO v_net_paid
    FROM public.payments p
    WHERE p.bill_id = v_bill.id
      AND p.tenant_id = v_bill.tenant_id;

    IF v_net_paid < 0 OR v_net_paid > v_bill.amount THEN
        RAISE EXCEPTION 'Invariant violation: net paid (%) out of range [0, %]', v_net_paid, v_bill.amount
            USING ERRCODE = '23514';
    END IF;

    v_new_bill_status := CASE
        WHEN v_net_paid = 0 THEN 'unpaid'
        WHEN v_net_paid >= v_bill.amount THEN 'paid'
        ELSE 'partial'
    END;

    UPDATE public.bills b
       SET paid_amount = v_net_paid,
           status = v_new_bill_status,
           paid_at = CASE WHEN v_net_paid >= v_bill.amount THEN COALESCE(b.paid_at, now()) ELSE NULL END
     WHERE b.id = v_bill.id;

    INSERT INTO public.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    VALUES (
        v_parent.tenant_id,
        v_actor,
        'payment.refunded',
        'payments',
        v_refund_id,
        jsonb_build_object(
            'parent_payment_id', v_parent.id,
            'bill_id', v_bill.id,
            'refund_amount', p_amount,
            'reason', btrim(p_reason),
            'paid_amount', v_net_paid,
            'bill_status', v_new_bill_status
        )
    );

    FOR v_recipient IN
        SELECT tm.user_id FROM public.tenant_members tm
        WHERE tm.tenant_id = v_bill.tenant_id AND tm.status = 'active'
          AND (
              (v_bill.resident_id IS NOT NULL AND tm.resident_id = v_bill.resident_id)
              OR (v_bill.household_id IS NOT NULL AND tm.resident_id IN (
                  SELECT res.id FROM public.residents res
                  WHERE res.household_id = v_bill.household_id AND res.tenant_id = v_bill.tenant_id AND res.deleted_at IS NULL
              ))
          )
    LOOP
        PERFORM public._enqueue_notification(
            v_parent.tenant_id, v_recipient.user_id, 'payment.refunded', 'bill', v_bill.id,
            'Refund diproses',
            format('Refund sebesar %s untuk tagihan %s/%s Anda telah diproses.', p_amount, v_bill.period_year, lpad(v_bill.period_month::text, 2, '0'))
        );
    END LOOP;

    RETURN v_refund_id;
END;
$$;

ALTER FUNCTION public.refund_payment(uuid, numeric, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.refund_payment(uuid, numeric, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.refund_payment(uuid, numeric, uuid, text) TO authenticated;

-- 7.7 create_activity → notify all active 'warga' in the tenant (broadcast)
CREATE OR REPLACE FUNCTION public.create_activity(
    p_tenant_id uuid,
    p_title text,
    p_location text,
    p_start_at timestamptz,
    p_description text DEFAULT NULL,
    p_category text DEFAULT 'lainnya',
    p_end_at timestamptz DEFAULT NULL,
    p_allow_self_registration boolean DEFAULT true,
    p_max_participants integer DEFAULT NULL,
    p_registration_deadline timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_title text := btrim(COALESCE(p_title, ''));
    v_location text := btrim(COALESCE(p_location, ''));
    v_description text := NULLIF(btrim(COALESCE(p_description, '')), '');
    v_category text := COALESCE(NULLIF(btrim(p_category), ''), 'lainnya');
    v_activity_id uuid;
    v_recipient record;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    IF p_tenant_id IS NULL OR NOT public.has_tenant_role(p_tenant_id, ARRAY['ketua_rt', 'sekretaris']) THEN
        RAISE EXCEPTION 'Forbidden: requires ketua_rt or sekretaris role' USING ERRCODE = '42501';
    END IF;

    IF v_title = '' OR char_length(v_title) > 200 THEN
        RAISE EXCEPTION 'Activity title must be 1..200 characters' USING ERRCODE = '22023';
    END IF;

    IF v_location = '' OR char_length(v_location) > 200 THEN
        RAISE EXCEPTION 'Activity location must be 1..200 characters' USING ERRCODE = '22023';
    END IF;

    IF v_description IS NOT NULL AND char_length(v_description) > 4000 THEN
        RAISE EXCEPTION 'Activity description must be <= 4000 characters' USING ERRCODE = '22023';
    END IF;

    IF v_category NOT IN (
        'kerja_bakti', 'rapat', 'kesehatan', 'keamanan',
        'sosial', 'olahraga', 'keagamaan', 'lainnya'
    ) THEN
        RAISE EXCEPTION 'Invalid activity category: %', v_category USING ERRCODE = '22023';
    END IF;

    IF p_start_at IS NULL THEN
        RAISE EXCEPTION 'start_at is required' USING ERRCODE = '22023';
    END IF;

    IF p_end_at IS NOT NULL AND p_end_at < p_start_at THEN
        RAISE EXCEPTION 'end_at must be >= start_at' USING ERRCODE = '22023';
    END IF;

    IF p_max_participants IS NOT NULL AND p_max_participants <= 0 THEN
        RAISE EXCEPTION 'max_participants must be > 0' USING ERRCODE = '22023';
    END IF;

    IF p_registration_deadline IS NOT NULL
       AND p_registration_deadline > COALESCE(p_end_at, p_start_at) THEN
        RAISE EXCEPTION 'registration_deadline must be <= end_at/start_at' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.activities (
        tenant_id,
        title,
        description,
        category,
        location,
        start_at,
        end_at,
        status,
        allow_self_registration,
        max_participants,
        registration_deadline,
        documentation_paths,
        created_by,
        updated_by
    )
    VALUES (
        p_tenant_id,
        v_title,
        v_description,
        v_category,
        v_location,
        p_start_at,
        p_end_at,
        'scheduled',
        COALESCE(p_allow_self_registration, true),
        p_max_participants,
        p_registration_deadline,
        '[]'::jsonb,
        v_actor,
        v_actor
    )
    RETURNING id INTO v_activity_id;

    INSERT INTO public.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    VALUES (
        p_tenant_id,
        v_actor,
        'activity.created',
        'activities',
        v_activity_id,
        jsonb_build_object(
            'category', v_category,
            'start_at', p_start_at,
            'end_at', p_end_at,
            'max_participants', p_max_participants,
            'allow_self_registration', COALESCE(p_allow_self_registration, true)
        )
    );

    -- Broadcast: every active 'warga' in the tenant is notified of a new activity.
    -- No existing precedent for "all residents" fan-out — this is the recipient
    -- shape documented as new in the architecture doc, §1.1 / §4 shape 3.
    FOR v_recipient IN
        SELECT DISTINCT tm.user_id
        FROM public.tenant_members tm
        JOIN public.member_roles mr ON mr.member_id = tm.id AND mr.tenant_id = tm.tenant_id
        JOIN public.roles r ON r.id = mr.role_id
        WHERE tm.tenant_id = p_tenant_id
          AND tm.status = 'active'
          AND r.code = 'warga'
    LOOP
        PERFORM public._enqueue_notification(
            p_tenant_id, v_recipient.user_id, 'activity.created', 'activity', v_activity_id,
            'Kegiatan baru: ' || v_title,
            format('%s di %s', to_char(p_start_at AT TIME ZONE 'Asia/Jakarta', 'DD Mon YYYY HH24:MI'), v_location)
        );
    END LOOP;

    RETURN v_activity_id;
END;
$$;

ALTER FUNCTION public.create_activity(
    uuid, text, text, timestamptz, text, text, timestamptz, boolean, integer, timestamptz
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_activity(
    uuid, text, text, timestamptz, text, text, timestamptz, boolean, integer, timestamptz
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_activity(
    uuid, text, text, timestamptz, text, text, timestamptz, boolean, integer, timestamptz
) TO authenticated;

-- 7.8 transition_activity_status → notify RSVP'd participants only when cancelled
CREATE OR REPLACE FUNCTION public.transition_activity_status(
    p_activity_id uuid,
    p_new_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_act record;
    v_recipient record;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    IF p_new_status IS NULL OR p_new_status NOT IN ('ongoing', 'completed', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid target activity status: %', p_new_status USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_act
    FROM public.activities a
    WHERE a.id = p_activity_id
    FOR UPDATE;

    IF NOT FOUND OR v_act.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Activity % not found or deleted', p_activity_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.has_tenant_role(v_act.tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus']) THEN
        RAISE EXCEPTION 'Forbidden: requires staff role' USING ERRCODE = '42501';
    END IF;

    IF NOT (
        (v_act.status = 'scheduled' AND p_new_status IN ('ongoing', 'cancelled'))
        OR (v_act.status = 'ongoing' AND p_new_status IN ('completed', 'cancelled'))
    ) THEN
        RAISE EXCEPTION 'Invalid activity transition % -> %', v_act.status, p_new_status
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.activities a
       SET status = p_new_status
     WHERE a.id = v_act.id;

    INSERT INTO public.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    VALUES (
        v_act.tenant_id,
        v_actor,
        'activity.status_changed',
        'activities',
        v_act.id,
        jsonb_build_object('previous_status', v_act.status, 'new_status', p_new_status)
    );

    -- Only cancellation is notify-worthy: 'ongoing'/'completed' are internal
    -- progressions a resident doesn't need pushed to them (task instruction:
    -- avoid notifying on internal changes). A cancellation directly affects
    -- residents who RSVP'd, so it is treated as notify-worthy, not internal.
    IF p_new_status = 'cancelled' THEN
        FOR v_recipient IN
            SELECT tm.user_id
            FROM public.activity_participants ap
            JOIN public.tenant_members tm
              ON tm.tenant_id = ap.tenant_id AND tm.resident_id = ap.resident_id
            WHERE ap.tenant_id = v_act.tenant_id
              AND ap.activity_id = v_act.id
              AND ap.rsvp_status IN ('invited', 'attending')
              AND tm.status = 'active'
        LOOP
            PERFORM public._enqueue_notification(
                v_act.tenant_id, v_recipient.user_id, 'activity.cancelled', 'activity', v_act.id,
                'Kegiatan dibatalkan',
                format('Kegiatan "%s" yang Anda ikuti telah dibatalkan.', v_act.title)
            );
        END LOOP;
    END IF;
END;
$$;

ALTER FUNCTION public.transition_activity_status(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.transition_activity_status(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.transition_activity_status(uuid, text) TO authenticated;

-- 7.9 upsert_ronda_schedule_with_roster → notify every currently-assigned resident
CREATE OR REPLACE FUNCTION public.upsert_ronda_schedule_with_roster(
    p_tenant_id uuid,
    p_schedule_date date,
    p_resident_ids uuid[],
    p_schedule_id uuid DEFAULT NULL,
    p_shift_label text DEFAULT 'Ronda Malam',
    p_start_time time DEFAULT '22:00:00',
    p_end_time time DEFAULT '04:00:00',
    p_meeting_point text DEFAULT NULL,
    p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_tenant record;
    v_existing record;
    v_schedule_id uuid;
    v_shift_label text;
    v_meeting_point text;
    v_notes text;
    v_distinct_count integer;
    v_valid_count integer;
    v_added_count integer := 0;
    v_removed_count integer := 0;
    v_assigned_count integer := 0;
    v_action text;
    v_recipient record;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    IF p_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Tenant wajib diisi' USING ERRCODE = '22023';
    END IF;

    SELECT t.id, t.status, t.deleted_at
    INTO v_tenant
    FROM public.tenants t
    WHERE t.id = p_tenant_id;

    IF NOT FOUND OR v_tenant.deleted_at IS NOT NULL OR v_tenant.status <> 'active' THEN
        RAISE EXCEPTION 'Tenant tidak aktif atau tidak ditemukan' USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.has_tenant_role(p_tenant_id, ARRAY['ketua_rt', 'sekretaris']) THEN
        RAISE EXCEPTION 'Forbidden: hanya ketua_rt atau sekretaris yang dapat mengelola jadwal ronda'
            USING ERRCODE = '42501';
    END IF;

    IF p_schedule_date IS NULL THEN
        RAISE EXCEPTION 'Tanggal jadwal ronda wajib diisi' USING ERRCODE = '22023';
    END IF;

    IF p_start_time IS NULL OR p_end_time IS NULL OR p_start_time IS NOT DISTINCT FROM p_end_time THEN
        RAISE EXCEPTION 'Jam mulai dan selesai ronda tidak valid' USING ERRCODE = '22023';
    END IF;

    v_shift_label := COALESCE(NULLIF(btrim(COALESCE(p_shift_label, '')), ''), 'Ronda Malam');
    IF char_length(v_shift_label) > 100 THEN
        RAISE EXCEPTION 'Label shift maksimal 100 karakter' USING ERRCODE = '22023';
    END IF;

    v_meeting_point := NULLIF(btrim(COALESCE(p_meeting_point, '')), '');
    IF v_meeting_point IS NOT NULL AND char_length(v_meeting_point) > 200 THEN
        RAISE EXCEPTION 'Titik kumpul maksimal 200 karakter' USING ERRCODE = '22023';
    END IF;

    v_notes := NULLIF(btrim(COALESCE(p_notes, '')), '');
    IF v_notes IS NOT NULL AND char_length(v_notes) > 1000 THEN
        RAISE EXCEPTION 'Catatan jadwal maksimal 1000 karakter' USING ERRCODE = '22023';
    END IF;

    IF p_resident_ids IS NULL OR COALESCE(array_length(p_resident_ids, 1), 0) = 0 THEN
        RAISE EXCEPTION 'Minimal satu warga aktif harus ditugaskan pada jadwal ronda'
            USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM unnest(p_resident_ids) AS u(rid)
        WHERE u.rid IS NULL
    ) THEN
        RAISE EXCEPTION 'ID warga tidak boleh kosong' USING ERRCODE = '22023';
    END IF;

    SELECT count(DISTINCT u.rid)::integer
    INTO v_distinct_count
    FROM unnest(p_resident_ids) AS u(rid);

    IF v_distinct_count <> cardinality(p_resident_ids) THEN
        RAISE EXCEPTION 'Duplikasi warga pada jadwal yang sama tidak diperbolehkan'
            USING ERRCODE = '23505';
    END IF;

    -- Lock schedule/date deterministically to serialize concurrent creates/updates
    IF p_schedule_id IS NOT NULL THEN
        SELECT s.*
        INTO v_existing
        FROM public.ronda_schedules s
        WHERE s.id = p_schedule_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Jadwal ronda tidak ditemukan' USING ERRCODE = 'P0002';
        END IF;

        IF v_existing.tenant_id <> p_tenant_id THEN
            RAISE EXCEPTION 'Forbidden: jadwal ronda bukan milik tenant ini'
                USING ERRCODE = '42501';
        END IF;

        PERFORM pg_advisory_xact_lock(
            hashtextextended('ronda_schedule:' || p_tenant_id::text || ':' || p_schedule_date::text, 0)
        );
    ELSE
        PERFORM pg_advisory_xact_lock(
            hashtextextended('ronda_schedule:' || p_tenant_id::text || ':' || p_schedule_date::text, 0)
        );
    END IF;

    -- Validate all assigned residents belong to this tenant, are active, and have active households
    SELECT count(*)::integer
    INTO v_valid_count
    FROM public.residents r
    JOIN public.households h
      ON h.id = r.household_id
     AND h.tenant_id = r.tenant_id
     AND h.deleted_at IS NULL
    WHERE r.tenant_id = p_tenant_id
      AND r.deleted_at IS NULL
      AND r.residency_status = 'aktif'
      AND r.id = ANY(p_resident_ids);

    IF v_valid_count <> cardinality(p_resident_ids) THEN
        RAISE EXCEPTION 'Sebagian warga tidak ditemukan, tidak aktif, atau berasal dari tenant lain'
            USING ERRCODE = '23503';
    END IF;

    IF p_schedule_id IS NULL THEN
        INSERT INTO public.ronda_schedules (
            tenant_id,
            schedule_date,
            shift_label,
            start_time,
            end_time,
            meeting_point,
            notes,
            created_by,
            updated_by
        )
        VALUES (
            p_tenant_id,
            p_schedule_date,
            v_shift_label,
            p_start_time,
            p_end_time,
            v_meeting_point,
            v_notes,
            v_actor,
            v_actor
        )
        RETURNING id INTO v_schedule_id;

        v_action := 'ronda_schedule.created';
    ELSE
        UPDATE public.ronda_schedules s
           SET schedule_date = p_schedule_date,
               shift_label = v_shift_label,
               start_time = p_start_time,
               end_time = p_end_time,
               meeting_point = v_meeting_point,
               notes = v_notes,
               updated_by = v_actor
         WHERE s.id = p_schedule_id
           AND s.tenant_id = p_tenant_id
        RETURNING s.id INTO v_schedule_id;

        v_action := 'ronda_schedule.updated';

        -- Remove active-resident assignments no longer in the submitted roster,
        -- keeping historical detached rows (resident_id IS NULL) intact.
        WITH deleted_rows AS (
            DELETE FROM public.ronda_assignments a
             WHERE a.tenant_id = p_tenant_id
               AND a.schedule_id = v_schedule_id
               AND a.resident_id IS NOT NULL
               AND NOT (a.resident_id = ANY(p_resident_ids))
            RETURNING a.id
        )
        SELECT count(*)::integer INTO v_removed_count FROM deleted_rows;
    END IF;

    -- Insert only newly added residents so existing assignments keep their snapshots & attendance
    WITH inserted_rows AS (
        INSERT INTO public.ronda_assignments (
            tenant_id,
            schedule_id,
            resident_id,
            resident_name_snapshot,
            household_label_snapshot,
            created_by
        )
        SELECT
            p_tenant_id,
            v_schedule_id,
            r.id,
            left(btrim(r.full_name), 200),
            left(
                COALESCE(
                    NULLIF(btrim(h.block_unit), ''),
                    NULLIF(btrim(h.address), ''),
                    'Warga RT'
                ),
                200
            ),
            v_actor
        FROM public.residents r
        JOIN public.households h
          ON h.id = r.household_id
         AND h.tenant_id = r.tenant_id
         AND h.deleted_at IS NULL
        WHERE r.tenant_id = p_tenant_id
          AND r.deleted_at IS NULL
          AND r.residency_status = 'aktif'
          AND r.id = ANY(p_resident_ids)
          AND NOT EXISTS (
              SELECT 1
              FROM public.ronda_assignments existing
              WHERE existing.tenant_id = p_tenant_id
                AND existing.schedule_id = v_schedule_id
                AND existing.resident_id = r.id
          )
        RETURNING id
    )
    SELECT count(*)::integer INTO v_added_count FROM inserted_rows;

    SELECT count(*)::integer
    INTO v_assigned_count
    FROM public.ronda_assignments a
    WHERE a.tenant_id = p_tenant_id
      AND a.schedule_id = v_schedule_id;

    INSERT INTO public.audit_logs (
        tenant_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
    )
    VALUES (
        p_tenant_id,
        v_actor,
        v_action,
        'ronda_schedules',
        v_schedule_id,
        jsonb_build_object(
            'schedule_date', p_schedule_date,
            'shift_label', v_shift_label,
            'assigned_count', v_assigned_count,
            'added_count', v_added_count,
            'removed_count', v_removed_count
        )
    );

    -- Notify every currently-assigned resident. Idempotency key (schedule_id +
    -- recipient) means a resident already notified by a prior upsert of this
    -- same schedule is safely skipped on a later edit; a newly-added resident
    -- gets their first notification naturally.
    FOR v_recipient IN
        SELECT DISTINCT tm.user_id
        FROM public.ronda_assignments a
        JOIN public.tenant_members tm
          ON tm.tenant_id = a.tenant_id AND tm.resident_id = a.resident_id
        WHERE a.tenant_id = p_tenant_id
          AND a.schedule_id = v_schedule_id
          AND a.resident_id IS NOT NULL
          AND tm.status = 'active'
    LOOP
        PERFORM public._enqueue_notification(
            p_tenant_id, v_recipient.user_id, 'ronda_schedule.assigned', 'ronda_schedule', v_schedule_id,
            'Jadwal ronda: ' || v_shift_label,
            format('Anda bertugas ronda pada %s pukul %s.', to_char(p_schedule_date, 'DD Mon YYYY'), p_start_time)
        );
    END LOOP;

    RETURN jsonb_build_object(
        'id', v_schedule_id,
        'tenant_id', p_tenant_id,
        'schedule_date', p_schedule_date,
        'shift_label', v_shift_label,
        'start_time', p_start_time,
        'end_time', p_end_time,
        'meeting_point', v_meeting_point,
        'notes', v_notes,
        'assigned_count', v_assigned_count
    );
END;
$$;

ALTER FUNCTION public.upsert_ronda_schedule_with_roster(
    uuid, date, uuid[], uuid, text, time, time, text, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.upsert_ronda_schedule_with_roster(
    uuid, date, uuid[], uuid, text, time, time, text, text
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_ronda_schedule_with_roster(
    uuid, date, uuid[], uuid, text, time, time, text, text
) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. notify_complaint_reply — Shape B, direction-aware fan-out
-- ---------------------------------------------------------------------------
-- A reply's direction determines its recipient: if the author is staff, the
-- reporter is notified; if the author is the reporter, every active staff
-- member (ketua_rt/sekretaris/pengurus) in the tenant is notified. This re-
-- validates the author's role itself rather than trusting a scope flag from
-- the caller.

CREATE OR REPLACE FUNCTION public.notify_complaint_reply(p_reply_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_reply record;
    v_complaint record;
    v_author_is_staff boolean;
    v_recipient record;
    v_count integer := 0;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_reply FROM public.complaint_replies cr WHERE cr.id = p_reply_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Complaint reply % not found', p_reply_id USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO v_complaint
    FROM public.complaints c
    WHERE c.id = v_reply.complaint_id AND c.tenant_id = v_reply.tenant_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Complaint % not found for reply %', v_reply.complaint_id, p_reply_id
            USING ERRCODE = 'P0002';
    END IF;

    -- The caller must be either the reply's own author or a staff member of
    -- this tenant — never an arbitrary caller asking to re-fire someone else's
    -- reply notification.
    IF NOT (
        public.has_tenant_role(v_reply.tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
        OR EXISTS (
            SELECT 1 FROM public.tenant_members tm
            WHERE tm.id = v_reply.author_member_id
              AND tm.tenant_id = v_reply.tenant_id
              AND tm.user_id = v_actor
        )
    ) THEN
        RAISE EXCEPTION 'Forbidden: caller is neither the reply author nor tenant staff'
            USING ERRCODE = '42501';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.member_roles mr
        JOIN public.roles r ON r.id = mr.role_id
        WHERE mr.member_id = v_reply.author_member_id
          AND mr.tenant_id = v_reply.tenant_id
          AND r.code IN ('ketua_rt', 'sekretaris', 'pengurus')
    ) INTO v_author_is_staff;

    IF v_author_is_staff THEN
        -- Staff replied: notify the reporter.
        FOR v_recipient IN
            SELECT tm.user_id FROM public.tenant_members tm
            WHERE tm.id = v_complaint.reporter_member_id
              AND tm.tenant_id = v_complaint.tenant_id
              AND tm.status = 'active'
        LOOP
            PERFORM public._enqueue_notification(
                v_complaint.tenant_id, v_recipient.user_id, 'complaint.reply', 'complaint', v_complaint.id,
                'Balasan baru pada pengaduan Anda',
                format('Pengurus RT membalas pengaduan "%s" Anda.', v_complaint.title)
            );
            v_count := v_count + 1;
        END LOOP;
    ELSE
        -- Reporter replied: notify every active staff member in the tenant.
        FOR v_recipient IN
            SELECT DISTINCT tm.user_id
            FROM public.tenant_members tm
            JOIN public.member_roles mr ON mr.member_id = tm.id AND mr.tenant_id = tm.tenant_id
            JOIN public.roles r ON r.id = mr.role_id
            WHERE tm.tenant_id = v_complaint.tenant_id
              AND tm.status = 'active'
              AND r.code IN ('ketua_rt', 'sekretaris', 'pengurus')
        LOOP
            PERFORM public._enqueue_notification(
                v_complaint.tenant_id, v_recipient.user_id, 'complaint.reply', 'complaint', v_complaint.id,
                'Balasan baru pada pengaduan warga',
                format('Warga membalas pengaduan "%s".', v_complaint.title)
            );
            v_count := v_count + 1;
        END LOOP;
    END IF;

    RETURN v_count;
END;
$$;

ALTER FUNCTION public.notify_complaint_reply(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.notify_complaint_reply(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.notify_complaint_reply(uuid) TO authenticated;

COMMIT;
