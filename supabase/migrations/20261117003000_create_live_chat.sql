-- =============================================================================
-- Migration 0030: Smart RT Live Chat — MVP
--
-- Entities:
--   1. public.chat_rooms          (one tenant-scoped group room per RT)
--   2. public.chat_messages       (realtime text messages + moderation + soft-delete)
--   3. public.chat_message_reads  (per-member read watermark)
--
-- Security model:
--   - Strict tenant isolation via is_active_tenant_member(tenant_id) + composite FKs.
--   - Direct INSERT/UPDATE/DELETE revoked on chat_rooms & chat_messages from anon/authenticated;
--     all mutations run via SECURITY DEFINER RPCs deriving sender from auth.uid()
--     and get_my_member_id(p_tenant_id).
--   - Moderation strictly restricted to ketua_rt, sekretaris, pengurus (bendahara denied).
--   - Supabase Realtime enabled ONLY on public.chat_messages (REPLICA IDENTITY FULL).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.chat_rooms (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants (id) ON DELETE CASCADE,
    slug text NOT NULL DEFAULT 'warga-umum',
    name text NOT NULL DEFAULT 'Live Chat Warga',
    description text NOT NULL DEFAULT 'Grup percakapan realtime seluruh warga dalam satu RT',
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_chat_rooms_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT chk_chat_rooms_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 100)
);

CREATE TABLE public.chat_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    room_id uuid NOT NULL,
    sender_user_id uuid NOT NULL,
    sender_member_id uuid NOT NULL,
    sender_name text NOT NULL,
    sender_role_badge text NULL,
    content text NOT NULL,
    client_message_id uuid NULL,
    moderation_status text NOT NULL DEFAULT 'published'
        CONSTRAINT chk_chat_messages_mod_status CHECK (
            moderation_status IN ('published', 'deleted_by_sender', 'hidden_by_moderator')
        ),
    moderated_by_member_id uuid NULL,
    moderated_at timestamptz NULL,
    moderation_reason text NULL
        CONSTRAINT chk_chat_messages_mod_reason_len CHECK (
            moderation_reason IS NULL OR char_length(moderation_reason) <= 500
        ),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz NULL,
    CONSTRAINT chk_chat_messages_content_len CHECK (
        char_length(btrim(content)) BETWEEN 1 AND 2000
    ),
    CONSTRAINT fk_chat_messages_room
        FOREIGN KEY (tenant_id, room_id)
        REFERENCES public.chat_rooms (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_chat_messages_sender_user
        FOREIGN KEY (tenant_id, sender_user_id)
        REFERENCES public.tenant_members (tenant_id, user_id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_chat_messages_sender_member
        FOREIGN KEY (tenant_id, sender_member_id)
        REFERENCES public.tenant_members (tenant_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_chat_messages_moderator
        FOREIGN KEY (tenant_id, moderated_by_member_id)
        REFERENCES public.tenant_members (tenant_id, id)
        ON DELETE SET NULL
);

CREATE INDEX idx_chat_messages_room_timeline
    ON public.chat_messages (tenant_id, room_id, created_at DESC, id DESC);

CREATE UNIQUE INDEX uq_chat_messages_client_dedup
    ON public.chat_messages (room_id, sender_user_id, client_message_id)
    WHERE client_message_id IS NOT NULL;

CREATE TABLE public.chat_message_reads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    room_id uuid NOT NULL,
    member_id uuid NOT NULL,
    last_read_message_id uuid NULL REFERENCES public.chat_messages (id) ON DELETE SET NULL,
    last_read_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_chat_message_reads_room_member UNIQUE (room_id, member_id),
    CONSTRAINT fk_chat_message_reads_room
        FOREIGN KEY (tenant_id, room_id)
        REFERENCES public.chat_rooms (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_chat_message_reads_member
        FOREIGN KEY (tenant_id, member_id)
        REFERENCES public.tenant_members (tenant_id, id)
        ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- 2. RLS & Table Grants
-- ---------------------------------------------------------------------------

ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_message_reads ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.chat_rooms FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.chat_rooms TO authenticated;

REVOKE ALL ON TABLE public.chat_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.chat_messages TO authenticated;

REVOKE ALL ON TABLE public.chat_message_reads FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.chat_message_reads TO authenticated;

CREATE POLICY chat_rooms_select_member
    ON public.chat_rooms
    FOR SELECT
    TO authenticated
    USING (public.is_tenant_member(tenant_id));

CREATE POLICY chat_messages_select_member
    ON public.chat_messages
    FOR SELECT
    TO authenticated
    USING (public.is_tenant_member(tenant_id));

CREATE POLICY chat_message_reads_select_own
    ON public.chat_message_reads
    FOR SELECT
    TO authenticated
    USING (
        public.is_tenant_member(tenant_id)
        AND member_id = public.get_my_member_id(tenant_id)
    );

CREATE POLICY chat_message_reads_insert_own
    ON public.chat_message_reads
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_tenant_member(tenant_id)
        AND member_id = public.get_my_member_id(tenant_id)
    );

CREATE POLICY chat_message_reads_update_own
    ON public.chat_message_reads
    FOR UPDATE
    TO authenticated
    USING (
        public.is_tenant_member(tenant_id)
        AND member_id = public.get_my_member_id(tenant_id)
    )
    WITH CHECK (
        public.is_tenant_member(tenant_id)
        AND member_id = public.get_my_member_id(tenant_id)
    );

-- ---------------------------------------------------------------------------
-- 3. Realtime Publication (chat_messages ONLY)
-- ---------------------------------------------------------------------------

ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;

DO $pub$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = 'chat_messages'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
        END IF;
    END IF;
END;
$pub$;

-- ---------------------------------------------------------------------------
-- 4. SECURITY DEFINER RPCs
-- ---------------------------------------------------------------------------

-- 4.1 ensure_tenant_chat_room
CREATE OR REPLACE FUNCTION public.ensure_tenant_chat_room(p_tenant_id uuid)
RETURNS public.chat_rooms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_member_id uuid;
    v_room public.chat_rooms%ROWTYPE;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated caller' USING ERRCODE = '28000';
    END IF;

    v_member_id := public.get_my_member_id(p_tenant_id);
    IF v_member_id IS NULL THEN
        RAISE EXCEPTION 'Forbidden: caller is not an active member of this tenant'
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.chat_rooms (tenant_id)
    VALUES (p_tenant_id)
    ON CONFLICT (tenant_id) DO NOTHING;

    SELECT * INTO v_room
    FROM public.chat_rooms
    WHERE tenant_id = p_tenant_id;

    RETURN v_room;
END;
$$;

ALTER FUNCTION public.ensure_tenant_chat_room(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ensure_tenant_chat_room(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_tenant_chat_room(uuid) TO authenticated;

-- 4.2 send_chat_message (sender always derived from auth.uid(); deduplicated via client_message_id)
CREATE OR REPLACE FUNCTION public.send_chat_message(
    p_tenant_id uuid,
    p_room_id uuid,
    p_content text,
    p_client_message_id uuid DEFAULT NULL
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
    v_room public.chat_rooms%ROWTYPE;
    v_sender_name text;
    v_role_badge text;
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

    IF v_clean_content = '' OR char_length(v_clean_content) > 2000 THEN
        RAISE EXCEPTION 'Chat message must be between 1 and 2000 characters'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_room
    FROM public.chat_rooms
    WHERE id = p_room_id
      AND tenant_id = p_tenant_id
      AND is_active = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Chat room not found in this tenant' USING ERRCODE = 'P0002';
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
        client_message_id
    )
    VALUES (
        p_tenant_id,
        p_room_id,
        v_actor,
        v_member_id,
        v_sender_name,
        v_role_badge,
        v_clean_content,
        p_client_message_id
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

ALTER FUNCTION public.send_chat_message(uuid, uuid, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.send_chat_message(uuid, uuid, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.send_chat_message(uuid, uuid, text, uuid) TO authenticated;

-- 4.3 delete_own_chat_message (sender soft-deletes own message)
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
        deleted_at = now(),
        updated_at = now()
    WHERE id = p_message_id
      AND tenant_id = p_tenant_id
    RETURNING * INTO v_msg;

    RETURN v_msg;
END;
$$;

ALTER FUNCTION public.delete_own_chat_message(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.delete_own_chat_message(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_own_chat_message(uuid, uuid) TO authenticated;

-- 4.4 moderate_chat_message (ketua_rt, sekretaris, pengurus ONLY — NO bendahara)
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

    v_next_status := CASE WHEN p_action = 'hide' THEN 'hidden_by_moderator' ELSE 'published' END;

    UPDATE public.chat_messages
    SET moderation_status = v_next_status,
        moderated_by_member_id = v_member_id,
        moderated_at = now(),
        moderation_reason = v_clean_reason,
        deleted_at = CASE WHEN p_action = 'hide' THEN COALESCE(deleted_at, now()) ELSE NULL END,
        updated_at = now()
    WHERE id = p_message_id
      AND tenant_id = p_tenant_id
    RETURNING * INTO v_msg;

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

ALTER FUNCTION public.moderate_chat_message(uuid, uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.moderate_chat_message(uuid, uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.moderate_chat_message(uuid, uuid, text, text) TO authenticated;

-- 4.5 mark_chat_room_read
CREATE OR REPLACE FUNCTION public.mark_chat_room_read(
    p_tenant_id uuid,
    p_room_id uuid,
    p_last_read_message_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_member_id uuid;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated caller' USING ERRCODE = '28000';
    END IF;

    v_member_id := public.get_my_member_id(p_tenant_id);
    IF v_member_id IS NULL THEN
        RAISE EXCEPTION 'Forbidden: caller is not an active member of this tenant'
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.chat_message_reads (tenant_id, room_id, member_id, last_read_message_id, last_read_at)
    VALUES (p_tenant_id, p_room_id, v_member_id, p_last_read_message_id, now())
    ON CONFLICT (room_id, member_id)
    DO UPDATE SET
        last_read_message_id = COALESCE(EXCLUDED.last_read_message_id, public.chat_message_reads.last_read_message_id),
        last_read_at = now();
END;
$$;

ALTER FUNCTION public.mark_chat_room_read(uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mark_chat_room_read(uuid, uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mark_chat_room_read(uuid, uuid, uuid) TO authenticated;

COMMIT;
