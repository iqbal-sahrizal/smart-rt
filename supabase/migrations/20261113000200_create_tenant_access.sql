-- Step 09 Migration 0002: Multi-Tenant & Access Control Domain
-- Tables: tenants, profiles, roles, tenant_members, member_roles

CREATE TABLE public.tenants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL,
    name text NOT NULL,
    rt_number text NOT NULL,
    rw_number text NOT NULL,
    kelurahan text NOT NULL,
    kecamatan text NOT NULL,
    city text NOT NULL,
    province text NOT NULL,
    status text NOT NULL DEFAULT 'active'
        CONSTRAINT chk_tenants_status CHECK (status IN ('active', 'inactive', 'suspended')),
    settings jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz NULL
);

CREATE UNIQUE INDEX uq_tenants_code
    ON public.tenants (code)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_tenants_status
    ON public.tenants (status);

CREATE INDEX idx_tenants_region
    ON public.tenants (province, city, kecamatan, kelurahan);

-- ---------------------------------------------------------------------------

CREATE TABLE public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    full_name text NOT NULL,
    phone text NULL,
    avatar_path text NULL,
    active_tenant_id uuid NULL REFERENCES public.tenants (id) ON DELETE SET NULL,
    is_super_admin boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_active_tenant
    ON public.profiles (active_tenant_id);

-- Prevent client roles from directly updating is_super_admin
REVOKE UPDATE ON public.profiles FROM authenticated, anon;
GRANT UPDATE (full_name, phone, avatar_path, active_tenant_id) ON public.profiles TO authenticated;

-- ---------------------------------------------------------------------------

CREATE TABLE public.roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE
        CONSTRAINT chk_roles_code CHECK (
            code IN ('ketua_rt', 'sekretaris', 'bendahara', 'pengurus', 'warga')
        ),
    name text NOT NULL,
    description text NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------

CREATE TABLE public.tenant_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
    -- Foreign key to residents(tenant_id, id) is attached in 0003 after residents is created
    resident_id uuid NULL,
    status text NOT NULL DEFAULT 'invited'
        CONSTRAINT chk_tenant_members_status CHECK (status IN ('invited', 'active', 'inactive')),
    joined_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_members_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_tenant_members_tenant_user UNIQUE (tenant_id, user_id)
);

CREATE UNIQUE INDEX uq_tenant_members_tenant_resident
    ON public.tenant_members (tenant_id, resident_id)
    WHERE resident_id IS NOT NULL;

CREATE INDEX idx_tenant_members_user_status
    ON public.tenant_members (user_id, status);

CREATE INDEX idx_tenant_members_tenant_status
    ON public.tenant_members (tenant_id, status);

-- ---------------------------------------------------------------------------

CREATE TABLE public.member_roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    member_id uuid NOT NULL,
    role_id uuid NOT NULL REFERENCES public.roles (id) ON DELETE RESTRICT,
    assigned_by uuid NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_member_roles_member
        FOREIGN KEY (tenant_id, member_id)
        REFERENCES public.tenant_members (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT uq_member_roles_member_role UNIQUE (member_id, role_id)
);

CREATE INDEX idx_member_roles_tenant_member
    ON public.member_roles (tenant_id, member_id);

