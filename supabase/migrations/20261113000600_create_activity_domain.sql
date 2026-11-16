-- Step 09 Migration 0006: Community Activities Domain
-- Tables: activities, activity_participants

CREATE TABLE public.activities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    title text NOT NULL,
    description text NULL,
    location text NOT NULL,
    start_at timestamptz NOT NULL,
    end_at timestamptz NULL,
    status text NOT NULL DEFAULT 'scheduled'
        CONSTRAINT chk_activities_status CHECK (
            status IN ('scheduled', 'ongoing', 'completed', 'cancelled')
        ),
    documentation_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_by uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz NULL,
    CONSTRAINT uq_activities_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT chk_activities_date_range CHECK (end_at IS NULL OR end_at >= start_at)
);

CREATE INDEX idx_activities_tenant_start
    ON public.activities (tenant_id, start_at)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_activities_tenant_status
    ON public.activities (tenant_id, status)
    WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------

CREATE TABLE public.activity_participants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    activity_id uuid NOT NULL,
    resident_id uuid NOT NULL,
    rsvp_status text NOT NULL DEFAULT 'invited'
        CONSTRAINT chk_activity_participants_rsvp CHECK (
            rsvp_status IN ('invited', 'attending', 'attended', 'absent')
        ),
    registered_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_activity_participants_activity
        FOREIGN KEY (tenant_id, activity_id)
        REFERENCES public.activities (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_activity_participants_resident
        FOREIGN KEY (tenant_id, resident_id)
        REFERENCES public.residents (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT uq_activity_participants UNIQUE (activity_id, resident_id)
);

CREATE INDEX idx_activity_participants_tenant_activity
    ON public.activity_participants (tenant_id, activity_id);

