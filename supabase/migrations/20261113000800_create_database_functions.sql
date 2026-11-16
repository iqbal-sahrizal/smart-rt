-- Step 09 Migration 0008: Core Database Functions & Integrity Validators

-- 1. Generic updated_at timestamp maintainer
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- 2. Sync new Supabase Auth user into public.profiles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, phone)
    VALUES (
        NEW.id,
        COALESCE(
            NULLIF(trim(NEW.raw_user_meta_data ->> 'full_name'), ''),
            split_part(COALESCE(NEW.email, 'user@smartrt.local'), '@', 1)
        ),
        NEW.phone
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;

-- 3. Prevent privilege escalation via profiles.is_super_admin on INSERT or UPDATE
CREATE OR REPLACE FUNCTION public.protect_super_admin_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_jwt_role text := COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'none');
    v_is_privileged_context boolean;
BEGIN
    v_is_privileged_context :=
        current_user IN ('postgres', 'supabase_admin', 'service_role')
        AND v_jwt_role NOT IN ('authenticated', 'anon');

    IF TG_OP = 'INSERT' THEN
        IF NEW.is_super_admin IS TRUE AND NOT v_is_privileged_context THEN
            RAISE EXCEPTION 'Setting is_super_admin on insert is restricted to trusted administrative contexts';
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin AND NOT v_is_privileged_context THEN
            RAISE EXCEPTION 'Modifying is_super_admin is restricted to trusted administrative contexts';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- 4. Validate bills target (household_id vs resident_id) matches dues.target_scope
CREATE OR REPLACE FUNCTION public.validate_bill_target_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_scope text;
BEGIN
    SELECT target_scope
    INTO v_scope
    FROM public.dues
    WHERE id = NEW.due_id
      AND tenant_id = NEW.tenant_id;

    IF v_scope IS NULL THEN
        RAISE EXCEPTION 'Due % not found for tenant %', NEW.due_id, NEW.tenant_id;
    END IF;

    IF v_scope = 'household' AND (NEW.household_id IS NULL OR NEW.resident_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Bill for household-scoped due must reference household_id only';
    END IF;

    IF v_scope = 'resident' AND (NEW.resident_id IS NULL OR NEW.household_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Bill for resident-scoped due must reference resident_id only';
    END IF;

    RETURN NEW;
END;
$$;

-- 5. Validate payment & refund cross-row integrity (with row lock against concurrent refunds)
CREATE OR REPLACE FUNCTION public.validate_payment_and_refund()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_parent_bill_id uuid;
    v_parent_type text;
    v_parent_status text;
    v_parent_amount numeric(14, 2);
    v_total_refunded numeric(14, 2);
BEGIN
    IF NEW.payment_type = 'refund' THEN
        IF NEW.status = 'refunded' THEN
            RAISE EXCEPTION 'Refund record cannot have status refunded';
        END IF;

        SELECT bill_id, payment_type, status, amount
        INTO v_parent_bill_id, v_parent_type, v_parent_status, v_parent_amount
        FROM public.payments
        WHERE id = NEW.parent_payment_id
          AND tenant_id = NEW.tenant_id
        FOR UPDATE;

        IF v_parent_type IS NULL THEN
            RAISE EXCEPTION 'Parent payment % not found in tenant %', NEW.parent_payment_id, NEW.tenant_id;
        END IF;

        IF v_parent_type <> 'payment' THEN
            RAISE EXCEPTION 'Refund parent_payment_id must reference a payment, not a refund';
        END IF;

        IF v_parent_bill_id <> NEW.bill_id THEN
            RAISE EXCEPTION 'Refund must reference the same bill as its parent payment';
        END IF;

        IF v_parent_status NOT IN ('verified', 'refunded') THEN
            RAISE EXCEPTION 'Cannot refund a payment with status %', v_parent_status;
        END IF;

        SELECT COALESCE(SUM(amount), 0)
        INTO v_total_refunded
        FROM public.payments
        WHERE tenant_id = NEW.tenant_id
          AND parent_payment_id = NEW.parent_payment_id
          AND payment_type = 'refund'
          AND status IN ('pending', 'verified')
          AND id <> NEW.id;

        IF NEW.status IN ('pending', 'verified') AND (v_total_refunded + NEW.amount) > v_parent_amount THEN
            RAISE EXCEPTION 'Total refund (%) exceeds original payment amount (%)', v_total_refunded + NEW.amount, v_parent_amount;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- 6. Validate cash_transactions consistency with linked payment
CREATE OR REPLACE FUNCTION public.validate_cash_transaction_payment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_payment_type text;
    v_payment_status text;
    v_payment_amount numeric(14, 2);
BEGIN
    IF NEW.payment_id IS NOT NULL THEN
        SELECT payment_type, status, amount
        INTO v_payment_type, v_payment_status, v_payment_amount
        FROM public.payments
        WHERE id = NEW.payment_id
          AND tenant_id = NEW.tenant_id;

        IF v_payment_type IS NULL THEN
            RAISE EXCEPTION 'Linked payment % not found in tenant %', NEW.payment_id, NEW.tenant_id;
        END IF;

        IF v_payment_status <> 'verified' THEN
            RAISE EXCEPTION 'Cash transaction can only link to a verified payment';
        END IF;

        IF NEW.amount <> v_payment_amount THEN
            RAISE EXCEPTION 'Cash transaction amount (%) must match linked payment amount (%)', NEW.amount, v_payment_amount;
        END IF;

        IF v_payment_type = 'payment' AND NEW.type <> 'income' THEN
            RAISE EXCEPTION 'Cash transaction for verified payment must have type income';
        END IF;

        IF v_payment_type = 'refund' AND NEW.type <> 'expense' THEN
            RAISE EXCEPTION 'Cash transaction for verified refund must have type expense';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- 7. Validate announcement_recipients matches announcements.target_type
CREATE OR REPLACE FUNCTION public.validate_announcement_recipient()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_target_type text;
BEGIN
    SELECT target_type
    INTO v_target_type
    FROM public.announcements
    WHERE id = NEW.announcement_id
      AND tenant_id = NEW.tenant_id;

    IF v_target_type IS NULL THEN
        RAISE EXCEPTION 'Announcement % not found in tenant %', NEW.announcement_id, NEW.tenant_id;
    END IF;

    IF v_target_type = 'all' THEN
        RAISE EXCEPTION 'Announcements with target_type all must not have specific recipients';
    ELSIF v_target_type = 'role' AND NEW.role_id IS NULL THEN
        RAISE EXCEPTION 'Announcement recipient must specify role_id when target_type is role';
    ELSIF v_target_type = 'household' AND NEW.household_id IS NULL THEN
        RAISE EXCEPTION 'Announcement recipient must specify household_id when target_type is household';
    END IF;

    RETURN NEW;
END;
$$;

-- 8. Prevent changing announcements.target_type when recipients already exist
CREATE OR REPLACE FUNCTION public.validate_announcement_target_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.target_type IS DISTINCT FROM OLD.target_type THEN
        IF EXISTS (
            SELECT 1
            FROM public.announcement_recipients
            WHERE announcement_id = NEW.id
              AND tenant_id = NEW.tenant_id
        ) THEN
            RAISE EXCEPTION 'Cannot change announcement target_type while recipients exist';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- 9. Validate tenant actor columns belong to the same tenant (or super_admin when permitted)
-- TG_ARGV[0]: actor column name (e.g. 'created_by', 'verified_by')
-- TG_ARGV[1]: 'allow_super_admin' | 'member_only'
CREATE OR REPLACE FUNCTION public.validate_tenant_actor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_col_name text := TG_ARGV[0];
    v_mode text := COALESCE(TG_ARGV[1], 'allow_super_admin');
    v_actor_id uuid;
    v_tenant_id uuid := NEW.tenant_id;
    v_is_member boolean := false;
    v_is_super_admin boolean := false;
BEGIN
    -- Audit logs with NULL tenant_id are global actions; only check when tenant_id is present
    IF v_tenant_id IS NULL THEN
        RETURN NEW;
    END IF;

    EXECUTE format('SELECT ($1).%I', v_col_name)
    INTO v_actor_id
    USING NEW;

    IF v_actor_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.tenant_members tm
        WHERE tm.tenant_id = v_tenant_id
          AND tm.user_id = v_actor_id
    )
    INTO v_is_member;

    IF v_is_member THEN
        RETURN NEW;
    END IF;

    IF v_mode = 'allow_super_admin' THEN
        SELECT EXISTS (
            SELECT 1
            FROM public.profiles p
            WHERE p.id = v_actor_id
              AND p.is_super_admin IS TRUE
        )
        INTO v_is_super_admin;

        IF v_is_super_admin THEN
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION 'Actor % on column % is not a member of tenant %', v_actor_id, v_col_name, v_tenant_id;
END;
$$;
