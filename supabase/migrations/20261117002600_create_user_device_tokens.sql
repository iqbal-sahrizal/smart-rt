-- =============================================================================
-- Migration 0026: User Device Tokens for FCM Push Notifications
-- Domain: Notifications & Device Registration
-- =============================================================================
-- Creates public.user_device_tokens for multi-tenant FCM token storage,
-- strict Row Level Security, and atomic SECURITY DEFINER registration RPCs.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_device_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
    fcm_token text NOT NULL,
    platform text NOT NULL DEFAULT 'android' CHECK (platform IN ('android', 'ios', 'web')),
    device_info jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_active boolean NOT NULL DEFAULT true,
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_user_device_tokens_member
        FOREIGN KEY (tenant_id, user_id)
        REFERENCES public.tenant_members (tenant_id, user_id)
        ON DELETE CASCADE,
    CONSTRAINT uq_user_device_tokens_fcm_token
        UNIQUE (fcm_token)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_device_tokens_lookup
    ON public.user_device_tokens (user_id, tenant_id, is_active);

CREATE INDEX IF NOT EXISTS idx_user_device_tokens_tenant
    ON public.user_device_tokens (tenant_id, is_active);

-- Enable RLS
ALTER TABLE public.user_device_tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS user_device_tokens_select_own ON public.user_device_tokens;
CREATE POLICY user_device_tokens_select_own
    ON public.user_device_tokens
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_device_tokens_insert_own ON public.user_device_tokens;
CREATE POLICY user_device_tokens_insert_own
    ON public.user_device_tokens
    FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.tenant_members tm
            WHERE tm.tenant_id = user_device_tokens.tenant_id
              AND tm.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS user_device_tokens_update_own ON public.user_device_tokens;
CREATE POLICY user_device_tokens_update_own
    ON public.user_device_tokens
    FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_device_tokens_delete_own ON public.user_device_tokens;
CREATE POLICY user_device_tokens_delete_own
    ON public.user_device_tokens
    FOR DELETE
    TO authenticated
    USING (user_id = auth.uid());

-- Service role full access for Edge Functions
DROP POLICY IF EXISTS user_device_tokens_service_role ON public.user_device_tokens;
CREATE POLICY user_device_tokens_service_role
    ON public.user_device_tokens
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- =============================================================================
-- RPC: Atomic Device Token Registration
-- =============================================================================
CREATE OR REPLACE FUNCTION public.register_device_token(
    p_tenant_id uuid,
    p_fcm_token text,
    p_platform text DEFAULT 'android',
    p_device_info jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_clean_token text := trim(p_fcm_token);
    v_clean_platform text := lower(trim(p_platform));
    v_token_id uuid;
BEGIN
    -- 1. Authentication check
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    -- 2. Token validation
    IF v_clean_token IS NULL OR length(v_clean_token) < 10 OR length(v_clean_token) > 4096 THEN
        RAISE EXCEPTION 'Invalid FCM token format or length' USING ERRCODE = '22023';
    END IF;

    IF v_clean_platform NOT IN ('android', 'ios', 'web') THEN
        v_clean_platform := 'android';
    END IF;

    -- 3. Tenant membership check
    IF NOT EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = p_tenant_id
          AND tm.user_id = v_user_id
    ) THEN
        RAISE EXCEPTION 'User is not a member of the specified tenant' USING ERRCODE = '42501';
    END IF;

    -- 4. Atomic upsert
    -- If the fcm_token already exists on another user/tenant (e.g. device reassigned or re-logged in),
    -- reassign it to the current user and tenant.
    INSERT INTO public.user_device_tokens (
        tenant_id,
        user_id,
        fcm_token,
        platform,
        device_info,
        is_active,
        last_seen_at,
        created_at,
        updated_at
    )
    VALUES (
        p_tenant_id,
        v_user_id,
        v_clean_token,
        v_clean_platform,
        coalesce(p_device_info, '{}'::jsonb),
        true,
        now(),
        now(),
        now()
    )
    ON CONFLICT (fcm_token) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        user_id = EXCLUDED.user_id,
        platform = EXCLUDED.platform,
        device_info = EXCLUDED.device_info,
        is_active = true,
        last_seen_at = now(),
        updated_at = now()
    RETURNING id INTO v_token_id;

    RETURN jsonb_build_object(
        'success', true,
        'token_id', v_token_id,
        'registered_at', now()
    );
END;
$$;

ALTER FUNCTION public.register_device_token(uuid, text, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.register_device_token(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_device_token(uuid, text, text, jsonb) TO authenticated, service_role;

-- =============================================================================
-- RPC: Atomic Device Token Unregistration (e.g. on logout)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.unregister_device_token(
    p_fcm_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_clean_token text := trim(p_fcm_token);
    v_rows_affected integer;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    IF v_clean_token IS NULL OR length(v_clean_token) < 10 THEN
        RETURN jsonb_build_object('success', false, 'reason', 'Invalid token');
    END IF;

    UPDATE public.user_device_tokens
    SET is_active = false,
        updated_at = now()
    WHERE fcm_token = v_clean_token
      AND user_id = v_user_id;

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', true,
        'deactivated', v_rows_affected > 0
    );
END;
$$;

ALTER FUNCTION public.unregister_device_token(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.unregister_device_token(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unregister_device_token(text) TO authenticated, service_role;

COMMIT;

