import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { setTimeout as delay } from "node:timers/promises"
import test from "node:test"
import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"

import {
  loadLettersTestModules,
  runSupabaseCliStatus,
} from "./helpers/load-letters-modules.mjs"

const { constants, repository, storage } = loadLettersTestModules()

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
  const headers = {
    "Accept-Encoding": "identity",
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  }
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
    disposition: res.headers.get("content-disposition") ?? "",
    contentLength: res.headers.get("content-length"),
    nosniff: res.headers.get("x-content-type-options"),
    bytes,
  }
}

function makeSamplePngBytes() {
  return new Uint8Array([
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
}

function makeSamplePdfBytes() {
  return new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n")
}

async function makeValidatedPng() {
  const bytes = makeSamplePngBytes()
  const file = new File([bytes], "lampiran.png", { type: "image/png" })
  const res = await storage.validateLetterAttachmentFile(file)
  assert.equal(res.ok, true)
  return res.file
}

async function makeValidatedPdfAttachment() {
  const bytes = makeSamplePdfBytes()
  const file = new File([bytes], "pengantar.pdf", { type: "application/pdf" })
  const res = await storage.validateLetterAttachmentFile(file)
  assert.equal(res.ok, true)
  return res.file
}

async function makeValidatedIssuedPdf() {
  const bytes = makeSamplePdfBytes()
  const file = new File([bytes], "surat-resmi.pdf", { type: "application/pdf" })
  const res = await storage.validateIssuedLetterPdfFile(file)
  assert.equal(res.ok, true)
  return res.file
}

test("Step 14.2 integration: repository, RPCs, storage, API routes, private document proxy, role matrix, and tenant isolation", async () => {
  const status = runSupabaseCliStatus()
  const supabaseUrl = status.API_URL || "http://127.0.0.1:54321"
  const anonKey = status.ANON_KEY
  const serviceRoleKey = status.SERVICE_ROLE_KEY

  assert.ok(anonKey && serviceRoleKey, "Local Supabase keys must exist")

  // Strictly for creating/deleting disposable test Auth users and cleanup of uploaded Storage files
  const adminAuth = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const createdUserIds = []
  const createdTenantIds = []
  const runTag = Date.now()
  const password = "TestPassword123!"
  let nextServer = null

  async function createActor(label) {
    const email = `letters.14_2.${label}.${runTag}@example.com`
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
    const tenant2Ketua = await createActor("t2ketua")
    const superAdmin = await createActor("super")

    const setupRaw = runSql(`
      WITH t AS (
        INSERT INTO public.tenants (code, name, rt_number, rw_number, kelurahan, kecamatan, city, province, status)
        VALUES
          ('rt-142-a-${runTag}', 'RT Surat App A', '041', '004', 'Dago', 'Coblong', 'Bandung', 'Jawa Barat', 'active'),
          ('rt-142-b-${runTag}', 'RT Surat App B', '042', '004', 'Dago', 'Coblong', 'Bandung', 'Jawa Barat', 'active')
        RETURNING id, rt_number
      ),
      h AS (
        INSERT INTO public.households (tenant_id, kk_number, address, block_unit, status)
        SELECT t.id, '3273011420000001', 'Jl. Anggrek No. 41', 'Blok M-41', 'active'
        FROM t WHERE t.rt_number = '041'
        RETURNING id, tenant_id
      ),
      r AS (
        INSERT INTO public.residents (tenant_id, household_id, full_name, gender, family_role, residency_status)
        SELECT h.tenant_id, h.id, v.full_name, 'L', 'anak', 'aktif'
        FROM h
        CROSS JOIN (VALUES ('Pemohon Satu'), ('Warga Lain')) AS v(full_name)
        RETURNING id, tenant_id, full_name
      ),
      prof AS (
        INSERT INTO public.profiles (id, full_name, is_super_admin)
        VALUES
          ('${ketua.user.id}', 'Ketua 14.2', false),
          ('${sekre.user.id}', 'Sekretaris 14.2', false),
          ('${pengurus.user.id}', 'Pengurus 14.2', false),
          ('${bendahara.user.id}', 'Bendahara 14.2', false),
          ('${wargaA.user.id}', 'Pemohon Satu', false),
          ('${wargaB.user.id}', 'Warga Lain', false),
          ('${tenant2Ketua.user.id}', 'Ketua T2 14.2', false),
          ('${superAdmin.user.id}', 'Super Admin 14.2', true)
        ON CONFLICT (id) DO UPDATE SET is_super_admin = EXCLUDED.is_super_admin
      ),
      tm AS (
        INSERT INTO public.tenant_members (tenant_id, user_id, resident_id, status)
        VALUES
          ((SELECT id FROM t WHERE rt_number='041'), '${ketua.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='041'), '${sekre.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='041'), '${pengurus.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='041'), '${bendahara.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='041'), '${wargaA.user.id}', (SELECT id FROM r WHERE full_name='Pemohon Satu'), 'active'),
          ((SELECT id FROM t WHERE rt_number='041'), '${wargaB.user.id}', (SELECT id FROM r WHERE full_name='Warga Lain'), 'active'),
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
          ('${tenant2Ketua.user.id}', 'ketua_rt')
        ) AS m(uid, rname) ON m.uid::uuid = tm.user_id
        JOIN public.roles rl ON rl.code = m.rname
      )
      SELECT json_build_object(
        't1', (SELECT id FROM t WHERE rt_number='041'),
        't2', (SELECT id FROM t WHERE rt_number='042'),
        'wargaAMemberId', (SELECT id FROM tm WHERE user_id='${wargaA.user.id}'),
        'wargaAResidentId', (SELECT id FROM r WHERE full_name='Pemohon Satu'),
        'wargaBMemberId', (SELECT id FROM tm WHERE user_id='${wargaB.user.id}'),
        'wargaBResidentId', (SELECT id FROM r WHERE full_name='Warga Lain')
      )::text;
    `)

    const fx = JSON.parse(setupRaw)
    createdTenantIds.push(fx.t1, fx.t2)

    // -------------------------------------------------------------------------
    // 1. Letter Type CRUD & authorization
    // -------------------------------------------------------------------------
    await assert.rejects(
      () =>
        repository.createLetterTypeWithClient(pengurus.client, {
          tenantId: fx.t1,
          roles: ["pengurus"],
          input: { code: "NOPE", name: "Blocked" },
        }),
      (err) => err.status === 403 && err.code === "FORBIDDEN"
    )
    await assert.rejects(
      () =>
        repository.createLetterTypeWithClient(bendahara.client, {
          tenantId: fx.t1,
          roles: ["bendahara"],
          input: { code: "NOPE2", name: "Blocked" },
        }),
      (err) => err.status === 403 && err.code === "FORBIDDEN"
    )

    const activeType = await repository.createLetterTypeWithClient(ketua.client, {
      tenantId: fx.t1,
      roles: ["ketua_rt"],
      input: {
        code: "SK-DOM",
        name: "Surat Keterangan Domisili",
        description: "Surat keterangan domisili tinggal",
        requiredDocuments: ["KTP", "KK"],
        isActive: true,
      },
    })
    assert.equal(activeType.code, "SK-DOM")

    // Normalized code collision rejected (409 CONFLICT)
    await assert.rejects(
      () =>
        repository.createLetterTypeWithClient(sekre.client, {
          tenantId: fx.t1,
          roles: ["sekretaris"],
          input: {
            code: "sk dom",
            name: "Bentrok Kode",
            isActive: true,
          },
        }),
      (err) => err.status === 409 && err.code === "CONFLICT"
    )

    // Create inactive type & update/delete disposable type
    const inactiveType = await repository.createLetterTypeWithClient(sekre.client, {
      tenantId: fx.t1,
      roles: ["sekretaris"],
      input: {
        code: "NONAKTIF",
        name: "Jenis Nonaktif",
        isActive: false,
      },
    })
    assert.equal(inactiveType.isActive, false)

    const disposableType = await repository.createLetterTypeWithClient(
      ketua.client,
      {
        tenantId: fx.t1,
        roles: ["ketua_rt"],
        input: {
          code: "HAPUS_TMP",
          name: "Sementara",
          isActive: true,
        },
      }
    )
    const updatedDisposable = await repository.updateLetterTypeWithClient(
      sekre.client,
      {
        tenantId: fx.t1,
        roles: ["sekretaris"],
        input: {
          letterTypeId: disposableType.id,
          code: "HAPUS_TMP",
          name: "Sementara Direvisi",
          description: "Diubah sekretaris",
          requiredDocuments: ["KTP"],
          isActive: false,
        },
      }
    )
    assert.equal(updatedDisposable.name, "Sementara Direvisi")

    const delUnused = await repository.deleteLetterTypeWithClient(ketua.client, {
      tenantId: fx.t1,
      roles: ["ketua_rt"],
      input: { letterTypeId: disposableType.id },
    })
    assert.equal(delUnused.deleted, true)

    // -------------------------------------------------------------------------
    // 2. Resident creates letter requests, uploads/removes docs, cancels #2
    // -------------------------------------------------------------------------
    // Inactive letter type rejected for resident
    await assert.rejects(
      () =>
        repository.createLetterRequestWithClient(wargaA.client, {
          tenantId: fx.t1,
          memberId: fx.wargaAMemberId,
          residentId: fx.wargaAResidentId,
          input: {
            letterTypeId: inactiveType.id,
            purpose: "Coba pakai tipe nonaktif",
          },
        }),
      (err) => err.status === 400 && err.code === "INELIGIBLE_RESIDENT"
    )

    const req1 = await repository.createLetterRequestWithClient(wargaA.client, {
      tenantId: fx.t1,
      memberId: fx.wargaAMemberId,
      residentId: fx.wargaAResidentId,
      input: {
        letterTypeId: activeType.id,
        purpose: "Pengurusan rekening bank karyawan",
      },
    })
    assert.equal(req1.status, "submitted")
    assert.equal(req1.attachmentCount, 0)

    // In-use letter type deletion rejected safely (409 CONFLICT)
    await assert.rejects(
      () =>
        repository.deleteLetterTypeWithClient(ketua.client, {
          tenantId: fx.t1,
          roles: ["ketua_rt"],
          input: { letterTypeId: activeType.id },
        }),
      (err) => err.status === 409 && err.code === "CONFLICT"
    )

    const req2 = await repository.createLetterRequestWithClient(wargaA.client, {
      tenantId: fx.t1,
      memberId: fx.wargaAMemberId,
      residentId: fx.wargaAResidentId,
      input: {
        letterTypeId: activeType.id,
        purpose: "Pengajuan kedua untuk dibatalkan warga",
      },
    })

    // Upload 1 PNG + 1 PDF attachment to req1
    const attPng = await repository.uploadLetterSupportingDocWithClient(
      wargaA.client,
      {
        tenantId: fx.t1,
        memberId: fx.wargaAMemberId,
        requestId: req1.id,
        validatedFile: await makeValidatedPng(),
      }
    )
    assert.equal(attPng.attachmentCount, 1)

    const attPdfToRemove = await repository.uploadLetterSupportingDocWithClient(
      wargaA.client,
      {
        tenantId: fx.t1,
        memberId: fx.wargaAMemberId,
        requestId: req1.id,
        validatedFile: await makeValidatedPdfAttachment(),
      }
    )
    assert.equal(attPdfToRemove.attachmentCount, 2)

    // Non-requester wargaB cannot upload or remove docs or cancel req1
    await assert.rejects(
      () =>
        repository.uploadLetterSupportingDocWithClient(wargaB.client, {
          tenantId: fx.t1,
          memberId: fx.wargaBMemberId,
          requestId: req1.id,
          validatedFile: makeSamplePngBytes(),
        }),
      (err) => err.status === 404 || err.status === 403
    )

    // Queue removal of 2nd attachment; must immediately disappear from active attachments
    const rmRes = await repository.requestRemoveLetterSupportingDocWithClient(
      wargaA.client,
      {
        tenantId: fx.t1,
        memberId: fx.wargaAMemberId,
        roles: ["warga"],
        scope: "resident",
        input: {
          requestId: req1.id,
          fileId: attPdfToRemove.attachment.fileId,
          reason: "Salah unggah file",
        },
      }
    )
    assert.ok(rmRes.jobId)

    const detailAfterRm = await repository.getResidentLetterRequestDetailWithClient(
      wargaA.client,
      {
        tenantId: fx.t1,
        memberId: fx.wargaAMemberId,
        residentId: fx.wargaAResidentId,
        requestId: req1.id,
      }
    )
    assert.equal(detailAfterRm.request.attachmentCount, 1)
    assert.equal(detailAfterRm.request.attachments[0].fileId, attPng.attachment.fileId)

    // Cancel req2 while submitted; second cancel rejected as INVALID_STATE
    const cancelled = await repository.cancelLetterRequestWithClient(
      wargaA.client,
      {
        tenantId: fx.t1,
        memberId: fx.wargaAMemberId,
        input: { requestId: req2.id, reason: "Tidak jadi digunakan" },
      }
    )
    assert.equal(cancelled.status, "cancelled")

    await assert.rejects(
      () =>
        repository.cancelLetterRequestWithClient(wargaA.client, {
          tenantId: fx.t1,
          memberId: fx.wargaAMemberId,
          input: { requestId: req2.id },
        }),
      (err) => err.status === 400 && err.code === "INVALID_STATE"
    )

    // -------------------------------------------------------------------------
    // 3. Review -> Approve -> Issue Letter PDF + terminal transition protection
    // -------------------------------------------------------------------------
    // Pengurus, Bendahara, Warga cannot review or issue
    await assert.rejects(
      () =>
        repository.reviewLetterRequestWithClient(pengurus.client, {
          tenantId: fx.t1,
          roles: ["pengurus"],
          input: { requestId: req1.id, decision: "reviewing" },
        }),
      (err) => err.status === 403 && err.code === "FORBIDDEN"
    )

    // Cannot issue before approved
    await assert.rejects(
      async () =>
        repository.issueLetterWithClient(ketua.client, {
          tenantId: fx.t1,
          roles: ["ketua_rt"],
          requestId: req1.id,
          validatedFile: await makeValidatedIssuedPdf(),
        }),
      (err) => err.status === 400 && err.code === "INVALID_STATE"
    )

    const rev1 = await repository.reviewLetterRequestWithClient(sekre.client, {
      tenantId: fx.t1,
      roles: ["sekretaris"],
      input: {
        requestId: req1.id,
        decision: "reviewing",
        adminNotes: "Dokumen lengkap sedang diverifikasi.",
      },
    })
    assert.equal(rev1.status, "reviewing")

    // Cannot cancel once reviewing
    await assert.rejects(
      () =>
        repository.cancelLetterRequestWithClient(wargaA.client, {
          tenantId: fx.t1,
          memberId: fx.wargaAMemberId,
          input: { requestId: req1.id },
        }),
      (err) => err.status === 400 && err.code === "INVALID_STATE"
    )

    const app1 = await repository.reviewLetterRequestWithClient(ketua.client, {
      tenantId: fx.t1,
      roles: ["ketua_rt"],
      input: {
        requestId: req1.id,
        decision: "approved",
        adminNotes: "Disetujui Ketua RT",
      },
    })
    assert.equal(app1.status, "approved")

    const issued = await repository.issueLetterWithClient(ketua.client, {
      tenantId: fx.t1,
      roles: ["ketua_rt"],
      requestId: req1.id,
      validatedFile: await makeValidatedIssuedPdf(),
    })
    assert.match(issued.letterNumber, /^001\/SKDOM\/\d{4}$/)
    assert.equal(issued.issuedPdfUrl, `/api/letters/${req1.id}/issued`)

    // Terminal state protection: cannot re-review or re-issue completed request
    await assert.rejects(
      () =>
        repository.reviewLetterRequestWithClient(sekre.client, {
          tenantId: fx.t1,
          roles: ["sekretaris"],
          input: {
            requestId: req1.id,
            decision: "rejected",
            adminNotes: "Ditolak belakangan",
          },
        }),
      (err) => err.status === 400 && err.code === "INVALID_STATE"
    )
    await assert.rejects(
      async () =>
        repository.issueLetterWithClient(ketua.client, {
          tenantId: fx.t1,
          roles: ["ketua_rt"],
          requestId: req1.id,
          validatedFile: await makeValidatedIssuedPdf(),
        }),
      (err) => err.status === 400 && err.code === "INVALID_STATE"
    )

    // Check pengurus metadata-only repository output omits documents cleanly
    const pengurusList = await repository.listAdminLetterRequestsWithClient(
      pengurus.client,
      { tenantId: fx.t1, roles: ["pengurus"] }
    )
    assert.equal(pengurusList.isMetadataOnly, true)
    assert.equal(pengurusList.totalCount, 2)
    assert.equal(pengurusList.summary.completed, 1)
    assert.equal(pengurusList.summary.cancelled, 1)
    const pengurusReq1 = pengurusList.items.find((i) => i.id === req1.id)
    assert.equal(pengurusReq1.attachments.length, 0)
    assert.equal(pengurusReq1.attachmentCount, 0)
    assert.equal(pengurusReq1.hasIssuedPdf, false)
    assert.equal(pengurusReq1.issuedPdfUrl, null)

    // -------------------------------------------------------------------------
    // 4. Live Next.js API Routes & Authenticated Private Document Proxy Tests
    // -------------------------------------------------------------------------
    nextServer = await startNextServer(3142, {
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    })

    // 4a. Unauthenticated requests -> 401 on all 8 endpoints
    for (const ep of [
      "/api/letters",
      `/api/letters/${req1.id}`,
      "/api/letters/types",
      "/api/resident/letters",
      `/api/resident/letters/${req1.id}`,
      "/api/resident/letters/types",
      `/api/letters/${req1.id}/issued`,
      `/api/letters/${req1.id}/attachments/${attPng.attachment.fileId}`,
    ]) {
      const unauth = await apiGetJson(nextServer.baseUrl, ep, "")
      assert.equal(unauth.status, 401, `Unauthenticated ${ep} must return 401`)
    }

    // 4b. Bendahara & superAdmin non-member -> 403 across all Letters routes
    for (const [label, cookie] of [
      ["bendahara", bendahara.cookie],
      ["superAdmin", superAdmin.cookie],
    ]) {
      for (const ep of [
        "/api/letters",
        `/api/letters/${req1.id}`,
        "/api/letters/types",
        `/api/letters/${req1.id}/issued`,
        `/api/letters/${req1.id}/attachments/${attPng.attachment.fileId}`,
      ]) {
        const res = await apiGetJson(nextServer.baseUrl, ep, cookie)
        assert.equal(res.status, 403, `${label} on ${ep} must return 403`)
      }
    }

    // 4c. Pengurus -> metadata-only on /api/letters* and 403 on proxy document endpoints
    const pengurusApiList = await apiGetJson(
      nextServer.baseUrl,
      "/api/letters",
      pengurus.cookie
    )
    assert.equal(pengurusApiList.status, 200)
    assert.equal(pengurusApiList.body.isMetadataOnly, true)
    assert.equal(JSON.stringify(pengurusApiList.body).includes(fx.t1 + "/"), false)

    const pengurusApiTypes = await apiGetJson(
      nextServer.baseUrl,
      "/api/letters/types",
      pengurus.cookie
    )
    assert.equal(pengurusApiTypes.status, 200)
    assert.equal(pengurusApiTypes.body.canManage, false)
    assert.equal(pengurusApiTypes.body.items.length, 2)

    assert.equal(
      (
        await apiGetJson(
          nextServer.baseUrl,
          `/api/letters/${req1.id}/issued`,
          pengurus.cookie
        )
      ).status,
      403
    )
    assert.equal(
      (
        await apiGetJson(
          nextServer.baseUrl,
          `/api/letters/${req1.id}/attachments/${attPng.attachment.fileId}`,
          pengurus.cookie
        )
      ).status,
      403
    )

    // 4d. Ketua & Sekretaris access + zero raw storage paths / signed URLs in JSON
    for (const [label, cookie] of [
      ["ketua", ketua.cookie],
      ["sekre", sekre.cookie],
    ]) {
      const detailRes = await apiGetJson(
        nextServer.baseUrl,
        `/api/letters/${req1.id}`,
        cookie
      )
      assert.equal(detailRes.status, 200, `${label} detail should succeed`)
      const rawJson = JSON.stringify(detailRes.body)
      assert.equal(rawJson.includes(`${fx.t1}/`), false, "Must never expose raw storage path")
      assert.equal(rawJson.includes("token="), false, "Must never expose signed URL token")
      assert.equal(detailRes.body.request.hasIssuedPdf, true)
      assert.equal(detailRes.body.request.attachmentCount, 1)

      const pdfProxy = await apiGetRaw(
        nextServer.baseUrl,
        `/api/letters/${req1.id}/issued`,
        cookie
      )
      assert.equal(pdfProxy.status, 200)
      assert.equal(pdfProxy.contentType, "application/pdf")
      assert.equal(pdfProxy.nosniff, "nosniff")
      assert.match(pdfProxy.cacheControl, /private.*no-store/)
      assert.equal(pdfProxy.bytes.byteLength, makeSamplePdfBytes().byteLength)
      assert.deepEqual(pdfProxy.bytes, makeSamplePdfBytes())

      const attProxy = await apiGetRaw(
        nextServer.baseUrl,
        `/api/letters/${req1.id}/attachments/${attPng.attachment.fileId}`,
        cookie
      )
      assert.equal(attProxy.status, 200)
      assert.equal(attProxy.contentType, "image/png")
      assert.equal(attProxy.nosniff, "nosniff")
      assert.match(attProxy.cacheControl, /private.*no-store/)
      assert.match(attProxy.disposition, /^attachment;/)
      assert.deepEqual(attProxy.bytes, makeSamplePngBytes())
    }

    // 4e. Resident ownership, active letter types only, and pending-deletion denial
    const resTypes = await apiGetJson(
      nextServer.baseUrl,
      "/api/resident/letters/types",
      wargaA.cookie
    )
    assert.equal(resTypes.status, 200)
    assert.equal(resTypes.body.items.length, 1)
    assert.equal(resTypes.body.items[0].id, activeType.id)

    const wargaAAdminBlocked = await apiGetJson(
      nextServer.baseUrl,
      "/api/letters",
      wargaA.cookie
    )
    assert.equal(wargaAAdminBlocked.status, 403)

    const wargaADetail = await apiGetJson(
      nextServer.baseUrl,
      `/api/resident/letters/${req1.id}`,
      wargaA.cookie
    )
    assert.equal(wargaADetail.status, 200)
    assert.equal(wargaADetail.body.request.attachmentCount, 1)
    assert.equal(JSON.stringify(wargaADetail.body).includes(`${fx.t1}/`), false)

    // Pending-deletion attachment returns 404 via proxy even before async worker deletes storage row
    const pendingAttProxy = await apiGetJson(
      nextServer.baseUrl,
      `/api/letters/${req1.id}/attachments/${attPdfToRemove.attachment.fileId}`,
      wargaA.cookie
    )
    assert.equal(pendingAttProxy.status, 404)

    // Resident can download own issued PDF with ?download=1 -> attachment
    const wargaAPdf = await apiGetRaw(
      nextServer.baseUrl,
      `/api/letters/${req1.id}/issued?download=1`,
      wargaA.cookie
    )
    assert.equal(wargaAPdf.status, 200)
    assert.match(wargaAPdf.disposition, /^attachment;/)
    assert.deepEqual(wargaAPdf.bytes, makeSamplePdfBytes())

    // 4f. Cross-resident & Cross-tenant IDOR blocked cleanly (404 / empty list)
    const wargaBList = await apiGetJson(
      nextServer.baseUrl,
      "/api/resident/letters",
      wargaB.cookie
    )
    assert.equal(wargaBList.status, 200)
    assert.equal(wargaBList.body.items.length, 0)

    for (const [label, cookie] of [
      ["wargaB", wargaB.cookie],
      ["tenant2Ketua", tenant2Ketua.cookie],
    ]) {
      for (const ep of [
        `/api/resident/letters/${req1.id}`,
        `/api/letters/${req1.id}`,
        `/api/letters/${req1.id}/issued`,
        `/api/letters/${req1.id}/attachments/${attPng.attachment.fileId}`,
      ]) {
        const res = await apiGetJson(nextServer.baseUrl, ep, cookie)
        assert.ok(
          res.status === 403 || res.status === 404,
          `${label} IDOR on ${ep} must return 403/404, got ${res.status}`
        )
      }
    }

    // Invalid UUIDs cleanly return 400
    const badIdRes = await apiGetJson(
      nextServer.baseUrl,
      "/api/letters/not-a-uuid/issued",
      ketua.cookie
    )
    assert.equal(badIdRes.status, 400)
  } finally {
    if (nextServer) {
      await nextServer.stop()
    }
    if (createdTenantIds.length > 0) {
      const tenantList = createdTenantIds.map((id) => `'${id}'`).join(",")
      const objRowsRaw = runSql(`
        SELECT json_build_object(
          'req', COALESCE((SELECT json_agg(name) FROM storage.objects WHERE bucket_id='letter-requests' AND split_part(name, '/', 1) IN (${tenantList})), '[]'::json),
          'iss', COALESCE((SELECT json_agg(name) FROM storage.objects WHERE bucket_id='issued-letters' AND split_part(name, '/', 1) IN (${tenantList})), '[]'::json)
        )::text;
      `)
      const objRows = JSON.parse(objRowsRaw || '{"req":[],"iss":[]}')
      if (objRows.req.length > 0) {
        await adminAuth.storage.from(constants.LETTER_REQUEST_DOCS_BUCKET).remove(objRows.req)
      }
      if (objRows.iss.length > 0) {
        await adminAuth.storage.from(constants.ISSUED_LETTERS_BUCKET).remove(objRows.iss)
      }

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

