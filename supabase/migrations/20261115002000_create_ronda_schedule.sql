-- =============================================================================
-- Step 12.1 Migration 0020: Ronda Schedule & Attendance Privacy Foundation
-- =============================================================================
-- Implements:
--   1. public.ronda_schedules (1 session per tenant per date)
--   2. public.ronda_assignments (flexible officer roster + snapshot preservation
--      + strict database-enforced attendance privacy)
--   3. Least-privilege table/column GRANTs & tenant-isolated RLS policies
--   4. Hardened SECURITY DEFINER RPCs with audit_logs integration:
--        - upsert_ronda_schedule_with_roster
--        - delete_ronda_schedule
--        - record_ronda_attendance
--        - get_my_ronda_attendance
--        - get_ronda_schedule_attendance
--        - list_ronda_attendance_admin
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. Table: public.ronda_schedules
-- =============================================================================
CREATE TABLE public.ronda_schedules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    schedule_date date NOT NULL,
    shift_label text NOT NULL DEFAULT 'Ronda Malam',
    start_time time NOT NULL DEFAULT '22:00:00',
    end_time time NOT NULL DEFAULT '04:00:00',
    meeting_point text NULL,
    notes text NULL,
    created_by uuid NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
    updated_by uuid NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_ronda_schedules_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_ronda_schedules_tenant_date UNIQUE (tenant_id, schedule_date),
    CONSTRAINT chk_ronda_schedules_shift_label CHECK (
        btrim(shift_label) <> ''
        AND char_length(btrim(shift_label)) <= 100
    ),
    CONSTRAINT chk_ronda_schedules_shift_times CHECK (
        start_time IS DISTINCT FROM end_time
    ),
    CONSTRAINT chk_ronda_schedules_meeting_point CHECK (
        meeting_point IS NULL
        OR (btrim(meeting_point) <> '' AND char_length(meeting_point) <= 200)
    ),
    CONSTRAINT chk_ronda_schedules_notes CHECK (
        notes IS NULL
        OR char_length(notes) <= 1000
    )
);

CREATE INDEX idx_ronda_schedules_tenant_date
    ON public.ronda_schedules (tenant_id, schedule_date DESC);

CREATE TRIGGER trg_ronda_schedules_updated_at
    BEFORE UPDATE ON public.ronda_schedules
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_ronda_schedules_validate_created_by
    BEFORE INSERT OR UPDATE OF tenant_id, created_by ON public.ronda_schedules
    FOR EACH ROW EXECUTE FUNCTION public.validate_tenant_actor('created_by', 'member_only');

CREATE TRIGGER trg_ronda_schedules_validate_updated_by
    BEFORE INSERT OR UPDATE OF tenant_id, updated_by ON public.ronda_schedules
    FOR EACH ROW EXECUTE FUNCTION public.validate_tenant_actor('updated_by', 'member_only');

-- =============================================================================
-- 2. Table: public.ronda_assignments
-- =============================================================================
CREATE TABLE public.ronda_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    schedule_id uuid NOT NULL,
    resident_id uuid NULL,
    resident_name_snapshot text NOT NULL,
    household_label_snapshot text NOT NULL,
    attendance_status text NULL,
    attendance_notes text NULL,
    attendance_recorded_by uuid NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
    attendance_recorded_at timestamptz NULL,
    created_by uuid NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_ronda_assignments_schedule
        FOREIGN KEY (tenant_id, schedule_id)
        REFERENCES public.ronda_schedules (tenant_id, id)
        ON DELETE CASCADE,
    -- PostgreSQL 15+ column-list ON DELETE SET NULL keeps tenant_id intact
    -- while preserving historical snapshots when a resident row is deleted.
    CONSTRAINT fk_ronda_assignments_resident
        FOREIGN KEY (tenant_id, resident_id)
        REFERENCES public.residents (tenant_id, id)
        ON DELETE SET NULL (resident_id),
    CONSTRAINT chk_ronda_assignments_resident_name_snapshot CHECK (
        btrim(resident_name_snapshot) <> ''
        AND char_length(resident_name_snapshot) <= 200
    ),
    CONSTRAINT chk_ronda_assignments_household_label_snapshot CHECK (
        btrim(household_label_snapshot) <> ''
        AND char_length(household_label_snapshot) <= 200
    ),
    CONSTRAINT chk_ronda_assignments_attendance_status CHECK (
        attendance_status IS NULL
        OR attendance_status IN ('present', 'absent', 'excused')
    ),
    CONSTRAINT chk_ronda_assignments_attendance_notes CHECK (
        attendance_notes IS NULL
        OR (btrim(attendance_notes) <> '' AND char_length(attendance_notes) <= 300)
    ),
    CONSTRAINT chk_ronda_assignments_attendance_consistency CHECK (
        (
            attendance_status IS NULL
            AND attendance_notes IS NULL
            AND attendance_recorded_by IS NULL
            AND attendance_recorded_at IS NULL
        )
        OR (
            attendance_status IS NOT NULL
            AND attendance_recorded_at IS NOT NULL
        )
    )
);

CREATE UNIQUE INDEX uq_ronda_assignments_schedule_resident
    ON public.ronda_assignments (schedule_id, resident_id)
    WHERE resident_id IS NOT NULL;

CREATE INDEX idx_ronda_assignments_schedule
    ON public.ronda_assignments (tenant_id, schedule_id, resident_name_snapshot);

CREATE INDEX idx_ronda_assignments_resident
    ON public.ronda_assignments (tenant_id, resident_id)
    WHERE resident_id IS NOT NULL;

CREATE TRIGGER trg_ronda_assignments_updated_at
    BEFORE UPDATE ON public.ronda_assignments
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_ronda_assignments_validate_created_by
    BEFORE INSERT OR UPDATE OF tenant_id, created_by ON public.ronda_assignments
    FOR EACH ROW EXECUTE FUNCTION public.validate_tenant_actor('created_by', 'member_only');

CREATE TRIGGER trg_ronda_assignments_validate_recorded_by
    BEFORE INSERT OR UPDATE OF tenant_id, attendance_recorded_by ON public.ronda_assignments
    FOR EACH ROW EXECUTE FUNCTION public.validate_tenant_actor('attendance_recorded_by', 'member_only');

-- =============================================================================
-- 3. Least-Privilege Grants & RLS Policies
-- =============================================================================
-- Migration 0010 set ALTER DEFAULT PRIVILEGES granting ALL to service_role;
-- explicitly revoke direct DML from PUBLIC, anon, authenticated, and service_role.
ALTER TABLE public.ronda_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ronda_assignments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ronda_schedules FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ronda_schedules TO authenticated, service_role;

REVOKE ALL ON public.ronda_assignments FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ronda_assignments TO service_role;

-- Column-level SELECT on ronda_assignments enforces attendance privacy inside PostgreSQL:
-- authenticated callers can only query roster columns and snapshots, never attendance_*
-- or created_by via PostgREST/SQL direct SELECT.
GRANT SELECT (
    id,
    tenant_id,
    schedule_id,
    resident_id,
    resident_name_snapshot,
    household_label_snapshot,
    created_at,
    updated_at
) ON public.ronda_assignments TO authenticated;

-- RLS policies: strictly active tenant members (super_admin is NOT auto-granted).
CREATE POLICY ronda_schedules_select
    ON public.ronda_schedules
    FOR SELECT
    TO authenticated
    USING (public.is_tenant_member(tenant_id));

CREATE POLICY ronda_assignments_select
    ON public.ronda_assignments
    FOR SELECT
    TO authenticated
    USING (public.is_tenant_member(tenant_id));

-- =============================================================================
-- 4. RPC: upsert_ronda_schedule_with_roster
-- =============================================================================
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

-- =============================================================================
-- 5. RPC: delete_ronda_schedule
-- =============================================================================
CREATE OR REPLACE FUNCTION public.delete_ronda_schedule(
    p_schedule_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_schedule record;
    v_assignment_count integer := 0;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    IF p_schedule_id IS NULL THEN
        RAISE EXCEPTION 'ID jadwal wajib diisi' USING ERRCODE = '22023';
    END IF;

    SELECT s.id, s.tenant_id, s.schedule_date, s.shift_label
    INTO v_schedule
    FROM public.ronda_schedules s
    WHERE s.id = p_schedule_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Jadwal ronda tidak ditemukan' USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.has_tenant_role(v_schedule.tenant_id, ARRAY['ketua_rt', 'sekretaris']) THEN
        RAISE EXCEPTION 'Forbidden: hanya ketua_rt atau sekretaris yang dapat menghapus jadwal ronda'
            USING ERRCODE = '42501';
    END IF;

    SELECT count(*)::integer
    INTO v_assignment_count
    FROM public.ronda_assignments a
    WHERE a.tenant_id = v_schedule.tenant_id
      AND a.schedule_id = v_schedule.id;

    DELETE FROM public.ronda_schedules s
     WHERE s.id = v_schedule.id
       AND s.tenant_id = v_schedule.tenant_id;

    INSERT INTO public.audit_logs (
        tenant_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
    )
    VALUES (
        v_schedule.tenant_id,
        v_actor,
        'ronda_schedule.deleted',
        'ronda_schedules',
        v_schedule.id,
        jsonb_build_object(
            'schedule_date', v_schedule.schedule_date,
            'shift_label', v_schedule.shift_label,
            'assignment_count', v_assignment_count
        )
    );

    RETURN jsonb_build_object(
        'id', v_schedule.id,
        'tenant_id', v_schedule.tenant_id,
        'deleted', true
    );
END;
$$;

ALTER FUNCTION public.delete_ronda_schedule(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.delete_ronda_schedule(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_ronda_schedule(uuid) TO authenticated;

-- =============================================================================
-- 6. RPC: record_ronda_attendance
-- =============================================================================
CREATE OR REPLACE FUNCTION public.record_ronda_attendance(
    p_assignment_id uuid,
    p_attendance_status text,
    p_attendance_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_assign record;
    v_status text;
    v_notes text;
    v_recorded_at timestamptz;
    v_recorded_by uuid;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    IF p_assignment_id IS NULL THEN
        RAISE EXCEPTION 'ID penugasan ronda wajib diisi' USING ERRCODE = '22023';
    END IF;

    SELECT a.id, a.tenant_id, a.schedule_id, a.resident_id, a.attendance_status, s.schedule_date
    INTO v_assign
    FROM public.ronda_assignments a
    JOIN public.ronda_schedules s
      ON s.id = a.schedule_id
     AND s.tenant_id = a.tenant_id
    WHERE a.id = p_assignment_id
    FOR UPDATE OF a;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Penugasan ronda tidak ditemukan' USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.has_tenant_role(v_assign.tenant_id, ARRAY['ketua_rt', 'sekretaris']) THEN
        RAISE EXCEPTION 'Forbidden: hanya ketua_rt atau sekretaris yang dapat mencatat kehadiran ronda'
            USING ERRCODE = '42501';
    END IF;

    v_status := NULLIF(lower(btrim(COALESCE(p_attendance_status, ''))), '');
    IF v_status IS NOT NULL AND v_status NOT IN ('present', 'absent', 'excused') THEN
        RAISE EXCEPTION 'Status kehadiran harus present, absent, excused, atau NULL'
            USING ERRCODE = '22023';
    END IF;

    v_notes := NULLIF(btrim(COALESCE(p_attendance_notes, '')), '');
    IF v_notes IS NOT NULL AND char_length(v_notes) > 300 THEN
        RAISE EXCEPTION 'Catatan kehadiran maksimal 300 karakter' USING ERRCODE = '22023';
    END IF;

    IF v_status IS NULL AND v_notes IS NOT NULL THEN
        RAISE EXCEPTION 'Catatan kehadiran tidak boleh diisi ketika status kehadiran kosong'
            USING ERRCODE = '22023';
    END IF;

    IF v_status IS NULL THEN
        v_recorded_by := NULL;
        v_recorded_at := NULL;
    ELSE
        v_recorded_by := v_actor;
        v_recorded_at := now();
    END IF;

    UPDATE public.ronda_assignments a
       SET attendance_status = v_status,
           attendance_notes = v_notes,
           attendance_recorded_by = v_recorded_by,
           attendance_recorded_at = v_recorded_at
     WHERE a.id = v_assign.id
       AND a.tenant_id = v_assign.tenant_id;

    INSERT INTO public.audit_logs (
        tenant_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
    )
    VALUES (
        v_assign.tenant_id,
        v_actor,
        'ronda_attendance.recorded',
        'ronda_assignments',
        v_assign.id,
        jsonb_build_object(
            'schedule_id', v_assign.schedule_id,
            'schedule_date', v_assign.schedule_date,
            'resident_id', v_assign.resident_id,
            'previous_status', v_assign.attendance_status,
            'attendance_status', v_status,
            'has_notes', v_notes IS NOT NULL
        )
    );

    RETURN jsonb_build_object(
        'assignment_id', v_assign.id,
        'tenant_id', v_assign.tenant_id,
        'schedule_id', v_assign.schedule_id,
        'attendance_status', v_status,
        'attendance_notes', v_notes,
        'attendance_recorded_by', v_recorded_by,
        'attendance_recorded_at', v_recorded_at
    );
END;
$$;

ALTER FUNCTION public.record_ronda_attendance(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_ronda_attendance(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_ronda_attendance(uuid, text, text) TO authenticated;

-- =============================================================================
-- 7. RPC: get_my_ronda_attendance (Caller-only self attendance)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_my_ronda_attendance(
    p_tenant_id uuid,
    p_schedule_id uuid DEFAULT NULL
)
RETURNS TABLE (
    assignment_id uuid,
    schedule_id uuid,
    schedule_date date,
    shift_label text,
    attendance_status text,
    attendance_notes text,
    attendance_recorded_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_resident_id uuid;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    IF p_tenant_id IS NULL OR NOT public.is_tenant_member(p_tenant_id) THEN
        RAISE EXCEPTION 'Forbidden: bukan anggota aktif tenant ini' USING ERRCODE = '42501';
    END IF;

    v_resident_id := public.get_my_resident_id(p_tenant_id);
    IF v_resident_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        a.id AS assignment_id,
        a.schedule_id,
        s.schedule_date,
        s.shift_label,
        a.attendance_status,
        a.attendance_notes,
        a.attendance_recorded_at
    FROM public.ronda_assignments a
    JOIN public.ronda_schedules s
      ON s.id = a.schedule_id
     AND s.tenant_id = a.tenant_id
    WHERE a.tenant_id = p_tenant_id
      AND a.resident_id = v_resident_id
      AND (p_schedule_id IS NULL OR a.schedule_id = p_schedule_id)
    ORDER BY s.schedule_date DESC;
END;
$$;

ALTER FUNCTION public.get_my_ronda_attendance(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_my_ronda_attendance(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_ronda_attendance(uuid, uuid) TO authenticated;

-- =============================================================================
-- 8. RPC: get_ronda_schedule_attendance & list_ronda_attendance_admin
--    Strictly restricted to ketua_rt and sekretaris of the tenant.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_ronda_schedule_attendance(
    p_schedule_id uuid
)
RETURNS TABLE (
    assignment_id uuid,
    schedule_id uuid,
    schedule_date date,
    resident_id uuid,
    resident_name_snapshot text,
    household_label_snapshot text,
    attendance_status text,
    attendance_notes text,
    attendance_recorded_by uuid,
    attendance_recorded_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_tenant_id uuid;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    SELECT s.tenant_id
    INTO v_tenant_id
    FROM public.ronda_schedules s
    WHERE s.id = p_schedule_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Jadwal ronda tidak ditemukan' USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.has_tenant_role(v_tenant_id, ARRAY['ketua_rt', 'sekretaris']) THEN
        RAISE EXCEPTION 'Forbidden: hanya ketua_rt atau sekretaris yang dapat mengakses rekap kehadiran ronda'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        a.id AS assignment_id,
        a.schedule_id,
        s.schedule_date,
        a.resident_id,
        a.resident_name_snapshot,
        a.household_label_snapshot,
        a.attendance_status,
        a.attendance_notes,
        a.attendance_recorded_by,
        a.attendance_recorded_at
    FROM public.ronda_assignments a
    JOIN public.ronda_schedules s
      ON s.id = a.schedule_id
     AND s.tenant_id = a.tenant_id
    WHERE a.tenant_id = v_tenant_id
      AND a.schedule_id = p_schedule_id
    ORDER BY a.resident_name_snapshot ASC, a.created_at ASC;
END;
$$;

ALTER FUNCTION public.get_ronda_schedule_attendance(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_ronda_schedule_attendance(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_ronda_schedule_attendance(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_ronda_attendance_admin(
    p_tenant_id uuid,
    p_from_date date DEFAULT NULL,
    p_to_date date DEFAULT NULL
)
RETURNS TABLE (
    assignment_id uuid,
    schedule_id uuid,
    schedule_date date,
    resident_id uuid,
    resident_name_snapshot text,
    household_label_snapshot text,
    attendance_status text,
    attendance_notes text,
    attendance_recorded_by uuid,
    attendance_recorded_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor uuid := auth.uid();
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    IF p_tenant_id IS NULL OR NOT public.has_tenant_role(p_tenant_id, ARRAY['ketua_rt', 'sekretaris']) THEN
        RAISE EXCEPTION 'Forbidden: hanya ketua_rt atau sekretaris yang dapat mengakses rekap kehadiran ronda'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        a.id AS assignment_id,
        a.schedule_id,
        s.schedule_date,
        a.resident_id,
        a.resident_name_snapshot,
        a.household_label_snapshot,
        a.attendance_status,
        a.attendance_notes,
        a.attendance_recorded_by,
        a.attendance_recorded_at
    FROM public.ronda_assignments a
    JOIN public.ronda_schedules s
      ON s.id = a.schedule_id
     AND s.tenant_id = a.tenant_id
    WHERE a.tenant_id = p_tenant_id
      AND (p_from_date IS NULL OR s.schedule_date >= p_from_date)
      AND (p_to_date IS NULL OR s.schedule_date <= p_to_date)
    ORDER BY s.schedule_date DESC, a.resident_name_snapshot ASC;
END;
$$;

ALTER FUNCTION public.list_ronda_attendance_admin(uuid, date, date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_ronda_attendance_admin(uuid, date, date) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_ronda_attendance_admin(uuid, date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

