-- Step 10.2.1 Migration 0010: PostgreSQL Privilege Hardening & RLS Helper Functions
-- NOTE: Does NOT enable RLS or create RLS policies (deferred to Step 10.2.2).
-- NOTE: Does NOT modify Supabase internal schemas or authenticator role membership.

-- =============================================================================
-- 1. Schema public privileges
-- =============================================================================
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- =============================================================================
-- 2. Revoke over-permissive table privileges & apply least-privilege grants
-- =============================================================================
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- Global read-only catalog
GRANT SELECT ON public.roles TO authenticated;

-- User-owned profile: preserve ONLY the 4 explicit column-level UPDATE grants
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (full_name, phone, avatar_path, active_tenant_id) ON public.profiles TO authenticated;

-- Tenant-owned & sensitive tables (full DML governed by RLS in Step 10.2.2)
GRANT SELECT, INSERT, UPDATE, DELETE ON
    public.tenants,
    public.tenant_members,
    public.member_roles,
    public.households,
    public.residents,
    public.resident_private_data,
    public.resident_documents,
    public.vehicles,
    public.dues,
    public.cash_categories,
    public.announcements,
    public.announcement_recipients,
    public.letter_types,
    public.activities,
    public.activity_participants
TO authenticated;

-- Tables without direct DELETE (use status/soft-delete or atomic RPC)
GRANT SELECT, INSERT, UPDATE ON
    public.bills,
    public.cash_transactions,
    public.letter_requests
TO authenticated;

-- Complaints: column-level UPDATE for warga content editing; status via atomic RPC
GRANT SELECT, INSERT ON public.complaints TO authenticated;
GRANT UPDATE (category, title, description, photo_path) ON public.complaints TO authenticated;

-- Append-only / RPC-managed tables
GRANT SELECT, INSERT ON
    public.payments,
    public.complaint_replies,
    public.complaint_status_history
TO authenticated;

-- Notifications: column-level UPDATE (is_read, read_at) only; INSERT via backend/SECURITY DEFINER
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (is_read, read_at) ON public.notifications TO authenticated;

-- Audit logs: read-only for authorized roles via RLS; no direct client writes
GRANT SELECT ON public.audit_logs TO authenticated;

-- Backend-only tables (payment_webhook_events, letter_sequences): NO client grants

-- =============================================================================
-- 3. Sequence privileges
-- =============================================================================
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- =============================================================================
-- 4. Revoke EXECUTE on all existing trigger-only functions from PUBLIC/anon/authenticated
-- =============================================================================
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- =============================================================================
-- 5. Default privileges for postgres in schema public (do NOT alter supabase_admin)
-- =============================================================================
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO service_role;

-- =============================================================================
-- 6. Harden validate_tenant_actor() as SECURITY DEFINER (trigger-only)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.validate_tenant_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_col_name text := TG_ARGV[0];
    v_mode text := COALESCE(TG_ARGV[1], 'allow_super_admin');
    v_actor_id uuid;
    v_tenant_id uuid := NEW.tenant_id;
    v_is_member boolean := false;
    v_is_super_admin boolean := false;
BEGIN
    IF v_tenant_id IS NULL THEN
        RETURN NEW;
    END IF;

    EXECUTE format('SELECT ($1).%I', v_col_name)
    INTO v_actor_id
    USING NEW;

    IF v_actor_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.tenant_members tm
        WHERE tm.tenant_id = v_tenant_id
          AND tm.user_id = v_actor_id
    )
    INTO v_is_member;

    IF v_is_member THEN
        RETURN NEW;
    END IF;

    IF v_mode = 'allow_super_admin' THEN
        SELECT EXISTS (
            SELECT 1
            FROM public.profiles p
            WHERE p.id = v_actor_id
              AND p.is_super_admin IS TRUE
        )
        INTO v_is_super_admin;

        IF v_is_super_admin THEN
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION 'Actor % on column % is not a member of tenant %', v_actor_id, v_col_name, v_tenant_id;
END;
$$;

ALTER FUNCTION public.validate_tenant_actor() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.validate_tenant_actor() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_tenant_actor() TO service_role;

-- =============================================================================
-- 7. Six RLS Helper Functions (SECURITY DEFINER, STABLE, auth.uid()-bound)
-- =============================================================================

-- 7.1 Check if caller is a platform super_admin
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.is_super_admin IS TRUE
    );
$$;

ALTER FUNCTION public.is_super_admin() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated, service_role;

-- 7.2 Check if caller is an active member of an active tenant
CREATE OR REPLACE FUNCTION public.is_tenant_member(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.tenant_members tm
        JOIN public.tenants t ON t.id = tm.tenant_id
        WHERE tm.tenant_id = p_tenant_id
          AND tm.user_id = auth.uid()
          AND tm.status = 'active'
          AND t.status = 'active'
          AND t.deleted_at IS NULL
    );
$$;

ALTER FUNCTION public.is_tenant_member(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_tenant_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_tenant_member(uuid) TO authenticated, service_role;

-- 7.3 Check if caller has at least one of the requested roles in an active tenant
CREATE OR REPLACE FUNCTION public.has_tenant_role(p_tenant_id uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.tenant_members tm
        JOIN public.tenants t ON t.id = tm.tenant_id
        JOIN public.member_roles mr ON mr.member_id = tm.id AND mr.tenant_id = tm.tenant_id
        JOIN public.roles r ON r.id = mr.role_id
        WHERE tm.tenant_id = p_tenant_id
          AND tm.user_id = auth.uid()
          AND tm.status = 'active'
          AND t.status = 'active'
          AND t.deleted_at IS NULL
          AND r.code = ANY(p_roles)
    );
$$;

ALTER FUNCTION public.has_tenant_role(uuid, text[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.has_tenant_role(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_tenant_role(uuid, text[]) TO authenticated, service_role;

-- 7.4 Return caller's active tenant_members.id in a tenant
CREATE OR REPLACE FUNCTION public.get_my_member_id(p_tenant_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT tm.id
    FROM public.tenant_members tm
    JOIN public.tenants t ON t.id = tm.tenant_id
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = auth.uid()
      AND tm.status = 'active'
      AND t.status = 'active'
      AND t.deleted_at IS NULL
    LIMIT 1;
$$;

ALTER FUNCTION public.get_my_member_id(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_my_member_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_member_id(uuid) TO authenticated, service_role;

-- 7.5 Return caller's linked resident_id in an active tenant
CREATE OR REPLACE FUNCTION public.get_my_resident_id(p_tenant_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT tm.resident_id
    FROM public.tenant_members tm
    JOIN public.tenants t ON t.id = tm.tenant_id
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = auth.uid()
      AND tm.status = 'active'
      AND t.status = 'active'
      AND t.deleted_at IS NULL
    LIMIT 1;
$$;

ALTER FUNCTION public.get_my_resident_id(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_my_resident_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_resident_id(uuid) TO authenticated, service_role;

-- 7.6 Return caller's linked household_id in an active tenant
CREATE OR REPLACE FUNCTION public.get_my_household_id(p_tenant_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT r.household_id
    FROM public.tenant_members tm
    JOIN public.tenants t ON t.id = tm.tenant_id
    JOIN public.residents r ON r.id = tm.resident_id AND r.tenant_id = tm.tenant_id
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = auth.uid()
      AND tm.status = 'active'
      AND t.status = 'active'
      AND t.deleted_at IS NULL
      AND r.deleted_at IS NULL
    LIMIT 1;
$$;

ALTER FUNCTION public.get_my_household_id(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_my_household_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_household_id(uuid) TO authenticated, service_role;

