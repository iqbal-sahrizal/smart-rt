-- =============================================================================
-- Migration 0025: Resident Community Feed Domain
-- Step: Resident Community Feed (Posts, Media, Likes, Comments, Reports & Moderation)
-- =============================================================================
-- Creates tenant-scoped Community Feed schema, Storage bucket & policies,
-- RLS policies, audit logging, notification integration, and atomic RPCs.
--
-- Entities:
--   1. public.community_posts
--   2. public.community_post_media
--   3. public.community_post_likes
--   4. public.community_post_comments
--   5. public.community_post_reports
-- Storage:
--   - Bucket: community-media (private, max 5 MiB, jpeg/png/webp only)
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. Safe UUID Segment Extractor for Storage Policies
-- =============================================================================
CREATE OR REPLACE FUNCTION public._community_extract_uuid_segment(
    p_path text,
    p_segment integer
)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_part text;
BEGIN
    IF p_path IS NULL OR p_segment < 1 THEN
        RETURN NULL;
    END IF;
    v_part := split_part(p_path, '/', p_segment);
    IF v_part ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN v_part::uuid;
    END IF;
    RETURN NULL;
END;
$$;

ALTER FUNCTION public._community_extract_uuid_segment(text, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._community_extract_uuid_segment(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._community_extract_uuid_segment(text, integer) TO authenticated, service_role;

-- =============================================================================
-- 2. Tables
-- =============================================================================

-- 2.1 community_posts
CREATE TABLE public.community_posts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    author_member_id uuid NOT NULL,
    caption text NULL,
    media_count smallint NOT NULL DEFAULT 0,
    like_count integer NOT NULL DEFAULT 0,
    comment_count integer NOT NULL DEFAULT 0,
    moderation_status text NOT NULL DEFAULT 'published'
        CONSTRAINT chk_community_posts_mod_status CHECK (
            moderation_status IN ('published', 'hidden')
        ),
    moderated_by_member_id uuid NULL,
    moderated_at timestamptz NULL,
    moderation_reason text NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz NULL,
    CONSTRAINT uq_community_posts_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_community_posts_author
        FOREIGN KEY (tenant_id, author_member_id)
        REFERENCES public.tenant_members (tenant_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_community_posts_moderator
        FOREIGN KEY (tenant_id, moderated_by_member_id)
        REFERENCES public.tenant_members (tenant_id, id)
        ON DELETE SET NULL,
    CONSTRAINT chk_community_posts_caption_len CHECK (
        caption IS NULL OR char_length(caption) <= 2200
    ),
    CONSTRAINT chk_community_posts_media_count CHECK (
        media_count >= 0 AND media_count <= 4
    ),
    CONSTRAINT chk_community_posts_like_count CHECK (like_count >= 0),
    CONSTRAINT chk_community_posts_comment_count CHECK (comment_count >= 0),
    CONSTRAINT chk_community_posts_non_empty CHECK (
        media_count > 0 OR (caption IS NOT NULL AND btrim(caption) <> '')
    ),
    CONSTRAINT chk_community_posts_mod_reason_len CHECK (
        moderation_reason IS NULL OR char_length(moderation_reason) <= 500
    )
);

CREATE INDEX idx_community_posts_tenant_feed
    ON public.community_posts (tenant_id, created_at DESC, id DESC)
    WHERE deleted_at IS NULL AND moderation_status = 'published';

CREATE INDEX idx_community_posts_tenant_author
    ON public.community_posts (tenant_id, author_member_id, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_community_posts_tenant_moderation
    ON public.community_posts (tenant_id, moderation_status, created_at DESC)
    WHERE deleted_at IS NULL;

-- 2.2 community_post_media
CREATE TABLE public.community_post_media (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    post_id uuid NOT NULL,
    storage_path text NOT NULL UNIQUE,
    mime_type text NOT NULL
        CONSTRAINT chk_community_post_media_mime CHECK (
            mime_type IN ('image/jpeg', 'image/png', 'image/webp')
        ),
    file_size_bytes integer NOT NULL
        CONSTRAINT chk_community_post_media_size CHECK (
            file_size_bytes > 0 AND file_size_bytes <= 5242880
        ),
    sort_order smallint NOT NULL DEFAULT 0
        CONSTRAINT chk_community_post_media_order CHECK (
            sort_order >= 0 AND sort_order < 4
        ),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_community_post_media_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_community_post_media_post_order UNIQUE (post_id, sort_order) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT fk_community_post_media_post
        FOREIGN KEY (tenant_id, post_id)
        REFERENCES public.community_posts (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT chk_community_post_media_path_format CHECK (
        storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
    ),
    CONSTRAINT chk_community_post_media_tenant_segment CHECK (
        split_part(storage_path, '/', 1) = tenant_id::text
    )
);

CREATE INDEX idx_community_post_media_post
    ON public.community_post_media (tenant_id, post_id, sort_order);

-- 2.3 community_post_likes
CREATE TABLE public.community_post_likes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    post_id uuid NOT NULL,
    member_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_community_post_likes_post_member UNIQUE (post_id, member_id),
    CONSTRAINT fk_community_post_likes_post
        FOREIGN KEY (tenant_id, post_id)
        REFERENCES public.community_posts (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_community_post_likes_member
        FOREIGN KEY (tenant_id, member_id)
        REFERENCES public.tenant_members (tenant_id, id)
        ON DELETE CASCADE
);

CREATE INDEX idx_community_post_likes_tenant_post
    ON public.community_post_likes (tenant_id, post_id);

CREATE INDEX idx_community_post_likes_member_post
    ON public.community_post_likes (tenant_id, member_id, post_id);

-- 2.4 community_post_comments
CREATE TABLE public.community_post_comments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    post_id uuid NOT NULL,
    author_member_id uuid NOT NULL,
    parent_comment_id uuid NULL,
    content text NOT NULL
        CONSTRAINT chk_community_comments_content CHECK (
            btrim(content) <> '' AND char_length(btrim(content)) <= 1000
        ),
    moderation_status text NOT NULL DEFAULT 'published'
        CONSTRAINT chk_community_comments_mod_status CHECK (
            moderation_status IN ('published', 'hidden')
        ),
    moderated_by_member_id uuid NULL,
    moderated_at timestamptz NULL,
    moderation_reason text NULL
        CONSTRAINT chk_community_comments_mod_reason CHECK (
            moderation_reason IS NULL OR char_length(moderation_reason) <= 500
        ),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz NULL,
    CONSTRAINT uq_community_post_comments_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_community_comments_post
        FOREIGN KEY (tenant_id, post_id)
        REFERENCES public.community_posts (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_community_comments_author
        FOREIGN KEY (tenant_id, author_member_id)
        REFERENCES public.tenant_members (tenant_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_community_comments_parent
        FOREIGN KEY (tenant_id, parent_comment_id)
        REFERENCES public.community_post_comments (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_community_comments_moderator
        FOREIGN KEY (tenant_id, moderated_by_member_id)
        REFERENCES public.tenant_members (tenant_id, id)
        ON DELETE SET NULL,
    CONSTRAINT chk_community_comments_no_self_parent CHECK (
        parent_comment_id IS NULL OR parent_comment_id <> id
    )
);

CREATE INDEX idx_community_comments_post_created
    ON public.community_post_comments (tenant_id, post_id, created_at ASC, id ASC)
    WHERE deleted_at IS NULL AND moderation_status = 'published';

CREATE INDEX idx_community_comments_parent
    ON public.community_post_comments (tenant_id, parent_comment_id)
    WHERE deleted_at IS NULL;

-- 2.5 community_post_reports
CREATE TABLE public.community_post_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    reporter_member_id uuid NOT NULL,
    target_type text NOT NULL
        CONSTRAINT chk_community_reports_target_type CHECK (
            target_type IN ('post', 'comment')
        ),
    post_id uuid NULL,
    comment_id uuid NULL,
    reason_category text NOT NULL
        CONSTRAINT chk_community_reports_category CHECK (
            reason_category IN (
                'spam',
                'harassment',
                'inappropriate',
                'misinformation',
                'privacy',
                'other'
            )
        ),
    reason_detail text NULL
        CONSTRAINT chk_community_reports_detail_len CHECK (
            reason_detail IS NULL OR char_length(btrim(reason_detail)) <= 500
        ),
    status text NOT NULL DEFAULT 'pending'
        CONSTRAINT chk_community_reports_status CHECK (
            status IN ('pending', 'resolved_hidden', 'dismissed')
        ),
    reviewed_by_member_id uuid NULL,
    reviewed_at timestamptz NULL,
    resolution_note text NULL
        CONSTRAINT chk_community_reports_note_len CHECK (
            resolution_note IS NULL OR char_length(btrim(resolution_note)) <= 500
        ),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_community_post_reports_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_community_reports_reporter
        FOREIGN KEY (tenant_id, reporter_member_id)
        REFERENCES public.tenant_members (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_community_reports_post
        FOREIGN KEY (tenant_id, post_id)
        REFERENCES public.community_posts (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_community_reports_comment
        FOREIGN KEY (tenant_id, comment_id)
        REFERENCES public.community_post_comments (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_community_reports_reviewer
        FOREIGN KEY (tenant_id, reviewed_by_member_id)
        REFERENCES public.tenant_members (tenant_id, id)
        ON DELETE SET NULL,
    CONSTRAINT chk_community_reports_target_ref CHECK (
        (target_type = 'post' AND post_id IS NOT NULL AND comment_id IS NULL)
        OR (target_type = 'comment' AND comment_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX uq_community_reports_pending_post
    ON public.community_post_reports (reporter_member_id, post_id)
    WHERE target_type = 'post' AND status = 'pending';

CREATE UNIQUE INDEX uq_community_reports_pending_comment
    ON public.community_post_reports (reporter_member_id, comment_id)
    WHERE target_type = 'comment' AND status = 'pending';

CREATE INDEX idx_community_reports_tenant_status
    ON public.community_post_reports (tenant_id, status, created_at DESC);

-- =============================================================================
-- 3. updated_at Triggers
-- =============================================================================
CREATE TRIGGER trg_community_posts_updated_at
    BEFORE UPDATE ON public.community_posts
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_community_post_comments_updated_at
    BEFORE UPDATE ON public.community_post_comments
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_community_post_reports_updated_at
    BEFORE UPDATE ON public.community_post_reports
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- 4. Least-Privilege Grants & Row Level Security
-- =============================================================================
REVOKE ALL ON
    public.community_posts,
    public.community_post_media,
    public.community_post_likes,
    public.community_post_comments,
    public.community_post_reports
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON
    public.community_posts,
    public.community_post_media,
    public.community_post_likes,
    public.community_post_comments,
    public.community_post_reports
TO authenticated;

GRANT ALL ON
    public.community_posts,
    public.community_post_media,
    public.community_post_likes,
    public.community_post_comments,
    public.community_post_reports
TO service_role;

ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_post_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_post_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_post_reports ENABLE ROW LEVEL SECURITY;

-- 4.1 community_posts SELECT
CREATE POLICY community_posts_select
    ON public.community_posts
    FOR SELECT
    TO authenticated
    USING (
        deleted_at IS NULL
        AND (
            public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
            OR (
                public.is_tenant_member(tenant_id)
                AND moderation_status = 'published'
            )
        )
    );

-- 4.2 community_post_media SELECT
CREATE POLICY community_post_media_select
    ON public.community_post_media
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.community_posts p
            WHERE p.id = community_post_media.post_id
              AND p.tenant_id = community_post_media.tenant_id
              AND p.deleted_at IS NULL
              AND (
                  public.has_tenant_role(p.tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
                  OR (
                      public.is_tenant_member(p.tenant_id)
                      AND p.moderation_status = 'published'
                  )
              )
        )
    );

-- 4.3 community_post_likes SELECT
CREATE POLICY community_post_likes_select
    ON public.community_post_likes
    FOR SELECT
    TO authenticated
    USING (
        public.is_tenant_member(tenant_id)
        AND EXISTS (
            SELECT 1
            FROM public.community_posts p
            WHERE p.id = community_post_likes.post_id
              AND p.tenant_id = community_post_likes.tenant_id
              AND p.deleted_at IS NULL
              AND (
                  public.has_tenant_role(p.tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
                  OR p.moderation_status = 'published'
              )
        )
    );

-- 4.4 community_post_comments SELECT
CREATE POLICY community_post_comments_select
    ON public.community_post_comments
    FOR SELECT
    TO authenticated
    USING (
        deleted_at IS NULL
        AND (
            (
                public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
                AND EXISTS (
                    SELECT 1
                    FROM public.community_posts p
                    WHERE p.id = community_post_comments.post_id
                      AND p.tenant_id = community_post_comments.tenant_id
                      AND p.deleted_at IS NULL
                )
            )
            OR (
                public.is_tenant_member(tenant_id)
                AND moderation_status = 'published'
                AND EXISTS (
                    SELECT 1
                    FROM public.community_posts p
                    WHERE p.id = community_post_comments.post_id
                      AND p.tenant_id = community_post_comments.tenant_id
                      AND p.deleted_at IS NULL
                      AND p.moderation_status = 'published'
                )
            )
        )
    );

-- 4.5 community_post_reports SELECT
CREATE POLICY community_post_reports_select
    ON public.community_post_reports
    FOR SELECT
    TO authenticated
    USING (
        public.has_tenant_role(tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
        OR (
            public.is_tenant_member(tenant_id)
            AND reporter_member_id = public.get_my_member_id(tenant_id)
        )
    );

-- =============================================================================
-- 5. Storage Bucket & Policies: community-media (Private Bucket, 5 MiB Max)
-- =============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types, versioning_status)
VALUES (
    'community-media',
    'community-media',
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

DROP POLICY IF EXISTS storage_insert_community_media ON storage.objects;
CREATE POLICY storage_insert_community_media
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'community-media'
        AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
        AND public._community_extract_uuid_segment(name, 1) IS NOT NULL
        AND public._community_extract_uuid_segment(name, 2) IS NOT NULL
        AND public.is_tenant_member(public._community_extract_uuid_segment(name, 1))
        AND public._community_extract_uuid_segment(name, 2) = public.get_my_member_id(public._community_extract_uuid_segment(name, 1))
    );

DROP POLICY IF EXISTS storage_select_community_media ON storage.objects;
CREATE POLICY storage_select_community_media
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'community-media'
        AND archived_at IS NULL
        AND is_delete_marker = false
        AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
        AND public._community_extract_uuid_segment(name, 1) IS NOT NULL
        AND public.is_tenant_member(public._community_extract_uuid_segment(name, 1))
        AND (
            EXISTS (
                SELECT 1
                FROM public.community_post_media m
                JOIN public.community_posts p
                  ON p.id = m.post_id
                 AND p.tenant_id = m.tenant_id
                WHERE m.storage_path = storage.objects.name
                  AND m.tenant_id = public._community_extract_uuid_segment(storage.objects.name, 1)
                  AND p.deleted_at IS NULL
                  AND (
                      p.moderation_status = 'published'
                      OR public.has_tenant_role(p.tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
                  )
            )
            OR (
                public._community_extract_uuid_segment(name, 2) = public.get_my_member_id(public._community_extract_uuid_segment(name, 1))
                AND NOT EXISTS (
                    SELECT 1
                    FROM public.community_post_media m
                    WHERE m.storage_path = storage.objects.name
                )
            )
        )
    );

DROP POLICY IF EXISTS storage_delete_community_media ON storage.objects;
CREATE POLICY storage_delete_community_media
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'community-media'
        AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
        AND public._community_extract_uuid_segment(name, 1) IS NOT NULL
        AND public.is_tenant_member(public._community_extract_uuid_segment(name, 1))
        AND (
            (
                public._community_extract_uuid_segment(name, 2) = public.get_my_member_id(public._community_extract_uuid_segment(name, 1))
                AND NOT EXISTS (
                    SELECT 1
                    FROM public.community_post_media m
                    JOIN public.community_posts p
                      ON p.id = m.post_id
                     AND p.tenant_id = m.tenant_id
                    WHERE m.storage_path = storage.objects.name
                      AND p.deleted_at IS NULL
                )
            )
            OR (
                public.has_tenant_role(public._community_extract_uuid_segment(name, 1), ARRAY['ketua_rt', 'sekretaris', 'pengurus'])
                AND NOT EXISTS (
                    SELECT 1
                    FROM public.community_post_media m
                    JOIN public.community_posts p
                      ON p.id = m.post_id
                     AND p.tenant_id = m.tenant_id
                    WHERE m.storage_path = storage.objects.name
                      AND p.deleted_at IS NULL
                )
            )
        )
    );

-- =============================================================================
-- 6. Internal Member Display Name Helper (Zero PII)
-- =============================================================================
CREATE OR REPLACE FUNCTION public._community_get_member_display_name(
    p_tenant_id uuid,
    p_member_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(
        NULLIF(btrim(r.full_name), ''),
        NULLIF(btrim(p.full_name), ''),
        'Warga RT'
    )
    FROM public.tenant_members tm
    LEFT JOIN public.residents r
      ON r.id = tm.resident_id
     AND r.tenant_id = tm.tenant_id
     AND r.deleted_at IS NULL
    LEFT JOIN public.profiles p
      ON p.id = tm.user_id
    WHERE tm.tenant_id = p_tenant_id
      AND tm.id = p_member_id
    LIMIT 1;
$$;

ALTER FUNCTION public._community_get_member_display_name(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._community_get_member_display_name(uuid, uuid)
    FROM PUBLIC, anon, authenticated, service_role;

-- =============================================================================
-- 7. Public RPCs (Authenticated, Tenant-Isolated, Server-Verified Actor)
-- =============================================================================

-- 7.1 Zero-PII Author Lookup for Same-Tenant Feed Members
CREATE OR REPLACE FUNCTION public.get_community_feed_authors(
    p_tenant_id uuid,
    p_member_ids uuid[]
)
RETURNS TABLE (
    member_id uuid,
    display_name text,
    staff_badge text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated caller' USING ERRCODE = '28000';
    END IF;

    IF NOT public.is_tenant_member(p_tenant_id) THEN
        RAISE EXCEPTION 'Forbidden: caller is not an active member of this tenant'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        tm.id AS member_id,
        COALESCE(
            NULLIF(btrim(r.full_name), ''),
            NULLIF(btrim(p.full_name), ''),
            'Warga RT'
        ) AS display_name,
        (
            SELECT CASE rl.code
                WHEN 'ketua_rt' THEN 'Ketua RT'
                WHEN 'sekretaris' THEN 'Sekretaris'
                WHEN 'pengurus' THEN 'Pengurus'
                ELSE NULL
            END
            FROM public.member_roles mr
            JOIN public.roles rl ON rl.id = mr.role_id
            WHERE mr.member_id = tm.id
              AND mr.tenant_id = tm.tenant_id
              AND rl.code IN ('ketua_rt', 'sekretaris', 'pengurus')
            ORDER BY CASE rl.code
                WHEN 'ketua_rt' THEN 1
                WHEN 'sekretaris' THEN 2
                WHEN 'pengurus' THEN 3
                ELSE 9
            END
            LIMIT 1
        ) AS staff_badge
    FROM public.tenant_members tm
    LEFT JOIN public.residents r
      ON r.id = tm.resident_id
     AND r.tenant_id = tm.tenant_id
     AND r.deleted_at IS NULL
    LEFT JOIN public.profiles p
      ON p.id = tm.user_id
    WHERE tm.tenant_id = p_tenant_id
      AND tm.id = ANY(COALESCE(p_member_ids, ARRAY[]::uuid[]));
END;
$$;

ALTER FUNCTION public.get_community_feed_authors(uuid, uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_community_feed_authors(uuid, uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_community_feed_authors(uuid, uuid[]) TO authenticated;

-- 7.2 Create Community Post (with validated private Storage media)
CREATE OR REPLACE FUNCTION public.create_community_post(
    p_tenant_id uuid,
    p_caption text DEFAULT NULL,
    p_media_items jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_member_id uuid;
    v_clean_caption text := NULLIF(btrim(COALESCE(p_caption, '')), '');
    v_media_count integer := 0;
    v_post_id uuid;
    v_idx integer := 0;
    v_item jsonb;
    v_path text;
    v_mime text;
    v_size integer;
    v_ext text;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated caller' USING ERRCODE = '28000';
    END IF;

    v_member_id := public.get_my_member_id(p_tenant_id);
    IF v_member_id IS NULL THEN
        RAISE EXCEPTION 'Forbidden: caller is not an active member of this tenant'
            USING ERRCODE = '42501';
    END IF;

    IF v_clean_caption IS NOT NULL AND char_length(v_clean_caption) > 2200 THEN
        RAISE EXCEPTION 'Caption exceeds maximum length of 2200 characters'
            USING ERRCODE = '22023';
    END IF;

    IF p_media_items IS NULL THEN
        p_media_items := '[]'::jsonb;
    END IF;

    IF jsonb_typeof(p_media_items) <> 'array' THEN
        RAISE EXCEPTION 'Media items must be a JSON array' USING ERRCODE = '22023';
    END IF;

    v_media_count := jsonb_array_length(p_media_items);
    IF v_media_count < 0 OR v_media_count > 4 THEN
        RAISE EXCEPTION 'Maximum 4 media images are allowed per post' USING ERRCODE = '22023';
    END IF;

    IF v_media_count = 0 AND v_clean_caption IS NULL THEN
        RAISE EXCEPTION 'Post must contain a caption or at least one image'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.community_posts (
        tenant_id,
        author_member_id,
        caption,
        media_count,
        moderation_status
    )
    VALUES (
        p_tenant_id,
        v_member_id,
        v_clean_caption,
        v_media_count::smallint,
        'published'
    )
    RETURNING id INTO v_post_id;

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_media_items)
    LOOP
        v_path := btrim(COALESCE(v_item ->> 'storagePath', ''));
        v_mime := lower(btrim(COALESCE(v_item ->> 'mimeType', '')));
        IF btrim(COALESCE(v_item ->> 'fileSizeBytes', '')) !~ '^[0-9]+$' THEN
            RAISE EXCEPTION 'Invalid media file size' USING ERRCODE = '22023';
        END IF;
        v_size := (btrim(v_item ->> 'fileSizeBytes'))::integer;

        IF v_path = '' OR v_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$' THEN
            RAISE EXCEPTION 'Invalid community media storage path format' USING ERRCODE = '22023';
        END IF;

        IF split_part(v_path, '/', 1) <> p_tenant_id::text
           OR split_part(v_path, '/', 2) <> v_member_id::text THEN
            RAISE EXCEPTION 'Forbidden: storage path ownership mismatch' USING ERRCODE = '42501';
        END IF;

        v_ext := lower(substring(v_path FROM '\.([^./]+)$'));
        IF NOT (
            (v_ext IN ('jpg', 'jpeg') AND v_mime = 'image/jpeg')
            OR (v_ext = 'png' AND v_mime = 'image/png')
            OR (v_ext = 'webp' AND v_mime = 'image/webp')
        ) THEN
            RAISE EXCEPTION 'Unsupported or mismatched image extension and MIME type' USING ERRCODE = '22023';
        END IF;

        IF v_size IS NULL OR v_size <= 0 OR v_size > 5242880 THEN
            RAISE EXCEPTION 'Image size must be between 1 byte and 5 MiB' USING ERRCODE = '22023';
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM storage.objects o
            WHERE o.bucket_id = 'community-media'
              AND o.name = v_path
              AND o.archived_at IS NULL
              AND o.is_delete_marker = false
        ) THEN
            RAISE EXCEPTION 'Uploaded media object does not exist in storage'
                USING ERRCODE = '23503';
        END IF;

        INSERT INTO public.community_post_media (
            tenant_id,
            post_id,
            storage_path,
            mime_type,
            file_size_bytes,
            sort_order
        )
        VALUES (
            p_tenant_id,
            v_post_id,
            v_path,
            v_mime,
            v_size,
            v_idx::smallint
        );

        v_idx := v_idx + 1;
    END LOOP;

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
        'community_post.created',
        'community_posts',
        v_post_id,
        jsonb_build_object(
            'post_id', v_post_id,
            'author_member_id', v_member_id,
            'media_count', v_media_count,
            'has_caption', (v_clean_caption IS NOT NULL)
        )
    );

    RETURN v_post_id;
END;
$$;

ALTER FUNCTION public.create_community_post(uuid, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_community_post(uuid, text, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_community_post(uuid, text, jsonb) TO authenticated;

-- 7.3 Update Community Post (Author Only, Optional Media Removal & Addition)
CREATE OR REPLACE FUNCTION public.update_community_post(
    p_tenant_id uuid,
    p_post_id uuid,
    p_caption text DEFAULT NULL,
    p_keep_media_ids uuid[] DEFAULT NULL,
    p_new_media_items jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_member_id uuid;
    v_post public.community_posts%ROWTYPE;
    v_clean_caption text := NULLIF(btrim(COALESCE(p_caption, '')), '');
    v_removed_paths text[] := ARRAY[]::text[];
    v_remaining_media_count integer;
    v_remaining_id uuid;
    v_idx integer := 0;
    v_item jsonb;
    v_path text;
    v_mime text;
    v_size integer;
    v_ext text;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated caller' USING ERRCODE = '28000';
    END IF;

    v_member_id := public.get_my_member_id(p_tenant_id);
    IF v_member_id IS NULL THEN
        RAISE EXCEPTION 'Forbidden: caller is not an active member of this tenant'
            USING ERRCODE = '42501';
    END IF;

    IF v_clean_caption IS NOT NULL AND char_length(v_clean_caption) > 2200 THEN
        RAISE EXCEPTION 'Caption exceeds maximum length of 2200 characters'
            USING ERRCODE = '22023';
    END IF;

    IF p_new_media_items IS NULL THEN
        p_new_media_items := '[]'::jsonb;
    END IF;

    IF jsonb_typeof(p_new_media_items) <> 'array' THEN
        RAISE EXCEPTION 'New media items must be a JSON array' USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_post
    FROM public.community_posts
    WHERE id = p_post_id
      AND tenant_id = p_tenant_id
      AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Community post not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_post.author_member_id <> v_member_id THEN
        RAISE EXCEPTION 'Forbidden: only the post author may edit this post'
            USING ERRCODE = '42501';
    END IF;

    IF v_post.moderation_status <> 'published' THEN
        RAISE EXCEPTION 'Moderated posts cannot be edited'
            USING ERRCODE = '42501';
    END IF;

    IF p_keep_media_ids IS NOT NULL THEN
        SELECT COALESCE(array_agg(storage_path), ARRAY[]::text[])
        INTO v_removed_paths
        FROM public.community_post_media
        WHERE post_id = p_post_id
          AND tenant_id = p_tenant_id
          AND NOT (id = ANY(p_keep_media_ids));

        DELETE FROM public.community_post_media
        WHERE post_id = p_post_id
          AND tenant_id = p_tenant_id
          AND NOT (id = ANY(p_keep_media_ids));

        -- Re-sequence remaining media sort_order cleanly (constraint is DEFERRABLE)
        FOR v_remaining_id IN
            SELECT id
            FROM public.community_post_media
            WHERE post_id = p_post_id
              AND tenant_id = p_tenant_id
            ORDER BY sort_order ASC, created_at ASC
        LOOP
            UPDATE public.community_post_media
            SET sort_order = v_idx::smallint
            WHERE id = v_remaining_id;
            v_idx := v_idx + 1;
        END LOOP;
    ELSE
        SELECT COALESCE(MAX(sort_order) + 1, 0)
        INTO v_idx
        FROM public.community_post_media
        WHERE post_id = p_post_id
          AND tenant_id = p_tenant_id;
    END IF;

    IF v_idx + jsonb_array_length(p_new_media_items) > 4 THEN
        RAISE EXCEPTION 'Maximum 4 media images are allowed per post' USING ERRCODE = '22023';
    END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_new_media_items)
    LOOP
        v_path := btrim(COALESCE(v_item ->> 'storagePath', ''));
        v_mime := lower(btrim(COALESCE(v_item ->> 'mimeType', '')));
        IF btrim(COALESCE(v_item ->> 'fileSizeBytes', '')) !~ '^[0-9]+$' THEN
            RAISE EXCEPTION 'Invalid media file size' USING ERRCODE = '22023';
        END IF;
        v_size := (btrim(v_item ->> 'fileSizeBytes'))::integer;

        IF v_path = '' OR v_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$' THEN
            RAISE EXCEPTION 'Invalid community media storage path format' USING ERRCODE = '22023';
        END IF;

        IF split_part(v_path, '/', 1) <> p_tenant_id::text
           OR split_part(v_path, '/', 2) <> v_member_id::text THEN
            RAISE EXCEPTION 'Forbidden: storage path ownership mismatch' USING ERRCODE = '42501';
        END IF;

        v_ext := lower(substring(v_path FROM '\.([^./]+)$'));
        IF NOT (
            (v_ext IN ('jpg', 'jpeg') AND v_mime = 'image/jpeg')
            OR (v_ext = 'png' AND v_mime = 'image/png')
            OR (v_ext = 'webp' AND v_mime = 'image/webp')
        ) THEN
            RAISE EXCEPTION 'Unsupported or mismatched image extension and MIME type' USING ERRCODE = '22023';
        END IF;

        IF v_size IS NULL OR v_size <= 0 OR v_size > 5242880 THEN
            RAISE EXCEPTION 'Image size must be between 1 byte and 5 MiB' USING ERRCODE = '22023';
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM storage.objects o
            WHERE o.bucket_id = 'community-media'
              AND o.name = v_path
              AND o.archived_at IS NULL
              AND o.is_delete_marker = false
        ) THEN
            RAISE EXCEPTION 'Uploaded media object does not exist in storage'
                USING ERRCODE = '23503';
        END IF;

        INSERT INTO public.community_post_media (
            tenant_id,
            post_id,
            storage_path,
            mime_type,
            file_size_bytes,
            sort_order
        )
        VALUES (
            p_tenant_id,
            p_post_id,
            v_path,
            v_mime,
            v_size,
            v_idx::smallint
        );

        v_idx := v_idx + 1;
    END LOOP;

    SELECT count(*)::integer
    INTO v_remaining_media_count
    FROM public.community_post_media
    WHERE post_id = p_post_id
      AND tenant_id = p_tenant_id;

    IF v_remaining_media_count = 0 AND v_clean_caption IS NULL THEN
        RAISE EXCEPTION 'Post cannot be empty without caption and media'
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.community_posts
    SET
        caption = v_clean_caption,
        media_count = v_remaining_media_count::smallint,
        updated_at = now()
    WHERE id = p_post_id
      AND tenant_id = p_tenant_id;

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
        'community_post.updated',
        'community_posts',
        p_post_id,
        jsonb_build_object(
            'post_id', p_post_id,
            'media_count', v_remaining_media_count,
            'removed_media_count', COALESCE(array_length(v_removed_paths, 1), 0)
        )
    );

    RETURN jsonb_build_object(
        'post_id', p_post_id,
        'removed_storage_paths', to_jsonb(COALESCE(v_removed_paths, ARRAY[]::text[]))
    );
END;
$$;

ALTER FUNCTION public.update_community_post(uuid, uuid, text, uuid[], jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_community_post(uuid, uuid, text, uuid[], jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_community_post(uuid, uuid, text, uuid[], jsonb) TO authenticated;

-- 7.4 Soft Delete Community Post (Author Only)
CREATE OR REPLACE FUNCTION public.soft_delete_community_post(
    p_tenant_id uuid,
    p_post_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_member_id uuid;
    v_post public.community_posts%ROWTYPE;
    v_media_paths text[];
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated caller' USING ERRCODE = '28000';
    END IF;

    v_member_id := public.get_my_member_id(p_tenant_id);
    IF v_member_id IS NULL THEN
        RAISE EXCEPTION 'Forbidden: caller is not an active member of this tenant'
            USING ERRCODE = '42501';
    END IF;

    SELECT *
    INTO v_post
    FROM public.community_posts
    WHERE id = p_post_id
      AND tenant_id = p_tenant_id
      AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Community post not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_post.author_member_id <> v_member_id THEN
        RAISE EXCEPTION 'Forbidden: only the post author may delete this post'
            USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(array_agg(storage_path), ARRAY[]::text[])
    INTO v_media_paths
    FROM public.community_post_media
    WHERE post_id = p_post_id
      AND tenant_id = p_tenant_id;

    UPDATE public.community_posts
    SET deleted_at = now(),
        updated_at = now()
    WHERE id = p_post_id
      AND tenant_id = p_tenant_id;

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
        'community_post.deleted',
        'community_posts',
        p_post_id,
        jsonb_build_object(
            'post_id', p_post_id,
            'author_member_id', v_member_id
        )
    );

    RETURN jsonb_build_object(
        'post_id', p_post_id,
        'deleted', true,
        'storage_paths', to_jsonb(COALESCE(v_media_paths, ARRAY[]::text[]))
    );
END;
$$;

ALTER FUNCTION public.soft_delete_community_post(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.soft_delete_community_post(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.soft_delete_community_post(uuid, uuid) TO authenticated;

-- 7.5 Toggle / Set Like on Community Post (Atomic & Idempotent)
CREATE OR REPLACE FUNCTION public.toggle_community_post_like(
    p_tenant_id uuid,
    p_post_id uuid,
    p_desired boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_member_id uuid;
    v_post public.community_posts%ROWTYPE;
    v_currently_liked boolean;
    v_next_liked boolean;
    v_like_count integer;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated caller' USING ERRCODE = '28000';
    END IF;

    v_member_id := public.get_my_member_id(p_tenant_id);
    IF v_member_id IS NULL THEN
        RAISE EXCEPTION 'Forbidden: caller is not an active member of this tenant'
            USING ERRCODE = '42501';
    END IF;

    SELECT *
    INTO v_post
    FROM public.community_posts
    WHERE id = p_post_id
      AND tenant_id = p_tenant_id
      AND deleted_at IS NULL
      AND moderation_status = 'published'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Community post not found or unavailable' USING ERRCODE = 'P0002';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.community_post_likes
        WHERE post_id = p_post_id
          AND tenant_id = p_tenant_id
          AND member_id = v_member_id
    )
    INTO v_currently_liked;

    v_next_liked := COALESCE(p_desired, NOT v_currently_liked);

    IF v_next_liked THEN
        INSERT INTO public.community_post_likes (tenant_id, post_id, member_id)
        VALUES (p_tenant_id, p_post_id, v_member_id)
        ON CONFLICT (post_id, member_id) DO NOTHING;
    ELSE
        DELETE FROM public.community_post_likes
        WHERE post_id = p_post_id
          AND tenant_id = p_tenant_id
          AND member_id = v_member_id;
    END IF;

    SELECT count(*)::integer
    INTO v_like_count
    FROM public.community_post_likes
    WHERE post_id = p_post_id
      AND tenant_id = p_tenant_id;

    UPDATE public.community_posts
    SET like_count = v_like_count
    WHERE id = p_post_id
      AND tenant_id = p_tenant_id;

    RETURN jsonb_build_object(
        'post_id', p_post_id,
        'liked', v_next_liked,
        'like_count', v_like_count
    );
END;
$$;

ALTER FUNCTION public.toggle_community_post_like(uuid, uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.toggle_community_post_like(uuid, uuid, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.toggle_community_post_like(uuid, uuid, boolean) TO authenticated;

-- 7.6 Create Comment / Reply on Post (with Notifications)
CREATE OR REPLACE FUNCTION public.create_community_post_comment(
    p_tenant_id uuid,
    p_post_id uuid,
    p_content text,
    p_parent_comment_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_member_id uuid;
    v_clean_content text := btrim(COALESCE(p_content, ''));
    v_post public.community_posts%ROWTYPE;
    v_parent_comment public.community_post_comments%ROWTYPE;
    v_comment_id uuid;
    v_comment_count integer;
    v_commenter_name text;
    v_post_author_user_id uuid;
    v_parent_author_user_id uuid;
    v_preview text;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated caller' USING ERRCODE = '28000';
    END IF;

    v_member_id := public.get_my_member_id(p_tenant_id);
    IF v_member_id IS NULL THEN
        RAISE EXCEPTION 'Forbidden: caller is not an active member of this tenant'
            USING ERRCODE = '42501';
    END IF;

    IF v_clean_content = '' OR char_length(v_clean_content) > 1000 THEN
        RAISE EXCEPTION 'Comment content must be between 1 and 1000 characters'
            USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_post
    FROM public.community_posts
    WHERE id = p_post_id
      AND tenant_id = p_tenant_id
      AND deleted_at IS NULL
      AND moderation_status = 'published'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Community post not found or unavailable' USING ERRCODE = 'P0002';
    END IF;

    IF p_parent_comment_id IS NOT NULL THEN
        SELECT *
        INTO v_parent_comment
        FROM public.community_post_comments
        WHERE id = p_parent_comment_id
          AND tenant_id = p_tenant_id
          AND post_id = p_post_id
          AND deleted_at IS NULL
          AND moderation_status = 'published';

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Parent comment not found in this post' USING ERRCODE = 'P0002';
        END IF;
    END IF;

    INSERT INTO public.community_post_comments (
        tenant_id,
        post_id,
        author_member_id,
        parent_comment_id,
        content,
        moderation_status
    )
    VALUES (
        p_tenant_id,
        p_post_id,
        v_member_id,
        p_parent_comment_id,
        v_clean_content,
        'published'
    )
    RETURNING id INTO v_comment_id;

    SELECT count(*)::integer
    INTO v_comment_count
    FROM public.community_post_comments
    WHERE post_id = p_post_id
      AND tenant_id = p_tenant_id
      AND deleted_at IS NULL
      AND moderation_status = 'published';

    UPDATE public.community_posts
    SET comment_count = v_comment_count
    WHERE id = p_post_id
      AND tenant_id = p_tenant_id;

    -- Notifications (avoid self-notify & avoid duplicate notify)
    v_commenter_name := public._community_get_member_display_name(p_tenant_id, v_member_id);
    v_preview := CASE
        WHEN char_length(v_clean_content) > 80 THEN left(v_clean_content, 80) || '…'
        ELSE v_clean_content
    END;

    SELECT tm.user_id
    INTO v_post_author_user_id
    FROM public.tenant_members tm
    WHERE tm.id = v_post.author_member_id
      AND tm.tenant_id = p_tenant_id
      AND tm.status = 'active';

    IF v_post_author_user_id IS NOT NULL AND v_post_author_user_id <> v_actor THEN
        INSERT INTO public.notifications (
            tenant_id,
            recipient_user_id,
            title,
            body,
            type,
            reference_type,
            reference_id
        )
        VALUES (
            p_tenant_id,
            v_post_author_user_id,
            'Komentar baru pada postingan Anda',
            v_commenter_name || ': "' || v_preview || '"',
            'community_comment',
            'community_post',
            p_post_id
        );
    END IF;

    IF p_parent_comment_id IS NOT NULL THEN
        SELECT tm.user_id
        INTO v_parent_author_user_id
        FROM public.tenant_members tm
        WHERE tm.id = v_parent_comment.author_member_id
          AND tm.tenant_id = p_tenant_id
          AND tm.status = 'active';

        IF v_parent_author_user_id IS NOT NULL
           AND v_parent_author_user_id <> v_actor
           AND v_parent_author_user_id IS DISTINCT FROM v_post_author_user_id THEN
            INSERT INTO public.notifications (
                tenant_id,
                recipient_user_id,
                title,
                body,
                type,
                reference_type,
                reference_id
            )
            VALUES (
                p_tenant_id,
                v_parent_author_user_id,
                'Balasan baru pada komentar Anda',
                v_commenter_name || ' membalas: "' || v_preview || '"',
                'community_comment_reply',
                'community_post',
                p_post_id
            );
        END IF;
    END IF;

    RETURN v_comment_id;
END;
$$;

ALTER FUNCTION public.create_community_post_comment(uuid, uuid, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_community_post_comment(uuid, uuid, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_community_post_comment(uuid, uuid, text, uuid) TO authenticated;

-- 7.7 Update Comment (Author Only)
CREATE OR REPLACE FUNCTION public.update_community_post_comment(
    p_tenant_id uuid,
    p_comment_id uuid,
    p_content text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_member_id uuid;
    v_clean_content text := btrim(COALESCE(p_content, ''));
    v_comment public.community_post_comments%ROWTYPE;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated caller' USING ERRCODE = '28000';
    END IF;

    v_member_id := public.get_my_member_id(p_tenant_id);
    IF v_member_id IS NULL THEN
        RAISE EXCEPTION 'Forbidden: caller is not an active member of this tenant'
            USING ERRCODE = '42501';
    END IF;

    IF v_clean_content = '' OR char_length(v_clean_content) > 1000 THEN
        RAISE EXCEPTION 'Comment content must be between 1 and 1000 characters'
            USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_comment
    FROM public.community_post_comments
    WHERE id = p_comment_id
      AND tenant_id = p_tenant_id
      AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Comment not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_comment.author_member_id <> v_member_id THEN
        RAISE EXCEPTION 'Forbidden: only the comment author may edit this comment'
            USING ERRCODE = '42501';
    END IF;

    IF v_comment.moderation_status <> 'published' THEN
        RAISE EXCEPTION 'Moderated comments cannot be edited'
            USING ERRCODE = '42501';
    END IF;

    UPDATE public.community_post_comments
    SET content = v_clean_content,
        updated_at = now()
    WHERE id = p_comment_id
      AND tenant_id = p_tenant_id;

    RETURN p_comment_id;
END;
$$;

ALTER FUNCTION public.update_community_post_comment(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_community_post_comment(uuid, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_community_post_comment(uuid, uuid, text) TO authenticated;

-- 7.8 Soft Delete Comment (Author Only)
CREATE OR REPLACE FUNCTION public.soft_delete_community_post_comment(
    p_tenant_id uuid,
    p_comment_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_member_id uuid;
    v_comment public.community_post_comments%ROWTYPE;
    v_comment_count integer;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated caller' USING ERRCODE = '28000';
    END IF;

    v_member_id := public.get_my_member_id(p_tenant_id);
    IF v_member_id IS NULL THEN
        RAISE EXCEPTION 'Forbidden: caller is not an active member of this tenant'
            USING ERRCODE = '42501';
    END IF;

    SELECT *
    INTO v_comment
    FROM public.community_post_comments
    WHERE id = p_comment_id
      AND tenant_id = p_tenant_id
      AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Comment not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_comment.author_member_id <> v_member_id THEN
        RAISE EXCEPTION 'Forbidden: only the comment author may delete this comment'
            USING ERRCODE = '42501';
    END IF;

    -- Lock parent post for consistent count update
    PERFORM 1
    FROM public.community_posts
    WHERE id = v_comment.post_id
      AND tenant_id = p_tenant_id
    FOR UPDATE;

    UPDATE public.community_post_comments
    SET deleted_at = now(),
        updated_at = now()
    WHERE id = p_comment_id
      AND tenant_id = p_tenant_id;

    SELECT count(*)::integer
    INTO v_comment_count
    FROM public.community_post_comments
    WHERE post_id = v_comment.post_id
      AND tenant_id = p_tenant_id
      AND deleted_at IS NULL
      AND moderation_status = 'published';

    UPDATE public.community_posts
    SET comment_count = v_comment_count
    WHERE id = v_comment.post_id
      AND tenant_id = p_tenant_id;

    RETURN jsonb_build_object(
        'comment_id', p_comment_id,
        'post_id', v_comment.post_id,
        'comment_count', v_comment_count
    );
END;
$$;

ALTER FUNCTION public.soft_delete_community_post_comment(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.soft_delete_community_post_comment(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.soft_delete_community_post_comment(uuid, uuid) TO authenticated;

-- 7.9 Report Post or Comment
CREATE OR REPLACE FUNCTION public.report_community_content(
    p_tenant_id uuid,
    p_target_type text,
    p_target_id uuid,
    p_reason_category text,
    p_reason_detail text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_member_id uuid;
    v_clean_detail text := NULLIF(btrim(COALESCE(p_reason_detail, '')), '');
    v_post_id uuid := NULL;
    v_comment_id uuid := NULL;
    v_target_author_member_id uuid;
    v_report_id uuid;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated caller' USING ERRCODE = '28000';
    END IF;

    v_member_id := public.get_my_member_id(p_tenant_id);
    IF v_member_id IS NULL THEN
        RAISE EXCEPTION 'Forbidden: caller is not an active member of this tenant'
            USING ERRCODE = '42501';
    END IF;

    IF p_target_type NOT IN ('post', 'comment') THEN
        RAISE EXCEPTION 'Invalid report target type' USING ERRCODE = '22023';
    END IF;

    IF p_reason_category NOT IN ('spam', 'harassment', 'inappropriate', 'misinformation', 'privacy', 'other') THEN
        RAISE EXCEPTION 'Invalid report reason category' USING ERRCODE = '22023';
    END IF;

    IF v_clean_detail IS NOT NULL AND char_length(v_clean_detail) > 500 THEN
        RAISE EXCEPTION 'Report reason detail exceeds 500 characters' USING ERRCODE = '22023';
    END IF;

    IF p_target_type = 'post' THEN
        SELECT p.id, p.author_member_id
        INTO v_post_id, v_target_author_member_id
        FROM public.community_posts p
        WHERE p.id = p_target_id
          AND p.tenant_id = p_tenant_id
          AND p.deleted_at IS NULL
          AND p.moderation_status = 'published';

        IF v_post_id IS NULL THEN
            RAISE EXCEPTION 'Target post not found or unavailable' USING ERRCODE = 'P0002';
        END IF;
    ELSE
        SELECT c.id, c.post_id, c.author_member_id
        INTO v_comment_id, v_post_id, v_target_author_member_id
        FROM public.community_post_comments c
        JOIN public.community_posts p
          ON p.id = c.post_id
         AND p.tenant_id = c.tenant_id
        WHERE c.id = p_target_id
          AND c.tenant_id = p_tenant_id
          AND c.deleted_at IS NULL
          AND c.moderation_status = 'published'
          AND p.deleted_at IS NULL
          AND p.moderation_status = 'published';

        IF v_comment_id IS NULL THEN
            RAISE EXCEPTION 'Target comment not found or unavailable' USING ERRCODE = 'P0002';
        END IF;
    END IF;

    IF v_target_author_member_id = v_member_id THEN
        RAISE EXCEPTION 'You cannot report your own content' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.community_post_reports (
        tenant_id,
        reporter_member_id,
        target_type,
        post_id,
        comment_id,
        reason_category,
        reason_detail,
        status
    )
    VALUES (
        p_tenant_id,
        v_member_id,
        p_target_type,
        CASE WHEN p_target_type = 'post' THEN v_post_id ELSE NULL END,
        CASE WHEN p_target_type = 'comment' THEN v_comment_id ELSE NULL END,
        p_reason_category,
        v_clean_detail,
        'pending'
    )
    RETURNING id INTO v_report_id;

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
        'community_content.reported',
        'community_post_reports',
        v_report_id,
        jsonb_build_object(
            'report_id', v_report_id,
            'target_type', p_target_type,
            'target_id', p_target_id,
            'reason_category', p_reason_category
        )
    );

    RETURN v_report_id;
END;
$$;

ALTER FUNCTION public.report_community_content(uuid, text, uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.report_community_content(uuid, text, uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.report_community_content(uuid, text, uuid, text, text) TO authenticated;

-- 7.10 Moderate Post (ketua_rt, sekretaris, pengurus ONLY — NO bendahara)
CREATE OR REPLACE FUNCTION public.moderate_community_post(
    p_tenant_id uuid,
    p_post_id uuid,
    p_action text,
    p_reason text DEFAULT NULL,
    p_report_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_member_id uuid;
    v_post public.community_posts%ROWTYPE;
    v_clean_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
    v_next_status text;
    v_author_user_id uuid;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated caller' USING ERRCODE = '28000';
    END IF;

    IF NOT public.has_tenant_role(p_tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus']) THEN
        RAISE EXCEPTION 'Forbidden: only Ketua RT, Sekretaris, or Pengurus may moderate community posts'
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
        RAISE EXCEPTION 'Moderation reason is required (minimum 3 characters) when hiding a post'
            USING ERRCODE = '22023';
    END IF;

    IF v_clean_reason IS NOT NULL AND char_length(v_clean_reason) > 500 THEN
        RAISE EXCEPTION 'Moderation reason exceeds 500 characters' USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_post
    FROM public.community_posts
    WHERE id = p_post_id
      AND tenant_id = p_tenant_id
      AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Community post not found' USING ERRCODE = 'P0002';
    END IF;

    v_next_status := CASE WHEN p_action = 'hide' THEN 'hidden' ELSE 'published' END;

    UPDATE public.community_posts
    SET moderation_status = v_next_status,
        moderated_by_member_id = v_member_id,
        moderated_at = now(),
        moderation_reason = v_clean_reason,
        updated_at = now()
    WHERE id = p_post_id
      AND tenant_id = p_tenant_id;

    IF p_action = 'hide' THEN
        UPDATE public.community_post_reports
        SET status = 'resolved_hidden',
            reviewed_by_member_id = v_member_id,
            reviewed_at = now(),
            resolution_note = v_clean_reason,
            updated_at = now()
        WHERE tenant_id = p_tenant_id
          AND target_type = 'post'
          AND post_id = p_post_id
          AND status = 'pending';
    ELSIF p_report_id IS NOT NULL THEN
        UPDATE public.community_post_reports
        SET status = 'dismissed',
            reviewed_by_member_id = v_member_id,
            reviewed_at = now(),
            resolution_note = COALESCE(v_clean_reason, 'Postingan dipulihkan oleh pengurus RT.'),
            updated_at = now()
        WHERE id = p_report_id
          AND tenant_id = p_tenant_id
          AND status = 'pending';
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
        'community_post.moderated_' || p_action,
        'community_posts',
        p_post_id,
        jsonb_build_object(
            'post_id', p_post_id,
            'action', p_action,
            'moderation_status', v_next_status,
            'moderator_member_id', v_member_id,
            'report_id', p_report_id,
            'has_reason', (v_clean_reason IS NOT NULL)
        )
    );

    -- Notify post author
    SELECT tm.user_id
    INTO v_author_user_id
    FROM public.tenant_members tm
    WHERE tm.id = v_post.author_member_id
      AND tm.tenant_id = p_tenant_id
      AND tm.status = 'active';

    IF v_author_user_id IS NOT NULL AND v_author_user_id <> v_actor THEN
        INSERT INTO public.notifications (
            tenant_id,
            recipient_user_id,
            title,
            body,
            type,
            reference_type,
            reference_id
        )
        VALUES (
            p_tenant_id,
            v_author_user_id,
            CASE
                WHEN p_action = 'hide' THEN 'Postingan Anda disembunyikan oleh pengurus RT'
                ELSE 'Postingan Anda dipulihkan oleh pengurus RT'
            END,
            CASE
                WHEN p_action = 'hide' THEN 'Alasan: ' || COALESCE(v_clean_reason, 'Melanggar ketentuan komunitas.')
                ELSE COALESCE(v_clean_reason, 'Postingan Anda kembali ditampilkan pada feed warga.')
            END,
            'community_moderation',
            'community_post',
            p_post_id
        );
    END IF;

    RETURN jsonb_build_object(
        'post_id', p_post_id,
        'moderation_status', v_next_status
    );
END;
$$;

ALTER FUNCTION public.moderate_community_post(uuid, uuid, text, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.moderate_community_post(uuid, uuid, text, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.moderate_community_post(uuid, uuid, text, text, uuid) TO authenticated;

-- 7.11 Moderate Comment (ketua_rt, sekretaris, pengurus ONLY — NO bendahara)
CREATE OR REPLACE FUNCTION public.moderate_community_comment(
    p_tenant_id uuid,
    p_comment_id uuid,
    p_action text,
    p_reason text DEFAULT NULL,
    p_report_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_member_id uuid;
    v_comment public.community_post_comments%ROWTYPE;
    v_clean_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
    v_next_status text;
    v_comment_count integer;
    v_author_user_id uuid;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated caller' USING ERRCODE = '28000';
    END IF;

    IF NOT public.has_tenant_role(p_tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus']) THEN
        RAISE EXCEPTION 'Forbidden: only Ketua RT, Sekretaris, or Pengurus may moderate community comments'
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
        RAISE EXCEPTION 'Moderation reason is required (minimum 3 characters) when hiding a comment'
            USING ERRCODE = '22023';
    END IF;

    IF v_clean_reason IS NOT NULL AND char_length(v_clean_reason) > 500 THEN
        RAISE EXCEPTION 'Moderation reason exceeds 500 characters' USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_comment
    FROM public.community_post_comments
    WHERE id = p_comment_id
      AND tenant_id = p_tenant_id
      AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Comment not found' USING ERRCODE = 'P0002';
    END IF;

    PERFORM 1
    FROM public.community_posts
    WHERE id = v_comment.post_id
      AND tenant_id = p_tenant_id
    FOR UPDATE;

    v_next_status := CASE WHEN p_action = 'hide' THEN 'hidden' ELSE 'published' END;

    UPDATE public.community_post_comments
    SET moderation_status = v_next_status,
        moderated_by_member_id = v_member_id,
        moderated_at = now(),
        moderation_reason = v_clean_reason,
        updated_at = now()
    WHERE id = p_comment_id
      AND tenant_id = p_tenant_id;

    SELECT count(*)::integer
    INTO v_comment_count
    FROM public.community_post_comments
    WHERE post_id = v_comment.post_id
      AND tenant_id = p_tenant_id
      AND deleted_at IS NULL
      AND moderation_status = 'published';

    UPDATE public.community_posts
    SET comment_count = v_comment_count
    WHERE id = v_comment.post_id
      AND tenant_id = p_tenant_id;

    IF p_action = 'hide' THEN
        UPDATE public.community_post_reports
        SET status = 'resolved_hidden',
            reviewed_by_member_id = v_member_id,
            reviewed_at = now(),
            resolution_note = v_clean_reason,
            updated_at = now()
        WHERE tenant_id = p_tenant_id
          AND target_type = 'comment'
          AND comment_id = p_comment_id
          AND status = 'pending';
    ELSIF p_report_id IS NOT NULL THEN
        UPDATE public.community_post_reports
        SET status = 'dismissed',
            reviewed_by_member_id = v_member_id,
            reviewed_at = now(),
            resolution_note = COALESCE(v_clean_reason, 'Komentar dipulihkan oleh pengurus RT.'),
            updated_at = now()
        WHERE id = p_report_id
          AND tenant_id = p_tenant_id
          AND status = 'pending';
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
        'community_comment.moderated_' || p_action,
        'community_post_comments',
        p_comment_id,
        jsonb_build_object(
            'comment_id', p_comment_id,
            'post_id', v_comment.post_id,
            'action', p_action,
            'moderation_status', v_next_status,
            'moderator_member_id', v_member_id,
            'report_id', p_report_id,
            'has_reason', (v_clean_reason IS NOT NULL)
        )
    );

    -- Notify comment author
    SELECT tm.user_id
    INTO v_author_user_id
    FROM public.tenant_members tm
    WHERE tm.id = v_comment.author_member_id
      AND tm.tenant_id = p_tenant_id
      AND tm.status = 'active';

    IF v_author_user_id IS NOT NULL AND v_author_user_id <> v_actor THEN
        INSERT INTO public.notifications (
            tenant_id,
            recipient_user_id,
            title,
            body,
            type,
            reference_type,
            reference_id
        )
        VALUES (
            p_tenant_id,
            v_author_user_id,
            CASE
                WHEN p_action = 'hide' THEN 'Komentar Anda disembunyikan oleh pengurus RT'
                ELSE 'Komentar Anda dipulihkan oleh pengurus RT'
            END,
            CASE
                WHEN p_action = 'hide' THEN 'Alasan: ' || COALESCE(v_clean_reason, 'Melanggar ketentuan komunitas.')
                ELSE COALESCE(v_clean_reason, 'Komentar Anda kembali ditampilkan pada feed warga.')
            END,
            'community_moderation',
            'community_post',
            v_comment.post_id
        );
    END IF;

    RETURN jsonb_build_object(
        'comment_id', p_comment_id,
        'post_id', v_comment.post_id,
        'moderation_status', v_next_status,
        'comment_count', v_comment_count
    );
END;
$$;

ALTER FUNCTION public.moderate_community_comment(uuid, uuid, text, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.moderate_community_comment(uuid, uuid, text, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.moderate_community_comment(uuid, uuid, text, text, uuid) TO authenticated;

-- 7.12 Dismiss Community Report (ketua_rt, sekretaris, pengurus ONLY — NO bendahara)
CREATE OR REPLACE FUNCTION public.dismiss_community_report(
    p_tenant_id uuid,
    p_report_id uuid,
    p_resolution_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_member_id uuid;
    v_report public.community_post_reports%ROWTYPE;
    v_clean_note text := NULLIF(btrim(COALESCE(p_resolution_note, '')), '');
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated caller' USING ERRCODE = '28000';
    END IF;

    IF NOT public.has_tenant_role(p_tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus']) THEN
        RAISE EXCEPTION 'Forbidden: only Ketua RT, Sekretaris, or Pengurus may review community reports'
            USING ERRCODE = '42501';
    END IF;

    v_member_id := public.get_my_member_id(p_tenant_id);
    IF v_member_id IS NULL THEN
        RAISE EXCEPTION 'Forbidden: caller is not an active member of this tenant'
            USING ERRCODE = '42501';
    END IF;

    IF v_clean_note IS NOT NULL AND char_length(v_clean_note) > 500 THEN
        RAISE EXCEPTION 'Resolution note exceeds 500 characters' USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_report
    FROM public.community_post_reports
    WHERE id = p_report_id
      AND tenant_id = p_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Report not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_report.status <> 'pending' THEN
        RAISE EXCEPTION 'Report has already been reviewed' USING ERRCODE = '22023';
    END IF;

    UPDATE public.community_post_reports
    SET status = 'dismissed',
        reviewed_by_member_id = v_member_id,
        reviewed_at = now(),
        resolution_note = v_clean_note,
        updated_at = now()
    WHERE id = p_report_id
      AND tenant_id = p_tenant_id;

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
        'community_report.dismissed',
        'community_post_reports',
        p_report_id,
        jsonb_build_object(
            'report_id', p_report_id,
            'target_type', v_report.target_type,
            'moderator_member_id', v_member_id
        )
    );

    RETURN jsonb_build_object(
        'report_id', p_report_id,
        'status', 'dismissed'
    );
END;
$$;

ALTER FUNCTION public.dismiss_community_report(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.dismiss_community_report(uuid, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.dismiss_community_report(uuid, uuid, text) TO authenticated;

-- 7.13 Moderation Audit Trail Reader (ketua_rt, sekretaris, pengurus ONLY — NO bendahara)
CREATE OR REPLACE FUNCTION public.list_community_moderation_audit_logs(
    p_tenant_id uuid,
    p_limit integer DEFAULT 30
)
RETURNS TABLE (
    id uuid,
    action text,
    entity_type text,
    entity_id uuid,
    actor_name text,
    metadata jsonb,
    created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_safe_limit integer := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated caller' USING ERRCODE = '28000';
    END IF;

    IF NOT public.has_tenant_role(p_tenant_id, ARRAY['ketua_rt', 'sekretaris', 'pengurus']) THEN
        RAISE EXCEPTION 'Forbidden: only Ketua RT, Sekretaris, or Pengurus may read community moderation logs'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        al.id,
        al.action,
        al.entity_type,
        al.entity_id,
        COALESCE(
            NULLIF(btrim(r.full_name), ''),
            NULLIF(btrim(p.full_name), ''),
            'Pengurus RT'
        ) AS actor_name,
        al.metadata,
        al.created_at
    FROM public.audit_logs al
    LEFT JOIN public.tenant_members tm
      ON tm.tenant_id = al.tenant_id
     AND tm.user_id = al.actor_user_id
    LEFT JOIN public.residents r
      ON r.id = tm.resident_id
     AND r.tenant_id = tm.tenant_id
     AND r.deleted_at IS NULL
    LEFT JOIN public.profiles p
      ON p.id = al.actor_user_id
    WHERE al.tenant_id = p_tenant_id
      AND al.entity_type IN ('community_posts', 'community_post_comments', 'community_post_reports')
      AND (
          al.action LIKE 'community_post.moderated_%'
          OR al.action LIKE 'community_comment.moderated_%'
          OR al.action = 'community_report.dismissed'
          OR al.action = 'community_content.reported'
      )
    ORDER BY al.created_at DESC, al.id DESC
    LIMIT v_safe_limit;
END;
$$;

ALTER FUNCTION public.list_community_moderation_audit_logs(uuid, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_community_moderation_audit_logs(uuid, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_community_moderation_audit_logs(uuid, integer) TO authenticated;

COMMIT;
