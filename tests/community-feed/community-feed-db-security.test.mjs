import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import crypto from "node:crypto"
import test from "node:test"
import { createClient } from "@supabase/supabase-js"

function runSupabaseCliStatus() {
  const raw = execFileSync("npx", ["supabase", "status", "-o", "json"], {
    encoding: "utf8",
    env: { ...process.env, HOME: "/tmp" },
  })
  return JSON.parse(raw)
}

function runSql(sql) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_smart-rt",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-t",
      "-A",
    ],
    { input: sql, encoding: "utf8" }
  ).trim()
}

// Minimal valid 1x1 PNG for local Storage tests
const TINY_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex"
)

test("Resident Community Feed DB security: RLS matrix, tenant isolation, moderation permissions, likes/comments, reports, and private media storage", async () => {
  const status = runSupabaseCliStatus()
  const supabaseUrl = status.API_URL || "http://127.0.0.1:54321"
  const anonKey = status.ANON_KEY
  const serviceRoleKey = status.SERVICE_ROLE_KEY

  assert.ok(anonKey && serviceRoleKey, "Local Supabase keys must exist")

  const adminAuth = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const anonClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const createdUserIds = []
  const createdTenantIds = []
  const uploadedMediaPaths = []
  const runTag = Date.now()
  const password = "TestPassword123!"

  async function createActor(label) {
    const email = `community-feed.${label}.${runTag}@example.com`
    const { data, error } = await adminAuth.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    assert.ok(!error && data?.user, `createUser ${label}: ${error?.message}`)
    createdUserIds.push(data.user.id)

    const client = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error: signInErr } = await client.auth.signInWithPassword({
      email,
      password,
    })
    assert.ok(!signInErr, `signIn ${label}: ${signInErr?.message}`)
    return { user: data.user, client }
  }

  try {
    const ketua = await createActor("ketua")
    const sekre = await createActor("sekre")
    const pengurus = await createActor("pengurus")
    const bendahara = await createActor("bendahara")
    const wargaA = await createActor("wargaa")
    const wargaB = await createActor("wargab")
    const tenant2Ketua = await createActor("t2ketua")
    const superAdmin = await createActor("superadmin")

    const setupRaw = runSql(`
      WITH t AS (
        INSERT INTO public.tenants (code, name, rt_number, rw_number, kelurahan, kecamatan, city, province, status)
        VALUES
          ('rt-cf-a-${runTag}', 'RT Feed A', '051', '005', 'Dago', 'Coblong', 'Bandung', 'Jawa Barat', 'active'),
          ('rt-cf-b-${runTag}', 'RT Feed B', '052', '005', 'Dago', 'Coblong', 'Bandung', 'Jawa Barat', 'active')
        RETURNING id, rt_number
      ),
      prof AS (
        INSERT INTO public.profiles (id, full_name, is_super_admin)
        VALUES
          ('${ketua.user.id}', 'Ketua Feed', false),
          ('${sekre.user.id}', 'Sekre Feed', false),
          ('${pengurus.user.id}', 'Pengurus Feed', false),
          ('${bendahara.user.id}', 'Bendahara Feed', false),
          ('${wargaA.user.id}', 'Warga Feed A', false),
          ('${wargaB.user.id}', 'Warga Feed B', false),
          ('${tenant2Ketua.user.id}', 'Ketua Tenant 2', false),
          ('${superAdmin.user.id}', 'Super Admin Feed', true)
        ON CONFLICT (id) DO UPDATE SET is_super_admin = EXCLUDED.is_super_admin
      ),
      tm AS (
        INSERT INTO public.tenant_members (tenant_id, user_id, resident_id, status)
        VALUES
          ((SELECT id FROM t WHERE rt_number='051'), '${ketua.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='051'), '${sekre.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='051'), '${pengurus.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='051'), '${bendahara.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='051'), '${wargaA.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='051'), '${wargaB.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='052'), '${tenant2Ketua.user.id}', NULL, 'active')
        RETURNING id, tenant_id, user_id
      ),
      mr AS (
        INSERT INTO public.member_roles (tenant_id, member_id, role_id)
        SELECT tm.tenant_id, tm.id, rl.id
        FROM tm
        JOIN (VALUES
          ('${ketua.user.id}', 'ketua_rt'),
          ('${sekre.user.id}', 'sekretaris'),
          ('${pengurus.user.id}', 'pengurus'),
          ('${bendahara.user.id}', 'bendahara'),
          ('${wargaA.user.id}', 'warga'),
          ('${wargaB.user.id}', 'warga'),
          ('${tenant2Ketua.user.id}', 'ketua_rt')
        ) AS m(uid, rname) ON m.uid::uuid = tm.user_id
        JOIN public.roles rl ON rl.code = m.rname
      )
      SELECT json_build_object(
        't1', (SELECT id FROM t WHERE rt_number='051'),
        't2', (SELECT id FROM t WHERE rt_number='052'),
        'ketuaMemberId', (SELECT id FROM tm WHERE user_id = '${ketua.user.id}'),
        'sekreMemberId', (SELECT id FROM tm WHERE user_id = '${sekre.user.id}'),
        'pengurusMemberId', (SELECT id FROM tm WHERE user_id = '${pengurus.user.id}'),
        'bendaharaMemberId', (SELECT id FROM tm WHERE user_id = '${bendahara.user.id}'),
        'wargaAMemberId', (SELECT id FROM tm WHERE user_id = '${wargaA.user.id}'),
        'wargaBMemberId', (SELECT id FROM tm WHERE user_id = '${wargaB.user.id}'),
        't2KetuaMemberId', (SELECT id FROM tm WHERE user_id = '${tenant2Ketua.user.id}')
      )::text;
    `)

    const fx = JSON.parse(setupRaw)
    createdTenantIds.push(fx.t1, fx.t2)

    // -------------------------------------------------------------------------
    // 1. Direct DML on community_* tables must be denied (no INSERT/UPDATE/DELETE grants)
    // -------------------------------------------------------------------------
    for (const [label, client] of [
      ["ketua", ketua.client],
      ["wargaA", wargaA.client],
      ["superAdmin", superAdmin.client],
    ]) {
      const insPost = await client.from("community_posts").insert({
        tenant_id: fx.t1,
        author_member_id: fx.wargaAMemberId,
        caption: "Direct DML Bypass",
      })
      assert.equal(
        insPost.error?.code,
        "42501",
        `${label} direct INSERT community_posts must fail 42501`
      )
    }

    const anonCreate = await anonClient.rpc("create_community_post", {
      p_tenant_id: fx.t1,
      p_caption: "Anon Post",
    })
    assert.equal(anonCreate.error?.code, "42501", "Anon RPC call must fail")

    // -------------------------------------------------------------------------
    // 2. create_community_post validation & permission matrix
    // -------------------------------------------------------------------------
    const emptyPost = await wargaA.client.rpc("create_community_post", {
      p_tenant_id: fx.t1,
    })
    assert.equal(emptyPost.error?.code, "22023", "Empty post must be rejected")

    const crossTenantCreate = await tenant2Ketua.client.rpc(
      "create_community_post",
      { p_tenant_id: fx.t1, p_caption: "Cross tenant spoof" }
    )
    assert.equal(
      crossTenantCreate.error?.code,
      "42501",
      "Non-member of tenant1 must not create a post there"
    )

    const { data: postAId, error: postAErr } = await wargaA.client.rpc(
      "create_community_post",
      { p_tenant_id: fx.t1, p_caption: "Kerja bakti minggu ini seru!" }
    )
    assert.equal(postAErr, null, `wargaA create post: ${postAErr?.message}`)
    assert.ok(postAId)

    const { data: postBId, error: postBErr } = await wargaB.client.rpc(
      "create_community_post",
      { p_tenant_id: fx.t1, p_caption: "Foto taman RT kemarin" }
    )
    assert.equal(postBErr, null)

    // -------------------------------------------------------------------------
    // 3. Tenant isolation: cross-tenant SELECT must return zero rows
    // -------------------------------------------------------------------------
    assert.equal(
      (await wargaA.client.from("community_posts").select("id").eq("tenant_id", fx.t1))
        .data.length,
      2
    )
    assert.equal(
      (await tenant2Ketua.client.from("community_posts").select("id").eq("tenant_id", fx.t1))
        .data.length,
      0,
      "Tenant2 ketua must not see tenant1 posts"
    )
    assert.equal(
      (await superAdmin.client.from("community_posts").select("id").eq("tenant_id", fx.t1))
        .data.length,
      0,
      "Non-member super_admin must not see tenant1 posts via RLS"
    )

    // -------------------------------------------------------------------------
    // 4. Edit / delete own post only (author-only enforcement)
    // -------------------------------------------------------------------------
    const foreignEdit = await wargaB.client.rpc("update_community_post", {
      p_tenant_id: fx.t1,
      p_post_id: postAId,
      p_caption: "Saya bukan penulisnya",
    })
    assert.equal(
      foreignEdit.error?.code,
      "42501",
      "wargaB must not edit wargaA's post"
    )

    const ownEdit = await wargaA.client.rpc("update_community_post", {
      p_tenant_id: fx.t1,
      p_post_id: postAId,
      p_caption: "Kerja bakti minggu ini seru sekali!",
    })
    assert.equal(ownEdit.error, null, `wargaA edit own post: ${ownEdit.error?.message}`)

    const foreignDelete = await wargaB.client.rpc("soft_delete_community_post", {
      p_tenant_id: fx.t1,
      p_post_id: postAId,
    })
    assert.equal(
      foreignDelete.error?.code,
      "42501",
      "wargaB must not delete wargaA's post"
    )

    // -------------------------------------------------------------------------
    // 5. Likes: toggle, duplicate prevention, cross-tenant rejection
    // -------------------------------------------------------------------------
    const likeA = await wargaA.client.rpc("toggle_community_post_like", {
      p_tenant_id: fx.t1,
      p_post_id: postBId,
      p_desired: true,
    })
    assert.equal(likeA.error, null)
    assert.equal(likeA.data.liked, true)
    assert.equal(likeA.data.like_count, 1)

    // Re-toggling with the same desired state remains idempotent (no duplicate row)
    const likeAAgain = await wargaA.client.rpc("toggle_community_post_like", {
      p_tenant_id: fx.t1,
      p_post_id: postBId,
      p_desired: true,
    })
    assert.equal(likeAAgain.error, null)
    assert.equal(likeAAgain.data.like_count, 1, "Duplicate like must not double-count")

    const likeCountRaw = runSql(
      `SELECT count(*) FROM public.community_post_likes WHERE post_id = '${postBId}';`
    )
    assert.equal(Number(likeCountRaw), 1, "Unique constraint must prevent duplicate like rows")

    const unlikeA = await wargaA.client.rpc("toggle_community_post_like", {
      p_tenant_id: fx.t1,
      p_post_id: postBId,
      p_desired: false,
    })
    assert.equal(unlikeA.error, null)
    assert.equal(unlikeA.data.liked, false)
    assert.equal(unlikeA.data.like_count, 0)

    const crossTenantLike = await tenant2Ketua.client.rpc(
      "toggle_community_post_like",
      { p_tenant_id: fx.t1, p_post_id: postBId }
    )
    assert.equal(
      crossTenantLike.error?.code,
      "42501",
      "Non-member must not like a post in a foreign tenant"
    )

    // -------------------------------------------------------------------------
    // 6. Comments: create, reply, author-only edit/delete, validation
    // -------------------------------------------------------------------------
    const emptyComment = await wargaA.client.rpc("create_community_post_comment", {
      p_tenant_id: fx.t1,
      p_post_id: postBId,
      p_content: "   ",
    })
    assert.equal(emptyComment.error?.code, "22023")

    const { data: commentId, error: commentErr } = await wargaA.client.rpc(
      "create_community_post_comment",
      { p_tenant_id: fx.t1, p_post_id: postBId, p_content: "Keren banget fotonya!" }
    )
    assert.equal(commentErr, null, `wargaA comment: ${commentErr?.message}`)

    const { data: replyId, error: replyErr } = await wargaB.client.rpc(
      "create_community_post_comment",
      {
        p_tenant_id: fx.t1,
        p_post_id: postBId,
        p_content: "Terima kasih warga A!",
        p_parent_comment_id: commentId,
      }
    )
    assert.equal(replyErr, null)
    assert.ok(replyId)

    const foreignCommentEdit = await wargaB.client.rpc(
      "update_community_post_comment",
      { p_tenant_id: fx.t1, p_comment_id: commentId, p_content: "Bajak komentar" }
    )
    assert.equal(
      foreignCommentEdit.error?.code,
      "42501",
      "wargaB must not edit wargaA's comment"
    )

    const foreignCommentDelete = await wargaB.client.rpc(
      "soft_delete_community_post_comment",
      { p_tenant_id: fx.t1, p_comment_id: commentId }
    )
    assert.equal(
      foreignCommentDelete.error?.code,
      "42501",
      "wargaB must not delete wargaA's comment"
    )

    const ownCommentDelete = await wargaA.client.rpc(
      "soft_delete_community_post_comment",
      { p_tenant_id: fx.t1, p_comment_id: commentId }
    )
    assert.equal(ownCommentDelete.error, null)
    assert.equal(ownCommentDelete.data.comment_count, 1, "Only the surviving reply should count")

    // -------------------------------------------------------------------------
    // 7. Reporting: cannot report own content, duplicate pending report blocked
    // -------------------------------------------------------------------------
    const selfReport = await wargaB.client.rpc("report_community_content", {
      p_tenant_id: fx.t1,
      p_target_type: "post",
      p_target_id: postBId,
      p_reason_category: "spam",
    })
    assert.equal(selfReport.error?.code, "22023", "Author must not report own post")

    const { data: reportId, error: reportErr } = await wargaA.client.rpc(
      "report_community_content",
      {
        p_tenant_id: fx.t1,
        p_target_type: "post",
        p_target_id: postBId,
        p_reason_category: "inappropriate",
        p_reason_detail: "Konten tidak relevan",
      }
    )
    assert.equal(reportErr, null, `wargaA report: ${reportErr?.message}`)
    assert.ok(reportId)

    const dupReport = await wargaA.client.rpc("report_community_content", {
      p_tenant_id: fx.t1,
      p_target_type: "post",
      p_target_id: postBId,
      p_reason_category: "spam",
    })
    assert.equal(dupReport.error?.code, "23505", "Duplicate pending report must be blocked")

    // wargaB (non-staff) cannot see reports filed by others against their own content
    assert.equal(
      (await wargaB.client.from("community_post_reports").select("id")).data.length,
      0
    )
    // Staff can see pending reports in their tenant
    assert.equal(
      (await ketua.client.from("community_post_reports").select("id").eq("tenant_id", fx.t1))
        .data.length,
      1
    )

    // -------------------------------------------------------------------------
    // 8. Moderation permission matrix: ONLY ketua_rt/sekretaris/pengurus (never bendahara/warga)
    // -------------------------------------------------------------------------
    for (const [label, client] of [
      ["bendahara", bendahara.client],
      ["wargaA", wargaA.client],
      ["tenant2Ketua", tenant2Ketua.client],
      ["superAdmin", superAdmin.client],
    ]) {
      const denied = await client.rpc("moderate_community_post", {
        p_tenant_id: fx.t1,
        p_post_id: postBId,
        p_action: "hide",
        p_reason: "Mencoba moderasi tanpa izin",
      })
      assert.equal(
        denied.error?.code,
        "42501",
        `${label} must NOT be able to moderate community posts`
      )
    }

    const hideWithoutReason = await pengurus.client.rpc("moderate_community_post", {
      p_tenant_id: fx.t1,
      p_post_id: postBId,
      p_action: "hide",
    })
    assert.equal(hideWithoutReason.error?.code, "22023", "Hiding requires a reason")

    const { error: hideErr } = await pengurus.client.rpc("moderate_community_post", {
      p_tenant_id: fx.t1,
      p_post_id: postBId,
      p_action: "hide",
      p_reason: "Melanggar ketentuan komunitas RT",
      p_report_id: reportId,
    })
    assert.equal(hideErr, null, `pengurus hide post: ${hideErr?.message}`)

    // Hidden post disappears from regular resident SELECT but remains visible to staff
    assert.equal(
      (await wargaA.client.from("community_posts").select("id").eq("id", postBId))
        .data.length,
      0,
      "Hidden post must disappear from resident feed"
    )
    assert.equal(
      (await ketua.client.from("community_posts").select("id").eq("id", postBId))
        .data.length,
      1,
      "Staff must still see hidden posts for moderation"
    )

    // Hiding auto-resolves the triggering pending report
    const reportStatusRaw = runSql(
      `SELECT status FROM public.community_post_reports WHERE id = '${reportId}';`
    )
    assert.equal(reportStatusRaw, "resolved_hidden")

    // Warga cannot restore, only staff can
    const restoreDenied = await wargaA.client.rpc("moderate_community_post", {
      p_tenant_id: fx.t1,
      p_post_id: postBId,
      p_action: "restore",
    })
    assert.equal(restoreDenied.error?.code, "42501")

    const { error: restoreErr } = await sekre.client.rpc("moderate_community_post", {
      p_tenant_id: fx.t1,
      p_post_id: postBId,
      p_action: "restore",
    })
    assert.equal(restoreErr, null, `sekre restore post: ${restoreErr?.message}`)
    assert.equal(
      (await wargaA.client.from("community_posts").select("id").eq("id", postBId))
        .data.length,
      1,
      "Restored post must reappear in resident feed"
    )

    // dismiss_community_report: denied for bendahara/warga, allowed for ketua_rt/sekretaris/pengurus
    const { data: reportId2 } = await wargaA.client.rpc("report_community_content", {
      p_tenant_id: fx.t1,
      p_target_type: "post",
      p_target_id: postBId,
      p_reason_category: "other",
    })
    const dismissDenied = await bendahara.client.rpc("dismiss_community_report", {
      p_tenant_id: fx.t1,
      p_report_id: reportId2,
    })
    assert.equal(dismissDenied.error?.code, "42501")

    const { error: dismissErr } = await ketua.client.rpc("dismiss_community_report", {
      p_tenant_id: fx.t1,
      p_report_id: reportId2,
      p_resolution_note: "Tidak melanggar ketentuan",
    })
    assert.equal(dismissErr, null, `ketua dismiss report: ${dismissErr?.message}`)

    // -------------------------------------------------------------------------
    // 9. Private Storage bucket "community-media": tenant/member path scoping
    // -------------------------------------------------------------------------
    const pathA = `${fx.t1}/${fx.wargaAMemberId}/${crypto.randomUUID()}.png`
    const pathB = `${fx.t1}/${fx.wargaBMemberId}/${crypto.randomUUID()}.png`
    const forgedPath = `${fx.t1}/${fx.wargaAMemberId}/${crypto.randomUUID()}.png`
    uploadedMediaPaths.push(pathA, pathB)

    // wargaB cannot upload into wargaA's member-scoped path segment
    const forgedUpload = await wargaB.client.storage
      .from("community-media")
      .upload(forgedPath, TINY_PNG, { contentType: "image/png" })
    assert.ok(forgedUpload.error, "wargaB must NOT upload into wargaA's media path")

    // wargaA uploads their own photo
    const { error: upAErr } = await wargaA.client.storage
      .from("community-media")
      .upload(pathA, TINY_PNG, { contentType: "image/png" })
    assert.equal(upAErr, null, `wargaA storage upload: ${upAErr?.message}`)

    // Before the post exists, only the uploader can read the orphaned object
    assert.equal(
      (await wargaA.client.storage.from("community-media").download(pathA)).error,
      null,
      "Uploader must read their own pre-publish orphan upload"
    )
    assert.ok(
      (await wargaB.client.storage.from("community-media").download(pathA)).error,
      "Other residents must NOT read an unpublished orphan upload"
    )

    // create_community_post rejects a storage path that does not exist yet
    const missingObject = await wargaB.client.rpc("create_community_post", {
      p_tenant_id: fx.t1,
      p_caption: "Postingan dengan path palsu",
      p_media_items: [
        { storagePath: pathB, mimeType: "image/png", fileSizeBytes: TINY_PNG.length },
      ],
    })
    assert.equal(
      missingObject.error?.code,
      "23503",
      "Referencing a storage object that was never uploaded must fail"
    )

    const { error: upBErr } = await wargaB.client.storage
      .from("community-media")
      .upload(pathB, TINY_PNG, { contentType: "image/png" })
    assert.equal(upBErr, null)

    // create_community_post rejects a media item whose path belongs to a different member
    const mismatchedOwner = await wargaB.client.rpc("create_community_post", {
      p_tenant_id: fx.t1,
      p_caption: "Mencoba pakai foto orang lain",
      p_media_items: [
        { storagePath: pathA, mimeType: "image/png", fileSizeBytes: TINY_PNG.length },
      ],
    })
    assert.equal(mismatchedOwner.error?.code, "42501")

    const { data: postWithMediaId, error: postWithMediaErr } = await wargaB.client.rpc(
      "create_community_post",
      {
        p_tenant_id: fx.t1,
        p_caption: "Foto dengan media asli",
        p_media_items: [
          { storagePath: pathB, mimeType: "image/png", fileSizeBytes: TINY_PNG.length },
        ],
      }
    )
    assert.equal(postWithMediaErr, null, `wargaB post with media: ${postWithMediaErr?.message}`)
    assert.ok(postWithMediaId)

    // Once attached to a published post, any tenant member can view the media; non-members cannot
    assert.equal(
      (await wargaA.client.storage.from("community-media").download(pathB)).error,
      null,
      "Any tenant member must read media on a published post"
    )
    assert.ok(
      (await tenant2Ketua.client.storage.from("community-media").download(pathB)).error,
      "Non-members must NOT read community-media objects from a foreign tenant"
    )

    // -------------------------------------------------------------------------
    // 10. Audit log completeness
    // -------------------------------------------------------------------------
    const auditActionsRaw = runSql(`
      SELECT string_agg(DISTINCT action, ',' ORDER BY action)
      FROM public.audit_logs
      WHERE tenant_id = '${fx.t1}';
    `)
    const auditActions = new Set(auditActionsRaw.split(","))
    for (const expectedAction of [
      "community_post.created",
      "community_post.updated",
      "community_post.moderated_hide",
      "community_post.moderated_restore",
      "community_content.reported",
      "community_report.dismissed",
    ]) {
      assert.ok(auditActions.has(expectedAction), `Missing audit log action: ${expectedAction}`)
    }
  } finally {
    if (uploadedMediaPaths.length > 0) {
      await adminAuth.storage.from("community-media").remove(uploadedMediaPaths)
    }
    if (createdTenantIds.length > 0) {
      const tenantList = createdTenantIds.map((id) => `'${id}'`).join(",")
      runSql(`
        DELETE FROM public.audit_logs WHERE tenant_id IN (${tenantList});
        DELETE FROM public.community_post_reports WHERE tenant_id IN (${tenantList});
        DELETE FROM public.community_post_comments WHERE tenant_id IN (${tenantList});
        DELETE FROM public.community_post_likes WHERE tenant_id IN (${tenantList});
        DELETE FROM public.community_post_media WHERE tenant_id IN (${tenantList});
        DELETE FROM public.community_posts WHERE tenant_id IN (${tenantList});
        DELETE FROM public.member_roles WHERE tenant_id IN (${tenantList});
        DELETE FROM public.tenant_members WHERE tenant_id IN (${tenantList});
        DELETE FROM public.tenants WHERE id IN (${tenantList});
      `)
    }
    for (const uid of createdUserIds) {
      await adminAuth.auth.admin.deleteUser(uid)
    }
  }
})
