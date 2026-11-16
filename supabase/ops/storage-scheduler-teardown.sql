-- =============================================================================
-- Smart RT Storage Scheduler Teardown (Idempotent, Non-Destructive to Domain Data)
-- =============================================================================
-- Safely unschedules ONLY Smart RT storage cron jobs:
--   - smart_rt_storage_deletion_worker
--   - smart_rt_storage_orphan_scan
--
-- Optionally removes ONLY Smart RT Vault secrets when explicitly requested via:
--   -v remove_vault_secrets=true   (default: false)
--
-- NEVER touches:
--   - Unrelated pg_cron jobs or Vault secrets
--   - Migrations 0001-0016 or schema objects
--   - Domain tables, storage_deletion_queue, storage_orphan_scan_state,
--     audit_logs, or storage.objects
-- =============================================================================

\set ON_ERROR_STOP on

\if :{?remove_vault_secrets}
\else
  \set remove_vault_secrets 'false'
\endif

SELECT pg_catalog.set_config('smart_rt_ops.remove_vault_secrets', :'remove_vault_secrets', false) IS NOT NULL AS remove_flag_loaded \gset

DO $teardown$
DECLARE
    v_remove_raw text := lower(COALESCE(NULLIF(btrim(pg_catalog.current_setting('smart_rt_ops.remove_vault_secrets', true)), ''), 'false'));
    v_remove_secrets boolean;
    v_job record;
    v_unscheduled_count integer := 0;
    v_deleted_secrets integer := 0;
BEGIN
    PERFORM pg_catalog.set_config('smart_rt_ops.remove_vault_secrets', '', false);

    IF v_remove_raw IN ('true', 't', '1', 'yes', 'on') THEN
        v_remove_secrets := true;
    ELSIF v_remove_raw IN ('false', 'f', '0', 'no', 'off') THEN
        v_remove_secrets := false;
    ELSE
        RAISE EXCEPTION 'Invalid remove_vault_secrets value "%"; expected true or false', v_remove_raw;
    END IF;

    IF to_regclass('cron.job') IS NOT NULL THEN
        FOR v_job IN
            SELECT j.jobid, j.jobname
            FROM cron.job j
            WHERE j.jobname IN ('smart_rt_storage_deletion_worker', 'smart_rt_storage_orphan_scan')
            ORDER BY j.jobid
        LOOP
            PERFORM cron.unschedule(v_job.jobid);
            v_unscheduled_count := v_unscheduled_count + 1;
        END LOOP;
    END IF;

    IF v_remove_secrets AND to_regclass('vault.secrets') IS NOT NULL THEN
        DELETE FROM vault.secrets
        WHERE name IN ('STORAGE_DELETION_WORKER_SECRET', 'STORAGE_ORPHAN_SCAN_URL');
        GET DIAGNOSTICS v_deleted_secrets = ROW_COUNT;
    END IF;

    RAISE NOTICE 'Smart RT teardown complete: unscheduled % cron job(s); removed % Vault secret(s). Domain tables and queue state untouched.',
        v_unscheduled_count,
        v_deleted_secrets;
END
$teardown$;

