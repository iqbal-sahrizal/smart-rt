-- =============================================================================
-- Migration 0015: Storage Architecture, Deletion Queue & Atomic RPCs
-- Step 10.2.2.20
-- =============================================================================
-- Implements final Storage & RPC architecture from
-- docs/database/security-hardening-rpc-storage-plan.md (post-U1 verification):
--   1. Six private Storage buckets (versioning disabled)
--   2. public.storage_deletion_queue + identity immutability trigger + strict ACL
--   3. SECURITY DEFINER boolean helpers (pending / retired)
--   4. SECURITY INVOKER Storage-reference trigger guards + resident_documents cutover
--   5. Storage RLS policies (SELECT/INSERT only, using U1 predicate)
--   6. Eight worker/maintenance SECURITY DEFINER functions (service_role only)
--   7. Twenty-one user/super_admin SECURITY DEFINER RPCs (authenticated)
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. Storage Buckets (6 Private Buckets, Versioning Disabled)
-- =============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types, versioning_status)
VALUES
    ('resident-documents', 'resident-documents', false, 5242880,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], 'DISABLED'),
    ('payment-proofs', 'payment-proofs', false, 5242880,
        ARRAY['image/jpeg', 'image/png', 'application/pdf'], 'DISABLED'),
    ('complaints', 'complaints', false, 5242880,
        ARRAY['image/jpeg', 'image/png', 'image/webp'], 'DISABLED'),
    ('letter-requests', 'letter-requests', false, 5242880,
        ARRAY['image/jpeg', 'image/png', 'application/pdf'], 'DISABLED'),
    ('issued-letters', 'issued-letters', false, 10485760,
        ARRAY['application/pdf'], 'DISABLED'),
    ('activity-docs', 'activity-docs', false, 10485760,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], 'DISABLED')
ON CONFLICT (id) DO UPDATE
    SET public = EXCLUDED.public,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types,
        versioning_status = EXCLUDED.versioning_status;

-- Tighten storage base table privileges
REVOKE ALL ON storage.buckets FROM anon;
REVOKE ALL ON storage.objects FROM anon;
REVOKE UPDATE, DELETE ON storage.objects FROM authenticated;

-- =============================================================================
-- 2. Storage Deletion Queue & Identity Immutability Trigger
-- =============================================================================
CREATE TABLE public.storage_deletion_queue (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE RESTRICT,
    bucket_id text NOT NULL,
    object_path text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NULL,
    requested_by uuid NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
    reason text NOT NULL
        CONSTRAINT chk_sdq_reason_non_empty CHECK (btrim(reason) <> ''),
    status text NOT NULL DEFAULT 'pending'
        CONSTRAINT chk_sdq_status CHECK (
            status IN ('pending', 'processing', 'failed', 'exhausted', 'completed')
        ),
    attempt_count integer NOT NULL DEFAULT 0
        CONSTRAINT chk_sdq_attempt_count CHECK (attempt_count >= 0),
    claim_token uuid NULL,
    claimed_at timestamptz NULL,
    lease_expires_at timestamptz NULL,
    decision text NULL
        CONSTRAINT chk_sdq_decision CHECK (
            decision IS NULL OR decision IN ('delete_physical', 'detach_only')
        ),
    last_error text NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    requested_at timestamptz NOT NULL DEFAULT now(),
    last_attempted_at timestamptz NULL,
    completed_at timestamptz NULL,
    CONSTRAINT chk_sdq_path_format CHECK (
        object_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$'
    ),
    CONSTRAINT chk_sdq_tenant_segment CHECK (
        split_part(object_path, '/', 1) = tenant_id::text
    ),
    CONSTRAINT chk_sdq_entity_type CHECK (
        entity_type IN ('resident_document', 'payment', 'complaint', 'letter_request', 'activity', 'orphan')
    ),
    CONSTRAINT chk_sdq_entity_identity CHECK (
        (entity_type = 'orphan' AND entity_id IS NULL)
        OR (
            entity_type <> 'orphan'
            AND entity_id IS NOT NULL
            AND split_part(object_path, '/', 2) = entity_id::text
        )
    ),
    CONSTRAINT chk_sdq_bucket CHECK (
        bucket_id IN (
            'resident-documents', 'payment-proofs', 'complaints',
            'letter-requests', 'issued-letters', 'activity-docs'
        )
    ),
    CONSTRAINT chk_sdq_bucket_entity CHECK (
        entity_type = 'orphan'
        OR (bucket_id, entity_type) IN (
            ('resident-documents', 'resident_document'),
            ('payment-proofs',     'payment'),
            ('complaints',         'complaint'),
            ('letter-requests',    'letter_request'),
            ('issued-letters',     'letter_request'),
            ('activity-docs',      'activity')
        )
    ),
    CONSTRAINT chk_sdq_claim_state CHECK (
        (
            status = 'processing'
            AND claim_token IS NOT NULL
            AND claimed_at IS NOT NULL
            AND lease_expires_at IS NOT NULL
        )
        OR (
            status <> 'processing'
            AND claim_token IS NULL
            AND lease_expires_at IS NULL
        )
    )
);

-- One unfinished job per (bucket_id, object_path); completed jobs retained forever
CREATE UNIQUE INDEX uq_storage_del_unfinished_object
    ON public.storage_deletion_queue (bucket_id, object_path)
    WHERE status IN ('pending', 'processing', 'failed', 'exhausted');

CREATE INDEX idx_storage_del_object
    ON public.storage_deletion_queue (bucket_id, object_path);

CREATE INDEX idx_storage_del_claim
    ON public.storage_deletion_queue (status, lease_expires_at, last_attempted_at)
    WHERE status IN ('pending', 'failed', 'processing');

ALTER TABLE public.storage_deletion_queue ENABLE ROW LEVEL SECURITY;

-- Override 0010 default privileges: zero direct table access for clients OR service_role
REVOKE ALL ON TABLE public.storage_deletion_queue FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.protect_storage_deletion_job_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.bucket_id IS DISTINCT FROM OLD.bucket_id
       OR NEW.object_path IS DISTINCT FROM OLD.object_path
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
       OR NEW.entity_id IS DISTINCT FROM OLD.entity_id THEN
        RAISE EXCEPTION 'storage_deletion_queue identity columns are immutable'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

ALTER FUNCTION public.protect_storage_deletion_job_identity() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.protect_storage_deletion_job_identity() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_storage_del_protect_identity
    BEFORE UPDATE ON public.storage_deletion_queue
    FOR EACH ROW EXECUTE FUNCTION public.protect_storage_deletion_job_identity();

-- =============================================================================
-- 3. Constants & Boolean Helper Functions (Non-leaking)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.storage_deletion_max_attempts()
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT 10;
$$;

ALTER FUNCTION public.storage_deletion_max_attempts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.storage_deletion_max_attempts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storage_deletion_max_attempts() TO service_role;

CREATE OR REPLACE FUNCTION public.is_storage_object_deletion_pending(
    p_bucket_id text,
    p_object_path text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.storage_deletion_queue q
        WHERE q.bucket_id = p_bucket_id
          AND q.object_path = p_object_path
          AND q.status IN ('pending', 'processing', 'failed', 'exhausted')
    );
$$;

ALTER FUNCTION public.is_storage_object_deletion_pending(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_storage_object_deletion_pending(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_storage_object_deletion_pending(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_storage_object_path_retired(
    p_bucket_id text,
    p_object_path text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.storage_deletion_queue q
        WHERE q.bucket_id = p_bucket_id
          AND q.object_path = p_object_path
    );
$$;

ALTER FUNCTION public.is_storage_object_path_retired(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_storage_object_path_retired(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_storage_object_path_retired(text, text) TO authenticated, service_role;

-- =============================================================================
-- 4. Storage-Reference Trigger Guards & Resident Documents Delete Cutover
-- =============================================================================

-- Cutover transitional warga DELETE on resident_documents -> request_delete_resident_document()
DROP POLICY IF EXISTS resident_documents_delete ON public.resident_documents;
REVOKE DELETE ON public.resident_documents FROM PUBLIC, anon, authenticated, service_role;

-- 4.1 Resident documents: block service_role INSERT, block direct UPDATE & DELETE
CREATE OR REPLACE FUNCTION public.guard_resident_documents_mutations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ctx text := COALESCE(current_setting('app.storage_ref_ctx', true), '');
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF current_user = 'service_role' THEN
            RAISE EXCEPTION 'service_role cannot insert resident_documents directly'
                USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        IF current_user = 'postgres' AND v_ctx = 'rpc_authorized' THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'resident_documents cannot be updated directly'
            USING ERRCODE = '42501';
    ELSIF TG_OP = 'DELETE' THEN
        IF current_user = 'postgres' AND v_ctx = 'rpc_authorized' THEN
            RETURN OLD;
        END IF;
        RAISE EXCEPTION 'resident_documents can only be deleted by complete_storage_deletion()'
            USING ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$$;

ALTER FUNCTION public.guard_resident_documents_mutations() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_resident_documents_mutations() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_resident_docs_guard_mutations
    BEFORE INSERT OR UPDATE OR DELETE ON public.resident_documents
    FOR EACH ROW EXECUTE FUNCTION public.guard_resident_documents_mutations();

-- Upgrade validate_resident_document_insert() with object advisory lock + live Storage check
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

    -- Global Lock Order step 1: object advisory lock before inspecting queue / storage.objects
    PERFORM pg_advisory_xact_lock(hashtextextended('storage:resident-documents/' || NEW.storage_path, 0));

    IF public.is_storage_object_deletion_pending('resident-documents', NEW.storage_path) THEN
        RAISE EXCEPTION 'Storage path has pending deletion job: %', NEW.storage_path
            USING ERRCODE = '42501';
    END IF;

    IF public.is_storage_object_path_retired('resident-documents', NEW.storage_path) THEN
        RAISE EXCEPTION 'Storage path is retired and cannot be reused: %', NEW.storage_path
            USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM storage.objects o
        WHERE o.bucket_id = 'resident-documents'
          AND o.name = NEW.storage_path
          AND o.archived_at IS NULL
          AND o.is_delete_marker = false
    ) THEN
        RAISE EXCEPTION 'Storage object does not exist in resident-documents: %', NEW.storage_path
            USING ERRCODE = '23503';
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.validate_resident_document_insert() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.validate_resident_document_insert() FROM PUBLIC, anon, authenticated, service_role;

-- 4.2 Complaints photo_path guard (SECURITY INVOKER)
CREATE OR REPLACE FUNCTION public.guard_complaints_photo_path()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ctx text := COALESCE(current_setting('app.storage_ref_ctx', true), '');
BEGIN
    IF TG_OP = 'INSERT' AND NEW.photo_path IS NULL THEN
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' AND NEW.photo_path IS NOT DISTINCT FROM OLD.photo_path THEN
        RETURN NEW;
    END IF;

    IF current_user = 'postgres' AND v_ctx = 'rpc_authorized' THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'complaints.photo_path can only be modified by authorized RPCs'
        USING ERRCODE = '42501';
END;
$$;

ALTER FUNCTION public.guard_complaints_photo_path() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_complaints_photo_path() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_complaints_guard_photo_path
    BEFORE INSERT OR UPDATE ON public.complaints
    FOR EACH ROW EXECUTE FUNCTION public.guard_complaints_photo_path();

-- 4.3 Letter requests Storage path guard (SECURITY INVOKER)
CREATE OR REPLACE FUNCTION public.guard_letter_requests_storage_paths()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ctx text := COALESCE(current_setting('app.storage_ref_ctx', true), '');
BEGIN
    IF TG_OP = 'INSERT'
       AND NEW.supporting_doc_paths = '[]'::jsonb
       AND NEW.issued_file_path IS NULL THEN
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE'
       AND NEW.supporting_doc_paths IS NOT DISTINCT FROM OLD.supporting_doc_paths
       AND NEW.issued_file_path IS NOT DISTINCT FROM OLD.issued_file_path THEN
        RETURN NEW;
    END IF;

    IF current_user = 'postgres' AND v_ctx = 'rpc_authorized' THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'letter_requests Storage paths can only be modified by authorized RPCs'
        USING ERRCODE = '42501';
END;
$$;

ALTER FUNCTION public.guard_letter_requests_storage_paths() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_letter_requests_storage_paths() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_letter_requests_guard_storage_paths
    BEFORE INSERT OR UPDATE ON public.letter_requests
    FOR EACH ROW EXECUTE FUNCTION public.guard_letter_requests_storage_paths();

-- 4.4 Activities documentation_paths guard (SECURITY INVOKER)
CREATE OR REPLACE FUNCTION public.guard_activities_doc_paths()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ctx text := COALESCE(current_setting('app.storage_ref_ctx', true), '');
BEGIN
    IF TG_OP = 'INSERT' AND NEW.documentation_paths = '[]'::jsonb THEN
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' AND NEW.documentation_paths IS NOT DISTINCT FROM OLD.documentation_paths THEN
        RETURN NEW;
    END IF;

    IF current_user = 'postgres' AND v_ctx = 'rpc_authorized' THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'activities.documentation_paths can only be modified by authorized RPCs'
        USING ERRCODE = '42501';
END;
$$;

ALTER FUNCTION public.guard_activities_doc_paths() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_activities_doc_paths() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_activities_guard_doc_paths
    BEFORE INSERT OR UPDATE ON public.activities
    FOR EACH ROW EXECUTE FUNCTION public.guard_activities_doc_paths();

-- =============================================================================
-- 5. Storage RLS Policies (storage.objects — SELECT & INSERT only)
-- =============================================================================

-- 5.1 resident-documents
CREATE POLICY storage_insert_resident_documents
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'resident-documents'
        AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|pdf)$'
        AND NOT public.is_storage_object_path_retired('resident-documents', name)
        AND EXISTS (
            SELECT 1
            FROM public.residents r
            WHERE r.tenant_id::text = split_part(name, '/', 1)
              AND r.id::text = split_part(name, '/', 2)
              AND r.deleted_at IS NULL
              AND r.residency_status = 'aktif'
              AND (
                  public.has_tenant_role(r.tenant_id, ARRAY['ketua_rt', 'sekretaris'])
                  OR (
                      public.is_tenant_member(r.tenant_id)
                      AND r.id = public.get_my_resident_id(r.tenant_id)
                  )
              )
        )
    );

CREATE POLICY storage_select_resident_documents
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'resident-documents'
        AND archived_at IS NULL
        AND is_delete_marker = false
        AND NOT public.is_storage_object_deletion_pending('resident-documents', name)
        AND EXISTS (
            SELECT 1
            FROM public.residents r
            WHERE r.tenant_id::text = split_part(name, '/', 1)
              AND r.id::text = split_part(name, '/', 2)
              AND (
                  public.has_tenant_role(r.tenant_id, ARRAY['ketua_rt', 'sekretaris'])
                  OR (
                      public.is_tenant_member(r.tenant_id)
                      AND r.id = public.get_my_resident_id(r.tenant_id)
                      AND r.deleted_at IS NULL
                  )
              )
        )
    );

-- 5.2 payment-proofs
CREATE POLICY storage_insert_payment_proofs
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'payment-proofs'
        AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|pdf)$'
        AND NOT public.is_storage_object_path_retired('payment-proofs', name)
        AND EXISTS (
            SELECT 1
            FROM public.payments p
            JOIN public.bills b ON b.id = p.bill_id AND b.tenant_id = p.tenant_id
            WHERE p.tenant_id::text = split_part(name, '/', 1)
              AND p.id::text = split_part(name, '/', 2)
              AND p.payment_type = 'payment'
              AND p.status = 'pending'
              AND public.is_tenant_member(p.tenant_id)
              AND (
                  p.paid_by_user_id = auth.uid()
                  OR b.household_id = public.get_my_household_id(p.tenant_id)
                  OR b.resident_id = public.get_my_resident_id(p.tenant_id)
              )
        )
    );

CREATE POLICY storage_select_payment_proofs
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'payment-proofs'
        AND archived_at IS NULL
        AND is_delete_marker = false
        AND NOT public.is_storage_object_deletion_pending('payment-proofs', name)
        AND EXISTS (
            SELECT 1
            FROM public.payments p
            JOIN public.bills b ON b.id = p.bill_id AND b.tenant_id = p.tenant_id
            WHERE p.tenant_id::text = split_part(name, '/', 1)
              AND p.id::text = split_part(name, '/', 2)
              AND (
                  public.has_tenant_role(p.tenant_id, ARRAY['bendahara', 'ketua_rt'])
                  OR (
                      public.is_tenant_member(p.tenant_id)
                      AND (
                          p.paid_by_user_id = auth.uid()
                          OR b.household_id = public.get_my_household_id(p.tenant_id)
                          OR b.resident_id = public.get_my_resident_id(p.tenant_id)
                      )
                  )
              )
        )
    );

-- 5.3 complaints
CREATE POLICY storage_insert_complaints
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'complaints'
        AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
        AND NOT public.is_storage_object_path_retired('complaints', name)
        AND EXISTS (
            SELECT 1
            FROM public.complaints c
            WHERE c.tenant_id::text = split_part(name, '/', 1)
              AND c.id::text = split_part(name, '/', 2)
              AND c.status = 'open'
              AND c.deleted_at IS NULL
              AND public.is_tenant_member(c.tenant_id)
              AND c.reporter_member_id = public.get_my_member_id(c.tenant_id)
        )
    );

CREATE POLICY storage_select_complaints
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'complaints'
        AND archived_at IS NULL
        AND is_delete_marker = false
        AND NOT public.is_storage_object_deletion_pending('complaints', name)
        AND EXISTS (
            SELECT 1
            FROM public.complaints c
            WHERE c.tenant_id::text = split_part(name, '/', 1)
              AND c.id::text = split_part(name, '/', 2)
              AND (
                  public.has_tenant_role(c.tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
                  OR (
                      public.is_tenant_member(c.tenant_id)
                      AND c.reporter_member_id = public.get_my_member_id(c.tenant_id)
                      AND c.deleted_at IS NULL
                  )
              )
        )
    );

-- 5.4 letter-requests
CREATE POLICY storage_insert_letter_requests
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'letter-requests'
        AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|pdf)$'
        AND NOT public.is_storage_object_path_retired('letter-requests', name)
        AND EXISTS (
            SELECT 1
            FROM public.letter_requests lr
            WHERE lr.tenant_id::text = split_part(name, '/', 1)
              AND lr.id::text = split_part(name, '/', 2)
              AND lr.status = 'submitted'
              AND public.is_tenant_member(lr.tenant_id)
              AND lr.requested_by_member_id = public.get_my_member_id(lr.tenant_id)
        )
    );

CREATE POLICY storage_select_letter_requests
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'letter-requests'
        AND archived_at IS NULL
        AND is_delete_marker = false
        AND NOT public.is_storage_object_deletion_pending('letter-requests', name)
        AND EXISTS (
            SELECT 1
            FROM public.letter_requests lr
            WHERE lr.tenant_id::text = split_part(name, '/', 1)
              AND lr.id::text = split_part(name, '/', 2)
              AND (
                  public.has_tenant_role(lr.tenant_id, ARRAY['ketua_rt', 'sekretaris'])
                  OR (
                      public.is_tenant_member(lr.tenant_id)
                      AND (
                          lr.requested_by_member_id = public.get_my_member_id(lr.tenant_id)
                          OR lr.resident_id = public.get_my_resident_id(lr.tenant_id)
                      )
                  )
              )
        )
    );

-- 5.5 issued-letters
CREATE POLICY storage_insert_issued_letters
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'issued-letters'
        AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
        AND NOT public.is_storage_object_path_retired('issued-letters', name)
        AND EXISTS (
            SELECT 1
            FROM public.letter_requests lr
            WHERE lr.tenant_id::text = split_part(name, '/', 1)
              AND lr.id::text = split_part(name, '/', 2)
              AND lr.status = 'approved'
              AND public.has_tenant_role(lr.tenant_id, ARRAY['ketua_rt', 'sekretaris'])
        )
    );

CREATE POLICY storage_select_issued_letters
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'issued-letters'
        AND archived_at IS NULL
        AND is_delete_marker = false
        AND NOT public.is_storage_object_deletion_pending('issued-letters', name)
        AND EXISTS (
            SELECT 1
            FROM public.letter_requests lr
            WHERE lr.tenant_id::text = split_part(name, '/', 1)
              AND lr.id::text = split_part(name, '/', 2)
              AND (
                  public.has_tenant_role(lr.tenant_id, ARRAY['ketua_rt', 'sekretaris'])
                  OR (
                      public.is_tenant_member(lr.tenant_id)
                      AND (
                          lr.requested_by_member_id = public.get_my_member_id(lr.tenant_id)
                          OR lr.resident_id = public.get_my_resident_id(lr.tenant_id)
                      )
                  )
              )
        )
    );

-- 5.6 activity-docs
CREATE POLICY storage_insert_activity_docs
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'activity-docs'
        AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|pdf)$'
        AND NOT public.is_storage_object_path_retired('activity-docs', name)
        AND EXISTS (
            SELECT 1
            FROM public.activities a
            WHERE a.tenant_id::text = split_part(name, '/', 1)
              AND a.id::text = split_part(name, '/', 2)
              AND a.deleted_at IS NULL
              AND a.status <> 'cancelled'
              AND public.has_tenant_role(a.tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
        )
    );

CREATE POLICY storage_select_activity_docs
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'activity-docs'
        AND archived_at IS NULL
        AND is_delete_marker = false
        AND NOT public.is_storage_object_deletion_pending('activity-docs', name)
        AND EXISTS (
            SELECT 1
            FROM public.activities a
            WHERE a.tenant_id::text = split_part(name, '/', 1)
              AND a.id::text = split_part(name, '/', 2)
              AND a.deleted_at IS NULL
              AND public.is_tenant_member(a.tenant_id)
        )
    );

-- =============================================================================
-- 6. Internal Queue Enqueue Helper & 8 Worker Functions (service_role only)
-- =============================================================================

-- 6.0 Internal helper called by request_* RPCs when caller already holds
--     object advisory lock + origin record FOR UPDATE lock (Step 1 & Step 2).
CREATE OR REPLACE FUNCTION public._enqueue_storage_deletion_under_lock(
    p_tenant_id uuid,
    p_bucket_id text,
    p_object_path text,
    p_entity_type text,
    p_entity_id uuid,
    p_requested_by uuid,
    p_reason text
)
RETURNS TABLE (job_id uuid, outcome text, job_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_existing record;
    v_new_id uuid;
    v_clean_reason text := COALESCE(NULLIF(btrim(p_reason), ''), 'user_requested');
BEGIN
    SELECT q.id, q.entity_type, q.entity_id, q.status
    INTO v_existing
    FROM public.storage_deletion_queue q
    WHERE q.bucket_id = p_bucket_id
      AND q.object_path = p_object_path
      AND q.status IN ('pending', 'processing', 'failed', 'exhausted')
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing.entity_type = p_entity_type AND v_existing.entity_id = p_entity_id THEN
            RETURN QUERY SELECT v_existing.id, 'already_requested'::text, v_existing.status;
            RETURN;
        ELSE
            RETURN QUERY SELECT v_existing.id, 'blocked_by_active_job'::text, v_existing.status;
            RETURN;
        END IF;
    END IF;

    BEGIN
        INSERT INTO public.storage_deletion_queue (
            tenant_id, bucket_id, object_path, entity_type, entity_id,
            requested_by, reason, status
        )
        VALUES (
            p_tenant_id, p_bucket_id, p_object_path, p_entity_type, p_entity_id,
            p_requested_by, v_clean_reason, 'pending'
        )
        RETURNING id INTO v_new_id;
    EXCEPTION WHEN unique_violation THEN
        SELECT q.id, q.entity_type, q.entity_id, q.status
        INTO v_existing
        FROM public.storage_deletion_queue q
        WHERE q.bucket_id = p_bucket_id
          AND q.object_path = p_object_path
          AND q.status IN ('pending', 'processing', 'failed', 'exhausted')
        FOR UPDATE;

        IF v_existing.entity_type = p_entity_type AND v_existing.entity_id = p_entity_id THEN
            RETURN QUERY SELECT v_existing.id, 'already_requested'::text, v_existing.status;
        ELSE
            RETURN QUERY SELECT v_existing.id, 'blocked_by_active_job'::text, v_existing.status;
        END IF;
        RETURN;
    END;

    INSERT INTO public.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    VALUES (
        p_tenant_id,
        p_requested_by,
        'storage_deletion.requested',
        'storage_deletion_queue',
        v_new_id,
        jsonb_build_object(
            'job_id', v_new_id,
            'bucket_id', p_bucket_id,
            'object_path', p_object_path,
            'target_entity_type', p_entity_type,
            'target_entity_id', p_entity_id,
            'reason', v_clean_reason
        )
    );

    RETURN QUERY SELECT v_new_id, 'created'::text, 'pending'::text;
END;
$$;

ALTER FUNCTION public._enqueue_storage_deletion_under_lock(uuid, text, text, text, uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._enqueue_storage_deletion_under_lock(uuid, text, text, text, uuid, uuid, text)
    FROM PUBLIC, anon, authenticated, service_role;

-- 6.1 Count cross-domain references regardless of soft-delete state
CREATE OR REPLACE FUNCTION public.count_storage_object_references(
    p_bucket_id text,
    p_object_path text,
    p_exclude_entity_type text DEFAULT NULL,
    p_exclude_entity_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_count integer := 0;
BEGIN
    CASE p_bucket_id
        WHEN 'resident-documents' THEN
            SELECT count(*)::integer INTO v_count
            FROM public.resident_documents rd
            WHERE rd.storage_path = p_object_path
              AND NOT (
                  p_exclude_entity_id IS NOT NULL
                  AND p_exclude_entity_type = 'resident_document'
                  AND rd.resident_id = p_exclude_entity_id
                  AND rd.storage_path = p_object_path
              );
        WHEN 'payment-proofs' THEN
            SELECT count(*)::integer INTO v_count
            FROM public.payments p
            WHERE p.proof_storage_path = p_object_path
              AND NOT (
                  p_exclude_entity_id IS NOT NULL
                  AND p_exclude_entity_type = 'payment'
                  AND p.id = p_exclude_entity_id
              );
        WHEN 'complaints' THEN
            SELECT count(*)::integer INTO v_count
            FROM public.complaints c
            WHERE c.photo_path = p_object_path
              AND NOT (
                  p_exclude_entity_id IS NOT NULL
                  AND p_exclude_entity_type = 'complaint'
                  AND c.id = p_exclude_entity_id
              );
        WHEN 'letter-requests' THEN
            SELECT count(*)::integer INTO v_count
            FROM public.letter_requests lr
            WHERE lr.supporting_doc_paths ? p_object_path
              AND NOT (
                  p_exclude_entity_id IS NOT NULL
                  AND p_exclude_entity_type = 'letter_request'
                  AND lr.id = p_exclude_entity_id
              );
        WHEN 'issued-letters' THEN
            SELECT count(*)::integer INTO v_count
            FROM public.letter_requests lr
            WHERE lr.issued_file_path = p_object_path
              AND NOT (
                  p_exclude_entity_id IS NOT NULL
                  AND p_exclude_entity_type = 'letter_request'
                  AND lr.id = p_exclude_entity_id
              );
        WHEN 'activity-docs' THEN
            SELECT count(*)::integer INTO v_count
            FROM public.activities a
            WHERE a.documentation_paths ? p_object_path
              AND NOT (
                  p_exclude_entity_id IS NOT NULL
                  AND p_exclude_entity_type = 'activity'
                  AND a.id = p_exclude_entity_id
              );
        ELSE
            RAISE EXCEPTION 'Unknown storage bucket_id: %', p_bucket_id
                USING ERRCODE = '22023';
    END CASE;

    RETURN v_count;
END;
$$;

ALTER FUNCTION public.count_storage_object_references(text, text, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.count_storage_object_references(text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_storage_object_references(text, text, text, uuid) TO service_role;

-- 6.2 Record invalid Storage path quarantine (deduplicated)
CREATE OR REPLACE FUNCTION public.record_invalid_storage_path(
    p_bucket_id text,
    p_object_path text,
    p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_existing_id uuid;
    v_new_id uuid;
BEGIN
    SELECT al.id INTO v_existing_id
    FROM public.audit_logs al
    WHERE al.action = 'storage_deletion.invalid_path_quarantined'
      AND al.entity_type = 'storage_object'
      AND al.metadata ->> 'bucket_id' = p_bucket_id
      AND al.metadata ->> 'object_path' = p_object_path
      AND al.created_at > now() - interval '24 hours'
    ORDER BY al.created_at DESC
    LIMIT 1;

    IF FOUND THEN
        RETURN v_existing_id;
    END IF;

    INSERT INTO public.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    VALUES (
        NULL,
        NULL,
        'storage_deletion.invalid_path_quarantined',
        'storage_object',
        NULL,
        jsonb_build_object(
            'bucket_id', p_bucket_id,
            'object_path', p_object_path,
            'reason', COALESCE(NULLIF(btrim(p_reason), ''), 'invalid_path')
        )
    )
    RETURNING id INTO v_new_id;

    RETURN v_new_id;
END;
$$;

ALTER FUNCTION public.record_invalid_storage_path(text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_invalid_storage_path(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_invalid_storage_path(text, text, text) TO service_role;

-- 6.3 Claim storage deletion jobs (+ expired-lease reclaim & exhaustion sweep)
CREATE OR REPLACE FUNCTION public.claim_storage_deletion_jobs(
    p_batch integer DEFAULT 10,
    p_lease interval DEFAULT interval '5 minutes'
)
RETURNS TABLE (
    job_id uuid,
    tenant_id uuid,
    bucket_id text,
    object_path text,
    entity_type text,
    entity_id uuid,
    attempt_count integer,
    claim_token uuid,
    claimed_at timestamptz,
    lease_expires_at timestamptz,
    db_now timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_batch integer := LEAST(GREATEST(COALESCE(p_batch, 10), 1), 100);
    v_lease interval := LEAST(GREATEST(COALESCE(p_lease, interval '5 minutes'), interval '1 minute'), interval '15 minutes');
    v_max_attempts integer := public.storage_deletion_max_attempts();
    v_exp record;
    v_cand record;
    v_tok uuid;
    v_ts timestamptz;
    v_err text;
BEGIN
    -- Sweep expired processing jobs that already reached max attempts -> exhausted
    FOR v_exp IN
        SELECT q.id, q.tenant_id, q.bucket_id, q.object_path, q.attempt_count, q.last_error
        FROM public.storage_deletion_queue q
        WHERE q.status = 'processing'
          AND q.lease_expires_at <= clock_timestamp()
          AND q.attempt_count >= v_max_attempts
        ORDER BY q.lease_expires_at ASC
        FOR UPDATE SKIP LOCKED
    LOOP
        v_err := COALESCE(NULLIF(btrim(v_exp.last_error), ''), 'lease_expired_max_attempts');
        UPDATE public.storage_deletion_queue q
           SET status = 'exhausted',
               claim_token = NULL,
               lease_expires_at = NULL,
               last_error = v_err
         WHERE q.id = v_exp.id
           AND q.status = 'processing'
           AND q.lease_expires_at <= clock_timestamp()
           AND q.attempt_count >= v_max_attempts;

        IF FOUND THEN
            INSERT INTO public.audit_logs (
                tenant_id, actor_user_id, action, entity_type, entity_id, metadata
            )
            VALUES (
                v_exp.tenant_id,
                NULL,
                'storage_deletion.exhausted',
                'storage_deletion_queue',
                v_exp.id,
                jsonb_build_object(
                    'job_id', v_exp.id,
                    'bucket_id', v_exp.bucket_id,
                    'object_path', v_exp.object_path,
                    'attempt_count', v_exp.attempt_count,
                    'last_error', v_err
                )
            );
        END IF;
    END LOOP;

    -- Claim pending, backoff-elapsed failed, or reclaimable expired processing jobs
    FOR v_cand IN
        SELECT q.id
        FROM public.storage_deletion_queue q
        WHERE (
            q.status = 'pending'
            OR (
                q.status = 'failed'
                AND q.attempt_count < v_max_attempts
                AND (
                    q.last_attempted_at IS NULL
                    OR q.last_attempted_at + LEAST(interval '1 minute' * power(2, GREATEST(q.attempt_count - 1, 0)), interval '60 minutes') <= clock_timestamp()
                )
            )
            OR (
                q.status = 'processing'
                AND q.lease_expires_at <= clock_timestamp()
                AND q.attempt_count < v_max_attempts
            )
        )
        ORDER BY q.requested_at ASC, q.id ASC
        LIMIT v_batch
        FOR UPDATE SKIP LOCKED
    LOOP
        v_tok := gen_random_uuid();
        v_ts := clock_timestamp();

        UPDATE public.storage_deletion_queue q
           SET status = 'processing',
               claim_token = v_tok,
               claimed_at = v_ts,
               last_attempted_at = v_ts,
               lease_expires_at = v_ts + v_lease,
               attempt_count = q.attempt_count + 1,
               decision = NULL
         WHERE q.id = v_cand.id
           AND (
               q.status = 'pending'
               OR (
                   q.status = 'failed'
                   AND q.attempt_count < v_max_attempts
                   AND (
                       q.last_attempted_at IS NULL
                       OR q.last_attempted_at + LEAST(interval '1 minute' * power(2, GREATEST(q.attempt_count - 1, 0)), interval '60 minutes') <= clock_timestamp()
                   )
               )
               OR (
                   q.status = 'processing'
                   AND q.lease_expires_at <= clock_timestamp()
                   AND q.attempt_count < v_max_attempts
               )
           )
        RETURNING q.id, q.tenant_id, q.bucket_id, q.object_path, q.entity_type, q.entity_id,
                  q.attempt_count, q.claim_token, q.claimed_at, q.lease_expires_at
        INTO job_id, tenant_id, bucket_id, object_path, entity_type, entity_id,
             attempt_count, claim_token, claimed_at, lease_expires_at;

        IF FOUND THEN
            db_now := clock_timestamp();
            RETURN NEXT;
        END IF;
    END LOOP;
END;
$$;

ALTER FUNCTION public.claim_storage_deletion_jobs(integer, interval) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_storage_deletion_jobs(integer, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_storage_deletion_jobs(integer, interval) TO service_role;

-- 6.4 Begin storage deletion (Global Lock Order 1 -> 3)
CREATE OR REPLACE FUNCTION public.begin_storage_deletion(
    p_job_id uuid,
    p_claim_token uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_bucket_id text;
    v_object_path text;
    v_job record;
    v_ref_count integer;
    v_decision text;
BEGIN
    SELECT q.bucket_id, q.object_path
    INTO v_bucket_id, v_object_path
    FROM public.storage_deletion_queue q
    WHERE q.id = p_job_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'stale_claim: job_not_found' USING ERRCODE = 'P0001';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('storage:' || v_bucket_id || '/' || v_object_path, 0));

    SELECT * INTO v_job
    FROM public.storage_deletion_queue q
    WHERE q.id = p_job_id
    FOR UPDATE;

    IF v_job.status IS DISTINCT FROM 'processing' THEN
        RAISE EXCEPTION 'stale_claim: not_processing' USING ERRCODE = 'P0001';
    ELSIF v_job.claim_token IS DISTINCT FROM p_claim_token THEN
        RAISE EXCEPTION 'stale_claim: token_mismatch' USING ERRCODE = 'P0001';
    ELSIF v_job.lease_expires_at <= clock_timestamp() THEN
        RAISE EXCEPTION 'stale_claim: lease_expired' USING ERRCODE = 'P0001';
    END IF;

    v_ref_count := public.count_storage_object_references(
        v_job.bucket_id,
        v_job.object_path,
        v_job.entity_type,
        v_job.entity_id
    );

    v_decision := CASE WHEN v_ref_count > 0 THEN 'detach_only' ELSE 'delete_physical' END;

    UPDATE public.storage_deletion_queue q
       SET decision = v_decision
     WHERE q.id = v_job.id;

    RETURN v_decision;
END;
$$;

ALTER FUNCTION public.begin_storage_deletion(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.begin_storage_deletion(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_storage_deletion(uuid, uuid) TO service_role;

-- 6.5 Renew lease (Queue-only single-row update; never renews expired lease)
CREATE OR REPLACE FUNCTION public.renew_storage_deletion_lease(
    p_job_id uuid,
    p_claim_token uuid,
    p_lease interval DEFAULT interval '5 minutes'
)
RETURNS TABLE (renewed boolean, lease_expires_at timestamptz, db_now timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_lease interval := LEAST(GREATEST(COALESCE(p_lease, interval '5 minutes'), interval '1 minute'), interval '15 minutes');
    v_new_exp timestamptz;
BEGIN
    UPDATE public.storage_deletion_queue q
       SET lease_expires_at = clock_timestamp() + v_lease
     WHERE q.id = p_job_id
       AND q.status = 'processing'
       AND q.claim_token = p_claim_token
       AND q.lease_expires_at > clock_timestamp()
    RETURNING q.lease_expires_at INTO v_new_exp;

    IF FOUND THEN
        RETURN QUERY SELECT true, v_new_exp, clock_timestamp();
    ELSE
        RETURN QUERY SELECT false, NULL::timestamptz, clock_timestamp();
    END IF;
END;
$$;

ALTER FUNCTION public.renew_storage_deletion_lease(uuid, uuid, interval) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.renew_storage_deletion_lease(uuid, uuid, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_storage_deletion_lease(uuid, uuid, interval) TO service_role;

-- 6.6 Complete storage deletion (Global Lock Order 1 -> 2 -> 3)
CREATE OR REPLACE FUNCTION public.complete_storage_deletion(
    p_job_id uuid,
    p_claim_token uuid,
    p_storage_result text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_id_row record;
    v_job record;
    v_prev_ctx text := current_setting('app.storage_ref_ctx', true);
    v_fail_status text;
    v_storage_action text;
BEGIN
    IF p_storage_result IS NULL OR p_storage_result NOT IN ('deleted', 'not_found', 'skipped') THEN
        RAISE EXCEPTION 'Invalid p_storage_result: %', p_storage_result USING ERRCODE = '22023';
    END IF;

    SELECT q.tenant_id, q.bucket_id, q.object_path, q.entity_type, q.entity_id
    INTO v_id_row
    FROM public.storage_deletion_queue q
    WHERE q.id = p_job_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'stale_claim: job_not_found' USING ERRCODE = 'P0001';
    END IF;

    -- Step 1: Object advisory lock
    PERFORM pg_advisory_xact_lock(hashtextextended('storage:' || v_id_row.bucket_id || '/' || v_id_row.object_path, 0));

    -- Step 2: Origin record FOR UPDATE (if non-orphan)
    IF v_id_row.entity_type <> 'orphan' AND v_id_row.entity_id IS NOT NULL THEN
        CASE v_id_row.entity_type
            WHEN 'resident_document' THEN
                PERFORM 1 FROM public.resident_documents rd
                 WHERE rd.tenant_id = v_id_row.tenant_id
                   AND rd.resident_id = v_id_row.entity_id
                   AND rd.storage_path = v_id_row.object_path
                 FOR UPDATE;
            WHEN 'payment' THEN
                PERFORM 1 FROM public.payments p
                 WHERE p.id = v_id_row.entity_id
                   AND p.tenant_id = v_id_row.tenant_id
                 FOR UPDATE;
            WHEN 'complaint' THEN
                PERFORM 1 FROM public.complaints c
                 WHERE c.id = v_id_row.entity_id
                   AND c.tenant_id = v_id_row.tenant_id
                 FOR UPDATE;
            WHEN 'letter_request' THEN
                PERFORM 1 FROM public.letter_requests lr
                 WHERE lr.id = v_id_row.entity_id
                   AND lr.tenant_id = v_id_row.tenant_id
                 FOR UPDATE;
            WHEN 'activity' THEN
                PERFORM 1 FROM public.activities a
                 WHERE a.id = v_id_row.entity_id
                   AND a.tenant_id = v_id_row.tenant_id
                 FOR UPDATE;
        END CASE;
    END IF;

    -- Step 3: Queue row FOR UPDATE + authoritative fencing check
    SELECT * INTO v_job
    FROM public.storage_deletion_queue q
    WHERE q.id = p_job_id
    FOR UPDATE;

    IF v_job.status IS DISTINCT FROM 'processing' THEN
        RAISE EXCEPTION 'stale_claim: not_processing' USING ERRCODE = 'P0001';
    ELSIF v_job.claim_token IS DISTINCT FROM p_claim_token THEN
        RAISE EXCEPTION 'stale_claim: token_mismatch' USING ERRCODE = 'P0001';
    ELSIF v_job.lease_expires_at <= clock_timestamp() THEN
        RAISE EXCEPTION 'stale_claim: lease_expired' USING ERRCODE = 'P0001';
    END IF;

    IF v_job.decision IS NULL THEN
        RAISE EXCEPTION 'Job % cannot complete without begin_storage_deletion() decision', v_job.id USING ERRCODE = '22023';
    ELSIF v_job.decision = 'delete_physical' AND p_storage_result NOT IN ('deleted', 'not_found') THEN
        RAISE EXCEPTION 'delete_physical requires deleted or not_found storage_result, got %', p_storage_result USING ERRCODE = '22023';
    ELSIF v_job.decision = 'detach_only' AND p_storage_result <> 'skipped' THEN
        RAISE EXCEPTION 'detach_only requires skipped storage_result, got %', p_storage_result USING ERRCODE = '22023';
    END IF;

    -- Absence re-verification under lock for physical deletions
    IF v_job.decision = 'delete_physical' AND EXISTS (
        SELECT 1
        FROM storage.objects o
        WHERE o.bucket_id = v_job.bucket_id
          AND o.name = v_job.object_path
          AND o.archived_at IS NULL
          AND o.is_delete_marker = false
    ) THEN
        v_fail_status := CASE
            WHEN v_job.attempt_count >= public.storage_deletion_max_attempts() THEN 'exhausted'
            ELSE 'failed'
        END;

        UPDATE public.storage_deletion_queue q
           SET status = v_fail_status,
               claim_token = NULL,
               lease_expires_at = NULL,
               last_error = 'object_still_present'
         WHERE q.id = v_job.id;

        IF v_fail_status = 'exhausted' THEN
            INSERT INTO public.audit_logs (
                tenant_id, actor_user_id, action, entity_type, entity_id, metadata
            )
            VALUES (
                v_job.tenant_id, NULL, 'storage_deletion.exhausted', 'storage_deletion_queue', v_job.id,
                jsonb_build_object(
                    'job_id', v_job.id, 'bucket_id', v_job.bucket_id,
                    'object_path', v_job.object_path, 'attempt_count', v_job.attempt_count,
                    'last_error', 'object_still_present'
                )
            );
        END IF;

        RETURN 'object_still_present';
    END IF;

    -- Detach domain reference atomically under postgres rpc_authorized context
    IF v_job.entity_type <> 'orphan' AND v_job.entity_id IS NOT NULL THEN
        BEGIN
            PERFORM set_config('app.storage_ref_ctx', 'rpc_authorized', true);

            CASE v_job.entity_type
                WHEN 'resident_document' THEN
                    DELETE FROM public.resident_documents rd
                     WHERE rd.tenant_id = v_job.tenant_id
                       AND rd.resident_id = v_job.entity_id
                       AND rd.storage_path = v_job.object_path;
                WHEN 'complaint' THEN
                    UPDATE public.complaints c
                       SET photo_path = NULL
                     WHERE c.id = v_job.entity_id
                       AND c.tenant_id = v_job.tenant_id
                       AND c.photo_path = v_job.object_path;
                WHEN 'letter_request' THEN
                    IF v_job.bucket_id = 'letter-requests' THEN
                        UPDATE public.letter_requests lr
                           SET supporting_doc_paths = COALESCE(
                               (
                                   SELECT jsonb_agg(to_jsonb(elem))
                                   FROM jsonb_array_elements_text(lr.supporting_doc_paths) AS elem
                                   WHERE elem <> v_job.object_path
                               ),
                               '[]'::jsonb
                           )
                         WHERE lr.id = v_job.entity_id
                           AND lr.tenant_id = v_job.tenant_id
                           AND lr.supporting_doc_paths ? v_job.object_path;
                    ELSIF v_job.bucket_id = 'issued-letters' THEN
                        UPDATE public.letter_requests lr
                           SET issued_file_path = NULL
                         WHERE lr.id = v_job.entity_id
                           AND lr.tenant_id = v_job.tenant_id
                           AND lr.issued_file_path = v_job.object_path;
                    END IF;
                WHEN 'activity' THEN
                    UPDATE public.activities a
                       SET documentation_paths = COALESCE(
                           (
                               SELECT jsonb_agg(to_jsonb(elem))
                               FROM jsonb_array_elements_text(a.documentation_paths) AS elem
                               WHERE elem <> v_job.object_path
                           ),
                           '[]'::jsonb
                       )
                     WHERE a.id = v_job.entity_id
                       AND a.tenant_id = v_job.tenant_id
                       AND a.documentation_paths ? v_job.object_path;
                WHEN 'payment' THEN
                    -- Payment proofs are never user-deletable
                    NULL;
            END CASE;

            PERFORM set_config('app.storage_ref_ctx', COALESCE(v_prev_ctx, ''), true);
        EXCEPTION WHEN OTHERS THEN
            PERFORM set_config('app.storage_ref_ctx', COALESCE(v_prev_ctx, ''), true);
            RAISE;
        END;
    END IF;

    v_storage_action := CASE
        WHEN v_job.decision = 'detach_only' THEN 'skipped_shared_reference'
        ELSE p_storage_result
    END;

    UPDATE public.storage_deletion_queue q
       SET status = 'completed',
           completed_at = clock_timestamp(),
           claim_token = NULL,
           lease_expires_at = NULL,
           last_error = NULL,
           metadata = jsonb_build_object('storage_action', v_storage_action)
     WHERE q.id = v_job.id;

    INSERT INTO public.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    VALUES (
        v_job.tenant_id,
        NULL,
        'storage_deletion.completed',
        'storage_deletion_queue',
        v_job.id,
        jsonb_build_object(
            'job_id', v_job.id,
            'bucket_id', v_job.bucket_id,
            'object_path', v_job.object_path,
            'attempt_count', v_job.attempt_count,
            'decision', v_job.decision,
            'storage_result', p_storage_result,
            'storage_action', v_storage_action,
            'requested_by', v_job.requested_by,
            'reason', v_job.reason
        )
    );

    RETURN 'completed';
END;
$$;

ALTER FUNCTION public.complete_storage_deletion(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.complete_storage_deletion(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_storage_deletion(uuid, uuid, text) TO service_role;

-- 6.7 Fail storage deletion (Global Lock Order 1 -> 3)
CREATE OR REPLACE FUNCTION public.fail_storage_deletion(
    p_job_id uuid,
    p_claim_token uuid,
    p_error text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_bucket_id text;
    v_object_path text;
    v_job record;
    v_new_status text;
    v_err text := COALESCE(NULLIF(btrim(p_error), ''), 'storage_deletion_failed');
BEGIN
    SELECT q.bucket_id, q.object_path
    INTO v_bucket_id, v_object_path
    FROM public.storage_deletion_queue q
    WHERE q.id = p_job_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'stale_claim: job_not_found' USING ERRCODE = 'P0001';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('storage:' || v_bucket_id || '/' || v_object_path, 0));

    SELECT * INTO v_job
    FROM public.storage_deletion_queue q
    WHERE q.id = p_job_id
    FOR UPDATE;

    IF v_job.status IS DISTINCT FROM 'processing' THEN
        RAISE EXCEPTION 'stale_claim: not_processing' USING ERRCODE = 'P0001';
    ELSIF v_job.claim_token IS DISTINCT FROM p_claim_token THEN
        RAISE EXCEPTION 'stale_claim: token_mismatch' USING ERRCODE = 'P0001';
    ELSIF v_job.lease_expires_at <= clock_timestamp() THEN
        RAISE EXCEPTION 'stale_claim: lease_expired' USING ERRCODE = 'P0001';
    END IF;

    v_new_status := CASE
        WHEN v_job.attempt_count >= public.storage_deletion_max_attempts() THEN 'exhausted'
        ELSE 'failed'
    END;

    UPDATE public.storage_deletion_queue q
       SET status = v_new_status,
           claim_token = NULL,
           lease_expires_at = NULL,
           last_error = v_err
     WHERE q.id = v_job.id;

    IF v_new_status = 'exhausted' THEN
        INSERT INTO public.audit_logs (
            tenant_id, actor_user_id, action, entity_type, entity_id, metadata
        )
        VALUES (
            v_job.tenant_id,
            NULL,
            'storage_deletion.exhausted',
            'storage_deletion_queue',
            v_job.id,
            jsonb_build_object(
                'job_id', v_job.id,
                'bucket_id', v_job.bucket_id,
                'object_path', v_job.object_path,
                'attempt_count', v_job.attempt_count,
                'last_error', v_err
            )
        );
    END IF;

    RETURN v_new_status;
END;
$$;

ALTER FUNCTION public.fail_storage_deletion(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fail_storage_deletion(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_storage_deletion(uuid, uuid, text) TO service_role;

-- 6.8 Enqueue orphan storage deletion (Global Lock Order 1 -> 3)
CREATE OR REPLACE FUNCTION public.enqueue_orphan_storage_deletion(
    p_bucket_id text,
    p_object_path text,
    p_orphan_retention interval DEFAULT interval '24 hours'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_retention interval := GREATEST(COALESCE(p_orphan_retention, interval '24 hours'), interval '0 seconds');
    v_obj_created timestamptz;
    v_tenant_id uuid;
BEGIN
    IF p_bucket_id IS NULL OR p_bucket_id NOT IN (
        'resident-documents', 'payment-proofs', 'complaints',
        'letter-requests', 'issued-letters', 'activity-docs'
    )
    OR p_object_path IS NULL
    OR p_object_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$' THEN
        RETURN 'rejected_invalid_path';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('storage:' || p_bucket_id || '/' || p_object_path, 0));

    SELECT o.created_at INTO v_obj_created
    FROM storage.objects o
    WHERE o.bucket_id = p_bucket_id
      AND o.name = p_object_path
      AND o.archived_at IS NULL
      AND o.is_delete_marker = false;

    IF NOT FOUND OR v_obj_created > now() - v_retention THEN
        RETURN 'skipped_too_young';
    END IF;

    IF public.count_storage_object_references(p_bucket_id, p_object_path, NULL, NULL) > 0 THEN
        RETURN 'skipped_referenced';
    END IF;

    IF public.is_storage_object_deletion_pending(p_bucket_id, p_object_path) THEN
        RETURN 'skipped_active_job';
    END IF;

    v_tenant_id := split_part(p_object_path, '/', 1)::uuid;

    BEGIN
        INSERT INTO public.storage_deletion_queue (
            tenant_id, bucket_id, object_path, entity_type, entity_id,
            requested_by, reason, status
        )
        VALUES (
            v_tenant_id, p_bucket_id, p_object_path, 'orphan', NULL,
            NULL, 'orphan_cleanup', 'pending'
        );
    EXCEPTION WHEN foreign_key_violation THEN
        PERFORM public.record_invalid_storage_path(p_bucket_id, p_object_path, 'unknown_tenant');
        RETURN 'rejected_unknown_tenant';
    WHEN unique_violation THEN
        RETURN 'skipped_active_job';
    END;

    RETURN 'created';
END;
$$;

ALTER FUNCTION public.enqueue_orphan_storage_deletion(text, text, interval) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enqueue_orphan_storage_deletion(text, text, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_orphan_storage_deletion(text, text, interval) TO service_role;

-- =============================================================================
-- 7. Recovery & Monitoring RPCs (super_admin + service_role retry)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.retry_storage_deletion_job(
    p_job_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_bucket_id text;
    v_object_path text;
    v_job record;
    v_actor uuid := auth.uid();
BEGIN
    IF current_user <> 'service_role' AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Forbidden: requires super_admin or service_role' USING ERRCODE = '42501';
    END IF;

    SELECT q.bucket_id, q.object_path INTO v_bucket_id, v_object_path
    FROM public.storage_deletion_queue q
    WHERE q.id = p_job_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Deletion job % not found', p_job_id USING ERRCODE = 'P0002';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('storage:' || v_bucket_id || '/' || v_object_path, 0));

    SELECT * INTO v_job
    FROM public.storage_deletion_queue q
    WHERE q.id = p_job_id
    FOR UPDATE;

    IF v_job.status NOT IN ('failed', 'exhausted') THEN
        RAISE EXCEPTION 'Only failed or exhausted jobs can be retried (status=%)', v_job.status
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.storage_deletion_queue q
       SET status = 'pending',
           attempt_count = 0,
           claim_token = NULL,
           claimed_at = NULL,
           lease_expires_at = NULL,
           decision = NULL,
           last_error = NULL
     WHERE q.id = v_job.id;

    INSERT INTO public.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    VALUES (
        v_job.tenant_id,
        v_actor,
        'storage_deletion.manual_retry',
        'storage_deletion_queue',
        v_job.id,
        jsonb_build_object(
            'job_id', v_job.id,
            'bucket_id', v_job.bucket_id,
            'object_path', v_job.object_path,
            'previous_status', v_job.status
        )
    );
END;
$$;

ALTER FUNCTION public.retry_storage_deletion_job(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.retry_storage_deletion_job(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_storage_deletion_job(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_storage_deletion_jobs_needing_attention(
    p_limit integer DEFAULT 50
)
RETURNS TABLE (
    id uuid,
    tenant_id uuid,
    bucket_id text,
    object_path text,
    entity_type text,
    entity_id uuid,
    status text,
    attempt_count integer,
    last_error text,
    requested_at timestamptz,
    last_attempted_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Forbidden: super_admin only' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT q.id, q.tenant_id, q.bucket_id, q.object_path, q.entity_type, q.entity_id,
           q.status, q.attempt_count, q.last_error, q.requested_at, q.last_attempted_at
    FROM public.storage_deletion_queue q
    WHERE q.status IN ('failed', 'exhausted')
       OR (q.status = 'processing' AND q.lease_expires_at <= clock_timestamp())
    ORDER BY q.requested_at ASC
    LIMIT v_limit;
END;
$$;

ALTER FUNCTION public.list_storage_deletion_jobs_needing_attention(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_storage_deletion_jobs_needing_attention(integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_storage_deletion_jobs_needing_attention(integer) TO authenticated;

-- =============================================================================
-- 8. Finance Atomic RPCs (authenticated only)
-- =============================================================================

-- 8.1 verify_payment
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

-- 8.2 reject_payment
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

-- 8.3 refund_payment
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

    RETURN v_refund_id;
END;
$$;

ALTER FUNCTION public.refund_payment(uuid, numeric, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.refund_payment(uuid, numeric, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.refund_payment(uuid, numeric, uuid, text) TO authenticated;

-- 8.4 attach_payment_proof (compatible with 0014 guard_payments_proof_path)
CREATE OR REPLACE FUNCTION public.attach_payment_proof(
    p_payment_id uuid,
    p_storage_path text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_pay record;
    v_bill record;
    v_prev_ctx text := current_setting('app.storage_ref_ctx', true);
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    IF p_storage_path IS NULL
       OR p_storage_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|pdf)$' THEN
        RAISE EXCEPTION 'Invalid payment proof storage path: %', p_storage_path USING ERRCODE = '22023';
    END IF;

    -- Global Lock Order: 1. object advisory lock -> 2. payment row FOR UPDATE
    PERFORM pg_advisory_xact_lock(hashtextextended('storage:payment-proofs/' || p_storage_path, 0));

    SELECT p.*, b.household_id AS bill_household_id, b.resident_id AS bill_resident_id
    INTO v_pay
    FROM public.payments p
    JOIN public.bills b ON b.id = p.bill_id AND b.tenant_id = p.tenant_id
    WHERE p.id = p_payment_id
    FOR UPDATE OF p;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment % not found', p_payment_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.is_tenant_member(v_pay.tenant_id)
       OR NOT (
           v_pay.paid_by_user_id = v_actor
           OR v_pay.bill_household_id = public.get_my_household_id(v_pay.tenant_id)
           OR v_pay.bill_resident_id = public.get_my_resident_id(v_pay.tenant_id)
       ) THEN
        RAISE EXCEPTION 'Forbidden: caller does not own payment %', p_payment_id USING ERRCODE = '42501';
    END IF;

    IF v_pay.payment_type <> 'payment' OR v_pay.status <> 'pending' THEN
        RAISE EXCEPTION 'Proof can only be attached to a pending payment' USING ERRCODE = '22023';
    END IF;

    IF split_part(p_storage_path, '/', 1) <> v_pay.tenant_id::text
       OR split_part(p_storage_path, '/', 2) <> v_pay.id::text THEN
        RAISE EXCEPTION 'Payment proof path tenant/payment segment mismatch' USING ERRCODE = '22023';
    END IF;

    IF public.is_storage_object_deletion_pending('payment-proofs', p_storage_path)
       OR public.is_storage_object_path_retired('payment-proofs', p_storage_path) THEN
        RAISE EXCEPTION 'Payment proof path is pending deletion or retired' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM storage.objects o
        WHERE o.bucket_id = 'payment-proofs'
          AND o.name = p_storage_path
          AND o.archived_at IS NULL
          AND o.is_delete_marker = false
    ) THEN
        RAISE EXCEPTION 'Payment proof object does not exist in storage: %', p_storage_path
            USING ERRCODE = '23503';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.payments op
        WHERE op.proof_storage_path = p_storage_path
          AND op.id <> v_pay.id
    ) THEN
        RAISE EXCEPTION 'Payment proof path already attached to another payment' USING ERRCODE = '23505';
    END IF;

    BEGIN
        PERFORM set_config('app.storage_ref_ctx', 'attach_payment_proof', true);

        UPDATE public.payments p
           SET proof_storage_path = p_storage_path
         WHERE p.id = v_pay.id;

        PERFORM set_config('app.storage_ref_ctx', COALESCE(v_prev_ctx, ''), true);
    EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('app.storage_ref_ctx', COALESCE(v_prev_ctx, ''), true);
        RAISE;
    END;

    -- Transition bill to pending_verification if unpaid/overdue
    SELECT * INTO v_bill
    FROM public.bills b
    WHERE b.id = v_pay.bill_id
      AND b.tenant_id = v_pay.tenant_id
    FOR UPDATE;

    IF v_bill.status IN ('unpaid', 'overdue') THEN
        UPDATE public.bills b
           SET status = 'pending_verification'
         WHERE b.id = v_bill.id;
    END IF;

    INSERT INTO public.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    VALUES (
        v_pay.tenant_id,
        v_actor,
        'payment.proof_attached',
        'payments',
        v_pay.id,
        jsonb_build_object('proof_storage_path', p_storage_path)
    );
END;
$$;

ALTER FUNCTION public.attach_payment_proof(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.attach_payment_proof(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.attach_payment_proof(uuid, text) TO authenticated;

-- =============================================================================
-- 9. Complaints Atomic RPCs (authenticated only)
-- =============================================================================

-- 9.1 transition_complaint_status
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
END;
$$;

ALTER FUNCTION public.transition_complaint_status(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.transition_complaint_status(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.transition_complaint_status(uuid, text, text) TO authenticated;

-- 9.2 attach_complaint_photo (Global Lock Order 1 -> 2)
CREATE OR REPLACE FUNCTION public.attach_complaint_photo(
    p_complaint_id uuid,
    p_storage_path text
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
    v_prev_ctx text := current_setting('app.storage_ref_ctx', true);
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    IF p_storage_path IS NULL
       OR p_storage_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$' THEN
        RAISE EXCEPTION 'Invalid complaint photo storage path: %', p_storage_path USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('storage:complaints/' || p_storage_path, 0));

    SELECT * INTO v_c
    FROM public.complaints c
    WHERE c.id = p_complaint_id
    FOR UPDATE;

    IF NOT FOUND OR v_c.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Complaint % not found or deleted', p_complaint_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.is_tenant_member(v_c.tenant_id)
       OR v_c.reporter_member_id IS DISTINCT FROM public.get_my_member_id(v_c.tenant_id) THEN
        RAISE EXCEPTION 'Forbidden: only active reporter can attach complaint photo' USING ERRCODE = '42501';
    END IF;

    IF v_c.status <> 'open' THEN
        RAISE EXCEPTION 'Complaint photo can only be attached while open' USING ERRCODE = '22023';
    END IF;

    IF split_part(p_storage_path, '/', 1) <> v_c.tenant_id::text
       OR split_part(p_storage_path, '/', 2) <> v_c.id::text THEN
        RAISE EXCEPTION 'Complaint photo path tenant/complaint segment mismatch' USING ERRCODE = '22023';
    END IF;

    IF public.is_storage_object_deletion_pending('complaints', p_storage_path)
       OR public.is_storage_object_path_retired('complaints', p_storage_path) THEN
        RAISE EXCEPTION 'Complaint photo path is pending deletion or retired' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM storage.objects o
        WHERE o.bucket_id = 'complaints'
          AND o.name = p_storage_path
          AND o.archived_at IS NULL
          AND o.is_delete_marker = false
    ) THEN
        RAISE EXCEPTION 'Complaint photo object does not exist in storage: %', p_storage_path
            USING ERRCODE = '23503';
    END IF;

    BEGIN
        PERFORM set_config('app.storage_ref_ctx', 'rpc_authorized', true);
        UPDATE public.complaints c
           SET photo_path = p_storage_path
         WHERE c.id = v_c.id;
        PERFORM set_config('app.storage_ref_ctx', COALESCE(v_prev_ctx, ''), true);
    EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('app.storage_ref_ctx', COALESCE(v_prev_ctx, ''), true);
        RAISE;
    END;

    INSERT INTO public.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    VALUES (
        v_c.tenant_id,
        v_actor,
        'complaint.photo_attached',
        'complaints',
        v_c.id,
        jsonb_build_object('photo_path', p_storage_path)
    );
END;
$$;

ALTER FUNCTION public.attach_complaint_photo(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.attach_complaint_photo(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.attach_complaint_photo(uuid, text) TO authenticated;

-- 9.3 request_delete_complaint_photo (Global Lock Order 1 -> 2 -> 3)
CREATE OR REPLACE FUNCTION public.request_delete_complaint_photo(
    p_complaint_id uuid,
    p_reason text DEFAULT 'user_requested'
)
RETURNS TABLE (job_id uuid, outcome text, job_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_path text;
    v_c record;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    SELECT c.photo_path INTO v_path
    FROM public.complaints c
    WHERE c.id = p_complaint_id;

    IF NOT FOUND OR v_path IS NULL THEN
        RAISE EXCEPTION 'Complaint % has no photo_path', p_complaint_id USING ERRCODE = 'P0002';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('storage:complaints/' || v_path, 0));

    SELECT * INTO v_c
    FROM public.complaints c
    WHERE c.id = p_complaint_id
    FOR UPDATE;

    IF v_c.photo_path IS DISTINCT FROM v_path OR v_c.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Complaint % photo unavailable or deleted', p_complaint_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT (
        public.has_tenant_role(v_c.tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
        OR (
            public.is_tenant_member(v_c.tenant_id)
            AND v_c.reporter_member_id = public.get_my_member_id(v_c.tenant_id)
            AND v_c.status = 'open'
        )
    ) THEN
        RAISE EXCEPTION 'Forbidden: caller cannot delete photo on complaint %', p_complaint_id
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT q.job_id, q.outcome, q.job_status
    FROM public._enqueue_storage_deletion_under_lock(
        v_c.tenant_id, 'complaints', v_path, 'complaint', v_c.id, v_actor, p_reason
    ) AS q;
END;
$$;

ALTER FUNCTION public.request_delete_complaint_photo(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.request_delete_complaint_photo(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.request_delete_complaint_photo(uuid, text) TO authenticated;

-- =============================================================================
-- 10. Letter Request Atomic RPCs (authenticated only)
-- =============================================================================

-- 10.1 review_letter_request
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
END;
$$;

ALTER FUNCTION public.review_letter_request(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.review_letter_request(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.review_letter_request(uuid, text, text) TO authenticated;

-- 10.2 cancel_letter_request (submitted only; record-only, retention cleans files)
CREATE OR REPLACE FUNCTION public.cancel_letter_request(
    p_request_id uuid,
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
    v_lr record;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_lr
    FROM public.letter_requests lr
    WHERE lr.id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Letter request % not found', p_request_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.is_tenant_member(v_lr.tenant_id)
       OR v_lr.requested_by_member_id IS DISTINCT FROM public.get_my_member_id(v_lr.tenant_id) THEN
        RAISE EXCEPTION 'Forbidden: only requester can cancel letter request' USING ERRCODE = '42501';
    END IF;

    IF v_lr.status <> 'submitted' THEN
        RAISE EXCEPTION 'Only submitted letter requests can be cancelled (status=%)', v_lr.status
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.letter_requests lr
       SET status = 'cancelled',
           admin_notes = COALESCE(NULLIF(btrim(p_reason), ''), lr.admin_notes)
     WHERE lr.id = v_lr.id;

    INSERT INTO public.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    VALUES (
        v_lr.tenant_id,
        v_actor,
        'letter_request.cancelled',
        'letter_requests',
        v_lr.id,
        jsonb_build_object('reason', NULLIF(btrim(p_reason), ''))
    );
END;
$$;

ALTER FUNCTION public.cancel_letter_request(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_letter_request(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_letter_request(uuid, text) TO authenticated;

-- 10.3 issue_letter (Global Lock Order 1 -> 2 + atomic letter_sequences increment)
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

    RETURN v_letter_number;
END;
$$;

ALTER FUNCTION public.issue_letter(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_letter(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.issue_letter(uuid, text) TO authenticated;

-- 10.4 attach_letter_supporting_doc (Global Lock Order 1 -> 2)
CREATE OR REPLACE FUNCTION public.attach_letter_supporting_doc(
    p_request_id uuid,
    p_storage_path text
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
    v_prev_ctx text := current_setting('app.storage_ref_ctx', true);
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    IF p_storage_path IS NULL
       OR p_storage_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|pdf)$' THEN
        RAISE EXCEPTION 'Invalid supporting doc storage path: %', p_storage_path USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('storage:letter-requests/' || p_storage_path, 0));

    SELECT * INTO v_lr
    FROM public.letter_requests lr
    WHERE lr.id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Letter request % not found', p_request_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.is_tenant_member(v_lr.tenant_id)
       OR v_lr.requested_by_member_id IS DISTINCT FROM public.get_my_member_id(v_lr.tenant_id) THEN
        RAISE EXCEPTION 'Forbidden: only requester can attach supporting docs' USING ERRCODE = '42501';
    END IF;

    IF v_lr.status <> 'submitted' THEN
        RAISE EXCEPTION 'Supporting docs can only be attached while submitted' USING ERRCODE = '22023';
    END IF;

    IF split_part(p_storage_path, '/', 1) <> v_lr.tenant_id::text
       OR split_part(p_storage_path, '/', 2) <> v_lr.id::text THEN
        RAISE EXCEPTION 'Supporting doc path tenant/request segment mismatch' USING ERRCODE = '22023';
    END IF;

    IF public.is_storage_object_deletion_pending('letter-requests', p_storage_path)
       OR public.is_storage_object_path_retired('letter-requests', p_storage_path) THEN
        RAISE EXCEPTION 'Supporting doc path is pending deletion or retired' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM storage.objects o
        WHERE o.bucket_id = 'letter-requests'
          AND o.name = p_storage_path
          AND o.archived_at IS NULL
          AND o.is_delete_marker = false
    ) THEN
        RAISE EXCEPTION 'Supporting doc object does not exist in storage: %', p_storage_path
            USING ERRCODE = '23503';
    END IF;

    IF v_lr.supporting_doc_paths ? p_storage_path THEN
        RAISE EXCEPTION 'Supporting doc already attached: %', p_storage_path USING ERRCODE = '23505';
    END IF;

    BEGIN
        PERFORM set_config('app.storage_ref_ctx', 'rpc_authorized', true);
        UPDATE public.letter_requests lr
           SET supporting_doc_paths = lr.supporting_doc_paths || jsonb_build_array(p_storage_path)
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
        'letter_request.supporting_doc_attached',
        'letter_requests',
        v_lr.id,
        jsonb_build_object('storage_path', p_storage_path)
    );
END;
$$;

ALTER FUNCTION public.attach_letter_supporting_doc(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.attach_letter_supporting_doc(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.attach_letter_supporting_doc(uuid, text) TO authenticated;

-- 10.5 request_remove_letter_supporting_doc (Global Lock Order 1 -> 2 -> 3)
CREATE OR REPLACE FUNCTION public.request_remove_letter_supporting_doc(
    p_request_id uuid,
    p_storage_path text,
    p_reason text DEFAULT 'user_requested'
)
RETURNS TABLE (job_id uuid, outcome text, job_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_lr record;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    IF p_storage_path IS NULL THEN
        RAISE EXCEPTION 'p_storage_path is required' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('storage:letter-requests/' || p_storage_path, 0));

    SELECT * INTO v_lr
    FROM public.letter_requests lr
    WHERE lr.id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Letter request % not found', p_request_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT (
        (public.has_tenant_role(v_lr.tenant_id, ARRAY['ketua_rt', 'sekretaris']) AND v_lr.status IN ('submitted', 'reviewing'))
        OR (
            public.is_tenant_member(v_lr.tenant_id)
            AND v_lr.requested_by_member_id = public.get_my_member_id(v_lr.tenant_id)
            AND v_lr.status = 'submitted'
        )
    ) THEN
        RAISE EXCEPTION 'Forbidden or invalid status for removing supporting doc' USING ERRCODE = '42501';
    END IF;

    IF NOT (v_lr.supporting_doc_paths ? p_storage_path) THEN
        RAISE EXCEPTION 'Supporting doc path not referenced by letter_request %', p_request_id
            USING ERRCODE = 'P0002';
    END IF;

    RETURN QUERY
    SELECT q.job_id, q.outcome, q.job_status
    FROM public._enqueue_storage_deletion_under_lock(
        v_lr.tenant_id, 'letter-requests', p_storage_path, 'letter_request', v_lr.id, v_actor, p_reason
    ) AS q;
END;
$$;

ALTER FUNCTION public.request_remove_letter_supporting_doc(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.request_remove_letter_supporting_doc(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.request_remove_letter_supporting_doc(uuid, text, text) TO authenticated;

-- =============================================================================
-- 11. Resident Document Atomic RPCs (authenticated only)
-- =============================================================================

-- 11.1 verify_resident_document
CREATE OR REPLACE FUNCTION public.verify_resident_document(
    p_document_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_doc record;
    v_prev_ctx text := current_setting('app.storage_ref_ctx', true);
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_doc
    FROM public.resident_documents rd
    WHERE rd.id = p_document_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Resident document % not found', p_document_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.has_tenant_role(v_doc.tenant_id, ARRAY['ketua_rt', 'sekretaris']) THEN
        RAISE EXCEPTION 'Forbidden: requires ketua_rt or sekretaris' USING ERRCODE = '42501';
    END IF;

    IF v_doc.verified_at IS NOT NULL THEN
        RAISE EXCEPTION 'Resident document % is already verified', p_document_id USING ERRCODE = '22023';
    END IF;

    BEGIN
        PERFORM set_config('app.storage_ref_ctx', 'rpc_authorized', true);
        UPDATE public.resident_documents rd
           SET verified_by = v_actor,
               verified_at = now()
         WHERE rd.id = v_doc.id;
        PERFORM set_config('app.storage_ref_ctx', COALESCE(v_prev_ctx, ''), true);
    EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('app.storage_ref_ctx', COALESCE(v_prev_ctx, ''), true);
        RAISE;
    END;

    INSERT INTO public.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    VALUES (
        v_doc.tenant_id,
        v_actor,
        'resident_document.verified',
        'resident_documents',
        v_doc.id,
        jsonb_build_object(
            'resident_id', v_doc.resident_id,
            'document_type', v_doc.document_type,
            'storage_path', v_doc.storage_path
        )
    );
END;
$$;

ALTER FUNCTION public.verify_resident_document(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.verify_resident_document(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.verify_resident_document(uuid) TO authenticated;

-- 11.2 request_delete_resident_document (Global Lock Order 1 -> 2 -> 3; segment 2 = resident_id)
CREATE OR REPLACE FUNCTION public.request_delete_resident_document(
    p_document_id uuid,
    p_reason text DEFAULT 'user_requested'
)
RETURNS TABLE (job_id uuid, outcome text, job_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_path text;
    v_doc record;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    SELECT rd.storage_path INTO v_path
    FROM public.resident_documents rd
    WHERE rd.id = p_document_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Resident document % not found', p_document_id USING ERRCODE = 'P0002';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('storage:resident-documents/' || v_path, 0));

    SELECT * INTO v_doc
    FROM public.resident_documents rd
    WHERE rd.id = p_document_id
    FOR UPDATE;

    IF NOT FOUND OR v_doc.storage_path IS DISTINCT FROM v_path THEN
        RAISE EXCEPTION 'Resident document % no longer exists', p_document_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT (
        public.has_tenant_role(v_doc.tenant_id, ARRAY['ketua_rt', 'sekretaris'])
        OR (
            public.is_tenant_member(v_doc.tenant_id)
            AND v_doc.resident_id = public.get_my_resident_id(v_doc.tenant_id)
            AND v_doc.verified_by IS NULL
            AND v_doc.verified_at IS NULL
        )
    ) THEN
        RAISE EXCEPTION 'Forbidden: warga can only delete unverified own documents'
            USING ERRCODE = '42501';
    END IF;

    -- Note F4: segment 2 = v_doc.resident_id (owner identity on queue)
    RETURN QUERY
    SELECT q.job_id, q.outcome, q.job_status
    FROM public._enqueue_storage_deletion_under_lock(
        v_doc.tenant_id, 'resident-documents', v_doc.storage_path,
        'resident_document', v_doc.resident_id, v_actor, p_reason
    ) AS q;
END;
$$;

ALTER FUNCTION public.request_delete_resident_document(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.request_delete_resident_document(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.request_delete_resident_document(uuid, text) TO authenticated;

-- =============================================================================
-- 12. Activities Atomic RPCs (authenticated only)
-- =============================================================================

-- 12.1 transition_activity_status
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
END;
$$;

ALTER FUNCTION public.transition_activity_status(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.transition_activity_status(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.transition_activity_status(uuid, text) TO authenticated;

-- 12.2 soft_delete_activity (record-only; retention scan handles docs)
CREATE OR REPLACE FUNCTION public.soft_delete_activity(
    p_activity_id uuid,
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
    v_act record;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_act
    FROM public.activities a
    WHERE a.id = p_activity_id
    FOR UPDATE;

    IF NOT FOUND OR v_act.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Activity % not found or already deleted', p_activity_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.has_tenant_role(v_act.tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus']) THEN
        RAISE EXCEPTION 'Forbidden: requires staff role' USING ERRCODE = '42501';
    END IF;

    UPDATE public.activities a
       SET deleted_at = now()
     WHERE a.id = v_act.id;

    INSERT INTO public.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    VALUES (
        v_act.tenant_id,
        v_actor,
        'activity.soft_deleted',
        'activities',
        v_act.id,
        jsonb_build_object('reason', NULLIF(btrim(p_reason), ''), 'status_at_delete', v_act.status)
    );
END;
$$;

ALTER FUNCTION public.soft_delete_activity(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.soft_delete_activity(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.soft_delete_activity(uuid, text) TO authenticated;

-- 12.3 attach_activity_doc (Global Lock Order 1 -> 2, max 20 items)
CREATE OR REPLACE FUNCTION public.attach_activity_doc(
    p_activity_id uuid,
    p_storage_path text
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
    v_prev_ctx text := current_setting('app.storage_ref_ctx', true);
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    IF p_storage_path IS NULL
       OR p_storage_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|pdf)$' THEN
        RAISE EXCEPTION 'Invalid activity doc storage path: %', p_storage_path USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('storage:activity-docs/' || p_storage_path, 0));

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

    IF v_act.status = 'cancelled' THEN
        RAISE EXCEPTION 'Cannot attach docs to a cancelled activity' USING ERRCODE = '22023';
    END IF;

    IF split_part(p_storage_path, '/', 1) <> v_act.tenant_id::text
       OR split_part(p_storage_path, '/', 2) <> v_act.id::text THEN
        RAISE EXCEPTION 'Activity doc path tenant/activity segment mismatch' USING ERRCODE = '22023';
    END IF;

    IF public.is_storage_object_deletion_pending('activity-docs', p_storage_path)
       OR public.is_storage_object_path_retired('activity-docs', p_storage_path) THEN
        RAISE EXCEPTION 'Activity doc path is pending deletion or retired' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM storage.objects o
        WHERE o.bucket_id = 'activity-docs'
          AND o.name = p_storage_path
          AND o.archived_at IS NULL
          AND o.is_delete_marker = false
    ) THEN
        RAISE EXCEPTION 'Activity doc object does not exist in storage: %', p_storage_path
            USING ERRCODE = '23503';
    END IF;

    IF v_act.documentation_paths ? p_storage_path THEN
        RAISE EXCEPTION 'Activity doc already attached: %', p_storage_path USING ERRCODE = '23505';
    END IF;

    IF jsonb_array_length(v_act.documentation_paths) >= 20 THEN
        RAISE EXCEPTION 'Activity documentation limit (20 objects) exceeded' USING ERRCODE = '23514';
    END IF;

    BEGIN
        PERFORM set_config('app.storage_ref_ctx', 'rpc_authorized', true);
        UPDATE public.activities a
           SET documentation_paths = a.documentation_paths || jsonb_build_array(p_storage_path)
         WHERE a.id = v_act.id;
        PERFORM set_config('app.storage_ref_ctx', COALESCE(v_prev_ctx, ''), true);
    EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('app.storage_ref_ctx', COALESCE(v_prev_ctx, ''), true);
        RAISE;
    END;

    INSERT INTO public.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    VALUES (
        v_act.tenant_id,
        v_actor,
        'activity.doc_attached',
        'activities',
        v_act.id,
        jsonb_build_object('storage_path', p_storage_path)
    );
END;
$$;

ALTER FUNCTION public.attach_activity_doc(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.attach_activity_doc(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.attach_activity_doc(uuid, text) TO authenticated;

-- 12.4 remove_activity_doc (Global Lock Order 1 -> 2 -> 3)
CREATE OR REPLACE FUNCTION public.remove_activity_doc(
    p_activity_id uuid,
    p_storage_path text,
    p_reason text DEFAULT 'user_requested'
)
RETURNS TABLE (job_id uuid, outcome text, job_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_act record;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    IF p_storage_path IS NULL THEN
        RAISE EXCEPTION 'p_storage_path is required' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('storage:activity-docs/' || p_storage_path, 0));

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

    IF NOT (v_act.documentation_paths ? p_storage_path) THEN
        RAISE EXCEPTION 'Storage path not referenced by activity %', p_activity_id USING ERRCODE = 'P0002';
    END IF;

    RETURN QUERY
    SELECT q.job_id, q.outcome, q.job_status
    FROM public._enqueue_storage_deletion_under_lock(
        v_act.tenant_id, 'activity-docs', p_storage_path, 'activity', v_act.id, v_actor, p_reason
    ) AS q;
END;
$$;

ALTER FUNCTION public.remove_activity_doc(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.remove_activity_doc(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.remove_activity_doc(uuid, text, text) TO authenticated;

-- 12.5 record_activity_attendance
CREATE OR REPLACE FUNCTION public.record_activity_attendance(
    p_activity_id uuid,
    p_resident_id uuid,
    p_rsvp_status text
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
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    IF p_rsvp_status IS NULL OR p_rsvp_status NOT IN ('invited', 'attending', 'attended', 'absent') THEN
        RAISE EXCEPTION 'Invalid attendance status: %', p_rsvp_status USING ERRCODE = '22023';
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

    IF v_act.status = 'cancelled' THEN
        RAISE EXCEPTION 'Cannot record attendance on cancelled activity' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.residents r
        WHERE r.id = p_resident_id
          AND r.tenant_id = v_act.tenant_id
          AND r.deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Resident % not found in tenant %', p_resident_id, v_act.tenant_id
            USING ERRCODE = '23503';
    END IF;

    INSERT INTO public.activity_participants (
        tenant_id, activity_id, resident_id, rsvp_status
    )
    VALUES (
        v_act.tenant_id, v_act.id, p_resident_id, p_rsvp_status
    )
    ON CONFLICT (activity_id, resident_id)
    DO UPDATE SET rsvp_status = EXCLUDED.rsvp_status;

    INSERT INTO public.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    VALUES (
        v_act.tenant_id,
        v_actor,
        'activity.attendance_recorded',
        'activities',
        v_act.id,
        jsonb_build_object('resident_id', p_resident_id, 'rsvp_status', p_rsvp_status)
    );
END;
$$;

ALTER FUNCTION public.record_activity_attendance(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_activity_attendance(uuid, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_activity_attendance(uuid, uuid, text) TO authenticated;

COMMIT;

