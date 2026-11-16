import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
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
const OUT_DIR = `/tmp/smart-rt-activities-ui-test-dist-${process.pid}`

function loadActivitiesUiTestModules() {
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
    "src/lib/activities/ui-helpers.ts",
    "src/components/layout/nav-config.ts",
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
    types: require(join(OUT_DIR, "lib/activities/types.js")),
    schemas: require(join(OUT_DIR, "lib/activities/schemas.js")),
    repository: require(join(OUT_DIR, "lib/activities/repository.js")),
    uiHelpers: require(join(OUT_DIR, "lib/activities/ui-helpers.js")),
    navConfig: require(join(OUT_DIR, "components/layout/nav-config.js")),
  }
}

const { schemas, repository, uiHelpers, navConfig } =
  loadActivitiesUiTestModules()

test.after(() => {
  rmSync(OUT_DIR, { recursive: true, force: true })
})

function collectFiles(dir) {
  const results = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      results.push(...collectFiles(full))
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      results.push(full)
    }
  }
  return results
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
    cwd: ROOT,
    env: { ...process.env, ...envOverrides },
    stdio: ["ignore", "pipe", "pipe"],
  })

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
      // retry until listening
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

test("Activities Admin navigation, breadcrumbs, page titles & role badges match Step 15.3 specification", () => {
  const kegiatanNav = navConfig.NAV_ITEMS.find((i) => i.href === "/kegiatan")
  assert.ok(kegiatanNav, "/kegiatan must exist in NAV_ITEMS")
  assert.deepEqual(kegiatanNav.requiredRoles, [
    "ketua_rt",
    "sekretaris",
    "pengurus",
  ])

  assert.equal(navConfig.getRouteTitle("/kegiatan"), "Kegiatan Warga")
  assert.equal(navConfig.getRouteTitle("/kegiatan/new"), "Buat Kegiatan")
  assert.equal(
    navConfig.getRouteTitle("/kegiatan/11111111-1111-4111-8111-111111111101"),
    "Detail Kegiatan"
  )
  assert.equal(
    navConfig.getRouteTitle(
      "/kegiatan/11111111-1111-4111-8111-111111111101/edit"
    ),
    "Ubah Kegiatan"
  )
  assert.equal(
    navConfig.getRouteTitle(
      "/kegiatan/11111111-1111-4111-8111-111111111101/participants"
    ),
    "Peserta & Presensi"
  )

  const editBc = navConfig.getAdminBreadcrumbs(
    "/kegiatan/11111111-1111-4111-8111-111111111101/edit"
  )
  assert.deepEqual(editBc, [
    { label: "Kegiatan Warga", href: "/kegiatan" },
    {
      label: "Detail Kegiatan",
      href: "/kegiatan/11111111-1111-4111-8111-111111111101",
    },
    { label: "Ubah Kegiatan" },
  ])

  const partBc = navConfig.getAdminBreadcrumbs(
    "/kegiatan/11111111-1111-4111-8111-111111111101/participants"
  )
  assert.deepEqual(partBc, [
    { label: "Kegiatan Warga", href: "/kegiatan" },
    {
      label: "Detail Kegiatan",
      href: "/kegiatan/11111111-1111-4111-8111-111111111101",
    },
    { label: "Peserta & Presensi" },
  ])

  assert.equal(uiHelpers.getAdminActivitiesRoleBanner(["ketua_rt"]), null)
  assert.equal(uiHelpers.getAdminActivitiesRoleBanner(["sekretaris"]), null)
  const pengurusBanner = uiHelpers.getAdminActivitiesRoleBanner(["pengurus"])
  assert.ok(pengurusBanner)
  assert.match(pengurusBanner.title, /Operasional Pengurus/)
})

test("Jakarta WIB datetime conversion helpers preserve +07:00 offset cleanly across form roundtrips", () => {
  const iso = "2026-12-10T01:30:00.000Z" // 08:30 WIB
  const local = uiHelpers.isoToJakartaDatetimeLocal(iso)
  assert.equal(local, "2026-12-10T08:30")

  const roundtrip = uiHelpers.jakartaDatetimeLocalToIso(local)
  assert.equal(roundtrip, iso)
  assert.equal(uiHelpers.jakartaDatetimeLocalToIso(""), null)
  assert.equal(uiHelpers.jakartaDatetimeLocalToIso("not-a-date"), null)

  // Validation via createActivitySchema using converted WIB values
  const endIso = uiHelpers.jakartaDatetimeLocalToIso("2026-12-10T11:00")
  const deadlineIso = uiHelpers.jakartaDatetimeLocalToIso("2026-12-10T09:00")
  const parsed = schemas.createActivitySchema.safeParse({
    title: "Kerja Bakti Pagi",
    location: "Balai RT",
    startAt: roundtrip,
    endAt: endIso,
    registrationDeadline: deadlineIso,
    category: "kerja_bakti",
    allowSelfRegistration: true,
    maxParticipants: 30,
  })
  assert.equal(parsed.success, true)
})

test("Admin Activities UI components & pages enforce security, zero PII, Suspense boundaries, and no resident UI", () => {
  const adminPageFiles = [
    "src/app/(admin)/kegiatan/page.tsx",
    "src/app/(admin)/kegiatan/new/page.tsx",
    "src/app/(admin)/kegiatan/[id]/page.tsx",
    "src/app/(admin)/kegiatan/[id]/edit/page.tsx",
    "src/app/(admin)/kegiatan/[id]/participants/page.tsx",
  ]
  const componentFiles = collectFiles(
    resolve(ROOT, "src/components/activities")
  ).map((p) => p.replace(`${ROOT}/`, ""))
  const helperFiles = [
    "src/lib/activities/admin-candidates.ts",
    "src/lib/activities/ui-helpers.ts",
  ]

  for (const relPath of [...adminPageFiles, ...componentFiles, ...helperFiles]) {
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
      `Raw documentation_paths reference must not appear in UI file ${relPath}`
    )
  }

  for (const page of adminPageFiles) {
    const src = readFileSync(resolve(ROOT, page), "utf8")
    assert.ok(src.includes("requireAdminContext"), `${page} needs admin context guard`)
    assert.ok(src.includes('redirect("/no-access")'), `${page} needs /no-access redirect`)
    assert.ok(src.includes("<Suspense"), `${page} needs Suspense boundary`)
  }

  for (const managePage of [
    "src/app/(admin)/kegiatan/new/page.tsx",
    "src/app/(admin)/kegiatan/[id]/edit/page.tsx",
  ]) {
    const src = readFileSync(resolve(ROOT, managePage), "utf8")
    assert.ok(
      src.includes("canManageActivities"),
      `${managePage} must restrict pengurus via canManageActivities`
    )
  }

  for (const paramPage of [
    "src/app/(admin)/kegiatan/[id]/page.tsx",
    "src/app/(admin)/kegiatan/[id]/edit/page.tsx",
    "src/app/(admin)/kegiatan/[id]/participants/page.tsx",
  ]) {
    const src = readFileSync(resolve(ROOT, paramPage), "utf8")
    assert.ok(src.includes("isValidUuid"), `${paramPage} must validate UUID`)
    assert.ok(src.includes("notFound()"), `${paramPage} must call notFound()`)
  }

  const formSrc = readFileSync(
    resolve(ROOT, "src/components/activities/activity-form.tsx"),
    "utf8"
  )
  assert.ok(formSrc.includes("beforeunload"), "ActivityForm must warn on unsaved changes")
  assert.ok(formSrc.includes("isSubmitting"), "ActivityForm must prevent double submit")

  const detailSrc = readFileSync(
    resolve(ROOT, "src/components/activities/activity-admin-detail-view.tsx"),
    "utf8"
  )
  assert.ok(detailSrc.includes("permissions.canUpdateInfo"))
  assert.ok(detailSrc.includes("permissions.canStartActivity"))
  assert.ok(detailSrc.includes("permissions.canCompleteActivity"))
  assert.ok(detailSrc.includes("permissions.canCancelActivity"))
  assert.ok(detailSrc.includes("permissions.canSoftDelete"))

  const docPanelSrc = readFileSync(
    resolve(ROOT, "src/components/activities/activity-document-panel.tsx"),
    "utf8"
  )
  assert.ok(docPanelSrc.includes("URL.revokeObjectURL"))
  assert.ok(docPanelSrc.includes("permissions.canUploadDocuments"))
  assert.ok(docPanelSrc.includes("permissions.canRemoveDocuments"))

  // Verify Resident navigation config preserves 5 slots without leaking admin routes
  const residentNavSrc = readFileSync(
    resolve(ROOT, "src/components/resident/resident-nav-config.ts"),
    "utf8"
  )
  assert.equal(residentNavSrc.includes('"/kegiatan"'), false)
  assert.equal(residentNavSrc.includes('"/resident/layanan"'), true)
})

test("Step 15.3 Admin SSR pages enforce role-specific routing, notFound(), and render real data", async () => {
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
    const email = `activities.15_3.${label}.${runTag}@example.com`
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
    const pengurus = await createActor("pengurus")
    const bendahara = await createActor("bendahara")
    const warga = await createActor("warga")
    const superAdmin = await createActor("super")

    const setupRaw = runSql(`
      WITH t AS (
        INSERT INTO public.tenants (code, name, rt_number, rw_number, kelurahan, kecamatan, city, province, status)
        VALUES ('rt-153-${runTag}', 'RT Kegiatan 15.3', '053', '005', 'Lebak Siliwangi', 'Coblong', 'Bandung', 'Jawa Barat', 'active')
        RETURNING id
      ),
      h AS (
        INSERT INTO public.households (tenant_id, kk_number, address, block_unit, status)
        SELECT id, '3273011530000001', 'Jl. Tamansari No. 10', 'Blok S-10', 'active' FROM t
        RETURNING id, tenant_id
      ),
      r AS (
        INSERT INTO public.residents (tenant_id, household_id, full_name, gender, family_role, residency_status)
        SELECT tenant_id, id, 'Warga Uji 15.3', 'L', 'kepala_keluarga', 'aktif' FROM h
        RETURNING id
      ),
      prof AS (
        INSERT INTO public.profiles (id, full_name, is_super_admin)
        VALUES
          ('${ketua.user.id}', 'Ketua 15.3', false),
          ('${pengurus.user.id}', 'Pengurus 15.3', false),
          ('${bendahara.user.id}', 'Bendahara 15.3', false),
          ('${warga.user.id}', 'Warga Uji 15.3', false),
          ('${superAdmin.user.id}', 'Super Admin 15.3', true)
        ON CONFLICT (id) DO UPDATE SET is_super_admin = EXCLUDED.is_super_admin
      ),
      tm AS (
        INSERT INTO public.tenant_members (tenant_id, user_id, resident_id, status)
        VALUES
          ((SELECT id FROM t), '${ketua.user.id}', NULL, 'active'),
          ((SELECT id FROM t), '${pengurus.user.id}', NULL, 'active'),
          ((SELECT id FROM t), '${bendahara.user.id}', NULL, 'active'),
          ((SELECT id FROM t), '${warga.user.id}', (SELECT id FROM r), 'active')
        RETURNING id, tenant_id, user_id
      ),
      mr AS (
        INSERT INTO public.member_roles (tenant_id, member_id, role_id)
        SELECT tm.tenant_id, tm.id, rl.id
        FROM tm
        JOIN (VALUES
          ('${ketua.user.id}', 'ketua_rt'),
          ('${pengurus.user.id}', 'pengurus'),
          ('${bendahara.user.id}', 'bendahara'),
          ('${warga.user.id}', 'warga')
        ) AS m(uid, rname) ON m.uid::uuid = tm.user_id
        JOIN public.roles rl ON rl.code = m.rname
      )
      SELECT (SELECT id FROM t)::text;
    `)
    const tenantId = setupRaw
    createdTenantIds.push(tenantId)

    const futureStart = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString()
    const created = await repository.createActivityWithClient(ketua.client, {
      tenantId,
      roles: ["ketua_rt"],
      input: {
        title: "Posyandu Balita Terpadu",
        category: "kesehatan",
        location: "Balai RW 05",
        startAt: futureStart,
        maxParticipants: 20,
      },
    })

    nextServer = await startNextServer(3463, {
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

    // Ketua RT sees all 5 pages + real activity title + management buttons
    const ketuaList = await getPage("/kegiatan", ketua.cookie)
    assert.equal(ketuaList.status, 200)
    assert.ok(ketuaList.html.includes("Posyandu Balita Terpadu"))
    assert.ok(ketuaList.html.includes("Buat Kegiatan"))

    const ketuaNew = await getPage("/kegiatan/new", ketua.cookie)
    assert.equal(ketuaNew.status, 200)
    assert.ok(ketuaNew.html.includes("Buat Kegiatan Warga"))

    const ketuaDetail = await getPage(
      `/kegiatan/${created.activity.id}`,
      ketua.cookie
    )
    assert.equal(ketuaDetail.status, 200)
    assert.ok(ketuaDetail.html.includes("Posyandu Balita Terpadu"))
    assert.ok(ketuaDetail.html.includes("Ubah Informasi"))
    assert.ok(ketuaDetail.html.includes("Arsipkan"))

    const ketuaEdit = await getPage(
      `/kegiatan/${created.activity.id}/edit`,
      ketua.cookie
    )
    assert.equal(ketuaEdit.status, 200)
    assert.ok(ketuaEdit.html.includes("Ubah Kegiatan Warga"))

    const ketuaPart = await getPage(
      `/kegiatan/${created.activity.id}/participants`,
      ketua.cookie
    )
    assert.equal(ketuaPart.status, 200)
    assert.ok(ketuaPart.html.includes("Daftar Peserta"))

    function assertNotFoundResult(res, label) {
      const isHttp404 = res.status === 404
      const isStreamedNotFound =
        res.html.includes("NEXT_HTTP_ERROR_FALLBACK;404") ||
        res.html.includes('name="robots" content="noindex"')
      assert.ok(
        isHttp404 || isStreamedNotFound,
        `${label} must trigger Next.js notFound() (got HTTP ${res.status})`
      )
      assert.equal(res.html.includes("Posyandu Balita Terpadu"), false)
    }

    function assertRedirectResult(res, expectedPathSubstring, label) {
      const isHttpRedirect =
        res.status >= 300 &&
        res.status < 400 &&
        res.location.includes(expectedPathSubstring)
      const isStreamedRedirect =
        res.html.includes("NEXT_REDIRECT") &&
        res.html.includes(expectedPathSubstring)
      assert.ok(
        isHttpRedirect || isStreamedRedirect,
        `${label} must redirect to ${expectedPathSubstring} (got HTTP ${res.status})`
      )
      assert.equal(
        res.html.includes("Posyandu Balita Terpadu"),
        false,
        `${label} must never leak activity HTML`
      )
    }

    // Invalid UUID & nonexistent UUID -> Next.js notFound()
    const badUuidRes = await getPage("/kegiatan/invalid-id", ketua.cookie)
    assertNotFoundResult(badUuidRes, "ketua invalid-id")

    const missingUuidRes = await getPage(
      "/kegiatan/00000000-0000-4000-8000-000000000999",
      ketua.cookie
    )
    assertNotFoundResult(missingUuidRes, "ketua missing UUID")

    // Pengurus: list/detail/participants succeed (200) with operational banner & no create/edit/delete; /new and /edit redirect to /no-access
    const pengList = await getPage("/kegiatan", pengurus.cookie)
    assert.equal(pengList.status, 200)
    assert.ok(pengList.html.includes("Posyandu Balita Terpadu"))
    assert.ok(pengList.html.includes("Akses Operasional Pengurus"))
    assert.equal(pengList.html.includes("/kegiatan/new"), false)

    const pengNew = await getPage("/kegiatan/new", pengurus.cookie)
    assertRedirectResult(pengNew, "/no-access", "pengurus /kegiatan/new")

    const pengEdit = await getPage(
      `/kegiatan/${created.activity.id}/edit`,
      pengurus.cookie
    )
    assertRedirectResult(pengEdit, "/no-access", "pengurus /kegiatan/[id]/edit")

    const pengDetail = await getPage(
      `/kegiatan/${created.activity.id}`,
      pengurus.cookie
    )
    assert.equal(pengDetail.status, 200)
    assert.ok(pengDetail.html.includes("Mulai Kegiatan"))
    assert.equal(pengDetail.html.includes("Ubah Informasi"), false)
    assert.equal(pengDetail.html.includes("Arsipkan"), false)

    // Bendahara, Warga & SuperAdmin non-member cannot access Admin Activities routes
    for (const [label, cookie, expectedDest] of [
      ["bendahara", bendahara.cookie, "/no-access"],
      ["warga", warga.cookie, "/resident"],
      ["superAdmin", superAdmin.cookie, "/super-admin"],
    ]) {
      for (const route of [
        "/kegiatan",
        "/kegiatan/new",
        `/kegiatan/${created.activity.id}`,
        `/kegiatan/${created.activity.id}/participants`,
      ]) {
        const res = await getPage(route, cookie)
        assertRedirectResult(res, expectedDest, `${label} on ${route}`)
      }
    }
  } finally {
    if (nextServer) {
      await nextServer.stop()
    }
    if (createdTenantIds.length > 0) {
      const tenantList = createdTenantIds.map((id) => `'${id}'`).join(",")
      runSql(`
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

