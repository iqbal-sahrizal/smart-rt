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

// Minimal valid 1x1 PNG & %PDF payload for local Storage tests
const TINY_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex"
)
const TINY_PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "utf8")

test("Step 14.1 DB security: letter audit trails, constraints, eligibility, doc limit, sequence & role isolation", async () => {
  const status = runSupabaseCliStatus()
  const supabaseUrl = status.API_URL || "http://127.0.0.1:54321"
  const anonKey = status.ANON_KEY
  const serviceRoleKey = status.SERVICE_ROLE_KEY

  assert.ok(anonKey && serviceRoleKey, "Local Supabase keys must exist")

  // Used strictly in test harness to create/delete disposable Auth accounts and remove test Storage objects
  const adminAuth = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const createdUserIds = []
  const createdTenantIds = []
  const uploadedReqPaths = []
  const uploadedIssuedPaths = []
  const runTag = Date.now()
  const password = "TestPassword123!"

  async function createActor(label) {
    const email = `letters.14_1.${label}.${runTag}@example.com`
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
    const wargaInactiveRes = await createActor("warga_inact_res")
    const wargaDeletedRes = await createActor("warga_del_res")
    const wargaInactiveHh = await createActor("warga_inact_hh")
    const wargaDeletedHh = await createActor("warga_del_hh")
    const tenant2Ketua = await createActor("t2ketua")
    const superAdmin = await createActor("super")

    const setupRaw = runSql(`
      WITH t AS (
        INSERT INTO public.tenants (code, name, rt_number, rw_number, kelurahan, kecamatan, city, province, status)
        VALUES
          ('rt-141-a-${runTag}', 'RT Surat A', '031', '004', 'Dago', 'Coblong', 'Bandung', 'Jawa Barat', 'active'),
          ('rt-141-b-${runTag}', 'RT Surat B', '032', '004', 'Dago', 'Coblong', 'Bandung', 'Jawa Barat', 'active')
        RETURNING id, rt_number
      ),
      h_active AS (
        INSERT INTO public.households (tenant_id, kk_number, address, block_unit, status)
        SELECT t.id, '3273011410000001', 'Jl. Merpati No. 1', 'Blok L-01', 'active'
        FROM t WHERE t.rt_number = '031'
        RETURNING id, tenant_id
      ),
      h_inactive AS (
        INSERT INTO public.households (tenant_id, kk_number, address, block_unit, status)
        SELECT t.id, '3273011410000002', 'Jl. Merpati No. 2', 'Blok L-02', 'inactive'
        FROM t WHERE t.rt_number = '031'
        RETURNING id, tenant_id
      ),
      h_deleted AS (
        INSERT INTO public.households (tenant_id, kk_number, address, block_unit, status, deleted_at)
        SELECT t.id, '3273011410000003', 'Jl. Merpati No. 3', 'Blok L-03', 'active', now()
        FROM t WHERE t.rt_number = '031'
        RETURNING id, tenant_id
      ),
      r_active AS (
        INSERT INTO public.residents (tenant_id, household_id, full_name, gender, family_role, residency_status)
        SELECT h.tenant_id, h.id, v.full_name, 'L', 'anak', 'aktif'
        FROM h_active h
        CROSS JOIN (VALUES ('Warga Eligible A'), ('Warga Tetangga B')) AS v(full_name)
        RETURNING id, tenant_id, full_name
      ),
      r_inact_res AS (
        INSERT INTO public.residents (tenant_id, household_id, full_name, gender, family_role, residency_status)
        SELECT h.tenant_id, h.id, 'Warga Pindah Status', 'L', 'anak', 'pindah'
        FROM h_active h
        RETURNING id, tenant_id
      ),
      r_del_res AS (
        INSERT INTO public.residents (tenant_id, household_id, full_name, gender, family_role, residency_status, deleted_at)
        SELECT h.tenant_id, h.id, 'Warga Soft Deleted', 'P', 'anak', 'aktif', now()
        FROM h_active h
        RETURNING id, tenant_id
      ),
      r_inact_hh AS (
        INSERT INTO public.residents (tenant_id, household_id, full_name, gender, family_role, residency_status)
        SELECT h.tenant_id, h.id, 'Warga KK Inactive', 'L', 'kepala_keluarga', 'aktif'
        FROM h_inactive h
        RETURNING id, tenant_id
      ),
      r_del_hh AS (
        INSERT INTO public.residents (tenant_id, household_id, full_name, gender, family_role, residency_status)
        SELECT h.tenant_id, h.id, 'Warga KK Deleted', 'P', 'kepala_keluarga', 'aktif'
        FROM h_deleted h
        RETURNING id, tenant_id
      ),
      prof AS (
        INSERT INTO public.profiles (id, full_name, is_super_admin)
        VALUES
          ('${ketua.user.id}', 'Ketua 14.1', false),
          ('${sekre.user.id}', 'Sekre 14.1', false),
          ('${pengurus.user.id}', 'Pengurus 14.1', false),
          ('${bendahara.user.id}', 'Bendahara 14.1', false),
          ('${wargaA.user.id}', 'Warga Eligible A', false),
          ('${wargaB.user.id}', 'Warga Tetangga B', false),
          ('${wargaInactiveRes.user.id}', 'Warga Pindah Status', false),
          ('${wargaDeletedRes.user.id}', 'Warga Soft Deleted', false),
          ('${wargaInactiveHh.user.id}', 'Warga KK Inactive', false),
          ('${wargaDeletedHh.user.id}', 'Warga KK Deleted', false),
          ('${tenant2Ketua.user.id}', 'Ketua T2', false),
          ('${superAdmin.user.id}', 'Super Admin 14.1', true)
        ON CONFLICT (id) DO UPDATE SET is_super_admin = EXCLUDED.is_super_admin
      ),
      tm AS (
        INSERT INTO public.tenant_members (tenant_id, user_id, resident_id, status)
        VALUES
          ((SELECT id FROM t WHERE rt_number='031'), '${ketua.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='031'), '${sekre.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='031'), '${pengurus.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='031'), '${bendahara.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='031'), '${wargaA.user.id}', (SELECT id FROM r_active WHERE full_name='Warga Eligible A'), 'active'),
          ((SELECT id FROM t WHERE rt_number='031'), '${wargaB.user.id}', (SELECT id FROM r_active WHERE full_name='Warga Tetangga B'), 'active'),
          ((SELECT id FROM t WHERE rt_number='031'), '${wargaInactiveRes.user.id}', (SELECT id FROM r_inact_res), 'active'),
          ((SELECT id FROM t WHERE rt_number='031'), '${wargaDeletedRes.user.id}', (SELECT id FROM r_del_res), 'active'),
          ((SELECT id FROM t WHERE rt_number='031'), '${wargaInactiveHh.user.id}', (SELECT id FROM r_inact_hh), 'active'),
          ((SELECT id FROM t WHERE rt_number='031'), '${wargaDeletedHh.user.id}', (SELECT id FROM r_del_hh), 'active'),
          ((SELECT id FROM t WHERE rt_number='032'), '${tenant2Ketua.user.id}', NULL, 'active')
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
          ('${wargaInactiveRes.user.id}', 'warga'),
          ('${wargaDeletedRes.user.id}', 'warga'),
          ('${wargaInactiveHh.user.id}', 'warga'),
          ('${wargaDeletedHh.user.id}', 'warga'),
          ('${tenant2Ketua.user.id}', 'ketua_rt')
        ) AS m(uid, rname) ON m.uid::uuid = tm.user_id
        JOIN public.roles rl ON rl.code = m.rname
      )
      SELECT json_build_object(
        't1', (SELECT id FROM t WHERE rt_number='031'),
        't2', (SELECT id FROM t WHERE rt_number='032'),
        'wargaAMemberId', (SELECT id FROM tm WHERE user_id='${wargaA.user.id}'),
        'wargaAResidentId', (SELECT id FROM r_active WHERE full_name='Warga Eligible A'),
        'wargaBMemberId', (SELECT id FROM tm WHERE user_id='${wargaB.user.id}'),
        'wargaBResidentId', (SELECT id FROM r_active WHERE full_name='Warga Tetangga B'),
        'inactResMemberId', (SELECT id FROM tm WHERE user_id='${wargaInactiveRes.user.id}'),
        'inactResId', (SELECT id FROM r_inact_res),
        'delResMemberId', (SELECT id FROM tm WHERE user_id='${wargaDeletedRes.user.id}'),
        'delResId', (SELECT id FROM r_del_res),
        'inactHhMemberId', (SELECT id FROM tm WHERE user_id='${wargaInactiveHh.user.id}'),
        'inactHhResId', (SELECT id FROM r_inact_hh),
        'delHhMemberId', (SELECT id FROM tm WHERE user_id='${wargaDeletedHh.user.id}'),
        'delHhResId', (SELECT id FROM r_del_hh)
      )::text;
    `)

    const fx = JSON.parse(setupRaw)
    createdTenantIds.push(fx.t1, fx.t2)

    const sensitivePurpose = "RAHASIA_KEPERLUAN_NIK_3273011410000001_BUDI_SANTOSO"

    // -------------------------------------------------------------------------
    // 1. Audit trail for letter_types (INSERT / UPDATE / DELETE) + code/name checks
    // -------------------------------------------------------------------------
    // Non-authorized roles cannot manage letter_types
    const pengurusTypeCreate = await pengurus.client.from("letter_types").insert({
      tenant_id: fx.t1,
      code: "TIDAKBOLEH",
      name: "Pengurus Create Blocked",
      required_documents: ["KTP"],
    })
    assert.equal(pengurusTypeCreate.error?.code, "42501")

    const bendaharaTypeCreate = await bendahara.client.from("letter_types").insert({
      tenant_id: fx.t1,
      code: "TIDAKBOLEH2",
      name: "Bendahara Create Blocked",
      required_documents: ["KTP"],
    })
    assert.equal(bendaharaTypeCreate.error?.code, "42501")

    const wargaTypeCreate = await wargaA.client.from("letter_types").insert({
      tenant_id: fx.t1,
      code: "TIDAKBOLEH3",
      name: "Warga Create Blocked",
      required_documents: ["KTP"],
    })
    assert.equal(wargaTypeCreate.error?.code, "42501")

    // Invalid codes & blank names rejected
    const blankCodeErr = await ketua.client.from("letter_types").insert({
      tenant_id: fx.t1,
      code: "   ",
      name: "Valid Name",
      required_documents: [],
    })
    assert.equal(blankCodeErr.error?.code, "23514", "Blank letter_types.code must fail CHECK")

    const symbolOnlyCodeErr = await ketua.client.from("letter_types").insert({
      tenant_id: fx.t1,
      code: "---___",
      name: "Valid Name",
      required_documents: [],
    })
    assert.equal(symbolOnlyCodeErr.error?.code, "23514", "Symbol-only normalized code must fail CHECK")

    const longCodeErr = await ketua.client.from("letter_types").insert({
      tenant_id: fx.t1,
      code: "A".repeat(33),
      name: "Valid Name",
      required_documents: [],
    })
    assert.equal(longCodeErr.error?.code, "23514", "Over 32-char letter_types.code must fail CHECK")

    const blankNameErr = await ketua.client.from("letter_types").insert({
      tenant_id: fx.t1,
      code: "VALID",
      name: "   ",
      required_documents: [],
    })
    assert.equal(blankNameErr.error?.code, "23514", "Blank letter_types.name must fail CHECK")

    // Non-array required_documents rejected
    const nonArrayReqDocsErr = await ketua.client.from("letter_types").insert({
      tenant_id: fx.t1,
      code: "NONARR",
      name: "Non Array Docs",
      required_documents: { doc: "KTP" },
    })
    assert.equal(nonArrayReqDocsErr.error?.code, "23514", "Object required_documents must fail array CHECK")

    // Create active letter type (ketua_rt) and inactive letter type (sekretaris)
    const { data: activeType, error: activeTypeErr } = await ketua.client
      .from("letter_types")
      .insert({
        tenant_id: fx.t1,
        code: "SK-DOM",
        name: "Surat Keterangan Domisili",
        required_documents: ["KTP", "KK"],
        is_active: true,
      })
      .select("id, code, name, is_active")
      .single()
    assert.equal(activeTypeErr, null, `Create active letter_type: ${activeTypeErr?.message}`)

    // Normalized code collision rejected (SK-DOM vs SKDOM / sk dom)
    const dupNormCodeErr = await sekre.client.from("letter_types").insert({
      tenant_id: fx.t1,
      code: "sk dom",
      name: "Duplicate Normalized Code",
      required_documents: [],
    })
    assert.equal(dupNormCodeErr.error?.code, "23505", "Normalized code collision must fail unique index")

    // Create an inactive type and a disposable type for DELETE audit verification
    const { data: inactiveType, error: inactTypeErr } = await sekre.client
      .from("letter_types")
      .insert({
        tenant_id: fx.t1,
        code: "ARSIP_NONAKTIF",
        name: "Arsip Nonaktif",
        required_documents: [],
        is_active: false,
      })
      .select("id, code")
      .single()
    assert.equal(inactTypeErr, null)

    const { data: disposableType, error: dispTypeErr } = await ketua.client
      .from("letter_types")
      .insert({
        tenant_id: fx.t1,
        code: "HAPUS_TEST",
        name: "Untuk Dihapus",
        required_documents: [],
      })
      .select("id")
      .single()
    assert.equal(dispTypeErr, null)

    // Update disposableType -> Delete disposableType
    const { error: updTypeErr } = await sekre.client
      .from("letter_types")
      .update({ name: "Untuk Dihapus Revisi", is_active: false })
      .eq("id", disposableType.id)
    assert.equal(updTypeErr, null)

    const { error: delTypeErr } = await ketua.client
      .from("letter_types")
      .delete()
      .eq("id", disposableType.id)
    assert.equal(delTypeErr, null)

    // Verify letter_type audit events (created, updated, deleted) and deleted audit row persists
    const { data: typeAudits, error: typeAuditsErr } = await ketua.client
      .from("audit_logs")
      .select("action, entity_type, entity_id, actor_user_id, metadata")
      .eq("tenant_id", fx.t1)
      .eq("entity_type", "letter_types")
      .in("entity_id", [activeType.id, disposableType.id])
    assert.equal(typeAuditsErr, null)

    const dispAudits = typeAudits.filter((a) => a.entity_id === disposableType.id)
    assert.deepEqual(
      dispAudits.map((a) => a.action).sort(),
      ["letter_type.created", "letter_type.deleted", "letter_type.updated"]
    )
    const delAudit = dispAudits.find((a) => a.action === "letter_type.deleted")
    assert.equal(delAudit.actor_user_id, ketua.user.id)
    assert.equal(delAudit.metadata?.code, "HAPUS_TEST")

    // -------------------------------------------------------------------------
    // 2. Constraint checks on letter_requests.purpose and supporting_doc_paths
    // -------------------------------------------------------------------------
    const blankPurposeErr = await wargaA.client.from("letter_requests").insert({
      tenant_id: fx.t1,
      letter_type_id: activeType.id,
      resident_id: fx.wargaAResidentId,
      requested_by_member_id: fx.wargaAMemberId,
      purpose: "   ",
    })
    assert.equal(blankPurposeErr.error?.code, "23514", "Blank purpose must fail CHECK")

    const longPurposeErr = await wargaA.client.from("letter_requests").insert({
      tenant_id: fx.t1,
      letter_type_id: activeType.id,
      resident_id: fx.wargaAResidentId,
      requested_by_member_id: fx.wargaAMemberId,
      purpose: "x".repeat(1001),
    })
    assert.equal(longPurposeErr.error?.code, "23514", ">1000 char purpose must fail CHECK")

    const nonArraySuppDocsErr = await wargaA.client.from("letter_requests").insert({
      tenant_id: fx.t1,
      letter_type_id: activeType.id,
      resident_id: fx.wargaAResidentId,
      requested_by_member_id: fx.wargaAMemberId,
      purpose: "Cek valid",
      supporting_doc_paths: { path: "not-array" },
    })
    // supporting_doc_paths cannot be initialized non-empty or non-array by RLS/check
    assert.ok(nonArraySuppDocsErr.error, "Non-array supporting_doc_paths must be rejected")

    // Verify postgres direct SQL ALSO enforces chk_letter_requests_supporting_docs_array (even bypassing storage_ref_ctx guard)
    const directArrayCheck = runSql(`
      DO $$
      BEGIN
        PERFORM set_config('app.storage_ref_ctx', 'rpc_authorized', true);
        INSERT INTO public.letter_requests (
          tenant_id, letter_type_id, resident_id, requested_by_member_id, purpose, supporting_doc_paths
        ) VALUES (
          '${fx.t1}', '${activeType.id}', '${fx.wargaAResidentId}', '${fx.wargaAMemberId}', 'Valid purpose', '{"bad":"obj"}'::jsonb
        );
        PERFORM set_config('app.storage_ref_ctx', '', true);
        RAISE EXCEPTION 'UNEXPECTED_SUCCESS';
      EXCEPTION WHEN check_violation THEN
        PERFORM set_config('app.storage_ref_ctx', '', true);
      END $$;
    `)
    assert.equal(directArrayCheck, "DO")

    // -------------------------------------------------------------------------
    // 3. Resident & Household Eligibility on letter_requests INSERT + spoof protection
    // -------------------------------------------------------------------------
    const ineligibleCases = [
      {
        label: "residency_status = pindah",
        client: wargaInactiveRes.client,
        resId: fx.inactResId,
        memId: fx.inactResMemberId,
      },
      {
        label: "residents.deleted_at IS NOT NULL",
        client: wargaDeletedRes.client,
        resId: fx.delResId,
        memId: fx.delResMemberId,
      },
      {
        label: "households.status = inactive",
        client: wargaInactiveHh.client,
        resId: fx.inactHhResId,
        memId: fx.inactHhMemberId,
      },
      {
        label: "households.deleted_at IS NOT NULL",
        client: wargaDeletedHh.client,
        resId: fx.delHhResId,
        memId: fx.delHhMemberId,
      },
    ]

    for (const c of ineligibleCases) {
      const res = await c.client.from("letter_requests").insert({
        tenant_id: fx.t1,
        letter_type_id: activeType.id,
        resident_id: c.resId,
        requested_by_member_id: c.memId,
        purpose: `Pengajuan ${c.label}`,
      })
      assert.ok(res.error, `Ineligible case (${c.label}) must be rejected by RLS`)
      assert.equal(res.error.code, "42501")
    }

    // Spoofed resident_id / requested_by_member_id by eligible wargaA must fail RLS
    const spoofReq = await wargaA.client.from("letter_requests").insert({
      tenant_id: fx.t1,
      letter_type_id: activeType.id,
      resident_id: fx.wargaBResidentId,
      requested_by_member_id: fx.wargaAMemberId,
      purpose: "Spoof resident_id",
    })
    assert.equal(spoofReq.error?.code, "42501")

    // Inactive letter_type_id must be rejected on INSERT
    const inactTypeReq = await wargaA.client.from("letter_requests").insert({
      tenant_id: fx.t1,
      letter_type_id: inactiveType.id,
      resident_id: fx.wargaAResidentId,
      requested_by_member_id: fx.wargaAMemberId,
      purpose: "Tipe Nonaktif",
    })
    assert.equal(inactTypeReq.error?.code, "42501")

    // Active eligible wargaA creates Request #1 and Request #2
    const { data: req1, error: req1Err } = await wargaA.client
      .from("letter_requests")
      .insert({
        tenant_id: fx.t1,
        letter_type_id: activeType.id,
        resident_id: fx.wargaAResidentId,
        requested_by_member_id: fx.wargaAMemberId,
        purpose: sensitivePurpose,
      })
      .select("id, tenant_id, status, supporting_doc_paths")
      .single()
    assert.equal(req1Err, null, `Create req1: ${req1Err?.message}`)
    assert.equal(req1.status, "submitted")
    assert.deepEqual(req1.supporting_doc_paths, [])

    const { data: req2, error: req2Err } = await wargaA.client
      .from("letter_requests")
      .insert({
        tenant_id: fx.t1,
        letter_type_id: activeType.id,
        resident_id: fx.wargaAResidentId,
        requested_by_member_id: fx.wargaAMemberId,
        purpose: "Pengajuan kedua untuk cancel",
      })
      .select("id")
      .single()
    assert.equal(req2Err, null)

    // Verify 1 letter_request.created audit event, ZERO purpose/resident/NIK/path in metadata
    const { data: reqAudits, error: reqAuditErr } = await ketua.client
      .from("audit_logs")
      .select("id, actor_user_id, action, entity_type, entity_id, metadata")
      .eq("tenant_id", fx.t1)
      .eq("entity_type", "letter_requests")
      .eq("entity_id", req1.id)
      .eq("action", "letter_request.created")
    assert.equal(reqAuditErr, null)
    assert.equal(reqAudits.length, 1, "Must write exactly 1 letter_request.created audit event")
    assert.equal(reqAudits[0].actor_user_id, wargaA.user.id)
    assert.equal(reqAudits[0].metadata?.letter_type_id, activeType.id)
    assert.equal(reqAudits[0].metadata?.status, "submitted")
    const serializedMeta = JSON.stringify(reqAudits[0].metadata)
    assert.ok(!serializedMeta.includes("RAHASIA_KEPERLUAN"), "Audit metadata must not contain purpose")
    assert.ok(!serializedMeta.includes("327301141"), "Audit metadata must not contain NIK/KK")
    assert.ok(!serializedMeta.includes("Warga Eligible"), "Audit metadata must not contain resident name")

    // Direct INSERT into audit_logs by authenticated stays forbidden
    const directAuditErr = await wargaA.client.from("audit_logs").insert({
      tenant_id: fx.t1,
      actor_user_id: wargaA.user.id,
      action: "letter_request.created",
      entity_type: "letter_requests",
      entity_id: req1.id,
      metadata: {},
    })
    assert.equal(directAuditErr.error?.code, "42501")

    // -------------------------------------------------------------------------
    // 4. Supporting doc upload (4 sequential) + Concurrent 5th+6th race + Removal + Cancel
    // -------------------------------------------------------------------------
    const docPaths = []
    for (let i = 0; i < 6; i++) {
      const p = `${fx.t1}/${req1.id}/${crypto.randomUUID()}.png`
      const { error: upErr } = await wargaA.client.storage
        .from("letter-requests")
        .upload(p, TINY_PNG, { contentType: "image/png", upsert: false })
      assert.equal(upErr, null, `Upload doc ${i + 1}: ${upErr?.message}`)
      uploadedReqPaths.push(p)
      docPaths.push(p)
    }

    // Attach first 4 sequentially
    for (let i = 0; i < 4; i++) {
      const { error: attErr } = await wargaA.client.rpc("attach_letter_supporting_doc", {
        p_request_id: req1.id,
        p_storage_path: docPaths[i],
      })
      assert.equal(attErr, null, `Attach doc ${i + 1}: ${attErr?.message}`)
    }

    // Concurrent attempt for 5th & 6th supporting docs: exactly 1 succeeds, 1 fails with 22023
    const [conc5, conc6] = await Promise.all([
      wargaA.client.rpc("attach_letter_supporting_doc", {
        p_request_id: req1.id,
        p_storage_path: docPaths[4],
      }),
      wargaA.client.rpc("attach_letter_supporting_doc", {
        p_request_id: req1.id,
        p_storage_path: docPaths[5],
      }),
    ])
    const raceErrors = [conc5.error, conc6.error].filter(Boolean)
    assert.equal(raceErrors.length, 1, "Concurrent 5th+6th attach must have exactly 1 success and 1 failure")
    assert.equal(raceErrors[0].code, "22023")

    const surviving5thPath = conc5.error ? docPaths[5] : docPaths[4]
    const rejected6thPath = conc5.error ? docPaths[4] : docPaths[5]

    // Sequential 6th attach attempt also fails cleanly with 22023
    const seq6 = await wargaA.client.rpc("attach_letter_supporting_doc", {
      p_request_id: req1.id,
      p_storage_path: rejected6thPath,
    })
    assert.equal(seq6.error?.code, "22023")

    // Verify exact attached doc count is 5
    const { data: afterRaceRow } = await wargaA.client
      .from("letter_requests")
      .select("supporting_doc_paths")
      .eq("id", req1.id)
      .single()
    assert.equal(afterRaceRow.supporting_doc_paths.length, 5)

    // Remove 1 supporting doc cleanly via request_remove_letter_supporting_doc
    const { data: rmData, error: rmErr } = await wargaA.client.rpc(
      "request_remove_letter_supporting_doc",
      {
        p_request_id: req1.id,
        p_storage_path: surviving5thPath,
        p_reason: "test_cleanup_doc",
      }
    )
    assert.equal(rmErr, null, `request_remove_letter_supporting_doc: ${rmErr?.message}`)
    assert.ok(rmData?.length === 1 && rmData[0].job_id, "Must enqueue storage deletion job")

    // Cancel req2 via cancel_letter_request
    const { error: cancelErr } = await wargaA.client.rpc("cancel_letter_request", {
      p_request_id: req2.id,
      p_reason: "Tidak jadi mengurus surat",
    })
    assert.equal(cancelErr, null, `cancel_letter_request: ${cancelErr?.message}`)

    // Non-requester cannot cancel req1
    const nonReqCancel = await wargaB.client.rpc("cancel_letter_request", {
      p_request_id: req1.id,
    })
    assert.equal(nonReqCancel.error?.code, "42501")

    // -------------------------------------------------------------------------
    // 5. Review -> Approve -> Issue Letter PDF + Sequences & Audit verification
    // -------------------------------------------------------------------------
    // Unauthorized roles cannot review
    const pengurusRev = await pengurus.client.rpc("review_letter_request", {
      p_request_id: req1.id,
      p_decision: "reviewing",
    })
    assert.equal(pengurusRev.error?.code, "42501")

    const bendaharaRev = await bendahara.client.rpc("review_letter_request", {
      p_request_id: req1.id,
      p_decision: "reviewing",
    })
    assert.equal(bendaharaRev.error?.code, "42501")

    // Reviewing -> Approved
    const { error: revErr } = await sekre.client.rpc("review_letter_request", {
      p_request_id: req1.id,
      p_decision: "reviewing",
      p_admin_notes: "Berkas diterima sekretaris",
    })
    assert.equal(revErr, null)

    const { error: appErr } = await ketua.client.rpc("review_letter_request", {
      p_request_id: req1.id,
      p_decision: "approved",
      p_admin_notes: "Disetujui Ketua RT",
    })
    assert.equal(appErr, null)

    // Upload issued PDF to issued-letters and issue_letter
    const issuedPdfPath = `${fx.t1}/${req1.id}/${crypto.randomUUID()}.pdf`
    const { error: pdfUpErr } = await ketua.client.storage
      .from("issued-letters")
      .upload(issuedPdfPath, TINY_PDF, { contentType: "application/pdf", upsert: false })
    assert.equal(pdfUpErr, null, `Upload issued PDF: ${pdfUpErr?.message}`)
    uploadedIssuedPaths.push(issuedPdfPath)

    const { data: issuedNum, error: issueErr } = await ketua.client.rpc("issue_letter", {
      p_request_id: req1.id,
      p_storage_path: issuedPdfPath,
    })
    assert.equal(issueErr, null, `issue_letter: ${issueErr?.message}`)
    assert.match(issuedNum, /^001\/SKDOM\/\d{4}$/, `Unexpected letter_number format: ${issuedNum}`)

    const { data: completedReq, error: completedReqErr } = await wargaA.client
      .from("letter_requests")
      .select("status, letter_number, issued_file_path")
      .eq("id", req1.id)
      .single()
    assert.equal(completedReqErr, null, `read completedReq: ${completedReqErr?.message}`)
    assert.equal(completedReq.status, "completed")
    assert.equal(completedReq.letter_number, issuedNum)
    assert.equal(completedReq.issued_file_path, issuedPdfPath)

    // Re-issue and re-review on completed request must be rejected cleanly
    const reissueErr = await ketua.client.rpc("issue_letter", {
      p_request_id: req1.id,
      p_storage_path: `${fx.t1}/${req1.id}/${crypto.randomUUID()}.pdf`,
    })
    assert.equal(reissueErr.error?.code, "22023")

    const rereviewErr = await sekre.client.rpc("review_letter_request", {
      p_request_id: req1.id,
      p_decision: "rejected",
      p_admin_notes: "Tidak bisa reject setelah selesai",
    })
    assert.equal(rereviewErr.error?.code, "22023")

    // -------------------------------------------------------------------------
    // 6. Role Matrix & Privilege Verification (tables, Storage, letter_sequences, service_role)
    // -------------------------------------------------------------------------
    // letter_sequences inaccessible to authenticated
    const authSeqRead = await ketua.client.from("letter_sequences").select("*")
    assert.equal(authSeqRead.error?.code, "42501")

    // service_role has SELECT only on letter_types and letter_sequences, zero DML/TRUNCATE
    const privCheckRaw = runSql(`
      SELECT json_build_object(
        'lt_ins', has_table_privilege('service_role', 'public.letter_types', 'INSERT'),
        'lt_upd', has_table_privilege('service_role', 'public.letter_types', 'UPDATE'),
        'lt_del', has_table_privilege('service_role', 'public.letter_types', 'DELETE'),
        'lt_trn', has_table_privilege('service_role', 'public.letter_types', 'TRUNCATE'),
        'lt_sel', has_table_privilege('service_role', 'public.letter_types', 'SELECT'),
        'ls_ins', has_table_privilege('service_role', 'public.letter_sequences', 'INSERT'),
        'ls_upd', has_table_privilege('service_role', 'public.letter_sequences', 'UPDATE'),
        'ls_del', has_table_privilege('service_role', 'public.letter_sequences', 'DELETE'),
        'ls_trn', has_table_privilege('service_role', 'public.letter_sequences', 'TRUNCATE'),
        'ls_sel', has_table_privilege('service_role', 'public.letter_sequences', 'SELECT')
      )::text;
    `)
    const privs = JSON.parse(privCheckRaw)
    assert.deepEqual(privs, {
      lt_ins: false,
      lt_upd: false,
      lt_del: false,
      lt_trn: false,
      lt_sel: true,
      ls_ins: false,
      ls_upd: false,
      ls_del: false,
      ls_trn: false,
      ls_sel: true,
    })

    // letter_requests SELECT isolation
    assert.equal((await ketua.client.from("letter_requests").select("id").eq("tenant_id", fx.t1)).data.length, 2)
    assert.equal((await sekre.client.from("letter_requests").select("id").eq("tenant_id", fx.t1)).data.length, 2)
    assert.equal((await pengurus.client.from("letter_requests").select("id").eq("tenant_id", fx.t1)).data.length, 2)
    assert.equal((await bendahara.client.from("letter_requests").select("id").eq("tenant_id", fx.t1)).data.length, 0)
    assert.equal((await wargaA.client.from("letter_requests").select("id").eq("tenant_id", fx.t1)).data.length, 2)
    assert.equal((await wargaB.client.from("letter_requests").select("id").eq("tenant_id", fx.t1)).data.length, 0)
    assert.equal((await tenant2Ketua.client.from("letter_requests").select("id").eq("tenant_id", fx.t1)).data.length, 0)
    assert.equal((await superAdmin.client.from("letter_requests").select("id").eq("tenant_id", fx.t1)).data.length, 0)

    // letter_types SELECT isolation (ketua/sekre/pengurus see 2 including inactive; warga sees active only; bendahara/super/T2 see 0)
    assert.equal((await ketua.client.from("letter_types").select("id").eq("tenant_id", fx.t1)).data.length, 2)
    assert.equal((await sekre.client.from("letter_types").select("id").eq("tenant_id", fx.t1)).data.length, 2)
    assert.equal((await pengurus.client.from("letter_types").select("id").eq("tenant_id", fx.t1)).data.length, 2)
    assert.equal((await wargaA.client.from("letter_types").select("id").eq("tenant_id", fx.t1)).data.length, 1)
    assert.equal((await bendahara.client.from("letter_types").select("id").eq("tenant_id", fx.t1)).data.length, 0)
    assert.equal((await tenant2Ketua.client.from("letter_types").select("id").eq("tenant_id", fx.t1)).data.length, 0)
    assert.equal((await superAdmin.client.from("letter_types").select("id").eq("tenant_id", fx.t1)).data.length, 0)

    // Storage download isolation for both letter-requests and issued-letters
    const activeDocPath = docPaths[0]
    for (const [label, client] of [
      ["ketua", ketua.client],
      ["sekre", sekre.client],
      ["wargaA", wargaA.client],
    ]) {
      const dlDoc = await client.storage.from("letter-requests").download(activeDocPath)
      assert.equal(dlDoc.error, null, `${label} must be able to download supporting doc`)
      const dlPdf = await client.storage.from("issued-letters").download(issuedPdfPath)
      assert.equal(dlPdf.error, null, `${label} must be able to download issued PDF`)
    }

    for (const [label, client] of [
      ["pengurus", pengurus.client],
      ["bendahara", bendahara.client],
      ["wargaB", wargaB.client],
      ["tenant2Ketua", tenant2Ketua.client],
      ["superAdmin", superAdmin.client],
    ]) {
      const dlDoc = await client.storage.from("letter-requests").download(activeDocPath)
      assert.ok(dlDoc.error, `${label} must NOT be able to download supporting doc`)
      const dlPdf = await client.storage.from("issued-letters").download(issuedPdfPath)
      assert.ok(dlPdf.error, `${label} must NOT be able to download issued PDF`)
    }
  } finally {
    if (uploadedReqPaths.length > 0) {
      await adminAuth.storage.from("letter-requests").remove(uploadedReqPaths)
    }
    if (uploadedIssuedPaths.length > 0) {
      await adminAuth.storage.from("issued-letters").remove(uploadedIssuedPaths)
    }
    if (createdTenantIds.length > 0) {
      const tenantList = createdTenantIds.map((id) => `'${id}'`).join(",")
      runSql(`
        DELETE FROM public.storage_deletion_queue WHERE tenant_id IN (${tenantList});
        DELETE FROM public.audit_logs WHERE tenant_id IN (${tenantList});
        DELETE FROM public.letter_requests WHERE tenant_id IN (${tenantList});
        DELETE FROM public.letter_sequences WHERE tenant_id IN (${tenantList});
        DELETE FROM public.letter_types WHERE tenant_id IN (${tenantList});
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
