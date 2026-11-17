-- =============================================================================
-- Migration 0031: Harden Live Chat moderated/deleted content privacy at DB level
--
-- Fixes security exposure where original `chat_messages.content` remained
-- readable by residents via direct SELECT, API, or Realtime `postgres_changes`
-- payloads (including `REPLICA IDENTITY FULL` old_record) after hide/delete.
--
-- Guarantees:
--   1. Sender-deleted messages permanently overwrite `chat_messages.content`
--      with placeholder text at the DB level (no recovery needed).
--   2. Moderator-hidden messages move original `content` into a moderator-only
--      table `public.chat_message_moderation_vault` (RLS restricted to active
--      `ketua_rt`, `sekretaris`, `pengurus` of that tenant; `warga` & `bendahara`
--      denied) and overwrite `chat_messages.content` with placeholder text.
--   3. Moderator restore reads original `content` from vault back into
--      `chat_messages.content` and deletes the vault row.
--   4. `REPLICA IDENTITY DEFAULT` on `public.chat_messages` ensures `UPDATE`
--      Realtime WAL events only emit `{ id }` in `old_record`, never old text.
-- =============================================================================

BEGIN;

-- 1. Create moderator-only vault table for hidden message recovery
CREATE TABLE public.chat_message_moderation_vault (
    message_id uuid PRIMARY KEY REFERENCES public.chat_messages (id) ON DELETE CASCADE,
    tenant_id uuid NOT NULL,
    original_content text NOT NULL,
    archived_by_member_id uuid NULL,
    archived_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_chat_mod_vault_moderator
        FOREIGN KEY (tenant_id, archived_by_member_id)
        REFERENCES public.tenant_members (tenant_id, id)
        ON DELETE SET NULL
);

CREATE INDEX idx_chat_mod_vault_tenant
    ON public.chat_message_moderation_vault (tenant_id, message_id);

ALTER TABLE public.chat_message_moderation_vault ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.chat_message_moderation_vault FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.chat_message_moderation_vault TO authenticated;

CREATE POLICY chat_mod_vault_select_moderator
    ON public.chat_message_moderation_vault
    FOR SELECT
    TO authenticated
    USING (
        public.has_tenant_role(
            tenant_id,
            ARRAY['ketua_rt', 'sekretaris', 'pengurus']
        )
    );

-- 2. Backfill & scrub any pre-existing hidden/deleted rows
INSERT INTO public.chat_message_moderation_vault (
    message_id,
    tenant_id,
    original_content,
    archived_by_member_id
)
SELECT
    m.id,
    m.tenant_id,
    m.content,
    m.moderated_by_member_id
FROM public.chat_messages m
WHERE m.moderation_status = 'hidden_by_moderator'
  AND m.content <> 'Pesan ini disembunyikan oleh pengurus RT.'
ON CONFLICT (message_id) DO NOTHING;

UPDATE public.chat_messages
SET content = 'Pesan ini disembunyikan oleh pengurus RT.'
WHERE moderation_status = 'hidden_by_moderator'
  AND content <> 'Pesan ini disembunyikan oleh pengurus RT.';

UPDATE public.chat_messages
SET content = 'Pesan ini telah dihapus oleh pengirim.'
WHERE moderation_status = 'deleted_by_sender'
  AND content <> 'Pesan ini telah dihapus oleh pengirim.';

-- 3. Switch chat_messages to REPLICA IDENTITY DEFAULT so Realtime UPDATE
--    WAL `old_record` never includes old `content` plaintext.
ALTER TABLE public.chat_messages REPLICA IDENTITY DEFAULT;

-- 4. Harden delete_own_chat_message to scrub content in database
CREATE OR REPLACE FUNCTION public.delete_own_chat_message(
    p_tenant_id uuid,
    p_message_id uuid
)
RETURNS public.chat_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_member_id uuid;
    v_msg public.chat_messages%ROWTYPE;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated caller' USING ERRCODE = '28000';
    END IF;

    v_member_id := public.get_my_member_id(p_tenant_id);
    IF v_member_id IS NULL THEN
        RAISE EXCEPTION 'Forbidden: caller is not an active member of this tenant'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_msg
    FROM public.chat_messages m
    WHERE m.id = p_message_id
      AND m.tenant_id = p_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Chat message not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_msg.sender_user_id IS DISTINCT FROM v_actor THEN
        RAISE EXCEPTION 'Forbidden: only the sender can delete this message'
            USING ERRCODE = '42501';
    END IF;

    IF v_msg.moderation_status <> 'published' THEN
        RETURN v_msg;
    END IF;

    UPDATE public.chat_messages
    SET moderation_status = 'deleted_by_sender',
        content = 'Pesan ini telah dihapus oleh pengirim.',
        deleted_at = now(),
        updated_at = now()
    WHERE id = p_message_id
      AND tenant_id = p_tenant_id
    RETURNING * INTO v_msg;

    RETURN v_msg;
END;
$$;

-- 5. Harden moderate_chat_message to archive original content into moderator-only
--    vault on hide, scrub `chat_messages.content`, and restore from vault on restore.
CREATE OR REPLACE FUNCTION public.moderate_chat_message(
    p_tenant_id uuid,
    p_message_id uuid,
    p_action text,
    p_reason text DEFAULT NULL
)
RETURNS public.chat_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_member_id uuid;
    v_msg public.chat_messages%ROWTYPE;
    v_clean_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
    v_next_status text;
    v_restored_content text;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated caller' USING ERRCODE = '28000';
    END IF;

    IF NOT public.has_tenant_role(p_tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus']) THEN
        RAISE EXCEPTION 'Forbidden: only Ketua RT, Sekretaris, or Pengurus may moderate chat messages'
            USING ERRCODE = '42501';
    END IF;

    v_member_id := public.get_my_member_id(p_tenant_id);
    IF v_member_id IS NULL THEN
        RAISE EXCEPTION 'Forbidden: caller is not an active member of this tenant'
            USING ERRCODE = '42501';
    END IF;

    IF p_action NOT IN ('hide', 'restore') THEN
        RAISE EXCEPTION 'Invalid moderation action' USING ERRCODE = '22023';
    END IF;

    IF p_action = 'hide' AND (v_clean_reason IS NULL OR char_length(v_clean_reason) < 3) THEN
        RAISE EXCEPTION 'Moderation reason is required (minimum 3 characters) when hiding a message'
            USING ERRCODE = '22023';
    END IF;

    IF v_clean_reason IS NOT NULL AND char_length(v_clean_reason) > 500 THEN
        RAISE EXCEPTION 'Moderation reason exceeds 500 characters' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_msg
    FROM public.chat_messages m
    WHERE m.id = p_message_id
      AND m.tenant_id = p_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Chat message not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_msg.moderation_status = 'deleted_by_sender' THEN
        RAISE EXCEPTION 'Cannot moderate a message already deleted by sender'
            USING ERRCODE = '22023';
    END IF;

    IF p_action = 'hide' THEN
        v_next_status := 'hidden_by_moderator';

        IF v_msg.moderation_status <> 'hidden_by_moderator' THEN
            INSERT INTO public.chat_message_moderation_vault (
                message_id,
                tenant_id,
                original_content,
                archived_by_member_id
            )
            VALUES (
                v_msg.id,
                p_tenant_id,
                v_msg.content,
                v_member_id
            )
            ON CONFLICT (message_id) DO NOTHING;
        END IF;

        UPDATE public.chat_messages
        SET moderation_status = v_next_status,
            content = 'Pesan ini disembunyikan oleh pengurus RT.',
            moderated_by_member_id = v_member_id,
            moderated_at = now(),
            moderation_reason = v_clean_reason,
            deleted_at = COALESCE(deleted_at, now()),
            updated_at = now()
        WHERE id = p_message_id
          AND tenant_id = p_tenant_id
        RETURNING * INTO v_msg;
    ELSE
        v_next_status := 'published';

        SELECT v.original_content INTO v_restored_content
        FROM public.chat_message_moderation_vault v
        WHERE v.message_id = p_message_id
          AND v.tenant_id = p_tenant_id;

        UPDATE public.chat_messages
        SET moderation_status = v_next_status,
            content = COALESCE(v_restored_content, content),
            moderated_by_member_id = v_member_id,
            moderated_at = now(),
            moderation_reason = v_clean_reason,
            deleted_at = NULL,
            updated_at = now()
        WHERE id = p_message_id
          AND tenant_id = p_tenant_id
        RETURNING * INTO v_msg;

        DELETE FROM public.chat_message_moderation_vault
        WHERE message_id = p_message_id
          AND tenant_id = p_tenant_id;
    END IF;

    INSERT INTO public.audit_logs (
        tenant_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
    )
    VALUES (
        p_tenant_id,
        v_actor,
        'chat_message.moderated_' || p_action,
        'chat_messages',
        p_message_id,
        jsonb_build_object(
            'room_id', v_msg.room_id,
            'message_id', p_message_id,
            'action', p_action,
            'moderation_status', v_next_status,
            'moderator_member_id', v_member_id,
            'has_reason', (v_clean_reason IS NOT NULL)
        )
    );

    RETURN v_msg;
END;
$$;

COMMIT;

