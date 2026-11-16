import assert from "node:assert/strict"
import {
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import test from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")

const ROOT = process.cwd()
const OUT_DIR = `/tmp/smart-rt-sidebar-nav-test-dist-${process.pid}`

function loadNavModules() {
  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })
  symlinkSync(
    resolve(ROOT, "node_modules"),
    join(OUT_DIR, "node_modules"),
    "dir"
  )

  for (const relPath of [
    "src/lib/auth/types.ts",
    "src/components/layout/nav-config.ts",
  ]) {
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
    navConfig: require(join(OUT_DIR, "components/layout/nav-config.js")),
  }
}

const { navConfig } = loadNavModules()

test.after(() => {
  rmSync(OUT_DIR, { recursive: true, force: true })
})

test("Admin grouped navigation defines Dashboard direct link and domain groups without fake routes", () => {
  const groups = navConfig.ADMIN_NAV_GROUPS
  assert.equal(groups[0].kind, "link")
  assert.equal(groups[0].href, "/")
  assert.equal(groups[0].title, "Dashboard")

  const groupLabels = groups
    .filter((g) => g.kind === "group")
    .map((g) => g.label)
  assert.deepEqual(groupLabels, [
    "Data Warga",
    "Keuangan",
    "Operasional RT",
    "Layanan Administrasi",
    "Informasi & Komunikasi",
  ])

  const allHrefs = groups.flatMap((g) =>
    g.kind === "link" ? [g.href] : g.items.map((i) => i.href)
  )
  assert.ok(allHrefs.includes("/pengaturan"))
  assert.ok(allHrefs.includes("/residents"))
  assert.ok(allHrefs.includes("/resident-invitations"))
  assert.ok(allHrefs.includes("/dues"))
  assert.ok(allHrefs.includes("/bills"))
  assert.ok(allHrefs.includes("/payments"))
  assert.ok(allHrefs.includes("/cash"))
  assert.ok(allHrefs.includes("/ronda"))
  assert.ok(allHrefs.includes("/ronda/attendance"))
  assert.ok(allHrefs.includes("/kegiatan"))
  assert.ok(allHrefs.includes("/pengaduan"))
  assert.ok(allHrefs.includes("/surat"))
  assert.ok(allHrefs.includes("/surat/jenis"))
  assert.ok(allHrefs.includes("/announcements"))
  assert.ok(allHrefs.includes("/notifications"))
})

test("Role-based visibility filters submenus accurately and omits empty groups", () => {
  const hrefsFor = (roles) =>
    navConfig
      .getVisibleAdminNavGroups(roles)
      .flatMap((g) => (g.kind === "link" ? [g.href] : g.items.map((i) => i.href)))

  const groupIdsFor = (roles) =>
    navConfig.getVisibleAdminNavGroups(roles).map((g) => g.id)

  // ketua_rt & sekretaris see invitations, ronda attendance, kegiatan, surat, jenis surat, NOT /payments
  for (const role of ["ketua_rt", "sekretaris"]) {
    const hrefs = hrefsFor([role])
    assert.ok(hrefs.includes("/resident-invitations"))
    assert.ok(hrefs.includes("/ronda/attendance"))
    assert.ok(hrefs.includes("/kegiatan"))
    assert.ok(hrefs.includes("/surat"))
    assert.ok(hrefs.includes("/surat/jenis"))
    assert.equal(hrefs.includes("/payments"), false)
    assert.ok(groupIdsFor([role]).includes("layanan-administrasi"))
  }

  // pengurus sees kegiatan, surat, jenis surat, NOT invitations, ronda attendance, or payments
  const pengurusHrefs = hrefsFor(["pengurus"])
  assert.ok(pengurusHrefs.includes("/kegiatan"))
  assert.ok(pengurusHrefs.includes("/surat"))
  assert.ok(pengurusHrefs.includes("/surat/jenis"))
  assert.equal(pengurusHrefs.includes("/resident-invitations"), false)
  assert.equal(pengurusHrefs.includes("/ronda/attendance"), false)
  assert.equal(pengurusHrefs.includes("/payments"), false)

  // bendahara sees /payments, does NOT see /kegiatan, /surat, /surat/jenis, /resident-invitations, /ronda/attendance
  // And empty group "layanan-administrasi" must NOT render for bendahara
  const bendaharaHrefs = hrefsFor(["bendahara"])
  const bendaharaGroupIds = groupIdsFor(["bendahara"])
  assert.ok(bendaharaHrefs.includes("/payments"))
  assert.equal(bendaharaHrefs.includes("/kegiatan"), false)
  assert.equal(bendaharaHrefs.includes("/surat"), false)
  assert.equal(bendaharaHrefs.includes("/surat/jenis"), false)
  assert.equal(bendaharaHrefs.includes("/resident-invitations"), false)
  assert.equal(bendaharaHrefs.includes("/ronda/attendance"), false)
  assert.equal(bendaharaGroupIds.includes("layanan-administrasi"), false)
})

test("Active route & nested route matching avoids substring false positives and handles trailing slashes", () => {
  const ketuaVisible = navConfig.getVisibleAdminNavGroups(["ketua_rt"])

  assert.equal(navConfig.resolveActiveAdminNavHref("/", ketuaVisible), "/")
  assert.equal(navConfig.resolveActiveAdminNavHref("/residents", ketuaVisible), "/residents")
  assert.equal(
    navConfig.resolveActiveAdminNavHref("/residents/123/edit/", ketuaVisible),
    "/residents"
  )
  assert.equal(
    navConfig.resolveActiveAdminNavHref("/resident-invitations", ketuaVisible),
    "/resident-invitations"
  )
  assert.equal(
    navConfig.resolveActiveAdminNavHref("/kegiatan/abc-123/participants", ketuaVisible),
    "/kegiatan"
  )
  assert.equal(
    navConfig.resolveActiveAdminNavHref("/pengaduan/abc-123", ketuaVisible),
    "/pengaduan"
  )
  assert.equal(
    navConfig.resolveActiveAdminNavHref("/surat", ketuaVisible),
    "/surat"
  )
  assert.equal(
    navConfig.resolveActiveAdminNavHref("/surat/abc-123", ketuaVisible),
    "/surat"
  )
  // Sibling nested routes: /surat/jenis must match Jenis Surat, not /surat
  assert.equal(
    navConfig.resolveActiveAdminNavHref("/surat/jenis/", ketuaVisible),
    "/surat/jenis"
  )
  // Sibling nested routes: /ronda/attendance must match Rekap Kehadiran Ronda, not /ronda
  assert.equal(
    navConfig.resolveActiveAdminNavHref("/ronda/new", ketuaVisible),
    "/ronda"
  )
  assert.equal(
    navConfig.resolveActiveAdminNavHref("/ronda/abc-123/edit", ketuaVisible),
    "/ronda"
  )
  assert.equal(
    navConfig.resolveActiveAdminNavHref("/ronda/attendance", ketuaVisible),
    "/ronda/attendance"
  )

  assert.equal(
    navConfig.findActiveAdminNavGroupId("/surat/jenis", ["ketua_rt"]),
    "layanan-administrasi"
  )
  assert.equal(
    navConfig.findActiveAdminNavGroupId("/kegiatan/123", ["pengurus"]),
    "operasional-rt"
  )
  assert.equal(
    navConfig.findActiveAdminNavGroupId("/payments/123", ["bendahara"]),
    "keuangan"
  )
  assert.equal(
    navConfig.findActiveAdminNavGroupId("/", ["ketua_rt"]),
    "dashboard"
  )
})

test("AppSidebar component enforces semantic accordion buttons, aria attributes, chevron, and drawer behavior", () => {
  const sidebarSrc = readFileSync(
    resolve(ROOT, "src/components/layout/app-sidebar.tsx"),
    "utf8"
  )
  const shellSrc = readFileSync(
    resolve(ROOT, "src/components/layout/app-shell.tsx"),
    "utf8"
  )
  const residentNavSrc = readFileSync(
    resolve(ROOT, "src/components/resident/resident-nav-config.ts"),
    "utf8"
  )

  assert.ok(sidebarSrc.includes('type="button"'))
  assert.ok(sidebarSrc.includes("aria-expanded={isOpen}"))
  assert.ok(sidebarSrc.includes("aria-controls={submenuId}"))
  assert.ok(sidebarSrc.includes('aria-current={active ? "page" : undefined}'))
  assert.ok(sidebarSrc.includes("ChevronDownIcon"))
  assert.ok(sidebarSrc.includes('aria-hidden="true"'))
  assert.ok(sidebarSrc.includes("hidden={!isOpen}"))
  assert.ok(sidebarSrc.includes("expandedGroups"))
  assert.equal(sidebarSrc.includes("localStorage"), false)
  assert.ok(shellSrc.includes("onNavigate={() => setMobileOpen(false)}"))
  assert.ok(residentNavSrc.includes("RESIDENT_NAV_ITEMS"))
})

