import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { setTimeout as delay } from "node:timers/promises"
import test from "node:test"
import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"

import {
  loadComplaintsTestModules,
  runSupabaseCliStatus,
} from "./helpers/load-complaints-modules.mjs"

const { repository, storage } = loadComplaintsTestModules()

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
  const contentType = res.headers.get("content-type") ?? ""
  const body = contentType.includes("application/json")
    ? await res.json()
    : await res.text()
  return {
    status: res.status,
    cacheControl: res.headers.get("cache-control"),
    contentType,
    body,
  }
}

async function apiGetRaw(baseUrl, path, cookieHeader) {
  const headers = cookieHeader ? { Cookie: cookieHeader } : {}
  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers,
    redirect: "manual",
  })
  const bytes = new Uint8Array(await res.arrayBuffer())
  return {
    status: res.status,
    cacheControl: res.headers.get("cache-control"),
    contentType: res.headers.get("content-type") ?? "",
    nosniff: res.headers.get("x-content-type-options"),
    bytes,
  }
}

async function apiGetHtml(baseUrl, path, cookieHeader) {
  const headers = cookieHeader ? { Cookie: cookieHeader } : {}
  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers,
    redirect: "manual",
  })
  return {
    status: res.status,
    location: res.headers.get("location") ?? "",
    html: await res.text(),
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
  assert.equal(
    res.status,
    200,
    `Expected 307 or PPR 200 stream, got ${res.status}`
  )
  assert.match(res.html, /NEXT_REDIRECT/)
  assert.ok(
    res.html.includes(expectedTarget),
    `Expected streamed NEXT_REDIRECT payload to reference "${expectedTarget}"`
  )
  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(res.html, pattern)
  }
}

function assertServerNotFound(res, forbiddenPatterns = []) {
  if (res.status === 404) return
  assert.equal(
    res.status,
    200,
    `Expected 404 or PPR 200 stream, got ${res.status}`
  )
  assert.match(res.html, /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/)
  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(res.html, pattern)
  }
}

function makeSamplePngFile() {
  // Valid minimal 1x1 PNG header + signature + IEND
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ])
  return new File([bytes], "lampu-mati.png", { type: "image/png" })
}

test("Step 13.2 integration: repository, RPCs, storage, API routes, role matrix, and tenant isolation", async () => {
  const status = runSupabaseCliStatus()
  const supabaseUrl = status.API_URL || "http://127.0.0.1:54321"
  const anonKey = status.ANON_KEY
  const serviceRoleKey = status.SERVICE_ROLE_KEY

  assert.ok(anonKey && serviceRoleKey, "Local Supabase keys must exist")

  // Admin auth client strictly for creating & deleting disposable test users
  const adminAuth = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const createdUserIds = []
  const createdTenantIds = []
  const uploadedStoragePaths = []
  let nextServer = null
  const runTag = Date.now()
  const password = "TestPassword123!"

  async function createActor(label) {
    const email = `complaints.13_2.${label}.${runTag}@example.com`
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
    const pengurus = await createActor("pengurus")
    const bendahara = await createActor("bendahara")
    const wargaA = await createActor("wargaa")
    const wargaB = await createActor("wargab")
    const tenant2Ketua = await createActor("t2ketua")
    const superAdmin = await createActor("super")

    const setupRaw = runSql(`
      WITH t AS (
        INSERT INTO public.tenants (code, name, rt_number, rw_number, kelurahan, kecamatan, city, province, status)
        VALUES
          ('rt-132-a-${runTag}', 'RT 13.2 A', '031', '005', 'Dago', 'Coblong', 'Bandung', 'Jawa Barat', 'active'),
          ('rt-132-b-${runTag}', 'RT 13.2 B', '032', '005', 'Dago', 'Coblong', 'Bandung', 'Jawa Barat', 'active')
        RETURNING id, rt_number
      ),
      h AS (
        INSERT INTO public.households (tenant_id, kk_number, address, block_unit, status)
        SELECT t.id, '3273011320000001', 'Jl. Anggrek No. 1', 'Blok A-01', 'active'
        FROM t
        WHERE t.rt_number = '031'
        RETURNING id, tenant_id
      ),
      r AS (
        INSERT INTO public.residents (tenant_id, household_id, full_name, gender, family_role, residency_status)
        SELECT h.tenant_id, h.id, v.full_name, 'L', 'anak', 'aktif'
        FROM h
        CROSS JOIN (VALUES ('Warga Pelapor A'), ('Warga Tetangga B')) AS v(full_name)
        RETURNING id, tenant_id, full_name
      ),
      prof AS (
        INSERT INTO public.profiles (id, full_name, is_super_admin)
        VALUES
          ('${ketua.user.id}', 'Ketua 13.2', false),
          ('${sekre.user.id}', 'Sekretaris 13.2', false),
          ('${pengurus.user.id}', 'Pengurus 13.2', false),
          ('${bendahara.user.id}', 'Bendahara 13.2', false),
          ('${wargaA.user.id}', 'Warga Pelapor A', false),
          ('${wargaB.user.id}', 'Warga Tetangga B', false),
          ('${tenant2Ketua.user.id}', 'Ketua Tenant 2', false),
          ('${superAdmin.user.id}', 'Super Admin NonMember', true)
        ON CONFLICT (id) DO UPDATE SET is_super_admin = EXCLUDED.is_super_admin
      ),
      tm AS (
        INSERT INTO public.tenant_members (tenant_id, user_id, resident_id, status)
        VALUES
          ((SELECT id FROM t WHERE rt_number='031'), '${ketua.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='031'), '${sekre.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='031'), '${pengurus.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='031'), '${bendahara.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='031'), '${wargaA.user.id}', (SELECT id FROM r WHERE full_name='Warga Pelapor A'), 'active'),
          ((SELECT id FROM t WHERE rt_number='031'), '${wargaB.user.id}', (SELECT id FROM r WHERE full_name='Warga Tetangga B'), 'active'),
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
          ('${tenant2Ketua.user.id}', 'ketua_rt')
        ) AS m(uid, rcode) ON m.uid::uuid = tm.user_id
        JOIN public.roles rl ON rl.code = m.rcode
      )
      SELECT json_build_object(
        't1', (SELECT id FROM t WHERE rt_number='031'),
        't2', (SELECT id FROM t WHERE rt_number='032'),
        'ketuaMemberId', (SELECT id FROM tm WHERE user_id='${ketua.user.id}'),
        'sekreMemberId', (SELECT id FROM tm WHERE user_id='${sekre.user.id}'),
        'pengurusMemberId', (SELECT id FROM tm WHERE user_id='${pengurus.user.id}'),
        'bendaharaMemberId', (SELECT id FROM tm WHERE user_id='${bendahara.user.id}'),
        'wargaAMemberId', (SELECT id FROM tm WHERE user_id='${wargaA.user.id}'),
        'wargaBMemberId', (SELECT id FROM tm WHERE user_id='${wargaB.user.id}'),
        't2KetuaMemberId', (SELECT id FROM tm WHERE user_id='${tenant2Ketua.user.id}')
      )::text;
    `)

    const fx = JSON.parse(setupRaw)
    createdTenantIds.push(fx.t1, fx.t2)

    const testPort = 3200 + (runTag % 400)
    nextServer = await startNextServer(testPort, {
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    })
    const { baseUrl } = nextServer

    // -------------------------------------------------------------------------
    // 1. Create complaints by Warga A & Warga B
    // -------------------------------------------------------------------------
    const compA = await repository.createComplaintWithClient(wargaA.client, {
      tenantId: fx.t1,
      memberId: fx.wargaAMemberId,
      input: {
        category: "Fasilitas",
        title: "Lampu Pos Ronda Mati Total",
        description: "Lampu penerangan utama di pos ronda mati sejak dua hari lalu.",
      },
    })
    assert.equal(compA.status, "open")
    assert.equal(compA.priority, "medium")
    assert.equal(compA.photoPath, null)
    assert.equal(compA.reporterMemberId, fx.wargaAMemberId)

    const compB = await repository.createComplaintWithClient(wargaB.client, {
      tenantId: fx.t1,
      memberId: fx.wargaBMemberId,
      input: {
        category: "Kebersihan",
        title: "Saluran Air Tersumbat",
        description: "Selokan di dekat blok A mampet setelah hujan deras.",
      },
    })

    // -------------------------------------------------------------------------
    // 2. Edit while open & block edit by another resident
    // -------------------------------------------------------------------------
    const updatedA = await repository.updateComplaintWithClient(wargaA.client, {
      tenantId: fx.t1,
      memberId: fx.wargaAMemberId,
      input: {
        complaintId: compA.id,
        category: "Keamanan",
        title: "Lampu Pos Ronda Mati Total (Revisi)",
        description: "Lampu utama pos ronda mati dan kondisi gang sangat gelap malam hari.",
      },
    })
    assert.equal(updatedA.category, "Keamanan")
    assert.equal(updatedA.title, "Lampu Pos Ronda Mati Total (Revisi)")

    await assert.rejects(
      repository.updateComplaintWithClient(wargaB.client, {
        tenantId: fx.t1,
        memberId: fx.wargaBMemberId,
        input: {
          complaintId: compA.id,
          category: "Fasilitas",
          title: "Bajakan Warga B",
          description: "Seharusnya ditolak oleh repository dan RLS.",
        },
      }),
      (err) => err.status === 404 && err.code === "NOT_FOUND"
    )

    // -------------------------------------------------------------------------
    // 3. Photo upload + DB path enforcement + Storage streaming access matrix
    // -------------------------------------------------------------------------
    // Direct UPDATE photo_path by authenticated client MUST fail
    const directUpdatePhoto = await wargaA.client
      .from("complaints")
      .update({ photo_path: `${fx.t1}/${compA.id}/11111111-1111-4111-8111-111111111111.png` })
      .eq("id", compA.id)
    assert.ok(directUpdatePhoto.error, "Direct UPDATE complaints.photo_path must fail")

    // Wrong tenant/complaint segment in attach_complaint_photo RPC must fail
    const wrongAttach = await wargaA.client.rpc("attach_complaint_photo", {
      p_complaint_id: compA.id,
      p_storage_path: `${fx.t2}/${compA.id}/11111111-1111-4111-8111-111111111111.png`,
    })
    assert.ok(wrongAttach.error, "Mismatched tenant path in attach_complaint_photo must fail")

    // Upload valid PNG photo as Warga A
    const pngFile = makeSamplePngFile()
    const validatedPng = await storage.validateComplaintPhotoFile(pngFile)
    assert.equal(validatedPng.ok, true)

    const uploaded = await repository.uploadComplaintPhotoWithClient(
      wargaA.client,
      {
        tenantId: fx.t1,
        memberId: fx.wargaAMemberId,
        complaintId: compA.id,
        validatedFile: validatedPng.file,
      }
    )
    uploadedStoragePaths.push(uploaded.photoPath)
    assert.ok(storage.complaintPhotoPathBelongsTo(uploaded.photoPath, fx.t1, compA.id))
    assert.equal(uploaded.photoUrl, `/api/complaints/${compA.id}/photo`)

    // Photo streaming access check: owner + ketua + sekre + pengurus = 200
    for (const [label, actor] of [
      ["wargaA", wargaA],
      ["ketua_rt", ketua],
      ["sekretaris", sekre],
      ["pengurus", pengurus],
    ]) {
      const photoRes = await apiGetRaw(
        baseUrl,
        `/api/complaints/${compA.id}/photo`,
        actor.cookie
      )
      assert.equal(photoRes.status, 200, `${label} should read photo (200)`)
      assert.equal(photoRes.contentType, "image/png")
      assert.equal(photoRes.nosniff, "nosniff")
      assert.match(photoRes.cacheControl ?? "", /no-store/)
      assert.ok(photoRes.bytes.byteLength > 8)
    }

    // Bendahara MUST NOT access photo streaming (403) nor see photoPath/photoUrl in API!
    const bendaharaPhoto = await apiGetRaw(
      baseUrl,
      `/api/complaints/${compA.id}/photo`,
      bendahara.cookie
    )
    assert.equal(bendaharaPhoto.status, 403)

    const bendaharaList = await apiGetJson(
      baseUrl,
      "/api/complaints",
      bendahara.cookie
    )
    assert.equal(bendaharaList.status, 200)
    assert.equal(bendaharaList.body.isMetadataOnly, true)
    const bendaharaItemA = bendaharaList.body.items.find((i) => i.id === compA.id)
    assert.ok(bendaharaItemA)
    assert.equal(bendaharaItemA.photoPath, null)
    assert.equal(bendaharaItemA.photoUrl, null)
    assert.equal(bendaharaItemA.hasPhoto, false)

    const bendaharaDetail = await apiGetJson(
      baseUrl,
      `/api/complaints/${compA.id}`,
      bendahara.cookie
    )
    assert.equal(bendaharaDetail.status, 200)
    assert.equal(bendaharaDetail.body.complaint.photoPath, null)
    assert.equal(bendaharaDetail.body.complaint.photoUrl, null)
    assert.equal(bendaharaDetail.body.complaint.hasPhoto, false)
    assert.equal(bendaharaDetail.body.permissions.canViewPhoto, false)
    assert.equal(bendaharaDetail.body.permissions.isMetadataOnly, true)

    // Warga B, Super Admin non-member, Cross-tenant, Unauthenticated photo access denied
    assert.equal(
      (await apiGetRaw(baseUrl, `/api/complaints/${compA.id}/photo`, wargaB.cookie)).status,
      404
    )
    assert.equal(
      (await apiGetRaw(baseUrl, `/api/complaints/${compA.id}/photo`, superAdmin.cookie)).status,
      403
    )
    assert.equal(
      (await apiGetRaw(baseUrl, `/api/complaints/${compA.id}/photo`, tenant2Ketua.cookie)).status,
      404
    )
    assert.equal(
      (await apiGetRaw(baseUrl, `/api/complaints/${compA.id}/photo`, null)).status,
      401
    )

    // -------------------------------------------------------------------------
    // 4. Replies, Bendahara write blocks, & non-NULL attachment block
    // -------------------------------------------------------------------------
    const replyByWarga = await repository.createComplaintReplyWithClient(
      wargaA.client,
      {
        tenantId: fx.t1,
        memberId: fx.wargaAMemberId,
        roles: ["warga"],
        scope: "resident",
        input: {
          complaintId: compA.id,
          message: "Mohon dicek juga saklar di dinding pos.",
        },
      }
    )
    assert.equal(replyByWarga.attachmentPath, null)

    const replyByPengurus = await repository.createComplaintReplyWithClient(
      pengurus.client,
      {
        tenantId: fx.t1,
        memberId: fx.pengurusMemberId,
        roles: ["pengurus"],
        scope: "admin",
        input: {
          complaintId: compA.id,
          message: "Petugas kelistrikan segera kami koordinasikan.",
        },
      }
    )
    assert.equal(replyByPengurus.attachmentPath, null)

    // Bendahara cannot reply, transition, soft-delete, or delete photo
    await assert.rejects(
      repository.createComplaintReplyWithClient(bendahara.client, {
        tenantId: fx.t1,
        memberId: fx.bendaharaMemberId,
        roles: ["bendahara"],
        scope: "admin",
        input: { complaintId: compA.id, message: "Tidak boleh" },
      }),
      (err) => err.status === 403
    )
    await assert.rejects(
      repository.transitionComplaintStatusWithClient(bendahara.client, {
        tenantId: fx.t1,
        roles: ["bendahara"],
        input: { complaintId: compA.id, newStatus: "in_progress", reason: "No" },
      }),
      (err) => err.status === 403
    )
    await assert.rejects(
      repository.softDeleteComplaintWithClient(bendahara.client, {
        tenantId: fx.t1,
        roles: ["bendahara"],
        input: { complaintId: compA.id, reason: "Tidak berhak" },
      }),
      (err) => err.status === 403
    )
    await assert.rejects(
      repository.requestDeleteComplaintPhotoWithClient(bendahara.client, {
        tenantId: fx.t1,
        memberId: fx.bendaharaMemberId,
        roles: ["bendahara"],
        scope: "admin",
        input: { complaintId: compA.id, reason: "No" },
      }),
      (err) => err.status === 403
    )

    // -------------------------------------------------------------------------
    // 5. Status transition (open -> in_progress -> resolved) & locks
    // -------------------------------------------------------------------------
    await repository.transitionComplaintStatusWithClient(sekre.client, {
      tenantId: fx.t1,
      roles: ["sekretaris"],
      input: {
        complaintId: compA.id,
        newStatus: "in_progress",
        reason: "Sedang dibelikan lampu pengganti",
      },
    })

    // Resident cannot edit once status is in_progress
    await assert.rejects(
      repository.updateComplaintWithClient(wargaA.client, {
        tenantId: fx.t1,
        memberId: fx.wargaAMemberId,
        input: {
          complaintId: compA.id,
          category: "Keamanan",
          title: "Ubah Setelah Diproses",
          description: "Seharusnya tidak bisa diubah saat status Diproses.",
        },
      }),
      (err) => err.code === "INVALID_STATE"
    )

    // Warga A can still reply during in_progress
    await repository.createComplaintReplyWithClient(wargaA.client, {
      tenantId: fx.t1,
      memberId: fx.wargaAMemberId,
      roles: ["warga"],
      scope: "resident",
      input: {
        complaintId: compA.id,
        message: "Terima kasih atas tindak lanjutnya.",
      },
    })

    // Resolve via Ketua RT
    await repository.transitionComplaintStatusWithClient(ketua.client, {
      tenantId: fx.t1,
      roles: ["ketua_rt"],
      input: {
        complaintId: compA.id,
        newStatus: "resolved",
        reason: "Lampu sudah diganti dan menyala normal",
      },
    })

    // Cannot reopen or reply once resolved
    await assert.rejects(
      repository.transitionComplaintStatusWithClient(ketua.client, {
        tenantId: fx.t1,
        roles: ["ketua_rt"],
        input: {
          complaintId: compA.id,
          newStatus: "in_progress",
          reason: "Reopen dilarang",
        },
      }),
      (err) => err.code === "INVALID_STATE"
    )
    await assert.rejects(
      repository.createComplaintReplyWithClient(wargaA.client, {
        tenantId: fx.t1,
        memberId: fx.wargaAMemberId,
        roles: ["warga"],
        scope: "resident",
        input: {
          complaintId: compA.id,
          message: "Balasan setelah selesai dilarang",
        },
      }),
      (err) => err.code === "INVALID_STATE"
    )

    // -------------------------------------------------------------------------
    // 6. List, Filter, Search, Pagination & Resident/Cross-Tenant API Checks
    // -------------------------------------------------------------------------
    const adminFiltered = await apiGetJson(
      baseUrl,
      "/api/complaints?status=resolved&category=Keamanan&search=Pos%20Ronda",
      ketua.cookie
    )
    assert.equal(adminFiltered.status, 200)
    assert.match(adminFiltered.cacheControl ?? "", /no-store/)
    assert.equal(adminFiltered.body.totalCount, 1)
    assert.equal(adminFiltered.body.items[0].id, compA.id)
    assert.equal(adminFiltered.body.items[0].photoUrl, `/api/complaints/${compA.id}/photo`)
    assert.equal(adminFiltered.body.summary.resolved, 1)
    assert.equal(adminFiltered.body.summary.open, 1)

    const adminDetailA = await apiGetJson(
      baseUrl,
      `/api/complaints/${compA.id}`,
      pengurus.cookie
    )
    assert.equal(adminDetailA.status, 200)
    assert.equal(adminDetailA.body.replies.length, 3)
    assert.equal(adminDetailA.body.statusHistory.length, 2)

    // Resident API: Warga A only sees compA, not compB; Warga A cannot read /api/complaints
    const residentListA = await apiGetJson(
      baseUrl,
      "/api/resident/complaints",
      wargaA.cookie
    )
    assert.equal(residentListA.status, 200)
    assert.equal(residentListA.body.totalCount, 1)
    assert.equal(residentListA.body.items[0].id, compA.id)

    assert.equal(
      (await apiGetJson(baseUrl, `/api/resident/complaints/${compB.id}`, wargaA.cookie)).status,
      404
    )
    assert.equal(
      (await apiGetJson(baseUrl, "/api/complaints", wargaA.cookie)).status,
      403
    )

    // Super Admin non-member & cross-tenant rejected
    assert.equal(
      (await apiGetJson(baseUrl, "/api/complaints", superAdmin.cookie)).status,
      403
    )
    assert.equal(
      (await apiGetJson(baseUrl, "/api/resident/complaints", superAdmin.cookie)).status,
      403
    )
    const crossList = await apiGetJson(
      baseUrl,
      "/api/complaints",
      tenant2Ketua.cookie
    )
    assert.equal(crossList.status, 200)
    assert.equal(crossList.body.totalCount, 0)
    assert.equal(
      (await apiGetJson(baseUrl, `/api/complaints/${compA.id}`, tenant2Ketua.cookie)).status,
      404
    )

    // -------------------------------------------------------------------------
    // 6B. Step 13.3 Admin Complaints UI SSR & Role Authorization Checks
    // -------------------------------------------------------------------------
    const unauthPage = await apiGetHtml(baseUrl, "/pengaduan")
    assertServerRedirect(unauthPage, "/login", [/Saluran Air Tersumbat/])

    const wargaPage = await apiGetHtml(baseUrl, "/pengaduan", wargaA.cookie)
    assertServerRedirect(wargaPage, "/resident", [/Saluran Air Tersumbat/])

    const superAdminPage = await apiGetHtml(baseUrl, "/pengaduan", superAdmin.cookie)
    assertServerRedirect(superAdminPage, "/super-admin", [/Saluran Air Tersumbat/])

    for (const [roleLabel, cookie] of [
      ["ketua_rt", ketua.cookie],
      ["sekretaris", sekre.cookie],
      ["pengurus", pengurus.cookie],
    ]) {
      const listPage = await apiGetHtml(baseUrl, "/pengaduan", cookie)
      assert.equal(listPage.status, 200, `${roleLabel} must access /pengaduan`)
      assert.match(listPage.html, /Pengaduan Warga/)
      assert.match(listPage.html, /Lampu Pos Ronda Mati Total \(Revisi\)/)
      assert.match(listPage.html, /Saluran Air Tersumbat/)
    }

    const detailOpenB = await apiGetHtml(baseUrl, `/pengaduan/${compB.id}`, ketua.cookie)
    assert.equal(detailOpenB.status, 200)
    assert.match(detailOpenB.html, /Tandai Diproses/)
    assert.match(detailOpenB.html, /Tandai Selesai/)
    assert.match(detailOpenB.html, /Tolak Pengaduan/)
    assert.match(detailOpenB.html, /Hapus Pengaduan/)
    assert.match(detailOpenB.html, /Kirim Balasan/)

    const detailResolvedA = await apiGetHtml(baseUrl, `/pengaduan/${compA.id}`, pengurus.cookie)
    assert.equal(detailResolvedA.status, 200)
    assert.match(detailResolvedA.html, new RegExp(`/api/complaints/${compA.id}/photo`))
    assert.match(detailResolvedA.html, /Lampu sudah diganti dan menyala normal/)
    assert.equal(detailResolvedA.html.includes("Kirim Balasan"), false)
    assert.equal(detailResolvedA.html.includes("Tandai Diproses"), false)

    const bendaharaListPage = await apiGetHtml(baseUrl, "/pengaduan", bendahara.cookie)
    assert.equal(bendaharaListPage.status, 200)
    assert.match(bendaharaListPage.html, /Mode Metadata \(Bendahara\)/)

    const bendaharaDetailPageA = await apiGetHtml(baseUrl, `/pengaduan/${compA.id}`, bendahara.cookie)
    assert.equal(bendaharaDetailPageA.status, 200)
    assert.match(bendaharaDetailPageA.html, /Lampiran Foto Dibatasi/)
    assert.equal(
      bendaharaDetailPageA.html.includes(`/api/complaints/${compA.id}/photo`),
      false,
      "Bendahara SSR HTML must never include photo endpoint URL"
    )
    assert.equal(bendaharaDetailPageA.html.includes("Kirim Balasan"), false)
    assert.equal(bendaharaDetailPageA.html.includes("Hapus Pengaduan"), false)
    assert.equal(bendaharaDetailPageA.html.includes("Tandai Diproses"), false)

    assertServerNotFound(
      await apiGetHtml(baseUrl, `/pengaduan/${compA.id}`, tenant2Ketua.cookie),
      [/Lampu sudah diganti dan menyala normal/]
    )
    assertServerNotFound(
      await apiGetHtml(baseUrl, "/pengaduan/not-a-valid-uuid", ketua.cookie)
    )

    // -------------------------------------------------------------------------
    // 6C. Step 13.4 Resident Complaints UI SSR, Ownership & Lifecycle Checks
    // -------------------------------------------------------------------------
    assertServerRedirect(
      await apiGetHtml(baseUrl, "/resident/complaints"),
      "/login",
      [/Saluran Air Tersumbat/]
    )
    assertServerRedirect(
      await apiGetHtml(baseUrl, "/resident/complaints/new"),
      "/login"
    )
    assertServerRedirect(
      await apiGetHtml(baseUrl, "/resident/complaints", ketua.cookie),
      "/",
      [/Saluran Air Tersumbat/]
    )
    assertServerRedirect(
      await apiGetHtml(baseUrl, "/resident/complaints", superAdmin.cookie),
      "/super-admin",
      [/Saluran Air Tersumbat/]
    )

    const layananPage = await apiGetHtml(baseUrl, "/resident/layanan", wargaA.cookie)
    assert.equal(layananPage.status, 200)
    assert.match(layananPage.html, /Pengaduan Warga/)
    assert.match(layananPage.html, /\/resident\/complaints/)

    const residentListPageA = await apiGetHtml(baseUrl, "/resident/complaints", wargaA.cookie)
    assert.equal(residentListPageA.status, 200)
    assert.match(residentListPageA.html, /Pengaduan Saya/)
    assert.match(residentListPageA.html, /Lampu Pos Ronda Mati Total \(Revisi\)/)
    assert.equal(
      residentListPageA.html.includes("Saluran Air Tersumbat"),
      false,
      "Resident A must never see Resident B complaint in /resident/complaints"
    )

    const residentNewPageA = await apiGetHtml(baseUrl, "/resident/complaints/new", wargaA.cookie)
    assert.equal(residentNewPageA.status, 200)
    assert.match(residentNewPageA.html, /Buat Pengaduan Baru/)
    assert.match(residentNewPageA.html, /Fasilitas/)

    // Cross-owner & cross-tenant & invalid UUID access returns Not Found
    assertServerNotFound(
      await apiGetHtml(baseUrl, `/resident/complaints/${compA.id}`, wargaB.cookie),
      [/Lampu sudah diganti dan menyala normal/]
    )
    assertServerNotFound(
      await apiGetHtml(baseUrl, `/resident/complaints/${compB.id}`, wargaA.cookie),
      [/Saluran Air Tersumbat/]
    )
    assertServerNotFound(
      await apiGetHtml(baseUrl, "/resident/complaints/not-a-valid-uuid", wargaA.cookie)
    )

    // Resident A views own RESOLVED compA: has photo URL, replies, statusHistory, read-only notice, NO edit/reply/admin controls
    const residentDetailA = await apiGetHtml(
      baseUrl,
      `/resident/complaints/${compA.id}`,
      wargaA.cookie
    )
    assert.equal(residentDetailA.status, 200)
    assert.match(residentDetailA.html, new RegExp(`/api/complaints/${compA.id}/photo`))
    assert.match(residentDetailA.html, /Lampu sudah diganti dan menyala normal/)
    assert.match(residentDetailA.html, /mode baca-saja/)
    assert.equal(residentDetailA.html.includes("Ubah Pengaduan"), false)
    assert.equal(residentDetailA.html.includes("Kirim Balasan"), false)
    assert.equal(residentDetailA.html.includes("Tandai Diproses"), false)
    assert.equal(residentDetailA.html.includes("Hapus Pengaduan"), false)

    // Resident B views own OPEN compB: has edit button, reply form, photo upload control, NO admin controls
    const residentDetailB = await apiGetHtml(
      baseUrl,
      `/resident/complaints/${compB.id}`,
      wargaB.cookie
    )
    assert.equal(residentDetailB.status, 200)
    assert.match(residentDetailB.html, /Saluran Air Tersumbat/)
    assert.match(residentDetailB.html, /Ubah Pengaduan/)
    assert.match(residentDetailB.html, /Kirim Balasan/)
    assert.match(residentDetailB.html, /Unggah Foto/)
    assert.equal(residentDetailB.html.includes("Tandai Diproses"), false)
    assert.equal(residentDetailB.html.includes("Hapus Pengaduan"), false)

    // -------------------------------------------------------------------------
    // 7. Request Delete Photo RPC + Soft Delete Complaint + History Privacy
    // -------------------------------------------------------------------------
    const delPhotoRes = await repository.requestDeleteComplaintPhotoWithClient(
      pengurus.client,
      {
        tenantId: fx.t1,
        memberId: fx.pengurusMemberId,
        roles: ["pengurus"],
        scope: "admin",
        input: { complaintId: compA.id, reason: "Pengujian hapus foto" },
      }
    )
    assert.ok(delPhotoRes.jobId)

    const softDeleted = await repository.softDeleteComplaintWithClient(
      pengurus.client,
      {
        tenantId: fx.t1,
        roles: ["pengurus"],
        input: { complaintId: compA.id, reason: "Duplikasi laporan uji" },
      }
    )
    assert.equal(softDeleted.deleted, true)

    // Soft-deleted complaint excluded from admin & resident APIs and photo endpoint
    const afterDelAdminList = await apiGetJson(
      baseUrl,
      "/api/complaints",
      ketua.cookie
    )
    assert.equal(afterDelAdminList.body.totalCount, 1)
    assert.equal(afterDelAdminList.body.items[0].id, compB.id)
    assert.equal(
      (await apiGetJson(baseUrl, `/api/complaints/${compA.id}`, ketua.cookie)).status,
      404
    )
    assert.equal(
      (await apiGetJson(baseUrl, `/api/resident/complaints/${compA.id}`, wargaA.cookie)).status,
      404
    )
    assert.equal(
      (await apiGetRaw(baseUrl, `/api/complaints/${compA.id}/photo`, ketua.cookie)).status,
      404
    )
    assertServerNotFound(
      await apiGetHtml(baseUrl, `/pengaduan/${compA.id}`, ketua.cookie),
      [/Lampu sudah diganti dan menyala normal/]
    )
    assertServerNotFound(
      await apiGetHtml(baseUrl, `/resident/complaints/${compA.id}`, wargaA.cookie),
      [/Lampu sudah diganti dan menyala normal/]
    )

    // Reporter CANNOT read status history of soft-deleted complaint even via direct DB client
    const reporterDeletedHist = await wargaA.client
      .from("complaint_status_history")
      .select("id")
      .eq("complaint_id", compA.id)
    assert.equal(reporterDeletedHist.error, null)
    assert.equal(reporterDeletedHist.data.length, 0)

    // -------------------------------------------------------------------------
    // 8. Existing feature regression endpoints & pages
    // -------------------------------------------------------------------------
    assert.equal((await apiGetJson(baseUrl, "/api/ronda", ketua.cookie)).status, 200)
    assert.equal((await apiGetJson(baseUrl, "/api/resident/ronda", wargaA.cookie)).status, 200)
    assert.equal((await apiGetJson(baseUrl, "/api/analytics/admin", ketua.cookie)).status, 200)
    assert.equal(
      (await apiGetJson(baseUrl, "/api/notifications?scope=admin&mode=summary", ketua.cookie)).status,
      200
    )
    assert.equal(
      (await apiGetJson(baseUrl, "/api/notifications?scope=resident&mode=summary", wargaA.cookie)).status,
      200
    )
    assert.equal((await apiGetJson(baseUrl, "/announcements", ketua.cookie)).status, 200)
    assert.equal((await apiGetJson(baseUrl, "/residents", ketua.cookie)).status, 200)
    assert.equal((await apiGetJson(baseUrl, "/bills", ketua.cookie)).status, 200)
    assert.equal((await apiGetJson(baseUrl, "/notifications", ketua.cookie)).status, 200)
    assert.equal(
      (await apiGetJson(baseUrl, "/resident/notifications", wargaA.cookie)).status,
      200
    )
    assert.equal((await apiGetHtml(baseUrl, "/resident", wargaA.cookie)).status, 200)
    assert.equal((await apiGetHtml(baseUrl, "/resident/ronda", wargaA.cookie)).status, 200)
    assert.equal((await apiGetHtml(baseUrl, "/resident/bills", wargaA.cookie)).status, 200)
    assert.equal((await apiGetHtml(baseUrl, "/resident/announcements", wargaA.cookie)).status, 200)
    assert.equal((await apiGetHtml(baseUrl, "/resident/profile", wargaA.cookie)).status, 200)
    assert.equal((await apiGetHtml(baseUrl, "/resident/layanan", wargaA.cookie)).status, 200)
  } finally {
    if (nextServer) {
      await nextServer.stop()
    }
    if (uploadedStoragePaths.length > 0) {
      await adminAuth.storage.from("complaints").remove(uploadedStoragePaths)
    }
    if (createdTenantIds.length > 0) {
      const tenantList = createdTenantIds.map((id) => `'${id}'`).join(",")
      runSql(`
        DELETE FROM public.storage_deletion_queue WHERE tenant_id IN (${tenantList});
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
