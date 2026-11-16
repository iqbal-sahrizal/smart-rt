-- =============================================================================
-- Smart RT Storage Scheduler & Vault Operational Setup (Idempotent)
-- =============================================================================
-- Implements Step 10.2.2.28 / Sections 23-24 operational provisioning for:
--   1. Required PostgreSQL extensions (pg_cron, pg_net, supabase_vault)
--   2. Network & Vault privilege boundary hardening
--   3. Operational Vault secrets:
--        - STORAGE_DELETION_WORKER_SECRET (>= 32 UTF-8 bytes)
--        - STORAGE_ORPHAN_SCAN_URL (reachable from PostgreSQL / pg_net)
--   4. Optional cron job activation (ONLY after Endpoint Readiness Gate passes)
--
-- Security rules:
--   - NEVER store SUPABASE_SERVICE_ROLE_KEY in Vault or cron jobs.
--   - NEVER hardcode or echo plaintext secrets in SQL files, logs, or stdout.
--   - NEVER use placeholder values as active secrets.
--   - NEVER assume `localhost` inside Postgres container reaches host Mac; for
--     local Docker Supabase use:
--       http://supabase_kong_smart-rt:8000/functions/v1/storage-orphan-scan
--
-- Usage (local Docker Supabase; run as supabase_admin to lock net.* ACLs):
--   docker exec -i supabase_db_smart-rt psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 \
--     -v orphan_scan_url='http://supabase_kong_smart-rt:8000/functions/v1/storage-orphan-scan' \
--     -v activate_jobs=false \
--     < supabase/ops/storage-scheduler-setup.sql
--
-- When running interactively in psql, omit -v worker_secret / -v orphan_scan_url
-- to be prompted safely without storing secrets in files or shell args.
-- =============================================================================

\set ECHO none
\set ON_ERROR_STOP on

\if :{?orphan_scan_url}
\else
  \prompt 'Enter STORAGE_ORPHAN_SCAN_URL (leave blank to reuse existing Vault URL): ' orphan_scan_url
\endif

\if :{?worker_secret}
\else
  \prompt 'Enter STORAGE_DELETION_WORKER_SECRET (>= 32 bytes; leave blank ONLY if keeping valid existing Vault secret): ' worker_secret
\endif

\if :{?activate_jobs}
\else
  \set activate_jobs 'false'
\endif

-- 1. Enable required extensions in their standard environment schemas
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- Load psql variables into session settings WITHOUT printing secret values
SELECT pg_catalog.set_config('smart_rt_ops.orphan_scan_url', :'orphan_scan_url', false) IS NOT NULL AS url_param_loaded \gset
SELECT pg_catalog.set_config('smart_rt_ops.worker_secret', :'worker_secret', false) IS NOT NULL AS secret_param_loaded \gset
SELECT pg_catalog.set_config('smart_rt_ops.activate_jobs', :'activate_jobs', false) IS NOT NULL AS activate_param_loaded \gset

DO $setup$
DECLARE
    v_input_url text := NULLIF(btrim(pg_catalog.current_setting('smart_rt_ops.orphan_scan_url', true)), '');
    v_input_secret text := NULLIF(btrim(pg_catalog.current_setting('smart_rt_ops.worker_secret', true)), '');
    v_activate_raw text := lower(COALESCE(NULLIF(btrim(pg_catalog.current_setting('smart_rt_ops.activate_jobs', true)), ''), 'false'));
    v_activate_jobs boolean;

    v_existing_secret_id uuid;
    v_existing_secret_val text;
    v_existing_url_id uuid;
    v_existing_url_val text;
    v_effective_url text;
    v_effective_secret text;

    v_is_super boolean := false;
    v_net_owner name;
    v_unsafe_net_grants integer := 0;
    v_unsafe_vault_grants integer := 0;
    v_job_id bigint;
    v_job_user name := CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN 'postgres' ELSE current_user END;
BEGIN
    -- Immediately scrub transient session secret GUC
    PERFORM pg_catalog.set_config('smart_rt_ops.worker_secret', '', false);
    PERFORM pg_catalog.set_config('smart_rt_ops.orphan_scan_url', '', false);
    PERFORM pg_catalog.set_config('smart_rt_ops.activate_jobs', '', false);

    IF v_activate_raw IN ('true', 't', '1', 'yes', 'on') THEN
        v_activate_jobs := true;
    ELSIF v_activate_raw IN ('false', 'f', '0', 'no', 'off') THEN
        v_activate_jobs := false;
    ELSE
        RAISE EXCEPTION 'Invalid activate_jobs value "%"; expected true or false', v_activate_raw;
    END IF;

    -- 2. Harden pg_net privileges (and verify Vault privilege boundaries)
    SELECT rolsuper INTO v_is_super FROM pg_roles WHERE rolname = current_user;
    SELECT tableowner INTO v_net_owner
    FROM pg_tables
    WHERE schemaname = 'net' AND tablename = 'http_request_queue';

    IF v_is_super OR v_net_owner = current_user THEN
        EXECUTE 'REVOKE ALL ON TABLE net.http_request_queue FROM PUBLIC, anon, authenticated, service_role';
        EXECUTE 'REVOKE ALL ON TABLE net._http_response FROM PUBLIC, anon, authenticated, service_role';
        EXECUTE 'REVOKE ALL ON SEQUENCE net.http_request_queue_id_seq FROM PUBLIC, anon, authenticated, service_role';

        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
            EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE net.http_request_queue TO postgres';
            EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE net._http_response TO postgres';
            EXECUTE 'GRANT USAGE, SELECT, UPDATE ON SEQUENCE net.http_request_queue_id_seq TO postgres';
            EXECUTE 'GRANT USAGE ON SCHEMA net TO postgres';
            EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA net TO postgres';
        END IF;

        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_functions_admin') THEN
            EXECUTE 'GRANT USAGE ON SCHEMA net TO supabase_functions_admin';
            EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA net TO supabase_functions_admin';
        END IF;

        EXECUTE 'REVOKE USAGE ON SCHEMA net FROM PUBLIC, anon, authenticated';
        EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA net FROM PUBLIC, anon, authenticated';
    END IF;

    -- Verify net.http_request_queue and net._http_response allow ZERO access to PUBLIC/anon/authenticated/service_role
    SELECT count(*)
    INTO v_unsafe_net_grants
    FROM (
        SELECT unnest(ARRAY['PUBLIC', 'anon', 'authenticated', 'service_role']) AS r,
               unnest(ARRAY['net.http_request_queue', 'net._http_response']) AS t
    ) checks
    WHERE (
        (checks.r = 'PUBLIC' AND (
            has_table_privilege('public', checks.t, 'SELECT')
            OR has_table_privilege('public', checks.t, 'INSERT')
            OR has_table_privilege('public', checks.t, 'UPDATE')
            OR has_table_privilege('public', checks.t, 'DELETE')
        ))
        OR (checks.r <> 'PUBLIC' AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = checks.r) AND (
            has_table_privilege(checks.r, checks.t, 'SELECT')
            OR has_table_privilege(checks.r, checks.t, 'INSERT')
            OR has_table_privilege(checks.r, checks.t, 'UPDATE')
            OR has_table_privilege(checks.r, checks.t, 'DELETE')
        ))
    );

    IF v_unsafe_net_grants > 0 THEN
        RAISE EXCEPTION 'pg_net privilege hardening incomplete (unsafe table grants remain on net.http_request_queue / net._http_response). Re-run as supabase_admin or table owner "%".', v_net_owner;
    END IF;

    -- Verify Vault secrets/decrypted_secrets allow ZERO access to PUBLIC/anon/authenticated
    SELECT count(*)
    INTO v_unsafe_vault_grants
    FROM (
        SELECT unnest(ARRAY['PUBLIC', 'anon', 'authenticated']) AS r,
               unnest(ARRAY['vault.secrets', 'vault.decrypted_secrets']) AS t
    ) checks
    WHERE (
        (checks.r = 'PUBLIC' AND has_table_privilege('public', checks.t, 'SELECT'))
        OR (checks.r <> 'PUBLIC' AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = checks.r) AND has_table_privilege(checks.r, checks.t, 'SELECT'))
    );

    IF v_unsafe_vault_grants > 0 THEN
        RAISE EXCEPTION 'Vault privilege boundary violation: PUBLIC, anon, or authenticated can read vault.secrets / vault.decrypted_secrets';
    END IF;

    -- 3. Validate & idempotently upsert ONLY the 2 operational Vault secrets
    SELECT id, decrypted_secret
    INTO v_existing_url_id, v_existing_url_val
    FROM vault.decrypted_secrets
    WHERE name = 'STORAGE_ORPHAN_SCAN_URL'
    LIMIT 1;

    v_effective_url := regexp_replace(COALESCE(v_input_url, v_existing_url_val, ''), '/+$', '');
    IF v_effective_url = '' THEN
        RAISE EXCEPTION 'STORAGE_ORPHAN_SCAN_URL is required (e.g. http://supabase_kong_smart-rt:8000/functions/v1/storage-orphan-scan).';
    END IF;
    IF v_effective_url !~ '^https?://[^[:space:]]+/functions/v1/storage-orphan-scan$' THEN
        RAISE EXCEPTION 'Invalid STORAGE_ORPHAN_SCAN_URL format: must end with /functions/v1/storage-orphan-scan.';
    END IF;
    IF v_effective_url ~* '^https?://(localhost|127\.0\.0\.1)(:|/|$)' THEN
        RAISE EXCEPTION 'Unsafe STORAGE_ORPHAN_SCAN_URL: localhost/127.0.0.1 inside PostgreSQL container does not target Kong/Edge Runtime. Use http://supabase_kong_smart-rt:8000/functions/v1/storage-orphan-scan locally.';
    END IF;
    IF v_effective_url ~* '(<[^>]+>|example\.com|placeholder|your-project|replace-me)' THEN
        RAISE EXCEPTION 'Placeholder URL rejected for STORAGE_ORPHAN_SCAN_URL.';
    END IF;

    IF v_existing_url_id IS NULL THEN
        PERFORM vault.create_secret(
            v_effective_url,
            'STORAGE_ORPHAN_SCAN_URL',
            'Internal/project Edge Function URL for Smart RT storage-orphan-scan (also derives storage-deletion-worker)'
        );
    ELSIF v_input_url IS NOT NULL AND v_existing_url_val IS DISTINCT FROM v_effective_url THEN
        PERFORM vault.update_secret(
            v_existing_url_id,
            v_effective_url,
            'STORAGE_ORPHAN_SCAN_URL',
            'Internal/project Edge Function URL for Smart RT storage-orphan-scan (also derives storage-deletion-worker)'
        );
    END IF;

    SELECT id, decrypted_secret
    INTO v_existing_secret_id, v_existing_secret_val
    FROM vault.decrypted_secrets
    WHERE name = 'STORAGE_DELETION_WORKER_SECRET'
    LIMIT 1;

    v_effective_secret := COALESCE(v_input_secret, v_existing_secret_val, '');
    IF v_effective_secret = '' THEN
        RAISE EXCEPTION 'STORAGE_DELETION_WORKER_SECRET is required (>= 32 UTF-8 bytes) and no valid existing Vault secret was found.';
    END IF;
    IF octet_length(convert_to(v_effective_secret, 'UTF8')) < 32 THEN
        RAISE EXCEPTION 'STORAGE_DELETION_WORKER_SECRET must be at least 32 UTF-8 bytes.';
    END IF;
    IF v_effective_secret ~* '(changeme|placeholder|replace-me|your[-_ ]?secret|dummy|todo|<[^>]+>)' THEN
        RAISE EXCEPTION 'Placeholder pattern rejected for STORAGE_DELETION_WORKER_SECRET.';
    END IF;
    IF v_effective_secret ~ '^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+' OR v_effective_secret ~* '^sb_(secret|publishable)_' THEN
        RAISE EXCEPTION 'Supabase API/service_role keys must NEVER be stored as STORAGE_DELETION_WORKER_SECRET.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM vault.secrets
        WHERE lower(name) IN ('supabase_service_role_key', 'service_role_key')
    ) THEN
        RAISE EXCEPTION 'Prohibited SUPABASE_SERVICE_ROLE_KEY entry detected in vault.secrets.';
    END IF;

    IF v_existing_secret_id IS NULL THEN
        PERFORM vault.create_secret(
            v_effective_secret,
            'STORAGE_DELETION_WORKER_SECRET',
            'Internal Bearer secret (>= 32B) for Smart RT storage-deletion-worker & storage-orphan-scan'
        );
    ELSIF v_input_secret IS NOT NULL AND v_existing_secret_val IS DISTINCT FROM v_effective_secret THEN
        PERFORM vault.update_secret(
            v_existing_secret_id,
            v_effective_secret,
            'STORAGE_DELETION_WORKER_SECRET',
            'Internal Bearer secret (>= 32B) for Smart RT storage-deletion-worker & storage-orphan-scan'
        );
    END IF;

    -- 4. Schedule cron jobs ONLY when explicitly activated (after Endpoint Readiness Gate passes)
    IF v_activate_jobs THEN
        FOR v_job_id IN
            SELECT j.jobid
            FROM cron.job j
            WHERE j.jobname IN ('smart_rt_storage_deletion_worker', 'smart_rt_storage_orphan_scan')
        LOOP
            PERFORM cron.unschedule(v_job_id);
        END LOOP;

        PERFORM cron.schedule_in_database(
            job_name := 'smart_rt_storage_deletion_worker',
            schedule := '*/5 * * * *',
            command := $cmd$
SELECT net.http_post(
    url := (
        SELECT regexp_replace(decrypted_secret, '/storage-orphan-scan/?$', '/storage-deletion-worker')
        FROM vault.decrypted_secrets
        WHERE name = 'STORAGE_ORPHAN_SCAN_URL'
        LIMIT 1
    ),
    headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'STORAGE_DELETION_WORKER_SECRET'
            LIMIT 1
        )
    ),
    body := '{"mode":"process"}'::jsonb,
    timeout_milliseconds := 120000
);
$cmd$,
            database := current_database(),
            username := v_job_user,
            active := true
        );

        PERFORM cron.schedule_in_database(
            job_name := 'smart_rt_storage_orphan_scan',
            schedule := '*/15 * * * *',
            command := $cmd$
SELECT net.http_post(
    url := (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'STORAGE_ORPHAN_SCAN_URL'
        LIMIT 1
    ),
    headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'STORAGE_DELETION_WORKER_SECRET'
            LIMIT 1
        )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
);
$cmd$,
            database := current_database(),
            username := v_job_user,
            active := true
        );

        RAISE NOTICE 'Smart RT scheduler jobs ACTIVATED (smart_rt_storage_deletion_worker every 5m, smart_rt_storage_orphan_scan every 15m).';
    ELSE
        RAISE NOTICE 'Smart RT extensions, net/vault privileges, and Vault secrets configured. Cron jobs NOT activated (activate_jobs=false).';
    END IF;
END
$setup$;

