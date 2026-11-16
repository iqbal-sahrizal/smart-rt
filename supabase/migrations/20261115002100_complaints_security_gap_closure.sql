-- =============================================================================
-- Step 13.1 Migration 0021: Complaints Security Gap Closure
-- =============================================================================
-- Addresses the 3 security & audit gaps identified in Step 13.0:
--   1. Gap A: Disable complaint reply attachments at DB level (no Storage bucket
--             or attachment RPC exists for replies; refuse if non-NULL rows exist).
--   2. Gap B: Close soft-delete privacy gap in complaint_status_history_select so
--             reporters cannot read status history after soft-deleting a complaint.
--   3. Gap C: Record tamper-resistant audit logs on complaint creation
--             (complaint.created) and reply creation (complaint_reply.created)
--             via hardened SECURITY DEFINER AFTER INSERT triggers without
--             granting authenticated clients INSERT on public.audit_logs and
--             without storing PII or free-text message payloads in metadata.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. Gap A: Enforce NULL complaint_replies.attachment_path
-- =============================================================================
DO $$
DECLARE
    v_non_null_count bigint;
BEGIN
    SELECT count(*)
    INTO v_non_null_count
    FROM public.complaint_replies
    WHERE attachment_path IS NOT NULL;

    IF v_non_null_count > 0 THEN
        RAISE EXCEPTION
            'Cannot apply chk_complaint_replies_attachment_null: % existing row(s) have non-NULL attachment_path',
            v_non_null_count
            USING ERRCODE = 'check_violation';
    END IF;
END
$$;

ALTER TABLE public.complaint_replies
    ADD CONSTRAINT chk_complaint_replies_attachment_null
    CHECK (attachment_path IS NULL);

-- =============================================================================
-- 2. Gap B: Close soft-delete leak in complaint_status_history_select
-- =============================================================================
DROP POLICY IF EXISTS complaint_status_history_select ON public.complaint_status_history;

CREATE POLICY complaint_status_history_select
    ON public.complaint_status_history
    FOR SELECT
    TO authenticated
    USING (
        public.is_super_admin()
        OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'bendahara', 'pengurus'])
        OR (
            public.is_tenant_member(tenant_id)
            AND EXISTS (
                SELECT 1
                FROM public.complaints c
                WHERE c.id = complaint_status_history.complaint_id
                  AND c.tenant_id = complaint_status_history.tenant_id
                  AND c.reporter_member_id = public.get_my_member_id(complaint_status_history.tenant_id)
                  AND c.deleted_at IS NULL
            )
        )
    );

-- =============================================================================
-- 3. Gap C: Audit triggers for complaint.created and complaint_reply.created
-- =============================================================================
CREATE OR REPLACE FUNCTION public._record_complaint_domain_audit(
    p_tenant_id uuid,
    p_member_id uuid,
    p_action text,
    p_entity_type text,
    p_entity_id uuid,
    p_metadata jsonb
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
    SELECT tm.user_id
    INTO v_member_user_id
    FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id
      AND tm.id = p_member_id;

    IF v_actor IS NOT NULL THEN
        IF v_member_user_id IS DISTINCT FROM v_actor THEN
            SELECT COALESCE(p.is_super_admin, false)
            INTO v_is_super_admin
            FROM public.profiles p
            WHERE p.id = v_actor;

            IF NOT v_is_super_admin THEN
                RAISE EXCEPTION 'Forbidden: authenticated actor does not match tenant member'
                    USING ERRCODE = '42501';
            END IF;
        END IF;
    ELSE
        IF v_role IN ('anon', 'authenticated') OR session_user NOT IN ('postgres', 'supabase_admin') THEN
            RAISE EXCEPTION 'Unauthenticated audit actor'
                USING ERRCODE = '42501';
        END IF;
        v_actor := v_member_user_id;
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

ALTER FUNCTION public._record_complaint_domain_audit(uuid, uuid, text, text, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._record_complaint_domain_audit(uuid, uuid, text, text, uuid, jsonb)
    FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.audit_complaint_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public._record_complaint_domain_audit(
        NEW.tenant_id,
        NEW.reporter_member_id,
        'complaint.created',
        'complaints',
        NEW.id,
        jsonb_build_object(
            'complaint_id', NEW.id,
            'reporter_member_id', NEW.reporter_member_id,
            'category', NEW.category,
            'status', NEW.status,
            'priority', NEW.priority,
            'has_photo', (NEW.photo_path IS NOT NULL AND btrim(NEW.photo_path) <> '')
        )
    );

    RETURN NULL;
END;
$$;

ALTER FUNCTION public.audit_complaint_insert() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.audit_complaint_insert()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.audit_complaint_reply_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public._record_complaint_domain_audit(
        NEW.tenant_id,
        NEW.author_member_id,
        'complaint_reply.created',
        'complaint_replies',
        NEW.id,
        jsonb_build_object(
            'complaint_id', NEW.complaint_id,
            'reply_id', NEW.id,
            'author_member_id', NEW.author_member_id
        )
    );

    RETURN NULL;
END;
$$;

ALTER FUNCTION public.audit_complaint_reply_insert() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.audit_complaint_reply_insert()
    FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_complaints_audit_insert ON public.complaints;
CREATE TRIGGER trg_complaints_audit_insert
    AFTER INSERT ON public.complaints
    FOR EACH ROW EXECUTE FUNCTION public.audit_complaint_insert();

DROP TRIGGER IF EXISTS trg_complaint_replies_audit_insert ON public.complaint_replies;
CREATE TRIGGER trg_complaint_replies_audit_insert
    AFTER INSERT ON public.complaint_replies
    FOR EACH ROW EXECUTE FUNCTION public.audit_complaint_reply_insert();

COMMIT;

