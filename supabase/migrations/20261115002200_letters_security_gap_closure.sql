-- =============================================================================
-- Step 14.1 Migration 0022: Letters Security & Data Integrity Gap Closure
-- =============================================================================
-- Addresses security, audit, and integrity gaps identified in Step 14.0:
--   1. Preflight assertions ensuring zero incompatible existing rows before
--      applying constraints or unique expression indexes.
--   2. Audit triggers for:
--      - public.letter_requests AFTER INSERT (letter_request.created)
--      - public.letter_types AFTER INSERT OR UPDATE OR DELETE
--        (letter_type.created / letter_type.updated / letter_type.deleted)
--      recording strictly operational metadata without PII or free-text payloads.
--   3. Schema integrity CHECK constraints on letter_requests & letter_types plus
--      unique normalized code expression index matching issue_letter().
--   4. Hardened letter_requests_insert RLS requiring active eligible resident
--      and active non-deleted household via SECURITY DEFINER helper.
--   5. Supporting document attachment limit (max 5 docs) inside locked
--      attach_letter_supporting_doc() while preserving global lock order.
--   6. Role & access policy alignment across letter_requests & letter_types
--      (bendahara & non-member super_admin excluded; pengurus read-only).
--   7. Revocation of direct DML/TRUNCATE from service_role on letter_types
--      and letter_sequences.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. Preflight Assertions (Abort safely if incompatible existing data exists)
-- =============================================================================
DO $$
DECLARE
    v_bad_count bigint;
BEGIN
    SELECT count(*)
    INTO v_bad_count
    FROM public.letter_requests
    WHERE btrim(purpose) = ''
       OR length(purpose) > 1000;

    IF v_bad_count > 0 THEN
        RAISE EXCEPTION
            'Preflight failed: % letter_requests row(s) have blank or oversized purpose',
            v_bad_count
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT count(*)
    INTO v_bad_count
    FROM public.letter_requests
    WHERE jsonb_typeof(supporting_doc_paths) <> 'array';

    IF v_bad_count > 0 THEN
        RAISE EXCEPTION
            'Preflight failed: % letter_requests row(s) have non-array supporting_doc_paths',
            v_bad_count
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT count(*)
    INTO v_bad_count
    FROM public.letter_requests
    WHERE jsonb_array_length(supporting_doc_paths) > 5;

    IF v_bad_count > 0 THEN
        RAISE EXCEPTION
            'Preflight failed: % letter_requests row(s) exceed 5 supporting documents',
            v_bad_count
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT count(*)
    INTO v_bad_count
    FROM public.letter_types
    WHERE btrim(code) = ''
       OR length(btrim(code)) > 32
       OR length(code) > 32
       OR code !~ '[A-Za-z0-9]'
       OR upper(regexp_replace(code, '[^A-Za-z0-9]+', '', 'g')) = '';

    IF v_bad_count > 0 THEN
        RAISE EXCEPTION
            'Preflight failed: % letter_types row(s) have empty, non-alphanumeric, or >32-char code',
            v_bad_count
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT count(*)
    INTO v_bad_count
    FROM public.letter_types
    WHERE btrim(name) = '';

    IF v_bad_count > 0 THEN
        RAISE EXCEPTION
            'Preflight failed: % letter_types row(s) have blank name',
            v_bad_count
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT count(*)
    INTO v_bad_count
    FROM public.letter_types
    WHERE jsonb_typeof(required_documents) <> 'array';

    IF v_bad_count > 0 THEN
        RAISE EXCEPTION
            'Preflight failed: % letter_types row(s) have non-array required_documents',
            v_bad_count
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT count(*)
    INTO v_bad_count
    FROM (
        SELECT
            tenant_id,
            upper(regexp_replace(code, '[^A-Za-z0-9]+', '', 'g')) AS norm_code
        FROM public.letter_types
        GROUP BY 1, 2
        HAVING count(*) > 1
    ) dup;

    IF v_bad_count > 0 THEN
        RAISE EXCEPTION
            'Preflight failed: % duplicate normalized letter_types code group(s) found',
            v_bad_count
            USING ERRCODE = 'unique_violation';
    END IF;
END
$$;

-- =============================================================================
-- 2. Schema Integrity Constraints & Unique Normalized Code Index
-- =============================================================================
ALTER TABLE public.letter_requests
    ADD CONSTRAINT chk_letter_requests_purpose_valid CHECK (
        btrim(purpose) <> ''
        AND length(purpose) <= 1000
    ),
    ADD CONSTRAINT chk_letter_requests_supporting_docs_array CHECK (
        jsonb_typeof(supporting_doc_paths) = 'array'
    );

ALTER TABLE public.letter_types
    ADD CONSTRAINT chk_letter_types_code_valid CHECK (
        btrim(code) <> ''
        AND length(code) <= 32
        AND code ~ '[A-Za-z0-9]'
    ),
    ADD CONSTRAINT chk_letter_types_name_non_empty CHECK (
        btrim(name) <> ''
    ),
    ADD CONSTRAINT chk_letter_types_required_docs_array CHECK (
        jsonb_typeof(required_documents) = 'array'
    );

CREATE UNIQUE INDEX uq_letter_types_tenant_normalized_code
    ON public.letter_types (
        tenant_id,
        (upper(regexp_replace(code, '[^A-Za-z0-9]+', '', 'g')))
    );

-- =============================================================================
-- 3. Audit Trail (Hardened SECURITY DEFINER Triggers, Zero Sensitive Payloads)
-- =============================================================================
CREATE OR REPLACE FUNCTION public._record_letter_domain_audit(
    p_tenant_id uuid,
    p_action text,
    p_entity_type text,
    p_entity_id uuid,
    p_metadata jsonb,
    p_expected_member_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_member_user_id uuid;
    v_is_super_admin boolean := false;
    v_role text := COALESCE(current_setting('role', true), '');
BEGIN
    IF p_expected_member_id IS NOT NULL THEN
        SELECT tm.user_id
        INTO v_member_user_id
        FROM public.tenant_members tm
        WHERE tm.tenant_id = p_tenant_id
          AND tm.id = p_expected_member_id;
    END IF;

    IF v_actor IS NOT NULL THEN
        IF p_expected_member_id IS NOT NULL THEN
            IF v_member_user_id IS DISTINCT FROM v_actor THEN
                SELECT COALESCE(p.is_super_admin, false)
                INTO v_is_super_admin
                FROM public.profiles p
                WHERE p.id = v_actor;

                IF NOT v_is_super_admin THEN
                    RAISE EXCEPTION 'Forbidden: authenticated actor does not match requester member'
                        USING ERRCODE = '42501';
                END IF;
            END IF;
        ELSE
            IF NOT public.has_tenant_role(p_tenant_id, ARRAY['ketua_rt', 'sekretaris']) THEN
                SELECT COALESCE(p.is_super_admin, false)
                INTO v_is_super_admin
                FROM public.profiles p
                WHERE p.id = v_actor;

                IF NOT v_is_super_admin THEN
                    RAISE EXCEPTION 'Forbidden: requires ketua_rt or sekretaris to audit letter_types'
                        USING ERRCODE = '42501';
                END IF;
            END IF;
        END IF;
    ELSE
        IF v_role IN ('anon', 'authenticated')
           OR session_user NOT IN ('postgres', 'supabase_admin') THEN
            RAISE EXCEPTION 'Unauthenticated audit actor'
                USING ERRCODE = '42501';
        END IF;

        IF p_expected_member_id IS NOT NULL THEN
            v_actor := v_member_user_id;
        END IF;
    END IF;

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
        p_action,
        p_entity_type,
        p_entity_id,
        COALESCE(p_metadata, '{}'::jsonb)
    );
END;
$$;

ALTER FUNCTION public._record_letter_domain_audit(uuid, text, text, uuid, jsonb, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._record_letter_domain_audit(uuid, text, text, uuid, jsonb, uuid)
    FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.audit_letter_request_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public._record_letter_domain_audit(
        NEW.tenant_id,
        'letter_request.created',
        'letter_requests',
        NEW.id,
        jsonb_build_object(
            'letter_request_id', NEW.id,
            'letter_type_id', NEW.letter_type_id,
            'resident_id', NEW.resident_id,
            'requested_by_member_id', NEW.requested_by_member_id,
            'status', NEW.status,
            'supporting_doc_count', CASE
                WHEN jsonb_typeof(NEW.supporting_doc_paths) = 'array'
                THEN jsonb_array_length(NEW.supporting_doc_paths)
                ELSE 0
            END
        ),
        NEW.requested_by_member_id
    );

    RETURN NULL;
END;
$$;

ALTER FUNCTION public.audit_letter_request_insert() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.audit_letter_request_insert()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.audit_letter_type_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_changed_fields text[] := ARRAY[]::text[];
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM public._record_letter_domain_audit(
            NEW.tenant_id,
            'letter_type.created',
            'letter_types',
            NEW.id,
            jsonb_build_object(
                'letter_type_id', NEW.id,
                'code', NEW.code,
                'is_active', NEW.is_active,
                'required_documents_count', CASE
                    WHEN jsonb_typeof(NEW.required_documents) = 'array'
                    THEN jsonb_array_length(NEW.required_documents)
                    ELSE 0
                END
            ),
            NULL
        );
        RETURN NULL;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.code IS DISTINCT FROM NEW.code THEN
            v_changed_fields := array_append(v_changed_fields, 'code');
        END IF;
        IF OLD.name IS DISTINCT FROM NEW.name THEN
            v_changed_fields := array_append(v_changed_fields, 'name');
        END IF;
        IF OLD.description IS DISTINCT FROM NEW.description THEN
            v_changed_fields := array_append(v_changed_fields, 'description');
        END IF;
        IF OLD.required_documents IS DISTINCT FROM NEW.required_documents THEN
            v_changed_fields := array_append(v_changed_fields, 'required_documents');
        END IF;
        IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
            v_changed_fields := array_append(v_changed_fields, 'is_active');
        END IF;

        IF array_length(v_changed_fields, 1) IS NULL THEN
            RETURN NULL;
        END IF;

        PERFORM public._record_letter_domain_audit(
            NEW.tenant_id,
            'letter_type.updated',
            'letter_types',
            NEW.id,
            jsonb_build_object(
                'letter_type_id', NEW.id,
                'code', NEW.code,
                'is_active', NEW.is_active,
                'changed_fields', to_jsonb(v_changed_fields)
            ),
            NULL
        );
        RETURN NULL;
    ELSIF TG_OP = 'DELETE' THEN
        -- Skip cascade audit only when the parent tenant itself is being deleted
        -- (otherwise audit_logs_tenant_id_fkey would fail during ON DELETE CASCADE).
        IF NOT EXISTS (
            SELECT 1
            FROM public.tenants t
            WHERE t.id = OLD.tenant_id
        ) THEN
            RETURN NULL;
        END IF;

        PERFORM public._record_letter_domain_audit(
            OLD.tenant_id,
            'letter_type.deleted',
            'letter_types',
            OLD.id,
            jsonb_build_object(
                'letter_type_id', OLD.id,
                'code', OLD.code,
                'was_active', OLD.is_active
            ),
            NULL
        );
        RETURN NULL;
    END IF;

    RETURN NULL;
END;
$$;

ALTER FUNCTION public.audit_letter_type_changes() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.audit_letter_type_changes()
    FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_letter_requests_audit_insert ON public.letter_requests;
CREATE TRIGGER trg_letter_requests_audit_insert
    AFTER INSERT ON public.letter_requests
    FOR EACH ROW EXECUTE FUNCTION public.audit_letter_request_insert();

DROP TRIGGER IF EXISTS trg_letter_types_audit_changes ON public.letter_types;
CREATE TRIGGER trg_letter_types_audit_changes
    AFTER INSERT OR UPDATE OR DELETE ON public.letter_types
    FOR EACH ROW EXECUTE FUNCTION public.audit_letter_type_changes();

-- =============================================================================
-- 4. Resident Eligibility & Role Access Policy Alignment
-- =============================================================================
CREATE OR REPLACE FUNCTION public.is_letter_resident_eligible(
    p_tenant_id uuid,
    p_resident_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.residents r
        JOIN public.households h
          ON h.id = r.household_id
         AND h.tenant_id = r.tenant_id
        WHERE r.tenant_id = p_tenant_id
          AND r.id = p_resident_id
          AND r.deleted_at IS NULL
          AND r.residency_status = 'aktif'
          AND h.deleted_at IS NULL
          AND h.status = 'active'
    );
$$;

ALTER FUNCTION public.is_letter_resident_eligible(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_letter_resident_eligible(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_letter_resident_eligible(uuid, uuid) TO authenticated;

-- 4.1 letter_requests:
-- - SELECT: ketua_rt, sekretaris, pengurus (all tenant rows), warga (own rows only).
--   bendahara and non-member super_admin receive zero operational access.
-- - INSERT: active tenant member linked to active non-deleted resident & active non-deleted household.
DROP POLICY IF EXISTS letter_requests_select ON public.letter_requests;
CREATE POLICY letter_requests_select
    ON public.letter_requests
    FOR SELECT
    TO authenticated
    USING (
        public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
        OR (
            public.has_tenant_role(tenant_id, ARRAY['warga'])
            AND (
                requested_by_member_id = public.get_my_member_id(tenant_id)
                OR resident_id = public.get_my_resident_id(tenant_id)
            )
        )
    );

DROP POLICY IF EXISTS letter_requests_insert ON public.letter_requests;
CREATE POLICY letter_requests_insert
    ON public.letter_requests
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_tenant_member(tenant_id)
        AND requested_by_member_id = public.get_my_member_id(tenant_id)
        AND resident_id = public.get_my_resident_id(tenant_id)
        AND public.is_letter_resident_eligible(tenant_id, resident_id)
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

-- 4.2 letter_types:
-- - SELECT: ketua_rt, sekretaris, pengurus (all tenant rows); warga (active only).
--   bendahara and non-member super_admin receive zero operational access.
-- - INSERT/UPDATE/DELETE policies remain restricted to ketua_rt and sekretaris.
DROP POLICY IF EXISTS letter_types_select ON public.letter_types;
CREATE POLICY letter_types_select
    ON public.letter_types
    FOR SELECT
    TO authenticated
    USING (
        public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
        OR (
            public.has_tenant_role(tenant_id, ARRAY['warga'])
            AND is_active IS TRUE
        )
    );

-- =============================================================================
-- 5. Supporting Document Limit in attach_letter_supporting_doc (Max 5)
-- =============================================================================
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

    -- Global Lock Order Step 1: Object-level advisory lock
    PERFORM pg_advisory_xact_lock(hashtextextended('storage:letter-requests/' || p_storage_path, 0));

    -- Global Lock Order Step 2: Lock parent letter_requests row
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

    IF jsonb_typeof(v_lr.supporting_doc_paths) <> 'array' THEN
        RAISE EXCEPTION 'Invalid supporting_doc_paths array on letter_request %', p_request_id
            USING ERRCODE = '22023';
    END IF;

    IF jsonb_array_length(v_lr.supporting_doc_paths) >= 5 THEN
        RAISE EXCEPTION 'Maximum 5 supporting documents allowed per letter request'
            USING ERRCODE = '22023';
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

-- =============================================================================
-- 6. Revoke Unnecessary service_role Direct DML / TRUNCATE
-- =============================================================================
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.letter_types FROM service_role;
GRANT SELECT ON public.letter_types TO service_role;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.letter_sequences FROM service_role;
GRANT SELECT ON public.letter_sequences TO service_role;

COMMIT;

