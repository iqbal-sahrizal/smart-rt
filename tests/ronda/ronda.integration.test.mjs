import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { setTimeout as delay } from "node:timers/promises"
import test from "node:test"
import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"

import {
  loadRondaTestModules,
  runSupabaseCliStatus,
} from "./helpers/load-ronda-modules.mjs"

const { repository, schemas } = loadRondaTestModules()

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

async function signInAndCollectCookieHeader(url, anonKey, email, password) {
  const jar = new Map()
  const ssrClient = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return Array.from(jar.entries()).map(([name, value]) => ({
          name,
          value,
        }))
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          if (options?.maxAge === 0 || value === "") {
            jar.delete(name)
          } else {
            jar.set(name, value)
          }
        }
      },
    },
  })

  const { error } = await ssrClient.auth.signInWithPassword({ email, password })
  if (error) {
    throw new Error(`Failed sign-in for ${email}: ${error.message}`)
  }

  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ")
}

async function startNextServer(port, envOverrides) {
  // NEXT_PUBLIC_* variables are inlined into the compiled bundle at `next build`
  // time, not read at runtime, so passing them only to the spawned `next start`
  // process has no effect on an already-built `.next/` output. Rebuild first so
  // the server's client/server auth storage key actually matches this test's
  // local Supabase instance, regardless of what `.env.local` currently points
  // at (e.g. a Cloud staging project). Without this, @supabase/ssr derives its
  // cookie storage key from the project ref baked in at the last build, the
  // test's signed-in cookie is named for the local ref, and every authenticated
  // request fails with 401 (AuthSessionMissingError) before role checks run.
  execFileSync("npx", ["next", "build"], {
    cwd: process.cwd(),
    env: { ...process.env, ...envOverrides },
    stdio: ["ignore", "pipe", "pipe"],
  })

  const proc = spawn("npx", ["next", "start", "-p", String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, ...envOverrides },
    stdio: ["ignore", "pipe", "pipe"],
  })

  const baseUrl = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 30_000
  let ready = false

  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`Next server exited prematurely with code ${proc.exitCode}`)
    }
    try {
      const res = await fetch(`${baseUrl}/login`)
      if (res.status === 200) {
        ready = true
        break
      }
    } catch {
      // retry until server listens
    }
    await delay(250)
  }

  if (!ready) {
    proc.kill("SIGTERM")
    throw new Error("Timed out waiting for Next.js test server to listen")
  }

  return {
    baseUrl,
    stop: async () => {
      proc.kill("SIGTERM")
      await new Promise((resolveStop) => {
        proc.once("exit", resolveStop)
        setTimeout(() => {
          if (proc.exitCode === null) proc.kill("SIGKILL")
          resolveStop()
        }, 3000)
      })
    },
  }
}

async function apiGet(baseUrl, path, cookieHeader) {
  const headers = cookieHeader ? { Cookie: cookieHeader } : {}
  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers,
    redirect: "manual",
  })
  const contentType = res.headers.get("content-type") ?? ""
  const body = contentType.includes("application/json")
    ? await res.json()
    : await res.text()
  return {
    status: res.status,
    location: res.headers.get("location"),
    cacheControl: res.headers.get("cache-control"),
    body,
  }
}

function assertServerRedirect(res, expectedTarget, forbiddenPatterns = []) {
  if (res.status === 307 || res.status === 303 || res.status === 308) {
    assert.ok(
      res.location?.includes(expectedTarget),
      `Expected redirect Location header to include "${expectedTarget}", got "${res.location}"`
    )
    return
  }
  // With Next.js 16 Cache Components / PPR, redirects thrown inside <Suspense>
  // stream a NEXT_REDIRECT marker in the 200 HTML stream.
  assert.equal(res.status, 200, `Expected 307 or PPR 200 stream, got ${res.status}`)
  assert.match(res.body, /NEXT_REDIRECT/)
  assert.ok(
    res.body.includes(expectedTarget),
    `Expected streamed NEXT_REDIRECT payload to reference "${expectedTarget}"`
  )
  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(res.body, pattern)
  }
}

function assertServerNotFound(res, forbiddenPatterns = []) {
  if (res.status === 404) return
  assert.equal(res.status, 200, `Expected 404 or PPR 200 stream, got ${res.status}`)
  assert.match(res.body, /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/)
  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(res.body, pattern)
  }
}

test("Step 12.2 integration: repository, RPCs, API routes, privacy, role matrix, and regressions", async () => {
  const status = runSupabaseCliStatus()
  const supabaseUrl = status.API_URL || "http://127.0.0.1:54321"
  const anonKey = status.ANON_KEY
  const serviceRoleKey = status.SERVICE_ROLE_KEY

  assert.ok(anonKey && serviceRoleKey, "Local Supabase keys must exist")

  const adminAuth = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const createdUserIds = []
  const createdTenantIds = []
  let nextServer = null
  const runTag = Date.now()
  const password = "TestPassword123!"

  async function createActor(label) {
    const email = `ronda.12_2.${label}.${runTag}@example.com`
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

    const cookie = await signInAndCollectCookieHeader(
      supabaseUrl,
      anonKey,
      email,
      password
    )
    return { user: data.user, client, cookie, email }
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
          ('rt-122-a-${runTag}', 'RT Integrasi A', '011', '003', 'Dago', 'Coblong', 'Bandung', 'Jawa Barat', 'active'),
          ('rt-122-b-${runTag}', 'RT Integrasi B', '012', '003', 'Dago', 'Coblong', 'Bandung', 'Jawa Barat', 'active')
        RETURNING id, rt_number
      ),
      h AS (
        INSERT INTO public.households (tenant_id, kk_number, address, block_unit, status, deleted_at)
        SELECT
          t.id,
          v.kk_number,
          v.address,
          v.block_unit,
          v.status,
          CASE WHEN v.is_deleted THEN now() ELSE NULL END
        FROM t
        JOIN (VALUES
          ('011', '3273011220000001', 'Jl. Cempaka No. 11', 'Blok D-11', 'active', false),
          ('011', '3273011220000012', 'Jl. Cempaka No. 12B', 'Blok D-12', 'inactive', false),
          ('011', '3273011220000013', 'Jl. Cempaka No. 13B', 'Blok D-13', 'active', true),
          ('012', '3273011220000002', 'Jl. Cempaka No. 12', 'Blok E-12', 'active', false)
        ) AS v(rt_number, kk_number, address, block_unit, status, is_deleted)
          ON v.rt_number = t.rt_number
        RETURNING id, tenant_id, block_unit
      ),
      r_a AS (
        INSERT INTO public.residents (tenant_id, household_id, full_name, gender, family_role, residency_status, deleted_at)
        SELECT
          h.tenant_id,
          h.id,
          v.full_name,
          'L',
          'anak',
          v.res_status,
          CASE WHEN v.res_deleted THEN now() ELSE NULL END
        FROM h
        JOIN (VALUES
          ('Blok D-11', 'Warga Alpha', 'aktif', false),
          ('Blok D-11', 'Warga Beta', 'aktif', false),
          ('Blok D-11', 'Warga Nonaktif', 'pindah', false),
          ('Blok D-11', 'Warga Res Deleted', 'aktif', true),
          ('Blok D-12', 'Warga HH Inactive', 'aktif', false),
          ('Blok D-13', 'Warga HH Deleted', 'aktif', false)
        ) AS v(block_unit, full_name, res_status, res_deleted)
          ON v.block_unit = h.block_unit
        RETURNING id, tenant_id, full_name, residency_status
      ),
      r_b AS (
        INSERT INTO public.residents (tenant_id, household_id, full_name, gender, family_role, residency_status)
        SELECT tenant_id, id, 'Warga Tenant Dua', 'P', 'kepala_keluarga', 'aktif'
        FROM h
        WHERE block_unit = 'Blok E-12'
        RETURNING id, tenant_id
      ),
      prof AS (
        INSERT INTO public.profiles (id, full_name, is_super_admin)
        VALUES
          ('${ketua.user.id}', 'Ketua 12.2', false),
          ('${sekre.user.id}', 'Sekretaris 12.2', false),
          ('${bendahara.user.id}', 'Bendahara 12.2', false),
          ('${pengurus.user.id}', 'Pengurus 12.2', false),
          ('${wargaA.user.id}', 'Warga Alpha', false),
          ('${wargaB.user.id}', 'Warga Beta', false),
          ('${tenant2Ketua.user.id}', 'Ketua Tenant 2', false),
          ('${superAdmin.user.id}', 'Super Admin NonMember', true)
        ON CONFLICT (id) DO UPDATE SET is_super_admin = EXCLUDED.is_super_admin
      ),
      tm AS (
        INSERT INTO public.tenant_members (tenant_id, user_id, resident_id, status)
        VALUES
          ((SELECT id FROM t WHERE rt_number='011'), '${ketua.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='011'), '${sekre.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='011'), '${bendahara.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='011'), '${pengurus.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='011'), '${wargaA.user.id}', (SELECT id FROM r_a WHERE full_name='Warga Alpha'), 'active'),
          ((SELECT id FROM t WHERE rt_number='011'), '${wargaB.user.id}', (SELECT id FROM r_a WHERE full_name='Warga Beta'), 'active'),
          ((SELECT id FROM t WHERE rt_number='012'), '${tenant2Ketua.user.id}', NULL, 'active')
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
        ) AS rm(uid, rcode) ON rm.uid::uuid = tm.user_id
        JOIN public.roles rl ON rl.code = rm.rcode
      )
      SELECT json_build_object(
        't1', (SELECT id FROM t WHERE rt_number='011'),
        't2', (SELECT id FROM t WHERE rt_number='012'),
        'rA', (SELECT id FROM r_a WHERE full_name='Warga Alpha'),
        'rB', (SELECT id FROM r_a WHERE full_name='Warga Beta'),
        'rInactive', (SELECT id FROM r_a WHERE full_name='Warga Nonaktif'),
        'rResDeleted', (SELECT id FROM r_a WHERE full_name='Warga Res Deleted'),
        'rHhInactive', (SELECT id FROM r_a WHERE full_name='Warga HH Inactive'),
        'rHhDeleted', (SELECT id FROM r_a WHERE full_name='Warga HH Deleted'),
        'rT2', (SELECT id FROM r_b)
      )::text;
    `)

    const fx = JSON.parse(setupRaw)
    createdTenantIds.push(fx.t1, fx.t2)

    // --- PART A: Repository + Real Supabase Auth / RLS / RPC ---
    const validInput = schemas.upsertRondaScheduleSchema.parse({
      scheduleDate: "2026-12-26",
      shiftLabel: "Ronda Malam Sabtu",
      startTime: "22:00",
      endTime: "04:00",
      meetingPoint: "Pos Kamling D-11",
      notes: "Siapkan senter dan kentongan",
      residentIds: [fx.rA, fx.rB],
    })

    const createdSched = await repository.upsertRondaScheduleWithClient(
      ketua.client,
      {
        tenantId: fx.t1,
        roles: ["ketua_rt"],
        input: validInput,
      }
    )
    assert.ok(createdSched.id)
    assert.equal(createdSched.assignedCount, 2)

    // Sekretaris updates schedule successfully
    const updatedSched = await repository.upsertRondaScheduleWithClient(
      sekre.client,
      {
        tenantId: fx.t1,
        roles: ["sekretaris"],
        input: {
          ...validInput,
          scheduleId: createdSched.id,
          shiftLabel: "Ronda Malam Sabtu Updated",
        },
      }
    )
    assert.equal(updatedSched.id, createdSched.id)
    assert.equal(updatedSched.shiftLabel, "Ronda Malam Sabtu Updated")

    // Unauthorized roles rejected by both repository & DB RPC
    for (const [label, client, roles] of [
      ["bendahara", bendahara.client, ["bendahara"]],
      ["pengurus", pengurus.client, ["pengurus"]],
      ["wargaA", wargaA.client, ["warga"]],
      ["superAdmin", superAdmin.client, []],
    ]) {
      await assert.rejects(
        () =>
          repository.upsertRondaScheduleWithClient(client, {
            tenantId: fx.t1,
            roles,
            input: { ...validInput, scheduleDate: "2026-12-27" },
          }),
        (err) => err instanceof repository.RondaServiceError && err.status === 403,
        `${label} must receive 403 on upsert`
      )
    }

    // Tenant2Ketua tries to spoof Tenant 1 schedule into Tenant 2 -> rejected 404/403
    await assert.rejects(
      () =>
        repository.deleteRondaScheduleWithClient(tenant2Ketua.client, {
          tenantId: fx.t2,
          roles: ["ketua_rt"],
          scheduleId: createdSched.id,
        }),
      (err) =>
        err instanceof repository.RondaServiceError &&
        (err.status === 403 || err.status === 404)
    )

    // Fetch detail to obtain assignment IDs
    const adminDetail = await repository.getAdminRondaScheduleDetailWithClient(
      ketua.client,
      {
        tenantId: fx.t1,
        roles: ["ketua_rt"],
        scheduleId: createdSched.id,
      }
    )
    assert.ok(adminDetail && adminDetail.roster.length === 2)
    const assignA = adminDetail.roster.find((r) => r.residentId === fx.rA)
    const assignB = adminDetail.roster.find((r) => r.residentId === fx.rB)
    assert.ok(assignA && assignB)

    // Record attendance for A and B
    const recA = await repository.recordRondaAttendanceWithClient(sekre.client, {
      tenantId: fx.t1,
      roles: ["sekretaris"],
      assignmentId: assignA.id,
      attendanceStatus: "present",
      attendanceNotes: "Hadir penuh",
    })
    assert.equal(recA.attendanceStatus, "present")

    const recB = await repository.recordRondaAttendanceWithClient(ketua.client, {
      tenantId: fx.t1,
      roles: ["ketua_rt"],
      assignmentId: assignB.id,
      attendanceStatus: "excused",
      attendanceNotes: "Izin sakit pribadi",
    })
    assert.equal(recB.attendanceStatus, "excused")

    // Reset attendance on B -> null, then re-record absent to verify both flows
    const resetB = await repository.recordRondaAttendanceWithClient(ketua.client, {
      tenantId: fx.t1,
      roles: ["ketua_rt"],
      assignmentId: assignB.id,
      attendanceStatus: null,
      attendanceNotes: null,
    })
    assert.equal(resetB.attendanceStatus, null)
    assert.equal(resetB.attendanceRecordedAt, null)

    await repository.recordRondaAttendanceWithClient(ketua.client, {
      tenantId: fx.t1,
      roles: ["ketua_rt"],
      assignmentId: assignB.id,
      attendanceStatus: "absent",
      attendanceNotes: "Tidak hadir rahasia",
    })

    // Bendahara & Pengurus read roster only, NO attendance
    for (const [roleCode, client] of [
      ["bendahara", bendahara.client],
      ["pengurus", pengurus.client],
    ]) {
      const detail = await repository.getAdminRondaScheduleDetailWithClient(
        client,
        {
          tenantId: fx.t1,
          roles: [roleCode],
          scheduleId: createdSched.id,
        }
      )
      assert.equal(detail.canReadAllAttendance, false)
      assert.equal(detail.roster.length, 2)
      for (const row of detail.roster) {
        assert.equal(row.attendanceStatus, undefined)
        assert.equal(row.attendanceNotes, undefined)
      }

      await assert.rejects(
        () =>
          repository.listAdminRondaAttendanceWithClient(client, {
            tenantId: fx.t1,
            roles: [roleCode],
          }),
        (err) => err instanceof repository.RondaServiceError && err.status === 403
      )
    }

    // Resident A sees only own attendance; neighbor B attendance is completely omitted
    const residentADetail =
      await repository.getResidentRondaScheduleDetailWithClient(wargaA.client, {
        tenantId: fx.t1,
        scheduleId: createdSched.id,
      })
    assert.ok(residentADetail)
    assert.equal(residentADetail.myAttendance?.assignmentId, assignA.id)
    assert.equal(residentADetail.myAttendance?.attendanceStatus, "present")
    const residentViewA = residentADetail.roster.find((r) => r.id === assignA.id)
    const residentViewB = residentADetail.roster.find((r) => r.id === assignB.id)
    assert.equal(residentViewA.attendanceStatus, "present")
    assert.equal(residentViewB.attendanceStatus, undefined)
    assert.equal(residentViewB.attendanceNotes, undefined)

    // Warga A cannot request Tenant 2 attendance via get_my_ronda_attendance
    await assert.rejects(
      () =>
        repository.getMyRondaAttendanceWithClient(wargaA.client, {
          tenantId: fx.t2,
        }),
      (err) => err instanceof repository.RondaServiceError && err.status === 403
    )

    // --- PART B: Real Next.js App Router HTTP API Routes & Regressions ---
    nextServer = await startNextServer(3109, {
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    })
    const { baseUrl } = nextServer

    // Unauthenticated API calls -> 401
    for (const path of [
      "/api/ronda",
      `/api/ronda/${createdSched.id}`,
      "/api/ronda/attendance",
      "/api/ronda/candidates",
      "/api/resident/ronda",
      `/api/resident/ronda/${createdSched.id}`,
    ]) {
      const res = await apiGet(baseUrl, path, null)
      assert.equal(res.status, 401, `Expected 401 unauthenticated for ${path}`)
      assert.equal(res.cacheControl, "no-store")
    }

    // Invalid query params & bad UUID -> 400
    assert.equal(
      (await apiGet(baseUrl, "/api/ronda?fromDate=2026-12-31&toDate=2026-12-01", ketua.cookie)).status,
      400
    )
    assert.equal(
      (await apiGet(baseUrl, "/api/ronda/not-a-uuid", ketua.cookie)).status,
      400
    )
    assert.equal(
      (await apiGet(baseUrl, "/api/resident/ronda/not-a-uuid", wargaA.cookie)).status,
      400
    )

    // Super admin non-member -> 403 on all ronda endpoints
    for (const path of [
      "/api/ronda",
      `/api/ronda/${createdSched.id}`,
      "/api/ronda/attendance",
      "/api/ronda/candidates",
      "/api/resident/ronda",
      `/api/resident/ronda/${createdSched.id}`,
    ]) {
      const res = await apiGet(baseUrl, path, superAdmin.cookie)
      assert.equal(res.status, 403, `super_admin non-member must get 403 on ${path}`)
    }

    // Bendahara & Pengurus: allowed roster list/detail WITHOUT attendance, 403 on attendance & candidates
    for (const [label, cookie] of [
      ["bendahara", bendahara.cookie],
      ["pengurus", pengurus.cookie],
    ]) {
      const listRes = await apiGet(baseUrl, "/api/ronda", cookie)
      assert.equal(listRes.status, 200, `${label} should read /api/ronda`)
      assert.equal(listRes.body.canReadAllAttendance, false)

      const detailRes = await apiGet(baseUrl, `/api/ronda/${createdSched.id}`, cookie)
      assert.equal(detailRes.status, 200, `${label} should read /api/ronda/[id]`)
      assert.equal(detailRes.body.canReadAllAttendance, false)
      assert.ok(detailRes.body.roster.every((r) => r.attendanceStatus === undefined))

      const attRes = await apiGet(baseUrl, "/api/ronda/attendance", cookie)
      assert.equal(attRes.status, 403, `${label} must get 403 on /api/ronda/attendance`)

      const candRes = await apiGet(baseUrl, "/api/ronda/candidates", cookie)
      assert.equal(candRes.status, 403, `${label} must get 403 on /api/ronda/candidates`)
    }

    // Ketua & Sekretaris: 200 with attendance & candidates (active non-PII residents only)
    const ketuaDetailRes = await apiGet(baseUrl, `/api/ronda/${createdSched.id}`, ketua.cookie)
    assert.equal(ketuaDetailRes.status, 200)
    assert.equal(ketuaDetailRes.cacheControl, "no-store")
    assert.equal(ketuaDetailRes.body.canReadAllAttendance, true)
    assert.equal(
      ketuaDetailRes.body.roster.find((r) => r.id === assignB.id)?.attendanceStatus,
      "absent"
    )

    const sekreAttRes = await apiGet(
      baseUrl,
      `/api/ronda/attendance?scheduleId=${createdSched.id}`,
      sekre.cookie
    )
    assert.equal(sekreAttRes.status, 200)
    assert.equal(sekreAttRes.body.items.length, 2)

    const candRes = await apiGet(baseUrl, "/api/ronda/candidates", ketua.cookie)
    assert.equal(candRes.status, 200)
    assert.equal(candRes.cacheControl, "no-store")
    assert.deepEqual(
      candRes.body.items.map((c) => c.id).sort(),
      [fx.rA, fx.rB].sort()
    )
    assert.ok(!candRes.body.items.some((c) => c.id === fx.rInactive))
    assert.ok(!candRes.body.items.some((c) => c.id === fx.rResDeleted))
    assert.ok(!candRes.body.items.some((c) => c.id === fx.rHhInactive))
    assert.ok(!candRes.body.items.some((c) => c.id === fx.rHhDeleted))
    assert.ok(!candRes.body.items.some((c) => c.id === fx.rT2))
    assert.ok(!("nik" in candRes.body.items[0]))
    assert.ok(!("kkNumber" in candRes.body.items[0]))
    assert.ok(!("phone" in candRes.body.items[0]))
    assert.ok(!("birthDate" in candRes.body.items[0]))

    // Tenant 2 ketua only sees Tenant 2 eligible candidate
    const t2CandRes = await apiGet(baseUrl, "/api/ronda/candidates", tenant2Ketua.cookie)
    assert.equal(t2CandRes.status, 200)
    assert.deepEqual(t2CandRes.body.items.map((c) => c.id), [fx.rT2])

    // Cross-tenant isolation on HTTP routes -> 404 for Tenant 2 ketua querying Tenant 1 ID
    const crossDetailRes = await apiGet(
      baseUrl,
      `/api/ronda/${createdSched.id}`,
      tenant2Ketua.cookie
    )
    assert.equal(crossDetailRes.status, 404)

    // Warga A HTTP resident endpoints: roster + ONLY own attendance
    const wargaListRes = await apiGet(baseUrl, "/api/resident/ronda", wargaA.cookie)
    assert.equal(wargaListRes.status, 200)
    assert.equal(wargaListRes.cacheControl, "no-store")
    assert.equal(wargaListRes.body.items[0].myAttendance.attendanceStatus, "present")

    const wargaDetailRes = await apiGet(
      baseUrl,
      `/api/resident/ronda/${createdSched.id}`,
      wargaA.cookie
    )
    assert.equal(wargaDetailRes.status, 200)
    assert.equal(wargaDetailRes.body.myAttendance.assignmentId, assignA.id)
    assert.equal(wargaDetailRes.body.myAttendance.attendanceStatus, "present")
    const httpNeighborB = wargaDetailRes.body.roster.find((r) => r.id === assignB.id)
    assert.equal(httpNeighborB.attendanceStatus, undefined)
    assert.equal(httpNeighborB.attendanceNotes, undefined)
    assert.equal(httpNeighborB.residentNameSnapshot, "Warga Beta")

    // Warga cannot access admin endpoints
    assert.equal((await apiGet(baseUrl, "/api/ronda", wargaA.cookie)).status, 403)
    assert.equal((await apiGet(baseUrl, "/api/ronda/attendance", wargaA.cookie)).status, 403)

    // --- PART C: Step 12.3 UI SSR Routes, Role Guards & Privacy Rendering ---
    // Unauthenticated UI page visits redirect to /login
    for (const uiPath of [
      "/ronda",
      "/ronda/new",
      "/ronda/attendance",
      `/ronda/${createdSched.id}`,
      `/ronda/${createdSched.id}/edit`,
      "/resident/layanan",
      "/resident/ronda",
      `/resident/ronda/${createdSched.id}`,
    ]) {
      const unauthUi = await apiGet(baseUrl, uiPath, null)
      assert.equal(unauthUi.status, 307, `Expected 307 redirect unauthenticated for ${uiPath}`)
      assert.ok(unauthUi.location?.includes("/login"), `Expected redirect to /login for ${uiPath}`)
    }

    // Ketua RT & Sekretaris: full admin UI pages 200 with management controls & attendance
    for (const [label, cookie] of [
      ["ketua_rt", ketua.cookie],
      ["sekretaris", sekre.cookie],
    ]) {
      const listHtml = await apiGet(
        baseUrl,
        "/ronda?fromDate=2026-12-01&toDate=2026-12-31",
        cookie
      )
      assert.equal(listHtml.status, 200, `${label} must render /ronda`)
      assert.match(listHtml.body, /Tambah Jadwal/)
      assert.match(listHtml.body, /Rekap Kehadiran/)
      assert.match(listHtml.body, /Warga Alpha/)

      const newHtml = await apiGet(baseUrl, "/ronda/new", cookie)
      assert.equal(newHtml.status, 200, `${label} must render /ronda/new`)
      assert.match(newHtml.body, /Tambah Jadwal Ronda Baru/)

      const editHtml = await apiGet(baseUrl, `/ronda/${createdSched.id}/edit`, cookie)
      assert.equal(editHtml.status, 200, `${label} must render /ronda/[id]/edit`)
      assert.match(editHtml.body, /Ubah Jadwal Ronda/)

      const attHtml = await apiGet(
        baseUrl,
        "/ronda/attendance?fromDate=2026-12-01&toDate=2026-12-31",
        cookie
      )
      assert.equal(attHtml.status, 200, `${label} must render /ronda/attendance`)
      assert.match(attHtml.body, /Rekap Kehadiran Ronda/)
      assert.match(attHtml.body, /Tidak hadir rahasia/)

      const detailHtml = await apiGet(baseUrl, `/ronda/${createdSched.id}`, cookie)
      assert.equal(detailHtml.status, 200, `${label} must render /ronda/[id]`)
      assert.match(detailHtml.body, /Warga Alpha/)
      assert.match(detailHtml.body, /Warga Beta/)
      assert.match(detailHtml.body, /Tidak Hadir/)
    }

    // Bendahara & Pengurus: read-only /ronda & /ronda/[id] (NO attendance, NO management), redirected from /new, /edit, /attendance
    for (const [label, cookie] of [
      ["bendahara", bendahara.cookie],
      ["pengurus", pengurus.cookie],
    ]) {
      const listHtml = await apiGet(
        baseUrl,
        "/ronda?fromDate=2026-12-01&toDate=2026-12-31",
        cookie
      )
      assert.equal(listHtml.status, 200, `${label} must render /ronda read-only`)
      assert.doesNotMatch(listHtml.body, /Tambah Jadwal/)
      assert.doesNotMatch(listHtml.body, /Rekap Kehadiran/)

      const detailHtml = await apiGet(baseUrl, `/ronda/${createdSched.id}`, cookie)
      assert.equal(detailHtml.status, 200, `${label} must render /ronda/[id] read-only`)
      assert.match(detailHtml.body, /Warga Alpha/)
      assert.match(detailHtml.body, /Warga Beta/)
      assert.doesNotMatch(detailHtml.body, /Hadir penuh/)
      assert.doesNotMatch(detailHtml.body, /Tidak hadir rahasia/)
      assert.doesNotMatch(detailHtml.body, /Hapus Jadwal/)

      const newRedirect = await apiGet(baseUrl, "/ronda/new", cookie)
      assertServerRedirect(newRedirect, "/ronda?notice=readonly", [
        /Tambah Jadwal Ronda Baru/,
      ])

      const editRedirect = await apiGet(baseUrl, `/ronda/${createdSched.id}/edit`, cookie)
      assertServerRedirect(editRedirect, `/ronda/${createdSched.id}?notice=readonly`, [
        /Ubah Jadwal Ronda/,
      ])

      const attRedirect = await apiGet(baseUrl, "/ronda/attendance", cookie)
      assertServerRedirect(attRedirect, "/ronda?notice=readonly", [
        /Rekap Kehadiran Ronda/,
        /Tidak hadir rahasia/,
      ])
    }

    // Resident Layanan & Resident Ronda SSR UI: Warga A sees roster & OWN attendance, NEVER neighbor's attendance/notes
    const layananHtml = await apiGet(baseUrl, "/resident/layanan", wargaA.cookie)
    assert.equal(layananHtml.status, 200)
    assert.match(layananHtml.body, /Jadwal Ronda Malam/)

    const residentRondaHtml = await apiGet(baseUrl, "/resident/ronda", wargaA.cookie)
    assert.equal(residentRondaHtml.status, 200)
    assert.match(residentRondaHtml.body, /Jadwal Ronda/)

    const residentDetailHtml = await apiGet(
      baseUrl,
      `/resident/ronda/${createdSched.id}`,
      wargaA.cookie
    )
    assert.equal(residentDetailHtml.status, 200)
    assert.match(residentDetailHtml.body, /Warga Alpha/)
    assert.match(residentDetailHtml.body, /Warga Beta/)
    assert.match(residentDetailHtml.body, /Kehadiran Pribadi Anda/)
    assert.match(residentDetailHtml.body, /Hadir penuh/)
    assert.doesNotMatch(residentDetailHtml.body, /Tidak hadir rahasia/)

    // Cross-tenant admin detail SSR UI returns 404 / streamed NOT_FOUND without Tenant 1 data
    const crossUiDetail = await apiGet(
      baseUrl,
      `/ronda/${createdSched.id}`,
      tenant2Ketua.cookie
    )
    assertServerNotFound(crossUiDetail, [/Warga Alpha/, /Tidak hadir rahasia/])

    // Warga redirected off admin /ronda routes
    const wargaAdminRedirect = await apiGet(baseUrl, "/ronda", wargaA.cookie)
    assertServerRedirect(wargaAdminRedirect, "/resident", [/Tambah Jadwal/])

    // Existing feature regression checks
    assert.equal((await apiGet(baseUrl, "/login", null)).status, 200)
    assert.equal(
      (await apiGet(baseUrl, "/api/notifications?scope=admin&mode=summary", ketua.cookie)).status,
      200
    )
    assert.equal(
      (await apiGet(baseUrl, "/api/notifications?scope=resident&mode=summary", wargaA.cookie)).status,
      200
    )
    assert.equal(
      (await apiGet(baseUrl, "/api/analytics/admin", ketua.cookie)).status,
      200
    )
    assert.equal((await apiGet(baseUrl, "/announcements", ketua.cookie)).status, 200)
    assert.equal((await apiGet(baseUrl, "/residents", ketua.cookie)).status, 200)
    assert.equal((await apiGet(baseUrl, "/bills", ketua.cookie)).status, 200)
    assert.equal((await apiGet(baseUrl, "/notifications", ketua.cookie)).status, 200)
    assert.equal(
      (await apiGet(baseUrl, "/resident/notifications", wargaA.cookie)).status,
      200
    )

    // Delete schedule via repository & confirm 404 afterwards
    const deleted = await repository.deleteRondaScheduleWithClient(sekre.client, {
      tenantId: fx.t1,
      roles: ["sekretaris"],
      scheduleId: createdSched.id,
    })
    assert.equal(deleted.deleted, true)
    assert.equal(
      (await apiGet(baseUrl, `/api/ronda/${createdSched.id}`, ketua.cookie)).status,
      404
    )
  } finally {
    if (nextServer) {
      await nextServer.stop()
    }
    if (createdTenantIds.length > 0) {
      const tenantList = createdTenantIds.map((id) => `'${id}'`).join(",")
      runSql(`
        DELETE FROM public.audit_logs WHERE tenant_id IN (${tenantList});
        DELETE FROM public.ronda_schedules WHERE tenant_id IN (${tenantList});
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

