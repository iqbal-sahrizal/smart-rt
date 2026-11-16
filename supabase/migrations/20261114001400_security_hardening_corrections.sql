-- =============================================================================
-- Migration 0014: Security Hardening Corrections (Boundaries & Lifecycle)
-- Step 10.2.2.18
-- =============================================================================
-- Implements Section 22 of docs/database/security-hardening-rpc-storage-plan.md
-- as an additive corrective migration on top of immutable 0001-0013.
--
-- Phase Order (single transaction):
--   1. REVOKE over-permissive privileges before explicit GRANTs
--   2. DROP obsolete RLS policies
--   3. CREATE OR REPLACE security-hardened guard functions and triggers
--   4. UPDATE table CHECK constraints
--   5. CREATE replacement tightened RLS policies
--
-- Out of scope (deferred after U1 experiment):
--   storage_deletion_queue, Storage buckets/policies, attach_*/request_* RPCs.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. Privilege Boundaries (REVOKE before GRANT)
-- =============================================================================

-- 1.1 Tenants: prevent physical DELETE and TRUNCATE (bypasses RLS/triggers)
REVOKE TRUNCATE, DELETE ON public.tenants FROM PUBLIC, anon, authenticated, service_role;

-- 1.2 Storage-reference domain tables: revoke service_role direct write/truncate
--     and revoke authenticated physical DELETE on activities.
--     NOTE: Migration 0010 set ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO service_role;
--     therefore future tables created by postgres must explicitly revoke service_role DML.
REVOKE DELETE ON public.activities FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.activities FROM service_role;
GRANT SELECT ON public.activities TO service_role;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.resident_documents FROM service_role;
GRANT SELECT ON public.resident_documents TO service_role;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.complaints FROM service_role;
GRANT SELECT ON public.complaints TO service_role;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.letter_requests FROM service_role;
GRANT SELECT ON public.letter_requests TO service_role;

-- 1.3 Payments: revoke direct DELETE/TRUNCATE and full UPDATE from service_role,
--     retaining SELECT/INSERT (guarded by BEFORE INSERT trigger) and narrow column UPDATE.
REVOKE UPDATE, DELETE, TRUNCATE ON public.payments FROM service_role;
GRANT SELECT ON public.payments TO service_role;
GRANT UPDATE (status, gateway_provider, gateway_reference, idempotency_key, notes, paid_at)
    ON public.payments TO service_role;

-- =============================================================================
-- 2. Drop Obsolete Policies
-- =============================================================================
DROP POLICY IF EXISTS activities_delete ON public.activities;

-- =============================================================================
-- 3. Guard Functions & Triggers
-- =============================================================================

-- 3.1 Payments proof_storage_path guard (SECURITY INVOKER)
--     Note: Custom GUC app.storage_ref_ctx is NOT a credential on its own; enforcement
--     relies on SECURITY INVOKER + current_user = 'postgres' + RPC ACLs when
--     attach_payment_proof() is introduced in the Storage/RPC migration.
CREATE OR REPLACE FUNCTION public.guard_payments_proof_path()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_storage_ctx text := COALESCE(current_setting('app.storage_ref_ctx', true), '');
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.proof_storage_path IS NULL THEN
            RETURN NEW;
        END IF;
        IF current_user = 'postgres' AND v_storage_ctx = 'attach_payment_proof' THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'payments.proof_storage_path cannot be set directly; must use attach_payment_proof()'
            USING ERRCODE = '42501';
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.proof_storage_path IS NOT DISTINCT FROM OLD.proof_storage_path THEN
            RETURN NEW;
        END IF;
        IF current_user = 'postgres' AND v_storage_ctx = 'attach_payment_proof' THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'payments.proof_storage_path cannot be modified directly; must use attach_payment_proof()'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.guard_payments_proof_path() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_payments_proof_path() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_payments_guard_proof_path ON public.payments;
CREATE TRIGGER trg_payments_guard_proof_path
    BEFORE INSERT OR UPDATE ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public.guard_payments_proof_path();

-- 3.2 Payments webhook guard for service_role (Alternative B baseline; SECURITY INVOKER)
CREATE OR REPLACE FUNCTION public.guard_payments_webhook_writes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_bill record;
    v_actor_valid boolean := false;
BEGIN
    -- Only constrain direct service_role DML (which bypasses RLS); authenticated uses RLS
    -- and postgres-owned SECURITY DEFINER RPCs run under current_user = 'postgres'.
    IF current_user <> 'service_role' THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.payment_type IS DISTINCT FROM 'payment'
           OR NEW.parent_payment_id IS NOT NULL
           OR NEW.payment_method IS DISTINCT FROM 'gateway'
           OR NEW.status IS DISTINCT FROM 'pending'
           OR NEW.proof_storage_path IS NOT NULL
           OR NEW.verified_by IS NOT NULL
           OR NEW.verified_at IS NOT NULL THEN
            RAISE EXCEPTION 'service_role payment INSERT must be a pending gateway payment with NULL proof/verification fields'
                USING ERRCODE = '42501';
        END IF;

        IF NEW.gateway_provider IS NULL OR length(btrim(NEW.gateway_provider)) = 0
           OR NEW.gateway_reference IS NULL OR length(btrim(NEW.gateway_reference)) = 0
           OR NEW.idempotency_key IS NULL OR length(btrim(NEW.idempotency_key)) = 0 THEN
            RAISE EXCEPTION 'service_role gateway payment INSERT requires non-empty gateway_provider, gateway_reference, and idempotency_key'
                USING ERRCODE = '23514';
        END IF;

        SELECT b.id, b.tenant_id, b.household_id, b.resident_id, b.amount, b.paid_amount, b.status
        INTO v_bill
        FROM public.bills b
        WHERE b.id = NEW.bill_id
          AND b.tenant_id = NEW.tenant_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Target bill % not found in tenant %', NEW.bill_id, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;

        IF v_bill.status NOT IN ('unpaid', 'partial', 'overdue') THEN
            RAISE EXCEPTION 'Cannot create gateway payment for bill % with status %', v_bill.id, v_bill.status
                USING ERRCODE = '23514';
        END IF;

        IF NEW.amount IS NULL OR NEW.amount <= 0 OR NEW.amount > (v_bill.amount - v_bill.paid_amount) THEN
            RAISE EXCEPTION 'Gateway payment amount (%) must be > 0 and <= remaining bill balance (%)',
                NEW.amount, (v_bill.amount - v_bill.paid_amount)
                USING ERRCODE = '23514';
        END IF;

        IF NEW.paid_by_user_id IS NOT NULL THEN
            SELECT EXISTS (
                SELECT 1
                FROM public.tenant_members tm
                JOIN public.tenants t ON t.id = tm.tenant_id
                JOIN public.residents r ON r.id = tm.resident_id AND r.tenant_id = tm.tenant_id
                WHERE tm.tenant_id = NEW.tenant_id
                  AND tm.user_id = NEW.paid_by_user_id
                  AND tm.status = 'active'
                  AND t.status = 'active'
                  AND t.deleted_at IS NULL
                  AND r.deleted_at IS NULL
                  AND (
                      (v_bill.household_id IS NOT NULL AND r.household_id = v_bill.household_id)
                      OR (v_bill.resident_id IS NOT NULL AND tm.resident_id = v_bill.resident_id)
                  )
            )
            INTO v_actor_valid;

            IF NOT v_actor_valid THEN
                RAISE EXCEPTION 'paid_by_user_id % is not an active member matching target bill % in tenant %',
                    NEW.paid_by_user_id, v_bill.id, NEW.tenant_id
                    USING ERRCODE = '42501';
            END IF;
        END IF;

        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.payment_type IS DISTINCT FROM 'payment'
           OR OLD.payment_method IS DISTINCT FROM 'gateway' THEN
            RAISE EXCEPTION 'service_role can only update gateway payments'
                USING ERRCODE = '42501';
        END IF;

        IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
           OR NEW.bill_id IS DISTINCT FROM OLD.bill_id
           OR NEW.payment_type IS DISTINCT FROM OLD.payment_type
           OR NEW.parent_payment_id IS DISTINCT FROM OLD.parent_payment_id
           OR NEW.paid_by_user_id IS DISTINCT FROM OLD.paid_by_user_id
           OR NEW.amount IS DISTINCT FROM OLD.amount
           OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
           OR NEW.proof_storage_path IS DISTINCT FROM OLD.proof_storage_path
           OR NEW.verified_by IS DISTINCT FROM OLD.verified_by
           OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
           OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'service_role cannot modify immutable payment columns'
                USING ERRCODE = '42501';
        END IF;

        IF OLD.status IS DISTINCT FROM 'pending' OR NEW.status NOT IN ('pending', 'failed') THEN
            RAISE EXCEPTION 'service_role can only keep pending or transition pending -> failed (old: %, new: %)',
                OLD.status, NEW.status
                USING ERRCODE = '42501';
        END IF;

        IF NEW.gateway_provider IS NULL OR length(btrim(NEW.gateway_provider)) = 0
           OR NEW.gateway_reference IS NULL OR length(btrim(NEW.gateway_reference)) = 0
           OR NEW.idempotency_key IS NULL OR length(btrim(NEW.idempotency_key)) = 0 THEN
            RAISE EXCEPTION 'service_role gateway payment UPDATE cannot clear gateway_provider, gateway_reference, or idempotency_key'
                USING ERRCODE = '23514';
        END IF;

        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.guard_payments_webhook_writes() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_payments_webhook_writes() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_payments_guard_webhook_writes ON public.payments;
CREATE TRIGGER trg_payments_guard_webhook_writes
    BEFORE INSERT OR UPDATE ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public.guard_payments_webhook_writes();

-- 3.3 Resident documents INSERT validator (strict NULL checks + extension/MIME pairing)
CREATE OR REPLACE FUNCTION public.validate_resident_document_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_res_exists boolean := false;
    v_ext text;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM public.residents r
        WHERE r.tenant_id = NEW.tenant_id
          AND r.id = NEW.resident_id
          AND r.deleted_at IS NULL
          AND r.residency_status = 'aktif'
    )
    INTO v_res_exists;

    IF NOT v_res_exists THEN
        RAISE EXCEPTION 'Resident % in tenant % is missing, inactive, or deleted', NEW.resident_id, NEW.tenant_id;
    END IF;

    IF NEW.storage_path IS NULL
       OR NEW.storage_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$' THEN
        RAISE EXCEPTION 'Invalid resident document storage_path format: %', NEW.storage_path;
    END IF;

    IF split_part(NEW.storage_path, '/', 1) <> NEW.tenant_id::text THEN
        RAISE EXCEPTION 'Resident document storage_path tenant segment mismatch';
    END IF;

    IF split_part(NEW.storage_path, '/', 2) <> NEW.resident_id::text THEN
        RAISE EXCEPTION 'Resident document storage_path resident segment mismatch';
    END IF;

    IF NEW.mime_type IS NULL THEN
        RAISE EXCEPTION 'Resident document mime_type is required';
    END IF;

    v_ext := lower(substring(NEW.storage_path FROM '\.([^./]+)$'));

    IF NOT (
        (v_ext = 'pdf' AND NEW.mime_type = 'application/pdf')
        OR (v_ext IN ('jpg', 'jpeg') AND NEW.mime_type = 'image/jpeg')
        OR (v_ext = 'png' AND NEW.mime_type = 'image/png')
        OR (v_ext = 'webp' AND NEW.mime_type = 'image/webp')
    ) THEN
        RAISE EXCEPTION 'Unsupported or mismatched resident document extension (.%) and mime_type (%)',
            v_ext, NEW.mime_type;
    END IF;

    IF NEW.file_size_bytes IS NULL OR NEW.file_size_bytes <= 0 OR NEW.file_size_bytes > 5242880 THEN
        RAISE EXCEPTION 'Resident document file_size_bytes (%) must be between 1 and 5242880 bytes',
            NEW.file_size_bytes;
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.validate_resident_document_insert() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.validate_resident_document_insert() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_resident_docs_validate_insert ON public.resident_documents;
CREATE TRIGGER trg_resident_docs_validate_insert
    BEFORE INSERT ON public.resident_documents
    FOR EACH ROW EXECUTE FUNCTION public.validate_resident_document_insert();

-- Note on resident_documents_delete (created in 20261113001300):
-- Warga direct DELETE on unverified own rows (verified_by IS NULL AND verified_at IS NULL)
-- is retained strictly as a transitional rule until request_delete_resident_document()
-- lands in the post-U1 Storage/RPC migration.

-- =============================================================================
-- 4. Tighten CHECK Constraints
-- =============================================================================
ALTER TABLE public.resident_documents
    DROP CONSTRAINT IF EXISTS chk_resident_docs_size;

ALTER TABLE public.resident_documents
    ADD CONSTRAINT chk_resident_docs_size CHECK (
        file_size_bytes IS NOT NULL
        AND file_size_bytes > 0
        AND file_size_bytes <= 5242880
    );

-- =============================================================================
-- 5. Tightened Replacement RLS Policies
-- =============================================================================

-- 5.1 activities_update: metadata updates allowed ONLY while scheduled or ongoing
DROP POLICY IF EXISTS activities_update ON public.activities;

CREATE POLICY activities_update
    ON public.activities
    FOR UPDATE
    TO authenticated
    USING (
        public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
        AND deleted_at IS NULL
        AND status IN ('scheduled', 'ongoing')
    )
    WITH CHECK (
        public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
        AND deleted_at IS NULL
        AND status IN ('scheduled', 'ongoing')
    );

-- 5.2 activity_participants_insert: enforce active scheduled/ongoing parent activity
--     for BOTH staff and warga
DROP POLICY IF EXISTS activity_participants_insert ON public.activity_participants;

CREATE POLICY activity_participants_insert
    ON public.activity_participants
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.activities a
            WHERE a.id = activity_participants.activity_id
              AND a.tenant_id = activity_participants.tenant_id
              AND a.deleted_at IS NULL
              AND a.status IN ('scheduled', 'ongoing')
        )
        AND (
            public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
            OR (
                public.is_tenant_member(tenant_id)
                AND resident_id = public.get_my_resident_id(tenant_id)
                AND rsvp_status IN ('invited', 'attending')
            )
        )
    );

-- 5.3 activity_participants_update:
--     - Warga: RSVP 'invited'/'attending' only while parent is scheduled/ongoing
--     - Staff: transitional attendance closeout allowed while parent is not deleted
--       and not cancelled (until record_activity_attendance() RPC is added)
DROP POLICY IF EXISTS activity_participants_update ON public.activity_participants;

CREATE POLICY activity_participants_update
    ON public.activity_participants
    FOR UPDATE
    TO authenticated
    USING (
        (
            public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
            AND EXISTS (
                SELECT 1
                FROM public.activities a
                WHERE a.id = activity_participants.activity_id
                  AND a.tenant_id = activity_participants.tenant_id
                  AND a.deleted_at IS NULL
                  AND a.status <> 'cancelled'
            )
        )
        OR (
            public.is_tenant_member(tenant_id)
            AND resident_id = public.get_my_resident_id(tenant_id)
            AND rsvp_status IN ('invited', 'attending')
            AND EXISTS (
                SELECT 1
                FROM public.activities a
                WHERE a.id = activity_participants.activity_id
                  AND a.tenant_id = activity_participants.tenant_id
                  AND a.deleted_at IS NULL
                  AND a.status IN ('scheduled', 'ongoing')
            )
        )
    )
    WITH CHECK (
        (
            public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
            AND EXISTS (
                SELECT 1
                FROM public.activities a
                WHERE a.id = activity_participants.activity_id
                  AND a.tenant_id = activity_participants.tenant_id
                  AND a.deleted_at IS NULL
                  AND a.status <> 'cancelled'
            )
        )
        OR (
            public.is_tenant_member(tenant_id)
            AND resident_id = public.get_my_resident_id(tenant_id)
            AND rsvp_status IN ('invited', 'attending')
            AND EXISTS (
                SELECT 1
                FROM public.activities a
                WHERE a.id = activity_participants.activity_id
                  AND a.tenant_id = activity_participants.tenant_id
                  AND a.deleted_at IS NULL
                  AND a.status IN ('scheduled', 'ongoing')
            )
        )
    );

COMMIT;

