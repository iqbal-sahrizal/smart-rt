-- =============================================================================
-- Migration 0012: Harden RLS Policies and INSERT/UPDATE Guards
-- Step 10.2.2.2 — Security Correction & Final Policy Audit
-- =============================================================================
-- Corrective migration on top of 20261113001100_enable_rls_and_policies.sql:
--   A. payments_insert: remove bendahara direct INSERT; warga pending own-bill only.
--   B. notifications_select: remove global is_super_admin() bypass; recipient only.
--   C. activity_participants: restrict UPDATE to rsvp_status column and prevent
--      warga from setting attendance status ('attended' / 'absent').
--   D. Tighten INSERT guards on complaints (deleted_at IS NULL) and
--      letter_requests (admin/review/issuance columns must be NULL).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- A. payments_insert: warga-only pending payment for own household/resident bill
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS payments_insert ON public.payments;

CREATE POLICY payments_insert
    ON public.payments
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_tenant_member(tenant_id)
        AND payment_type = 'payment'
        AND status = 'pending'
        AND parent_payment_id IS NULL
        AND paid_by_user_id = auth.uid()
        AND verified_by IS NULL
        AND verified_at IS NULL
        AND EXISTS (
            SELECT 1
            FROM public.bills b
            WHERE b.id = payments.bill_id
              AND b.tenant_id = payments.tenant_id
              AND (
                  b.household_id = public.get_my_household_id(payments.tenant_id)
                  OR b.resident_id = public.get_my_resident_id(payments.tenant_id)
              )
        )
    );

-- ---------------------------------------------------------------------------
-- B. notifications_select: recipient-only within active tenant membership
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS notifications_select ON public.notifications;

CREATE POLICY notifications_select
    ON public.notifications
    FOR SELECT
    TO authenticated
    USING (
        public.is_tenant_member(tenant_id)
        AND recipient_user_id = auth.uid()
    );

-- ---------------------------------------------------------------------------
-- C. activity_participants: column-scoped UPDATE and RSVP-only warga guard
-- ---------------------------------------------------------------------------
REVOKE UPDATE ON public.activity_participants FROM authenticated;
GRANT UPDATE (rsvp_status) ON public.activity_participants TO authenticated;

DROP POLICY IF EXISTS activity_participants_insert ON public.activity_participants;

CREATE POLICY activity_participants_insert
    ON public.activity_participants
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
        OR (
            public.is_tenant_member(tenant_id)
            AND resident_id = public.get_my_resident_id(tenant_id)
            AND rsvp_status IN ('invited', 'attending')
        )
    );

DROP POLICY IF EXISTS activity_participants_update ON public.activity_participants;

CREATE POLICY activity_participants_update
    ON public.activity_participants
    FOR UPDATE
    TO authenticated
    USING (
        public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
        OR (
            public.is_tenant_member(tenant_id)
            AND resident_id = public.get_my_resident_id(tenant_id)
        )
    )
    WITH CHECK (
        public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
        OR (
            public.is_tenant_member(tenant_id)
            AND resident_id = public.get_my_resident_id(tenant_id)
            AND rsvp_status IN ('invited', 'attending')
        )
    );

-- ---------------------------------------------------------------------------
-- D. Tighten INSERT guards on complaints & letter_requests
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS complaints_insert ON public.complaints;

CREATE POLICY complaints_insert
    ON public.complaints
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_tenant_member(tenant_id)
        AND reporter_member_id = public.get_my_member_id(tenant_id)
        AND status = 'open'
        AND deleted_at IS NULL
    );

DROP POLICY IF EXISTS letter_requests_insert ON public.letter_requests;

CREATE POLICY letter_requests_insert
    ON public.letter_requests
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_tenant_member(tenant_id)
        AND requested_by_member_id = public.get_my_member_id(tenant_id)
        AND status = 'submitted'
        AND letter_number IS NULL
        AND admin_notes IS NULL
        AND issued_file_path IS NULL
        AND reviewed_by IS NULL
        AND reviewed_at IS NULL
        AND issued_at IS NULL
    );

COMMIT;

