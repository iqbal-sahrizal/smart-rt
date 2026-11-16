import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { setTimeout as delay } from "node:timers/promises"
import test from "node:test"
import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"

import {
  loadActivitiesTestModules,
  runSupabaseCliStatus,
} from "./helpers/load-activities-modules.mjs"

const { repository } = loadActivitiesTestModules()

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
      // retry until ready
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

async function apiGetJson(baseUrl, path, cookieHeader) {
  const headers = cookieHeader ? { Cookie: cookieHeader } : {}
  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers,
    redirect: "manual",
  })
  const text = await res.text()
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: res.status, headers: res.headers, body }
}

const TINY_PNG = new Uint8Array(
  Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
    "hex"
  )
)
const TINY_PDF = new Uint8Array(
  Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "utf8")
)

test("Step 15.2 integration: repository, RPCs, API routes, private document proxy, role matrix, and tenant isolation", async () => {
  const status = runSupabaseCliStatus()
  const supabaseUrl = status.API_URL || "http://127.0.0.1:54321"
  const anonKey = status.ANON_KEY
  const serviceRoleKey = status.SERVICE_ROLE_KEY

  assert.ok(anonKey && serviceRoleKey, "Local Supabase keys must exist")

  // Used strictly in test harness to create/delete disposable Auth accounts and Storage cleanup
  const adminAuth = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const createdUserIds = []
  const createdTenantIds = []
  const runTag = Date.now()
  const password = "TestPassword123!"
  let nextServer = null

  async function createActor(label) {
    const email = `activities.15_2.${label}.${runTag}@example.com`
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
    return { user: data.user, client, cookie }
  }

  try {
    const ketua = await createActor("ketua")
    const sekre = await createActor("sekre")
    const pengurus = await createActor("pengurus")
    const bendahara = await createActor("bendahara")
    const wargaA = await createActor("wargaa")
    const wargaB = await createActor("wargab")
    const wargaInactive = await createActor("wargainact")
    const tenant2Ketua = await createActor("t2ketua")
    const superAdmin = await createActor("super")

    const setupRaw = runSql(`
      WITH t AS (
        INSERT INTO public.tenants (code, name, rt_number, rw_number, kelurahan, kecamatan, city, province, status)
        VALUES
          ('rt-152-a-${runTag}', 'RT Kegiatan 15.2 A', '051', '005', 'Lebak Siliwangi', 'Coblong', 'Bandung', 'Jawa Barat', 'active'),
          ('rt-152-b-${runTag}', 'RT Kegiatan 15.2 B', '052', '005', 'Lebak Siliwangi', 'Coblong', 'Bandung', 'Jawa Barat', 'active')
        RETURNING id, rt_number
      ),
      h_a AS (
        INSERT INTO public.households (tenant_id, kk_number, address, block_unit, status)
        SELECT t.id, '3273011520000001', 'Jl. Ganesha No. 1', 'Blok G-01', 'active'
        FROM t WHERE t.rt_number = '051'
        RETURNING id, tenant_id
      ),
      h_b AS (
        INSERT INTO public.households (tenant_id, kk_number, address, block_unit, status)
        SELECT t.id, '3273011520000002', 'Jl. Ganesha No. 2', 'Blok G-02', 'active'
        FROM t WHERE t.rt_number = '051'
        RETURNING id, tenant_id
      ),
      r_a AS (
        INSERT INTO public.residents (tenant_id, household_id, full_name, gender, family_role, residency_status)
        SELECT tenant_id, id, 'Warga 15.2 A', 'L', 'kepala_keluarga', 'aktif' FROM h_a
        RETURNING id, tenant_id
      ),
      r_b AS (
        INSERT INTO public.residents (tenant_id, household_id, full_name, gender, family_role, residency_status)
        SELECT tenant_id, id, 'Warga 15.2 B', 'P', 'istri', 'aktif' FROM h_b
        RETURNING id, tenant_id
      ),
      r_inact AS (
        INSERT INTO public.residents (tenant_id, household_id, full_name, gender, family_role, residency_status)
        SELECT tenant_id, id, 'Warga Pindah 15.2', 'L', 'anak', 'pindah' FROM h_a
        RETURNING id, tenant_id
      ),
      prof AS (
        INSERT INTO public.profiles (id, full_name, is_super_admin)
        VALUES
          ('${ketua.user.id}', 'Ketua 15.2', false),
          ('${sekre.user.id}', 'Sekretaris 15.2', false),
          ('${pengurus.user.id}', 'Pengurus 15.2', false),
          ('${bendahara.user.id}', 'Bendahara 15.2', false),
          ('${wargaA.user.id}', 'Warga 15.2 A', false),
          ('${wargaB.user.id}', 'Warga 15.2 B', false),
          ('${wargaInactive.user.id}', 'Warga Pindah 15.2', false),
          ('${tenant2Ketua.user.id}', 'Ketua T2 15.2', false),
          ('${superAdmin.user.id}', 'Super Admin 15.2', true)
        ON CONFLICT (id) DO UPDATE SET is_super_admin = EXCLUDED.is_super_admin
      ),
      tm AS (
        INSERT INTO public.tenant_members (tenant_id, user_id, resident_id, status)
        VALUES
          ((SELECT id FROM t WHERE rt_number='051'), '${ketua.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='051'), '${sekre.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='051'), '${pengurus.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='051'), '${bendahara.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='051'), '${wargaA.user.id}', (SELECT id FROM r_a), 'active'),
          ((SELECT id FROM t WHERE rt_number='051'), '${wargaB.user.id}', (SELECT id FROM r_b), 'active'),
          ((SELECT id FROM t WHERE rt_number='051'), '${wargaInactive.user.id}', (SELECT id FROM r_inact), 'active'),
          ((SELECT id FROM t WHERE rt_number='052'), '${tenant2Ketua.user.id}', NULL, 'active')
        RETURNING id, tenant_id, user_id, resident_id
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
          ('${wargaInactive.user.id}', 'warga'),
          ('${tenant2Ketua.user.id}', 'ketua_rt')
        ) AS m(uid, rname) ON m.uid::uuid = tm.user_id
        JOIN public.roles rl ON rl.code = m.rname
      )
      SELECT json_build_object(
        't1', (SELECT id FROM t WHERE rt_number='051'),
        't2', (SELECT id FROM t WHERE rt_number='052'),
        'wargaAResId', (SELECT id FROM r_a),
        'wargaBResId', (SELECT id FROM r_b),
        'wargaInactiveResId', (SELECT id FROM r_inact)
      )::text;
    `)

    const fx = JSON.parse(setupRaw)
    createdTenantIds.push(fx.t1, fx.t2)

    const futureStart = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
    const futureEnd = new Date(Date.now() + 7 * 24 * 3600 * 1000 + 2 * 3600 * 1000).toISOString()
    const futureDeadline = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString()

    // -------------------------------------------------------------------------
    // 1. Repository role boundaries & activity lifecycle
    // -------------------------------------------------------------------------
    // Pengurus, Bendahara, Warga denied createActivityWithClient (403 FORBIDDEN)
    for (const [label, client, roles] of [
      ["pengurus", pengurus.client, ["pengurus"]],
      ["bendahara", bendahara.client, ["bendahara"]],
      ["wargaA", wargaA.client, ["warga"]],
    ]) {
      await assert.rejects(
        repository.createActivityWithClient(client, {
          tenantId: fx.t1,
          roles,
          input: {
            title: `Denied ${label}`,
            location: "Balai",
            startAt: futureStart,
          },
        }),
        (err) => err?.code === "FORBIDDEN" && err?.status === 403
      )
    }

    const detail1 = await repository.createActivityWithClient(ketua.client, {
      tenantId: fx.t1,
      roles: ["ketua_rt"],
      input: {
        title: "Kerja Bakti Saluran Air",
        description: "Membersihkan selokan RT 051",
        category: "kerja_bakti",
        location: "Depan Pos Kamling",
        startAt: futureStart,
        endAt: futureEnd,
        allowSelfRegistration: true,
        maxParticipants: 5,
        registrationDeadline: futureDeadline,
      },
    })
    assert.equal(detail1.activity.status, "scheduled")
    assert.equal(detail1.activity.category, "kerja_bakti")
    assert.equal(detail1.permissions.canUpdateInfo, true)

    const detail2 = await repository.createActivityWithClient(sekre.client, {
      tenantId: fx.t1,
      roles: ["sekretaris"],
      input: {
        title: "Rapat Koordinasi Keamanan",
        category: "rapat",
        location: "Balai Warga RT 051",
        startAt: futureStart,
        allowSelfRegistration: false,
      },
    })
    assert.equal(detail2.activity.status, "scheduled")

    // Sekretaris updates activity 1
    const updated1 = await repository.updateActivityWithClient(sekre.client, {
      tenantId: fx.t1,
      roles: ["sekretaris"],
      input: {
        activityId: detail1.activity.id,
        title: "Kerja Bakti Lingkungan RT 051",
        description: "Membawa cangkul dan sapu",
        category: "kerja_bakti",
        location: "Depan Pos Kamling",
        startAt: futureStart,
        endAt: futureEnd,
        allowSelfRegistration: true,
        maxParticipants: 4,
        registrationDeadline: futureDeadline,
      },
    })
    assert.equal(updated1.activity.title, "Kerja Bakti Lingkungan RT 051")
    assert.equal(updated1.activity.maxParticipants, 4)

    // Pengurus denied update, cancel, soft delete, add/remove participant
    await assert.rejects(
      repository.updateActivityWithClient(pengurus.client, {
        tenantId: fx.t1,
        roles: ["pengurus"],
        input: {
          activityId: detail1.activity.id,
          title: "Pengurus Edit",
          location: "Balai",
          startAt: futureStart,
        },
      }),
      (err) => err?.code === "FORBIDDEN" && err?.status === 403
    )

    await assert.rejects(
      repository.transitionActivityStatusWithClient(pengurus.client, {
        tenantId: fx.t1,
        roles: ["pengurus"],
        input: {
          activityId: detail1.activity.id,
          newStatus: "cancelled",
          reason: "Tidak diizinkan",
        },
      }),
      (err) => err?.code === "FORBIDDEN" && err?.status === 403
    )

    await assert.rejects(
      repository.softDeleteActivityWithClient(pengurus.client, {
        tenantId: fx.t1,
        roles: ["pengurus"],
        input: { activityId: detail1.activity.id },
      }),
      (err) => err?.code === "FORBIDDEN" && err?.status === 403
    )

    await assert.rejects(
      repository.addActivityParticipantWithClient(pengurus.client, {
        tenantId: fx.t1,
        roles: ["pengurus"],
        input: {
          activityId: detail1.activity.id,
          residentId: fx.wargaBResId,
        },
      }),
      (err) => err?.code === "FORBIDDEN" && err?.status === 403
    )

    // -------------------------------------------------------------------------
    // 2. Resident registration, cancellation, capacity & admin roster ops
    // -------------------------------------------------------------------------
    // Inactive resident blocked
    await assert.rejects(
      repository.registerForActivityWithClient(wargaInactive.client, {
        tenantId: fx.t1,
        residentId: fx.wargaInactiveResId,
        input: { activityId: detail1.activity.id },
      }),
      (err) => err?.code === "INELIGIBLE_RESIDENT" && err?.status === 403
    )

    // Warga A registers, cancels, then re-registers
    const reg1 = await repository.registerForActivityWithClient(wargaA.client, {
      tenantId: fx.t1,
      residentId: fx.wargaAResId,
      input: { activityId: detail1.activity.id, notes: "Ikut kerja bakti" },
    })
    assert.equal(reg1.rsvpStatus, "attending")

    // Duplicate registration rejected with DUPLICATE_REGISTRATION
    await assert.rejects(
      repository.registerForActivityWithClient(wargaA.client, {
        tenantId: fx.t1,
        residentId: fx.wargaAResId,
        input: { activityId: detail1.activity.id },
      }),
      (err) => err?.code === "DUPLICATE_REGISTRATION" && err?.status === 409
    )

    const cancel1 = await repository.cancelActivityRegistrationWithClient(
      wargaA.client,
      {
        tenantId: fx.t1,
        residentId: fx.wargaAResId,
        input: { activityId: detail1.activity.id, reason: "Ada urusan" },
      }
    )
    assert.equal(cancel1.rsvpStatus, "cancelled")

    const reReg1 = await repository.registerForActivityWithClient(wargaA.client, {
      tenantId: fx.t1,
      residentId: fx.wargaAResId,
      input: { activityId: detail1.activity.id, notes: "Hadir lagi" },
    })
    assert.equal(reReg1.rsvpStatus, "attending")

    // Ketua manually adds wargaB, pengurus cannot remove, ketua removes & re-adds via attendance
    const addedB = await repository.addActivityParticipantWithClient(
      ketua.client,
      {
        tenantId: fx.t1,
        roles: ["ketua_rt"],
        input: {
          activityId: detail1.activity.id,
          residentId: fx.wargaBResId,
          rsvpStatus: "invited",
          notes: "Undangan khusus",
        },
      }
    )
    assert.equal(addedB.rsvpStatus, "invited")

    await assert.rejects(
      repository.removeActivityParticipantWithClient(pengurus.client, {
        tenantId: fx.t1,
        roles: ["pengurus"],
        input: {
          activityId: detail1.activity.id,
          participantId: addedB.id,
        },
      }),
      (err) => err?.code === "FORBIDDEN" && err?.status === 403
    )

    const removedB = await repository.removeActivityParticipantWithClient(
      ketua.client,
      {
        tenantId: fx.t1,
        roles: ["ketua_rt"],
        input: {
          activityId: detail1.activity.id,
          participantId: addedB.id,
          reason: "Salah daftar",
        },
      }
    )
    assert.equal(removedB.removedFromActiveRoster, true)
    assert.equal(removedB.preservesRosterRow, false)

    // Pengurus transitions detail1 -> ongoing and records attendance
    const ongoing1 = await repository.transitionActivityStatusWithClient(
      pengurus.client,
      {
        tenantId: fx.t1,
        roles: ["pengurus"],
        input: { activityId: detail1.activity.id, newStatus: "ongoing" },
      }
    )
    assert.equal(ongoing1.activity.status, "ongoing")

    const attA = await repository.recordActivityAttendanceWithClient(
      pengurus.client,
      {
        tenantId: fx.t1,
        roles: ["pengurus"],
        input: {
          activityId: detail1.activity.id,
          residentId: fx.wargaAResId,
          rsvpStatus: "attended",
        },
      }
    )
    assert.equal(attA.rsvpStatus, "attended")

    // -------------------------------------------------------------------------
    // 3. Documentation upload (pengurus & ketua allowed) + remove (ketua only)
    // -------------------------------------------------------------------------
    const docPng = await repository.uploadActivityDocWithClient(pengurus.client, {
      tenantId: fx.t1,
      roles: ["pengurus"],
      activityId: detail1.activity.id,
      validatedFile: {
        buffer: TINY_PNG,
        mimeType: "image/png",
        extension: "png",
        size: TINY_PNG.byteLength,
      },
    })
    assert.equal(docPng.documentCount, 1)

    const docPdf = await repository.uploadActivityDocWithClient(ketua.client, {
      tenantId: fx.t1,
      roles: ["ketua_rt"],
      activityId: detail1.activity.id,
      validatedFile: {
        buffer: TINY_PDF,
        mimeType: "application/pdf",
        extension: "pdf",
        size: TINY_PDF.byteLength,
      },
    })
    assert.equal(docPdf.documentCount, 2)

    await assert.rejects(
      repository.removeActivityDocWithClient(pengurus.client, {
        tenantId: fx.t1,
        roles: ["pengurus"],
        input: { activityId: detail1.activity.id, fileId: docPng.document.fileId },
      }),
      (err) => err?.code === "FORBIDDEN" && err?.status === 403
    )

    // -------------------------------------------------------------------------
    // 4. Live Next.js HTTP API & Private Document Proxy verification
    // -------------------------------------------------------------------------
    nextServer = await startNextServer(3461, {
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    })

    // 4a. Unauthenticated -> 401 on every endpoint
    for (const ep of [
      "/api/activities",
      `/api/activities/${detail1.activity.id}`,
      `/api/activities/${detail1.activity.id}/participants`,
      `/api/activities/${detail1.activity.id}/documents/${docPng.document.fileId}`,
      "/api/resident/activities",
      `/api/resident/activities/${detail1.activity.id}`,
      `/api/resident/activities/${detail1.activity.id}/registration`,
    ]) {
      const unauth = await apiGetJson(nextServer.baseUrl, ep, "")
      assert.equal(unauth.status, 401, `Unauthenticated ${ep} must return 401`)
    }

    // 4b. Bendahara & superAdmin non-member -> 403 across ALL Activities routes
    for (const [label, cookie] of [
      ["bendahara", bendahara.cookie],
      ["superAdmin", superAdmin.cookie],
    ]) {
      for (const ep of [
        "/api/activities",
        `/api/activities/${detail1.activity.id}`,
        `/api/activities/${detail1.activity.id}/participants`,
        `/api/activities/${detail1.activity.id}/documents/${docPng.document.fileId}`,
        "/api/resident/activities",
        `/api/resident/activities/${detail1.activity.id}`,
        `/api/resident/activities/${detail1.activity.id}/registration`,
      ]) {
        const res = await apiGetJson(nextServer.baseUrl, ep, cookie)
        assert.equal(res.status, 403, `${label} on ${ep} must return 403`)
      }
    }

    // 4c. Bad UUIDs return 400
    assert.equal(
      (
        await apiGetJson(
          nextServer.baseUrl,
          "/api/activities/not-a-uuid",
          ketua.cookie
        )
      ).status,
      400
    )
    assert.equal(
      (
        await apiGetJson(
          nextServer.baseUrl,
          `/api/activities/${detail1.activity.id}/documents/bad-uuid`,
          ketua.cookie
        )
      ).status,
      400
    )

    // 4d. Admin endpoints for ketua, sekre, pengurus + tenant isolation
    const adminList = await apiGetJson(
      nextServer.baseUrl,
      "/api/activities?category=kerja_bakti&search=Lingkungan",
      pengurus.cookie
    )
    assert.equal(adminList.status, 200)
    assert.equal(adminList.body.items.length, 1)
    assert.equal(adminList.body.items[0].activeParticipantCount, 1)
    assert.equal(adminList.body.canManage, false)
    assert.equal(adminList.body.canOperate, true)
    assert.equal(
      JSON.stringify(adminList.body).includes(fx.t1 + "/"),
      false,
      "Raw storage paths must never appear in API JSON"
    )

    const pengurusDetail = await apiGetJson(
      nextServer.baseUrl,
      `/api/activities/${detail1.activity.id}`,
      pengurus.cookie
    )
    assert.equal(pengurusDetail.status, 200)
    assert.equal(pengurusDetail.body.permissions.canCompleteActivity, true)
    assert.equal(pengurusDetail.body.permissions.canRecordAttendance, true)
    assert.equal(pengurusDetail.body.permissions.canUploadDocuments, true)
    assert.equal(pengurusDetail.body.permissions.canUpdateInfo, false)
    assert.equal(pengurusDetail.body.permissions.canCancelActivity, false)
    assert.equal(pengurusDetail.body.permissions.canSoftDelete, false)
    assert.equal(pengurusDetail.body.permissions.canManageParticipants, false)
    assert.equal(pengurusDetail.body.permissions.canRemoveDocuments, false)

    const participantsRes = await apiGetJson(
      nextServer.baseUrl,
      `/api/activities/${detail1.activity.id}/participants`,
      pengurus.cookie
    )
    assert.equal(participantsRes.status, 200)
    assert.equal(participantsRes.body.items.length, 1)
    assert.equal(
      participantsRes.body.items[0].residentNameSnapshot,
      "Warga 15.2 A"
    )

    // Cross-tenant admin sees 0 / 404
    const t2List = await apiGetJson(
      nextServer.baseUrl,
      "/api/activities",
      tenant2Ketua.cookie
    )
    assert.equal(t2List.status, 200)
    assert.equal(t2List.body.items.length, 0)
    assert.equal(
      (
        await apiGetJson(
          nextServer.baseUrl,
          `/api/activities/${detail1.activity.id}`,
          tenant2Ketua.cookie
        )
      ).status,
      404
    )

    // 4e. Resident HTTP routes: list, detail, registration, history + admin blocked (403)
    assert.equal(
      (
        await apiGetJson(
          nextServer.baseUrl,
          "/api/resident/activities",
          ketua.cookie
        )
      ).status,
      403
    )
    assert.equal(
      (
        await apiGetJson(
          nextServer.baseUrl,
          "/api/activities",
          wargaA.cookie
        )
      ).status,
      403
    )

    const resListA = await apiGetJson(
      nextServer.baseUrl,
      "/api/resident/activities",
      wargaA.cookie
    )
    assert.equal(resListA.status, 200)
    assert.equal(resListA.body.items.length, 2)
    const resAct1A = resListA.body.items.find(
      (x) => x.id === detail1.activity.id
    )
    assert.equal(resAct1A.activeParticipantCount, 1)
    assert.equal(resAct1A.myRegistration?.rsvpStatus, "attended")
    assert.equal(resAct1A.canRegister, false)
    assert.equal(
      JSON.stringify(resListA.body).includes("Blok G-02"),
      false,
      "Other residents PII must never appear in resident activity feed"
    )

    const resDetailB = await apiGetJson(
      nextServer.baseUrl,
      `/api/resident/activities/${detail1.activity.id}`,
      wargaB.cookie
    )
    assert.equal(resDetailB.status, 200)
    assert.equal(resDetailB.body.myRegistration, null)
    assert.equal(resDetailB.body.isEligibleResident, true)
    assert.equal(resDetailB.body.activity.activeParticipantCount, 1)
    assert.equal(resDetailB.body.activity.canRegister, true)

    const resRegInactive = await apiGetJson(
      nextServer.baseUrl,
      `/api/resident/activities/${detail1.activity.id}/registration`,
      wargaInactive.cookie
    )
    assert.equal(resRegInactive.status, 200)
    assert.equal(resRegInactive.body.isEligibleResident, false)
    assert.equal(resRegInactive.body.canRegister, false)

    const resHistoryA = await apiGetJson(
      nextServer.baseUrl,
      "/api/resident/activities?view=history",
      wargaA.cookie
    )
    assert.equal(resHistoryA.status, 200)
    assert.equal(resHistoryA.body.items.length, 1)

    const resHistoryB = await apiGetJson(
      nextServer.baseUrl,
      "/api/resident/activities?view=history",
      wargaB.cookie
    )
    assert.equal(resHistoryB.status, 200)
    assert.equal(resHistoryB.body.items.length, 0)

    // 4f. Private Document Proxy streaming + headers + removal + soft-delete blocking
    for (const [label, cookie] of [
      ["ketua", ketua.cookie],
      ["sekre", sekre.cookie],
      ["pengurus", pengurus.cookie],
      ["wargaA", wargaA.cookie],
    ]) {
      const dlPng = await fetch(
        `${nextServer.baseUrl}/api/activities/${detail1.activity.id}/documents/${docPng.document.fileId}`,
        { headers: { Cookie: cookie }, redirect: "manual" }
      )
      assert.equal(dlPng.status, 200, `${label} must access activity PNG doc`)
      assert.equal(dlPng.headers.get("content-type"), "image/png")
      assert.equal(dlPng.headers.get("cache-control"), "private, no-store")
      assert.equal(dlPng.headers.get("x-content-type-options"), "nosniff")
      assert.match(dlPng.headers.get("content-disposition") ?? "", /^inline;/)
      const bytes = new Uint8Array(await dlPng.arrayBuffer())
      assert.deepEqual(bytes, TINY_PNG)
    }

    const dlPdfAttachment = await fetch(
      `${nextServer.baseUrl}/api/activities/${detail1.activity.id}/documents/${docPdf.document.fileId}?download=1`,
      { headers: { Cookie: wargaA.cookie }, redirect: "manual" }
    )
    assert.equal(dlPdfAttachment.status, 200)
    assert.equal(dlPdfAttachment.headers.get("content-type"), "application/pdf")
    assert.match(
      dlPdfAttachment.headers.get("content-disposition") ?? "",
      /^attachment;/
    )

    // Cross-tenant proxy blocked -> 404
    assert.equal(
      (
        await apiGetJson(
          nextServer.baseUrl,
          `/api/activities/${detail1.activity.id}/documents/${docPng.document.fileId}`,
          tenant2Ketua.cookie
        )
      ).status,
      404
    )

    // Removing PDF document makes proxy immediately return 404
    const removeDocRes = await repository.removeActivityDocWithClient(
      ketua.client,
      {
        tenantId: fx.t1,
        roles: ["ketua_rt"],
        input: {
          activityId: detail1.activity.id,
          fileId: docPdf.document.fileId,
          reason: "Revisi lampiran",
        },
      }
    )
    assert.ok(removeDocRes.jobId)

    assert.equal(
      (
        await apiGetJson(
          nextServer.baseUrl,
          `/api/activities/${detail1.activity.id}/documents/${docPdf.document.fileId}`,
          ketua.cookie
        )
      ).status,
      404
    )

    // Soft-deleting activity 1 hides it from resident endpoints & blocks proxy
    const softDel = await repository.softDeleteActivityWithClient(ketua.client, {
      tenantId: fx.t1,
      roles: ["ketua_rt"],
      input: { activityId: detail1.activity.id, reason: "Uji selesai" },
    })
    assert.equal(softDel.deleted, true)

    assert.equal(
      (
        await apiGetJson(
          nextServer.baseUrl,
          `/api/resident/activities/${detail1.activity.id}`,
          wargaA.cookie
        )
      ).status,
      404
    )
    assert.equal(
      (
        await apiGetJson(
          nextServer.baseUrl,
          `/api/activities/${detail1.activity.id}/documents/${docPng.document.fileId}`,
          wargaA.cookie
        )
      ).status,
      404
    )
  } finally {
    if (nextServer) {
      await nextServer.stop()
    }
    if (createdTenantIds.length > 0) {
      const tenantList = createdTenantIds.map((id) => `'${id}'`).join(",")
      const storagePathsRaw = runSql(`
        SELECT string_agg(name, E'\\n')
        FROM storage.objects
        WHERE bucket_id = 'activity-docs'
          AND split_part(name, '/', 1) IN (${tenantList});
      `)
      if (storagePathsRaw) {
        const paths = storagePathsRaw.split("\n").filter(Boolean)
        if (paths.length > 0) {
          await adminAuth.storage.from("activity-docs").remove(paths)
        }
      }
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

