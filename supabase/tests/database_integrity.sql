-- Smart RT Step 09.2 — Comprehensive Database Integrity Test Script
-- Target: PostgreSQL 15+ / Supabase Local Stack
-- Usage:
--   supabase start && supabase db reset
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/database_integrity.sql
--
-- Wrapped in BEGIN ... ROLLBACK so no test fixtures persist after execution.

BEGIN;

DO $$
DECLARE
    v_tenant_a uuid := gen_random_uuid();
    v_tenant_b uuid := gen_random_uuid();

    v_user_a uuid := gen_random_uuid();
    v_user_b uuid := gen_random_uuid();
    v_user_super uuid := gen_random_uuid();

    v_member_a uuid := gen_random_uuid();
    v_member_b uuid := gen_random_uuid();

    v_role_warga uuid;

    v_hh_a uuid := gen_random_uuid();
    v_hh_b uuid := gen_random_uuid();
    v_res_a uuid := gen_random_uuid();
    v_res_b uuid := gen_random_uuid();
    v_veh_a uuid := gen_random_uuid();

    v_due_hh_a uuid := gen_random_uuid();
    v_due_res_a uuid := gen_random_uuid();
    v_bill_a uuid := gen_random_uuid();
    v_bill_a2 uuid := gen_random_uuid();

    v_pay_pending uuid := gen_random_uuid();
    v_pay_verified uuid := gen_random_uuid();
    v_refund_1 uuid := gen_random_uuid();
    v_refund_2 uuid := gen_random_uuid();

    v_cat_in_a uuid := gen_random_uuid();
    v_cat_out_a uuid := gen_random_uuid();

    v_ann_all uuid := gen_random_uuid();
    v_ann_role uuid := gen_random_uuid();

    v_count integer;
    v_resident_check uuid;
BEGIN
    RAISE NOTICE '=== 1. Seed Verification & Idempotency ===';

    SELECT count(*) INTO v_count FROM public.roles;
    IF v_count <> 5 THEN
        RAISE EXCEPTION 'Expected 5 seeded roles, found %', v_count;
    END IF;

    SELECT id INTO v_role_warga FROM public.roles WHERE code = 'warga';

    -- Re-inserting seed role must remain idempotent
    INSERT INTO public.roles (code, name, description)
    VALUES ('warga', 'Warga', 'Duplicate test')
    ON CONFLICT (code) DO NOTHING;

    SELECT count(*) INTO v_count FROM public.roles;
    IF v_count <> 5 THEN
        RAISE EXCEPTION 'Seed idempotency failed for public.roles';
    END IF;

    -- Create two isolated test tenants
    INSERT INTO public.tenants (id, code, name, rt_number, rw_number, kelurahan, kecamatan, city, province)
    VALUES
        (v_tenant_a, 'test-rt-a', 'RT A Test', '01', '01', 'Kel A', 'Kec A', 'Kota A', 'Prov A'),
        (v_tenant_b, 'test-rt-b', 'RT B Test', '02', '01', 'Kel B', 'Kec B', 'Kota B', 'Prov B');

    -- Create auth.users (triggers handle_new_user -> public.profiles)
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES
        (v_user_a, 'user_a@test.local', '{"full_name": "User A"}'::jsonb),
        (v_user_b, 'user_b@test.local', '{"full_name": "User B"}'::jsonb),
        (v_user_super, 'super@test.local', '{"full_name": "Super Admin"}'::jsonb);

    -- Promote v_user_super in privileged postgres context
    UPDATE public.profiles SET is_super_admin = true WHERE id = v_user_super;

    -- Households & Residents
    INSERT INTO public.households (id, tenant_id, kk_number, address)
    VALUES
        (v_hh_a, v_tenant_a, '3171000000000001', 'Jl. A No. 1'),
        (v_hh_b, v_tenant_b, '3171000000000002', 'Jl. B No. 2');

    INSERT INTO public.residents (id, tenant_id, household_id, full_name, gender, family_role)
    VALUES
        (v_res_a, v_tenant_a, v_hh_a, 'Warga A', 'L', 'kepala_keluarga'),
        (v_res_b, v_tenant_b, v_hh_b, 'Warga B', 'P', 'kepala_keluarga');

    UPDATE public.households SET head_resident_id = v_res_a WHERE id = v_hh_a;

    -- Tenant memberships
    INSERT INTO public.tenant_members (id, tenant_id, user_id, resident_id, status)
    VALUES
        (v_member_a, v_tenant_a, v_user_a, v_res_a, 'active'),
        (v_member_b, v_tenant_b, v_user_b, v_res_b, 'active');

    INSERT INTO public.vehicles (id, tenant_id, household_id, resident_id, vehicle_type, plate_number)
    VALUES (v_veh_a, v_tenant_a, v_hh_a, v_res_a, 'motor', 'B 1234 TEST');

    -- =========================================================================
    RAISE NOTICE '=== 2. Composite FK & Cross-Tenant Isolation ===';

    INSERT INTO public.dues (id, tenant_id, name, amount, billing_cycle, target_scope)
    VALUES
        (v_due_hh_a, v_tenant_a, 'Iuran Kebersihan', 50000, 'monthly', 'household'),
        (v_due_res_a, v_tenant_a, 'Iuran Pemuda', 20000, 'monthly', 'resident');

    -- Cross-tenant bill referencing Tenant A due inside Tenant B must fail
    BEGIN
        INSERT INTO public.bills (tenant_id, due_id, household_id, period_year, period_month, amount, due_date)
        VALUES (v_tenant_b, v_due_hh_a, v_hh_b, 2026, 11, 50000, '2026-11-30');
        RAISE EXCEPTION 'FAIL: Cross-tenant due reference in bills was allowed';
    EXCEPTION WHEN foreign_key_violation THEN
        NULL;
    END;

    -- =========================================================================
    RAISE NOTICE '=== 3. Bill Target Scope & Status Checks ===';

    -- Household-scoped due with resident_id must fail
    BEGIN
        INSERT INTO public.bills (tenant_id, due_id, resident_id, period_year, period_month, amount, due_date)
        VALUES (v_tenant_a, v_due_hh_a, v_res_a, 2026, 11, 50000, '2026-11-30');
        RAISE EXCEPTION 'FAIL: Household-scoped due accepted resident_id';
    EXCEPTION WHEN raise_exception THEN
        NULL;
    END;

    -- Resident-scoped due with household_id must fail
    BEGIN
        INSERT INTO public.bills (tenant_id, due_id, household_id, period_year, period_month, amount, due_date)
        VALUES (v_tenant_a, v_due_res_a, v_hh_a, 2026, 11, 20000, '2026-11-30');
        RAISE EXCEPTION 'FAIL: Resident-scoped due accepted household_id';
    EXCEPTION WHEN raise_exception THEN
        NULL;
    END;

    -- Paid status with paid_amount < amount must fail
    BEGIN
        INSERT INTO public.bills (tenant_id, due_id, household_id, period_year, period_month, amount, paid_amount, status, due_date)
        VALUES (v_tenant_a, v_due_hh_a, v_hh_a, 2026, 11, 50000, 10000, 'paid', '2026-11-30');
        RAISE EXCEPTION 'FAIL: Paid bill with insufficient paid_amount was allowed';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    -- Valid bills
    INSERT INTO public.bills (id, tenant_id, due_id, household_id, period_year, period_month, amount, paid_amount, status, due_date)
    VALUES
        (v_bill_a, v_tenant_a, v_due_hh_a, v_hh_a, 2026, 11, 100000, 100000, 'paid', '2026-11-30'),
        (v_bill_a2, v_tenant_a, v_due_hh_a, v_hh_a, 2026, 12, 100000, 0, 'unpaid', '2026-12-31');

    -- =========================================================================
    RAISE NOTICE '=== 4. Payment & Refund Integrity ===';

    INSERT INTO public.payments (id, tenant_id, bill_id, payment_type, paid_by_user_id, amount, payment_method, status)
    VALUES
        (v_pay_pending, v_tenant_a, v_bill_a, 'payment', v_user_a, 50000, 'transfer', 'pending'),
        (v_pay_verified, v_tenant_a, v_bill_a, 'payment', v_user_a, 100000, 'transfer', 'verified');

    -- Refund of pending payment must fail
    BEGIN
        INSERT INTO public.payments (tenant_id, bill_id, payment_type, parent_payment_id, amount, payment_method, status)
        VALUES (v_tenant_a, v_bill_a, 'refund', v_pay_pending, 10000, 'transfer', 'verified');
        RAISE EXCEPTION 'FAIL: Refund of pending payment was allowed';
    EXCEPTION WHEN raise_exception THEN
        NULL;
    END;

    -- Refund with mismatched bill_id must fail
    BEGIN
        INSERT INTO public.payments (tenant_id, bill_id, payment_type, parent_payment_id, amount, payment_method, status)
        VALUES (v_tenant_a, v_bill_a2, 'refund', v_pay_verified, 10000, 'transfer', 'verified');
        RAISE EXCEPTION 'FAIL: Refund with mismatched bill_id was allowed';
    EXCEPTION WHEN raise_exception THEN
        NULL;
    END;

    -- Refund with status = 'refunded' must fail
    BEGIN
        INSERT INTO public.payments (tenant_id, bill_id, payment_type, parent_payment_id, amount, payment_method, status)
        VALUES (v_tenant_a, v_bill_a, 'refund', v_pay_verified, 10000, 'transfer', 'refunded');
        RAISE EXCEPTION 'FAIL: Refund record with status refunded was allowed';
    EXCEPTION WHEN raise_exception THEN
        NULL;
    END;

    -- Partial refund 1 (60,000 <= 100,000) succeeds
    INSERT INTO public.payments (id, tenant_id, bill_id, payment_type, parent_payment_id, amount, payment_method, status)
    VALUES (v_refund_1, v_tenant_a, v_bill_a, 'refund', v_pay_verified, 60000, 'transfer', 'verified');

    -- Refund of a refund must fail
    BEGIN
        INSERT INTO public.payments (tenant_id, bill_id, payment_type, parent_payment_id, amount, payment_method, status)
        VALUES (v_tenant_a, v_bill_a, 'refund', v_refund_1, 10000, 'transfer', 'verified');
        RAISE EXCEPTION 'FAIL: Refund of a refund was allowed';
    EXCEPTION WHEN raise_exception THEN
        NULL;
    END;

    -- Over-refund (60,000 + 50,000 > 100,000) must fail
    BEGIN
        INSERT INTO public.payments (tenant_id, bill_id, payment_type, parent_payment_id, amount, payment_method, status)
        VALUES (v_tenant_a, v_bill_a, 'refund', v_pay_verified, 50000, 'transfer', 'verified');
        RAISE EXCEPTION 'FAIL: Cumulative over-refund was allowed';
    EXCEPTION WHEN raise_exception THEN
        NULL;
    END;

    -- Remaining partial refund (60,000 + 40,000 = 100,000) succeeds
    INSERT INTO public.payments (id, tenant_id, bill_id, payment_type, parent_payment_id, amount, payment_method, status)
    VALUES (v_refund_2, v_tenant_a, v_bill_a, 'refund', v_pay_verified, 40000, 'transfer', 'verified');

    -- =========================================================================
    RAISE NOTICE '=== 5. Cash Transaction Integrity ===';

    INSERT INTO public.cash_categories (id, tenant_id, name, type)
    VALUES
        (v_cat_in_a, v_tenant_a, 'Iuran Test', 'income'),
        (v_cat_out_a, v_tenant_a, 'Refund Test', 'expense');

    -- Linking pending payment must fail
    BEGIN
        INSERT INTO public.cash_transactions (tenant_id, category_id, payment_id, type, amount, transaction_date, description, created_by)
        VALUES (v_tenant_a, v_cat_in_a, v_pay_pending, 'income', 50000, '2026-11-13', 'Invalid pending', v_user_a);
        RAISE EXCEPTION 'FAIL: Cash transaction linked to pending payment';
    EXCEPTION WHEN raise_exception THEN
        NULL;
    END;

    -- Mismatched amount must fail
    BEGIN
        INSERT INTO public.cash_transactions (tenant_id, category_id, payment_id, type, amount, transaction_date, description, created_by)
        VALUES (v_tenant_a, v_cat_in_a, v_pay_verified, 'income', 99999, '2026-11-13', 'Wrong amount', v_user_a);
        RAISE EXCEPTION 'FAIL: Cash transaction with mismatched amount was allowed';
    EXCEPTION WHEN raise_exception THEN
        NULL;
    END;

    -- Wrong type (expense for payment) must fail
    BEGIN
        INSERT INTO public.cash_transactions (tenant_id, category_id, payment_id, type, amount, transaction_date, description, created_by)
        VALUES (v_tenant_a, v_cat_out_a, v_pay_verified, 'expense', 100000, '2026-11-13', 'Wrong type', v_user_a);
        RAISE EXCEPTION 'FAIL: Cash transaction with wrong type was allowed';
    EXCEPTION WHEN raise_exception THEN
        NULL;
    END;

    -- Valid cash_transaction for verified payment
    INSERT INTO public.cash_transactions (tenant_id, category_id, payment_id, type, amount, transaction_date, description, created_by)
    VALUES (v_tenant_a, v_cat_in_a, v_pay_verified, 'income', 100000, '2026-11-13', 'Valid income', v_user_a);

    -- Duplicate cash_transaction for same payment_id must fail
    BEGIN
        INSERT INTO public.cash_transactions (tenant_id, category_id, payment_id, type, amount, transaction_date, description, created_by)
        VALUES (v_tenant_a, v_cat_in_a, v_pay_verified, 'income', 100000, '2026-11-13', 'Duplicate', v_user_a);
        RAISE EXCEPTION 'FAIL: Duplicate cash_transaction for same payment_id was allowed';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;

    -- Valid expense cash_transaction for verified refund
    INSERT INTO public.cash_transactions (tenant_id, category_id, payment_id, type, amount, transaction_date, description, created_by)
    VALUES (v_tenant_a, v_cat_out_a, v_refund_1, 'expense', 60000, '2026-11-13', 'Valid refund expense', v_user_a);

    -- =========================================================================
    RAISE NOTICE '=== 6. Announcement Recipient Integrity ===';

    INSERT INTO public.announcements (id, tenant_id, author_id, title, content, target_type)
    VALUES
        (v_ann_all, v_tenant_a, v_user_a, 'Global Info', 'Body', 'all'),
        (v_ann_role, v_tenant_a, v_user_a, 'Role Info', 'Body', 'role');

    -- Adding recipient to target_type = 'all' must fail
    BEGIN
        INSERT INTO public.announcement_recipients (tenant_id, announcement_id, role_id)
        VALUES (v_tenant_a, v_ann_all, v_role_warga);
        RAISE EXCEPTION 'FAIL: Recipient added to target_type=all announcement';
    EXCEPTION WHEN raise_exception THEN
        NULL;
    END;

    -- Valid role recipient
    INSERT INTO public.announcement_recipients (tenant_id, announcement_id, role_id)
    VALUES (v_tenant_a, v_ann_role, v_role_warga);

    -- Duplicate role recipient must fail
    BEGIN
        INSERT INTO public.announcement_recipients (tenant_id, announcement_id, role_id)
        VALUES (v_tenant_a, v_ann_role, v_role_warga);
        RAISE EXCEPTION 'FAIL: Duplicate role recipient was allowed';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;

    -- Changing target_type while recipients exist must fail
    BEGIN
        UPDATE public.announcements SET target_type = 'all' WHERE id = v_ann_role;
        RAISE EXCEPTION 'FAIL: target_type changed while recipients exist';
    EXCEPTION WHEN raise_exception THEN
        NULL;
    END;

    -- =========================================================================
    RAISE NOTICE '=== 7. Notification Membership & Tenant Actor Integrity ===';

    -- Cross-tenant notification recipient must fail
    BEGIN
        INSERT INTO public.notifications (tenant_id, recipient_user_id, title, body, type)
        VALUES (v_tenant_b, v_user_a, 'Cross-tenant', 'Nope', 'announcement');
        RAISE EXCEPTION 'FAIL: Cross-tenant notification recipient was allowed';
    EXCEPTION WHEN foreign_key_violation THEN
        NULL;
    END;

    -- Cross-tenant paid_by_user_id must fail
    BEGIN
        INSERT INTO public.payments (tenant_id, bill_id, payment_type, paid_by_user_id, amount, payment_method, status)
        VALUES (v_tenant_a, v_bill_a2, 'payment', v_user_b, 50000, 'transfer', 'pending');
        RAISE EXCEPTION 'FAIL: Cross-tenant paid_by_user_id was allowed';
    EXCEPTION WHEN raise_exception THEN
        NULL;
    END;

    -- Cross-tenant created_by (non-member, non-super-admin) must fail
    BEGIN
        INSERT INTO public.cash_transactions (tenant_id, category_id, type, amount, transaction_date, description, created_by)
        VALUES (v_tenant_a, v_cat_in_a, 'income', 10000, '2026-11-13', 'Cross-tenant actor', v_user_b);
        RAISE EXCEPTION 'FAIL: Cross-tenant created_by was allowed';
    EXCEPTION WHEN raise_exception THEN
        NULL;
    END;

    -- Super admin acting on Tenant A must succeed
    INSERT INTO public.cash_transactions (tenant_id, category_id, type, amount, transaction_date, description, created_by)
    VALUES (v_tenant_a, v_cat_in_a, 'income', 10000, '2026-11-13', 'Super admin adjustment', v_user_super);

    -- =========================================================================
    RAISE NOTICE '=== 8. Composite FK Column-List ON DELETE SET NULL ===';

    DELETE FROM public.residents WHERE id = v_res_a;

    SELECT resident_id INTO v_resident_check FROM public.tenant_members WHERE id = v_member_a;
    IF v_resident_check IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL: tenant_members.resident_id was not set to NULL';
    END IF;

    SELECT head_resident_id INTO v_resident_check FROM public.households WHERE id = v_hh_a;
    IF v_resident_check IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL: households.head_resident_id was not set to NULL';
    END IF;

    SELECT resident_id INTO v_resident_check FROM public.vehicles WHERE id = v_veh_a;
    IF v_resident_check IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL: vehicles.resident_id was not set to NULL';
    END IF;

    RAISE NOTICE '=== 9. Super Admin Protection & Column-Level Profile Update ===';
    -- Note: Execute role-switching tests inside sub-blocks
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

    -- Allowed column update on profiles
    UPDATE public.profiles SET full_name = 'User A Updated' WHERE id = v_user_a;

    -- Updating is_super_admin as authenticated must fail
    BEGIN
        UPDATE public.profiles SET is_super_admin = true WHERE id = v_user_a;
        RAISE EXCEPTION 'FAIL: authenticated user updated is_super_admin';
    EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
        NULL;
    END;

    -- Inserting profile with is_super_admin = true as authenticated must fail
    BEGIN
        INSERT INTO public.profiles (id, full_name, is_super_admin)
        VALUES (gen_random_uuid(), 'Escalation', true);
        RAISE EXCEPTION 'FAIL: authenticated user inserted is_super_admin = true';
    EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
        NULL;
    END;

    RESET ROLE;
    PERFORM set_config('request.jwt.claim.role', '', true);

    RAISE NOTICE 'ALL DATABASE INTEGRITY CHECKS PASSED (rolling back test transaction)';
END $$;

ROLLBACK;

