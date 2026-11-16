-- Step 09 Migration 0009: Core Database Triggers

-- updated_at triggers (all 16 tables with updated_at)
CREATE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON public.tenants
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_tenant_members_updated_at
    BEFORE UPDATE ON public.tenant_members
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_households_updated_at
    BEFORE UPDATE ON public.households
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_residents_updated_at
    BEFORE UPDATE ON public.residents
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_resident_private_data_updated_at
    BEFORE UPDATE ON public.resident_private_data
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_vehicles_updated_at
    BEFORE UPDATE ON public.vehicles
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_dues_updated_at
    BEFORE UPDATE ON public.dues
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_bills_updated_at
    BEFORE UPDATE ON public.bills
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_cash_transactions_updated_at
    BEFORE UPDATE ON public.cash_transactions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_announcements_updated_at
    BEFORE UPDATE ON public.announcements
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_complaints_updated_at
    BEFORE UPDATE ON public.complaints
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_letter_types_updated_at
    BEFORE UPDATE ON public.letter_types
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_letter_sequences_updated_at
    BEFORE UPDATE ON public.letter_sequences
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_letter_requests_updated_at
    BEFORE UPDATE ON public.letter_requests
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_activities_updated_at
    BEFORE UPDATE ON public.activities
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Protect profiles.is_super_admin on INSERT and UPDATE
CREATE TRIGGER trg_profiles_protect_super_admin
    BEFORE INSERT OR UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.protect_super_admin_column();

-- Automatically provision profile row when a Supabase Auth user is created
CREATE TRIGGER trg_auth_users_create_profile
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Business rule integrity triggers
CREATE TRIGGER trg_bills_validate_target_scope
    BEFORE INSERT OR UPDATE OF due_id, household_id, resident_id ON public.bills
    FOR EACH ROW EXECUTE FUNCTION public.validate_bill_target_scope();

CREATE TRIGGER trg_payments_validate_refund
    BEFORE INSERT OR UPDATE ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public.validate_payment_and_refund();

CREATE TRIGGER trg_cash_tx_validate_payment
    BEFORE INSERT OR UPDATE ON public.cash_transactions
    FOR EACH ROW EXECUTE FUNCTION public.validate_cash_transaction_payment();

CREATE TRIGGER trg_ann_recipients_validate_target
    BEFORE INSERT OR UPDATE ON public.announcement_recipients
    FOR EACH ROW EXECUTE FUNCTION public.validate_announcement_recipient();

CREATE TRIGGER trg_announcements_validate_target_change
    BEFORE UPDATE OF target_type ON public.announcements
    FOR EACH ROW EXECUTE FUNCTION public.validate_announcement_target_change();

-- Tenant actor integrity triggers
CREATE TRIGGER trg_member_roles_validate_assigned_by
    BEFORE INSERT OR UPDATE OF tenant_id, assigned_by ON public.member_roles
    FOR EACH ROW EXECUTE FUNCTION public.validate_tenant_actor('assigned_by', 'allow_super_admin');

CREATE TRIGGER trg_resident_docs_validate_verified_by
    BEFORE INSERT OR UPDATE OF tenant_id, verified_by ON public.resident_documents
    FOR EACH ROW EXECUTE FUNCTION public.validate_tenant_actor('verified_by', 'allow_super_admin');

CREATE TRIGGER trg_payments_validate_paid_by
    BEFORE INSERT OR UPDATE OF tenant_id, paid_by_user_id ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public.validate_tenant_actor('paid_by_user_id', 'member_only');

CREATE TRIGGER trg_payments_validate_verified_by
    BEFORE INSERT OR UPDATE OF tenant_id, verified_by ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public.validate_tenant_actor('verified_by', 'allow_super_admin');

CREATE TRIGGER trg_cash_tx_validate_created_by
    BEFORE INSERT OR UPDATE OF tenant_id, created_by ON public.cash_transactions
    FOR EACH ROW EXECUTE FUNCTION public.validate_tenant_actor('created_by', 'allow_super_admin');

CREATE TRIGGER trg_announcements_validate_author
    BEFORE INSERT OR UPDATE OF tenant_id, author_id ON public.announcements
    FOR EACH ROW EXECUTE FUNCTION public.validate_tenant_actor('author_id', 'allow_super_admin');

CREATE TRIGGER trg_letter_requests_validate_reviewed_by
    BEFORE INSERT OR UPDATE OF tenant_id, reviewed_by ON public.letter_requests
    FOR EACH ROW EXECUTE FUNCTION public.validate_tenant_actor('reviewed_by', 'allow_super_admin');

CREATE TRIGGER trg_activities_validate_created_by
    BEFORE INSERT OR UPDATE OF tenant_id, created_by ON public.activities
    FOR EACH ROW EXECUTE FUNCTION public.validate_tenant_actor('created_by', 'allow_super_admin');

CREATE TRIGGER trg_audit_logs_validate_actor
    BEFORE INSERT OR UPDATE OF tenant_id, actor_user_id ON public.audit_logs
    FOR EACH ROW EXECUTE FUNCTION public.validate_tenant_actor('actor_user_id', 'allow_super_admin');
