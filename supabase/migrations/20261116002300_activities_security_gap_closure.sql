-- =============================================================================
-- Step 15.1 Migration 0023: Activities Database & Security Gap Closure
-- =============================================================================
-- Addresses all security, integrity, and MVP data-model gaps identified in
-- Step 15.0 (activities-discovery-design-audit.md):
--   1. Preflight assertions verifying zero incompatible existing rows.
--   2. Schema enrichment for public.activities & public.activity_participants:
--      - category, allow_self_registration, max_participants,
--        registration_deadline, updated_by, cancelled_at, cancelled_by,
--        cancellation_reason on public.activities
--      - rsvp_status 'cancelled' lifecycle, historical snapshots
--        (resident_name_snapshot, household_label_snapshot), notes, cancel
--        metadata, recorded_by, updated_at, and PostgreSQL 15+ column-list
--        ON DELETE SET NULL (resident_id) on public.activity_participants
--   3. Server-controlled insert timestamp trigger on public.activities and
--      member-only actor validation triggers.
--   4. Active resident & active household eligibility guard
--      (is_activity_resident_eligible).
--   5. Least-privilege RLS & column/table grants:
--      - Revoke direct authenticated INSERT/UPDATE/DELETE bypasses; all
--        mutations flow through hardened SECURITY DEFINER RPCs.
--      - Remove non-member super_admin and operational bendahara access on
--        activities, activity_participants, and activity-docs Storage.
--      - Restrict pengurus strictly to operational reads, status transitions
--        (scheduled -> ongoing -> completed), attendance recording, and
--        documentation attachment (no create/edit/cancel/delete/doc removal).
--   6. Complete atomic RPC suite with FOR UPDATE concurrency locking &
--      atomic audit_logs trails:
--      - create_activity
--      - update_activity
--      - transition_activity_status (updated with role split & reason)
--      - soft_delete_activity (tightened to ketua_rt / sekretaris)
--      - remove_activity_doc (tightened to ketua_rt / sekretaris)
--      - register_for_activity (atomic quota, deadline & active resident check)
--      - cancel_activity_registration (atomic self-cancel lifecycle)
--      - add_activity_participant (ketua_rt / sekretaris manual registration)
--      - remove_activity_participant (ketua_rt / sekretaris safe removal)
--      - record_activity_attendance (operational attendance + snapshots)
--      - get_activity_registration_counts (zero-PII aggregate seat counts)
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. Preflight Assertions
-- =============================================================================
DO $$
DECLARE
    v_bad_count bigint;
BEGIN
    SELECT count(*)
    INTO v_bad_count
    FROM public.activities
    WHERE btrim(title) = ''
       OR char_length(btrim(title)) > 200
       OR btrim(location) = ''
       OR char_length(btrim(location)) > 200
       OR (description IS NOT NULL AND char_length(description) > 4000)
       OR jsonb_typeof(documentation_paths) <> 'array';

    IF v_bad_count > 0 THEN
        RAISE EXCEPTION
            'Preflight failed: % existing activities row(s) violate constraints',
            v_bad_count
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT count(*)
    INTO v_bad_count
    FROM public.activity_participants ap
    LEFT JOIN public.residents r
      ON r.id = ap.resident_id
     AND r.tenant_id = ap.tenant_id
    WHERE ap.resident_id IS NOT NULL
      AND r.id IS NULL;

    IF v_bad_count > 0 THEN
        RAISE EXCEPTION
            'Preflight failed: % activity_participants row(s) have orphan resident references',
            v_bad_count
            USING ERRCODE = 'foreign_key_violation';
    END IF;
END
$$;

-- =============================================================================
-- 2. Schema Enhancements: public.activities
-- =============================================================================
ALTER TABLE public.activities
    ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'lainnya',
    ADD COLUMN IF NOT EXISTS allow_self_registration boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS max_participants integer NULL,
    ADD COLUMN IF NOT EXISTS registration_deadline timestamptz NULL,
    ADD COLUMN IF NOT EXISTS updated_by uuid NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL,
    ADD COLUMN IF NOT EXISTS cancelled_by uuid NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS cancellation_reason text NULL;

ALTER TABLE public.activities
    ADD CONSTRAINT chk_activities_title_valid CHECK (
        btrim(title) <> ''
        AND char_length(btrim(title)) <= 200
    ),
    ADD CONSTRAINT chk_activities_location_valid CHECK (
        btrim(location) <> ''
        AND char_length(btrim(location)) <= 200
    ),
    ADD CONSTRAINT chk_activities_description_valid CHECK (
        description IS NULL
        OR char_length(description) <= 4000
    ),
    ADD CONSTRAINT chk_activities_category CHECK (
        category IN (
            'kerja_bakti',
            'rapat',
            'kesehatan',
            'keamanan',
            'sosial',
            'olahraga',
            'keagamaan',
            'lainnya'
        )
    ),
    ADD CONSTRAINT chk_activities_max_participants CHECK (
        max_participants IS NULL
        OR max_participants > 0
    ),
    ADD CONSTRAINT chk_activities_deadline CHECK (
        registration_deadline IS NULL
        OR registration_deadline <= COALESCE(end_at, start_at)
    ),
    ADD CONSTRAINT chk_activities_docs_array CHECK (
        jsonb_typeof(documentation_paths) = 'array'
    ),
    ADD CONSTRAINT chk_activities_cancellation_reason CHECK (
        cancellation_reason IS NULL
        OR char_length(cancellation_reason) <= 500
    );

CREATE INDEX IF NOT EXISTS idx_activities_tenant_category
    ON public.activities (tenant_id, category)
    WHERE deleted_at IS NULL;

-- Enforce server timestamps & member-only actors on activities
CREATE OR REPLACE FUNCTION public.enforce_server_insert_timestamps()
RETURNS trigger
LANGUAGE plpgsql
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
        WHEN 'activities' THEN
            NEW.created_at := now();
            NEW.updated_at := now();
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
REVOKE ALL ON FUNCTION public.enforce_server_insert_timestamps()
    FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_activities_enforce_insert_timestamps ON public.activities;
CREATE TRIGGER trg_activities_enforce_insert_timestamps
    BEFORE INSERT ON public.activities
    FOR EACH ROW EXECUTE FUNCTION public.enforce_server_insert_timestamps();

DROP TRIGGER IF EXISTS trg_activities_validate_created_by ON public.activities;
CREATE TRIGGER trg_activities_validate_created_by
    BEFORE INSERT OR UPDATE OF tenant_id, created_by ON public.activities
    FOR EACH ROW EXECUTE FUNCTION public.validate_tenant_actor('created_by', 'member_only');

DROP TRIGGER IF EXISTS trg_activities_validate_updated_by ON public.activities;
CREATE TRIGGER trg_activities_validate_updated_by
    BEFORE INSERT OR UPDATE OF tenant_id, updated_by ON public.activities
    FOR EACH ROW EXECUTE FUNCTION public.validate_tenant_actor('updated_by', 'member_only');

DROP TRIGGER IF EXISTS trg_activities_validate_cancelled_by ON public.activities;
CREATE TRIGGER trg_activities_validate_cancelled_by
    BEFORE INSERT OR UPDATE OF tenant_id, cancelled_by ON public.activities
    FOR EACH ROW EXECUTE FUNCTION public.validate_tenant_actor('cancelled_by', 'member_only');

-- =============================================================================
-- 3. Schema Enhancements: public.activity_participants (History & Snapshots)
-- =============================================================================
ALTER TABLE public.activity_participants
    DROP CONSTRAINT IF EXISTS uq_activity_participants,
    DROP CONSTRAINT IF EXISTS fk_activity_participants_resident,
    DROP CONSTRAINT IF EXISTS chk_activity_participants_rsvp;

ALTER TABLE public.activity_participants
    ALTER COLUMN resident_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS resident_name_snapshot text NULL,
    ADD COLUMN IF NOT EXISTS household_label_snapshot text NULL,
    ADD COLUMN IF NOT EXISTS registration_notes text NULL,
    ADD COLUMN IF NOT EXISTS cancellation_reason text NULL,
    ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL,
    ADD COLUMN IF NOT EXISTS recorded_by uuid NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Backfill snapshots if any legacy rows exist
UPDATE public.activity_participants ap
SET
    resident_name_snapshot = COALESCE(
        NULLIF(btrim(r.full_name), ''),
        ap.resident_name_snapshot,
        'Warga Terdaftar'
    ),
    household_label_snapshot = COALESCE(
        NULLIF(btrim(h.block_unit), ''),
        NULLIF(btrim(h.address), ''),
        ap.household_label_snapshot,
        'Unit Warga'
    )
FROM public.residents r
LEFT JOIN public.households h
  ON h.id = r.household_id
 AND h.tenant_id = r.tenant_id
WHERE ap.resident_id = r.id
  AND ap.tenant_id = r.tenant_id
  AND (ap.resident_name_snapshot IS NULL OR ap.household_label_snapshot IS NULL);

UPDATE public.activity_participants
SET
    resident_name_snapshot = COALESCE(NULLIF(btrim(resident_name_snapshot), ''), 'Warga Terdaftar'),
    household_label_snapshot = COALESCE(NULLIF(btrim(household_label_snapshot), ''), 'Unit Warga')
WHERE resident_name_snapshot IS NULL
   OR household_label_snapshot IS NULL;

ALTER TABLE public.activity_participants
    ALTER COLUMN resident_name_snapshot SET NOT NULL,
    ALTER COLUMN household_label_snapshot SET NOT NULL;

ALTER TABLE public.activity_participants
    ADD CONSTRAINT chk_activity_participants_rsvp CHECK (
        rsvp_status IN ('invited', 'attending', 'cancelled', 'attended', 'absent')
    ),
    ADD CONSTRAINT chk_activity_participants_name_snapshot CHECK (
        btrim(resident_name_snapshot) <> ''
        AND char_length(btrim(resident_name_snapshot)) <= 200
    ),
    ADD CONSTRAINT chk_activity_participants_household_snapshot CHECK (
        btrim(household_label_snapshot) <> ''
        AND char_length(btrim(household_label_snapshot)) <= 200
    ),
    ADD CONSTRAINT chk_activity_participants_notes CHECK (
        registration_notes IS NULL
        OR char_length(registration_notes) <= 500
    ),
    ADD CONSTRAINT chk_activity_participants_cancel_reason CHECK (
        cancellation_reason IS NULL
        OR char_length(cancellation_reason) <= 500
    ),
    -- Column-list ON DELETE SET NULL keeps tenant_id intact while preserving
    -- historical participant snapshots when a resident row is hard-deleted.
    ADD CONSTRAINT fk_activity_participants_resident
        FOREIGN KEY (tenant_id, resident_id)
        REFERENCES public.residents (tenant_id, id)
        ON DELETE SET NULL (resident_id);

CREATE UNIQUE INDEX uq_activity_participants_active_resident
    ON public.activity_participants (activity_id, resident_id)
    WHERE resident_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_activity_participants_resident
    ON public.activity_participants (tenant_id, resident_id, rsvp_status)
    WHERE resident_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_activity_participants_updated_at ON public.activity_participants;
CREATE TRIGGER trg_activity_participants_updated_at
    BEFORE UPDATE ON public.activity_participants
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_activity_participants_validate_recorded_by ON public.activity_participants;
CREATE TRIGGER trg_activity_participants_validate_recorded_by
    BEFORE INSERT OR UPDATE OF tenant_id, recorded_by ON public.activity_participants
    FOR EACH ROW EXECUTE FUNCTION public.validate_tenant_actor('recorded_by', 'member_only');

-- =============================================================================
-- 4. Resident & Household Eligibility Helper
-- =============================================================================
CREATE OR REPLACE FUNCTION public.is_activity_resident_eligible(
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

ALTER FUNCTION public.is_activity_resident_eligible(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_activity_resident_eligible(uuid, uuid)
    FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_activity_resident_eligible(uuid, uuid) TO authenticated;

-- =============================================================================
-- 5. Least-Privilege Grants, RLS & Storage Policies
-- =============================================================================
-- Close ALL direct table write bypasses from authenticated; all writes go
-- strictly through locked, audited SECURITY DEFINER RPCs below.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.activities FROM authenticated;
GRANT SELECT ON public.activities TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.activities FROM service_role;
GRANT SELECT ON public.activities TO service_role;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.activity_participants FROM authenticated;
GRANT SELECT ON public.activity_participants TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.activity_participants FROM service_role;
GRANT SELECT ON public.activity_participants TO service_role;

-- activities RLS
DROP POLICY IF EXISTS activities_select ON public.activities;
CREATE POLICY activities_select
    ON public.activities
    FOR SELECT
    TO authenticated
    USING (
        public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
        OR (
            public.has_tenant_role(tenant_id, ARRAY['warga'])
            AND deleted_at IS NULL
        )
    );

DROP POLICY IF EXISTS activities_insert ON public.activities;
CREATE POLICY activities_insert
    ON public.activities
    FOR INSERT
    TO authenticated
    WITH CHECK (false);

DROP POLICY IF EXISTS activities_update ON public.activities;
CREATE POLICY activities_update
    ON public.activities
    FOR UPDATE
    TO authenticated
    USING (false)
    WITH CHECK (false);

DROP POLICY IF EXISTS activities_delete ON public.activities;

-- activity_participants RLS (strictly tenant-isolated; no bendahara & no non-member super_admin)
DROP POLICY IF EXISTS activity_participants_select ON public.activity_participants;
CREATE POLICY activity_participants_select
    ON public.activity_participants
    FOR SELECT
    TO authenticated
    USING (
        public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
        OR (
            public.has_tenant_role(tenant_id, ARRAY['warga'])
            AND resident_id = public.get_my_resident_id(tenant_id)
            AND EXISTS (
                SELECT 1
                FROM public.activities a
                WHERE a.id = activity_participants.activity_id
                  AND a.tenant_id = activity_participants.tenant_id
                  AND a.deleted_at IS NULL
            )
        )
    );

DROP POLICY IF EXISTS activity_participants_insert ON public.activity_participants;
CREATE POLICY activity_participants_insert
    ON public.activity_participants
    FOR INSERT
    TO authenticated
    WITH CHECK (false);

DROP POLICY IF EXISTS activity_participants_update ON public.activity_participants;
CREATE POLICY activity_participants_update
    ON public.activity_participants
    FOR UPDATE
    TO authenticated
    USING (false)
    WITH CHECK (false);

DROP POLICY IF EXISTS activity_participants_delete ON public.activity_participants;

-- Storage activity-docs RLS alignment (exclude bendahara-only & non-member super_admin)
DROP POLICY IF EXISTS storage_insert_activity_docs ON storage.objects;
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

DROP POLICY IF EXISTS storage_select_activity_docs ON storage.objects;
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
              AND public.has_tenant_role(
                  a.tenant_id,
                  ARRAY['ketua_rt', 'sekretaris', 'pengurus', 'warga']
              )
        )
    );

-- =============================================================================
-- 6. Hardened Atomic RPCs
-- =============================================================================

-- 6.1 create_activity (ketua_rt & sekretaris ONLY)
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

-- 6.2 update_activity (ketua_rt & sekretaris ONLY while scheduled or ongoing)
CREATE OR REPLACE FUNCTION public.update_activity(
    p_activity_id uuid,
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
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_act record;
    v_title text := btrim(COALESCE(p_title, ''));
    v_location text := btrim(COALESCE(p_location, ''));
    v_description text := NULLIF(btrim(COALESCE(p_description, '')), '');
    v_category text := COALESCE(NULLIF(btrim(p_category), ''), 'lainnya');
    v_allow_self boolean := COALESCE(p_allow_self_registration, true);
    v_active_count integer := 0;
    v_changed_fields text[] := ARRAY[]::text[];
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_act
    FROM public.activities a
    WHERE a.id = p_activity_id
    FOR UPDATE;

    IF NOT FOUND OR v_act.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Activity % not found or deleted', p_activity_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.has_tenant_role(v_act.tenant_id, ARRAY['ketua_rt', 'sekretaris']) THEN
        RAISE EXCEPTION 'Forbidden: requires ketua_rt or sekretaris role' USING ERRCODE = '42501';
    END IF;

    IF v_act.status NOT IN ('scheduled', 'ongoing') THEN
        RAISE EXCEPTION 'Activity in status % cannot be edited', v_act.status USING ERRCODE = '22023';
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

    SELECT count(*)::integer
    INTO v_active_count
    FROM public.activity_participants ap
    WHERE ap.activity_id = v_act.id
      AND ap.tenant_id = v_act.tenant_id
      AND ap.rsvp_status IN ('attending', 'attended');

    IF p_max_participants IS NOT NULL AND p_max_participants < v_active_count THEN
        RAISE EXCEPTION
            'max_participants (%) cannot be lower than current registered count (%)',
            p_max_participants, v_active_count
            USING ERRCODE = '23514';
    END IF;

    IF v_act.title IS DISTINCT FROM v_title THEN v_changed_fields := array_append(v_changed_fields, 'title'); END IF;
    IF v_act.description IS DISTINCT FROM v_description THEN v_changed_fields := array_append(v_changed_fields, 'description'); END IF;
    IF v_act.category IS DISTINCT FROM v_category THEN v_changed_fields := array_append(v_changed_fields, 'category'); END IF;
    IF v_act.location IS DISTINCT FROM v_location THEN v_changed_fields := array_append(v_changed_fields, 'location'); END IF;
    IF v_act.start_at IS DISTINCT FROM p_start_at THEN v_changed_fields := array_append(v_changed_fields, 'start_at'); END IF;
    IF v_act.end_at IS DISTINCT FROM p_end_at THEN v_changed_fields := array_append(v_changed_fields, 'end_at'); END IF;
    IF v_act.allow_self_registration IS DISTINCT FROM v_allow_self THEN v_changed_fields := array_append(v_changed_fields, 'allow_self_registration'); END IF;
    IF v_act.max_participants IS DISTINCT FROM p_max_participants THEN v_changed_fields := array_append(v_changed_fields, 'max_participants'); END IF;
    IF v_act.registration_deadline IS DISTINCT FROM p_registration_deadline THEN v_changed_fields := array_append(v_changed_fields, 'registration_deadline'); END IF;

    UPDATE public.activities a
       SET title = v_title,
           description = v_description,
           category = v_category,
           location = v_location,
           start_at = p_start_at,
           end_at = p_end_at,
           allow_self_registration = v_allow_self,
           max_participants = p_max_participants,
           registration_deadline = p_registration_deadline,
           updated_by = v_actor
     WHERE a.id = v_act.id;

    IF array_length(v_changed_fields, 1) IS NOT NULL THEN
        INSERT INTO public.audit_logs (
            tenant_id, actor_user_id, action, entity_type, entity_id, metadata
        )
        VALUES (
            v_act.tenant_id,
            v_actor,
            'activity.updated',
            'activities',
            v_act.id,
            jsonb_build_object(
                'changed_fields', to_jsonb(v_changed_fields),
                'previous_start_at', v_act.start_at,
                'new_start_at', p_start_at,
                'active_participants_count', v_active_count
            )
        );
    END IF;
END;
$$;

ALTER FUNCTION public.update_activity(
    uuid, text, text, timestamptz, text, text, timestamptz, boolean, integer, timestamptz
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_activity(
    uuid, text, text, timestamptz, text, text, timestamptz, boolean, integer, timestamptz
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_activity(
    uuid, text, text, timestamptz, text, text, timestamptz, boolean, integer, timestamptz
) TO authenticated;

-- 6.3 transition_activity_status (role split: cancelled ONLY by ketua_rt/sekretaris;
--     scheduled -> ongoing -> completed allowed for pengurus too)
DROP FUNCTION IF EXISTS public.transition_activity_status(uuid, text);

CREATE OR REPLACE FUNCTION public.transition_activity_status(
    p_activity_id uuid,
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
    v_act record;
    v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    IF p_new_status IS NULL OR p_new_status NOT IN ('ongoing', 'completed', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid target activity status: %', p_new_status USING ERRCODE = '22023';
    END IF;

    IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
        RAISE EXCEPTION 'Cancellation reason must be <= 500 characters' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_act
    FROM public.activities a
    WHERE a.id = p_activity_id
    FOR UPDATE;

    IF NOT FOUND OR v_act.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Activity % not found or deleted', p_activity_id USING ERRCODE = 'P0002';
    END IF;

    IF p_new_status = 'cancelled' THEN
        IF NOT public.has_tenant_role(v_act.tenant_id, ARRAY['ketua_rt', 'sekretaris']) THEN
            RAISE EXCEPTION 'Forbidden: only ketua_rt or sekretaris can cancel an activity' USING ERRCODE = '42501';
        END IF;
    ELSE
        IF NOT public.has_tenant_role(v_act.tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus']) THEN
            RAISE EXCEPTION 'Forbidden: requires operational staff role' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF NOT (
        (v_act.status = 'scheduled' AND p_new_status IN ('ongoing', 'cancelled'))
        OR (v_act.status = 'ongoing' AND p_new_status IN ('completed', 'cancelled'))
    ) THEN
        RAISE EXCEPTION 'Invalid activity transition % -> %', v_act.status, p_new_status
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.activities a
       SET status = p_new_status,
           updated_by = v_actor,
           cancelled_at = CASE WHEN p_new_status = 'cancelled' THEN now() ELSE a.cancelled_at END,
           cancelled_by = CASE WHEN p_new_status = 'cancelled' THEN v_actor ELSE a.cancelled_by END,
           cancellation_reason = CASE WHEN p_new_status = 'cancelled' THEN v_reason ELSE a.cancellation_reason END
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
        jsonb_build_object(
            'previous_status', v_act.status,
            'new_status', p_new_status,
            'reason', v_reason
        )
    );
END;
$$;

ALTER FUNCTION public.transition_activity_status(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.transition_activity_status(uuid, text, text)
    FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.transition_activity_status(uuid, text, text) TO authenticated;

-- 6.4 soft_delete_activity (tightened to ketua_rt & sekretaris ONLY)
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

    IF NOT public.has_tenant_role(v_act.tenant_id, ARRAY['ketua_rt', 'sekretaris']) THEN
        RAISE EXCEPTION 'Forbidden: requires ketua_rt or sekretaris role' USING ERRCODE = '42501';
    END IF;

    UPDATE public.activities a
       SET deleted_at = now(),
           updated_by = v_actor
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
        jsonb_build_object(
            'reason', NULLIF(btrim(COALESCE(p_reason, '')), ''),
            'status_at_delete', v_act.status
        )
    );
END;
$$;

ALTER FUNCTION public.soft_delete_activity(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.soft_delete_activity(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.soft_delete_activity(uuid, text) TO authenticated;

-- 6.5 remove_activity_doc (tightened to ketua_rt & sekretaris ONLY)
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

    IF NOT public.has_tenant_role(v_act.tenant_id, ARRAY['ketua_rt', 'sekretaris']) THEN
        RAISE EXCEPTION 'Forbidden: requires ketua_rt or sekretaris role' USING ERRCODE = '42501';
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

-- 6.6 register_for_activity (atomic self-registration with capacity lock & snapshot)
CREATE OR REPLACE FUNCTION public.register_for_activity(
    p_activity_id uuid,
    p_notes text DEFAULT NULL
)
RETURNS TABLE (
    participant_id uuid,
    activity_id uuid,
    rsvp_status text,
    registered_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_act record;
    v_resident_id uuid;
    v_res_snapshot record;
    v_existing record;
    v_has_existing boolean := false;
    v_active_seats integer := 0;
    v_notes text := NULLIF(btrim(COALESCE(p_notes, '')), '');
    v_out record;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    IF v_notes IS NOT NULL AND char_length(v_notes) > 500 THEN
        RAISE EXCEPTION 'Registration notes must be <= 500 characters' USING ERRCODE = '22023';
    END IF;

    -- Lock activity row FIRST to serialize capacity checks across concurrent requests
    SELECT * INTO v_act
    FROM public.activities a
    WHERE a.id = p_activity_id
    FOR UPDATE;

    IF NOT FOUND OR v_act.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Activity % not found or deleted', p_activity_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.has_tenant_role(v_act.tenant_id, ARRAY['warga']) THEN
        RAISE EXCEPTION 'Forbidden: requires active warga role in tenant' USING ERRCODE = '42501';
    END IF;

    v_resident_id := public.get_my_resident_id(v_act.tenant_id);
    IF v_resident_id IS NULL OR NOT public.is_activity_resident_eligible(v_act.tenant_id, v_resident_id) THEN
        RAISE EXCEPTION 'Forbidden: resident or household is inactive or unlinked' USING ERRCODE = '42501';
    END IF;

    IF NOT v_act.allow_self_registration THEN
        RAISE EXCEPTION 'Self-registration is closed for this activity' USING ERRCODE = '22023';
    END IF;

    IF v_act.status NOT IN ('scheduled', 'ongoing') THEN
        RAISE EXCEPTION 'Cannot register for activity in status %', v_act.status USING ERRCODE = '22023';
    END IF;

    IF (v_act.registration_deadline IS NOT NULL AND now() > v_act.registration_deadline)
       OR now() > COALESCE(v_act.end_at, v_act.start_at) THEN
        RAISE EXCEPTION 'Activity registration deadline has passed' USING ERRCODE = '22023';
    END IF;

    SELECT
        r.full_name,
        COALESCE(
            NULLIF(btrim(h.block_unit), ''),
            NULLIF(btrim(h.address), ''),
            'Unit Warga'
        ) AS household_label
    INTO v_res_snapshot
    FROM public.residents r
    JOIN public.households h
      ON h.id = r.household_id
     AND h.tenant_id = r.tenant_id
    WHERE r.tenant_id = v_act.tenant_id
      AND r.id = v_resident_id;

    SELECT * INTO v_existing
    FROM public.activity_participants ap
    WHERE ap.activity_id = v_act.id
      AND ap.tenant_id = v_act.tenant_id
      AND ap.resident_id = v_resident_id
    FOR UPDATE;
    v_has_existing := FOUND;

    IF v_has_existing THEN
        IF v_existing.rsvp_status IN ('attending', 'attended') THEN
            RAISE EXCEPTION 'Already registered for this activity' USING ERRCODE = '23505';
        ELSIF v_existing.rsvp_status = 'absent' THEN
            RAISE EXCEPTION 'Attendance already marked absent for this activity' USING ERRCODE = '22023';
        END IF;
    END IF;

    IF v_act.max_participants IS NOT NULL THEN
        SELECT count(*)::integer
        INTO v_active_seats
        FROM public.activity_participants ap
        WHERE ap.activity_id = v_act.id
          AND ap.tenant_id = v_act.tenant_id
          AND ap.rsvp_status IN ('attending', 'attended');

        IF v_active_seats >= v_act.max_participants THEN
            RAISE EXCEPTION 'Activity participant capacity reached (% / %)', v_active_seats, v_act.max_participants
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF v_has_existing THEN
        UPDATE public.activity_participants ap
           SET rsvp_status = 'attending',
               resident_name_snapshot = v_res_snapshot.full_name,
               household_label_snapshot = v_res_snapshot.household_label,
               registration_notes = COALESCE(v_notes, ap.registration_notes),
               cancellation_reason = NULL,
               cancelled_at = NULL,
               registered_at = now(),
               recorded_by = v_actor
         WHERE ap.id = v_existing.id
         RETURNING ap.id, ap.activity_id, ap.rsvp_status, ap.registered_at
         INTO v_out;
    ELSE
        INSERT INTO public.activity_participants (
            tenant_id,
            activity_id,
            resident_id,
            resident_name_snapshot,
            household_label_snapshot,
            rsvp_status,
            registration_notes,
            recorded_by,
            registered_at
        )
        VALUES (
            v_act.tenant_id,
            v_act.id,
            v_resident_id,
            v_res_snapshot.full_name,
            v_res_snapshot.household_label,
            'attending',
            v_notes,
            v_actor,
            now()
        )
        RETURNING id, activity_participants.activity_id, activity_participants.rsvp_status, activity_participants.registered_at
        INTO v_out;
    END IF;

    INSERT INTO public.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    VALUES (
        v_act.tenant_id,
        v_actor,
        'activity_participant.registered',
        'activity_participants',
        v_out.id,
        jsonb_build_object(
            'activity_id', v_act.id,
            'resident_id', v_resident_id
        )
    );

    RETURN QUERY SELECT v_out.id, v_out.activity_id, v_out.rsvp_status, v_out.registered_at;
END;
$$;

ALTER FUNCTION public.register_for_activity(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.register_for_activity(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.register_for_activity(uuid, text) TO authenticated;

-- 6.7 cancel_activity_registration (atomic resident self-cancellation)
CREATE OR REPLACE FUNCTION public.cancel_activity_registration(
    p_activity_id uuid,
    p_reason text DEFAULT NULL
)
RETURNS TABLE (
    participant_id uuid,
    activity_id uuid,
    rsvp_status text,
    cancelled_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_act record;
    v_resident_id uuid;
    v_existing record;
    v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
    v_cancelled_at timestamptz;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
        RAISE EXCEPTION 'Cancellation reason must be <= 500 characters' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_act
    FROM public.activities a
    WHERE a.id = p_activity_id
    FOR UPDATE;

    IF NOT FOUND OR v_act.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Activity % not found or deleted', p_activity_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.has_tenant_role(v_act.tenant_id, ARRAY['warga']) THEN
        RAISE EXCEPTION 'Forbidden: requires active warga role in tenant' USING ERRCODE = '42501';
    END IF;

    v_resident_id := public.get_my_resident_id(v_act.tenant_id);
    IF v_resident_id IS NULL THEN
        RAISE EXCEPTION 'Forbidden: resident profile unlinked' USING ERRCODE = '42501';
    END IF;

    IF v_act.status NOT IN ('scheduled', 'ongoing') THEN
        RAISE EXCEPTION 'Cannot cancel registration for activity in status %', v_act.status USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_existing
    FROM public.activity_participants ap
    WHERE ap.activity_id = v_act.id
      AND ap.tenant_id = v_act.tenant_id
      AND ap.resident_id = v_resident_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registration not found for this activity' USING ERRCODE = 'P0002';
    END IF;

    IF v_existing.rsvp_status NOT IN ('invited', 'attending') THEN
        RAISE EXCEPTION 'Registration in status % cannot be cancelled', v_existing.rsvp_status USING ERRCODE = '22023';
    END IF;

    UPDATE public.activity_participants ap
       SET rsvp_status = 'cancelled',
           cancellation_reason = v_reason,
           cancelled_at = now(),
           recorded_by = v_actor
     WHERE ap.id = v_existing.id
     RETURNING ap.cancelled_at INTO v_cancelled_at;

    INSERT INTO public.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    VALUES (
        v_act.tenant_id,
        v_actor,
        'activity_participant.cancelled',
        'activity_participants',
        v_existing.id,
        jsonb_build_object(
            'activity_id', v_act.id,
            'resident_id', v_resident_id,
            'previous_status', v_existing.rsvp_status,
            'reason', v_reason
        )
    );

    RETURN QUERY SELECT v_existing.id, v_act.id, 'cancelled'::text, v_cancelled_at;
END;
$$;

ALTER FUNCTION public.cancel_activity_registration(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_activity_registration(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_activity_registration(uuid, text) TO authenticated;

-- 6.8 add_activity_participant (ketua_rt & sekretaris ONLY manual enrollment/invite)
CREATE OR REPLACE FUNCTION public.add_activity_participant(
    p_activity_id uuid,
    p_resident_id uuid,
    p_rsvp_status text DEFAULT 'attending',
    p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_act record;
    v_res_snapshot record;
    v_existing record;
    v_has_existing boolean := false;
    v_active_seats integer := 0;
    v_notes text := NULLIF(btrim(COALESCE(p_notes, '')), '');
    v_participant_id uuid;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    IF p_rsvp_status IS NULL OR p_rsvp_status NOT IN ('invited', 'attending') THEN
        RAISE EXCEPTION 'Manual enrollment status must be invited or attending' USING ERRCODE = '22023';
    END IF;

    IF v_notes IS NOT NULL AND char_length(v_notes) > 500 THEN
        RAISE EXCEPTION 'Notes must be <= 500 characters' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_act
    FROM public.activities a
    WHERE a.id = p_activity_id
    FOR UPDATE;

    IF NOT FOUND OR v_act.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Activity % not found or deleted', p_activity_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.has_tenant_role(v_act.tenant_id, ARRAY['ketua_rt', 'sekretaris']) THEN
        RAISE EXCEPTION 'Forbidden: requires ketua_rt or sekretaris role' USING ERRCODE = '42501';
    END IF;

    IF v_act.status NOT IN ('scheduled', 'ongoing') THEN
        RAISE EXCEPTION 'Cannot add participants to activity in status %', v_act.status USING ERRCODE = '22023';
    END IF;

    IF p_resident_id IS NULL OR NOT public.is_activity_resident_eligible(v_act.tenant_id, p_resident_id) THEN
        RAISE EXCEPTION 'Resident % is inactive, deleted, or belongs to another tenant', p_resident_id
            USING ERRCODE = '23503';
    END IF;

    SELECT
        r.full_name,
        COALESCE(
            NULLIF(btrim(h.block_unit), ''),
            NULLIF(btrim(h.address), ''),
            'Unit Warga'
        ) AS household_label
    INTO v_res_snapshot
    FROM public.residents r
    JOIN public.households h
      ON h.id = r.household_id
     AND h.tenant_id = r.tenant_id
    WHERE r.tenant_id = v_act.tenant_id
      AND r.id = p_resident_id;

    SELECT * INTO v_existing
    FROM public.activity_participants ap
    WHERE ap.activity_id = v_act.id
      AND ap.tenant_id = v_act.tenant_id
      AND ap.resident_id = p_resident_id
    FOR UPDATE;
    v_has_existing := FOUND;

    IF v_has_existing AND v_existing.rsvp_status = p_rsvp_status THEN
        RAISE EXCEPTION 'Resident already enrolled with status %', p_rsvp_status USING ERRCODE = '23505';
    END IF;

    IF p_rsvp_status = 'attending'
       AND v_act.max_participants IS NOT NULL
       AND (NOT v_has_existing OR v_existing.rsvp_status NOT IN ('attending', 'attended')) THEN
        SELECT count(*)::integer
        INTO v_active_seats
        FROM public.activity_participants ap
        WHERE ap.activity_id = v_act.id
          AND ap.tenant_id = v_act.tenant_id
          AND ap.rsvp_status IN ('attending', 'attended');

        IF v_active_seats >= v_act.max_participants THEN
            RAISE EXCEPTION 'Activity participant capacity reached (% / %)', v_active_seats, v_act.max_participants
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF v_has_existing THEN
        UPDATE public.activity_participants ap
           SET rsvp_status = p_rsvp_status,
               resident_name_snapshot = v_res_snapshot.full_name,
               household_label_snapshot = v_res_snapshot.household_label,
               registration_notes = COALESCE(v_notes, ap.registration_notes),
               cancellation_reason = NULL,
               cancelled_at = NULL,
               recorded_by = v_actor
         WHERE ap.id = v_existing.id
         RETURNING ap.id INTO v_participant_id;
    ELSE
        INSERT INTO public.activity_participants (
            tenant_id,
            activity_id,
            resident_id,
            resident_name_snapshot,
            household_label_snapshot,
            rsvp_status,
            registration_notes,
            recorded_by,
            registered_at
        )
        VALUES (
            v_act.tenant_id,
            v_act.id,
            p_resident_id,
            v_res_snapshot.full_name,
            v_res_snapshot.household_label,
            p_rsvp_status,
            v_notes,
            v_actor,
            now()
        )
        RETURNING id INTO v_participant_id;
    END IF;

    INSERT INTO public.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    VALUES (
        v_act.tenant_id,
        v_actor,
        'activity_participant.added',
        'activity_participants',
        v_participant_id,
        jsonb_build_object(
            'activity_id', v_act.id,
            'resident_id', p_resident_id,
            'rsvp_status', p_rsvp_status
        )
    );

    RETURN v_participant_id;
END;
$$;

ALTER FUNCTION public.add_activity_participant(uuid, uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.add_activity_participant(uuid, uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.add_activity_participant(uuid, uuid, text, text) TO authenticated;

-- 6.9 remove_activity_participant (ketua_rt & sekretaris ONLY)
CREATE OR REPLACE FUNCTION public.remove_activity_participant(
    p_activity_id uuid,
    p_participant_id uuid,
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
    v_existing record;
    v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_act
    FROM public.activities a
    WHERE a.id = p_activity_id
    FOR UPDATE;

    IF NOT FOUND OR v_act.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Activity % not found or deleted', p_activity_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.has_tenant_role(v_act.tenant_id, ARRAY['ketua_rt', 'sekretaris']) THEN
        RAISE EXCEPTION 'Forbidden: requires ketua_rt or sekretaris role' USING ERRCODE = '42501';
    END IF;

    IF v_act.status NOT IN ('scheduled', 'ongoing') THEN
        RAISE EXCEPTION 'Cannot remove participant from activity in status %', v_act.status USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_existing
    FROM public.activity_participants ap
    WHERE ap.id = p_participant_id
      AND ap.activity_id = v_act.id
      AND ap.tenant_id = v_act.tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Participant % not found', p_participant_id USING ERRCODE = 'P0002';
    END IF;

    DELETE FROM public.activity_participants ap
     WHERE ap.id = v_existing.id;

    INSERT INTO public.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    VALUES (
        v_act.tenant_id,
        v_actor,
        'activity_participant.removed',
        'activity_participants',
        v_existing.id,
        jsonb_build_object(
            'activity_id', v_act.id,
            'resident_id', v_existing.resident_id,
            'previous_status', v_existing.rsvp_status,
            'reason', v_reason
        )
    );
END;
$$;

ALTER FUNCTION public.remove_activity_participant(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.remove_activity_participant(uuid, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.remove_activity_participant(uuid, uuid, text) TO authenticated;

-- 6.10 record_activity_attendance (ketua_rt, sekretaris, pengurus; active eligibility + snapshot)
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
    v_existing record;
    v_has_existing boolean := false;
    v_res_snapshot record;
    v_participant_id uuid;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    IF p_rsvp_status IS NULL OR p_rsvp_status NOT IN ('invited', 'attending', 'cancelled', 'attended', 'absent') THEN
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
        RAISE EXCEPTION 'Forbidden: requires operational staff role' USING ERRCODE = '42501';
    END IF;

    IF v_act.status = 'cancelled' THEN
        RAISE EXCEPTION 'Cannot record attendance on cancelled activity' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_existing
    FROM public.activity_participants ap
    WHERE ap.activity_id = v_act.id
      AND ap.tenant_id = v_act.tenant_id
      AND ap.resident_id = p_resident_id
    FOR UPDATE;
    v_has_existing := FOUND;

    IF NOT v_has_existing THEN
        IF p_resident_id IS NULL OR NOT public.is_activity_resident_eligible(v_act.tenant_id, p_resident_id) THEN
            RAISE EXCEPTION 'Resident % not eligible or not found in tenant %', p_resident_id, v_act.tenant_id
                USING ERRCODE = '23503';
        END IF;
    END IF;

    SELECT
        r.full_name,
        COALESCE(
            NULLIF(btrim(h.block_unit), ''),
            NULLIF(btrim(h.address), ''),
            'Unit Warga'
        ) AS household_label
    INTO v_res_snapshot
    FROM public.residents r
    JOIN public.households h
      ON h.id = r.household_id
     AND h.tenant_id = r.tenant_id
    WHERE r.tenant_id = v_act.tenant_id
      AND r.id = p_resident_id;

    IF v_has_existing THEN
        UPDATE public.activity_participants ap
           SET rsvp_status = p_rsvp_status,
               resident_name_snapshot = COALESCE(v_res_snapshot.full_name, ap.resident_name_snapshot),
               household_label_snapshot = COALESCE(v_res_snapshot.household_label, ap.household_label_snapshot),
               cancelled_at = CASE WHEN p_rsvp_status = 'cancelled' THEN COALESCE(ap.cancelled_at, now()) ELSE NULL END,
               recorded_by = v_actor
         WHERE ap.id = v_existing.id
         RETURNING ap.id INTO v_participant_id;
    ELSE
        INSERT INTO public.activity_participants (
            tenant_id,
            activity_id,
            resident_id,
            resident_name_snapshot,
            household_label_snapshot,
            rsvp_status,
            cancelled_at,
            recorded_by,
            registered_at
        )
        VALUES (
            v_act.tenant_id,
            v_act.id,
            p_resident_id,
            v_res_snapshot.full_name,
            v_res_snapshot.household_label,
            p_rsvp_status,
            CASE WHEN p_rsvp_status = 'cancelled' THEN now() ELSE NULL END,
            v_actor,
            now()
        )
        RETURNING id INTO v_participant_id;
    END IF;

    INSERT INTO public.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    VALUES (
        v_act.tenant_id,
        v_actor,
        'activity.attendance_recorded',
        'activities',
        v_act.id,
        jsonb_build_object(
            'participant_id', v_participant_id,
            'resident_id', p_resident_id,
            'rsvp_status', p_rsvp_status
        )
    );
END;
$$;

ALTER FUNCTION public.record_activity_attendance(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_activity_attendance(uuid, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_activity_attendance(uuid, uuid, text) TO authenticated;

-- 6.11 get_activity_registration_counts (zero-PII aggregate seat counts for quota display)
CREATE OR REPLACE FUNCTION public.get_activity_registration_counts(
    p_activity_ids uuid[]
)
RETURNS TABLE (
    activity_id uuid,
    active_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT
        a.id AS activity_id,
        count(ap.id)::integer AS active_count
    FROM public.activities a
    LEFT JOIN public.activity_participants ap
      ON ap.activity_id = a.id
     AND ap.tenant_id = a.tenant_id
     AND ap.rsvp_status IN ('attending', 'attended')
    WHERE a.id = ANY(COALESCE(p_activity_ids, ARRAY[]::uuid[]))
      AND a.deleted_at IS NULL
      AND public.has_tenant_role(
          a.tenant_id,
          ARRAY['ketua_rt', 'sekretaris', 'pengurus', 'warga']
      )
    GROUP BY a.id;
$$;

ALTER FUNCTION public.get_activity_registration_counts(uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_activity_registration_counts(uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_activity_registration_counts(uuid[]) TO authenticated;

COMMIT;
