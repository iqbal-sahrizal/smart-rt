-- Step 09 Migration 0005: Announcements, Complaints, and Letter Management Domain
-- Tables: announcements, announcement_recipients, complaints, complaint_replies,
--         complaint_status_history, letter_types, letter_sequences, letter_requests

CREATE TABLE public.announcements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    author_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    title text NOT NULL,
    content text NOT NULL,
    attachment_path text NULL,
    status text NOT NULL DEFAULT 'draft'
        CONSTRAINT chk_announcements_status CHECK (status IN ('draft', 'published', 'archived')),
    target_type text NOT NULL DEFAULT 'all'
        CONSTRAINT chk_announcements_target_type CHECK (target_type IN ('all', 'role', 'household')),
    published_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz NULL,
    CONSTRAINT uq_announcements_tenant_id UNIQUE (tenant_id, id)
);

CREATE INDEX idx_announcements_tenant_pub
    ON public.announcements (tenant_id, status, published_at)
    WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------

CREATE TABLE public.announcement_recipients (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    announcement_id uuid NOT NULL,
    role_id uuid NULL REFERENCES public.roles (id) ON DELETE CASCADE,
    household_id uuid NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_ann_recipients_announcement
        FOREIGN KEY (tenant_id, announcement_id)
        REFERENCES public.announcements (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_ann_recipients_household
        FOREIGN KEY (tenant_id, household_id)
        REFERENCES public.households (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT chk_ann_recipients_exclusive_target CHECK (
        (role_id IS NOT NULL AND household_id IS NULL)
        OR (role_id IS NULL AND household_id IS NOT NULL)
    )
);

CREATE INDEX idx_ann_recipients_announcement
    ON public.announcement_recipients (announcement_id);

CREATE UNIQUE INDEX uq_ann_recipients_role
    ON public.announcement_recipients (announcement_id, role_id)
    WHERE role_id IS NOT NULL;

CREATE UNIQUE INDEX uq_ann_recipients_household
    ON public.announcement_recipients (announcement_id, household_id)
    WHERE household_id IS NOT NULL;

-- ---------------------------------------------------------------------------

CREATE TABLE public.complaints (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    reporter_member_id uuid NOT NULL,
    category text NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    photo_path text NULL,
    priority text NOT NULL DEFAULT 'medium'
        CONSTRAINT chk_complaints_priority CHECK (priority IN ('low', 'medium', 'high')),
    status text NOT NULL DEFAULT 'open'
        CONSTRAINT chk_complaints_status CHECK (
            status IN ('open', 'in_progress', 'resolved', 'rejected')
        ),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz NULL,
    CONSTRAINT uq_complaints_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_complaints_reporter
        FOREIGN KEY (tenant_id, reporter_member_id)
        REFERENCES public.tenant_members (tenant_id, id)
        ON DELETE RESTRICT
);

CREATE INDEX idx_complaints_tenant_status
    ON public.complaints (tenant_id, status, created_at)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_complaints_reporter
    ON public.complaints (reporter_member_id)
    WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------

CREATE TABLE public.complaint_replies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    complaint_id uuid NOT NULL,
    author_member_id uuid NOT NULL,
    message text NOT NULL,
    attachment_path text NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_complaint_replies_complaint
        FOREIGN KEY (tenant_id, complaint_id)
        REFERENCES public.complaints (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_complaint_replies_author
        FOREIGN KEY (tenant_id, author_member_id)
        REFERENCES public.tenant_members (tenant_id, id)
        ON DELETE RESTRICT
);

CREATE INDEX idx_complaint_replies_complaint
    ON public.complaint_replies (complaint_id, created_at);

-- ---------------------------------------------------------------------------

CREATE TABLE public.complaint_status_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    complaint_id uuid NOT NULL,
    changed_by_member_id uuid NOT NULL,
    previous_status text NOT NULL
        CONSTRAINT chk_complaint_hist_prev_status CHECK (
            previous_status IN ('open', 'in_progress', 'resolved', 'rejected')
        ),
    new_status text NOT NULL
        CONSTRAINT chk_complaint_hist_new_status CHECK (
            new_status IN ('open', 'in_progress', 'resolved', 'rejected')
        ),
    reason text NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_complaint_hist_complaint
        FOREIGN KEY (tenant_id, complaint_id)
        REFERENCES public.complaints (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_complaint_hist_actor
        FOREIGN KEY (tenant_id, changed_by_member_id)
        REFERENCES public.tenant_members (tenant_id, id)
        ON DELETE RESTRICT
);

CREATE INDEX idx_complaint_status_hist_complaint
    ON public.complaint_status_history (complaint_id, created_at);

-- ---------------------------------------------------------------------------

CREATE TABLE public.letter_types (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    code text NOT NULL,
    name text NOT NULL,
    description text NULL,
    required_documents jsonb NOT NULL DEFAULT '[]'::jsonb,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_letter_types_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_letter_types_tenant_code UNIQUE (tenant_id, code)
);

-- ---------------------------------------------------------------------------

CREATE TABLE public.letter_sequences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    period_year smallint NOT NULL,
    last_number integer NOT NULL DEFAULT 0
        CONSTRAINT chk_letter_seq_non_negative CHECK (last_number >= 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_letter_sequences_tenant_year UNIQUE (tenant_id, period_year)
);

-- ---------------------------------------------------------------------------

CREATE TABLE public.letter_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    letter_type_id uuid NOT NULL,
    resident_id uuid NOT NULL,
    requested_by_member_id uuid NOT NULL,
    purpose text NOT NULL,
    supporting_doc_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
    status text NOT NULL DEFAULT 'submitted'
        CONSTRAINT chk_letter_requests_status CHECK (
            status IN ('submitted', 'reviewing', 'approved', 'rejected', 'completed')
        ),
    admin_notes text NULL,
    letter_number text NULL,
    issued_file_path text NULL,
    reviewed_by uuid NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
    reviewed_at timestamptz NULL,
    issued_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_letter_requests_type
        FOREIGN KEY (tenant_id, letter_type_id)
        REFERENCES public.letter_types (tenant_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_letter_requests_resident
        FOREIGN KEY (tenant_id, resident_id)
        REFERENCES public.residents (tenant_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_letter_requests_requester
        FOREIGN KEY (tenant_id, requested_by_member_id)
        REFERENCES public.tenant_members (tenant_id, id)
        ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_letter_requests_tenant_number
    ON public.letter_requests (tenant_id, letter_number)
    WHERE letter_number IS NOT NULL;

CREATE INDEX idx_letter_requests_tenant_status
    ON public.letter_requests (tenant_id, status, created_at);

CREATE INDEX idx_letter_requests_resident
    ON public.letter_requests (tenant_id, resident_id);

