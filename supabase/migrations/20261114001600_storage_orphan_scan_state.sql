-- Migration 0016: Persistent Orphan Scan State, Domain Retention Enqueue & Monitoring
-- Implements Section 23 & Section 24 of docs/database/security-hardening-rpc-storage-plan.md

BEGIN;

-- =============================================================================
-- 1. Persistent Orphan Scan State Table (Singleton + Explicit Default ACL Closure)
-- =============================================================================

CREATE TABLE public.storage_orphan_scan_state (
    id smallint PRIMARY KEY
        CONSTRAINT chk_orphan_state_id_singleton CHECK (id = 1),
    cursor jsonb NULL,
    scan_token uuid NULL,
    lease_expires_at timestamptz NULL,
    cycle_started_at timestamptz NULL,
    cycle_completed_at timestamptz NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_orphan_state_lease_pair CHECK (
        (scan_token IS NULL AND lease_expires_at IS NULL)
        OR (scan_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    ),
    CONSTRAINT chk_orphan_state_cursor_valid CHECK (
        cursor IS NULL
        OR (
            jsonb_typeof(cursor) = 'object'
            AND jsonb_typeof(cursor->'v') = 'number'
            AND (cursor->>'v') = '1'
            AND jsonb_typeof(cursor->'bucketIndex') = 'number'
            AND (cursor->>'bucketIndex') ~ '^[0-9]+$'
            AND jsonb_typeof(cursor->'queue') = 'array'
            AND octet_length(cursor::text) <= 65536
        )
    )
);

ALTER TABLE public.storage_orphan_scan_state OWNER TO postgres;

INSERT INTO public.storage_orphan_scan_state (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- RLS enabled with zero client policies; override Migration 0010 pg_default_acl
ALTER TABLE public.storage_orphan_scan_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.storage_orphan_scan_state FROM PUBLIC, anon, authenticated, service_role;

-- =============================================================================
-- 2. Persistent Cursor & Lease RPCs (service_role EXECUTE only)
-- =============================================================================

-- 2.1 Non-mutating cursor reader
CREATE OR REPLACE FUNCTION public.get_orphan_scan_cursor()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_cursor jsonb;
BEGIN
    SELECT s.cursor
    INTO v_cursor
    FROM public.storage_orphan_scan_state s
    WHERE s.id = 1;

    RETURN v_cursor;
END;
$$;

ALTER FUNCTION public.get_orphan_scan_cursor() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_orphan_scan_cursor() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_orphan_scan_cursor() TO service_role;

-- 2.2 Mutual-exclusive lease acquisition (reclaims expired lease cleanly)
CREATE OR REPLACE FUNCTION public.acquire_orphan_scan_lease(
    p_lease interval DEFAULT interval '5 minutes'
)
RETURNS TABLE (
    acquired boolean,
    scan_token uuid,
    cursor jsonb,
    lease_expires_at timestamptz,
    db_now timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_lease interval := LEAST(GREATEST(COALESCE(p_lease, interval '5 minutes'), interval '1 minute'), interval '15 minutes');
    v_now timestamptz := clock_timestamp();
    v_state public.storage_orphan_scan_state%ROWTYPE;
    v_token uuid;
    v_expires_at timestamptz;
BEGIN
    SELECT *
    INTO v_state
    FROM public.storage_orphan_scan_state s
    WHERE s.id = 1
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Missing singleton storage_orphan_scan_state row'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_state.lease_expires_at IS NOT NULL AND v_state.lease_expires_at > v_now THEN
        RETURN QUERY
        SELECT false, NULL::uuid, NULL::jsonb, v_state.lease_expires_at, v_now;
        RETURN;
    END IF;

    v_token := gen_random_uuid();
    v_expires_at := v_now + v_lease;

    UPDATE public.storage_orphan_scan_state s
       SET scan_token = v_token,
           lease_expires_at = v_expires_at,
           cycle_started_at = COALESCE(s.cycle_started_at, v_now),
           updated_at = v_now
     WHERE s.id = 1;

    RETURN QUERY
    SELECT true, v_token, v_state.cursor, v_expires_at, v_now;
END;
$$;

ALTER FUNCTION public.acquire_orphan_scan_lease(interval) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.acquire_orphan_scan_lease(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_orphan_scan_lease(interval) TO service_role;

-- 2.3 Safety lease renewal (validates matching active token & unexpired DB clock)
CREATE OR REPLACE FUNCTION public.renew_orphan_scan_lease(
    p_scan_token uuid,
    p_lease interval DEFAULT interval '5 minutes'
)
RETURNS TABLE (
    renewed boolean,
    lease_expires_at timestamptz,
    db_now timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_lease interval := LEAST(GREATEST(COALESCE(p_lease, interval '5 minutes'), interval '1 minute'), interval '15 minutes');
    v_now timestamptz := clock_timestamp();
    v_state public.storage_orphan_scan_state%ROWTYPE;
    v_new_exp timestamptz;
BEGIN
    SELECT *
    INTO v_state
    FROM public.storage_orphan_scan_state s
    WHERE s.id = 1
    FOR UPDATE;

    IF NOT FOUND
       OR p_scan_token IS NULL
       OR v_state.scan_token IS DISTINCT FROM p_scan_token
       OR v_state.lease_expires_at IS NULL
       OR v_state.lease_expires_at <= v_now THEN
        RETURN QUERY SELECT false, NULL::timestamptz, v_now;
        RETURN;
    END IF;

    v_new_exp := v_now + v_lease;

    UPDATE public.storage_orphan_scan_state s
       SET lease_expires_at = v_new_exp,
           updated_at = v_now
     WHERE s.id = 1;

    RETURN QUERY SELECT true, v_new_exp, v_now;
END;
$$;

ALTER FUNCTION public.renew_orphan_scan_lease(uuid, interval) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.renew_orphan_scan_lease(uuid, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_orphan_scan_lease(uuid, interval) TO service_role;

-- 2.4 Save cursor / complete cycle (strict token & lease fencing)
CREATE OR REPLACE FUNCTION public.save_orphan_scan_cursor(
    p_cursor jsonb,
    p_cycle_completed boolean,
    p_scan_token uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_now timestamptz := clock_timestamp();
    v_state public.storage_orphan_scan_state%ROWTYPE;
BEGIN
    SELECT *
    INTO v_state
    FROM public.storage_orphan_scan_state s
    WHERE s.id = 1
    FOR UPDATE;

    IF NOT FOUND
       OR p_scan_token IS NULL
       OR v_state.scan_token IS DISTINCT FROM p_scan_token
       OR v_state.lease_expires_at IS NULL
       OR v_state.lease_expires_at <= v_now THEN
        RAISE EXCEPTION 'stale_orphan_scan_lease'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_cycle_completed IS NULL THEN
        RAISE EXCEPTION 'p_cycle_completed cannot be NULL'
            USING ERRCODE = '22023';
    END IF;

    IF p_cycle_completed THEN
        UPDATE public.storage_orphan_scan_state s
           SET cursor = NULL,
               cycle_started_at = NULL,
               cycle_completed_at = v_now,
               updated_at = v_now
         WHERE s.id = 1;
        RETURN;
    END IF;

    IF p_cursor IS NULL
       OR jsonb_typeof(p_cursor) <> 'object'
       OR jsonb_typeof(p_cursor->'v') <> 'number'
       OR (p_cursor->>'v') <> '1'
       OR jsonb_typeof(p_cursor->'bucketIndex') <> 'number'
       OR (p_cursor->>'bucketIndex') !~ '^[0-9]+$'
       OR jsonb_typeof(p_cursor->'queue') <> 'array'
       OR octet_length(p_cursor::text) > 65536 THEN
        RAISE EXCEPTION 'Invalid orphan scan cursor payload'
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.storage_orphan_scan_state s
       SET cursor = p_cursor,
           updated_at = v_now
     WHERE s.id = 1;
END;
$$;

ALTER FUNCTION public.save_orphan_scan_cursor(jsonb, boolean, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.save_orphan_scan_cursor(jsonb, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_orphan_scan_cursor(jsonb, boolean, uuid) TO service_role;

-- 2.5 Release lease cleanly (never modifies cursor or cycle timestamps)
CREATE OR REPLACE FUNCTION public.release_orphan_scan_lease(
    p_scan_token uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_now timestamptz := clock_timestamp();
    v_state public.storage_orphan_scan_state%ROWTYPE;
BEGIN
    SELECT *
    INTO v_state
    FROM public.storage_orphan_scan_state s
    WHERE s.id = 1
    FOR UPDATE;

    IF FOUND
       AND p_scan_token IS NOT NULL
       AND v_state.scan_token IS NOT DISTINCT FROM p_scan_token THEN
        UPDATE public.storage_orphan_scan_state s
           SET scan_token = NULL,
               lease_expires_at = NULL,
               updated_at = v_now
         WHERE s.id = 1;
    END IF;
END;
$$;

ALTER FUNCTION public.release_orphan_scan_lease(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.release_orphan_scan_lease(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_orphan_scan_lease(uuid) TO service_role;

-- =============================================================================
-- 3. Domain Retention Enqueue RPC (Global Lock Order 1 -> 2 -> 3, service_role only)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enqueue_soft_deleted_domain_storage_deletions(
    p_retention interval DEFAULT interval '7 days',
    p_limit integer DEFAULT 100
)
RETURNS TABLE (
    enqueued_count integer,
    skipped_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_retention interval := COALESCE(p_retention, interval '7 days');
    v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
    v_now timestamptz := clock_timestamp();
    v_cutoff timestamptz;
    v_cand_types text[] := ARRAY[]::text[];
    v_cand_ids uuid[] := ARRAY[]::uuid[];
    v_lock_buckets text[] := ARRAY[]::text[];
    v_lock_paths text[] := ARRAY[]::text[];
    v_idx integer;
    v_enqueued integer := 0;
    v_skipped integer := 0;
    v_rec_tenant uuid;
    v_rec_id uuid;
    v_rec_valid boolean;
    v_rec_buckets text[];
    v_rec_paths text[];
    v_all_locked boolean;
    v_p_idx integer;
    v_b text;
    v_p text;
    v_outcome text;
    v_path_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$';
BEGIN
    IF v_retention < interval '0 seconds' THEN
        RAISE EXCEPTION 'p_retention must be non-negative'
            USING ERRCODE = '22023';
    END IF;

    v_cutoff := v_now - v_retention;

    -- 1) Pre-read bounded batch of aged soft-deleted/cancelled records having at least 1 unqueued path
    WITH candidate_records AS (
        SELECT 'complaint'::text AS entity_type, c.id AS entity_id, c.deleted_at AS retention_ts
        FROM public.complaints c
        WHERE c.deleted_at IS NOT NULL
          AND c.deleted_at <= v_cutoff
          AND c.photo_path IS NOT NULL
          AND btrim(c.photo_path) <> ''
          AND NOT EXISTS (
              SELECT 1
              FROM public.storage_deletion_queue q
              WHERE q.bucket_id = 'complaints'
                AND q.object_path = c.photo_path
                AND q.status IN ('pending', 'processing', 'failed', 'exhausted')
          )

        UNION ALL

        SELECT 'activity'::text AS entity_type, a.id AS entity_id, a.deleted_at AS retention_ts
        FROM public.activities a
        WHERE a.deleted_at IS NOT NULL
          AND a.deleted_at <= v_cutoff
          AND jsonb_typeof(a.documentation_paths) = 'array'
          AND jsonb_array_length(a.documentation_paths) > 0
          AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(a.documentation_paths) AS doc(p)
              WHERE btrim(doc.p) <> ''
                AND NOT EXISTS (
                    SELECT 1
                    FROM public.storage_deletion_queue q
                    WHERE q.bucket_id = 'activity-docs'
                      AND q.object_path = doc.p
                      AND q.status IN ('pending', 'processing', 'failed', 'exhausted')
                )
          )

        UNION ALL

        SELECT 'letter_request'::text AS entity_type, lr.id AS entity_id, lr.updated_at AS retention_ts
        FROM public.letter_requests lr
        WHERE lr.status = 'cancelled'
          AND lr.updated_at <= v_cutoff
          AND (
              (
                  lr.issued_file_path IS NOT NULL
                  AND btrim(lr.issued_file_path) <> ''
                  AND NOT EXISTS (
                      SELECT 1
                      FROM public.storage_deletion_queue q
                      WHERE q.bucket_id = 'issued-letters'
                        AND q.object_path = lr.issued_file_path
                        AND q.status IN ('pending', 'processing', 'failed', 'exhausted')
                  )
              )
              OR (
                  jsonb_typeof(lr.supporting_doc_paths) = 'array'
                  AND jsonb_array_length(lr.supporting_doc_paths) > 0
                  AND EXISTS (
                      SELECT 1
                      FROM jsonb_array_elements_text(lr.supporting_doc_paths) AS doc(p)
                      WHERE btrim(doc.p) <> ''
                        AND NOT EXISTS (
                            SELECT 1
                            FROM public.storage_deletion_queue q
                            WHERE q.bucket_id = 'letter-requests'
                              AND q.object_path = doc.p
                              AND q.status IN ('pending', 'processing', 'failed', 'exhausted')
                        )
                  )
              )
          )
    ),
    limited_candidates AS (
        SELECT cr.entity_type, cr.entity_id
        FROM candidate_records cr
        ORDER BY cr.retention_ts ASC, cr.entity_type ASC, cr.entity_id ASC
        LIMIT v_limit
    )
    SELECT
        COALESCE(array_agg(lc.entity_type ORDER BY lc.entity_type ASC, lc.entity_id ASC), ARRAY[]::text[]),
        COALESCE(array_agg(lc.entity_id ORDER BY lc.entity_type ASC, lc.entity_id ASC), ARRAY[]::uuid[])
    INTO v_cand_types, v_cand_ids
    FROM limited_candidates lc;

    IF array_length(v_cand_types, 1) IS NULL THEN
        RETURN QUERY SELECT 0, 0;
        RETURN;
    END IF;

    -- Collect ALL paths attached to selected records in global ascending (bucket_id, object_path) order
    WITH selected AS (
        SELECT u.entity_type, u.entity_id
        FROM unnest(v_cand_types, v_cand_ids) AS u(entity_type, entity_id)
    ),
    candidate_paths AS (
        SELECT DISTINCT 'complaints'::text AS bucket_id, c.photo_path AS object_path
        FROM selected s
        JOIN public.complaints c ON s.entity_type = 'complaint' AND c.id = s.entity_id
        WHERE c.photo_path IS NOT NULL AND btrim(c.photo_path) <> ''

        UNION

        SELECT DISTINCT 'activity-docs'::text AS bucket_id, doc.p AS object_path
        FROM selected s
        JOIN public.activities a ON s.entity_type = 'activity' AND a.id = s.entity_id
        CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(a.documentation_paths, '[]'::jsonb)) AS doc(p)
        WHERE jsonb_typeof(a.documentation_paths) = 'array'
          AND btrim(doc.p) <> ''

        UNION

        SELECT DISTINCT 'issued-letters'::text AS bucket_id, lr.issued_file_path AS object_path
        FROM selected s
        JOIN public.letter_requests lr ON s.entity_type = 'letter_request' AND lr.id = s.entity_id
        WHERE lr.issued_file_path IS NOT NULL AND btrim(lr.issued_file_path) <> ''

        UNION

        SELECT DISTINCT 'letter-requests'::text AS bucket_id, doc.p AS object_path
        FROM selected s
        JOIN public.letter_requests lr ON s.entity_type = 'letter_request' AND lr.id = s.entity_id
        CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(lr.supporting_doc_paths, '[]'::jsonb)) AS doc(p)
        WHERE jsonb_typeof(lr.supporting_doc_paths) = 'array'
          AND btrim(doc.p) <> ''
    )
    SELECT
        COALESCE(array_agg(cp.bucket_id ORDER BY cp.bucket_id ASC, cp.object_path ASC), ARRAY[]::text[]),
        COALESCE(array_agg(cp.object_path ORDER BY cp.bucket_id ASC, cp.object_path ASC), ARRAY[]::text[])
    INTO v_lock_buckets, v_lock_paths
    FROM candidate_paths cp;

    -- Global Lock Order Step 1: Acquire ALL object advisory locks in deterministic ascending order
    IF array_length(v_lock_buckets, 1) IS NOT NULL THEN
        FOR v_idx IN 1..array_length(v_lock_buckets, 1) LOOP
            PERFORM pg_advisory_xact_lock(
                hashtextextended('storage:' || v_lock_buckets[v_idx] || '/' || v_lock_paths[v_idx], 0)
            );
        END LOOP;
    END IF;

    -- Global Lock Order Step 2 & 3: Lock each origin record FOR UPDATE, revalidate, and enqueue all files atomically
    FOR v_idx IN 1..array_length(v_cand_types, 1) LOOP
        v_rec_tenant := NULL;
        v_rec_id := v_cand_ids[v_idx];
        v_rec_valid := false;
        v_rec_buckets := ARRAY[]::text[];
        v_rec_paths := ARRAY[]::text[];

        IF v_cand_types[v_idx] = 'complaint' THEN
            SELECT c.tenant_id, c.photo_path,
                   (c.deleted_at IS NOT NULL AND c.deleted_at <= v_cutoff)
            INTO v_rec_tenant, v_p, v_rec_valid
            FROM public.complaints c
            WHERE c.id = v_rec_id
            FOR UPDATE;

            IF FOUND AND v_rec_valid AND v_p IS NOT NULL AND btrim(v_p) <> '' THEN
                v_rec_buckets := ARRAY['complaints'::text];
                v_rec_paths := ARRAY[v_p];
            ELSE
                v_rec_valid := false;
            END IF;

        ELSIF v_cand_types[v_idx] = 'activity' THEN
            SELECT a.tenant_id,
                   (a.deleted_at IS NOT NULL AND a.deleted_at <= v_cutoff)
            INTO v_rec_tenant, v_rec_valid
            FROM public.activities a
            WHERE a.id = v_rec_id
            FOR UPDATE;

            IF FOUND AND v_rec_valid THEN
                SELECT
                    COALESCE(array_agg(t.bucket_id ORDER BY t.bucket_id ASC, t.object_path ASC), ARRAY[]::text[]),
                    COALESCE(array_agg(t.object_path ORDER BY t.bucket_id ASC, t.object_path ASC), ARRAY[]::text[])
                INTO v_rec_buckets, v_rec_paths
                FROM (
                    SELECT DISTINCT 'activity-docs'::text AS bucket_id, d.p AS object_path
                    FROM public.activities a2
                    CROSS JOIN LATERAL jsonb_array_elements_text(
                        CASE WHEN jsonb_typeof(a2.documentation_paths) = 'array' THEN a2.documentation_paths ELSE '[]'::jsonb END
                    ) AS d(p)
                    WHERE a2.id = v_rec_id
                      AND btrim(d.p) <> ''
                ) AS t;
            ELSE
                v_rec_valid := false;
            END IF;

        ELSIF v_cand_types[v_idx] = 'letter_request' THEN
            SELECT lr.tenant_id,
                   (lr.status = 'cancelled' AND lr.updated_at <= v_cutoff)
            INTO v_rec_tenant, v_rec_valid
            FROM public.letter_requests lr
            WHERE lr.id = v_rec_id
            FOR UPDATE;

            IF FOUND AND v_rec_valid THEN
                SELECT
                    COALESCE(array_agg(t.bucket_id ORDER BY t.bucket_id ASC, t.object_path ASC), ARRAY[]::text[]),
                    COALESCE(array_agg(t.object_path ORDER BY t.bucket_id ASC, t.object_path ASC), ARRAY[]::text[])
                INTO v_rec_buckets, v_rec_paths
                FROM (
                    SELECT DISTINCT 'issued-letters'::text AS bucket_id, lr2.issued_file_path AS object_path
                    FROM public.letter_requests lr2
                    WHERE lr2.id = v_rec_id
                      AND lr2.issued_file_path IS NOT NULL
                      AND btrim(lr2.issued_file_path) <> ''

                    UNION

                    SELECT DISTINCT 'letter-requests'::text AS bucket_id, d.p AS object_path
                    FROM public.letter_requests lr2
                    CROSS JOIN LATERAL jsonb_array_elements_text(
                        CASE WHEN jsonb_typeof(lr2.supporting_doc_paths) = 'array' THEN lr2.supporting_doc_paths ELSE '[]'::jsonb END
                    ) AS d(p)
                    WHERE lr2.id = v_rec_id
                      AND btrim(d.p) <> ''
                ) AS t;
            ELSE
                v_rec_valid := false;
            END IF;
        END IF;

        IF NOT v_rec_valid OR array_length(v_rec_paths, 1) IS NULL THEN
            CONTINUE;
        END IF;

        -- Safety guard: ensure every current path on locked row was already advisory-locked in Step 1
        SELECT NOT EXISTS (
            SELECT 1
            FROM unnest(v_rec_buckets, v_rec_paths) AS cur(b, p)
            WHERE NOT EXISTS (
                SELECT 1
                FROM unnest(v_lock_buckets, v_lock_paths) AS lck(b, p)
                WHERE lck.b = cur.b AND lck.p = cur.p
            )
        )
        INTO v_all_locked;

        IF NOT v_all_locked THEN
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        FOR v_p_idx IN 1..array_length(v_rec_paths, 1) LOOP
            v_b := v_rec_buckets[v_p_idx];
            v_p := v_rec_paths[v_p_idx];

            IF v_p !~ v_path_re
               OR split_part(v_p, '/', 1) <> v_rec_tenant::text
               OR split_part(v_p, '/', 2) <> v_rec_id::text THEN
                PERFORM public.record_invalid_storage_path(
                    v_b,
                    v_p,
                    'domain_retention_invalid_path'
                );
                v_skipped := v_skipped + 1;
                CONTINUE;
            END IF;

            SELECT q.outcome
            INTO v_outcome
            FROM public._enqueue_storage_deletion_under_lock(
                v_rec_tenant,
                v_b,
                v_p,
                v_cand_types[v_idx],
                v_rec_id,
                NULL,
                'soft_delete_retention'
            ) AS q;

            IF v_outcome = 'created' THEN
                v_enqueued := v_enqueued + 1;
            ELSE
                v_skipped := v_skipped + 1;
            END IF;
        END LOOP;
    END LOOP;

    RETURN QUERY SELECT v_enqueued, v_skipped;
END;
$$;

ALTER FUNCTION public.enqueue_soft_deleted_domain_storage_deletions(interval, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enqueue_soft_deleted_domain_storage_deletions(interval, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_soft_deleted_domain_storage_deletions(interval, integer) TO service_role;

-- =============================================================================
-- 4. Atomic Complaint Soft Delete (authenticated staff only, Global Lock Order 1 -> 2 -> 3)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.soft_delete_complaint(
    p_complaint_id uuid,
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
    v_pre_tenant_id uuid;
    v_pre_photo_path text;
    v_c public.complaints%ROWTYPE;
    v_now timestamptz := clock_timestamp();
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    SELECT c.tenant_id, c.photo_path
    INTO v_pre_tenant_id, v_pre_photo_path
    FROM public.complaints c
    WHERE c.id = p_complaint_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Complaint % not found', p_complaint_id
            USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.has_tenant_role(v_pre_tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus']) THEN
        RAISE EXCEPTION 'Forbidden: requires staff role'
            USING ERRCODE = '42501';
    END IF;

    -- Global Lock Order Step 1: advisory lock before locking complaint row
    IF v_pre_photo_path IS NOT NULL AND btrim(v_pre_photo_path) <> '' THEN
        PERFORM pg_advisory_xact_lock(
            hashtextextended('storage:complaints/' || v_pre_photo_path, 0)
        );
    END IF;

    -- Global Lock Order Step 2: lock complaint row FOR UPDATE and revalidate
    SELECT *
    INTO v_c
    FROM public.complaints c
    WHERE c.id = p_complaint_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Complaint % not found', p_complaint_id
            USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.has_tenant_role(v_c.tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus']) THEN
        RAISE EXCEPTION 'Forbidden: requires staff role'
            USING ERRCODE = '42501';
    END IF;

    IF v_c.photo_path IS DISTINCT FROM v_pre_photo_path
       AND v_c.photo_path IS NOT NULL
       AND btrim(v_c.photo_path) <> '' THEN
        RAISE EXCEPTION 'Concurrent complaint photo update; retry soft delete'
            USING ERRCODE = '40001';
    END IF;

    -- Idempotent: repeated call after soft-delete succeeds without duplicating audit or queue job
    IF v_c.deleted_at IS NOT NULL THEN
        RETURN;
    END IF;

    UPDATE public.complaints c
       SET deleted_at = v_now
     WHERE c.id = v_c.id;

    -- Global Lock Order Step 3: enqueue deletion without detaching photo_path yet
    IF v_c.photo_path IS NOT NULL AND btrim(v_c.photo_path) <> '' THEN
        PERFORM 1
        FROM public._enqueue_storage_deletion_under_lock(
            v_c.tenant_id,
            'complaints',
            v_c.photo_path,
            'complaint',
            v_c.id,
            v_actor,
            COALESCE(NULLIF(btrim(p_reason), ''), 'complaint_soft_deleted')
        );
    END IF;

    INSERT INTO public.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    VALUES (
        v_c.tenant_id,
        v_actor,
        'complaint.soft_deleted',
        'complaints',
        v_c.id,
        jsonb_build_object(
            'reason', NULLIF(btrim(p_reason), ''),
            'status_at_delete', v_c.status,
            'had_photo', (v_c.photo_path IS NOT NULL AND btrim(v_c.photo_path) <> '')
        )
    );
END;
$$;

ALTER FUNCTION public.soft_delete_complaint(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.soft_delete_complaint(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.soft_delete_complaint(uuid, text) TO authenticated;

-- =============================================================================
-- 5. Health Monitoring RPC (Aggregated metrics only; super_admin or service_role)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_storage_deletion_health_summary()
RETURNS TABLE (
    pending_count bigint,
    oldest_pending_at timestamptz,
    oldest_pending_age interval,
    processing_count bigint,
    expired_processing_count bigint,
    failed_count bigint,
    exhausted_count bigint,
    completed_count bigint,
    completed_last_24h_count bigint,
    quarantined_invalid_path_count bigint,
    quarantined_last_24h_count bigint,
    orphan_has_cursor boolean,
    orphan_lease_active boolean,
    orphan_lease_expires_at timestamptz,
    orphan_cycle_started_at timestamptz,
    orphan_cycle_completed_at timestamptz,
    orphan_state_updated_at timestamptz,
    db_now timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_now timestamptz := clock_timestamp();
BEGIN
    IF current_user <> 'service_role' AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Forbidden: requires super_admin or service_role'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    WITH q_agg AS (
        SELECT
            count(*) FILTER (WHERE q.status = 'pending')::bigint AS pending_count,
            min(q.requested_at) FILTER (WHERE q.status = 'pending') AS oldest_pending_at,
            count(*) FILTER (WHERE q.status = 'processing')::bigint AS processing_count,
            count(*) FILTER (
                WHERE q.status = 'processing' AND q.lease_expires_at <= v_now
            )::bigint AS expired_processing_count,
            count(*) FILTER (WHERE q.status = 'failed')::bigint AS failed_count,
            count(*) FILTER (WHERE q.status = 'exhausted')::bigint AS exhausted_count,
            count(*) FILTER (WHERE q.status = 'completed')::bigint AS completed_count,
            count(*) FILTER (
                WHERE q.status = 'completed' AND q.completed_at >= (v_now - interval '24 hours')
            )::bigint AS completed_last_24h_count
        FROM public.storage_deletion_queue q
    ),
    a_agg AS (
        SELECT
            count(*)::bigint AS quarantined_invalid_path_count,
            count(*) FILTER (
                WHERE al.created_at >= (v_now - interval '24 hours')
            )::bigint AS quarantined_last_24h_count
        FROM public.audit_logs al
        WHERE al.action = 'storage_deletion.invalid_path_quarantined'
          AND al.entity_type = 'storage_object'
    ),
    o_state AS (
        SELECT
            (s.cursor IS NOT NULL) AS orphan_has_cursor,
            (s.scan_token IS NOT NULL AND s.lease_expires_at > v_now) AS orphan_lease_active,
            s.lease_expires_at AS orphan_lease_expires_at,
            s.cycle_started_at AS orphan_cycle_started_at,
            s.cycle_completed_at AS orphan_cycle_completed_at,
            s.updated_at AS orphan_state_updated_at
        FROM public.storage_orphan_scan_state s
        WHERE s.id = 1
    )
    SELECT
        q_agg.pending_count,
        q_agg.oldest_pending_at,
        CASE
            WHEN q_agg.oldest_pending_at IS NOT NULL THEN v_now - q_agg.oldest_pending_at
            ELSE NULL::interval
        END AS oldest_pending_age,
        q_agg.processing_count,
        q_agg.expired_processing_count,
        q_agg.failed_count,
        q_agg.exhausted_count,
        q_agg.completed_count,
        q_agg.completed_last_24h_count,
        a_agg.quarantined_invalid_path_count,
        a_agg.quarantined_last_24h_count,
        COALESCE(o_state.orphan_has_cursor, false),
        COALESCE(o_state.orphan_lease_active, false),
        o_state.orphan_lease_expires_at,
        o_state.orphan_cycle_started_at,
        o_state.orphan_cycle_completed_at,
        o_state.orphan_state_updated_at,
        v_now
    FROM q_agg
    CROSS JOIN a_agg
    LEFT JOIN o_state ON true;
END;
$$;

ALTER FUNCTION public.get_storage_deletion_health_summary() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_storage_deletion_health_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_storage_deletion_health_summary() TO authenticated, service_role;

COMMIT;
