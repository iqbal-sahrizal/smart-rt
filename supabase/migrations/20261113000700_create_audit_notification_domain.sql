-- Step 09 Migration 0007: Notifications & Audit Logs Domain
-- Tables: notifications, audit_logs

CREATE TABLE public.notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    recipient_user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
    title text NOT NULL,
    body text NOT NULL,
    type text NOT NULL,
    reference_type text NULL,
    reference_id uuid NULL,
    is_read boolean NOT NULL DEFAULT false,
    read_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_notifications_member
        FOREIGN KEY (tenant_id, recipient_user_id)
        REFERENCES public.tenant_members (tenant_id, user_id)
        ON DELETE CASCADE
);

CREATE INDEX idx_notifications_user_unread
    ON public.notifications (recipient_user_id, tenant_id, is_read, created_at);

CREATE INDEX idx_notifications_tenant
    ON public.notifications (tenant_id, created_at);

-- ---------------------------------------------------------------------------

CREATE TABLE public.audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NULL REFERENCES public.tenants (id) ON DELETE SET NULL,
    actor_user_id uuid NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_tenant_created
    ON public.audit_logs (tenant_id, created_at);

CREATE INDEX idx_audit_logs_entity
    ON public.audit_logs (entity_type, entity_id);

