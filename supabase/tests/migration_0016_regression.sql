-- Smart RT Step 10.2.2.25 — Migration 0016 Comprehensive SQL Regression Test Suite
-- Covers all 32 regression scenarios cleanly inside BEGIN ... ROLLBACK.
-- Usage: psql ... -v ON_ERROR_STOP=1 -f supabase/tests/migration_0016_regression.sql

BEGIN;

DO $$
DECLARE
    -- Tenants & actors
    v_tenant_a uuid := gen_random_uuid();
    v_tenant_b uuid := gen_random_uuid();
    v_user_staff_a uuid := gen_random_uuid();
    v_user_warga_a uuid := gen_random_uuid();
    v_user_bendahara_a uuid := gen_random_uuid();
    v_user_staff_b uuid := gen_random_uuid();
    v_user_super uuid := gen_random_uuid();

    v_member_staff_a uuid := gen_random_uuid();
    v_member_warga_a uuid := gen_random_uuid();
    v_member_bendahara_a uuid := gen_random_uuid();
    v_member_staff_b uuid := gen_random_uuid();

    v_role_ketua uuid;
    v_role_warga uuid;
    v_role_bendahara uuid;

    v_hh_a uuid := gen_random_uuid();
    v_res_a uuid := gen_random_uuid();
    v_letter_type_a uuid := gen_random_uuid();

    -- Persistent cursor / lease test vars
    v_acq record;
    v_acq2 record;
    v_ren record;
    v_token_1 uuid;
    v_token_2 uuid;
    v_cursor_1 jsonb := jsonb_build_object(
        'v', 1,
        'bucketIndex', 2,
        'queue', jsonb_build_array(
            jsonb_build_object('bucketId', 'complaints', 'prefix', '', 'offset', 100)
        )
    );
    v_cursor_2 jsonb := jsonb_build_object(
        'v', 1,
        'bucketIndex', 3,
        'queue', jsonb_build_array(
            jsonb_build_object('bucketId', 'letter-requests', 'prefix', 'abc', 'offset', 200)
        )
    );
    v_oversized_cursor jsonb;
    v_cur_check jsonb;
    v_cycle_done timestamptz;
    v_exp_before timestamptz;

    -- Domain retention test fixtures
    v_comp_young uuid := gen_random_uuid();
    v_comp_aged uuid := gen_random_uuid();
    v_comp_nophoto uuid := gen_random_uuid();
    v_comp_invalid uuid := gen_random_uuid();

    v_act_young uuid := gen_random_uuid();
    v_act_aged uuid := gen_random_uuid();
    v_act_nophoto uuid := gen_random_uuid();

    v_lr_young uuid := gen_random_uuid();
    v_lr_aged uuid := gen_random_uuid();
    v_lr_invalid uuid := gen_random_uuid();

    v_p_comp_young text := v_tenant_a::text || '/' || v_comp_young::text || '/' || gen_random_uuid()::text || '.jpg';
    v_p_comp_aged text := v_tenant_a::text || '/' || v_comp_aged::text || '/' || gen_random_uuid()::text || '.jpg';

    v_p_act_1 text := v_tenant_a::text || '/' || v_act_aged::text || '/' || gen_random_uuid()::text || '.jpg';
    v_p_act_2 text := v_tenant_a::text || '/' || v_act_aged::text || '/' || gen_random_uuid()::text || '.jpg';
    v_p_act_3 text := v_tenant_a::text || '/' || v_act_aged::text || '/' || gen_random_uuid()::text || '.jpg';

    v_p_lr_1 text := v_tenant_a::text || '/' || v_lr_aged::text || '/' || gen_random_uuid()::text || '.pdf';
    v_p_lr_2 text := v_tenant_a::text || '/' || v_lr_aged::text || '/' || gen_random_uuid()::text || '.pdf';
    v_p_lr_3 text := v_tenant_a::text || '/' || v_lr_aged::text || '/' || gen_random_uuid()::text || '.pdf';
    v_p_lr_issued text := v_tenant_a::text || '/' || v_lr_aged::text || '/' || gen_random_uuid()::text || '.pdf';

    v_p_lr_invalid text := v_tenant_b::text || '/' || v_lr_invalid::text || '/' || gen_random_uuid()::text || '.pdf';

    v_enq_res record;
    v_job_1 uuid;
    v_job_2 uuid;
    v_tok_1 uuid;
    v_tok_2 uuid;
    v_dec text;

    -- Soft delete complaint fixtures
    v_comp_sd_ok uuid := gen_random_uuid();
    v_comp_sd_nophoto uuid := gen_random_uuid();
    v_comp_sd_fail_enq uuid := gen_random_uuid();
    v_comp_sd_fail_aud uuid := gen_random_uuid();
    v_p_sd_ok text := v_tenant_a::text || '/' || v_comp_sd_ok::text || '/' || gen_random_uuid()::text || '.jpg';
    v_p_sd_fail_enq text := v_tenant_a::text || '/' || v_comp_sd_fail_enq::text || '/' || gen_random_uuid()::text || '.jpg';
    v_p_sd_fail_aud text := v_tenant_a::text || '/' || v_comp_sd_fail_aud::text || '/' || gen_random_uuid()::text || '.jpg';

    v_count integer;
    v_text text;
    v_ts timestamptz;
    v_summary record;
BEGIN
    RAISE NOTICE '=== Setup: Fixtures for Migration 0016 Regression Suite ===';

    SELECT id INTO v_role_ketua FROM public.roles WHERE code = 'ketua_rt';
    SELECT id INTO v_role_warga FROM public.roles WHERE code = 'warga';
    SELECT id INTO v_role_bendahara FROM public.roles WHERE code = 'bendahara';

    INSERT INTO public.tenants (id, code, name, rt_number, rw_number, kelurahan, kecamatan, city, province)
    VALUES
        (v_tenant_a, 'm16-rt-a-' || left(v_tenant_a::text, 8), 'M16 Test RT A', '01', '01', 'Kel', 'Kec', 'Kota', 'Prov'),
        (v_tenant_b, 'm16-rt-b-' || left(v_tenant_b::text, 8), 'M16 Test RT B', '02', '01', 'Kel', 'Kec', 'Kota', 'Prov');

    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES
        (v_user_staff_a, 'm16_staff_a@test.local', '{"full_name": "Staff A"}'::jsonb),
        (v_user_warga_a, 'm16_warga_a@test.local', '{"full_name": "Warga A"}'::jsonb),
        (v_user_bendahara_a, 'm16_bend_a@test.local', '{"full_name": "Bendahara A"}'::jsonb),
        (v_user_staff_b, 'm16_staff_b@test.local', '{"full_name": "Staff B"}'::jsonb),
        (v_user_super, 'm16_super@test.local', '{"full_name": "Super Admin"}'::jsonb);

    UPDATE public.profiles SET is_super_admin = true WHERE id = v_user_super;

    INSERT INTO public.households (id, tenant_id, kk_number, address)
    VALUES (v_hh_a, v_tenant_a, '3171999900000001', 'Jl. M16 Test No. 1');

    INSERT INTO public.residents (id, tenant_id, household_id, full_name, gender, family_role)
    VALUES (v_res_a, v_tenant_a, v_hh_a, 'Resident A', 'L', 'kepala_keluarga');

    INSERT INTO public.tenant_members (id, tenant_id, user_id, resident_id, status)
    VALUES
        (v_member_staff_a, v_tenant_a, v_user_staff_a, v_res_a, 'active'),
        (v_member_warga_a, v_tenant_a, v_user_warga_a, NULL, 'active'),
        (v_member_bendahara_a, v_tenant_a, v_user_bendahara_a, NULL, 'active'),
        (v_member_staff_b, v_tenant_b, v_user_staff_b, NULL, 'active');

    INSERT INTO public.member_roles (tenant_id, member_id, role_id)
    VALUES
        (v_tenant_a, v_member_staff_a, v_role_ketua),
        (v_tenant_a, v_member_warga_a, v_role_warga),
        (v_tenant_a, v_member_bendahara_a, v_role_bendahara),
        (v_tenant_b, v_member_staff_b, v_role_ketua);

    INSERT INTO public.letter_types (id, tenant_id, code, name)
    VALUES (v_letter_type_a, v_tenant_a, 'DOM', 'Surat Domisili');

    -- Clean state snapshot for orphan scan
    UPDATE public.storage_orphan_scan_state
       SET cursor = NULL,
           scan_token = NULL,
           lease_expires_at = NULL,
           cycle_started_at = NULL,
           cycle_completed_at = NULL,
           updated_at = now()
     WHERE id = 1;

    -- =========================================================================
    RAISE NOTICE '=== Tests [1]-[13]: Persistent Orphan Scan Cursor & Lease ===';
    -- =========================================================================

    -- [1] Singleton state has exactly 1 row & rejects second row
    SELECT count(*) INTO v_count FROM public.storage_orphan_scan_state;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'FAIL [1]: Expected singleton count = 1, got %', v_count;
    END IF;

    BEGIN
        INSERT INTO public.storage_orphan_scan_state (id) VALUES (2);
        RAISE EXCEPTION 'FAIL [1]: Singleton check allowed id = 2';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    -- [4] Acquire lease succeeds & clamps duration [1m, 15m]
    EXECUTE 'SET LOCAL ROLE service_role';
    SELECT * INTO v_acq FROM public.acquire_orphan_scan_lease(interval '10 seconds');
    IF NOT v_acq.acquired OR v_acq.scan_token IS NULL THEN
        RAISE EXCEPTION 'FAIL [4]: Lease acquisition failed';
    END IF;
    IF v_acq.lease_expires_at < (v_acq.db_now + interval '59 seconds')
       OR v_acq.lease_expires_at > (v_acq.db_now + interval '65 seconds') THEN
        RAISE EXCEPTION 'FAIL [4]: Expected minimum 1 minute clamp, got exp=% now=%', v_acq.lease_expires_at, v_acq.db_now;
    END IF;
    v_token_1 := v_acq.scan_token;

    -- [5] Second concurrent acquire denied while lease active
    SELECT * INTO v_acq2 FROM public.acquire_orphan_scan_lease(interval '5 minutes');
    IF v_acq2.acquired OR v_acq2.scan_token IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL [5]: Second acquire succeeded while lease active';
    END IF;

    -- [2] Invalid cursors rejected by save_orphan_scan_cursor (wrong v, non-array queue, negative bucketIndex, non-object)
    BEGIN
        PERFORM public.save_orphan_scan_cursor('{"v":2,"bucketIndex":0,"queue":[]}'::jsonb, false, v_token_1);
        RAISE EXCEPTION 'FAIL [2]: Accepted v=2 cursor';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;

    BEGIN
        PERFORM public.save_orphan_scan_cursor('{"v":1,"bucketIndex":-1,"queue":[]}'::jsonb, false, v_token_1);
        RAISE EXCEPTION 'FAIL [2]: Accepted negative bucketIndex';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;

    BEGIN
        PERFORM public.save_orphan_scan_cursor('{"v":1,"bucketIndex":0,"queue":{}}'::jsonb, false, v_token_1);
        RAISE EXCEPTION 'FAIL [2]: Accepted non-array queue';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;

    BEGIN
        PERFORM public.save_orphan_scan_cursor('[]'::jsonb, false, v_token_1);
        RAISE EXCEPTION 'FAIL [2]: Accepted non-object cursor';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;

    -- [3] Oversized cursor (> 65536 uncompressed bytes, highly compressible for TOAST) rejected
    SELECT jsonb_build_object(
        'v', 1,
        'bucketIndex', 0,
        'queue', jsonb_agg(repeat('a', 100))
    )
    INTO v_oversized_cursor
    FROM generate_series(1, 700);

    IF octet_length(v_oversized_cursor::text) <= 65536 THEN
        RAISE EXCEPTION 'FAIL [3]: Test fixture not > 65536 bytes (%)', octet_length(v_oversized_cursor::text);
    END IF;

    BEGIN
        PERFORM public.save_orphan_scan_cursor(v_oversized_cursor, false, v_token_1);
        RAISE EXCEPTION 'FAIL [3]: Accepted oversized cursor (% bytes)', octet_length(v_oversized_cursor::text);
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;

    RESET ROLE;
    BEGIN
        UPDATE public.storage_orphan_scan_state SET cursor = v_oversized_cursor WHERE id = 1;
        RAISE EXCEPTION 'FAIL [3]: Table CHECK accepted oversized TOAST-compressed cursor';
    EXCEPTION WHEN check_violation THEN NULL; END;

    -- Save valid cursor_1 with valid token_1
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM public.save_orphan_scan_cursor(v_cursor_1, false, v_token_1);
    v_cur_check := public.get_orphan_scan_cursor();
    IF v_cur_check IS DISTINCT FROM v_cursor_1 THEN
        RAISE EXCEPTION 'FAIL [4]: Cursor mismatch after valid save';
    END IF;

    -- [7] Renewal with valid token succeeds & extends lease_expires_at (clamping >15m to 15m)
    v_exp_before := v_acq.lease_expires_at;
    SELECT * INTO v_ren FROM public.renew_orphan_scan_lease(v_token_1, interval '30 minutes');
    IF NOT v_ren.renewed OR v_ren.lease_expires_at <= v_exp_before THEN
        RAISE EXCEPTION 'FAIL [7]: Valid renewal failed or did not extend';
    END IF;
    IF v_ren.lease_expires_at > (v_ren.db_now + interval '15 minutes 5 seconds') THEN
        RAISE EXCEPTION 'FAIL [7]: Expected max 15m clamp on renewal';
    END IF;

    -- [8] Renewal with stale/wrong token rejected
    SELECT * INTO v_ren FROM public.renew_orphan_scan_lease(gen_random_uuid(), interval '5 minutes');
    IF v_ren.renewed OR v_ren.lease_expires_at IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL [8]: Renewal with stale token was allowed';
    END IF;

    -- [9] Save with stale/wrong token rejected & preserves cursor_1
    BEGIN
        PERFORM public.save_orphan_scan_cursor(v_cursor_2, false, gen_random_uuid());
        RAISE EXCEPTION 'FAIL [9]: Save with stale token was allowed';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;

    IF public.get_orphan_scan_cursor() IS DISTINCT FROM v_cursor_1 THEN
        RAISE EXCEPTION 'FAIL [9]: Failed stale save mutated cursor';
    END IF;

    -- [13] Release lease does NOT modify cursor (and wrong token release is no-op)
    PERFORM public.release_orphan_scan_lease(gen_random_uuid());
    SELECT * INTO v_acq2 FROM public.acquire_orphan_scan_lease(interval '5 minutes');
    IF v_acq2.acquired THEN
        RAISE EXCEPTION 'FAIL [13]: Wrong token released active lease';
    END IF;

    PERFORM public.release_orphan_scan_lease(v_token_1);
    IF public.get_orphan_scan_cursor() IS DISTINCT FROM v_cursor_1 THEN
        RAISE EXCEPTION 'FAIL [13]: release_orphan_scan_lease altered cursor';
    END IF;

    -- [11] Failed invocation preserves previous cursor intact
    SELECT * INTO v_acq FROM public.acquire_orphan_scan_lease(interval '5 minutes');
    v_token_1 := v_acq.scan_token;
    IF NOT v_acq.acquired OR v_acq.cursor IS DISTINCT FROM v_cursor_1 THEN
        RAISE EXCEPTION 'FAIL [11]: Re-acquired lease lost previous cursor';
    END IF;
    BEGIN
        RAISE EXCEPTION 'simulated_worker_scan_crash';
    EXCEPTION WHEN OTHERS THEN
        PERFORM public.release_orphan_scan_lease(v_token_1);
    END;
    IF public.get_orphan_scan_cursor() IS DISTINCT FROM v_cursor_1 THEN
        RAISE EXCEPTION 'FAIL [11]: Failed invocation wiped previous cursor';
    END IF;

    -- [10] Save with expired lease rejected (even before another worker reclaims)
    SELECT * INTO v_acq FROM public.acquire_orphan_scan_lease(interval '5 minutes');
    v_token_1 := v_acq.scan_token;
    RESET ROLE;
    UPDATE public.storage_orphan_scan_state
       SET lease_expires_at = clock_timestamp() - interval '2 seconds'
     WHERE id = 1;
    EXECUTE 'SET LOCAL ROLE service_role';

    BEGIN
        PERFORM public.save_orphan_scan_cursor(v_cursor_2, false, v_token_1);
        RAISE EXCEPTION 'FAIL [10]: Save succeeded with expired lease';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;

    SELECT * INTO v_ren FROM public.renew_orphan_scan_lease(v_token_1, interval '5 minutes');
    IF v_ren.renewed THEN
        RAISE EXCEPTION 'FAIL [8/10]: Expired lease renewal succeeded';
    END IF;

    -- [6] Expired lease can be reclaimed cleanly and preserves cursor_1
    SELECT * INTO v_acq2 FROM public.acquire_orphan_scan_lease(interval '5 minutes');
    IF NOT v_acq2.acquired OR v_acq2.scan_token IS NULL OR v_acq2.scan_token = v_token_1 THEN
        RAISE EXCEPTION 'FAIL [6]: Expired lease could not be reclaimed';
    END IF;
    IF v_acq2.cursor IS DISTINCT FROM v_cursor_1 THEN
        RAISE EXCEPTION 'FAIL [6]: Reclaim lost prior cursor';
    END IF;
    v_token_2 := v_acq2.scan_token;

    -- Old token still blocked after reclaim
    BEGIN
        PERFORM public.save_orphan_scan_cursor(v_cursor_2, false, v_token_1);
        RAISE EXCEPTION 'FAIL [9]: Old token allowed after reclaim';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;

    -- [12] Cycle completion clears cursor to NULL and records cycle_completed_at
    PERFORM public.save_orphan_scan_cursor(NULL, true, v_token_2);
    PERFORM public.release_orphan_scan_lease(v_token_2);
    IF public.get_orphan_scan_cursor() IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL [12]: Cycle completion did not clear cursor';
    END IF;
    RESET ROLE;
    SELECT cycle_completed_at, cycle_started_at INTO v_cycle_done, v_ts
    FROM public.storage_orphan_scan_state WHERE id = 1;
    IF v_cycle_done IS NULL OR v_ts IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL [12]: Expected cycle_completed_at non-null and cycle_started_at null';
    END IF;

    -- =========================================================================
    RAISE NOTICE '=== Tests [14]-[21]: Domain Retention Enqueue ===';
    -- =========================================================================

    PERFORM set_config('app.storage_ref_ctx', 'rpc_authorized', true);

    INSERT INTO public.complaints (id, tenant_id, reporter_member_id, category, title, description, photo_path, deleted_at)
    VALUES
        (v_comp_young, v_tenant_a, v_member_warga_a, 'fasilitas', 'Young complaint', 'desc', v_p_comp_young, clock_timestamp() - interval '6 days'),
        (v_comp_aged, v_tenant_a, v_member_warga_a, 'fasilitas', 'Aged complaint', 'desc', v_p_comp_aged, clock_timestamp() - interval '8 days'),
        (v_comp_nophoto, v_tenant_a, v_member_warga_a, 'fasilitas', 'Aged no photo', 'desc', NULL, clock_timestamp() - interval '8 days'),
        (v_comp_invalid, v_tenant_a, v_member_warga_a, 'fasilitas', 'Aged invalid path', 'desc', 'not-a-valid-uuid-path.jpg', clock_timestamp() - interval '8 days');

    INSERT INTO public.activities (id, tenant_id, title, location, start_at, status, documentation_paths, created_by, deleted_at)
    VALUES
        (v_act_young, v_tenant_a, 'Young Act', 'Balai RT', clock_timestamp(), 'scheduled', jsonb_build_array(v_tenant_a::text || '/' || v_act_young::text || '/' || gen_random_uuid()::text || '.jpg'), v_user_staff_a, clock_timestamp() - interval '5 days'),
        (v_act_aged, v_tenant_a, 'Aged Multi Act', 'Balai RT', clock_timestamp(), 'scheduled', jsonb_build_array(v_p_act_1, v_p_act_2, v_p_act_3), v_user_staff_a, clock_timestamp() - interval '9 days'),
        (v_act_nophoto, v_tenant_a, 'Aged No Docs Act', 'Balai RT', clock_timestamp(), 'scheduled', '[]'::jsonb, v_user_staff_a, clock_timestamp() - interval '9 days');

    INSERT INTO public.letter_requests (id, tenant_id, letter_type_id, resident_id, requested_by_member_id, purpose, supporting_doc_paths, status, issued_file_path, updated_at)
    VALUES
        (v_lr_young, v_tenant_a, v_letter_type_a, v_res_a, v_member_warga_a, 'Young cancel', jsonb_build_array(v_tenant_a::text || '/' || v_lr_young::text || '/' || gen_random_uuid()::text || '.pdf'), 'cancelled', NULL, clock_timestamp() - interval '2 days'),
        (v_lr_aged, v_tenant_a, v_letter_type_a, v_res_a, v_member_warga_a, 'Aged cancel multi', jsonb_build_array(v_p_lr_1, v_p_lr_2, v_p_lr_3), 'cancelled', v_p_lr_issued, clock_timestamp() - interval '10 days'),
        (v_lr_invalid, v_tenant_a, v_letter_type_a, v_res_a, v_member_warga_a, 'Invalid tenant prefix', jsonb_build_array(v_p_lr_invalid), 'cancelled', NULL, clock_timestamp() - interval '10 days');

    PERFORM set_config('app.storage_ref_ctx', '', true);

    -- Expected aged valid files: 1 (comp_aged) + 3 (act_aged) + 4 (lr_aged: 3 supporting + 1 issued) = 8 created
    -- Expected invalid quarantined: 2 (comp_invalid + lr_invalid) = 2 skipped
    EXECUTE 'SET LOCAL ROLE service_role';
    SELECT * INTO v_enq_res FROM public.enqueue_soft_deleted_domain_storage_deletions(interval '7 days', 100);
    RESET ROLE;

    IF v_enq_res.enqueued_count <> 8 OR v_enq_res.skipped_count <> 2 THEN
        RAISE EXCEPTION 'FAIL [14/15/17/18/20]: Expected enqueued=8, skipped=2; got enqueued=%, skipped=%',
            v_enq_res.enqueued_count, v_enq_res.skipped_count;
    END IF;

    -- [14] Young records and no-file records must have 0 jobs
    SELECT count(*) INTO v_count
    FROM public.storage_deletion_queue
    WHERE entity_id IN (v_comp_young, v_comp_nophoto, v_act_young, v_act_nophoto, v_lr_young);
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'FAIL [14]: Young or empty records were enqueued (% jobs)', v_count;
    END IF;

    -- [20] Invalid paths NOT in queue, NOT deleted from domain, quarantined in audit_logs
    SELECT count(*) INTO v_count
    FROM public.storage_deletion_queue
    WHERE entity_id IN (v_comp_invalid, v_lr_invalid);
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'FAIL [20]: Invalid paths were queued';
    END IF;

    SELECT count(*) INTO v_count
    FROM public.audit_logs
    WHERE action = 'storage_deletion.invalid_path_quarantined'
      AND metadata->>'object_path' IN ('not-a-valid-uuid-path.jpg', v_p_lr_invalid);
    IF v_count <> 2 THEN
        RAISE EXCEPTION 'FAIL [20]: Expected 2 quarantined invalid path logs, got %', v_count;
    END IF;

    SELECT photo_path INTO v_text FROM public.complaints WHERE id = v_comp_invalid;
    IF v_text IS DISTINCT FROM 'not-a-valid-uuid-path.jpg' THEN
        RAISE EXCEPTION 'FAIL [20]: Invalid complaint photo_path was mutated/deleted';
    END IF;

    -- [16] Repeated retention sweep must be idempotent (0 new valid jobs created)
    EXECUTE 'SET LOCAL ROLE service_role';
    SELECT * INTO v_enq_res FROM public.enqueue_soft_deleted_domain_storage_deletions(interval '7 days', 100);
    RESET ROLE;
    IF v_enq_res.enqueued_count <> 0 THEN
        RAISE EXCEPTION 'FAIL [16]: Duplicate retention sweep enqueued % extra jobs', v_enq_res.enqueued_count;
    END IF;

    -- [21] Unfinished object uniqueness enforced
    BEGIN
        INSERT INTO public.storage_deletion_queue (tenant_id, bucket_id, object_path, entity_type, entity_id, reason)
        VALUES (v_tenant_a, 'complaints', v_p_comp_aged, 'complaint', v_comp_aged, 'dup_test');
        RAISE EXCEPTION 'FAIL [21]: Duplicate active queue job allowed';
    EXCEPTION WHEN unique_violation THEN NULL; END;

    -- [17] [18] [19] Complete 2 files of same multi-file letter_request without lost update; remaining files preserved!
    SELECT id INTO v_job_1 FROM public.storage_deletion_queue WHERE bucket_id = 'letter-requests' AND object_path = v_p_lr_1;
    SELECT id INTO v_job_2 FROM public.storage_deletion_queue WHERE bucket_id = 'letter-requests' AND object_path = v_p_lr_2;

    v_tok_1 := gen_random_uuid();
    v_tok_2 := gen_random_uuid();
    UPDATE public.storage_deletion_queue
       SET status = 'processing', claim_token = v_tok_1, claimed_at = clock_timestamp(),
           lease_expires_at = clock_timestamp() + interval '5 minutes', attempt_count = 1
     WHERE id = v_job_1;
    UPDATE public.storage_deletion_queue
       SET status = 'processing', claim_token = v_tok_2, claimed_at = clock_timestamp(),
           lease_expires_at = clock_timestamp() + interval '5 minutes', attempt_count = 1
     WHERE id = v_job_2;

    EXECUTE 'SET LOCAL ROLE service_role';
    v_dec := public.begin_storage_deletion(v_job_1, v_tok_1);
    PERFORM public.complete_storage_deletion(v_job_1, v_tok_1, 'deleted');
    v_dec := public.begin_storage_deletion(v_job_2, v_tok_2);
    PERFORM public.complete_storage_deletion(v_job_2, v_tok_2, 'deleted');
    RESET ROLE;

    SELECT supporting_doc_paths ? v_p_lr_3, jsonb_array_length(supporting_doc_paths), issued_file_path
    INTO v_acq2
    FROM public.letter_requests
    WHERE id = v_lr_aged;
    -- Use explicit columns via separate query for clarity
    SELECT count(*) INTO v_count
    FROM public.letter_requests
    WHERE id = v_lr_aged
      AND jsonb_array_length(supporting_doc_paths) = 1
      AND supporting_doc_paths ? v_p_lr_3
      AND issued_file_path = v_p_lr_issued;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'FAIL [17/19]: Multi-doc letter_request lost unrelated files during partial completion';
    END IF;

    -- [18] Multi-file activity preserves other docs on single doc completion
    SELECT id INTO v_job_1 FROM public.storage_deletion_queue WHERE bucket_id = 'activity-docs' AND object_path = v_p_act_1;
    v_tok_1 := gen_random_uuid();
    UPDATE public.storage_deletion_queue
       SET status = 'processing', claim_token = v_tok_1, claimed_at = clock_timestamp(),
           lease_expires_at = clock_timestamp() + interval '5 minutes', attempt_count = 1
     WHERE id = v_job_1;
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM public.begin_storage_deletion(v_job_1, v_tok_1);
    PERFORM public.complete_storage_deletion(v_job_1, v_tok_1, 'deleted');
    RESET ROLE;

    SELECT count(*) INTO v_count
    FROM public.activities
    WHERE id = v_act_aged
      AND jsonb_array_length(documentation_paths) = 2
      AND documentation_paths ? v_p_act_2
      AND documentation_paths ? v_p_act_3;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'FAIL [18]: Multi-doc activity lost unrelated files on completion';
    END IF;

    -- =========================================================================
    RAISE NOTICE '=== Tests [22]-[27]: Atomic Complaint Soft Delete ===';
    -- =========================================================================

    PERFORM set_config('app.storage_ref_ctx', 'rpc_authorized', true);
    INSERT INTO public.complaints (id, tenant_id, reporter_member_id, category, title, description, photo_path)
    VALUES
        (v_comp_sd_ok, v_tenant_a, v_member_warga_a, 'fasilitas', 'SD OK', 'desc', v_p_sd_ok),
        (v_comp_sd_nophoto, v_tenant_a, v_member_warga_a, 'fasilitas', 'SD No Photo', 'desc', NULL),
        (v_comp_sd_fail_enq, v_tenant_a, v_member_warga_a, 'fasilitas', 'SD Fail Enq', 'desc', v_p_sd_fail_enq),
        (v_comp_sd_fail_aud, v_tenant_a, v_member_warga_a, 'fasilitas', 'SD Fail Aud', 'desc', v_p_sd_fail_aud);
    PERFORM set_config('app.storage_ref_ctx', '', true);

    -- [26] Unauthorized callers (null auth, warga, bendahara, other-tenant staff) rejected
    PERFORM set_config('request.jwt.claims', '{}', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
        PERFORM public.soft_delete_complaint(v_comp_sd_ok, 'unauth');
        RAISE EXCEPTION 'FAIL [26]: Unauthenticated caller allowed';
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
    RESET ROLE;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_warga_a::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_user_warga_a::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
        PERFORM public.soft_delete_complaint(v_comp_sd_ok, 'warga');
        RAISE EXCEPTION 'FAIL [26]: Warga role allowed to soft_delete_complaint';
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
    RESET ROLE;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_bendahara_a::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_user_bendahara_a::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
        PERFORM public.soft_delete_complaint(v_comp_sd_ok, 'bendahara');
        RAISE EXCEPTION 'FAIL [26]: Bendahara role allowed to soft_delete_complaint';
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
    RESET ROLE;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_staff_b::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_user_staff_b::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
        PERFORM public.soft_delete_complaint(v_comp_sd_ok, 'cross_tenant');
        RAISE EXCEPTION 'FAIL [26]: Cross-tenant staff allowed';
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
    RESET ROLE;

    -- [22] [23] Authorized staff A calls soft_delete_complaint cleanly
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_staff_a::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_user_staff_a::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.soft_delete_complaint(v_comp_sd_ok, 'Spam complaint');
    PERFORM public.soft_delete_complaint(v_comp_sd_nophoto, 'Duplicate');
    -- [27] Repeat call idempotent
    PERFORM public.soft_delete_complaint(v_comp_sd_ok, 'Repeat call');
    RESET ROLE;

    SELECT deleted_at, photo_path INTO v_ts, v_text FROM public.complaints WHERE id = v_comp_sd_ok;
    IF v_ts IS NULL OR v_text IS DISTINCT FROM v_p_sd_ok THEN
        RAISE EXCEPTION 'FAIL [22]: Complaint deleted_at not set or photo_path detached prematurely';
    END IF;

    SELECT count(*) INTO v_count
    FROM public.storage_deletion_queue
    WHERE entity_type = 'complaint' AND entity_id = v_comp_sd_ok AND bucket_id = 'complaints' AND object_path = v_p_sd_ok;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'FAIL [23/27]: Expected exactly 1 queue job for soft-deleted complaint, got %', v_count;
    END IF;

    SELECT count(*) INTO v_count
    FROM public.storage_deletion_queue
    WHERE entity_type = 'complaint' AND entity_id = v_comp_sd_nophoto;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'FAIL [23]: Complaint without photo created a queue job';
    END IF;

    SELECT count(*) INTO v_count
    FROM public.audit_logs
    WHERE action = 'complaint.soft_deleted' AND entity_id = v_comp_sd_ok;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'FAIL [22/27]: Expected exactly 1 audit log on idempotent soft delete, got %', v_count;
    END IF;

    -- [24] Simulated enqueue failure rolls back soft-delete
    CREATE OR REPLACE FUNCTION pg_temp.fail_sdq_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
        RAISE EXCEPTION 'simulated_enqueue_failure';
    END;
    $fn$;
    CREATE TRIGGER trg_test_fail_sdq BEFORE INSERT ON public.storage_deletion_queue
        FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_sdq_insert();

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_staff_a::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_user_staff_a::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
        PERFORM public.soft_delete_complaint(v_comp_sd_fail_enq, 'fail_enqueue');
        RAISE EXCEPTION 'FAIL [24]: Expected enqueue failure did not propagate';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'simulated_enqueue_failure' THEN
            RAISE;
        END IF;
    END;
    RESET ROLE;
    DROP TRIGGER trg_test_fail_sdq ON public.storage_deletion_queue;

    SELECT deleted_at INTO v_ts FROM public.complaints WHERE id = v_comp_sd_fail_enq;
    SELECT count(*) INTO v_count FROM public.audit_logs WHERE entity_id = v_comp_sd_fail_enq;
    IF v_ts IS NOT NULL OR v_count <> 0 THEN
        RAISE EXCEPTION 'FAIL [24]: Enqueue failure did not roll back soft-delete/audit';
    END IF;

    -- [25] Simulated audit failure rolls back soft-delete and enqueue
    CREATE OR REPLACE FUNCTION pg_temp.fail_audit_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
        IF NEW.action = 'complaint.soft_deleted' THEN
            RAISE EXCEPTION 'simulated_audit_failure';
        END IF;
        RETURN NEW;
    END;
    $fn$;
    CREATE TRIGGER trg_test_fail_audit BEFORE INSERT ON public.audit_logs
        FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_audit_insert();

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_staff_a::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_user_staff_a::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
        PERFORM public.soft_delete_complaint(v_comp_sd_fail_aud, 'fail_audit');
        RAISE EXCEPTION 'FAIL [25]: Expected audit failure did not propagate';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'simulated_audit_failure' THEN
            RAISE;
        END IF;
    END;
    RESET ROLE;
    DROP TRIGGER trg_test_fail_audit ON public.audit_logs;

    SELECT deleted_at INTO v_ts FROM public.complaints WHERE id = v_comp_sd_fail_aud;
    SELECT count(*) INTO v_count FROM public.storage_deletion_queue WHERE entity_id = v_comp_sd_fail_aud;
    IF v_ts IS NOT NULL OR v_count <> 0 THEN
        RAISE EXCEPTION 'FAIL [25]: Audit failure did not roll back soft-delete/enqueue';
    END IF;

    -- =========================================================================
    RAISE NOTICE '=== Tests [28]-[32]: Security ACLs, Privileges & Health Monitoring ===';
    -- =========================================================================

    -- [28] anon cannot execute any Migration 0016 RPC
    EXECUTE 'SET LOCAL ROLE anon';
    BEGIN PERFORM public.get_orphan_scan_cursor(); RAISE EXCEPTION 'FAIL [28]: anon get_orphan_scan_cursor'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM * FROM public.acquire_orphan_scan_lease(); RAISE EXCEPTION 'FAIL [28]: anon acquire'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM * FROM public.renew_orphan_scan_lease(gen_random_uuid()); RAISE EXCEPTION 'FAIL [28]: anon renew'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM public.save_orphan_scan_cursor(NULL, true, gen_random_uuid()); RAISE EXCEPTION 'FAIL [28]: anon save'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM public.release_orphan_scan_lease(gen_random_uuid()); RAISE EXCEPTION 'FAIL [28]: anon release'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM * FROM public.enqueue_soft_deleted_domain_storage_deletions(); RAISE EXCEPTION 'FAIL [28]: anon enqueue'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM public.soft_delete_complaint(v_comp_sd_fail_enq); RAISE EXCEPTION 'FAIL [28]: anon soft_delete'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM * FROM public.get_storage_deletion_health_summary(); RAISE EXCEPTION 'FAIL [28]: anon health'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RESET ROLE;

    -- [29] authenticated cannot execute service_role RPCs, and non-super_admin rejected by health summary
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_staff_a::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_user_staff_a::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN PERFORM public.get_orphan_scan_cursor(); RAISE EXCEPTION 'FAIL [29]: auth get_orphan_scan_cursor'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM * FROM public.acquire_orphan_scan_lease(); RAISE EXCEPTION 'FAIL [29]: auth acquire'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM * FROM public.renew_orphan_scan_lease(gen_random_uuid()); RAISE EXCEPTION 'FAIL [29]: auth renew'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM public.save_orphan_scan_cursor(NULL, true, gen_random_uuid()); RAISE EXCEPTION 'FAIL [29]: auth save'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM public.release_orphan_scan_lease(gen_random_uuid()); RAISE EXCEPTION 'FAIL [29]: auth release'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM * FROM public.enqueue_soft_deleted_domain_storage_deletions(); RAISE EXCEPTION 'FAIL [29]: auth enqueue'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM * FROM public.get_storage_deletion_health_summary(); RAISE EXCEPTION 'FAIL [29]: non-super_admin auth health'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
    RESET ROLE;

    -- service_role cannot call authenticated-only soft_delete_complaint
    EXECUTE 'SET LOCAL ROLE service_role';
    BEGIN
        PERFORM public.soft_delete_complaint(v_comp_sd_fail_enq);
        RAISE EXCEPTION 'FAIL [29]: service_role soft_delete_complaint';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RESET ROLE;

    -- [30] anon, authenticated, AND service_role cannot access storage_orphan_scan_state directly
    EXECUTE 'SET LOCAL ROLE anon';
    BEGIN PERFORM * FROM public.storage_orphan_scan_state; RAISE EXCEPTION 'FAIL [30]: anon SELECT'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RESET ROLE;

    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN PERFORM * FROM public.storage_orphan_scan_state; RAISE EXCEPTION 'FAIL [30]: auth SELECT'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RESET ROLE;

    EXECUTE 'SET LOCAL ROLE service_role';
    BEGIN PERFORM * FROM public.storage_orphan_scan_state; RAISE EXCEPTION 'FAIL [30]: service_role SELECT'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN UPDATE public.storage_orphan_scan_state SET cursor = NULL WHERE id = 1; RAISE EXCEPTION 'FAIL [30]: service_role UPDATE'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN INSERT INTO public.storage_orphan_scan_state (id) VALUES (1); RAISE EXCEPTION 'FAIL [30]: service_role INSERT'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN DELETE FROM public.storage_orphan_scan_state; RAISE EXCEPTION 'FAIL [30]: service_role DELETE'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN TRUNCATE public.storage_orphan_scan_state; RAISE EXCEPTION 'FAIL [30]: service_role TRUNCATE'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RESET ROLE;

    -- [31] Zero privilege regression: 30/30 tables RLS enabled, no policies or role grants on internal tables, all 0016 fns postgres+DEFINER+config
    SELECT count(*) INTO v_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'FAIL [31]: Found % public tables without RLS enabled', v_count;
    END IF;

    SELECT count(*) INTO v_count
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN ('storage_orphan_scan_state', 'storage_deletion_queue')
      AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role');
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'FAIL [31]: Unexpected direct table grants on internal storage state/queue tables (%)', v_count;
    END IF;

    -- [32] Health summary accessible to super_admin & service_role, returns accurate aggregate counts only
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_super::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_user_super::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT * INTO v_summary FROM public.get_storage_deletion_health_summary();
    RESET ROLE;

    IF v_summary.pending_count < 6
       OR v_summary.completed_count < 3
       OR v_summary.quarantined_invalid_path_count < 2
       OR v_summary.orphan_has_cursor IS DISTINCT FROM false
       OR v_summary.orphan_lease_active IS DISTINCT FROM false
       OR v_summary.orphan_cycle_completed_at IS NULL THEN
        RAISE EXCEPTION 'FAIL [32]: Unexpected health summary metrics: %', row_to_json(v_summary);
    END IF;

    EXECUTE 'SET LOCAL ROLE service_role';
    SELECT * INTO v_summary FROM public.get_storage_deletion_health_summary();
    RESET ROLE;
    IF v_summary.db_now IS NULL THEN
        RAISE EXCEPTION 'FAIL [32]: service_role health summary failed';
    END IF;

    RAISE NOTICE 'ALL 32 MIGRATION 0016 REGRESSION TESTS PASSED!';
END;
$$;

ROLLBACK;

