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

test("Step 15.1 DB security: activities permission matrix, capacity concurrency, eligibility, snapshots, storage & audit logs", async () => {
  const status = runSupabaseCliStatus()
  const supabaseUrl = status.API_URL || "http://127.0.0.1:54321"
  const anonKey = status.ANON_KEY
  const serviceRoleKey = status.SERVICE_ROLE_KEY

  assert.ok(anonKey && serviceRoleKey, "Local Supabase keys must exist")

  // Used strictly in test harness to create/delete disposable Auth accounts and remove test Storage objects
  const adminAuth = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const anonClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const createdUserIds = []
  const createdTenantIds = []
  const uploadedDocPaths = []
  const runTag = Date.now()
  const password = "TestPassword123!"

  async function createActor(label) {
    const email = `activities.15_1.${label}.${runTag}@example.com`
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
    const wargaC = await createActor("wargac")
    const wargaWalkIn = await createActor("wargawalkin")
    const wargaToDelete = await createActor("wargadel")
    const wargaInactiveRes = await createActor("inactres")
    const wargaDeletedRes = await createActor("delres")
    const wargaInactiveHh = await createActor("inacthh")
    const wargaDeletedHh = await createActor("delhh")
    const tenant2Ketua = await createActor("t2ketua")
    const superAdmin = await createActor("superadmin")

    const setupRaw = runSql(`
      WITH t AS (
        INSERT INTO public.tenants (code, name, rt_number, rw_number, kelurahan, kecamatan, city, province, status)
        VALUES
          ('rt-151-a-${runTag}', 'RT Kegiatan A', '041', '004', 'Dago', 'Coblong', 'Bandung', 'Jawa Barat', 'active'),
          ('rt-151-b-${runTag}', 'RT Kegiatan B', '042', '004', 'Dago', 'Coblong', 'Bandung', 'Jawa Barat', 'active')
        RETURNING id, rt_number
      ),
      h_active AS (
        INSERT INTO public.households (tenant_id, kk_number, address, block_unit, status)
        SELECT t.id, '3273011510000001', 'Jl. Kenanga No. 1', 'Blok K-01', 'active'
        FROM t WHERE t.rt_number = '041'
        RETURNING id, tenant_id
      ),
      h_inactive AS (
        INSERT INTO public.households (tenant_id, kk_number, address, block_unit, status)
        SELECT t.id, '3273011510000002', 'Jl. Kenanga No. 2', 'Blok K-02', 'inactive'
        FROM t WHERE t.rt_number = '041'
        RETURNING id, tenant_id
      ),
      h_deleted AS (
        INSERT INTO public.households (tenant_id, kk_number, address, block_unit, status, deleted_at)
        SELECT t.id, '3273011510000003', 'Jl. Kenanga No. 3', 'Blok K-03', 'active', now()
        FROM t WHERE t.rt_number = '041'
        RETURNING id, tenant_id
      ),
      h_t2 AS (
        INSERT INTO public.households (tenant_id, kk_number, address, block_unit, status)
        SELECT t.id, '3273011510000099', 'Jl. Tetangga No. 9', 'Blok T-09', 'active'
        FROM t WHERE t.rt_number = '042'
        RETURNING id, tenant_id
      ),
      r_active AS (
        INSERT INTO public.residents (tenant_id, household_id, full_name, gender, family_role, residency_status)
        SELECT h.tenant_id, h.id, v.full_name, 'L', 'anak', 'aktif'
        FROM h_active h
        CROSS JOIN (VALUES
          ('Warga Eligible A'),
          ('Warga Eligible B'),
          ('Warga Eligible C'),
          ('Warga WalkIn D'),
          ('Warga ToDelete E')
        ) AS v(full_name)
        RETURNING id, tenant_id, full_name
      ),
      r_inact_res AS (
        INSERT INTO public.residents (tenant_id, household_id, full_name, gender, family_role, residency_status)
        SELECT h.tenant_id, h.id, 'Warga Pindah', 'L', 'anak', 'pindah'
        FROM h_active h
        RETURNING id, tenant_id
      ),
      r_del_res AS (
        INSERT INTO public.residents (tenant_id, household_id, full_name, gender, family_role, residency_status, deleted_at)
        SELECT h.tenant_id, h.id, 'Warga SoftDeleted', 'P', 'anak', 'aktif', now()
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
      r_t2 AS (
        INSERT INTO public.residents (tenant_id, household_id, full_name, gender, family_role, residency_status)
        SELECT h.tenant_id, h.id, 'Warga Tenant 2', 'L', 'kepala_keluarga', 'aktif'
        FROM h_t2 h
        RETURNING id, tenant_id
      ),
      prof AS (
        INSERT INTO public.profiles (id, full_name, is_super_admin)
        VALUES
          ('${ketua.user.id}', 'Ketua 15.1', false),
          ('${sekre.user.id}', 'Sekre 15.1', false),
          ('${pengurus.user.id}', 'Pengurus 15.1', false),
          ('${bendahara.user.id}', 'Bendahara 15.1', false),
          ('${wargaA.user.id}', 'Warga Eligible A', false),
          ('${wargaB.user.id}', 'Warga Eligible B', false),
          ('${wargaC.user.id}', 'Warga Eligible C', false),
          ('${wargaWalkIn.user.id}', 'Warga WalkIn D', false),
          ('${wargaToDelete.user.id}', 'Warga ToDelete E', false),
          ('${wargaInactiveRes.user.id}', 'Warga Pindah', false),
          ('${wargaDeletedRes.user.id}', 'Warga SoftDeleted', false),
          ('${wargaInactiveHh.user.id}', 'Warga KK Inactive', false),
          ('${wargaDeletedHh.user.id}', 'Warga KK Deleted', false),
          ('${tenant2Ketua.user.id}', 'Ketua T2', false),
          ('${superAdmin.user.id}', 'Super Admin 15.1', true)
        ON CONFLICT (id) DO UPDATE SET is_super_admin = EXCLUDED.is_super_admin
      ),
      tm AS (
        INSERT INTO public.tenant_members (tenant_id, user_id, resident_id, status)
        VALUES
          ((SELECT id FROM t WHERE rt_number='041'), '${ketua.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='041'), '${sekre.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='041'), '${pengurus.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='041'), '${bendahara.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='041'), '${wargaA.user.id}', (SELECT id FROM r_active WHERE full_name='Warga Eligible A'), 'active'),
          ((SELECT id FROM t WHERE rt_number='041'), '${wargaB.user.id}', (SELECT id FROM r_active WHERE full_name='Warga Eligible B'), 'active'),
          ((SELECT id FROM t WHERE rt_number='041'), '${wargaC.user.id}', (SELECT id FROM r_active WHERE full_name='Warga Eligible C'), 'active'),
          ((SELECT id FROM t WHERE rt_number='041'), '${wargaWalkIn.user.id}', (SELECT id FROM r_active WHERE full_name='Warga WalkIn D'), 'active'),
          ((SELECT id FROM t WHERE rt_number='041'), '${wargaToDelete.user.id}', (SELECT id FROM r_active WHERE full_name='Warga ToDelete E'), 'active'),
          ((SELECT id FROM t WHERE rt_number='041'), '${wargaInactiveRes.user.id}', (SELECT id FROM r_inact_res), 'active'),
          ((SELECT id FROM t WHERE rt_number='041'), '${wargaDeletedRes.user.id}', (SELECT id FROM r_del_res), 'active'),
          ((SELECT id FROM t WHERE rt_number='041'), '${wargaInactiveHh.user.id}', (SELECT id FROM r_inact_hh), 'active'),
          ((SELECT id FROM t WHERE rt_number='041'), '${wargaDeletedHh.user.id}', (SELECT id FROM r_del_hh), 'active'),
          ((SELECT id FROM t WHERE rt_number='042'), '${tenant2Ketua.user.id}', NULL, 'active')
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
          ('${wargaC.user.id}', 'warga'),
          ('${wargaWalkIn.user.id}', 'warga'),
          ('${wargaToDelete.user.id}', 'warga'),
          ('${wargaInactiveRes.user.id}', 'warga'),
          ('${wargaDeletedRes.user.id}', 'warga'),
          ('${wargaInactiveHh.user.id}', 'warga'),
          ('${wargaDeletedHh.user.id}', 'warga'),
          ('${tenant2Ketua.user.id}', 'ketua_rt')
        ) AS m(uid, rname) ON m.uid::uuid = tm.user_id
        JOIN public.roles rl ON rl.code = m.rname
      )
      SELECT json_build_object(
        't1', (SELECT id FROM t WHERE rt_number='041'),
        't2', (SELECT id FROM t WHERE rt_number='042'),
        'wargaAResId', (SELECT id FROM r_active WHERE full_name='Warga Eligible A'),
        'wargaBResId', (SELECT id FROM r_active WHERE full_name='Warga Eligible B'),
        'wargaCResId', (SELECT id FROM r_active WHERE full_name='Warga Eligible C'),
        'wargaWalkInResId', (SELECT id FROM r_active WHERE full_name='Warga WalkIn D'),
        'wargaToDeleteResId', (SELECT id FROM r_active WHERE full_name='Warga ToDelete E'),
        'inactResId', (SELECT id FROM r_inact_res),
        'delResId', (SELECT id FROM r_del_res),
        'inactHhResId', (SELECT id FROM r_inact_hh),
        'delHhResId', (SELECT id FROM r_del_hh),
        't2ResId', (SELECT id FROM r_t2)
      )::text;
    `)

    const fx = JSON.parse(setupRaw)
    createdTenantIds.push(fx.t1, fx.t2)

    const futureStart = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
    const futureEnd = new Date(Date.now() + 7 * 24 * 3600 * 1000 + 3 * 3600 * 1000).toISOString()
    const futureDeadline = new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString()
    const pastDeadline = new Date(Date.now() - 3600 * 1000).toISOString()

    // -------------------------------------------------------------------------
    // 1. Direct DML on activities & activity_participants must be denied (42501)
    // -------------------------------------------------------------------------
    for (const [label, client] of [
      ["ketua", ketua.client],
      ["sekre", sekre.client],
      ["pengurus", pengurus.client],
      ["bendahara", bendahara.client],
      ["wargaA", wargaA.client],
      ["superAdmin", superAdmin.client],
      ["serviceRole", adminAuth],
    ]) {
      const insAct = await client.from("activities").insert({
        tenant_id: fx.t1,
        title: "Direct DML Bypass",
        location: "Balai RT",
        start_at: futureStart,
        created_by: ketua.user.id,
      })
      assert.equal(insAct.error?.code, "42501", `${label} direct INSERT activities must fail 42501`)

      const insPart = await client.from("activity_participants").insert({
        tenant_id: fx.t1,
        activity_id: crypto.randomUUID(),
        resident_id: fx.wargaAResId,
        resident_name_snapshot: "X",
        household_label_snapshot: "Y",
        rsvp_status: "attending",
      })
      assert.equal(insPart.error?.code, "42501", `${label} direct INSERT activity_participants must fail 42501`)
    }

    // Anon RPC blocked
    const anonCreate = await anonClient.rpc("create_activity", {
      p_tenant_id: fx.t1,
      p_title: "Anon Activity",
      p_location: "Balai",
      p_start_at: futureStart,
    })
    assert.equal(anonCreate.error?.code, "42501", "Anon RPC call must fail")

    // -------------------------------------------------------------------------
    // 2. create_activity & update_activity permission matrix + validation
    // -------------------------------------------------------------------------
    for (const [label, client] of [
      ["pengurus", pengurus.client],
      ["bendahara", bendahara.client],
      ["wargaA", wargaA.client],
      ["tenant2Ketua", tenant2Ketua.client],
      ["superAdmin", superAdmin.client],
    ]) {
      const denied = await client.rpc("create_activity", {
        p_tenant_id: fx.t1,
        p_title: `Denied ${label}`,
        p_location: "Balai RT",
        p_start_at: futureStart,
      })
      assert.equal(denied.error?.code, "42501", `${label} must NOT create activity`)
    }

    // Validation failures leave no partial audit logs
    const badCategory = await ketua.client.rpc("create_activity", {
      p_tenant_id: fx.t1,
      p_title: "Invalid Category",
      p_location: "Balai RT",
      p_start_at: futureStart,
      p_category: "konser",
    })
    assert.equal(badCategory.error?.code, "22023")

    const badDateRange = await ketua.client.rpc("create_activity", {
      p_tenant_id: fx.t1,
      p_title: "Invalid Range",
      p_location: "Balai RT",
      p_start_at: futureEnd,
      p_end_at: futureStart,
    })
    assert.equal(badDateRange.error?.code, "22023")

    const badDeadline = await ketua.client.rpc("create_activity", {
      p_tenant_id: fx.t1,
      p_title: "Invalid Deadline",
      p_location: "Balai RT",
      p_start_at: futureStart,
      p_end_at: futureEnd,
      p_registration_deadline: new Date(Date.now() + 9 * 24 * 3600 * 1000).toISOString(),
    })
    assert.equal(badDeadline.error?.code, "22023")

    const failedAuditCount = Number(
      runSql(`SELECT count(*) FROM public.audit_logs WHERE tenant_id = '${fx.t1}';`)
    )
    assert.equal(failedAuditCount, 0, "Failed create_activity calls must rollback cleanly with 0 audit logs")

    // Happy create by ketua_rt and sekretaris
    const { data: actMainId, error: createMainErr } = await ketua.client.rpc("create_activity", {
      p_tenant_id: fx.t1,
      p_title: "Kerja Bakti Minggu",
      p_location: "Lapangan Blok K",
      p_start_at: futureStart,
      p_description: "Membersihkan selokan bersama",
      p_category: "kerja_bakti",
      p_end_at: futureEnd,
      p_allow_self_registration: true,
      p_max_participants: 5,
      p_registration_deadline: futureDeadline,
    })
    assert.equal(createMainErr, null, `ketua create_activity: ${createMainErr?.message}`)
    assert.ok(actMainId)

    const { data: actSekreId, error: createSekreErr } = await sekre.client.rpc("create_activity", {
      p_tenant_id: fx.t1,
      p_title: "Rapat Pengurus Bulanan",
      p_location: "Balai Warga",
      p_start_at: futureStart,
      p_category: "rapat",
      p_allow_self_registration: false,
    })
    assert.equal(createSekreErr, null, `sekre create_activity: ${createSekreErr?.message}`)

    // Direct UPDATE/DELETE denied even to owner
    assert.equal(
      (await ketua.client.from("activities").update({ title: "Bypass" }).eq("id", actMainId)).error?.code,
      "42501"
    )
    assert.equal(
      (await ketua.client.from("activities").delete().eq("id", actMainId)).error?.code,
      "42501"
    )

    // update_activity allowed ONLY for ketua_rt & sekretaris
    for (const [label, client] of [
      ["pengurus", pengurus.client],
      ["bendahara", bendahara.client],
      ["wargaA", wargaA.client],
      ["tenant2Ketua", tenant2Ketua.client],
      ["superAdmin", superAdmin.client],
    ]) {
      const updDenied = await client.rpc("update_activity", {
        p_activity_id: actMainId,
        p_title: "Illegal Update",
        p_location: "Nowhere",
        p_start_at: futureStart,
      })
      assert.equal(updDenied.error?.code, "42501", `${label} must NOT update activity`)
    }

    const { error: updOkErr } = await sekre.client.rpc("update_activity", {
      p_activity_id: actMainId,
      p_title: "Kerja Bakti Lingkungan",
      p_location: "Lapangan Blok K",
      p_start_at: futureStart,
      p_description: "Membawa perlengkapan kebersihan",
      p_category: "kerja_bakti",
      p_end_at: futureEnd,
      p_allow_self_registration: true,
      p_max_participants: 4,
      p_registration_deadline: futureDeadline,
    })
    assert.equal(updOkErr, null, `sekre update_activity: ${updOkErr?.message}`)

    // -------------------------------------------------------------------------
    // 3. SELECT RLS & get_activity_registration_counts isolation
    // -------------------------------------------------------------------------
    assert.equal((await ketua.client.from("activities").select("id").eq("tenant_id", fx.t1)).data.length, 2)
    assert.equal((await sekre.client.from("activities").select("id").eq("tenant_id", fx.t1)).data.length, 2)
    assert.equal((await pengurus.client.from("activities").select("id").eq("tenant_id", fx.t1)).data.length, 2)
    assert.equal((await wargaA.client.from("activities").select("id").eq("tenant_id", fx.t1)).data.length, 2)
    assert.equal((await bendahara.client.from("activities").select("id").eq("tenant_id", fx.t1)).data.length, 0)
    assert.equal((await tenant2Ketua.client.from("activities").select("id").eq("tenant_id", fx.t1)).data.length, 0)
    assert.equal((await superAdmin.client.from("activities").select("id").eq("tenant_id", fx.t1)).data.length, 0)

    assert.equal((await bendahara.client.rpc("get_activity_registration_counts", { p_activity_ids: [actMainId] })).data.length, 0)
    assert.equal((await tenant2Ketua.client.rpc("get_activity_registration_counts", { p_activity_ids: [actMainId] })).data.length, 0)
    assert.equal((await superAdmin.client.rpc("get_activity_registration_counts", { p_activity_ids: [actMainId] })).data.length, 0)
    assert.equal((await wargaA.client.rpc("get_activity_registration_counts", { p_activity_ids: [actMainId] })).data[0].active_count, 0)

    // -------------------------------------------------------------------------
    // 4. Self-registration, eligibility, closed registration, deadline, cancel & re-register
    // -------------------------------------------------------------------------
    // Ineligible residents blocked
    for (const [label, client] of [
      ["ketuaNoResident", ketua.client],
      ["pengurusNoResident", pengurus.client],
      ["bendahara", bendahara.client],
      ["wargaInactiveRes", wargaInactiveRes.client],
      ["wargaDeletedRes", wargaDeletedRes.client],
      ["wargaInactiveHh", wargaInactiveHh.client],
      ["wargaDeletedHh", wargaDeletedHh.client],
      ["tenant2Ketua", tenant2Ketua.client],
      ["superAdmin", superAdmin.client],
    ]) {
      const regDenied = await client.rpc("register_for_activity", {
        p_activity_id: actMainId,
      })
      assert.equal(regDenied.error?.code, "42501", `${label} must NOT self-register`)
    }

    // Closed self-registration rejected
    const closedReg = await wargaA.client.rpc("register_for_activity", {
      p_activity_id: actSekreId,
    })
    assert.equal(closedReg.error?.code, "22023")

    // Happy self-registration by wargaA
    const { data: regA, error: regAErr } = await wargaA.client.rpc("register_for_activity", {
      p_activity_id: actMainId,
      p_notes: "Bawa sapu lidi",
    })
    assert.equal(regAErr, null, `wargaA register: ${regAErr?.message}`)
    assert.equal(regA[0].rsvp_status, "attending")

    // Duplicate registration rejected (23505)
    const dupReg = await wargaA.client.rpc("register_for_activity", {
      p_activity_id: actMainId,
    })
    assert.equal(dupReg.error?.code, "23505")

    // Snapshot saved & warga participant SELECT isolation
    const { data: partsAsWargaA } = await wargaA.client
      .from("activity_participants")
      .select("id, resident_name_snapshot, household_label_snapshot, rsvp_status")
      .eq("activity_id", actMainId)
    assert.equal(partsAsWargaA.length, 1)
    assert.equal(partsAsWargaA[0].resident_name_snapshot, "Warga Eligible A")
    assert.equal(partsAsWargaA[0].household_label_snapshot, "Blok K-01")

    // wargaB has not registered yet -> sees 0 rows on activity_participants, sees count = 1 via aggregate RPC
    assert.equal(
      (await wargaB.client.from("activity_participants").select("id").eq("activity_id", actMainId)).data.length,
      0
    )
    assert.equal(
      (await wargaB.client.rpc("get_activity_registration_counts", { p_activity_ids: [actMainId] })).data[0].active_count,
      1
    )

    // Self-cancel & re-register
    const { data: cancelA, error: cancelAErr } = await wargaA.client.rpc("cancel_activity_registration", {
      p_activity_id: actMainId,
      p_reason: "Ada keperluan keluarga",
    })
    assert.equal(cancelAErr, null, `wargaA cancel: ${cancelAErr?.message}`)
    assert.equal(cancelA[0].rsvp_status, "cancelled")

    // Double-cancel rejected (22023)
    assert.equal(
      (await wargaA.client.rpc("cancel_activity_registration", { p_activity_id: actMainId })).error?.code,
      "22023"
    )

    // Quota count drops to 0, then re-register works cleanly
    assert.equal(
      (await wargaB.client.rpc("get_activity_registration_counts", { p_activity_ids: [actMainId] })).data[0].active_count,
      0
    )
    const { data: reRegA, error: reRegAErr } = await wargaA.client.rpc("register_for_activity", {
      p_activity_id: actMainId,
      p_notes: "Jadi ikut lagi",
    })
    assert.equal(reRegAErr, null, `wargaA re-register: ${reRegAErr?.message}`)
    assert.equal(reRegA[0].rsvp_status, "attending")

    // Reducing max_participants below active_count (1) rejected (23514)
    const reduceMaxErr = await ketua.client.rpc("update_activity", {
      p_activity_id: actSekreId, // 0 participants, fine if >0; test on actMainId after adding 2nd
      p_title: "Rapat Pengurus Bulanan",
      p_location: "Balai Warga",
      p_start_at: futureStart,
    })
    assert.equal(reduceMaxErr.error, null)

    // Expired deadline activity cannot accept registrations
    const { data: actPastDeadlineId, error: pastErr } = await ketua.client.rpc("create_activity", {
      p_tenant_id: fx.t1,
      p_title: "Senam Pagi",
      p_location: "Taman RT",
      p_start_at: futureStart,
      p_end_at: futureEnd,
      p_registration_deadline: pastDeadline,
    })
    assert.equal(pastErr, null)
    const pastRegAttempt = await wargaA.client.rpc("register_for_activity", {
      p_activity_id: actPastDeadlineId,
    })
    assert.equal(pastRegAttempt.error?.code, "22023", "Expired registration_deadline must block registration")

    // -------------------------------------------------------------------------
    // 5. Concurrent capacity race condition test (max_participants = 1, 3 concurrent callers)
    // -------------------------------------------------------------------------
    const { data: actRaceId, error: raceCreateErr } = await ketua.client.rpc("create_activity", {
      p_tenant_id: fx.t1,
      p_title: "Pelatihan Terbatas",
      p_location: "Pos RT",
      p_start_at: futureStart,
      p_max_participants: 1,
    })
    assert.equal(raceCreateErr, null)

    const raceResults = await Promise.all([
      wargaA.client.rpc("register_for_activity", { p_activity_id: actRaceId }),
      wargaB.client.rpc("register_for_activity", { p_activity_id: actRaceId }),
      wargaC.client.rpc("register_for_activity", { p_activity_id: actRaceId }),
    ])
    const raceSuccesses = raceResults.filter((r) => !r.error)
    const raceCapFailures = raceResults.filter((r) => r.error?.code === "23514")
    assert.equal(raceSuccesses.length, 1, "Strictly 1 concurrent resident may win the last seat")
    assert.equal(raceCapFailures.length, 2, "Remaining 2 concurrent callers must fail with 23514")
    assert.equal(
      (await ketua.client.rpc("get_activity_registration_counts", { p_activity_ids: [actRaceId] })).data[0].active_count,
      1
    )

    // -------------------------------------------------------------------------
    // 6. Admin manual enrollment, removal, attendance, & pengurus boundaries
    // -------------------------------------------------------------------------
    // add_activity_participant allowed ONLY for ketua_rt & sekretaris
    for (const [label, client] of [
      ["pengurus", pengurus.client],
      ["bendahara", bendahara.client],
      ["wargaA", wargaA.client],
      ["tenant2Ketua", tenant2Ketua.client],
      ["superAdmin", superAdmin.client],
    ]) {
      const addDenied = await client.rpc("add_activity_participant", {
        p_activity_id: actMainId,
        p_resident_id: fx.wargaBResId,
      })
      assert.equal(addDenied.error?.code, "42501", `${label} must NOT add participant`)
    }

    // Ineligible / cross-tenant resident rejected by add_activity_participant
    for (const badResId of [fx.inactResId, fx.delResId, fx.inactHhResId, fx.delHhResId, fx.t2ResId]) {
      const badAdd = await ketua.client.rpc("add_activity_participant", {
        p_activity_id: actMainId,
        p_resident_id: badResId,
      })
      assert.equal(badAdd.error?.code, "23503", `Ineligible/cross-tenant resident ${badResId} must fail 23503`)
    }

    const { error: addBErr } = await sekre.client.rpc("add_activity_participant", {
      p_activity_id: actMainId,
      p_resident_id: fx.wargaBResId,
      p_rsvp_status: "attending",
      p_notes: "Koordinator konsumsi",
    })
    assert.equal(addBErr, null, `sekre add_activity_participant: ${addBErr?.message}`)

    // Updating max_participants below active count (2) now rejected with 23514
    const lowerMaxErr = await ketua.client.rpc("update_activity", {
      p_activity_id: actMainId,
      p_title: "Kerja Bakti Lingkungan",
      p_location: "Lapangan Blok K",
      p_start_at: futureStart,
      p_max_participants: 1,
    })
    assert.equal(lowerMaxErr.error?.code, "23514", "Cannot lower max_participants below active seats")

    // Add & remove wargaC participant (pengurus denied remove)
    const { data: manualPartCId, error: addCErr } = await ketua.client.rpc("add_activity_participant", {
      p_activity_id: actMainId,
      p_resident_id: fx.wargaCResId,
      p_rsvp_status: "invited",
    })
    assert.equal(addCErr, null)

    assert.equal(
      (await pengurus.client.rpc("remove_activity_participant", {
        p_activity_id: actMainId,
        p_participant_id: manualPartCId,
      })).error?.code,
      "42501",
      "pengurus must NOT remove participant"
    )

    const { error: remCErr } = await ketua.client.rpc("remove_activity_participant", {
      p_activity_id: actMainId,
      p_participant_id: manualPartCId,
      p_reason: "Salah input",
    })
    assert.equal(remCErr, null)

    // Pengurus CAN transition scheduled -> ongoing and record attendance (including walk-in)
    assert.equal(
      (await pengurus.client.rpc("transition_activity_status", {
        p_activity_id: actMainId,
        p_new_status: "cancelled",
        p_reason: "Pengurus mencoba batalkan",
      })).error?.code,
      "42501",
      "pengurus must NOT cancel activity"
    )
    assert.equal(
      (await pengurus.client.rpc("soft_delete_activity", {
        p_activity_id: actMainId,
        p_reason: "Pengurus mencoba hapus",
      })).error?.code,
      "42501",
      "pengurus must NOT soft delete activity"
    )

    const { error: ongoingErr } = await pengurus.client.rpc("transition_activity_status", {
      p_activity_id: actMainId,
      p_new_status: "ongoing",
    })
    assert.equal(ongoingErr, null, `pengurus transition to ongoing: ${ongoingErr?.message}`)

    // Attendance: unauthorized blocked, pengurus allowed on existing + walk-in eligible resident
    for (const [label, client] of [
      ["bendahara", bendahara.client],
      ["wargaA", wargaA.client],
      ["tenant2Ketua", tenant2Ketua.client],
      ["superAdmin", superAdmin.client],
    ]) {
      const attDenied = await client.rpc("record_activity_attendance", {
        p_activity_id: actMainId,
        p_resident_id: fx.wargaAResId,
        p_rsvp_status: "attended",
      })
      assert.equal(attDenied.error?.code, "42501", `${label} must NOT record attendance`)
    }

    assert.equal(
      (await pengurus.client.rpc("record_activity_attendance", {
        p_activity_id: actMainId,
        p_resident_id: fx.wargaAResId,
        p_rsvp_status: "attended",
      })).error,
      null
    )
    assert.equal(
      (await pengurus.client.rpc("record_activity_attendance", {
        p_activity_id: actMainId,
        p_resident_id: fx.wargaWalkInResId,
        p_rsvp_status: "attended",
      })).error,
      null
    )
    assert.equal(
      (await pengurus.client.rpc("record_activity_attendance", {
        p_activity_id: actMainId,
        p_resident_id: fx.wargaBResId,
        p_rsvp_status: "absent",
      })).error,
      null
    )

    // Pengurus/sekre/ketua see all participants; bendahara/tenant2/superAdmin see 0; wargaA sees only own 1
    assert.equal((await pengurus.client.from("activity_participants").select("id").eq("activity_id", actMainId)).data.length, 3)
    assert.equal((await wargaA.client.from("activity_participants").select("id").eq("activity_id", actMainId)).data.length, 1)
    assert.equal((await bendahara.client.from("activity_participants").select("id").eq("activity_id", actMainId)).data.length, 0)
    assert.equal((await tenant2Ketua.client.from("activity_participants").select("id").eq("activity_id", actMainId)).data.length, 0)
    assert.equal((await superAdmin.client.from("activity_participants").select("id").eq("activity_id", actMainId)).data.length, 0)

    // Warga cannot cancel once marked attended
    assert.equal(
      (await wargaA.client.rpc("cancel_activity_registration", { p_activity_id: actMainId })).error?.code,
      "22023"
    )

    // -------------------------------------------------------------------------
    // 7. Storage activity-docs & doc attach/remove permission split
    // -------------------------------------------------------------------------
    const docPathPengurus = `${fx.t1}/${actMainId}/${crypto.randomUUID()}.png`
    const docPathKetua = `${fx.t1}/${actMainId}/${crypto.randomUUID()}.png`
    const docPathDenied = `${fx.t1}/${actMainId}/${crypto.randomUUID()}.png`
    uploadedDocPaths.push(docPathPengurus, docPathKetua)

    // Bendahara, warga, tenant2, superAdmin CANNOT upload
    for (const [label, client] of [
      ["bendahara", bendahara.client],
      ["wargaA", wargaA.client],
      ["tenant2Ketua", tenant2Ketua.client],
      ["superAdmin", superAdmin.client],
    ]) {
      const upDenied = await client.storage.from("activity-docs").upload(docPathDenied, TINY_PNG, {
        contentType: "image/png",
      })
      assert.ok(upDenied.error, `${label} must NOT upload activity doc`)
    }

    // Pengurus & Ketua CAN upload and attach_activity_doc
    const { error: upPengErr } = await pengurus.client.storage.from("activity-docs").upload(docPathPengurus, TINY_PNG, {
      contentType: "image/png",
    })
    assert.equal(upPengErr, null, `pengurus storage upload: ${upPengErr?.message}`)
    assert.equal(
      (await pengurus.client.rpc("attach_activity_doc", {
        p_activity_id: actMainId,
        p_storage_path: docPathPengurus,
      })).error,
      null
    )

    const { error: upKetuaErr } = await ketua.client.storage.from("activity-docs").upload(docPathKetua, TINY_PNG, {
      contentType: "image/png",
    })
    assert.equal(upKetuaErr, null, `ketua storage upload: ${upKetuaErr?.message}`)
    assert.equal(
      (await ketua.client.rpc("attach_activity_doc", {
        p_activity_id: actMainId,
        p_storage_path: docPathKetua,
      })).error,
      null
    )

    // bendahara & warga CANNOT attach_activity_doc
    assert.equal(
      (await bendahara.client.rpc("attach_activity_doc", {
        p_activity_id: actMainId,
        p_storage_path: docPathKetua,
      })).error?.code,
      "42501"
    )
    assert.equal(
      (await wargaA.client.rpc("attach_activity_doc", {
        p_activity_id: actMainId,
        p_storage_path: docPathKetua,
      })).error?.code,
      "42501"
    )

    // Download allowed for ketua, sekre, pengurus, wargaA; DENIED for bendahara, tenant2, superAdmin
    for (const [label, client] of [
      ["ketua", ketua.client],
      ["sekre", sekre.client],
      ["pengurus", pengurus.client],
      ["wargaA", wargaA.client],
    ]) {
      const dl = await client.storage.from("activity-docs").download(docPathPengurus)
      assert.equal(dl.error, null, `${label} must download activity doc: ${dl.error?.message}`)
    }
    for (const [label, client] of [
      ["bendahara", bendahara.client],
      ["tenant2Ketua", tenant2Ketua.client],
      ["superAdmin", superAdmin.client],
    ]) {
      const dl = await client.storage.from("activity-docs").download(docPathPengurus)
      assert.ok(dl.error, `${label} must NOT download activity doc`)
    }

    // remove_activity_doc DENIED for pengurus, bendahara, wargaA; ALLOWED for sekre/ketua
    assert.equal(
      (await pengurus.client.rpc("remove_activity_doc", {
        p_activity_id: actMainId,
        p_storage_path: docPathPengurus,
      })).error?.code,
      "42501",
      "pengurus must NOT remove activity doc"
    )
    const { data: remRes, error: remErr } = await sekre.client.rpc("remove_activity_doc", {
      p_activity_id: actMainId,
      p_storage_path: docPathKetua,
      p_reason: "Foto buram",
    })
    assert.equal(remErr, null, `sekre remove_activity_doc: ${remErr?.message}`)
    assert.ok(remRes?.[0]?.job_id, "remove_activity_doc must enqueue deletion job")

    // Pengurus transitions ongoing -> completed
    assert.equal(
      (await pengurus.client.rpc("transition_activity_status", {
        p_activity_id: actMainId,
        p_new_status: "completed",
      })).error,
      null
    )

    // -------------------------------------------------------------------------
    // 8. Historical Snapshot Preservation on Resident Hard Delete
    // -------------------------------------------------------------------------
    const { data: snapPartId, error: snapAddErr } = await ketua.client.rpc("add_activity_participant", {
      p_activity_id: actSekreId,
      p_resident_id: fx.wargaToDeleteResId,
      p_rsvp_status: "attending",
      p_notes: "Peserta yang akan dihapus datanya",
    })
    assert.equal(snapAddErr, null)

    runSql(`
      DELETE FROM public.tenant_members WHERE resident_id = '${fx.wargaToDeleteResId}';
      DELETE FROM public.residents WHERE id = '${fx.wargaToDeleteResId}';
    `)

    const { data: survivingRow, error: survivingErr } = await ketua.client
      .from("activity_participants")
      .select("id, resident_id, resident_name_snapshot, household_label_snapshot, rsvp_status")
      .eq("id", snapPartId)
      .single()
    assert.equal(survivingErr, null)
    assert.equal(survivingRow.resident_id, null, "resident_id must SET NULL when resident is hard-deleted")
    assert.equal(survivingRow.resident_name_snapshot, "Warga ToDelete E")
    assert.equal(survivingRow.household_label_snapshot, "Blok K-01")

    // -------------------------------------------------------------------------
    // 9. Cancel & Soft Delete Lifecycle + warga visibility removal
    // -------------------------------------------------------------------------
    const { error: cancelActErr } = await ketua.client.rpc("transition_activity_status", {
      p_activity_id: actSekreId,
      p_new_status: "cancelled",
      p_reason: "Hujan deras",
    })
    assert.equal(cancelActErr, null)

    // Cannot upload doc to cancelled activity
    const upCancelled = await ketua.client.storage
      .from("activity-docs")
      .upload(`${fx.t1}/${actSekreId}/${crypto.randomUUID()}.png`, TINY_PNG, { contentType: "image/png" })
    assert.ok(upCancelled.error, "Cannot upload storage object to cancelled activity")

    // soft_delete_activity by ketua hides activity & participants from warga, plus blocks storage download
    assert.equal(
      (await ketua.client.rpc("soft_delete_activity", {
        p_activity_id: actMainId,
        p_reason: "Arsip uji selesai",
      })).error,
      null
    )
    assert.equal(
      (await wargaA.client.from("activities").select("id").eq("id", actMainId)).data.length,
      0,
      "Soft-deleted activity must disappear from warga SELECT"
    )
    assert.equal(
      (await wargaA.client.from("activity_participants").select("id").eq("activity_id", actMainId)).data.length,
      0,
      "Soft-deleted activity participants must disappear from warga SELECT"
    )
    assert.ok(
      (await wargaA.client.storage.from("activity-docs").download(docPathPengurus)).error,
      "Soft-deleted activity storage docs must not be downloadable by warga"
    )

    // -------------------------------------------------------------------------
    // 10. Non-member super_admin rejected by validate_tenant_actor(..., 'member_only')
    //     + Server timestamp & storage guard triggers + Audit Log completeness
    // -------------------------------------------------------------------------
    assert.throws(() => {
      runSql(`
        INSERT INTO public.activities (tenant_id, title, location, start_at, created_by)
        VALUES ('${fx.t1}', 'SuperAdmin Spoof', 'Balai', now() + interval '1 day', '${superAdmin.user.id}');
      `)
    }, /is not a member of tenant/i)

    // Verify forged timestamps on INSERT are overridden by enforce_server_insert_timestamps()
    const forgedCheckRaw = runSql(`
      BEGIN;
      SET LOCAL request.jwt.claim.role = 'authenticated';
      WITH ins AS (
        INSERT INTO public.activities (tenant_id, title, location, start_at, created_by, created_at, updated_at)
        VALUES ('${fx.t1}', 'Timestamp Check', 'Balai', now() + interval '2 days', '${ketua.user.id}', '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z')
        RETURNING created_at, updated_at
      )
      SELECT (created_at > '2020-01-01T00:00:00Z'::timestamptz AND updated_at > '2020-01-01T00:00:00Z'::timestamptz)::text FROM ins;
      COMMIT;
    `)
    assert.equal(forgedCheckRaw.split(/\r?\n/).includes("true"), true, "Forged created_at/updated_at must be overwritten by server trigger")

    // Verify direct documentation_paths tampering without rpc_authorized context is blocked
    assert.throws(() => {
      runSql(`
        UPDATE public.activities
           SET documentation_paths = '["00000000-0000-0000-0000-000000000000/00000000-0000-0000-0000-000000000000/00000000-0000-0000-0000-000000000000.png"]'::jsonb
         WHERE id = '${actSekreId}';
      `)
    }, /documentation_paths|attach_activity_doc|remove_activity_doc/i)

    const auditActionsRaw = runSql(`
      SELECT string_agg(DISTINCT action, ',' ORDER BY action)
      FROM public.audit_logs
      WHERE tenant_id = '${fx.t1}';
    `)
    const auditActions = new Set(auditActionsRaw.split(","))
    for (const expectedAction of [
      "activity.attendance_recorded",
      "activity.created",
      "activity.doc_attached",
      "activity.soft_deleted",
      "activity.status_changed",
      "activity.updated",
      "activity_participant.added",
      "activity_participant.cancelled",
      "activity_participant.registered",
      "activity_participant.removed",
    ]) {
      assert.ok(auditActions.has(expectedAction), `Missing audit log action: ${expectedAction}`)
    }
  } finally {
    if (uploadedDocPaths.length > 0) {
      await adminAuth.storage.from("activity-docs").remove(uploadedDocPaths)
    }
    if (createdTenantIds.length > 0) {
      const tenantList = createdTenantIds.map((id) => `'${id}'`).join(",")
      runSql(`
        DELETE FROM public.storage_deletion_queue WHERE tenant_id IN (${tenantList});
        DELETE FROM public.audit_logs WHERE tenant_id IN (${tenantList});
        DELETE FROM public.activity_participants WHERE tenant_id IN (${tenantList});
        DELETE FROM public.activities WHERE tenant_id IN (${tenantList});
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
