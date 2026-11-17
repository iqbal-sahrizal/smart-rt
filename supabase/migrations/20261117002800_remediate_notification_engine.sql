-- =============================================================================
-- Central Notification Engine — Final Remediation Migration
--
-- Addresses all 6 defects identified during Final Verification:
--   1. P0 — Automatic Outbox Runner (pg_cron + pg_net + Vault dispatch helper)
--   2. P0 — Shape B Transaction Reliability (durable in-tx triggers on bills,
--           announcements/announcement_recipients, and complaint_replies)
--   3. P1 — Idempotency fixes (complaint.reply uses reply_id; payment.* use
--           payment/refund id; ronda_schedule uses schedule content fingerprint)
--   4. P1 — Lease Recovery (locked_at, lease_expires_at, claim_token fencing,
--           dead-letter reaping of expired processing leases)
--   5. P1 — Community Feed integration (4 events wired via _enqueue_notification)
--   6. P2 — Admin Deep Link (target_scope on notification_outbox derived from
--           validated server-side role/recipient context)
--
-- CONSTRAINTS HONORED:
--   - Additive migration only; no prior migration file modified.
--   - Existing RLS policies remain untouched and strict.
--   - No secrets hardcoded or printed in SQL.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Schema additions on notification_outbox (Lease recovery + target_scope)
-- ---------------------------------------------------------------------------

ALTER TABLE public.notification_outbox
    ADD COLUMN IF NOT EXISTS locked_at timestamptz NULL,
    ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz NULL,
    ADD COLUMN IF NOT EXISTS claim_token uuid NULL,
    ADD COLUMN IF NOT EXISTS target_scope text NOT NULL DEFAULT 'resident'
        CONSTRAINT chk_notification_outbox_target_scope CHECK (
            target_scope IN ('resident', 'admin')
        );

CREATE INDEX IF NOT EXISTS idx_notification_outbox_processing_lease
    ON public.notification_outbox (lease_expires_at)
    WHERE status = 'processing' AND lease_expires_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. _enqueue_notification — supports custom idempotency_key + target_scope
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public._enqueue_notification(uuid, uuid, text, text, uuid, text, text);

CREATE OR REPLACE FUNCTION public._enqueue_notification(
    p_tenant_id uuid,
    p_recipient_user_id uuid,
    p_event_type text,
    p_reference_type text,
    p_reference_id uuid,
    p_title text,
    p_body text,
    p_idempotency_key text DEFAULT NULL,
    p_target_scope text DEFAULT 'resident'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_idempotency_key text;
    v_scope text;
    v_outbox_id uuid;
    v_notification_id uuid;
BEGIN
    -- Fail closed: never enqueue for a user who is not an active member of
    -- this exact tenant.
    IF NOT EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = p_tenant_id
          AND tm.user_id = p_recipient_user_id
          AND tm.status = 'active'
    ) THEN
        RETURN;
    END IF;

    v_scope := CASE WHEN p_target_scope = 'admin' THEN 'admin' ELSE 'resident' END;
    v_idempotency_key := COALESCE(
        NULLIF(btrim(p_idempotency_key), ''),
        p_event_type || ':' || COALESCE(p_reference_id::text, 'none') || ':' || p_recipient_user_id::text
    );

    INSERT INTO public.notification_outbox (
        tenant_id, recipient_user_id, event_type,
        reference_type, reference_id, target_scope, title, body, idempotency_key
    )
    VALUES (
        p_tenant_id, p_recipient_user_id, p_event_type,
        p_reference_type, p_reference_id, v_scope, p_title, p_body, v_idempotency_key
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

ALTER FUNCTION public._enqueue_notification(uuid, uuid, text, text, uuid, text, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._enqueue_notification(uuid, uuid, text, text, uuid, text, text, text, text)
    FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Lease recovery + atomic claim + claim_token fencing (service_role ONLY)
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.claim_pending_notification_outbox_batch(integer);

CREATE OR REPLACE FUNCTION public.claim_pending_notification_outbox_batch(
    p_limit integer DEFAULT 20,
    p_lease_seconds integer DEFAULT 120
)
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

    IF p_lease_seconds IS NULL OR p_lease_seconds < 10 OR p_lease_seconds > 3600 THEN
        RAISE EXCEPTION 'p_lease_seconds must be between 10 and 3600' USING ERRCODE = '22023';
    END IF;

    -- Reap expired processing leases that have exhausted max_attempts so
    -- repeated worker crashes cannot loop forever.
    UPDATE public.notification_outbox
    SET status = 'dead',
        attempt_count = attempt_count + 1,
        last_error = COALESCE(last_error, 'Max attempts exceeded after worker lease expiration'),
        locked_at = NULL,
        lease_expires_at = NULL,
        claim_token = NULL,
        updated_at = now()
    WHERE status = 'processing'
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at <= now()
      AND attempt_count + 1 >= max_attempts;

    RETURN QUERY
    WITH candidates AS (
        SELECT id
        FROM public.notification_outbox
        WHERE (status IN ('pending', 'failed') AND next_attempt_at <= now())
           OR (
               status = 'processing'
               AND lease_expires_at IS NOT NULL
               AND lease_expires_at <= now()
               AND attempt_count + 1 < max_attempts
           )
        ORDER BY next_attempt_at ASC NULLS LAST, created_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.notification_outbox o
    SET attempt_count = CASE
            WHEN o.status = 'processing' THEN o.attempt_count + 1
            ELSE o.attempt_count
        END,
        last_error = CASE
            WHEN o.status = 'processing' THEN COALESCE(o.last_error, 'Recovered after worker lease expiration')
            ELSE o.last_error
        END,
        status = 'processing',
        locked_at = now(),
        claimed_at = now(),
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        claim_token = gen_random_uuid(),
        updated_at = now()
    FROM candidates c
    WHERE o.id = c.id
    RETURNING o.*;
END;
$$;

ALTER FUNCTION public.claim_pending_notification_outbox_batch(integer, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_pending_notification_outbox_batch(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_notification_outbox_batch(integer, integer) TO service_role;

DROP FUNCTION IF EXISTS public.record_notification_outbox_result(uuid, boolean, text);

CREATE OR REPLACE FUNCTION public.record_notification_outbox_result(
    p_outbox_id uuid,
    p_success boolean,
    p_error text DEFAULT NULL,
    p_claim_token uuid DEFAULT NULL
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

    -- Fencing: ignore completions for rows no longer processing or owned by a
    -- newer worker claim_token after lease recovery.
    IF v_row.status IS DISTINCT FROM 'processing' THEN
        RETURN;
    END IF;
    IF p_claim_token IS NOT NULL AND v_row.claim_token IS DISTINCT FROM p_claim_token THEN
        RETURN;
    END IF;

    IF p_success THEN
        UPDATE public.notification_outbox
        SET status = 'sent',
            sent_at = now(),
            updated_at = now(),
            last_error = NULL,
            locked_at = NULL,
            lease_expires_at = NULL,
            claim_token = NULL
        WHERE id = p_outbox_id;
        RETURN;
    END IF;

    IF v_row.attempt_count + 1 >= v_row.max_attempts THEN
        UPDATE public.notification_outbox
        SET status = 'dead',
            attempt_count = attempt_count + 1,
            last_error = p_error,
            locked_at = NULL,
            lease_expires_at = NULL,
            claim_token = NULL,
            updated_at = now()
        WHERE id = p_outbox_id;
    ELSE
        v_backoff_seconds := LEAST(3600, (power(2, v_row.attempt_count + 1) * 30)::integer);
        UPDATE public.notification_outbox
        SET status = 'failed',
            attempt_count = attempt_count + 1,
            next_attempt_at = now() + make_interval(secs => v_backoff_seconds),
            last_error = p_error,
            locked_at = NULL,
            lease_expires_at = NULL,
            claim_token = NULL,
            updated_at = now()
        WHERE id = p_outbox_id;
    END IF;
END;
$$;

ALTER FUNCTION public.record_notification_outbox_result(uuid, boolean, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_notification_outbox_result(uuid, boolean, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_notification_outbox_result(uuid, boolean, text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. P1 Idempotency fixes on Payment & Ronda Shape A RPCs
-- ---------------------------------------------------------------------------

-- 4.1 verify_payment: idempotency key uses v_pay.id so multiple partial
--     payments on the same bill each notify independently.
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
            format('Pembayaran tagihan %s/%s Anda telah diverifikasi.', v_bill.period_year, lpad(v_bill.period_month::text, 2, '0')),
            'payment.verified:' || v_pay.id::text || ':' || v_recipient.user_id::text,
            'resident'
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

-- 4.2 reject_payment: idempotency key uses v_pay.id
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
            format('Pembayaran tagihan %s/%s Anda ditolak: %s', v_bill.period_year, lpad(v_bill.period_month::text, 2, '0'), btrim(p_reason)),
            'payment.rejected:' || v_pay.id::text || ':' || v_recipient.user_id::text,
            'resident'
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

-- 4.3 refund_payment: idempotency key uses v_refund_id
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
            format('Refund sebesar %s untuk tagihan %s/%s Anda telah diproses.', p_amount, v_bill.period_year, lpad(v_bill.period_month::text, 2, '0')),
            'payment.refunded:' || v_refund_id::text || ':' || v_recipient.user_id::text,
            'resident'
        );
    END LOOP;

    RETURN v_refund_id;
END;
$$;

-- 4.4 upsert_ronda_schedule_with_roster: idempotency key includes schedule
--     content fingerprint so meaningful schedule changes (date/shift/time/
--     meeting_point) produce a new notification while identical saves deduplicate.
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
    v_schedule_fingerprint text;
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
            tenant_id, schedule_date, shift_label, start_time, end_time,
            meeting_point, notes, created_by, updated_by
        )
        VALUES (
            p_tenant_id, p_schedule_date, v_shift_label, p_start_time, p_end_time,
            v_meeting_point, v_notes, v_actor, v_actor
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

    WITH inserted_rows AS (
        INSERT INTO public.ronda_assignments (
            tenant_id, schedule_id, resident_id,
            resident_name_snapshot, household_label_snapshot, created_by
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
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
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

    v_schedule_fingerprint := md5(
        p_schedule_date::text || '|' ||
        v_shift_label || '|' ||
        p_start_time::text || '|' ||
        p_end_time::text || '|' ||
        COALESCE(v_meeting_point, '')
    );

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
            format('Anda bertugas ronda pada %s pukul %s.', to_char(p_schedule_date, 'DD Mon YYYY'), p_start_time),
            'ronda_schedule.assigned:' || v_schedule_id::text || ':' || v_schedule_fingerprint || ':' || v_recipient.user_id::text,
            'resident'
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

-- ---------------------------------------------------------------------------
-- 5. Shape B Durable In-Transaction Helpers & Triggers + P2 Admin Deep Link
-- ---------------------------------------------------------------------------

-- 5.1 Bills
CREATE OR REPLACE FUNCTION public._enqueue_bill_issued_for_row(p_bill_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_bill record;
    v_due record;
    v_title text;
    v_body text;
    v_count integer := 0;
    v_recipient record;
BEGIN
    SELECT * INTO v_bill FROM public.bills b WHERE b.id = p_bill_id;
    IF NOT FOUND OR v_bill.status = 'cancelled' THEN
        RETURN 0;
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
                v_bill.tenant_id, v_recipient.user_id, 'bill.issued', 'bill', p_bill_id,
                v_title, v_body,
                'bill.issued:' || p_bill_id::text || ':' || v_recipient.user_id::text,
                'resident'
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
                v_bill.tenant_id, v_recipient.user_id, 'bill.issued', 'bill', p_bill_id,
                v_title, v_body,
                'bill.issued:' || p_bill_id::text || ':' || v_recipient.user_id::text,
                'resident'
            );
            v_count := v_count + 1;
        END LOOP;
    END IF;

    RETURN v_count;
END;
$$;

ALTER FUNCTION public._enqueue_bill_issued_for_row(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._enqueue_bill_issued_for_row(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._trg_bills_enqueue_issued()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM 'cancelled' THEN
        PERFORM public._enqueue_bill_issued_for_row(NEW.id);
    END IF;
    RETURN NEW;
END;
$$;

ALTER FUNCTION public._trg_bills_enqueue_issued() OWNER TO postgres;
REVOKE ALL ON FUNCTION public._trg_bills_enqueue_issued() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_bills_enqueue_notification ON public.bills;
CREATE TRIGGER trg_bills_enqueue_notification
    AFTER INSERT ON public.bills
    FOR EACH ROW
    EXECUTE FUNCTION public._trg_bills_enqueue_issued();

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

    RETURN public._enqueue_bill_issued_for_row(p_bill_id);
END;
$$;

-- 5.2 Complaint replies (uses p_reply_id for idempotency + target_scope for admin/resident)
CREATE OR REPLACE FUNCTION public._enqueue_complaint_reply_for_row(p_reply_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_reply record;
    v_complaint record;
    v_author_is_staff boolean;
    v_recipient record;
    v_count integer := 0;
BEGIN
    SELECT * INTO v_reply FROM public.complaint_replies cr WHERE cr.id = p_reply_id;
    IF NOT FOUND THEN
        RETURN 0;
    END IF;

    SELECT * INTO v_complaint
    FROM public.complaints c
    WHERE c.id = v_reply.complaint_id AND c.tenant_id = v_reply.tenant_id;
    IF NOT FOUND THEN
        RETURN 0;
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
        FOR v_recipient IN
            SELECT tm.user_id FROM public.tenant_members tm
            WHERE tm.id = v_complaint.reporter_member_id
              AND tm.tenant_id = v_complaint.tenant_id
              AND tm.status = 'active'
        LOOP
            PERFORM public._enqueue_notification(
                v_complaint.tenant_id, v_recipient.user_id, 'complaint.reply', 'complaint', v_complaint.id,
                'Balasan baru pada pengaduan Anda',
                format('Pengurus RT membalas pengaduan "%s" Anda.', v_complaint.title),
                'complaint.reply:' || v_reply.id::text || ':' || v_recipient.user_id::text,
                'resident'
            );
            v_count := v_count + 1;
        END LOOP;
    ELSE
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
                format('Warga membalas pengaduan "%s".', v_complaint.title),
                'complaint.reply:' || v_reply.id::text || ':' || v_recipient.user_id::text,
                'admin'
            );
            v_count := v_count + 1;
        END LOOP;
    END IF;

    RETURN v_count;
END;
$$;

ALTER FUNCTION public._enqueue_complaint_reply_for_row(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._enqueue_complaint_reply_for_row(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._trg_complaint_replies_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public._enqueue_complaint_reply_for_row(NEW.id);
    RETURN NEW;
END;
$$;

ALTER FUNCTION public._trg_complaint_replies_enqueue() OWNER TO postgres;
REVOKE ALL ON FUNCTION public._trg_complaint_replies_enqueue() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_complaint_replies_enqueue_notification ON public.complaint_replies;
CREATE TRIGGER trg_complaint_replies_enqueue_notification
    AFTER INSERT ON public.complaint_replies
    FOR EACH ROW
    EXECUTE FUNCTION public._trg_complaint_replies_enqueue();

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
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_reply FROM public.complaint_replies cr WHERE cr.id = p_reply_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Complaint reply % not found', p_reply_id USING ERRCODE = 'P0002';
    END IF;

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

    RETURN public._enqueue_complaint_reply_for_row(p_reply_id);
END;
$$;

-- 5.3 Announcements (durable triggers on announcements + announcement_recipients)
CREATE OR REPLACE FUNCTION public._enqueue_announcement_for_row(p_announcement_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ann record;
    v_title text;
    v_body text;
    v_count integer := 0;
    v_recipient record;
    v_has_targeted_rows boolean;
BEGIN
    SELECT * INTO v_ann FROM public.announcements a WHERE a.id = p_announcement_id AND a.deleted_at IS NULL;
    IF NOT FOUND OR v_ann.status <> 'published' THEN
        RETURN 0;
    END IF;

    v_title := 'Pengumuman: ' || v_ann.title;
    v_body := left(v_ann.content, 150);

    SELECT EXISTS(
        SELECT 1 FROM public.announcement_recipients r WHERE r.announcement_id = p_announcement_id
    ) INTO v_has_targeted_rows;

    IF v_ann.target_type = 'all' OR NOT v_has_targeted_rows THEN
        IF v_ann.target_type <> 'all' THEN
            RETURN 0;
        END IF;

        FOR v_recipient IN
            SELECT tm.user_id
            FROM public.tenant_members tm
            WHERE tm.tenant_id = v_ann.tenant_id AND tm.status = 'active'
        LOOP
            PERFORM public._enqueue_notification(
                v_ann.tenant_id, v_recipient.user_id, 'announcement.published',
                'announcement', p_announcement_id, v_title, v_body,
                'announcement.published:' || p_announcement_id::text || ':' || v_recipient.user_id::text,
                'resident'
            );
            v_count := v_count + 1;
        END LOOP;
    ELSE
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
                'announcement', p_announcement_id, v_title, v_body,
                'announcement.published:' || p_announcement_id::text || ':' || v_recipient.user_id::text,
                'resident'
            );
            v_count := v_count + 1;
        END LOOP;
    END IF;

    RETURN v_count;
END;
$$;

ALTER FUNCTION public._enqueue_announcement_for_row(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._enqueue_announcement_for_row(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._trg_announcements_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.status = 'published' AND NEW.deleted_at IS NULL THEN
        PERFORM public._enqueue_announcement_for_row(NEW.id);
    END IF;
    RETURN NEW;
END;
$$;

ALTER FUNCTION public._trg_announcements_enqueue() OWNER TO postgres;
REVOKE ALL ON FUNCTION public._trg_announcements_enqueue() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_announcements_enqueue_notification ON public.announcements;
CREATE TRIGGER trg_announcements_enqueue_notification
    AFTER INSERT OR UPDATE OF status, target_type ON public.announcements
    FOR EACH ROW
    EXECUTE FUNCTION public._trg_announcements_enqueue();

CREATE OR REPLACE FUNCTION public._trg_announcement_recipients_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ann record;
    v_title text;
    v_body text;
    v_recipient record;
BEGIN
    SELECT * INTO v_ann
    FROM public.announcements a
    WHERE a.id = NEW.announcement_id
      AND a.deleted_at IS NULL
      AND a.status = 'published';

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    v_title := 'Pengumuman: ' || v_ann.title;
    v_body := left(v_ann.content, 150);

    FOR v_recipient IN
        SELECT DISTINCT tm.user_id
        FROM public.tenant_members tm
        WHERE tm.tenant_id = NEW.tenant_id
          AND tm.status = 'active'
          AND (
              (NEW.role_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM public.member_roles mr
                  WHERE mr.member_id = tm.id AND mr.role_id = NEW.role_id
              ))
              OR
              (NEW.household_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM public.residents res
                  WHERE res.id = tm.resident_id
                    AND res.household_id = NEW.household_id
                    AND res.deleted_at IS NULL
              ))
          )
    LOOP
        PERFORM public._enqueue_notification(
            v_ann.tenant_id, v_recipient.user_id, 'announcement.published',
            'announcement', v_ann.id, v_title, v_body,
            'announcement.published:' || v_ann.id::text || ':' || v_recipient.user_id::text,
            'resident'
        );
    END LOOP;

    RETURN NEW;
END;
$$;

ALTER FUNCTION public._trg_announcement_recipients_enqueue() OWNER TO postgres;
REVOKE ALL ON FUNCTION public._trg_announcement_recipients_enqueue() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_announcement_recipients_enqueue_notification ON public.announcement_recipients;
CREATE TRIGGER trg_announcement_recipients_enqueue_notification
    AFTER INSERT ON public.announcement_recipients
    FOR EACH ROW
    EXECUTE FUNCTION public._trg_announcement_recipients_enqueue();

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

    RETURN public._enqueue_announcement_for_row(p_announcement_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. P1 Community Feed integration (4 events routed through _enqueue_notification)
-- ---------------------------------------------------------------------------

-- 6.1 create_community_post_comment (events: community_comment, community_comment_reply)
CREATE OR REPLACE FUNCTION public.create_community_post_comment(
    p_tenant_id uuid,
    p_post_id uuid,
    p_content text,
    p_parent_comment_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_member_id uuid;
    v_clean_content text := btrim(COALESCE(p_content, ''));
    v_post public.community_posts%ROWTYPE;
    v_parent_comment public.community_post_comments%ROWTYPE;
    v_comment_id uuid;
    v_comment_count integer;
    v_commenter_name text;
    v_post_author_user_id uuid;
    v_parent_author_user_id uuid;
    v_preview text;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated caller' USING ERRCODE = '28000';
    END IF;

    v_member_id := public.get_my_member_id(p_tenant_id);
    IF v_member_id IS NULL THEN
        RAISE EXCEPTION 'Forbidden: caller is not an active member of this tenant'
            USING ERRCODE = '42501';
    END IF;

    IF v_clean_content = '' OR char_length(v_clean_content) > 1000 THEN
        RAISE EXCEPTION 'Comment content must be between 1 and 1000 characters'
            USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_post
    FROM public.community_posts
    WHERE id = p_post_id
      AND tenant_id = p_tenant_id
      AND deleted_at IS NULL
      AND moderation_status = 'published'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Community post not found or unavailable' USING ERRCODE = 'P0002';
    END IF;

    IF p_parent_comment_id IS NOT NULL THEN
        SELECT *
        INTO v_parent_comment
        FROM public.community_post_comments
        WHERE id = p_parent_comment_id
          AND tenant_id = p_tenant_id
          AND post_id = p_post_id
          AND deleted_at IS NULL
          AND moderation_status = 'published';

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Parent comment not found in this post' USING ERRCODE = 'P0002';
        END IF;
    END IF;

    INSERT INTO public.community_post_comments (
        tenant_id, post_id, author_member_id, parent_comment_id, content, moderation_status
    )
    VALUES (
        p_tenant_id, p_post_id, v_member_id, p_parent_comment_id, v_clean_content, 'published'
    )
    RETURNING id INTO v_comment_id;

    SELECT count(*)::integer
    INTO v_comment_count
    FROM public.community_post_comments
    WHERE post_id = p_post_id
      AND tenant_id = p_tenant_id
      AND deleted_at IS NULL
      AND moderation_status = 'published';

    UPDATE public.community_posts
    SET comment_count = v_comment_count
    WHERE id = p_post_id
      AND tenant_id = p_tenant_id;

    v_commenter_name := public._community_get_member_display_name(p_tenant_id, v_member_id);
    v_preview := CASE
        WHEN char_length(v_clean_content) > 80 THEN left(v_clean_content, 80) || '…'
        ELSE v_clean_content
    END;

    SELECT tm.user_id
    INTO v_post_author_user_id
    FROM public.tenant_members tm
    WHERE tm.id = v_post.author_member_id
      AND tm.tenant_id = p_tenant_id
      AND tm.status = 'active';

    IF v_post_author_user_id IS NOT NULL AND v_post_author_user_id <> v_actor THEN
        PERFORM public._enqueue_notification(
            p_tenant_id,
            v_post_author_user_id,
            'community_comment',
            'community_post',
            p_post_id,
            'Komentar baru pada postingan Anda',
            v_commenter_name || ': "' || v_preview || '"',
            'community_comment:' || v_comment_id::text || ':' || v_post_author_user_id::text,
            'resident'
        );
    END IF;

    IF p_parent_comment_id IS NOT NULL THEN
        SELECT tm.user_id
        INTO v_parent_author_user_id
        FROM public.tenant_members tm
        WHERE tm.id = v_parent_comment.author_member_id
          AND tm.tenant_id = p_tenant_id
          AND tm.status = 'active';

        IF v_parent_author_user_id IS NOT NULL
           AND v_parent_author_user_id <> v_actor
           AND v_parent_author_user_id IS DISTINCT FROM v_post_author_user_id THEN
            PERFORM public._enqueue_notification(
                p_tenant_id,
                v_parent_author_user_id,
                'community_comment_reply',
                'community_post',
                p_post_id,
                'Balasan baru pada komentar Anda',
                v_commenter_name || ' membalas: "' || v_preview || '"',
                'community_comment_reply:' || v_comment_id::text || ':' || v_parent_author_user_id::text,
                'resident'
            );
        END IF;
    END IF;

    RETURN v_comment_id;
END;
$$;

-- 6.2 moderate_community_post (event: post hide/restore)
CREATE OR REPLACE FUNCTION public.moderate_community_post(
    p_tenant_id uuid,
    p_post_id uuid,
    p_action text,
    p_reason text DEFAULT NULL,
    p_report_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_member_id uuid;
    v_post public.community_posts%ROWTYPE;
    v_clean_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
    v_next_status text;
    v_author_user_id uuid;
    v_audit_id uuid;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated caller' USING ERRCODE = '28000';
    END IF;

    IF NOT public.has_tenant_role(p_tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus']) THEN
        RAISE EXCEPTION 'Forbidden: only Ketua RT, Sekretaris, or Pengurus may moderate community posts'
            USING ERRCODE = '42501';
    END IF;

    v_member_id := public.get_my_member_id(p_tenant_id);
    IF v_member_id IS NULL THEN
        RAISE EXCEPTION 'Forbidden: caller is not an active member of this tenant'
            USING ERRCODE = '42501';
    END IF;

    IF p_action NOT IN ('hide', 'restore') THEN
        RAISE EXCEPTION 'Invalid moderation action' USING ERRCODE = '22023';
    END IF;

    IF p_action = 'hide' AND (v_clean_reason IS NULL OR char_length(v_clean_reason) < 3) THEN
        RAISE EXCEPTION 'Moderation reason is required (minimum 3 characters) when hiding a post'
            USING ERRCODE = '22023';
    END IF;

    IF v_clean_reason IS NOT NULL AND char_length(v_clean_reason) > 500 THEN
        RAISE EXCEPTION 'Moderation reason exceeds 500 characters' USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_post
    FROM public.community_posts
    WHERE id = p_post_id
      AND tenant_id = p_tenant_id
      AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Community post not found' USING ERRCODE = 'P0002';
    END IF;

    v_next_status := CASE WHEN p_action = 'hide' THEN 'hidden' ELSE 'published' END;

    UPDATE public.community_posts
    SET moderation_status = v_next_status,
        moderated_by_member_id = v_member_id,
        moderated_at = now(),
        moderation_reason = v_clean_reason,
        updated_at = now()
    WHERE id = p_post_id
      AND tenant_id = p_tenant_id;

    IF p_action = 'hide' THEN
        UPDATE public.community_post_reports
        SET status = 'resolved_hidden',
            reviewed_by_member_id = v_member_id,
            reviewed_at = now(),
            resolution_note = v_clean_reason,
            updated_at = now()
        WHERE tenant_id = p_tenant_id
          AND target_type = 'post'
          AND post_id = p_post_id
          AND status = 'pending';
    ELSIF p_report_id IS NOT NULL THEN
        UPDATE public.community_post_reports
        SET status = 'dismissed',
            reviewed_by_member_id = v_member_id,
            reviewed_at = now(),
            resolution_note = COALESCE(v_clean_reason, 'Postingan dipulihkan oleh pengurus RT.'),
            updated_at = now()
        WHERE id = p_report_id
          AND tenant_id = p_tenant_id
          AND status = 'pending';
    END IF;

    INSERT INTO public.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    VALUES (
        p_tenant_id,
        v_actor,
        'community_post.moderated_' || p_action,
        'community_posts',
        p_post_id,
        jsonb_build_object(
            'post_id', p_post_id,
            'action', p_action,
            'moderation_status', v_next_status,
            'moderator_member_id', v_member_id,
            'report_id', p_report_id,
            'has_reason', (v_clean_reason IS NOT NULL)
        )
    )
    RETURNING id INTO v_audit_id;

    SELECT tm.user_id
    INTO v_author_user_id
    FROM public.tenant_members tm
    WHERE tm.id = v_post.author_member_id
      AND tm.tenant_id = p_tenant_id
      AND tm.status = 'active';

    IF v_author_user_id IS NOT NULL AND v_author_user_id <> v_actor THEN
        PERFORM public._enqueue_notification(
            p_tenant_id,
            v_author_user_id,
            'community_moderation',
            'community_post',
            p_post_id,
            CASE
                WHEN p_action = 'hide' THEN 'Postingan Anda disembunyikan oleh pengurus RT'
                ELSE 'Postingan Anda dipulihkan oleh pengurus RT'
            END,
            CASE
                WHEN p_action = 'hide' THEN 'Alasan: ' || COALESCE(v_clean_reason, 'Melanggar ketentuan komunitas.')
                ELSE COALESCE(v_clean_reason, 'Postingan Anda kembali ditampilkan pada feed warga.')
            END,
            'community_post.moderated_' || p_action || ':' || v_audit_id::text || ':' || v_author_user_id::text,
            'resident'
        );
    END IF;

    RETURN jsonb_build_object(
        'post_id', p_post_id,
        'moderation_status', v_next_status
    );
END;
$$;

-- 6.3 moderate_community_comment (event: comment hide/restore)
CREATE OR REPLACE FUNCTION public.moderate_community_comment(
    p_tenant_id uuid,
    p_comment_id uuid,
    p_action text,
    p_reason text DEFAULT NULL,
    p_report_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_member_id uuid;
    v_comment public.community_post_comments%ROWTYPE;
    v_clean_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
    v_next_status text;
    v_comment_count integer;
    v_author_user_id uuid;
    v_audit_id uuid;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated caller' USING ERRCODE = '28000';
    END IF;

    IF NOT public.has_tenant_role(p_tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus']) THEN
        RAISE EXCEPTION 'Forbidden: only Ketua RT, Sekretaris, or Pengurus may moderate community comments'
            USING ERRCODE = '42501';
    END IF;

    v_member_id := public.get_my_member_id(p_tenant_id);
    IF v_member_id IS NULL THEN
        RAISE EXCEPTION 'Forbidden: caller is not an active member of this tenant'
            USING ERRCODE = '42501';
    END IF;

    IF p_action NOT IN ('hide', 'restore') THEN
        RAISE EXCEPTION 'Invalid moderation action' USING ERRCODE = '22023';
    END IF;

    IF p_action = 'hide' AND (v_clean_reason IS NULL OR char_length(v_clean_reason) < 3) THEN
        RAISE EXCEPTION 'Moderation reason is required (minimum 3 characters) when hiding a comment'
            USING ERRCODE = '22023';
    END IF;

    IF v_clean_reason IS NOT NULL AND char_length(v_clean_reason) > 500 THEN
        RAISE EXCEPTION 'Moderation reason exceeds 500 characters' USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_comment
    FROM public.community_post_comments
    WHERE id = p_comment_id
      AND tenant_id = p_tenant_id
      AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Comment not found' USING ERRCODE = 'P0002';
    END IF;

    PERFORM 1
    FROM public.community_posts
    WHERE id = v_comment.post_id
      AND tenant_id = p_tenant_id
    FOR UPDATE;

    v_next_status := CASE WHEN p_action = 'hide' THEN 'hidden' ELSE 'published' END;

    UPDATE public.community_post_comments
    SET moderation_status = v_next_status,
        moderated_by_member_id = v_member_id,
        moderated_at = now(),
        moderation_reason = v_clean_reason,
        updated_at = now()
    WHERE id = p_comment_id
      AND tenant_id = p_tenant_id;

    SELECT count(*)::integer
    INTO v_comment_count
    FROM public.community_post_comments
    WHERE post_id = v_comment.post_id
      AND tenant_id = p_tenant_id
      AND deleted_at IS NULL
      AND moderation_status = 'published';

    UPDATE public.community_posts
    SET comment_count = v_comment_count
    WHERE id = v_comment.post_id
      AND tenant_id = p_tenant_id;

    IF p_action = 'hide' THEN
        UPDATE public.community_post_reports
        SET status = 'resolved_hidden',
            reviewed_by_member_id = v_member_id,
            reviewed_at = now(),
            resolution_note = v_clean_reason,
            updated_at = now()
        WHERE tenant_id = p_tenant_id
          AND target_type = 'comment'
          AND comment_id = p_comment_id
          AND status = 'pending';
    ELSIF p_report_id IS NOT NULL THEN
        UPDATE public.community_post_reports
        SET status = 'dismissed',
            reviewed_by_member_id = v_member_id,
            reviewed_at = now(),
            resolution_note = COALESCE(v_clean_reason, 'Komentar dipulihkan oleh pengurus RT.'),
            updated_at = now()
        WHERE id = p_report_id
          AND tenant_id = p_tenant_id
          AND status = 'pending';
    END IF;

    INSERT INTO public.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    VALUES (
        p_tenant_id,
        v_actor,
        'community_comment.moderated_' || p_action,
        'community_post_comments',
        p_comment_id,
        jsonb_build_object(
            'comment_id', p_comment_id,
            'post_id', v_comment.post_id,
            'action', p_action,
            'moderation_status', v_next_status,
            'moderator_member_id', v_member_id,
            'report_id', p_report_id,
            'has_reason', (v_clean_reason IS NOT NULL)
        )
    )
    RETURNING id INTO v_audit_id;

    SELECT tm.user_id
    INTO v_author_user_id
    FROM public.tenant_members tm
    WHERE tm.id = v_comment.author_member_id
      AND tm.tenant_id = p_tenant_id
      AND tm.status = 'active';

    IF v_author_user_id IS NOT NULL AND v_author_user_id <> v_actor THEN
        PERFORM public._enqueue_notification(
            p_tenant_id,
            v_author_user_id,
            'community_moderation',
            'community_post',
            v_comment.post_id,
            CASE
                WHEN p_action = 'hide' THEN 'Komentar Anda disembunyikan oleh pengurus RT'
                ELSE 'Komentar Anda dipulihkan oleh pengurus RT'
            END,
            CASE
                WHEN p_action = 'hide' THEN 'Alasan: ' || COALESCE(v_clean_reason, 'Melanggar ketentuan komunitas.')
                ELSE COALESCE(v_clean_reason, 'Komentar Anda kembali ditampilkan pada feed warga.')
            END,
            'community_comment.moderated_' || p_action || ':' || v_audit_id::text || ':' || v_author_user_id::text,
            'resident'
        );
    END IF;

    RETURN jsonb_build_object(
        'comment_id', p_comment_id,
        'post_id', v_comment.post_id,
        'moderation_status', v_next_status
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. P0 Automatic Outbox Runner infrastructure (pg_cron + pg_net + Vault)
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $harden_net$
BEGIN
    REVOKE ALL ON TABLE net.http_request_queue FROM PUBLIC, anon, authenticated, service_role;
EXCEPTION
    WHEN insufficient_privilege OR undefined_table THEN
        NULL;
END;
$harden_net$;

CREATE OR REPLACE FUNCTION public.dispatch_notification_outbox_cron()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault, pg_temp
AS $$
DECLARE
    v_has_work boolean := false;
    v_url text;
    v_secret text;
    v_request_id bigint;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM public.notification_outbox
        WHERE (status IN ('pending', 'failed') AND next_attempt_at <= now())
           OR (
               status = 'processing'
               AND lease_expires_at IS NOT NULL
               AND lease_expires_at <= now()
           )
    ) INTO v_has_work;

    IF NOT v_has_work THEN
        RETURN 'idle';
    END IF;

    SELECT decrypted_secret
    INTO v_url
    FROM vault.decrypted_secrets
    WHERE name = 'NOTIFICATION_DISPATCHER_URL'
    LIMIT 1;

    SELECT decrypted_secret
    INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'FCM_FUNCTION_SECRET'
    LIMIT 1;

    IF COALESCE(btrim(v_url), '') = '' OR COALESCE(btrim(v_secret), '') = '' THEN
        RETURN 'missing_vault_config';
    END IF;

    SELECT net.http_post(
        url := v_url,
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_secret
        ),
        body := '{"mode":"process_outbox","limit":50,"lease_seconds":120}'::jsonb,
        timeout_milliseconds := 15000
    ) INTO v_request_id;

    RETURN 'dispatched:' || COALESCE(v_request_id::text, '0');
END;
$$;

ALTER FUNCTION public.dispatch_notification_outbox_cron() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.dispatch_notification_outbox_cron() FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

