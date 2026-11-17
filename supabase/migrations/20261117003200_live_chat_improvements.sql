-- =============================================================================
-- Migration 0032: Live Chat Improvements
--   1. Reply to specific message (`reply_to_message_id` scoped to tenant+room)
--   2. Photo upload (`attachment_path`, `attachment_mime`, `attachment_size`) +
--      private bucket `chat-media` (5 MiB max, JPEG/PNG/WebP, strict RLS)
--   3. Unread count RPC (`get_chat_unread_count`) using `chat_message_reads`
--   4. Moderation/deletion vault support for attachments (scrubbed on hide/del)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Schema Updates: Reply Relation & Photo Attachment Columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.chat_messages
    ADD CONSTRAINT uq_chat_messages_tenant_room_id UNIQUE (tenant_id, room_id, id);

ALTER TABLE public.chat_messages
    ADD COLUMN IF NOT EXISTS reply_to_message_id uuid NULL,
    ADD COLUMN IF NOT EXISTS attachment_path text NULL,
    ADD COLUMN IF NOT EXISTS attachment_mime text NULL,
    ADD COLUMN IF NOT EXISTS attachment_size integer NULL;

ALTER TABLE public.chat_messages
    DROP CONSTRAINT IF EXISTS chk_chat_messages_content_len;

ALTER TABLE public.chat_messages
    ADD CONSTRAINT chk_chat_messages_content_len CHECK (
        (attachment_path IS NULL AND char_length(btrim(content)) BETWEEN 1 AND 2000)
        OR (attachment_path IS NOT NULL AND char_length(btrim(content)) <= 2000)
    ),
    ADD CONSTRAINT chk_chat_messages_attachment_mime CHECK (
        attachment_mime IS NULL OR attachment_mime IN ('image/jpeg', 'image/png', 'image/webp')
    ),
    ADD CONSTRAINT chk_chat_messages_attachment_size CHECK (
        attachment_size IS NULL OR (attachment_size > 0 AND attachment_size <= 5242880)
    ),
    ADD CONSTRAINT fk_chat_messages_reply_to
        FOREIGN KEY (tenant_id, room_id, reply_to_message_id)
        REFERENCES public.chat_messages (tenant_id, room_id, id)
        ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_messages_reply_to
    ON public.chat_messages (reply_to_message_id)
    WHERE reply_to_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_messages_unread
    ON public.chat_messages (tenant_id, room_id, created_at DESC)
    WHERE moderation_status = 'published';

-- Extend moderation vault so hidden photo attachments are preserved for admins
-- and scrubbed from `chat_messages` (preventing resident access).
ALTER TABLE public.chat_message_moderation_vault
    ADD COLUMN IF NOT EXISTS original_attachment_path text NULL,
    ADD COLUMN IF NOT EXISTS original_attachment_mime text NULL,
    ADD COLUMN IF NOT EXISTS original_attachment_size integer NULL;

-- ---------------------------------------------------------------------------
-- 2. Private Storage Bucket & RLS: chat-media (5 MiB Max, JPEG/PNG/WebP)
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types, versioning_status)
VALUES (
    'chat-media',
    'chat-media',
    false,
    5242880, -- 5 MiB
    ARRAY['image/jpeg', 'image/png', 'image/webp'],
    'DISABLED'
)
ON CONFLICT (id) DO UPDATE
    SET public = EXCLUDED.public,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types,
        versioning_status = EXCLUDED.versioning_status;

-- Path format: <tenant_id>/<room_id>/<member_id>/<file_uuid>.(jpg|jpeg|png|webp)
DROP POLICY IF EXISTS storage_insert_chat_media ON storage.objects;
CREATE POLICY storage_insert_chat_media
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'chat-media'
        AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
        AND public._community_extract_uuid_segment(name, 1) IS NOT NULL
        AND public._community_extract_uuid_segment(name, 2) IS NOT NULL
        AND public._community_extract_uuid_segment(name, 3) IS NOT NULL
        AND public.is_tenant_member(public._community_extract_uuid_segment(name, 1))
        AND public._community_extract_uuid_segment(name, 3) = public.get_my_member_id(public._community_extract_uuid_segment(name, 1))
        AND EXISTS (
            SELECT 1
            FROM public.chat_rooms r
            WHERE r.id = public._community_extract_uuid_segment(storage.objects.name, 2)
              AND r.tenant_id = public._community_extract_uuid_segment(storage.objects.name, 1)
              AND r.is_active = true
        )
    );

DROP POLICY IF EXISTS storage_select_chat_media ON storage.objects;
CREATE POLICY storage_select_chat_media
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'chat-media'
        AND archived_at IS NULL
        AND is_delete_marker = false
        AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
        AND public._community_extract_uuid_segment(name, 1) IS NOT NULL
        AND public._community_extract_uuid_segment(name, 2) IS NOT NULL
        AND public.is_tenant_member(public._community_extract_uuid_segment(name, 1))
        AND (
            EXISTS (
                SELECT 1
                FROM public.chat_messages m
                WHERE m.attachment_path = storage.objects.name
                  AND m.tenant_id = public._community_extract_uuid_segment(storage.objects.name, 1)
                  AND m.room_id = public._community_extract_uuid_segment(storage.objects.name, 2)
                  AND m.moderation_status = 'published'
            )
            OR (
                public.has_tenant_role(
                    public._community_extract_uuid_segment(storage.objects.name, 1),
                    ARRAY['ketua_rt', 'sekretaris', 'pengurus']
                )
                AND EXISTS (
                    SELECT 1
                    FROM public.chat_message_moderation_vault v
                    WHERE v.original_attachment_path = storage.objects.name
                      AND v.tenant_id = public._community_extract_uuid_segment(storage.objects.name, 1)
                )
            )
            OR (
                public._community_extract_uuid_segment(name, 3) = public.get_my_member_id(public._community_extract_uuid_segment(name, 1))
                AND NOT EXISTS (
                    SELECT 1
                    FROM public.chat_messages m
                    WHERE m.attachment_path = storage.objects.name
                )
                AND NOT EXISTS (
                    SELECT 1
                    FROM public.chat_message_moderation_vault v
                    WHERE v.original_attachment_path = storage.objects.name
                )
            )
        )
    );

DROP POLICY IF EXISTS storage_delete_chat_media ON storage.objects;
CREATE POLICY storage_delete_chat_media
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'chat-media'
        AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
        AND public._community_extract_uuid_segment(name, 1) IS NOT NULL
        AND public.is_tenant_member(public._community_extract_uuid_segment(name, 1))
        AND (
            public._community_extract_uuid_segment(name, 3) = public.get_my_member_id(public._community_extract_uuid_segment(name, 1))
            OR public.has_tenant_role(
                public._community_extract_uuid_segment(name, 1),
                ARRAY['ketua_rt', 'sekretaris', 'pengurus']
            )
        )
    );

-- ---------------------------------------------------------------------------
-- 3. Updated RPCs
-- ---------------------------------------------------------------------------

-- 3.1 send_chat_message (supports optional reply_to_message_id & attachment)
DROP FUNCTION IF EXISTS public.send_chat_message(uuid, uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.send_chat_message(
    p_tenant_id uuid,
    p_room_id uuid,
    p_content text,
    p_client_message_id uuid DEFAULT NULL,
    p_reply_to_message_id uuid DEFAULT NULL,
    p_attachment_path text DEFAULT NULL,
    p_attachment_mime text DEFAULT NULL,
    p_attachment_size integer DEFAULT NULL
)
RETURNS public.chat_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_member_id uuid;
    v_clean_content text := btrim(COALESCE(p_content, ''));
    v_clean_path text := NULLIF(btrim(COALESCE(p_attachment_path, '')), '');
    v_room public.chat_rooms%ROWTYPE;
    v_sender_name text;
    v_role_badge text;
    v_msg public.chat_messages%ROWTYPE;
    v_expected_prefix text;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated caller' USING ERRCODE = '28000';
    END IF;

    v_member_id := public.get_my_member_id(p_tenant_id);
    IF v_member_id IS NULL THEN
        RAISE EXCEPTION 'Forbidden: caller is not an active member of this tenant'
            USING ERRCODE = '42501';
    END IF;

    IF v_clean_path IS NULL THEN
        IF v_clean_content = '' OR char_length(v_clean_content) > 2000 THEN
            RAISE EXCEPTION 'Chat message must be between 1 and 2000 characters'
                USING ERRCODE = '22023';
        END IF;
    ELSE
        IF char_length(v_clean_content) > 2000 THEN
            RAISE EXCEPTION 'Chat caption exceeds 2000 characters'
                USING ERRCODE = '22023';
        END IF;
        v_expected_prefix := lower(p_tenant_id::text) || '/' || lower(p_room_id::text) || '/' || lower(v_member_id::text) || '/';
        IF position(v_expected_prefix IN v_clean_path) <> 1 THEN
            RAISE EXCEPTION 'Forbidden: invalid attachment ownership or scope'
                USING ERRCODE = '42501';
        END IF;
        IF p_attachment_mime NOT IN ('image/jpeg', 'image/png', 'image/webp') THEN
            RAISE EXCEPTION 'Invalid attachment MIME type' USING ERRCODE = '22023';
        END IF;
        IF p_attachment_size IS NULL OR p_attachment_size <= 0 OR p_attachment_size > 5242880 THEN
            RAISE EXCEPTION 'Invalid attachment size (max 5 MiB)' USING ERRCODE = '22023';
        END IF;
    END IF;

    SELECT * INTO v_room
    FROM public.chat_rooms
    WHERE id = p_room_id
      AND tenant_id = p_tenant_id
      AND is_active = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Chat room not found in this tenant' USING ERRCODE = 'P0002';
    END IF;

    IF p_reply_to_message_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1
            FROM public.chat_messages rm
            WHERE rm.id = p_reply_to_message_id
              AND rm.tenant_id = p_tenant_id
              AND rm.room_id = p_room_id
        ) THEN
            RAISE EXCEPTION 'Reply target message not found in this room'
                USING ERRCODE = 'P0002';
        END IF;
    END IF;

    IF p_client_message_id IS NOT NULL THEN
        SELECT * INTO v_msg
        FROM public.chat_messages m
        WHERE m.room_id = p_room_id
          AND m.sender_user_id = v_actor
          AND m.client_message_id = p_client_message_id;

        IF FOUND THEN
            RETURN v_msg;
        END IF;
    END IF;

    v_sender_name := public._community_get_member_display_name(p_tenant_id, v_member_id);
    v_role_badge := CASE
        WHEN public.has_tenant_role(p_tenant_id, ARRAY['ketua_rt', 'sekretaris', 'bendahara', 'pengurus'])
            THEN 'Pengurus'
        ELSE 'Warga'
    END;

    INSERT INTO public.chat_messages (
        tenant_id,
        room_id,
        sender_user_id,
        sender_member_id,
        sender_name,
        sender_role_badge,
        content,
        client_message_id,
        reply_to_message_id,
        attachment_path,
        attachment_mime,
        attachment_size
    )
    VALUES (
        p_tenant_id,
        p_room_id,
        v_actor,
        v_member_id,
        v_sender_name,
        v_role_badge,
        v_clean_content,
        p_client_message_id,
        p_reply_to_message_id,
        v_clean_path,
        CASE WHEN v_clean_path IS NOT NULL THEN p_attachment_mime ELSE NULL END,
        CASE WHEN v_clean_path IS NOT NULL THEN p_attachment_size ELSE NULL END
    )
    ON CONFLICT (room_id, sender_user_id, client_message_id)
    WHERE client_message_id IS NOT NULL
    DO NOTHING
    RETURNING * INTO v_msg;

    IF v_msg.id IS NULL AND p_client_message_id IS NOT NULL THEN
        SELECT * INTO v_msg
        FROM public.chat_messages m
        WHERE m.room_id = p_room_id
          AND m.sender_user_id = v_actor
          AND m.client_message_id = p_client_message_id;
    END IF;

    RETURN v_msg;
END;
$$;

ALTER FUNCTION public.send_chat_message(uuid, uuid, text, uuid, uuid, text, text, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.send_chat_message(uuid, uuid, text, uuid, uuid, text, text, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.send_chat_message(uuid, uuid, text, uuid, uuid, text, text, integer) TO authenticated;

-- 3.2 delete_own_chat_message (scrubs text + attachment metadata)
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
        attachment_path = NULL,
        attachment_mime = NULL,
        attachment_size = NULL,
        deleted_at = now(),
        updated_at = now()
    WHERE id = p_message_id
      AND tenant_id = p_tenant_id
    RETURNING * INTO v_msg;

    RETURN v_msg;
END;
$$;

-- 3.3 moderate_chat_message (archives & restores attachment metadata alongside text)
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
    v_vault public.chat_message_moderation_vault%ROWTYPE;
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
                original_attachment_path,
                original_attachment_mime,
                original_attachment_size,
                archived_by_member_id
            )
            VALUES (
                v_msg.id,
                p_tenant_id,
                v_msg.content,
                v_msg.attachment_path,
                v_msg.attachment_mime,
                v_msg.attachment_size,
                v_member_id
            )
            ON CONFLICT (message_id) DO NOTHING;
        END IF;

        UPDATE public.chat_messages
        SET moderation_status = v_next_status,
            content = 'Pesan ini disembunyikan oleh pengurus RT.',
            attachment_path = NULL,
            attachment_mime = NULL,
            attachment_size = NULL,
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

        SELECT * INTO v_vault
        FROM public.chat_message_moderation_vault v
        WHERE v.message_id = p_message_id
          AND v.tenant_id = p_tenant_id;

        UPDATE public.chat_messages
        SET moderation_status = v_next_status,
            content = COALESCE(v_vault.original_content, content),
            attachment_path = COALESCE(v_vault.original_attachment_path, attachment_path),
            attachment_mime = COALESCE(v_vault.original_attachment_mime, attachment_mime),
            attachment_size = COALESCE(v_vault.original_attachment_size, attachment_size),
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

-- 3.4 get_chat_unread_count (excludes own messages; uses chat_message_reads)
CREATE OR REPLACE FUNCTION public.get_chat_unread_count(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_member_id uuid;
    v_room_id uuid;
    v_last_read_at timestamptz;
    v_unread_count integer := 0;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated caller' USING ERRCODE = '28000';
    END IF;

    v_member_id := public.get_my_member_id(p_tenant_id);
    IF v_member_id IS NULL THEN
        RAISE EXCEPTION 'Forbidden: caller is not an active member of this tenant'
            USING ERRCODE = '42501';
    END IF;

    SELECT id INTO v_room_id
    FROM public.chat_rooms
    WHERE tenant_id = p_tenant_id
      AND is_active = true
    LIMIT 1;

    IF v_room_id IS NULL THEN
        RETURN jsonb_build_object('roomId', NULL, 'unreadCount', 0);
    END IF;

    SELECT last_read_at INTO v_last_read_at
    FROM public.chat_message_reads
    WHERE room_id = v_room_id
      AND member_id = v_member_id;

    SELECT count(*)::integer INTO v_unread_count
    FROM public.chat_messages m
    WHERE m.tenant_id = p_tenant_id
      AND m.room_id = v_room_id
      AND m.moderation_status = 'published'
      AND m.sender_user_id <> v_actor
      AND m.created_at > COALESCE(v_last_read_at, '1970-01-01T00:00:00Z'::timestamptz);

    RETURN jsonb_build_object(
        'roomId', v_room_id,
        'unreadCount', v_unread_count
    );
END;
$$;

ALTER FUNCTION public.get_chat_unread_count(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_chat_unread_count(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_chat_unread_count(uuid) TO authenticated;

COMMIT;

