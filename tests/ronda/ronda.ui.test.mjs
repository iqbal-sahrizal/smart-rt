import assert from "node:assert/strict"
import { createRequire } from "node:module"
import {
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import test from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")

const ROOT = process.cwd()
const OUT_DIR = "/tmp/smart-rt-ronda-ui-test-dist"

function loadUiTestModules() {
  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })
  symlinkSync(
    resolve(ROOT, "node_modules"),
    join(OUT_DIR, "node_modules"),
    "dir"
  )

  const files = [
    "src/lib/auth/types.ts",
    "src/lib/ronda/types.ts",
    "src/lib/ronda/formatters.ts",
    "src/components/layout/nav-config.ts",
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
    rondaTypes: require(join(OUT_DIR, "lib/ronda/types.js")),
    formatters: require(join(OUT_DIR, "lib/ronda/formatters.js")),
    navConfig: require(join(OUT_DIR, "components/layout/nav-config.js")),
    residentNavConfig: require(
      join(OUT_DIR, "components/resident/resident-nav-config.js")
    ),
  }
}

const { rondaTypes, formatters, navConfig, residentNavConfig } =
  loadUiTestModules()

test("Admin sidebar navigation exposes Jadwal Ronda to all admin roles and handles breadcrumbs/titles", () => {
  const rondaNav = navConfig.NAV_ITEMS.find((item) => item.href === "/ronda")
  assert.ok(rondaNav, "NAV_ITEMS must include /ronda")
  assert.equal(rondaNav.title, "Jadwal Ronda")
  assert.equal(
    rondaNav.requiredRoles,
    undefined,
    "Jadwal Ronda menu must remain visible to bendahara and pengurus as read-only readers"
  )

  assert.equal(navConfig.getRouteTitle("/ronda"), "Jadwal Ronda")
  assert.equal(navConfig.getRouteTitle("/ronda/new"), "Tambah Jadwal Ronda")
  assert.equal(
    navConfig.getRouteTitle("/ronda/attendance"),
    "Rekap Kehadiran Ronda"
  )
  assert.equal(
    navConfig.getRouteTitle("/ronda/11111111-1111-4111-8111-111111111101"),
    "Detail Jadwal Ronda"
  )
  assert.equal(
    navConfig.getRouteTitle(
      "/ronda/11111111-1111-4111-8111-111111111101/edit"
    ),
    "Ubah Jadwal Ronda"
  )

  assert.deepEqual(navConfig.getAdminBreadcrumbs("/ronda/attendance"), [
    { label: "Jadwal Ronda", href: "/ronda" },
    { label: "Rekap Kehadiran" },
  ])
  assert.deepEqual(
    navConfig.getAdminBreadcrumbs(
      "/ronda/11111111-1111-4111-8111-111111111101/edit"
    ),
    [
      { label: "Jadwal Ronda", href: "/ronda" },
      {
        label: "Detail Jadwal",
        href: "/ronda/11111111-1111-4111-8111-111111111101",
      },
      { label: "Ubah Jadwal" },
    ]
  )
})

test("Resident bottom nav preserves 6 slots and highlights Layanan when viewing /resident/ronda routes", () => {
  assert.equal(residentNavConfig.RESIDENT_NAV_ITEMS.length, 6)
  assert.equal(
    residentNavConfig.isResidentRouteActive("/resident/ronda", "/resident/layanan"),
    true
  )
  assert.equal(
    residentNavConfig.isResidentRouteActive(
      "/resident/ronda/11111111-1111-4111-8111-111111111101",
      "/resident/layanan"
    ),
    true
  )
  assert.equal(
    residentNavConfig.isResidentRouteActive(
      "/resident/layanan",
      "/resident/layanan"
    ),
    true
  )
  assert.equal(
    residentNavConfig.isResidentRouteActive("/resident/ronda", "/resident"),
    false
  )
})

test("Ronda UI permission helpers strictly separate manager roles from bendahara/pengurus", () => {
  assert.equal(rondaTypes.canManageRonda(["ketua_rt"]), true)
  assert.equal(rondaTypes.canManageRonda(["sekretaris"]), true)
  assert.equal(rondaTypes.canManageRonda(["bendahara"]), false)
  assert.equal(rondaTypes.canManageRonda(["pengurus"]), false)
  assert.equal(rondaTypes.canManageRonda(["warga"]), false)

  assert.equal(rondaTypes.canReadAllRondaAttendance(["ketua_rt"]), true)
  assert.equal(rondaTypes.canReadAllRondaAttendance(["sekretaris"]), true)
  assert.equal(rondaTypes.canReadAllRondaAttendance(["bendahara"]), false)
  assert.equal(rondaTypes.canReadAllRondaAttendance(["pengurus"]), false)
  assert.equal(rondaTypes.canReadAllRondaAttendance(["warga"]), false)
})

test("Time & date formatters detect overnight shifts and format Indonesian labels cleanly", () => {
  const normal = formatters.formatRondaTimeRange("19:00:00", "23:00:00")
  assert.equal(normal.isOvernight, false)
  assert.equal(normal.label, "19:00 – 23:00 WIB")

  const overnight = formatters.formatRondaTimeRange("22:00:00", "04:00:00")
  assert.equal(overnight.isOvernight, true)
  assert.equal(overnight.label, "22:00 – 04:00 WIB (+1 hari)")

  const longDate = formatters.formatRondaDateLong("2026-12-20")
  assert.match(longDate, /2026/)
  assert.match(longDate, /Desember/)
})

test("Month calendar builder produces full Monday-first weeks and attaches matching schedules", () => {
  assert.equal(formatters.isValidMonthKey("2026-12"), true)
  assert.equal(formatters.isValidMonthKey("2026-13"), false)
  assert.equal(formatters.shiftMonthKey("2026-12", 1), "2027-01")
  assert.equal(formatters.shiftMonthKey("2026-01", -1), "2025-12")
  assert.deepEqual(formatters.getMonthDateRange("2026-02"), {
    fromDate: "2026-02-01",
    toDate: "2026-02-28",
  })

  const mockSchedule = {
    id: "11111111-1111-4111-8111-111111111101",
    tenantId: "22222222-2222-4222-8222-222222222202",
    scheduleDate: "2026-12-20",
    shiftLabel: "Ronda Malam",
    startTime: "22:00:00",
    endTime: "04:00:00",
    meetingPoint: "Pos Kamling",
    notes: null,
    createdBy: null,
    updatedBy: null,
    createdAt: "2026-12-01T00:00:00Z",
    updatedAt: "2026-12-01T00:00:00Z",
    assignedCount: 2,
    officers: [],
  }

  const cells = formatters.buildRondaMonthCalendar("2026-12", [mockSchedule])
  assert.equal(cells.length % 7, 0)
  const dec20 = cells.find((c) => c.isoDate === "2026-12-20")
  assert.ok(dec20)
  assert.equal(dec20.inCurrentMonth, true)
  assert.equal(dec20.schedule?.id, mockSchedule.id)
})

test("Roster picker helpers prevent duplicate residents and support clean removal", () => {
  const c1 = {
    id: "11111111-1111-4111-8111-111111111101",
    fullName: "Budi Santoso",
    householdId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    householdLabel: "Blok A-1",
  }
  const c2 = {
    id: "22222222-2222-4222-8222-222222222202",
    fullName: "Andi Wijaya",
    householdId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    householdLabel: "Blok B-2",
  }

  let selected = formatters.addResidentToRoster([], c1)
  selected = formatters.addResidentToRoster(selected, c1)
  selected = formatters.addResidentToRoster(selected, c2)

  assert.equal(selected.length, 2)
  assert.deepEqual(
    selected.map((s) => s.residentId),
    [c1.id, c2.id]
  )

  selected = formatters.removeResidentFromRoster(selected, c1.id)
  assert.deepEqual(
    selected.map((s) => s.residentId),
    [c2.id]
  )
})

test("Attendance summarizer computes status totals and attendance rate accurately", () => {
  const stats = formatters.summarizeRondaAttendance([
    { attendanceStatus: "present" },
    { attendanceStatus: "present" },
    { attendanceStatus: "absent" },
    { attendanceStatus: "excused" },
    { attendanceStatus: null },
  ])

  assert.deepEqual(stats, {
    total: 5,
    present: 2,
    absent: 1,
    excused: 1,
    unrecorded: 1,
    attendanceRatePercent: 50,
  })
})

