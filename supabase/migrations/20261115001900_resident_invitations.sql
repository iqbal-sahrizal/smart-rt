-- Step 11.7 Migration 0019: Resident Account Activation & Invitation
-- Introduces public.resident_invitations (hashed one-time tokens, strict RLS)
-- and atomic SECURITY DEFINER RPCs for creating, revoking, resending,
-- validating, and redeeming resident invitations with 'warga'-only role binding.

BEGIN;

-- =============================================================================
-- 1. Table: public.resident_invitations
-- =============================================================================
CREATE TABLE public.resident_invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    resident_id uuid NOT NULL,
    email text NOT NULL,
    token_hash text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'pending'
        CONSTRAINT chk_resident_invitations_status CHECK (
            status IN ('pending', 'redeemed', 'revoked', 'expired')
        ),
    expires_at timestamptz NOT NULL,
    invited_by uuid NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
    redeemed_by uuid NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
    redeemed_at timestamptz NULL,
    revoked_by uuid NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
    revoked_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_resident_invitations_resident
        FOREIGN KEY (tenant_id, resident_id)
        REFERENCES public.residents (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT chk_resident_invitations_email_normalized CHECK (
        email = lower(btrim(email))
        AND length(btrim(email)) >= 5
        AND position('@' in email) > 1
    ),
    CONSTRAINT chk_resident_invitations_expiry_after_create CHECK (
        expires_at > created_at
    )
);

-- At most one pending invitation per resident inside a tenant
CREATE UNIQUE INDEX uq_resident_invitations_pending_resident
    ON public.resident_invitations (tenant_id, resident_id)
    WHERE status = 'pending';

CREATE INDEX idx_resident_invitations_tenant_status
    ON public.resident_invitations (tenant_id, status, created_at DESC);

CREATE INDEX idx_resident_invitations_resident
    ON public.resident_invitations (tenant_id, resident_id, created_at DESC);

-- Triggers: updated_at & actor integrity
CREATE TRIGGER trg_resident_invitations_updated_at
    BEFORE UPDATE ON public.resident_invitations
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_resident_invitations_validate_invited_by
    BEFORE INSERT OR UPDATE OF tenant_id, invited_by ON public.resident_invitations
    FOR EACH ROW EXECUTE FUNCTION public.validate_tenant_actor('invited_by', 'allow_super_admin');

-- Least-privilege grants & RLS (mutations only via SECURITY DEFINER RPCs)
ALTER TABLE public.resident_invitations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.resident_invitations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.resident_invitations TO authenticated;
GRANT ALL ON public.resident_invitations TO service_role;

CREATE POLICY resident_invitations_select
    ON public.resident_invitations
    FOR SELECT
    TO authenticated
    USING (
        public.is_super_admin()
        OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris'])
    );

-- =============================================================================
-- 2. Internal Helper: Mask Email for Safe Pre-Activation Preview
-- =============================================================================
CREATE OR REPLACE FUNCTION public._mask_invitation_email(p_email text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_at integer;
    v_local text;
    v_domain text;
    v_prefix text;
BEGIN
    IF p_email IS NULL OR btrim(p_email) = '' THEN
        RETURN NULL;
    END IF;
    v_at := position('@' in p_email);
    IF v_at <= 1 THEN
        RETURN '***';
    END IF;
    v_local := substring(p_email from 1 for v_at - 1);
    v_domain := substring(p_email from v_at + 1);
    v_prefix := CASE
        WHEN length(v_local) <= 2 THEN left(v_local, 1)
        ELSE left(v_local, 2)
    END;
    RETURN v_prefix || '***@' || v_domain;
END;
$$;

ALTER FUNCTION public._mask_invitation_email(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._mask_invitation_email(text) FROM PUBLIC, anon, authenticated, service_role;

-- =============================================================================
-- 3. RPC: create_resident_invitation (ketua_rt / sekretaris only)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_resident_invitation(
    p_resident_id uuid,
    p_email text,
    p_expires_in_hours integer DEFAULT 168
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_res record;
    v_tenant record;
    v_household_deleted timestamptz;
    v_email text;
    v_expires_hours integer;
    v_expires_at timestamptz;
    v_raw_token text;
    v_token_hash text;
    v_invitation_id uuid;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    v_email := lower(btrim(COALESCE(p_email, '')));
    IF v_email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$' THEN
        RAISE EXCEPTION 'Invalid email format' USING ERRCODE = '22023';
    END IF;

    v_expires_hours := COALESCE(p_expires_in_hours, 168);
    IF v_expires_hours < 1 OR v_expires_hours > 720 THEN
        RAISE EXCEPTION 'Expiration hours must be between 1 and 720' USING ERRCODE = '22023';
    END IF;

    -- Lock target resident inside active tenant
    SELECT r.id, r.tenant_id, r.household_id, r.full_name, r.residency_status, r.deleted_at
    INTO v_res
    FROM public.residents r
    WHERE r.id = p_resident_id
    FOR UPDATE;

    IF NOT FOUND OR v_res.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Resident not found' USING ERRCODE = 'P0002';
    END IF;

    -- Derive tenant from database row, never trust client tenant_id
    IF NOT public.has_tenant_role(v_res.tenant_id, ARRAY['ketua_rt', 'sekretaris']) THEN
        RAISE EXCEPTION 'Forbidden: only ketua_rt or sekretaris can invite residents'
            USING ERRCODE = '42501';
    END IF;

    SELECT t.id, t.status, t.deleted_at
    INTO v_tenant
    FROM public.tenants t
    WHERE t.id = v_res.tenant_id;

    IF NOT FOUND OR v_tenant.deleted_at IS NOT NULL OR v_tenant.status <> 'active' THEN
        RAISE EXCEPTION 'Tenant is inactive' USING ERRCODE = '22023';
    END IF;

    SELECT h.deleted_at
    INTO v_household_deleted
    FROM public.households h
    WHERE h.id = v_res.household_id
      AND h.tenant_id = v_res.tenant_id;

    IF NOT FOUND OR v_household_deleted IS NOT NULL THEN
        RAISE EXCEPTION 'Resident household is not active' USING ERRCODE = '22023';
    END IF;

    IF v_res.residency_status <> 'aktif' THEN
        RAISE EXCEPTION 'Only active residents can be invited for portal activation'
            USING ERRCODE = '22023';
    END IF;

    -- Prevent inviting a resident already linked to a tenant_members account
    IF EXISTS (
        SELECT 1
        FROM public.tenant_members tm
        WHERE tm.tenant_id = v_res.tenant_id
          AND tm.resident_id = v_res.id
          AND tm.status IN ('active', 'invited')
    ) THEN
        RAISE EXCEPTION 'Resident already has an active or linked account'
            USING ERRCODE = '23505';
    END IF;

    -- Mark any stale expired pending invitations on this resident as expired
    UPDATE public.resident_invitations ri
       SET status = 'expired'
     WHERE ri.tenant_id = v_res.tenant_id
       AND ri.resident_id = v_res.id
       AND ri.status = 'pending'
       AND ri.expires_at <= now();

    -- Reject if an active non-expired pending invitation already exists
    IF EXISTS (
        SELECT 1
        FROM public.resident_invitations ri
        WHERE ri.tenant_id = v_res.tenant_id
          AND ri.resident_id = v_res.id
          AND ri.status = 'pending'
    ) THEN
        RAISE EXCEPTION 'An active pending invitation already exists for this resident'
            USING ERRCODE = '23505';
    END IF;

    -- Prevent conflicting active pending invitations for the same email in the same tenant
    IF EXISTS (
        SELECT 1
        FROM public.resident_invitations ri
        WHERE ri.tenant_id = v_res.tenant_id
          AND ri.email = v_email
          AND ri.status = 'pending'
          AND ri.expires_at > now()
          AND ri.resident_id <> v_res.id
    ) THEN
        RAISE EXCEPTION 'Another resident in this RT already has a pending invitation for this email'
            USING ERRCODE = '23505';
    END IF;

    -- 256-bit CSPRNG token; only SHA-256 hex digest is persisted
    v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');
    v_token_hash := encode(extensions.digest(convert_to(v_raw_token, 'UTF8'), 'sha256'), 'hex');
    v_expires_at := now() + make_interval(hours => v_expires_hours);

    INSERT INTO public.resident_invitations (
        tenant_id,
        resident_id,
        email,
        token_hash,
        status,
        expires_at,
        invited_by
    )
    VALUES (
        v_res.tenant_id,
        v_res.id,
        v_email,
        v_token_hash,
        'pending',
        v_expires_at,
        v_actor
    )
    RETURNING id INTO v_invitation_id;

    INSERT INTO public.audit_logs (
        tenant_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
    )
    VALUES (
        v_res.tenant_id,
        v_actor,
        'resident_invitation.created',
        'resident_invitations',
        v_invitation_id,
        jsonb_build_object(
            'resident_id', v_res.id,
            'resident_name', v_res.full_name,
            'email', v_email,
            'expires_at', v_expires_at
        )
    );

    RETURN jsonb_build_object(
        'invitation_id', v_invitation_id,
        'tenant_id', v_res.tenant_id,
        'resident_id', v_res.id,
        'email', v_email,
        'status', 'pending',
        'expires_at', v_expires_at,
        'raw_token', v_raw_token
    );
END;
$$;

ALTER FUNCTION public.create_resident_invitation(uuid, text, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_resident_invitation(uuid, text, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_resident_invitation(uuid, text, integer) TO authenticated;

-- =============================================================================
-- 4. RPC: revoke_resident_invitation (ketua_rt / sekretaris only)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.revoke_resident_invitation(
    p_invitation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_inv record;
    v_res_name text;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    SELECT ri.*
    INTO v_inv
    FROM public.resident_invitations ri
    WHERE ri.id = p_invitation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invitation not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.has_tenant_role(v_inv.tenant_id, ARRAY['ketua_rt', 'sekretaris']) THEN
        RAISE EXCEPTION 'Forbidden: only ketua_rt or sekretaris can revoke invitations'
            USING ERRCODE = '42501';
    END IF;

    IF v_inv.status <> 'pending' THEN
        RAISE EXCEPTION 'Only pending invitations can be revoked (status=%)', v_inv.status
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.resident_invitations ri
       SET status = 'revoked',
           revoked_by = v_actor,
           revoked_at = now()
     WHERE ri.id = v_inv.id;

    SELECT r.full_name
    INTO v_res_name
    FROM public.residents r
    WHERE r.id = v_inv.resident_id;

    INSERT INTO public.audit_logs (
        tenant_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
    )
    VALUES (
        v_inv.tenant_id,
        v_actor,
        'resident_invitation.revoked',
        'resident_invitations',
        v_inv.id,
        jsonb_build_object(
            'resident_id', v_inv.resident_id,
            'resident_name', v_res_name,
            'email', v_inv.email
        )
    );

    RETURN jsonb_build_object(
        'invitation_id', v_inv.id,
        'resident_id', v_inv.resident_id,
        'status', 'revoked'
    );
END;
$$;

ALTER FUNCTION public.revoke_resident_invitation(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.revoke_resident_invitation(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_resident_invitation(uuid) TO authenticated;

-- =============================================================================
-- 5. RPC: resend_resident_invitation (ketua_rt / sekretaris only)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.resend_resident_invitation(
    p_invitation_id uuid,
    p_email text DEFAULT NULL,
    p_expires_in_hours integer DEFAULT 168
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_prev record;
    v_res record;
    v_email text;
    v_expires_hours integer;
    v_expires_at timestamptz;
    v_raw_token text;
    v_token_hash text;
    v_new_id uuid;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    SELECT ri.*
    INTO v_prev
    FROM public.resident_invitations ri
    WHERE ri.id = p_invitation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invitation not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.has_tenant_role(v_prev.tenant_id, ARRAY['ketua_rt', 'sekretaris']) THEN
        RAISE EXCEPTION 'Forbidden: only ketua_rt or sekretaris can resend invitations'
            USING ERRCODE = '42501';
    END IF;

    IF v_prev.status = 'redeemed' THEN
        RAISE EXCEPTION 'Cannot resend an already redeemed invitation'
            USING ERRCODE = '22023';
    END IF;

    SELECT r.id, r.tenant_id, r.household_id, r.full_name, r.residency_status, r.deleted_at
    INTO v_res
    FROM public.residents r
    WHERE r.id = v_prev.resident_id
      AND r.tenant_id = v_prev.tenant_id
    FOR UPDATE;

    IF NOT FOUND OR v_res.deleted_at IS NOT NULL OR v_res.residency_status <> 'aktif' THEN
        RAISE EXCEPTION 'Resident is not active' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.tenant_members tm
        WHERE tm.tenant_id = v_res.tenant_id
          AND tm.resident_id = v_res.id
          AND tm.status IN ('active', 'invited')
    ) THEN
        RAISE EXCEPTION 'Resident already has an active or linked account'
            USING ERRCODE = '23505';
    END IF;

    v_email := COALESCE(NULLIF(lower(btrim(COALESCE(p_email, ''))), ''), v_prev.email);
    IF v_email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$' THEN
        RAISE EXCEPTION 'Invalid email format' USING ERRCODE = '22023';
    END IF;

    v_expires_hours := COALESCE(p_expires_in_hours, 168);
    IF v_expires_hours < 1 OR v_expires_hours > 720 THEN
        RAISE EXCEPTION 'Expiration hours must be between 1 and 720' USING ERRCODE = '22023';
    END IF;

    -- Supersede any existing pending invitations for this resident
    UPDATE public.resident_invitations ri
       SET status = CASE WHEN ri.expires_at <= now() THEN 'expired' ELSE 'revoked' END,
           revoked_by = CASE WHEN ri.expires_at <= now() THEN ri.revoked_by ELSE v_actor END,
           revoked_at = CASE WHEN ri.expires_at <= now() THEN ri.revoked_at ELSE now() END
     WHERE ri.tenant_id = v_res.tenant_id
       AND ri.resident_id = v_res.id
       AND ri.status = 'pending';

    IF EXISTS (
        SELECT 1
        FROM public.resident_invitations ri
        WHERE ri.tenant_id = v_res.tenant_id
          AND ri.email = v_email
          AND ri.status = 'pending'
          AND ri.expires_at > now()
          AND ri.resident_id <> v_res.id
    ) THEN
        RAISE EXCEPTION 'Another resident in this RT already has a pending invitation for this email'
            USING ERRCODE = '23505';
    END IF;

    v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');
    v_token_hash := encode(extensions.digest(convert_to(v_raw_token, 'UTF8'), 'sha256'), 'hex');
    v_expires_at := now() + make_interval(hours => v_expires_hours);

    INSERT INTO public.resident_invitations (
        tenant_id,
        resident_id,
        email,
        token_hash,
        status,
        expires_at,
        invited_by
    )
    VALUES (
        v_res.tenant_id,
        v_res.id,
        v_email,
        v_token_hash,
        'pending',
        v_expires_at,
        v_actor
    )
    RETURNING id INTO v_new_id;

    INSERT INTO public.audit_logs (
        tenant_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
    )
    VALUES (
        v_res.tenant_id,
        v_actor,
        'resident_invitation.resent',
        'resident_invitations',
        v_new_id,
        jsonb_build_object(
            'previous_invitation_id', v_prev.id,
            'resident_id', v_res.id,
            'resident_name', v_res.full_name,
            'email', v_email,
            'expires_at', v_expires_at
        )
    );

    RETURN jsonb_build_object(
        'invitation_id', v_new_id,
        'previous_invitation_id', v_prev.id,
        'tenant_id', v_res.tenant_id,
        'resident_id', v_res.id,
        'email', v_email,
        'status', 'pending',
        'expires_at', v_expires_at,
        'raw_token', v_raw_token
    );
END;
$$;

ALTER FUNCTION public.resend_resident_invitation(uuid, text, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resend_resident_invitation(uuid, text, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.resend_resident_invitation(uuid, text, integer) TO authenticated;

-- =============================================================================
-- 6. RPC: validate_resident_invitation (Safe Public Token Preview)
--    Never touches auth.users and never leaks whether an email already exists.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.validate_resident_invitation(
    p_token text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_clean_token text;
    v_token_hash text;
    v_rec record;
BEGIN
    v_clean_token := btrim(COALESCE(p_token, ''));
    IF length(v_clean_token) < 32 THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'not_found');
    END IF;

    v_token_hash := encode(extensions.digest(convert_to(v_clean_token, 'UTF8'), 'sha256'), 'hex');

    SELECT
        ri.status,
        ri.expires_at,
        ri.email,
        ri.tenant_id,
        ri.resident_id,
        t.name AS tenant_name,
        t.rt_number,
        t.rw_number,
        t.status AS tenant_status,
        t.deleted_at AS tenant_deleted_at,
        r.full_name AS resident_name,
        r.residency_status,
        r.deleted_at AS resident_deleted_at,
        h.deleted_at AS household_deleted_at
    INTO v_rec
    FROM public.resident_invitations ri
    JOIN public.tenants t ON t.id = ri.tenant_id
    JOIN public.residents r ON r.id = ri.resident_id AND r.tenant_id = ri.tenant_id
    JOIN public.households h ON h.id = r.household_id AND h.tenant_id = ri.tenant_id
    WHERE ri.token_hash = v_token_hash;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'not_found');
    END IF;

    IF v_rec.status = 'revoked' THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'revoked');
    END IF;

    IF v_rec.status = 'redeemed' THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'redeemed');
    END IF;

    IF v_rec.status = 'expired' OR v_rec.expires_at <= now() THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'expired');
    END IF;

    IF v_rec.tenant_status <> 'active'
       OR v_rec.tenant_deleted_at IS NOT NULL
       OR v_rec.resident_deleted_at IS NOT NULL
       OR v_rec.household_deleted_at IS NOT NULL
       OR v_rec.residency_status <> 'aktif' THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'inactive_resident');
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.tenant_members tm
        WHERE tm.tenant_id = v_rec.tenant_id
          AND tm.resident_id = v_rec.resident_id
          AND tm.status IN ('active', 'invited')
    ) THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'already_linked');
    END IF;

    RETURN jsonb_build_object(
        'valid', true,
        'reason', 'valid',
        'tenant_name', v_rec.tenant_name,
        'rt_number', v_rec.rt_number,
        'rw_number', v_rec.rw_number,
        'resident_name', v_rec.resident_name,
        'email_masked', public._mask_invitation_email(v_rec.email),
        'expires_at', v_rec.expires_at
    );
END;
$$;

ALTER FUNCTION public.validate_resident_invitation(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.validate_resident_invitation(text) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.validate_resident_invitation(text) TO anon, authenticated;

-- =============================================================================
-- 7. RPC: get_resident_invitation_claim_target
--    Used server-side in Server Action only when redeeming with a secret 256-bit
--    token. Never exposes auth.users registration state.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_resident_invitation_claim_target(
    p_token text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_clean_token text;
    v_token_hash text;
    v_rec record;
BEGIN
    v_clean_token := btrim(COALESCE(p_token, ''));
    IF length(v_clean_token) < 32 THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'not_found');
    END IF;

    v_token_hash := encode(extensions.digest(convert_to(v_clean_token, 'UTF8'), 'sha256'), 'hex');

    SELECT
        ri.status,
        ri.expires_at,
        ri.email,
        ri.tenant_id,
        ri.resident_id,
        t.name AS tenant_name,
        t.status AS tenant_status,
        t.deleted_at AS tenant_deleted_at,
        r.full_name AS resident_name,
        r.residency_status,
        r.deleted_at AS resident_deleted_at,
        h.deleted_at AS household_deleted_at
    INTO v_rec
    FROM public.resident_invitations ri
    JOIN public.tenants t ON t.id = ri.tenant_id
    JOIN public.residents r ON r.id = ri.resident_id AND r.tenant_id = ri.tenant_id
    JOIN public.households h ON h.id = r.household_id AND h.tenant_id = ri.tenant_id
    WHERE ri.token_hash = v_token_hash;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'not_found');
    END IF;

    IF v_rec.status <> 'pending' THEN
        RETURN jsonb_build_object('valid', false, 'reason', v_rec.status);
    END IF;

    IF v_rec.expires_at <= now() THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'expired');
    END IF;

    IF v_rec.tenant_status <> 'active'
       OR v_rec.tenant_deleted_at IS NOT NULL
       OR v_rec.resident_deleted_at IS NOT NULL
       OR v_rec.household_deleted_at IS NOT NULL
       OR v_rec.residency_status <> 'aktif' THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'inactive_resident');
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.tenant_members tm
        WHERE tm.tenant_id = v_rec.tenant_id
          AND tm.resident_id = v_rec.resident_id
          AND tm.status IN ('active', 'invited')
    ) THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'already_linked');
    END IF;

    RETURN jsonb_build_object(
        'valid', true,
        'reason', 'valid',
        'email', v_rec.email,
        'resident_name', v_rec.resident_name,
        'tenant_name', v_rec.tenant_name
    );
END;
$$;

ALTER FUNCTION public.get_resident_invitation_claim_target(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_resident_invitation_claim_target(text) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.get_resident_invitation_claim_target(text) TO anon, authenticated;

-- =============================================================================
-- 8. RPC: redeem_resident_invitation (Atomic, Authenticated-Only, Warga-Only)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.redeem_resident_invitation(
    p_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_actor_email text;
    v_confirmed_at timestamptz;
    v_clean_token text;
    v_token_hash text;
    v_inv record;
    v_res record;
    v_tenant record;
    v_household_deleted timestamptz;
    v_existing_member record;
    v_member_id uuid;
    v_warga_role_id uuid;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    v_clean_token := btrim(COALESCE(p_token, ''));
    IF length(v_clean_token) < 32 THEN
        RAISE EXCEPTION 'Invalid invitation token' USING ERRCODE = '22023';
    END IF;

    SELECT lower(btrim(u.email)), u.email_confirmed_at
    INTO v_actor_email, v_confirmed_at
    FROM auth.users u
    WHERE u.id = v_actor;

    IF v_actor_email IS NULL OR v_confirmed_at IS NULL THEN
        RAISE EXCEPTION 'Authenticated email must be verified' USING ERRCODE = '42501';
    END IF;

    v_token_hash := encode(extensions.digest(convert_to(v_clean_token, 'UTF8'), 'sha256'), 'hex');

    -- Lock invitation row FIRST so concurrent redemptions serialize cleanly
    SELECT ri.*
    INTO v_inv
    FROM public.resident_invitations ri
    WHERE ri.token_hash = v_token_hash
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invitation not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_inv.status = 'revoked' THEN
        RAISE EXCEPTION 'Invitation has been revoked' USING ERRCODE = '22023';
    END IF;

    IF v_inv.status = 'redeemed' THEN
        RAISE EXCEPTION 'Invitation has already been redeemed' USING ERRCODE = '22023';
    END IF;

    IF v_inv.status = 'expired' OR v_inv.expires_at <= now() THEN
        UPDATE public.resident_invitations
           SET status = 'expired'
         WHERE id = v_inv.id AND status = 'pending';
        RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
    END IF;

    IF v_inv.status <> 'pending' THEN
        RAISE EXCEPTION 'Invitation is no longer valid (status=%)', v_inv.status USING ERRCODE = '22023';
    END IF;

    -- Strictly bind authenticated email to invited email
    IF v_actor_email IS DISTINCT FROM v_inv.email THEN
        RAISE EXCEPTION 'Authenticated account email does not match this invitation'
            USING ERRCODE = '42501';
    END IF;

    -- Lock target resident & verify tenant/household remain active
    SELECT r.id, r.tenant_id, r.household_id, r.full_name, r.phone, r.residency_status, r.deleted_at
    INTO v_res
    FROM public.residents r
    WHERE r.id = v_inv.resident_id
      AND r.tenant_id = v_inv.tenant_id
    FOR UPDATE;

    IF NOT FOUND OR v_res.deleted_at IS NOT NULL OR v_res.residency_status <> 'aktif' THEN
        RAISE EXCEPTION 'Target resident is no longer active' USING ERRCODE = '22023';
    END IF;

    SELECT t.id, t.name, t.rt_number, t.rw_number, t.status, t.deleted_at
    INTO v_tenant
    FROM public.tenants t
    WHERE t.id = v_inv.tenant_id;

    IF NOT FOUND OR v_tenant.deleted_at IS NOT NULL OR v_tenant.status <> 'active' THEN
        RAISE EXCEPTION 'Target RT tenant is not active' USING ERRCODE = '22023';
    END IF;

    SELECT h.deleted_at
    INTO v_household_deleted
    FROM public.households h
    WHERE h.id = v_res.household_id
      AND h.tenant_id = v_res.tenant_id;

    IF NOT FOUND OR v_household_deleted IS NOT NULL THEN
        RAISE EXCEPTION 'Target resident household is not active' USING ERRCODE = '22023';
    END IF;

    -- Prevent two accounts linking to the same resident
    IF EXISTS (
        SELECT 1
        FROM public.tenant_members tm
        WHERE tm.tenant_id = v_inv.tenant_id
          AND tm.resident_id = v_inv.resident_id
          AND tm.user_id <> v_actor
    ) THEN
        RAISE EXCEPTION 'This resident is already linked to another account'
            USING ERRCODE = '23505';
    END IF;

    -- Check if actor already has a tenant_members row in this tenant
    SELECT tm.*
    INTO v_existing_member
    FROM public.tenant_members tm
    WHERE tm.tenant_id = v_inv.tenant_id
      AND tm.user_id = v_actor
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing_member.resident_id IS NOT NULL
           AND v_existing_member.resident_id <> v_inv.resident_id THEN
            RAISE EXCEPTION 'Your account is already linked to a different resident in this RT'
                USING ERRCODE = '23505';
        END IF;

        UPDATE public.tenant_members tm
           SET resident_id = v_inv.resident_id,
               status = 'active',
               joined_at = COALESCE(tm.joined_at, now())
         WHERE tm.id = v_existing_member.id
         RETURNING id INTO v_member_id;
    ELSE
        INSERT INTO public.tenant_members (
            tenant_id,
            user_id,
            resident_id,
            status,
            joined_at
        )
        VALUES (
            v_inv.tenant_id,
            v_actor,
            v_inv.resident_id,
            'active',
            now()
        )
        RETURNING id INTO v_member_id;
    END IF;

    -- Grant ONLY 'warga' role; never accept role from client
    SELECT r.id
    INTO v_warga_role_id
    FROM public.roles r
    WHERE r.code = 'warga';

    IF v_warga_role_id IS NULL THEN
        RAISE EXCEPTION 'System role warga not configured' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.member_roles (
        tenant_id,
        member_id,
        role_id,
        assigned_by
    )
    VALUES (
        v_inv.tenant_id,
        v_member_id,
        v_warga_role_id,
        COALESCE(v_inv.invited_by, v_actor)
    )
    ON CONFLICT (member_id, role_id) DO NOTHING;

    -- Ensure profile exists and populate default full_name / active_tenant_id
    INSERT INTO public.profiles (id, full_name, phone, active_tenant_id)
    VALUES (v_actor, v_res.full_name, v_res.phone, v_inv.tenant_id)
    ON CONFLICT (id) DO UPDATE
        SET active_tenant_id = COALESCE(public.profiles.active_tenant_id, v_inv.tenant_id),
            full_name = COALESCE(NULLIF(btrim(public.profiles.full_name), ''), v_res.full_name),
            phone = COALESCE(public.profiles.phone, v_res.phone);

    -- Mark invitation redeemed (one-time-use)
    UPDATE public.resident_invitations ri
       SET status = 'redeemed',
           redeemed_by = v_actor,
           redeemed_at = now()
     WHERE ri.id = v_inv.id;

    -- Record audit log (actor is now an active member of v_inv.tenant_id)
    INSERT INTO public.audit_logs (
        tenant_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
    )
    VALUES (
        v_inv.tenant_id,
        v_actor,
        'resident_invitation.redeemed',
        'resident_invitations',
        v_inv.id,
        jsonb_build_object(
            'resident_id', v_inv.resident_id,
            'resident_name', v_res.full_name,
            'member_id', v_member_id,
            'user_id', v_actor,
            'assigned_role', 'warga',
            'email', v_inv.email
        )
    );

    RETURN jsonb_build_object(
        'invitation_id', v_inv.id,
        'tenant_id', v_inv.tenant_id,
        'tenant_name', v_tenant.name,
        'rt_number', v_tenant.rt_number,
        'rw_number', v_tenant.rw_number,
        'resident_id', v_inv.resident_id,
        'resident_name', v_res.full_name,
        'member_id', v_member_id,
        'assigned_role', 'warga'
    );
END;
$$;

ALTER FUNCTION public.redeem_resident_invitation(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_resident_invitation(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.redeem_resident_invitation(text) TO authenticated;

COMMIT;

