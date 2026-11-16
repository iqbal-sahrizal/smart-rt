-- Step 09 Migration 0003: Resident & Household Domain
-- Tables: households, residents, resident_private_data, resident_documents, vehicles

CREATE TABLE public.households (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    kk_number text NOT NULL,
    head_resident_id uuid NULL,
    address text NOT NULL,
    block_unit text NULL,
    residence_status text NOT NULL DEFAULT 'tetap'
        CONSTRAINT chk_households_residence_status CHECK (
            residence_status IN ('tetap', 'kontrak', 'kos', 'lainnya')
        ),
    status text NOT NULL DEFAULT 'active'
        CONSTRAINT chk_households_status CHECK (status IN ('active', 'inactive')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz NULL,
    CONSTRAINT uq_households_tenant_id UNIQUE (tenant_id, id)
);

CREATE UNIQUE INDEX uq_households_tenant_kk
    ON public.households (tenant_id, kk_number)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_households_tenant_status
    ON public.households (tenant_id, status)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_households_block
    ON public.households (tenant_id, block_unit)
    WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------

CREATE TABLE public.residents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    household_id uuid NOT NULL,
    full_name text NOT NULL,
    gender text NOT NULL
        CONSTRAINT chk_residents_gender CHECK (gender IN ('L', 'P')),
    phone text NULL,
    family_role text NOT NULL
        CONSTRAINT chk_residents_family_role CHECK (
            family_role IN ('kepala_keluarga', 'istri', 'anak', 'famili_lain')
        ),
    residency_status text NOT NULL DEFAULT 'aktif'
        CONSTRAINT chk_residents_residency_status CHECK (
            residency_status IN ('aktif', 'pindah', 'meninggal', 'nonaktif')
        ),
    stay_status text NOT NULL DEFAULT 'tetap'
        CONSTRAINT chk_residents_stay_status CHECK (
            stay_status IN ('tetap', 'kontrak', 'kos', 'lainnya')
        ),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz NULL,
    CONSTRAINT uq_residents_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_residents_household
        FOREIGN KEY (tenant_id, household_id)
        REFERENCES public.households (tenant_id, id)
        ON DELETE RESTRICT
);

CREATE INDEX idx_residents_tenant_household
    ON public.residents (tenant_id, household_id)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_residents_tenant_name
    ON public.residents (tenant_id, full_name)
    WHERE deleted_at IS NULL;

-- Resolve circular composite foreign keys now that residents exists
ALTER TABLE public.households
    ADD CONSTRAINT fk_households_head_resident
    FOREIGN KEY (tenant_id, head_resident_id)
    REFERENCES public.residents (tenant_id, id)
    ON DELETE SET NULL (head_resident_id)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.tenant_members
    ADD CONSTRAINT fk_tenant_members_resident
    FOREIGN KEY (tenant_id, resident_id)
    REFERENCES public.residents (tenant_id, id)
    ON DELETE SET NULL (resident_id);

-- ---------------------------------------------------------------------------

CREATE TABLE public.resident_private_data (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    resident_id uuid NOT NULL,
    nik text NOT NULL,
    birth_place text NOT NULL,
    birth_date date NOT NULL,
    extra_notes text NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz NULL,
    CONSTRAINT fk_resident_private_resident
        FOREIGN KEY (tenant_id, resident_id)
        REFERENCES public.residents (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT uq_resident_private_resident UNIQUE (resident_id)
);

CREATE UNIQUE INDEX uq_resident_private_tenant_nik
    ON public.resident_private_data (tenant_id, nik)
    WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------

CREATE TABLE public.resident_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    resident_id uuid NOT NULL,
    document_type text NOT NULL
        CONSTRAINT chk_resident_docs_type CHECK (
            document_type IN ('ktp', 'kk', 'akta', 'domisili', 'lainnya')
        ),
    storage_path text NOT NULL UNIQUE,
    mime_type text NOT NULL,
    file_size_bytes integer NOT NULL
        CONSTRAINT chk_resident_docs_size CHECK (file_size_bytes > 0),
    verified_by uuid NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
    verified_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_resident_docs_resident
        FOREIGN KEY (tenant_id, resident_id)
        REFERENCES public.residents (tenant_id, id)
        ON DELETE CASCADE
);

CREATE INDEX idx_resident_docs_tenant_resident
    ON public.resident_documents (tenant_id, resident_id);

-- ---------------------------------------------------------------------------

CREATE TABLE public.vehicles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    household_id uuid NOT NULL,
    resident_id uuid NULL,
    vehicle_type text NOT NULL
        CONSTRAINT chk_vehicles_type CHECK (vehicle_type IN ('motor', 'mobil', 'lainnya')),
    plate_number text NOT NULL,
    brand_model text NULL,
    color text NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_vehicles_household
        FOREIGN KEY (tenant_id, household_id)
        REFERENCES public.households (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_vehicles_resident
        FOREIGN KEY (tenant_id, resident_id)
        REFERENCES public.residents (tenant_id, id)
        ON DELETE SET NULL (resident_id),
    CONSTRAINT uq_vehicles_tenant_plate UNIQUE (tenant_id, plate_number)
);

CREATE INDEX idx_vehicles_tenant_household
    ON public.vehicles (tenant_id, household_id);

