-- =============================================================================
-- Migration 0013: Security Hardening Guards (Domain, Privileges & Timestamps)
-- Step 10.2.2.15
-- =============================================================================
-- Scope:
--   A. Tenant deletion boundary (prohibit physical DELETE; deactivate via status/deleted_at)
--   B. Letter requests (+ 'cancelled' status, resident ownership INSERT, revoke UPDATE)
--   C. Complaints (column UPDATE without photo_path, priority locked to 'medium')
--   D. Complaint replies (strict member authorship & active/non-deleted complaint checks)
--   E. Complaint status history (revoke direct authenticated INSERT)
--   F. Payments & webhook compatibility (warga pending INSERT, service_role column UPDATE,
--      proof_storage_path direct mutation guard preserving NULL-proof gateway INSERTs)
--   G. Activity participants (RSVP-only warga INSERT/UPDATE, active activity checks)
--   H. Activities (column UPDATE without documentation_paths/status/deleted_at, INSERT guards)
--   I. Resident documents (revoke UPDATE, owner-unverified DELETE, insert path/owner validator)
--   J. Server-controlled INSERT timestamps (enforce_server_insert_timestamps() across 7 tables)
--
-- Out of scope (deferred to Migration 0014 after U1 experiment):
--   storage_deletion_queue, worker functions, attach_*/request_* RPCs, Storage buckets/policies.
-- =============================================================================

BEGIN;

-- =============================================================================
-- A. Tenant Deletion Boundary
-- =============================================================================
DROP POLICY IF EXISTS tenants_delete_super ON public.tenants;

REVOKE DELETE ON public.tenants FROM PUBLIC, anon, authenticated, service_role;

-- =============================================================================
-- B. Letter Requests Hardening
-- =============================================================================
ALTER TABLE public.letter_requests
    DROP CONSTRAINT IF EXISTS chk_letter_requests_status;

ALTER TABLE public.letter_requests
    ADD CONSTRAINT chk_letter_requests_status CHECK (
        status IN ('submitted', 'reviewing', 'approved', 'rejected', 'completed', 'cancelled')
    );

DROP POLICY IF EXISTS letter_requests_update ON public.letter_requests;
REVOKE UPDATE ON public.letter_requests FROM authenticated;

DROP POLICY IF EXISTS letter_requests_insert ON public.letter_requests;

CREATE POLICY letter_requests_insert
    ON public.letter_requests
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_tenant_member(tenant_id)
        AND requested_by_member_id = public.get_my_member_id(tenant_id)
        AND resident_id = public.get_my_resident_id(tenant_id)
        AND status = 'submitted'
        AND supporting_doc_paths = '[]'::jsonb
        AND letter_number IS NULL
        AND admin_notes IS NULL
        AND issued_file_path IS NULL
        AND reviewed_by IS NULL
        AND reviewed_at IS NULL
        AND issued_at IS NULL
        AND EXISTS (
            SELECT 1
            FROM public.letter_types lt
            WHERE lt.id = letter_requests.letter_type_id
              AND lt.tenant_id = letter_requests.tenant_id
              AND lt.is_active IS TRUE
        )
    );

-- =============================================================================
-- C. Complaints Hardening (No direct photo_path UPDATE; priority locked)
-- =============================================================================
REVOKE UPDATE ON public.complaints FROM authenticated;
GRANT UPDATE (category, title, description) ON public.complaints TO authenticated;

DROP POLICY IF EXISTS complaints_insert ON public.complaints;

CREATE POLICY complaints_insert
    ON public.complaints
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_tenant_member(tenant_id)
        AND reporter_member_id = public.get_my_member_id(tenant_id)
        AND status = 'open'
        AND priority = 'medium'
        AND photo_path IS NULL
        AND deleted_at IS NULL
    );

-- =============================================================================
-- D. Complaint Replies Hardening
-- =============================================================================
DROP POLICY IF EXISTS complaint_replies_insert ON public.complaint_replies;

CREATE POLICY complaint_replies_insert
    ON public.complaint_replies
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_tenant_member(tenant_id)
        AND author_member_id = public.get_my_member_id(tenant_id)
        AND EXISTS (
            SELECT 1
            FROM public.complaints c
            WHERE c.id = complaint_replies.complaint_id
              AND c.tenant_id = complaint_replies.tenant_id
              AND c.deleted_at IS NULL
              AND c.status IN ('open', 'in_progress')
              AND (
                  public.has_tenant_role(complaint_replies.tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
                  OR c.reporter_member_id = public.get_my_member_id(complaint_replies.tenant_id)
              )
        )
    );

-- =============================================================================
-- E. Complaint Status History Hardening (No direct authenticated INSERT)
-- =============================================================================
DROP POLICY IF EXISTS complaint_status_history_insert ON public.complaint_status_history;
REVOKE INSERT ON public.complaint_status_history FROM authenticated;

-- =============================================================================
-- F. Payments & Payment Gateway Webhook Compatibility
-- =============================================================================
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
        AND payment_method IN ('transfer', 'qris', 'cash')
        AND gateway_provider IS NULL
        AND gateway_reference IS NULL
        AND proof_storage_path IS NULL
        AND EXISTS (
            SELECT 1
            FROM public.bills b
            WHERE b.id = payments.bill_id
              AND b.tenant_id = payments.tenant_id
              AND b.status NOT IN ('paid', 'cancelled', 'refunded')
              AND (
                  b.household_id = public.get_my_household_id(payments.tenant_id)
                  OR b.resident_id = public.get_my_resident_id(payments.tenant_id)
              )
        )
    );

-- Preserve webhook INSERT (proof_storage_path IS NULL) & gateway UPDATE allowlist;
-- block direct DELETE and block direct UPDATE of proof_storage_path / financial amounts.
REVOKE DELETE, UPDATE ON public.payments FROM service_role;
GRANT UPDATE (status, gateway_provider, gateway_reference, idempotency_key, notes, paid_at)
    ON public.payments TO service_role;

CREATE OR REPLACE FUNCTION public.guard_payments_proof_path()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_jwt_role text := COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'none');
    v_is_postgres_ctx boolean := (current_user = 'postgres' AND v_jwt_role NOT IN ('authenticated', 'anon'));
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.proof_storage_path IS NULL THEN
            RETURN NEW;
        END IF;
        IF NOT v_is_postgres_ctx THEN
            RAISE EXCEPTION 'payments.proof_storage_path cannot be set directly; must be NULL on insert'
                USING ERRCODE = '42501';
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.proof_storage_path IS NOT DISTINCT FROM OLD.proof_storage_path THEN
            RETURN NEW;
        END IF;
        IF NOT v_is_postgres_ctx THEN
            RAISE EXCEPTION 'payments.proof_storage_path cannot be modified directly'
                USING ERRCODE = '42501';
        END IF;
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

-- =============================================================================
-- G. Activity Participants Hardening (RSVP-only warga scope)
-- =============================================================================
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
            AND rsvp_status IN ('invited', 'attending')
        )
    )
    WITH CHECK (
        public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
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
            )
        )
    );

-- =============================================================================
-- H. Activities Hardening (Metadata-only column UPDATE + strict INSERT)
-- =============================================================================
REVOKE UPDATE ON public.activities FROM authenticated;
GRANT UPDATE (title, description, location, start_at, end_at) ON public.activities TO authenticated;

DROP POLICY IF EXISTS activities_insert ON public.activities;

CREATE POLICY activities_insert
    ON public.activities
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
        AND created_by = auth.uid()
        AND status = 'scheduled'
        AND deleted_at IS NULL
        AND documentation_paths = '[]'::jsonb
        AND created_at = now()
        AND updated_at = now()
    );

DROP POLICY IF EXISTS activities_update ON public.activities;

CREATE POLICY activities_update
    ON public.activities
    FOR UPDATE
    TO authenticated
    USING (
        public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
        AND deleted_at IS NULL
    )
    WITH CHECK (
        public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
        AND deleted_at IS NULL
    );

-- =============================================================================
-- I. Resident Documents Hardening
-- =============================================================================
DROP POLICY IF EXISTS resident_documents_update ON public.resident_documents;
REVOKE UPDATE ON public.resident_documents FROM authenticated;

DROP POLICY IF EXISTS resident_documents_insert ON public.resident_documents;

CREATE POLICY resident_documents_insert
    ON public.resident_documents
    FOR INSERT
    TO authenticated
    WITH CHECK (
        (
            public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris'])
            OR (
                public.is_tenant_member(tenant_id)
                AND resident_id = public.get_my_resident_id(tenant_id)
            )
        )
        AND verified_by IS NULL
        AND verified_at IS NULL
    );

DROP POLICY IF EXISTS resident_documents_delete ON public.resident_documents;

CREATE POLICY resident_documents_delete
    ON public.resident_documents
    FOR DELETE
    TO authenticated
    USING (
        public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris'])
        OR (
            public.is_tenant_member(tenant_id)
            AND resident_id = public.get_my_resident_id(tenant_id)
            AND verified_by IS NULL
            AND verified_at IS NULL
        )
    );

CREATE OR REPLACE FUNCTION public.validate_resident_document_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_res_exists boolean := false;
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

    IF NEW.storage_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$' THEN
        RAISE EXCEPTION 'Invalid resident document storage_path format: %', NEW.storage_path;
    END IF;

    IF split_part(NEW.storage_path, '/', 1) <> NEW.tenant_id::text THEN
        RAISE EXCEPTION 'Resident document storage_path tenant segment mismatch';
    END IF;

    IF split_part(NEW.storage_path, '/', 2) <> NEW.resident_id::text THEN
        RAISE EXCEPTION 'Resident document storage_path resident segment mismatch';
    END IF;

    IF NEW.mime_type NOT IN ('image/jpeg', 'image/png', 'application/pdf') THEN
        RAISE EXCEPTION 'Unsupported resident document mime_type: %', NEW.mime_type;
    END IF;

    IF NEW.file_size_bytes > 5242880 THEN
        RAISE EXCEPTION 'Resident document exceeds 5 MB size limit (% bytes)', NEW.file_size_bytes;
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

-- =============================================================================
-- J. Server-Controlled INSERT Timestamps (7 approved tables)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.enforce_server_insert_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_jwt_role text := COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'none');
    v_is_backend_trusted boolean := (
        current_user IN ('postgres', 'supabase_admin', 'service_role')
        AND v_jwt_role NOT IN ('authenticated', 'anon')
    );
BEGIN
    IF v_is_backend_trusted THEN
        RETURN NEW;
    END IF;

    CASE TG_TABLE_NAME
        WHEN 'activity_participants' THEN
            NEW.registered_at := now();
        WHEN 'complaints' THEN
            NEW.created_at := now();
            NEW.updated_at := now();
        WHEN 'complaint_replies' THEN
            NEW.created_at := now();
        WHEN 'complaint_status_history' THEN
            NEW.created_at := now();
        WHEN 'letter_requests' THEN
            NEW.created_at := now();
            NEW.updated_at := now();
        WHEN 'payments' THEN
            NEW.created_at := now();
            NEW.paid_at := now();
        WHEN 'resident_documents' THEN
            NEW.created_at := now();
        ELSE
            RAISE EXCEPTION 'enforce_server_insert_timestamps() not configured for table %', TG_TABLE_NAME;
    END CASE;

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_server_insert_timestamps() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_server_insert_timestamps() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_activity_participants_enforce_insert_timestamps ON public.activity_participants;
CREATE TRIGGER trg_activity_participants_enforce_insert_timestamps
    BEFORE INSERT ON public.activity_participants
    FOR EACH ROW EXECUTE FUNCTION public.enforce_server_insert_timestamps();

DROP TRIGGER IF EXISTS trg_complaints_enforce_insert_timestamps ON public.complaints;
CREATE TRIGGER trg_complaints_enforce_insert_timestamps
    BEFORE INSERT ON public.complaints
    FOR EACH ROW EXECUTE FUNCTION public.enforce_server_insert_timestamps();

DROP TRIGGER IF EXISTS trg_complaint_replies_enforce_insert_timestamps ON public.complaint_replies;
CREATE TRIGGER trg_complaint_replies_enforce_insert_timestamps
    BEFORE INSERT ON public.complaint_replies
    FOR EACH ROW EXECUTE FUNCTION public.enforce_server_insert_timestamps();

DROP TRIGGER IF EXISTS trg_complaint_status_history_enforce_insert_timestamps ON public.complaint_status_history;
CREATE TRIGGER trg_complaint_status_history_enforce_insert_timestamps
    BEFORE INSERT ON public.complaint_status_history
    FOR EACH ROW EXECUTE FUNCTION public.enforce_server_insert_timestamps();

DROP TRIGGER IF EXISTS trg_letter_requests_enforce_insert_timestamps ON public.letter_requests;
CREATE TRIGGER trg_letter_requests_enforce_insert_timestamps
    BEFORE INSERT ON public.letter_requests
    FOR EACH ROW EXECUTE FUNCTION public.enforce_server_insert_timestamps();

DROP TRIGGER IF EXISTS trg_payments_enforce_insert_timestamps ON public.payments;
CREATE TRIGGER trg_payments_enforce_insert_timestamps
    BEFORE INSERT ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public.enforce_server_insert_timestamps();

DROP TRIGGER IF EXISTS trg_resident_documents_enforce_insert_timestamps ON public.resident_documents;
CREATE TRIGGER trg_resident_documents_enforce_insert_timestamps
    BEFORE INSERT ON public.resident_documents
    FOR EACH ROW EXECUTE FUNCTION public.enforce_server_insert_timestamps();

COMMIT;

