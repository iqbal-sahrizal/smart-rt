-- =============================================================================
-- Migration 0024: Dynamic Tenant Identity & Branding Management
-- Step 16.7.0
-- =============================================================================
-- Enables Ketua RT and Sekretaris to manage tenant identity and branding:
--   1. Create public storage bucket 'tenant-logos' (max 2MB, images only)
--   2. Storage RLS policies for 'tenant-logos' (public read, admin write/delete)
--   3. Update policy for public.tenants (tenants_update_admin)
--   4. Atomic RPC update_tenant_identity with audit logging
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. Storage Bucket: tenant-logos (Public Read, 2MB Max)
-- =============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types, versioning_status)
VALUES (
    'tenant-logos',
    'tenant-logos',
    true,
    2097152, -- 2 MiB
    ARRAY['image/jpeg', 'image/png', 'image/webp'],
    'DISABLED'
)
ON CONFLICT (id) DO UPDATE
    SET public = EXCLUDED.public,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types,
        versioning_status = EXCLUDED.versioning_status;

-- Ensure public read privilege on storage.objects for anon and authenticated
GRANT SELECT ON storage.objects TO anon, authenticated;

-- =============================================================================
-- 2. Storage RLS Policies for tenant-logos
-- =============================================================================

-- 2.1 Public Read Policy
DROP POLICY IF EXISTS storage_select_tenant_logos ON storage.objects;
CREATE POLICY storage_select_tenant_logos
    ON storage.objects
    FOR SELECT
    TO anon, authenticated
    USING (bucket_id = 'tenant-logos');

-- 2.2 Admin Insert Policy
DROP POLICY IF EXISTS storage_insert_tenant_logos ON storage.objects;
CREATE POLICY storage_insert_tenant_logos
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'tenant-logos'
        AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-zA-Z0-9_\-\.]+\.(jpg|jpeg|png|webp)$'
        AND public.has_tenant_role(
            (regexp_match(name, '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/'))[1]::uuid,
            ARRAY['ketua_rt', 'sekretaris']
        )
    );

-- 2.3 Admin Update Policy
DROP POLICY IF EXISTS storage_update_tenant_logos ON storage.objects;
CREATE POLICY storage_update_tenant_logos
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'tenant-logos'
        AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-zA-Z0-9_\-\.]+\.(jpg|jpeg|png|webp)$'
        AND public.has_tenant_role(
            (regexp_match(name, '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/'))[1]::uuid,
            ARRAY['ketua_rt', 'sekretaris']
        )
    )
    WITH CHECK (
        bucket_id = 'tenant-logos'
        AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-zA-Z0-9_\-\.]+\.(jpg|jpeg|png|webp)$'
        AND public.has_tenant_role(
            (regexp_match(name, '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/'))[1]::uuid,
            ARRAY['ketua_rt', 'sekretaris']
        )
    );

-- 2.4 Admin Delete Policy
DROP POLICY IF EXISTS storage_delete_tenant_logos ON storage.objects;
CREATE POLICY storage_delete_tenant_logos
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'tenant-logos'
        AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-zA-Z0-9_\-\.]+\.(jpg|jpeg|png|webp)$'
        AND public.has_tenant_role(
            (regexp_match(name, '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/'))[1]::uuid,
            ARRAY['ketua_rt', 'sekretaris']
        )
    );

-- Allow authenticated to DELETE from storage.objects specifically for tenant-logos bucket
GRANT DELETE ON storage.objects TO authenticated;

-- =============================================================================
-- 3. Tenants Table Update Policy for Admin
-- =============================================================================
DROP POLICY IF EXISTS tenants_update_admin ON public.tenants;
CREATE POLICY tenants_update_admin
    ON public.tenants
    FOR UPDATE
    TO authenticated
    USING (public.has_tenant_role(id, ARRAY['ketua_rt', 'sekretaris']))
    WITH CHECK (public.has_tenant_role(id, ARRAY['ketua_rt', 'sekretaris']));

-- =============================================================================
-- 4. Atomic RPC: update_tenant_identity
-- =============================================================================
CREATE OR REPLACE FUNCTION public.update_tenant_identity(
    p_tenant_id uuid,
    p_name text,
    p_rt_number text,
    p_rw_number text,
    p_kelurahan text,
    p_kecamatan text,
    p_city text,
    p_province text,
    p_postal_code text DEFAULT NULL,
    p_logo_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_clean_name text := btrim(coalesce(p_name, ''));
    v_clean_rt text := btrim(coalesce(p_rt_number, ''));
    v_clean_rw text := btrim(coalesce(p_rw_number, ''));
    v_clean_kel text := btrim(coalesce(p_kelurahan, ''));
    v_clean_kec text := btrim(coalesce(p_kecamatan, ''));
    v_clean_city text := btrim(coalesce(p_city, ''));
    v_clean_prov text := btrim(coalesce(p_province, ''));
    v_clean_postal text := btrim(coalesce(p_postal_code, ''));
    v_clean_logo text := btrim(coalesce(p_logo_url, ''));
    v_existing_settings jsonb;
    v_updated_settings jsonb;
    v_result jsonb;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
    END IF;

    -- Authorization check: Ketua RT or Sekretaris
    IF NOT public.has_tenant_role(p_tenant_id, ARRAY['ketua_rt', 'sekretaris']) THEN
        RAISE EXCEPTION 'Forbidden: only Ketua RT or Sekretaris may update tenant identity'
            USING ERRCODE = '42501';
    END IF;

    -- Input validations
    IF v_clean_name = '' THEN
        RAISE EXCEPTION 'Tenant name cannot be empty' USING ERRCODE = '22023';
    END IF;
    IF v_clean_rt = '' THEN
        RAISE EXCEPTION 'RT number cannot be empty' USING ERRCODE = '22023';
    END IF;
    IF v_clean_rw = '' THEN
        RAISE EXCEPTION 'RW number cannot be empty' USING ERRCODE = '22023';
    END IF;
    IF v_clean_kel = '' THEN
        RAISE EXCEPTION 'Kelurahan cannot be empty' USING ERRCODE = '22023';
    END IF;
    IF v_clean_kec = '' THEN
        RAISE EXCEPTION 'Kecamatan cannot be empty' USING ERRCODE = '22023';
    END IF;
    IF v_clean_city = '' THEN
        RAISE EXCEPTION 'City/Kabupaten cannot be empty' USING ERRCODE = '22023';
    END IF;
    IF v_clean_prov = '' THEN
        RAISE EXCEPTION 'Province cannot be empty' USING ERRCODE = '22023';
    END IF;

    -- Lock and get existing settings
    SELECT settings INTO v_existing_settings
    FROM public.tenants
    WHERE id = p_tenant_id AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Tenant not found' USING ERRCODE = 'P0002';
    END IF;

    v_updated_settings := coalesce(v_existing_settings, '{}'::jsonb);
    v_updated_settings := jsonb_set(v_updated_settings, '{postal_code}', to_jsonb(v_clean_postal));
    v_updated_settings := jsonb_set(v_updated_settings, '{logo_url}', to_jsonb(v_clean_logo));

    -- Update tenant
    UPDATE public.tenants
    SET
        name = v_clean_name,
        rt_number = v_clean_rt,
        rw_number = v_clean_rw,
        kelurahan = v_clean_kel,
        kecamatan = v_clean_kec,
        city = v_clean_city,
        province = v_clean_prov,
        settings = v_updated_settings,
        updated_at = now()
    WHERE id = p_tenant_id;

    -- Audit logging
    INSERT INTO public.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    VALUES (
        p_tenant_id,
        v_actor,
        'tenant.identity_updated',
        'tenants',
        p_tenant_id,
        jsonb_build_object(
            'name', v_clean_name,
            'rt_number', v_clean_rt,
            'rw_number', v_clean_rw,
            'kelurahan', v_clean_kel,
            'kecamatan', v_clean_kec,
            'city', v_clean_city,
            'province', v_clean_prov,
            'postal_code', v_clean_postal,
            'logo_url', v_clean_logo
        )
    );

    SELECT jsonb_build_object(
        'id', id,
        'code', code,
        'name', name,
        'rt_number', rt_number,
        'rw_number', rw_number,
        'kelurahan', kelurahan,
        'kecamatan', kecamatan,
        'city', city,
        'province', province,
        'settings', settings
    ) INTO v_result
    FROM public.tenants
    WHERE id = p_tenant_id;

    RETURN v_result;
END;
$$;

ALTER FUNCTION public.update_tenant_identity(
    uuid, text, text, text, text, text, text, text, text, text
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.update_tenant_identity(
    uuid, text, text, text, text, text, text, text, text, text
) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.update_tenant_identity(
    uuid, text, text, text, text, text, text, text, text, text
) TO authenticated;

COMMIT;

