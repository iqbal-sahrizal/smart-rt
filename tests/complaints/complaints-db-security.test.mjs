import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
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

test("Step 13.1 DB security: reply attachment check, status history soft-delete privacy, and audit triggers", async () => {
  const status = runSupabaseCliStatus()
  const supabaseUrl = status.API_URL || "http://127.0.0.1:54321"
  const anonKey = status.ANON_KEY
  const serviceRoleKey = status.SERVICE_ROLE_KEY

  assert.ok(anonKey && serviceRoleKey, "Local Supabase keys must exist")

  // Used strictly in test harness to create/delete disposable Auth test accounts
  const adminAuth = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const createdUserIds = []
  const createdTenantIds = []
  const runTag = Date.now()
  const password = "TestPassword123!"

  async function createActor(label) {
    const email = `complaints.13_1.${label}.${runTag}@example.com`
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
    const bendahara = await createActor("bendahara")
    const pengurus = await createActor("pengurus")
    const wargaA = await createActor("wargaa")
    const wargaB = await createActor("wargab")
    const tenant2Ketua = await createActor("t2ketua")
    const superAdmin = await createActor("super")

    const setupRaw = runSql(`
      WITH t AS (
        INSERT INTO public.tenants (code, name, rt_number, rw_number, kelurahan, kecamatan, city, province, status)
        VALUES
          ('rt-131-a-${runTag}', 'RT Keluhan A', '021', '004', 'Dago', 'Coblong', 'Bandung', 'Jawa Barat', 'active'),
          ('rt-131-b-${runTag}', 'RT Keluhan B', '022', '004', 'Dago', 'Coblong', 'Bandung', 'Jawa Barat', 'active')
        RETURNING id, rt_number
      ),
      h AS (
        INSERT INTO public.households (tenant_id, kk_number, address, block_unit, status)
        SELECT t.id, '3273011310000001', 'Jl. Melati No. 21', 'Blok K-21', 'active'
        FROM t
        WHERE t.rt_number = '021'
        RETURNING id, tenant_id
      ),
      r AS (
        INSERT INTO public.residents (tenant_id, household_id, full_name, gender, family_role, residency_status)
        SELECT h.tenant_id, h.id, v.full_name, 'L', 'anak', 'aktif'
        FROM h
        CROSS JOIN (VALUES ('Pelapor Satu'), ('Warga Tetangga')) AS v(full_name)
        RETURNING id, tenant_id, full_name
      ),
      prof AS (
        INSERT INTO public.profiles (id, full_name, is_super_admin)
        VALUES
          ('${ketua.user.id}', 'Ketua 13.1', false),
          ('${sekre.user.id}', 'Sekretaris 13.1', false),
          ('${bendahara.user.id}', 'Bendahara 13.1', false),
          ('${pengurus.user.id}', 'Pengurus 13.1', false),
          ('${wargaA.user.id}', 'Pelapor Satu', false),
          ('${wargaB.user.id}', 'Warga Tetangga', false),
          ('${tenant2Ketua.user.id}', 'Ketua Tenant 2', false),
          ('${superAdmin.user.id}', 'Super Admin 13.1', true)
        ON CONFLICT (id) DO UPDATE SET is_super_admin = EXCLUDED.is_super_admin
      ),
      tm AS (
        INSERT INTO public.tenant_members (tenant_id, user_id, resident_id, status)
        VALUES
          ((SELECT id FROM t WHERE rt_number='021'), '${ketua.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='021'), '${sekre.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='021'), '${bendahara.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='021'), '${pengurus.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='021'), '${wargaA.user.id}', (SELECT id FROM r WHERE full_name='Pelapor Satu'), 'active'),
          ((SELECT id FROM t WHERE rt_number='021'), '${wargaB.user.id}', (SELECT id FROM r WHERE full_name='Warga Tetangga'), 'active'),
          ((SELECT id FROM t WHERE rt_number='022'), '${tenant2Ketua.user.id}', NULL, 'active')
        RETURNING id, tenant_id, user_id
      ),
      mr AS (
        INSERT INTO public.member_roles (tenant_id, member_id, role_id)
        SELECT tm.tenant_id, tm.id, rl.id
        FROM tm
        JOIN (VALUES
          ('${ketua.user.id}', 'ketua_rt'),
          ('${sekre.user.id}', 'sekretaris'),
          ('${bendahara.user.id}', 'bendahara'),
          ('${pengurus.user.id}', 'pengurus'),
          ('${wargaA.user.id}', 'warga'),
          ('${wargaB.user.id}', 'warga'),
          ('${tenant2Ketua.user.id}', 'ketua_rt')
        ) AS m(uid, rname) ON m.uid::uuid = tm.user_id
        JOIN public.roles rl ON rl.code = m.rname
      )
      SELECT json_build_object(
        't1', (SELECT id FROM t WHERE rt_number='021'),
        't2', (SELECT id FROM t WHERE rt_number='022'),
        'wargaAMemberId', (SELECT id FROM tm WHERE user_id='${wargaA.user.id}'),
        'wargaBMemberId', (SELECT id FROM tm WHERE user_id='${wargaB.user.id}'),
        'sekreMemberId', (SELECT id FROM tm WHERE user_id='${sekre.user.id}')
      )::text;
    `)

    const fx = JSON.parse(setupRaw)
    createdTenantIds.push(fx.t1, fx.t2)

    const sensitiveTitle = "RAHASIA_TITEL_BAPAK_BUDI_081234567890"
    const sensitiveDesc = "RAHASIA_DESKRIPSI_NIK_3273011310000001"
    const sensitiveReply = "RAHASIA_BALASAN_KELUHAN_SENSITIF"

    // -------------------------------------------------------------------------
    // 1. Complaint INSERT + Gap C complaint.created audit log
    // -------------------------------------------------------------------------
    // Spoofed reporter_member_id must be rejected by RLS
    const spoofedComplaint = await wargaA.client
      .from("complaints")
      .insert({
        tenant_id: fx.t1,
        reporter_member_id: fx.wargaBMemberId,
        category: "kebersihan",
        title: "Spoof",
        description: "Spoof",
      })
    assert.ok(spoofedComplaint.error, "Spoofed reporter_member_id must fail RLS")

    const { data: complaint, error: complaintErr } = await wargaA.client
      .from("complaints")
      .insert({
        tenant_id: fx.t1,
        reporter_member_id: fx.wargaAMemberId,
        category: "infrastruktur",
        title: sensitiveTitle,
        description: sensitiveDesc,
      })
      .select("id, tenant_id, status, priority")
      .single()

    assert.equal(complaintErr, null, `create complaint failed: ${complaintErr?.message}`)
    assert.equal(complaint.status, "open")
    assert.equal(complaint.priority, "medium")

    const { data: createdAuditRows, error: auditReadErr } = await ketua.client
      .from("audit_logs")
      .select("id, tenant_id, actor_user_id, action, entity_type, entity_id, metadata")
      .eq("tenant_id", fx.t1)
      .eq("entity_type", "complaints")
      .eq("entity_id", complaint.id)
      .eq("action", "complaint.created")

    assert.equal(auditReadErr, null)
    assert.equal(createdAuditRows.length, 1, "Exactly 1 complaint.created audit log expected")
    assert.equal(createdAuditRows[0].actor_user_id, wargaA.user.id)
    assert.equal(createdAuditRows[0].metadata.category, "infrastruktur")
    assert.equal(createdAuditRows[0].metadata.status, "open")
    assert.equal(createdAuditRows[0].metadata.priority, "medium")
    assert.equal(createdAuditRows[0].metadata.has_photo, false)
    const createdMetaJson = JSON.stringify(createdAuditRows[0].metadata)
    assert.ok(!createdMetaJson.includes(sensitiveTitle), "Audit metadata must not contain complaint title")
    assert.ok(!createdMetaJson.includes(sensitiveDesc), "Audit metadata must not contain complaint description")

    // -------------------------------------------------------------------------
    // 2. Gap A: Reply attachments disabled at DB level
    // -------------------------------------------------------------------------
    // Valid reply with omitted attachment_path (NULL default)
    const { data: reporterReply, error: repReplyErr } = await wargaA.client
      .from("complaint_replies")
      .insert({
        tenant_id: fx.t1,
        complaint_id: complaint.id,
        author_member_id: fx.wargaAMemberId,
        message: sensitiveReply,
      })
      .select("id, attachment_path")
      .single()

    assert.equal(repReplyErr, null, `Reporter NULL-attachment reply failed: ${repReplyErr?.message}`)
    assert.equal(reporterReply.attachment_path, null)

    // Valid reply from staff with explicit attachment_path: null
    const { data: staffReply, error: staffReplyErr } = await sekre.client
      .from("complaint_replies")
      .insert({
        tenant_id: fx.t1,
        complaint_id: complaint.id,
        author_member_id: fx.sekreMemberId,
        message: "Segera kami tindak lanjuti",
        attachment_path: null,
      })
      .select("id, attachment_path")
      .single()

    assert.equal(staffReplyErr, null, `Staff NULL-attachment reply failed: ${staffReplyErr?.message}`)
    assert.equal(staffReply.attachment_path, null)

    // Rejected: reporter tries non-NULL attachment_path
    const nonNullReporterReply = await wargaA.client
      .from("complaint_replies")
      .insert({
        tenant_id: fx.t1,
        complaint_id: complaint.id,
        author_member_id: fx.wargaAMemberId,
        message: "Percobaan lampiran",
        attachment_path: `${fx.t1}/${complaint.id}/bukti.jpg`,
      })
    assert.ok(nonNullReporterReply.error, "Non-NULL reply attachment must fail for reporter")
    assert.equal(nonNullReporterReply.error.code, "23514")

    // Rejected: staff tries non-NULL attachment_path and empty-string attachment_path
    const nonNullStaffReply = await sekre.client
      .from("complaint_replies")
      .insert({
        tenant_id: fx.t1,
        complaint_id: complaint.id,
        author_member_id: fx.sekreMemberId,
        message: "Percobaan lampiran staff",
        attachment_path: `${fx.t1}/${complaint.id}/staff.png`,
      })
    assert.ok(nonNullStaffReply.error, "Non-NULL reply attachment must fail for staff")
    assert.equal(nonNullStaffReply.error.code, "23514")

    const emptyStrReply = await wargaA.client
      .from("complaint_replies")
      .insert({
        tenant_id: fx.t1,
        complaint_id: complaint.id,
        author_member_id: fx.wargaAMemberId,
        message: "Percobaan empty string",
        attachment_path: "",
      })
    assert.ok(emptyStrReply.error, "Empty-string reply attachment must fail CHECK constraint")
    assert.equal(emptyStrReply.error.code, "23514")

    // Check Gap C complaint_reply.created audit logs (no PII/message, exact count, true actor)
    const { data: replyAudits, error: replyAuditErr } = await ketua.client
      .from("audit_logs")
      .select("actor_user_id, action, entity_type, entity_id, metadata")
      .eq("tenant_id", fx.t1)
      .eq("entity_type", "complaint_replies")
      .eq("action", "complaint_reply.created")
      .in("entity_id", [reporterReply.id, staffReply.id])

    assert.equal(replyAuditErr, null)
    assert.equal(replyAudits.length, 2, "Exactly 2 complaint_reply.created audit logs expected")
    const repAudit = replyAudits.find((row) => row.entity_id === reporterReply.id)
    const stfAudit = replyAudits.find((row) => row.entity_id === staffReply.id)
    assert.equal(repAudit.actor_user_id, wargaA.user.id)
    assert.equal(stfAudit.actor_user_id, sekre.user.id)
    assert.equal(repAudit.metadata.complaint_id, complaint.id)
    assert.ok(!JSON.stringify(repAudit.metadata).includes(sensitiveReply), "Audit metadata must not contain reply message")

    // -------------------------------------------------------------------------
    // 3. Gap B: Status history privacy before & after soft delete
    // -------------------------------------------------------------------------
    const { error: transitionErr } = await sekre.client.rpc("transition_complaint_status", {
      p_complaint_id: complaint.id,
      p_new_status: "in_progress",
      p_reason: "Petugas menuju lokasi",
    })
    assert.equal(transitionErr, null, `transition_complaint_status failed: ${transitionErr?.message}`)

    // Active complaint: reporter sees history; other resident & cross-tenant see 0 rows; roles see 1 row
    const activeReporterHist = await wargaA.client
      .from("complaint_status_history")
      .select("id, new_status")
      .eq("complaint_id", complaint.id)
    assert.equal(activeReporterHist.error, null)
    assert.equal(activeReporterHist.data.length, 1)

    const activeOtherResidentHist = await wargaB.client
      .from("complaint_status_history")
      .select("id")
      .eq("complaint_id", complaint.id)
    assert.equal(activeOtherResidentHist.error, null)
    assert.equal(activeOtherResidentHist.data.length, 0)

    const activeCrossTenantHist = await tenant2Ketua.client
      .from("complaint_status_history")
      .select("id")
      .eq("complaint_id", complaint.id)
    assert.equal(activeCrossTenantHist.error, null)
    assert.equal(activeCrossTenantHist.data.length, 0)

    for (const [roleLabel, actor] of [
      ["ketua_rt", ketua],
      ["sekretaris", sekre],
      ["bendahara", bendahara],
      ["pengurus", pengurus],
      ["super_admin", superAdmin],
    ]) {
      const res = await actor.client
        .from("complaint_status_history")
        .select("id")
        .eq("complaint_id", complaint.id)
      assert.equal(res.error, null, `${roleLabel} status history select error`)
      assert.equal(res.data.length, 1, `${roleLabel} should see status history while active`)
    }

    // Soft-delete requires staff role; resident call is denied, staff call succeeds
    const residentSoftDel = await wargaA.client.rpc("soft_delete_complaint", {
      p_complaint_id: complaint.id,
      p_reason: "Warga coba hapus",
    })
    assert.ok(residentSoftDel.error, "Resident must not be allowed to soft-delete complaint")
    assert.equal(residentSoftDel.error.code, "42501")

    const { error: softDelErr } = await ketua.client.rpc("soft_delete_complaint", {
      p_complaint_id: complaint.id,
      p_reason: "Dihapus oleh pengurus",
    })
    assert.equal(softDelErr, null, `soft_delete_complaint failed: ${softDelErr?.message}`)

    // After soft delete: reporter MUST receive 0 rows on complaint_status_history (Gap B!)
    const deletedReporterHist = await wargaA.client
      .from("complaint_status_history")
      .select("id")
      .eq("complaint_id", complaint.id)
    assert.equal(deletedReporterHist.error, null)
    assert.equal(
      deletedReporterHist.data.length,
      0,
      "Reporter must NOT read complaint_status_history after complaint soft delete"
    )

    // Other resident & cross-tenant still get 0 rows
    const deletedOtherHist = await wargaB.client
      .from("complaint_status_history")
      .select("id")
      .eq("complaint_id", complaint.id)
    assert.equal(deletedOtherHist.data.length, 0)

    const deletedCrossHist = await tenant2Ketua.client
      .from("complaint_status_history")
      .select("id")
      .eq("complaint_id", complaint.id)
    assert.equal(deletedCrossHist.data.length, 0)

    // Tenant staff roles & super_admin retain existing audit visibility
    for (const [roleLabel, actor] of [
      ["ketua_rt", ketua],
      ["sekretaris", sekre],
      ["bendahara", bendahara],
      ["pengurus", pengurus],
      ["super_admin", superAdmin],
    ]) {
      const res = await actor.client
        .from("complaint_status_history")
        .select("id")
        .eq("complaint_id", complaint.id)
      assert.equal(res.error, null)
      assert.equal(res.data.length, 1, `${roleLabel} audit read remains intact after soft delete`)
    }

    // -------------------------------------------------------------------------
    // 4. Audit log isolation, non-duplication & client write denial
    // -------------------------------------------------------------------------
    const { data: allComplaintAudits } = await ketua.client
      .from("audit_logs")
      .select("action")
      .eq("tenant_id", fx.t1)
      .eq("entity_type", "complaints")
      .eq("entity_id", complaint.id)

    const actions = allComplaintAudits.map((r) => r.action).sort()
    assert.deepEqual(actions, [
      "complaint.created",
      "complaint.soft_deleted",
      "complaint.status_changed",
    ])

    // Direct INSERT into public.audit_logs by authenticated must stay forbidden
    const directAuditInsert = await wargaA.client.from("audit_logs").insert({
      tenant_id: fx.t1,
      actor_user_id: wargaA.user.id,
      action: "complaint.created",
      entity_type: "complaints",
      entity_id: complaint.id,
      metadata: {},
    })
    assert.ok(directAuditInsert.error, "authenticated direct INSERT on audit_logs must fail")
    assert.equal(directAuditInsert.error.code, "42501")

    // Resident cannot read audit_logs; cross-tenant admin cannot read Tenant 1 audit_logs
    const residentAuditRead = await wargaA.client
      .from("audit_logs")
      .select("id")
      .eq("tenant_id", fx.t1)
    assert.equal(residentAuditRead.error, null)
    assert.equal(residentAuditRead.data.length, 0)

    const crossAuditRead = await tenant2Ketua.client
      .from("audit_logs")
      .select("id")
      .eq("tenant_id", fx.t1)
    assert.equal(crossAuditRead.error, null)
    assert.equal(crossAuditRead.data.length, 0)

    // Direct INSERT/UPDATE/DELETE on complaint_status_history must remain denied for staff
    const directHistInsert = await sekre.client.from("complaint_status_history").insert({
      tenant_id: fx.t1,
      complaint_id: complaint.id,
      changed_by_member_id: fx.sekreMemberId,
      previous_status: "open",
      new_status: "resolved",
    })
    assert.ok(directHistInsert.error, "authenticated direct INSERT on complaint_status_history must fail")
    assert.equal(directHistInsert.error.code, "42501")
  } finally {
    if (createdTenantIds.length > 0) {
      const tenantList = createdTenantIds.map((id) => `'${id}'`).join(",")
      runSql(`
        DELETE FROM public.audit_logs WHERE tenant_id IN (${tenantList});
        DELETE FROM public.complaint_status_history WHERE tenant_id IN (${tenantList});
        DELETE FROM public.complaint_replies WHERE tenant_id IN (${tenantList});
        DELETE FROM public.complaints WHERE tenant_id IN (${tenantList});
        DELETE FROM public.member_roles WHERE tenant_id IN (${tenantList});
        DELETE FROM public.tenant_members WHERE tenant_id IN (${tenantList});
        DELETE FROM public.residents WHERE tenant_id IN (${tenantList});
        DELETE FROM public.households WHERE tenant_id IN (${tenantList});
        DELETE FROM public.tenants WHERE id IN (${tenantList});
      `)
    }
    for (const uid of createdUserIds) {
      await adminAuth.auth.admin.deleteUser(uid)
    }
  }
})
