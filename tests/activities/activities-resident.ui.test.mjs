import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import {
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import test from "node:test"
import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"

import { runSupabaseCliStatus } from "./helpers/load-activities-modules.mjs"

const require = createRequire(import.meta.url)
const ts = require("typescript")

const ROOT = process.cwd()
const OUT_DIR = `/tmp/smart-rt-activities-res-ui-test-dist-${process.pid}`

function loadResidentUiTestModules() {
  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })
  symlinkSync(
    resolve(ROOT, "node_modules"),
    join(OUT_DIR, "node_modules"),
    "dir"
  )

  const files = [
    "src/lib/auth/types.ts",
    "src/lib/residents/schemas.ts",
    "src/lib/activities/constants.ts",
    "src/lib/activities/types.ts",
    "src/lib/activities/errors.ts",
    "src/lib/activities/schemas.ts",
    "src/lib/activities/storage.ts",
    "src/lib/activities/formatters.ts",
    "src/lib/activities/repository.ts",
    "src/components/resident/resident-nav-config.ts",
  ]

  for (const relPath of files) {
    const absIn = resolve(ROOT, relPath)
    const sourceText = readFileSync(absIn, "utf8")
    const result = ts.transpileModule(sourceText, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
        resolveJsonModule: true,
      },
      fileName: absIn,
    })

    const outPath = join(
      OUT_DIR,
      relPath.replace(/^src\//, "").replace(/\.ts$/, ".js")
    )
    mkdirSync(dirname(outPath), { recursive: true })

    const depth = relPath.replace(/^src\//, "").split("/").length - 1
    const prefix = depth === 0 ? "./" : "../".repeat(depth)
    const rewritten = result.outputText.replace(
      /require\("@\/([^"]+)"\)/g,
      (_match, target) => `require("${prefix}${target}")`
    )
    writeFileSync(outPath, rewritten, "utf8")
  }

  return {
    repository: require(join(OUT_DIR, "lib/activities/repository.js")),
    residentNav: require(
      join(OUT_DIR, "components/resident/resident-nav-config.js")
    ),
  }
}

const { repository, residentNav } = loadResidentUiTestModules()

test.after(() => {
  rmSync(OUT_DIR, { recursive: true, force: true })
})

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
  const proc = spawn("npx", ["next", "start", "-p", String(port)], {
    cwd: ROOT,
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

const TINY_PNG = new Uint8Array(
  Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
    "hex"
  )
)

test("Resident bottom navigation keeps exact 5 slots and highlights Layanan on all /resident/activities routes", () => {
  assert.deepEqual(
    residentNav.RESIDENT_NAV_ITEMS.map((i) => i.label),
    ["Beranda", "Tagihan", "Pengumuman", "Layanan", "Profil"]
  )
  assert.equal(residentNav.RESIDENT_NAV_ITEMS.length, 5)

  for (const path of [
    "/resident/activities",
    "/resident/activities/my",
    "/resident/activities/11111111-1111-4111-8111-111111111101",
  ]) {
    assert.equal(
      residentNav.isResidentRouteActive(path, "/resident/layanan"),
      true,
      `Layanan must stay active on ${path}`
    )
    assert.equal(residentNav.isResidentRouteActive(path, "/resident"), false)
  }
})

test("Resident Activities UI source hygiene enforces privacy, Suspense boundaries, and dashboard/layanan integration", () => {
  const files = [
    "src/app/(resident)/resident/activities/page.tsx",
    "src/app/(resident)/resident/activities/my/page.tsx",
    "src/app/(resident)/resident/activities/[id]/page.tsx",
    "src/components/activities/resident-activities-skeletons.tsx",
    "src/components/activities/resident-activities-list-view.tsx",
    "src/components/activities/resident-activity-detail-view.tsx",
    "src/components/activities/resident-my-activities-view.tsx",
  ]

  for (const relPath of files) {
    const src = readFileSync(resolve(ROOT, relPath), "utf8")
    assert.equal(
      /service_role|supabaseAdmin|createSignedUrl|getPublicUrl|\.select\(\s*["'`]\s*\*/.test(
        src
      ),
      false,
      `Unsafe pattern found in ${relPath}`
    )
    assert.equal(
      /\b(kk_number|birth_date|birth_place)\b/.test(src),
      false,
      `Sensitive PII column found in ${relPath}`
    )
    assert.equal(
      src.includes("documentation_paths"),
      false,
      `Raw storage path field forbidden in ${relPath}`
    )
  }

  for (const page of [
    "src/app/(resident)/resident/activities/page.tsx",
    "src/app/(resident)/resident/activities/my/page.tsx",
    "src/app/(resident)/resident/activities/[id]/page.tsx",
  ]) {
    const src = readFileSync(resolve(ROOT, page), "utf8")
    assert.ok(src.includes("requireResidentContext"), `${page} needs guard`)
    assert.ok(src.includes("<Suspense"), `${page} needs Suspense`)
  }

  const layananSrc = readFileSync(
    resolve(ROOT, "src/app/(resident)/resident/layanan/page.tsx"),
    "utf8"
  )
  assert.ok(layananSrc.includes("/resident/activities"))
  assert.ok(layananSrc.includes("Kegiatan Warga"))

  const dashboardSrc = readFileSync(
    resolve(ROOT, "src/components/resident/resident-dashboard-view.tsx"),
    "utf8"
  )
  assert.ok(dashboardSrc.includes("/resident/activities/${act.id}"))
  assert.ok(dashboardSrc.includes("/resident/activities/my"))
  assert.equal(dashboardSrc.includes("dashboard-fixtures"), false)
})

test("Step 15.4 Resident SSR pages, ownership isolation, cancellation history, proxy, and cross-tenant guards", async () => {
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
  const runTag = Date.now()
  const password = "TestPassword123!"
  let nextServer = null

  async function createActor(label) {
    const email = `activities.15_4.${label}.${runTag}@example.com`
    const { data, error } = await adminAuth.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    assert.ok(!error && data?.user)
    createdUserIds.push(data.user.id)

    const client = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error: signInErr } = await client.auth.signInWithPassword({
      email,
      password,
    })
    assert.ok(!signInErr)

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
    const wargaA = await createActor("wargaa")
    const wargaB = await createActor("wargab")
    const tenant2Warga = await createActor("t2warga")

    const setupRaw = runSql(`
      WITH t AS (
        INSERT INTO public.tenants (code, name, rt_number, rw_number, kelurahan, kecamatan, city, province, status)
        VALUES
          ('rt-154-a-${runTag}', 'RT Warga 15.4 A', '054', '005', 'Dago', 'Coblong', 'Bandung', 'Jawa Barat', 'active'),
          ('rt-154-b-${runTag}', 'RT Warga 15.4 B', '055', '005', 'Dago', 'Coblong', 'Bandung', 'Jawa Barat', 'active')
        RETURNING id, rt_number
      ),
      h_a AS (
        INSERT INTO public.households (tenant_id, kk_number, address, block_unit, status)
        SELECT id, '3273011540000001', 'Jl. Dago No. 1', 'Blok D-01', 'active' FROM t WHERE rt_number='054'
        RETURNING id, tenant_id
      ),
      h_b AS (
        INSERT INTO public.households (tenant_id, kk_number, address, block_unit, status)
        SELECT id, '3273011540000002', 'Jl. Dago No. 2', 'Blok D-02', 'active' FROM t WHERE rt_number='054'
        RETURNING id, tenant_id
      ),
      h_t2 AS (
        INSERT INTO public.households (tenant_id, kk_number, address, block_unit, status)
        SELECT id, '3273011540000099', 'Jl. Tetangga No. 9', 'Blok T-09', 'active' FROM t WHERE rt_number='055'
        RETURNING id, tenant_id
      ),
      r_a AS (
        INSERT INTO public.residents (tenant_id, household_id, full_name, gender, family_role, residency_status)
        SELECT tenant_id, id, 'RAHASIA_RESIDENT_A', 'L', 'kepala_keluarga', 'aktif' FROM h_a
        RETURNING id
      ),
      r_b AS (
        INSERT INTO public.residents (tenant_id, household_id, full_name, gender, family_role, residency_status)
        SELECT tenant_id, id, 'RAHASIA_RESIDENT_B', 'P', 'istri', 'aktif' FROM h_b
        RETURNING id
      ),
      r_t2 AS (
        INSERT INTO public.residents (tenant_id, household_id, full_name, gender, family_role, residency_status)
        SELECT tenant_id, id, 'Warga T2', 'L', 'kepala_keluarga', 'aktif' FROM h_t2
        RETURNING id
      ),
      prof AS (
        INSERT INTO public.profiles (id, full_name, is_super_admin)
        VALUES
          ('${ketua.user.id}', 'Ketua 15.4', false),
          ('${wargaA.user.id}', 'Warga A 15.4', false),
          ('${wargaB.user.id}', 'Warga B 15.4', false),
          ('${tenant2Warga.user.id}', 'Warga T2 15.4', false)
        ON CONFLICT (id) DO NOTHING
      ),
      tm AS (
        INSERT INTO public.tenant_members (tenant_id, user_id, resident_id, status)
        VALUES
          ((SELECT id FROM t WHERE rt_number='054'), '${ketua.user.id}', NULL, 'active'),
          ((SELECT id FROM t WHERE rt_number='054'), '${wargaA.user.id}', (SELECT id FROM r_a), 'active'),
          ((SELECT id FROM t WHERE rt_number='054'), '${wargaB.user.id}', (SELECT id FROM r_b), 'active'),
          ((SELECT id FROM t WHERE rt_number='055'), '${tenant2Warga.user.id}', (SELECT id FROM r_t2), 'active')
        RETURNING id, tenant_id, user_id
      ),
      mr AS (
        INSERT INTO public.member_roles (tenant_id, member_id, role_id)
        SELECT tm.tenant_id, tm.id, rl.id
        FROM tm
        JOIN (VALUES
          ('${ketua.user.id}', 'ketua_rt'),
          ('${wargaA.user.id}', 'warga'),
          ('${wargaB.user.id}', 'warga'),
          ('${tenant2Warga.user.id}', 'warga')
        ) AS m(uid, rname) ON m.uid::uuid = tm.user_id
        JOIN public.roles rl ON rl.code = m.rname
      )
      SELECT json_build_object(
        't1', (SELECT id FROM t WHERE rt_number='054'),
        't2', (SELECT id FROM t WHERE rt_number='055'),
        'wargaAResId', (SELECT id FROM r_a),
        'wargaBResId', (SELECT id FROM r_b)
      )::text;
    `)
    const fx = JSON.parse(setupRaw)
    createdTenantIds.push(fx.t1, fx.t2)

    const futureStart = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString()
    const act1 = await repository.createActivityWithClient(ketua.client, {
      tenantId: fx.t1,
      roles: ["ketua_rt"],
      input: {
        title: "Kerja Bakti Taman RT 54",
        category: "kerja_bakti",
        location: "Taman Utama Blok D",
        startAt: futureStart,
        maxParticipants: 1,
      },
    })
    const actDeleted = await repository.createActivityWithClient(ketua.client, {
      tenantId: fx.t1,
      roles: ["ketua_rt"],
      input: {
        title: "Kegiatan Diarsipkan Rahasia",
        category: "lainnya",
        location: "Gudang",
        startAt: futureStart,
      },
    })
    await repository.softDeleteActivityWithClient(ketua.client, {
      tenantId: fx.t1,
      roles: ["ketua_rt"],
      input: { activityId: actDeleted.activity.id },
    })

    // Upload a doc to act1 and register wargaA (filling capacity 1/1)
    const doc = await repository.uploadActivityDocWithClient(ketua.client, {
      tenantId: fx.t1,
      roles: ["ketua_rt"],
      activityId: act1.activity.id,
      validatedFile: {
        buffer: TINY_PNG,
        mimeType: "image/png",
        extension: "png",
        size: TINY_PNG.byteLength,
      },
    })
    await repository.registerForActivityWithClient(wargaA.client, {
      tenantId: fx.t1,
      residentId: fx.wargaAResId,
      input: { activityId: act1.activity.id, notes: "Membawa sapu" },
    })

    // Second activity where wargaA cancelled cleanly
    const act2 = await repository.createActivityWithClient(ketua.client, {
      tenantId: fx.t1,
      roles: ["ketua_rt"],
      input: {
        title: "Rapat Warga Bulanan",
        category: "rapat",
        location: "Balai RT 54",
        startAt: futureStart,
      },
    })
    await repository.registerForActivityWithClient(wargaA.client, {
      tenantId: fx.t1,
      residentId: fx.wargaAResId,
      input: { activityId: act2.activity.id },
    })
    await repository.cancelActivityRegistrationWithClient(wargaA.client, {
      tenantId: fx.t1,
      residentId: fx.wargaAResId,
      input: { activityId: act2.activity.id, reason: "Sedang ke luar kota" },
    })

    nextServer = await startNextServer(3464, {
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    })

    async function getPage(path, cookie) {
      const res = await fetch(`${nextServer.baseUrl}${path}`, {
        method: "GET",
        headers: cookie ? { Cookie: cookie } : {},
        redirect: "manual",
      })
      return {
        status: res.status,
        location: res.headers.get("location") ?? "",
        html: await res.text(),
      }
    }

    // Dashboard upcoming card & Layanan hub
    const dashRes = await getPage("/resident", wargaA.cookie)
    assert.equal(dashRes.status, 200)
    assert.ok(dashRes.html.includes("Kerja Bakti Taman RT 54"))
    assert.ok(dashRes.html.includes(`/resident/activities/${act1.activity.id}`))

    const layananRes = await getPage("/resident/layanan", wargaA.cookie)
    assert.equal(layananRes.status, 200)
    assert.ok(layananRes.html.includes("Kegiatan Warga"))
    assert.ok(layananRes.html.includes("/resident/activities"))

    // Resident activities list: sees active activities, soft-deleted hidden, no other resident PII
    const listB = await getPage("/resident/activities", wargaB.cookie)
    assert.equal(listB.status, 200)
    assert.ok(listB.html.includes("Kerja Bakti Taman RT 54"))
    assert.ok(listB.html.includes("Kuota Penuh"))
    assert.equal(listB.html.includes("Kegiatan Diarsipkan Rahasia"), false)
    assert.equal(listB.html.includes("RAHASIA_RESIDENT_A"), false)
    assert.equal(listB.html.includes("Blok D-01"), false)

    // Detail for wargaA shows own registration & cancel option, detail for wargaB shows full without wargaA PII
    const detailA = await getPage(
      `/resident/activities/${act1.activity.id}`,
      wargaA.cookie
    )
    assert.equal(detailA.status, 200)
    assert.ok(detailA.html.includes("Batalkan Pendaftaran Saya"))
    assert.ok(detailA.html.includes(doc.document.viewUrl))
    assert.equal(detailA.html.includes(fx.t1 + "/"), false)

    const detailB = await getPage(
      `/resident/activities/${act1.activity.id}`,
      wargaB.cookie
    )
    assert.equal(detailB.status, 200)
    assert.ok(detailB.html.includes("Kuota peserta kegiatan sudah penuh"))
    assert.equal(detailB.html.includes("RAHASIA_RESIDENT_A"), false)
    assert.equal(detailB.html.includes("Membawa sapu"), false)

    // My Activities: wargaA sees both active & cancelled; wargaB sees empty history
    const myA = await getPage("/resident/activities/my", wargaA.cookie)
    assert.equal(myA.status, 200)
    assert.ok(myA.html.includes("Kerja Bakti Taman RT 54"))
    assert.ok(myA.html.includes("Rapat Warga Bulanan"))
    assert.ok(myA.html.includes("Dibatalkan Mandiri"))

    const myB = await getPage("/resident/activities/my", wargaB.cookie)
    assert.equal(myB.status, 200)
    assert.equal(myB.html.includes("Kerja Bakti Taman RT 54"), false)
    assert.ok(myB.html.includes("Belum ada riwayat pada kategori ini"))

    // Soft-deleted, invalid UUID, and cross-tenant detail -> Next.js notFound()
    for (const [label, path, cookie] of [
      ["invalid UUID", "/resident/activities/not-a-uuid", wargaA.cookie],
      ["soft deleted", `/resident/activities/${actDeleted.activity.id}`, wargaA.cookie],
      ["cross tenant", `/resident/activities/${act1.activity.id}`, tenant2Warga.cookie],
    ]) {
      const nf = await getPage(path, cookie)
      assert.ok(
        nf.status === 404 ||
          nf.html.includes("NEXT_HTTP_ERROR_FALLBACK;404") ||
          nf.html.includes('name="robots" content="noindex"'),
        `${label} must trigger notFound()`
      )
      assert.equal(nf.html.includes("Kerja Bakti Taman RT 54"), false)
      assert.equal(nf.html.includes("Kegiatan Diarsipkan Rahasia"), false)
    }

    // Proxy document check: wargaA gets 200 PNG; cross-tenant resident gets 404
    const proxyOk = await fetch(`${nextServer.baseUrl}${doc.document.viewUrl}`, {
      headers: { Cookie: wargaA.cookie },
      redirect: "manual",
    })
    assert.equal(proxyOk.status, 200)
    assert.equal(proxyOk.headers.get("cache-control"), "private, no-store")

    const proxyCross = await fetch(`${nextServer.baseUrl}${doc.document.viewUrl}`, {
      headers: { Cookie: tenant2Warga.cookie },
      redirect: "manual",
    })
    assert.equal(proxyCross.status, 404)

    // Admin role visiting /resident/activities redirects to admin workspace
    const ketuaOnResident = await getPage("/resident/activities", ketua.cookie)
    assert.ok(
      (ketuaOnResident.status >= 300 && ketuaOnResident.status < 400) ||
        ketuaOnResident.html.includes("NEXT_REDIRECT")
    )
    assert.equal(ketuaOnResident.html.includes("Kerja Bakti Taman RT 54"), false)
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

