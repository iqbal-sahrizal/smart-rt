-- =============================================================================
-- Central Notification Engine — Single-Use Nonce Auth for pg_cron -> Edge Worker
--
-- Allows pg_cron (executing inside Postgres as postgres) to authenticate
-- `mode: "process_outbox"` calls to `send-fcm-notification` via pg_net without
-- storing static Bearer secrets or service_role keys in Vault or net queues.
-- Direct push requests to `send-fcm-notification` continue to require
-- `Authorization: Bearer <FCM_FUNCTION_SECRET>`.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.notification_dispatch_nonces (
    nonce_hash text PRIMARY KEY,
    expires_at timestamptz NOT NULL,
    used_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_dispatch_nonces ENABLE ROW LEVEL SECURITY;
-- Zero policies for anon/authenticated (deny-by-default).

REVOKE ALL ON TABLE public.notification_dispatch_nonces FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_notification_dispatch_nonce(p_nonce text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
    v_clean text := NULLIF(btrim(COALESCE(p_nonce, '')), '');
    v_hash text;
    v_consumed boolean := false;
BEGIN
    IF v_clean IS NULL OR char_length(v_clean) < 32 THEN
        RETURN false;
    END IF;

    DELETE FROM public.notification_dispatch_nonces
    WHERE expires_at < now() - interval '5 minutes';

    v_hash := encode(sha256(convert_to(v_clean, 'UTF8')), 'hex');

    UPDATE public.notification_dispatch_nonces
    SET used_at = now()
    WHERE nonce_hash = v_hash
      AND used_at IS NULL
      AND expires_at > now()
    RETURNING true INTO v_consumed;

    RETURN COALESCE(v_consumed, false);
END;
$$;

ALTER FUNCTION public.consume_notification_dispatch_nonce(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.consume_notification_dispatch_nonce(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_notification_dispatch_nonce(text) TO service_role;

CREATE OR REPLACE FUNCTION public.dispatch_notification_outbox_cron()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault, pg_temp
AS $$
DECLARE
    v_has_work boolean := false;
    v_url text;
    v_nonce text;
    v_hash text;
    v_request_id bigint;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM public.notification_outbox
        WHERE (status IN ('pending', 'failed') AND next_attempt_at <= now())
           OR (
               status = 'processing'
               AND lease_expires_at IS NOT NULL
               AND lease_expires_at <= now()
           )
    ) INTO v_has_work;

    IF NOT v_has_work THEN
        RETURN 'idle';
    END IF;

    SELECT decrypted_secret
    INTO v_url
    FROM vault.decrypted_secrets
    WHERE name = 'NOTIFICATION_DISPATCHER_URL'
    LIMIT 1;

    IF COALESCE(btrim(v_url), '') = '' THEN
        RETURN 'missing_vault_url';
    END IF;

    v_nonce := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    v_hash := encode(sha256(convert_to(v_nonce, 'UTF8')), 'hex');

    INSERT INTO public.notification_dispatch_nonces (nonce_hash, expires_at)
    VALUES (v_hash, now() + interval '90 seconds');

    SELECT net.http_post(
        url := v_url,
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'X-Outbox-Dispatch-Nonce', v_nonce
        ),
        body := '{"mode":"process_outbox","limit":50,"lease_seconds":120}'::jsonb,
        timeout_milliseconds := 15000
    ) INTO v_request_id;

    RETURN 'dispatched:' || COALESCE(v_request_id::text, '0');
END;
$$;

ALTER FUNCTION public.dispatch_notification_outbox_cron() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.dispatch_notification_outbox_cron() FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

