-- Step 10.2.2.2 Migration 0011: Enable RLS, Create Policies (28 Tables), & Approved Indexes
-- NOTE: Does NOT modify privileges from 0010, helper functions, triggers, or internal Supabase schemas.
-- NOTE: Does NOT use FORCE ROW LEVEL SECURITY (helpers owned by postgres with rolbypassrls=true).

-- =============================================================================
-- 1. Approved Supporting Indexes (2 indexes)
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_bills_tenant_resident
    ON public.bills (tenant_id, resident_id)
    WHERE resident_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_letter_requests_tenant_requester
    ON public.letter_requests (tenant_id, requested_by_member_id);

-- =============================================================================
-- 2. Enable Row Level Security on all 28 public tables
-- =============================================================================
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.residents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resident_private_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resident_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaint_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaint_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.letter_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.letter_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.letter_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 3. RLS Policies (Max 1 policy per table per command; separate S/I/U/D)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 3.1 roles (Global read-only catalog)
-- ---------------------------------------------------------------------------
CREATE POLICY roles_select_authenticated
    ON public.roles
    FOR SELECT
    TO authenticated
    USING (true);

-- ---------------------------------------------------------------------------
-- 3.2 profiles (User-owned; UPDATE columns restricted in 0010)
-- ---------------------------------------------------------------------------
CREATE POLICY profiles_select_own_or_super
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING (id = auth.uid() OR public.is_super_admin());

CREATE POLICY profiles_update_own
    ON public.profiles
    FOR UPDATE
    TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3.3 tenants
-- ---------------------------------------------------------------------------
CREATE POLICY tenants_select_member_or_super
    ON public.tenants
    FOR SELECT
    TO authenticated
    USING (public.is_super_admin() OR public.is_tenant_member(id));

CREATE POLICY tenants_insert_super
    ON public.tenants
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_super_admin());

CREATE POLICY tenants_update_super
    ON public.tenants
    FOR UPDATE
    TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

CREATE POLICY tenants_delete_super
    ON public.tenants
    FOR DELETE
    TO authenticated
    USING (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 3.4 tenant_members
-- ---------------------------------------------------------------------------
CREATE POLICY tenant_members_select
    ON public.tenant_members
    FOR SELECT
    TO authenticated
    USING (
        public.is_super_admin()
        OR user_id = auth.uid()
        OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'bendahara', 'pengurus'])
    );

CREATE POLICY tenant_members_insert
    ON public.tenant_members
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_super_admin()
        OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt'])
    );

CREATE POLICY tenant_members_update
    ON public.tenant_members
    FOR UPDATE
    TO authenticated
    USING (
        public.is_super_admin()
        OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt'])
    )
    WITH CHECK (
        public.is_super_admin()
        OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt'])
    );

CREATE POLICY tenant_members_delete
    ON public.tenant_members
    FOR DELETE
    TO authenticated
    USING (
        public.is_super_admin()
        OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt'])
    );

-- ---------------------------------------------------------------------------
-- 3.5 member_roles
-- ---------------------------------------------------------------------------
CREATE POLICY member_roles_select
    ON public.member_roles
    FOR SELECT
    TO authenticated
    USING (
        public.is_super_admin()
        OR member_id = public.get_my_member_id(tenant_id)
        OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'bendahara', 'pengurus'])
    );

CREATE POLICY member_roles_insert
    ON public.member_roles
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_super_admin()
        OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt'])
    );

CREATE POLICY member_roles_update
    ON public.member_roles
    FOR UPDATE
    TO authenticated
    USING (
        public.is_super_admin()
        OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt'])
    )
    WITH CHECK (
        public.is_super_admin()
        OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt'])
    );

CREATE POLICY member_roles_delete
    ON public.member_roles
    FOR DELETE
    TO authenticated
    USING (
        public.is_super_admin()
        OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt'])
    );

-- ---------------------------------------------------------------------------
-- 3.6 households
-- ---------------------------------------------------------------------------
CREATE POLICY households_select
    ON public.households
    FOR SELECT
    TO authenticated
    USING (
        public.is_super_admin()
        OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'bendahara', 'pengurus'])
        OR (
            public.is_tenant_member(tenant_id)
            AND id = public.get_my_household_id(tenant_id)
            AND deleted_at IS NULL
        )
    );

CREATE POLICY households_insert
    ON public.households
    FOR INSERT
    TO authenticated
    WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris']));

CREATE POLICY households_update
    ON public.households
    FOR UPDATE
    TO authenticated
    USING (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris']))
    WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris']));

CREATE POLICY households_delete
    ON public.households
    FOR DELETE
    TO authenticated
    USING (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris']));

-- ---------------------------------------------------------------------------
-- 3.7 residents
-- ---------------------------------------------------------------------------
CREATE POLICY residents_select
    ON public.residents
    FOR SELECT
    TO authenticated
    USING (
        public.is_super_admin()
        OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'bendahara', 'pengurus'])
        OR (
            public.is_tenant_member(tenant_id)
            AND household_id = public.get_my_household_id(tenant_id)
            AND deleted_at IS NULL
        )
    );

CREATE POLICY residents_insert
    ON public.residents
    FOR INSERT
    TO authenticated
    WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris']));

CREATE POLICY residents_update
    ON public.residents
    FOR UPDATE
    TO authenticated
    USING (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris']))
    WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris']));

CREATE POLICY residents_delete
    ON public.residents
    FOR DELETE
    TO authenticated
    USING (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris']));

-- ---------------------------------------------------------------------------
-- 3.8 resident_private_data (Sensitive PII: ketua_rt, sekretaris, own warga only)
-- ---------------------------------------------------------------------------
CREATE POLICY resident_private_data_select
    ON public.resident_private_data
    FOR SELECT
    TO authenticated
    USING (
        public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris'])
        OR (
            public.is_tenant_member(tenant_id)
            AND resident_id = public.get_my_resident_id(tenant_id)
            AND deleted_at IS NULL
        )
    );

CREATE POLICY resident_private_data_insert
    ON public.resident_private_data
    FOR INSERT
    TO authenticated
    WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris']));

CREATE POLICY resident_private_data_update
    ON public.resident_private_data
    FOR UPDATE
    TO authenticated
    USING (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris']))
    WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris']));

CREATE POLICY resident_private_data_delete
    ON public.resident_private_data
    FOR DELETE
    TO authenticated
    USING (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris']));

-- ---------------------------------------------------------------------------
-- 3.9 resident_documents (Sensitive PII: ketua_rt, sekretaris, own warga S/I only)
-- ---------------------------------------------------------------------------
CREATE POLICY resident_documents_select
    ON public.resident_documents
    FOR SELECT
    TO authenticated
    USING (
        public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris'])
        OR (
            public.is_tenant_member(tenant_id)
            AND resident_id = public.get_my_resident_id(tenant_id)
        )
    );

CREATE POLICY resident_documents_insert
    ON public.resident_documents
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris'])
        OR (
            public.is_tenant_member(tenant_id)
            AND resident_id = public.get_my_resident_id(tenant_id)
            AND verified_by IS NULL
            AND verified_at IS NULL
        )
    );

CREATE POLICY resident_documents_update
    ON public.resident_documents
    FOR UPDATE
    TO authenticated
    USING (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris']))
    WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris']));

CREATE POLICY resident_documents_delete
    ON public.resident_documents
    FOR DELETE
    TO authenticated
    USING (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris']));

-- ---------------------------------------------------------------------------
-- 3.10 vehicles
-- ---------------------------------------------------------------------------
CREATE POLICY vehicles_select
    ON public.vehicles
    FOR SELECT
    TO authenticated
    USING (
        public.is_super_admin()
        OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'bendahara', 'pengurus'])
        OR (
            public.is_tenant_member(tenant_id)
            AND household_id = public.get_my_household_id(tenant_id)
        )
    );

CREATE POLICY vehicles_insert
    ON public.vehicles
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris'])
        OR (
            public.is_tenant_member(tenant_id)
            AND household_id = public.get_my_household_id(tenant_id)
        )
    );

CREATE POLICY vehicles_update
    ON public.vehicles
    FOR UPDATE
    TO authenticated
    USING (
        public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris'])
        OR (
            public.is_tenant_member(tenant_id)
            AND household_id = public.get_my_household_id(tenant_id)
        )
    )
    WITH CHECK (
        public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris'])
        OR (
            public.is_tenant_member(tenant_id)
            AND household_id = public.get_my_household_id(tenant_id)
        )
    );

CREATE POLICY vehicles_delete
    ON public.vehicles
    FOR DELETE
    TO authenticated
    USING (
        public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris'])
        OR (
            public.is_tenant_member(tenant_id)
            AND household_id = public.get_my_household_id(tenant_id)
        )
    );

-- ---------------------------------------------------------------------------
-- 3.11 dues
-- ---------------------------------------------------------------------------
CREATE POLICY dues_select
    ON public.dues
    FOR SELECT
    TO authenticated
    USING (
        public.is_super_admin()
        OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'bendahara', 'pengurus'])
        OR (public.is_tenant_member(tenant_id) AND is_active IS TRUE)
    );

CREATE POLICY dues_insert
    ON public.dues
    FOR INSERT
    TO authenticated
    WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'bendahara']));

CREATE POLICY dues_update
    ON public.dues
    FOR UPDATE
    TO authenticated
    USING (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'bendahara']))
    WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'bendahara']));

CREATE POLICY dues_delete
    ON public.dues
    FOR DELETE
    TO authenticated
    USING (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'bendahara']));

-- ---------------------------------------------------------------------------
-- 3.12 bills (No direct DELETE)
-- ---------------------------------------------------------------------------
CREATE POLICY bills_select
    ON public.bills
    FOR SELECT
    TO authenticated
    USING (
        public.is_super_admin()
        OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'bendahara', 'pengurus'])
        OR (
            public.is_tenant_member(tenant_id)
            AND (
                household_id = public.get_my_household_id(tenant_id)
                OR resident_id = public.get_my_resident_id(tenant_id)
            )
        )
    );

CREATE POLICY bills_insert
    ON public.bills
    FOR INSERT
    TO authenticated
    WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['bendahara']));

CREATE POLICY bills_update
    ON public.bills
    FOR UPDATE
    TO authenticated
    USING (public.has_tenant_role(tenant_id, ARRAY['bendahara']))
    WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['bendahara']));

-- ---------------------------------------------------------------------------
-- 3.13 payments (No direct UPDATE/DELETE; verification/refund via RPC in 10.2.3)
-- ---------------------------------------------------------------------------
CREATE POLICY payments_select
    ON public.payments
    FOR SELECT
    TO authenticated
    USING (
        public.is_super_admin()
        OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'bendahara', 'pengurus'])
        OR (
            public.is_tenant_member(tenant_id)
            AND EXISTS (
                SELECT 1
                FROM public.bills b
                WHERE b.id = payments.bill_id
                  AND b.tenant_id = payments.tenant_id
                  AND (
                      b.household_id = public.get_my_household_id(payments.tenant_id)
                      OR b.resident_id = public.get_my_resident_id(payments.tenant_id)
                  )
            )
        )
    );

CREATE POLICY payments_insert
    ON public.payments
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.has_tenant_role(tenant_id, ARRAY['bendahara'])
        OR (
            public.is_tenant_member(tenant_id)
            AND payment_type = 'payment'
            AND status = 'pending'
            AND parent_payment_id IS NULL
            AND paid_by_user_id = auth.uid()
            AND verified_by IS NULL
            AND verified_at IS NULL
            AND EXISTS (
                SELECT 1
                FROM public.bills b
                WHERE b.id = payments.bill_id
                  AND b.tenant_id = payments.tenant_id
                  AND (
                      b.household_id = public.get_my_household_id(payments.tenant_id)
                      OR b.resident_id = public.get_my_resident_id(payments.tenant_id)
                  )
            )
        )
    );

-- ---------------------------------------------------------------------------
-- 3.14 payment_webhook_events (Backend-only: 0 policies)
-- ---------------------------------------------------------------------------
-- Intentionally NO policies for authenticated/anon.

-- ---------------------------------------------------------------------------
-- 3.15 cash_categories
-- ---------------------------------------------------------------------------
CREATE POLICY cash_categories_select
    ON public.cash_categories
    FOR SELECT
    TO authenticated
    USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));

CREATE POLICY cash_categories_insert
    ON public.cash_categories
    FOR INSERT
    TO authenticated
    WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'bendahara']));

CREATE POLICY cash_categories_update
    ON public.cash_categories
    FOR UPDATE
    TO authenticated
    USING (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'bendahara']))
    WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'bendahara']));

CREATE POLICY cash_categories_delete
    ON public.cash_categories
    FOR DELETE
    TO authenticated
    USING (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'bendahara']));

-- ---------------------------------------------------------------------------
-- 3.16 cash_transactions (No direct warga SELECT; no direct DELETE)
-- ---------------------------------------------------------------------------
CREATE POLICY cash_transactions_select
    ON public.cash_transactions
    FOR SELECT
    TO authenticated
    USING (
        public.is_super_admin()
        OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'bendahara', 'pengurus'])
    );

CREATE POLICY cash_transactions_insert
    ON public.cash_transactions
    FOR INSERT
    TO authenticated
    WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['bendahara']));

CREATE POLICY cash_transactions_update
    ON public.cash_transactions
    FOR UPDATE
    TO authenticated
    USING (public.has_tenant_role(tenant_id, ARRAY['bendahara']))
    WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['bendahara']));

-- ---------------------------------------------------------------------------
-- 3.17 announcements
-- ---------------------------------------------------------------------------
CREATE POLICY announcements_select
    ON public.announcements
    FOR SELECT
    TO authenticated
    USING (
        public.is_super_admin()
        OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'bendahara', 'pengurus'])
        OR (
            public.is_tenant_member(tenant_id)
            AND status = 'published'
            AND deleted_at IS NULL
            AND (
                target_type = 'all'
                OR (
                    target_type = 'household'
                    AND EXISTS (
                        SELECT 1
                        FROM public.announcement_recipients ar
                        WHERE ar.announcement_id = announcements.id
                          AND ar.tenant_id = announcements.tenant_id
                          AND ar.household_id = public.get_my_household_id(announcements.tenant_id)
                    )
                )
                OR (
                    target_type = 'role'
                    AND EXISTS (
                        SELECT 1
                        FROM public.announcement_recipients ar
                        JOIN public.member_roles mr
                          ON mr.role_id = ar.role_id
                         AND mr.tenant_id = ar.tenant_id
                        WHERE ar.announcement_id = announcements.id
                          AND ar.tenant_id = announcements.tenant_id
                          AND mr.member_id = public.get_my_member_id(announcements.tenant_id)
                    )
                )
            )
        )
    );

CREATE POLICY announcements_insert
    ON public.announcements
    FOR INSERT
    TO authenticated
    WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus']));

CREATE POLICY announcements_update
    ON public.announcements
    FOR UPDATE
    TO authenticated
    USING (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus']))
    WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus']));

CREATE POLICY announcements_delete
    ON public.announcements
    FOR DELETE
    TO authenticated
    USING (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus']));

-- ---------------------------------------------------------------------------
-- 3.18 announcement_recipients (Does NOT query announcements -> avoids recursion)
-- ---------------------------------------------------------------------------
CREATE POLICY announcement_recipients_select
    ON public.announcement_recipients
    FOR SELECT
    TO authenticated
    USING (
        public.is_super_admin()
        OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'bendahara', 'pengurus'])
        OR (
            public.is_tenant_member(tenant_id)
            AND (
                household_id = public.get_my_household_id(tenant_id)
                OR EXISTS (
                    SELECT 1
                    FROM public.member_roles mr
                    WHERE mr.tenant_id = announcement_recipients.tenant_id
                      AND mr.member_id = public.get_my_member_id(announcement_recipients.tenant_id)
                      AND mr.role_id = announcement_recipients.role_id
                )
            )
        )
    );

CREATE POLICY announcement_recipients_insert
    ON public.announcement_recipients
    FOR INSERT
    TO authenticated
    WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus']));

CREATE POLICY announcement_recipients_update
    ON public.announcement_recipients
    FOR UPDATE
    TO authenticated
    USING (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus']))
    WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus']));

CREATE POLICY announcement_recipients_delete
    ON public.announcement_recipients
    FOR DELETE
    TO authenticated
    USING (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus']));

-- ---------------------------------------------------------------------------
-- 3.19 complaints (UPDATE columns restricted in 0010; status transitions via RPC)
-- ---------------------------------------------------------------------------
CREATE POLICY complaints_select
    ON public.complaints
    FOR SELECT
    TO authenticated
    USING (
        public.is_super_admin()
        OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'bendahara', 'pengurus'])
        OR (
            public.is_tenant_member(tenant_id)
            AND reporter_member_id = public.get_my_member_id(tenant_id)
            AND deleted_at IS NULL
        )
    );

CREATE POLICY complaints_insert
    ON public.complaints
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_tenant_member(tenant_id)
        AND reporter_member_id = public.get_my_member_id(tenant_id)
        AND status = 'open'
    );

CREATE POLICY complaints_update
    ON public.complaints
    FOR UPDATE
    TO authenticated
    USING (
        public.is_tenant_member(tenant_id)
        AND reporter_member_id = public.get_my_member_id(tenant_id)
        AND status = 'open'
        AND deleted_at IS NULL
    )
    WITH CHECK (
        public.is_tenant_member(tenant_id)
        AND reporter_member_id = public.get_my_member_id(tenant_id)
        AND status = 'open'
        AND deleted_at IS NULL
    );

-- ---------------------------------------------------------------------------
-- 3.20 complaint_replies (Validates parent complaint ownership for warga)
-- ---------------------------------------------------------------------------
CREATE POLICY complaint_replies_select
    ON public.complaint_replies
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
                WHERE c.id = complaint_replies.complaint_id
                  AND c.tenant_id = complaint_replies.tenant_id
                  AND c.reporter_member_id = public.get_my_member_id(complaint_replies.tenant_id)
                  AND c.deleted_at IS NULL
            )
        )
    );

CREATE POLICY complaint_replies_insert
    ON public.complaint_replies
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
        OR (
            public.is_tenant_member(tenant_id)
            AND author_member_id = public.get_my_member_id(tenant_id)
            AND EXISTS (
                SELECT 1
                FROM public.complaints c
                WHERE c.id = complaint_replies.complaint_id
                  AND c.tenant_id = complaint_replies.tenant_id
                  AND c.reporter_member_id = public.get_my_member_id(complaint_replies.tenant_id)
                  AND c.deleted_at IS NULL
            )
        )
    );

-- ---------------------------------------------------------------------------
-- 3.21 complaint_status_history (Append-only)
-- ---------------------------------------------------------------------------
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
            )
        )
    );

CREATE POLICY complaint_status_history_insert
    ON public.complaint_status_history
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
        AND changed_by_member_id = public.get_my_member_id(tenant_id)
    );

-- ---------------------------------------------------------------------------
-- 3.22 letter_types
-- ---------------------------------------------------------------------------
CREATE POLICY letter_types_select
    ON public.letter_types
    FOR SELECT
    TO authenticated
    USING (
        public.is_super_admin()
        OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'bendahara', 'pengurus'])
        OR (public.is_tenant_member(tenant_id) AND is_active IS TRUE)
    );

CREATE POLICY letter_types_insert
    ON public.letter_types
    FOR INSERT
    TO authenticated
    WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris']));

CREATE POLICY letter_types_update
    ON public.letter_types
    FOR UPDATE
    TO authenticated
    USING (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris']))
    WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris']));

CREATE POLICY letter_types_delete
    ON public.letter_types
    FOR DELETE
    TO authenticated
    USING (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris']));

-- ---------------------------------------------------------------------------
-- 3.23 letter_sequences (Backend-only: 0 policies)
-- ---------------------------------------------------------------------------
-- Intentionally NO policies for authenticated/anon.

-- ---------------------------------------------------------------------------
-- 3.24 letter_requests (No direct DELETE)
-- ---------------------------------------------------------------------------
CREATE POLICY letter_requests_select
    ON public.letter_requests
    FOR SELECT
    TO authenticated
    USING (
        public.is_super_admin()
        OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'bendahara', 'pengurus'])
        OR (
            public.is_tenant_member(tenant_id)
            AND (
                requested_by_member_id = public.get_my_member_id(tenant_id)
                OR resident_id = public.get_my_resident_id(tenant_id)
            )
        )
    );

CREATE POLICY letter_requests_insert
    ON public.letter_requests
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_tenant_member(tenant_id)
        AND requested_by_member_id = public.get_my_member_id(tenant_id)
        AND status = 'submitted'
        AND letter_number IS NULL
        AND reviewed_by IS NULL
    );

CREATE POLICY letter_requests_update
    ON public.letter_requests
    FOR UPDATE
    TO authenticated
    USING (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris']))
    WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris']));

-- ---------------------------------------------------------------------------
-- 3.25 activities
-- ---------------------------------------------------------------------------
CREATE POLICY activities_select
    ON public.activities
    FOR SELECT
    TO authenticated
    USING (
        public.is_super_admin()
        OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'bendahara', 'pengurus'])
        OR (public.is_tenant_member(tenant_id) AND deleted_at IS NULL)
    );

CREATE POLICY activities_insert
    ON public.activities
    FOR INSERT
    TO authenticated
    WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus']));

CREATE POLICY activities_update
    ON public.activities
    FOR UPDATE
    TO authenticated
    USING (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus']))
    WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus']));

CREATE POLICY activities_delete
    ON public.activities
    FOR DELETE
    TO authenticated
    USING (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus']));

-- ---------------------------------------------------------------------------
-- 3.26 activity_participants (Warga sees/manages ONLY own resident_id)
-- ---------------------------------------------------------------------------
CREATE POLICY activity_participants_select
    ON public.activity_participants
    FOR SELECT
    TO authenticated
    USING (
        public.is_super_admin()
        OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'bendahara', 'pengurus'])
        OR (
            public.is_tenant_member(tenant_id)
            AND resident_id = public.get_my_resident_id(tenant_id)
        )
    );

CREATE POLICY activity_participants_insert
    ON public.activity_participants
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
        OR (
            public.is_tenant_member(tenant_id)
            AND resident_id = public.get_my_resident_id(tenant_id)
        )
    );

CREATE POLICY activity_participants_update
    ON public.activity_participants
    FOR UPDATE
    TO authenticated
    USING (
        public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
        OR (
            public.is_tenant_member(tenant_id)
            AND resident_id = public.get_my_resident_id(tenant_id)
        )
    )
    WITH CHECK (
        public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
        OR (
            public.is_tenant_member(tenant_id)
            AND resident_id = public.get_my_resident_id(tenant_id)
        )
    );

CREATE POLICY activity_participants_delete
    ON public.activity_participants
    FOR DELETE
    TO authenticated
    USING (public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus']));

-- ---------------------------------------------------------------------------
-- 3.27 notifications (UPDATE columns is_read, read_at restricted in 0010)
-- ---------------------------------------------------------------------------
CREATE POLICY notifications_select
    ON public.notifications
    FOR SELECT
    TO authenticated
    USING (
        public.is_super_admin()
        OR (public.is_tenant_member(tenant_id) AND recipient_user_id = auth.uid())
    );

CREATE POLICY notifications_update
    ON public.notifications
    FOR UPDATE
    TO authenticated
    USING (public.is_tenant_member(tenant_id) AND recipient_user_id = auth.uid())
    WITH CHECK (public.is_tenant_member(tenant_id) AND recipient_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3.28 audit_logs (Read-only for super_admin, ketua_rt, sekretaris, bendahara)
-- ---------------------------------------------------------------------------
CREATE POLICY audit_logs_select
    ON public.audit_logs
    FOR SELECT
    TO authenticated
    USING (
        public.is_super_admin()
        OR (
            tenant_id IS NOT NULL
            AND public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'bendahara'])
        )
    );

