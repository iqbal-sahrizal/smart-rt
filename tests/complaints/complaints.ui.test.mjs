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
const OUT_DIR = "/tmp/smart-rt-complaints-ui-test-dist"

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
    "src/lib/residents/schemas.ts",
    "src/lib/complaints/constants.ts",
    "src/lib/complaints/types.ts",
    "src/lib/complaints/schemas.ts",
    "src/lib/complaints/storage.ts",
    "src/lib/complaints/formatters.ts",
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
    constants: require(join(OUT_DIR, "lib/complaints/constants.js")),
    types: require(join(OUT_DIR, "lib/complaints/types.js")),
    schemas: require(join(OUT_DIR, "lib/complaints/schemas.js")),
    storage: require(join(OUT_DIR, "lib/complaints/storage.js")),
    formatters: require(join(OUT_DIR, "lib/complaints/formatters.js")),
    navConfig: require(join(OUT_DIR, "components/layout/nav-config.js")),
    residentNavConfig: require(
      join(OUT_DIR, "components/resident/resident-nav-config.js")
    ),
  }
}

const { formatters, navConfig, residentNavConfig, schemas, storage, types } =
  loadUiTestModules()

test("Admin sidebar navigation removes hardcoded badge '3' on /pengaduan and resolves route titles & breadcrumbs", () => {
  const pengaduanNav = navConfig.NAV_ITEMS.find(
    (item) => item.href === "/pengaduan"
  )
  assert.ok(pengaduanNav, "NAV_ITEMS must include /pengaduan")
  assert.equal(pengaduanNav.title, "Pengaduan")
  assert.equal(
    pengaduanNav.badge,
    undefined,
    "/pengaduan nav item must not have hardcoded badge"
  )

  assert.equal(navConfig.getRouteTitle("/pengaduan"), "Pengaduan Warga")
  assert.equal(
    navConfig.getRouteTitle(
      "/pengaduan/11111111-1111-4111-8111-111111111101"
    ),
    "Detail Pengaduan"
  )

  assert.deepEqual(navConfig.getAdminBreadcrumbs("/pengaduan"), [
    { label: "Pengaduan Warga" },
  ])
  assert.deepEqual(
    navConfig.getAdminBreadcrumbs(
      "/pengaduan/11111111-1111-4111-8111-111111111101"
    ),
    [
      { label: "Pengaduan Warga", href: "/pengaduan" },
      { label: "Detail Pengaduan" },
    ]
  )
})

test("Complaint formatters display Indonesian WIB timestamps and valid status transitions without reopen", () => {
  const formatted = formatters.formatComplaintDateTime(
    "2026-11-15T14:00:00.000Z"
  )
  assert.ok(formatted.includes("WIB"), "Timestamp must end with WIB")
  assert.ok(
    formatted.includes("21"),
    "14:00 UTC must render as 21:xx WIB in Asia/Jakarta"
  )
  assert.equal(formatters.formatComplaintDateTime(null), "-")

  assert.deepEqual(formatters.getAllowedNextComplaintStatuses("open"), [
    "in_progress",
    "resolved",
    "rejected",
  ])
  assert.deepEqual(formatters.getAllowedNextComplaintStatuses("in_progress"), [
    "resolved",
    "rejected",
  ])
  assert.deepEqual(formatters.getAllowedNextComplaintStatuses("resolved"), [])
  assert.deepEqual(formatters.getAllowedNextComplaintStatuses("rejected"), [])

  assert.equal(formatters.getComplaintStatusLabel("open"), "Menunggu")
  assert.equal(formatters.getComplaintStatusLabel("in_progress"), "Diproses")
  assert.equal(formatters.getComplaintStatusLabel("resolved"), "Selesai")
  assert.equal(formatters.getComplaintStatusLabel("rejected"), "Ditolak")

  assert.equal(formatters.getComplaintPriorityLabel("low"), "Rendah")
  assert.equal(formatters.getComplaintPriorityLabel("medium"), "Sedang")
  assert.equal(formatters.getComplaintPriorityLabel("high"), "Tinggi")
})

test("Bendahara metadata-only detail NEVER concludes no-photo from hasPhoto:false and never exposes photo URL", () => {
  const bendaharaPresentation = formatters.getComplaintPhotoPresentation({
    complaint: {
      id: "comp-1",
      tenantId: "t-1",
      reporterMemberId: "m-1",
      reporterLabel: "Warga RT",
      category: "Fasilitas",
      title: "Lampu mati",
      description: "Lampu jalan mati di blok A",
      photoPath: null,
      photoUrl: null,
      hasPhoto: false,
      priority: "medium",
      status: "open",
      createdAt: "2026-11-15T10:00:00.000Z",
      updatedAt: "2026-11-15T10:00:00.000Z",
    },
    permissions: {
      canEdit: false,
      canReply: false,
      canTransition: false,
      canSoftDelete: false,
      canViewPhoto: false,
      canManagePhoto: false,
      isMetadataOnly: true,
    },
  })

  assert.equal(bendaharaPresentation.kind, "restricted")
  assert.ok(
    bendaharaPresentation.message.toLowerCase().includes("bendahara"),
    "Restricted presentation must explain Bendahara restriction cleanly"
  )
  assert.equal("photoUrl" in bendaharaPresentation, false)

  const managerWithPhoto = formatters.getComplaintPhotoPresentation({
    complaint: {
      id: "comp-1",
      tenantId: "t-1",
      reporterMemberId: "m-1",
      reporterLabel: "Warga RT",
      category: "Fasilitas",
      title: "Lampu mati",
      description: "Lampu jalan mati di blok A",
      photoPath: "t-1/comp-1/foto.png",
      photoUrl: "/api/complaints/comp-1/photo",
      hasPhoto: true,
      priority: "medium",
      status: "open",
      createdAt: "2026-11-15T10:00:00.000Z",
      updatedAt: "2026-11-15T10:00:00.000Z",
    },
    permissions: {
      canEdit: false,
      canReply: true,
      canTransition: true,
      canSoftDelete: true,
      canViewPhoto: true,
      canManagePhoto: false,
      isMetadataOnly: false,
    },
  })
  assert.equal(managerWithPhoto.kind, "available")
  assert.equal(managerWithPhoto.photoUrl, "/api/complaints/comp-1/photo")

  const managerWithoutPhoto = formatters.getComplaintPhotoPresentation({
    complaint: {
      id: "comp-2",
      tenantId: "t-1",
      reporterMemberId: "m-1",
      reporterLabel: "Warga RT",
      category: "Keamanan",
      title: "Portal rusak",
      description: "Engsel portal lepas",
      photoPath: null,
      photoUrl: null,
      hasPhoto: false,
      priority: "low",
      status: "open",
      createdAt: "2026-11-15T10:00:00.000Z",
      updatedAt: "2026-11-15T10:00:00.000Z",
    },
    permissions: {
      canEdit: false,
      canReply: true,
      canTransition: true,
      canSoftDelete: true,
      canViewPhoto: true,
      canManagePhoto: false,
      isMetadataOnly: false,
    },
  })
  assert.equal(managerWithoutPhoto.kind, "empty")
})

test("Admin role notices and permissions align with RT role matrix", () => {
  assert.equal(types.canReadComplaintsAdmin(["bendahara"]), true)
  assert.equal(types.canManageComplaints(["bendahara"]), false)
  assert.equal(types.canManageComplaints(["pengurus"]), true)
  assert.equal(types.canManageComplaints(["sekretaris"]), true)
  assert.equal(types.canManageComplaints(["ketua_rt"]), true)

  assert.ok(formatters.getComplaintRoleBannerNotice(["bendahara"]))
  assert.equal(formatters.getComplaintRoleBannerNotice(["ketua_rt"]), null)
  assert.equal(formatters.getComplaintRoleBannerNotice(["sekretaris"]), null)
  assert.equal(formatters.getComplaintRoleBannerNotice(["pengurus"]), null)
  assert.equal(
    formatters.getComplaintRoleBannerNotice(["bendahara", "pengurus"]),
    null,
    "Combined pengurus+bendahara must have full management access"
  )
})

test("Complaints Admin UI source hygiene: no select('*'), no service_role, no reply file attachments, no raw photoPath rendering", () => {
  const uiFiles = [
    "src/app/(admin)/pengaduan/page.tsx",
    "src/app/(admin)/pengaduan/[id]/page.tsx",
    "src/components/complaints/complaints-admin-list-view.tsx",
    "src/components/complaints/complaints-admin-detail-view.tsx",
    "src/components/complaints/complaint-photo-viewer.tsx",
    "src/components/complaints/complaint-status-transition-dialog.tsx",
    "src/components/complaints/complaint-delete-dialog.tsx",
    "src/components/complaints/complaints-skeletons.tsx",
    "src/lib/complaints/formatters.ts",
  ]

  for (const relPath of uiFiles) {
    const src = readFileSync(resolve(ROOT, relPath), "utf8")
    assert.equal(
      src.includes("service_role"),
      false,
      `${relPath} must never reference service_role`
    )
    assert.equal(
      src.includes('.select("*")'),
      false,
      `${relPath} must never use select('*')`
    )
    assert.equal(
      src.includes('type="file"'),
      false,
      `${relPath} must not add file upload controls (reply attachments disallowed & upload UI belongs to resident)`
    )
    assert.equal(
      src.includes("photoPath"),
      false,
      `${relPath} must never render or inspect raw storage photoPath`
    )
  }

  const navConfigSrc = readFileSync(
    resolve(ROOT, "src/components/layout/nav-config.ts"),
    "utf8"
  )
  assert.equal(
    /badge:\s*"3"/.test(navConfigSrc),
    false,
    "Hardcoded badge '3' on /pengaduan must be removed"
  )
})

test("Step 13.4 Resident bottom navigation stays at 5 slots and highlights Layanan on /resident/complaints*", () => {
  assert.equal(residentNavConfig.RESIDENT_NAV_ITEMS.length, 5)
  assert.deepEqual(
    residentNavConfig.RESIDENT_NAV_ITEMS.map((item) => item.label),
    ["Beranda", "Tagihan", "Pengumuman", "Layanan", "Profil"]
  )

  const paths = [
    "/resident/complaints",
    "/resident/complaints/new",
    "/resident/complaints/00000000-0000-0000-0000-000000000001",
  ]
  for (const path of paths) {
    assert.equal(
      residentNavConfig.isResidentRouteActive(path, "/resident/layanan"),
      true,
      `${path} should highlight Layanan bottom nav item`
    )
    assert.equal(
      residentNavConfig.isResidentRouteActive(path, "/resident"),
      false,
      `${path} must not highlight Beranda bottom nav item`
    )
  }
})

test("Step 13.4 Resident filter options, permission helpers, file size formatter, and photo validation", async () => {
  assert.deepEqual(
    formatters.RESIDENT_COMPLAINT_FILTER_OPTIONS,
    [
      { value: "all", label: "Semua" },
      { value: "open", label: "Baru" },
      { value: "in_progress", label: "Sedang diproses" },
      { value: "resolved", label: "Selesai" },
      { value: "rejected", label: "Ditolak" },
    ]
  )

  assert.equal(formatters.canResidentEditComplaint("open"), true)
  assert.equal(formatters.canResidentEditComplaint("in_progress"), false)
  assert.equal(formatters.canResidentEditComplaint("resolved"), false)
  assert.equal(formatters.canResidentEditComplaint("rejected"), false)

  assert.equal(formatters.canResidentReplyComplaint("open"), true)
  assert.equal(formatters.canResidentReplyComplaint("in_progress"), true)
  assert.equal(formatters.canResidentReplyComplaint("resolved"), false)
  assert.equal(formatters.canResidentReplyComplaint("rejected"), false)

  assert.equal(formatters.canResidentManageComplaintPhoto("open"), true)
  assert.equal(formatters.canResidentManageComplaintPhoto("in_progress"), false)
  assert.equal(formatters.canResidentManageComplaintPhoto("resolved"), false)
  assert.equal(formatters.canResidentManageComplaintPhoto("rejected"), false)

  assert.equal(formatters.formatComplaintFileSize(512), "512 B")
  assert.equal(formatters.formatComplaintFileSize(2048), "2 KB")
  assert.equal(formatters.formatComplaintFileSize(2.5 * 1024 * 1024), "2.50 MB")

  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
  const validPng = await storage.validateComplaintPhotoFile(
    new File([pngBytes], "foto-lampu.png", { type: "image/png" })
  )
  assert.equal(validPng.ok, true)

  const spoofedPng = await storage.validateComplaintPhotoFile(
    new File([new TextEncoder().encode("not a valid png!")], "bukan-gambar.png", {
      type: "image/png",
    })
  )
  assert.equal(spoofedPng.ok, false)

  const oversized = await storage.validateComplaintPhotoFile(
    new File([new Uint8Array(storage.MAX_COMPLAINT_PHOTO_BYTES + 1)], "terlalu-besar.jpg", {
      type: "image/jpeg",
    })
  )
  assert.equal(oversized.ok, false)

  assert.equal(
    schemas.createComplaintSchema.safeParse({
      category: "Fasilitas",
      title: "Lampu jalan mati",
      description: "Lampu di RT 01 mati sejak kemarin malam.",
    }).success,
    true
  )
  const parsedWithPriority = schemas.createComplaintSchema.safeParse({
    category: "Fasilitas",
    title: "Lampu jalan mati",
    description: "Deskripsi cukup panjang.",
    priority: "urgent",
  })
  assert.equal(parsedWithPriority.success, true)
  assert.equal(
    "priority" in parsedWithPriority.data,
    false,
    "Resident create schema must strip client-supplied priority"
  )
})

test("Step 13.4 Resident Complaints UI source hygiene and partial-failure safety", () => {
  const residentFiles = [
    "src/app/(resident)/resident/complaints/page.tsx",
    "src/app/(resident)/resident/complaints/new/page.tsx",
    "src/app/(resident)/resident/complaints/[id]/page.tsx",
    "src/components/complaints/resident-complaints-list-view.tsx",
    "src/components/complaints/resident-complaint-create-form.tsx",
    "src/components/complaints/resident-complaint-detail-view.tsx",
    "src/app/(resident)/resident/layanan/page.tsx",
    "src/components/resident/resident-dashboard-view.tsx",
  ]

  for (const relPath of residentFiles) {
    const src = readFileSync(resolve(ROOT, relPath), "utf8")
    assert.equal(
      src.includes("service_role"),
      false,
      `${relPath} must never reference service_role`
    )
    assert.equal(
      src.includes('.select("*")'),
      false,
      `${relPath} must never use select('*')`
    )
    assert.equal(
      src.includes("photoPath"),
      false,
      `${relPath} must never reference or render raw storage photoPath`
    )
    assert.equal(
      src.includes("attachmentPath"),
      false,
      `${relPath} must never reference reply attachmentPath`
    )
    assert.equal(
      src.includes("transitionComplaintStatusAction") ||
        src.includes("softDeleteComplaintAction") ||
        src.includes("useTransitionComplaintStatusMutation") ||
        src.includes("useSoftDeleteComplaintMutation"),
      false,
      `${relPath} must never expose admin status transition or soft-delete controls`
    )
  }

  const createFormSrc = readFileSync(
    resolve(ROOT, "src/components/complaints/resident-complaint-create-form.tsx"),
    "utf8"
  )
  assert.match(createFormSrc, /createdComplaint/)
  assert.match(createFormSrc, /handleRetryPhotoUpload/)
  assert.match(createFormSrc, /Coba Unggah Foto Lagi/)
  assert.match(createFormSrc, /validateComplaintPhotoFile/)

  const detailSrc = readFileSync(
    resolve(ROOT, "src/components/complaints/resident-complaint-detail-view.tsx"),
    "utf8"
  )
  // Reply section must never render file inputs; photo upload only belongs to the photo management block
  const fileInputMatches = detailSrc.match(/type="file"/g) ?? []
  assert.equal(
    fileInputMatches.length,
    1,
    "Detail view must contain only the single main complaint photo file input (none for replies)"
  )
  const replyFormIdx = detailSrc.indexOf("resident-complaint-replies-list")
  assert.ok(replyFormIdx > -1)
  assert.equal(
    detailSrc.slice(replyFormIdx).includes('type="file"'),
    false,
    "Reply section/form must not include file upload inputs"
  )

  const layananSrc = readFileSync(
    resolve(ROOT, "src/app/(resident)/resident/layanan/page.tsx"),
    "utf8"
  )
  assert.match(layananSrc, /\/resident\/complaints/)
  assert.match(layananSrc, /Pengaduan Warga/)
})

