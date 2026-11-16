import assert from "node:assert/strict"
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
import test from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")

const ROOT = process.cwd()
const OUT_DIR = `/tmp/smart-rt-letters-ui-test-dist-${process.pid}`

function loadLettersUiTestModules() {
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
    "src/lib/analytics/types.ts",
    "src/lib/letters/constants.ts",
    "src/lib/letters/types.ts",
    "src/lib/letters/errors.ts",
    "src/lib/letters/schemas.ts",
    "src/lib/letters/storage.ts",
    "src/lib/letters/formatters.ts",
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
    constants: require(join(OUT_DIR, "lib/letters/constants.js")),
    types: require(join(OUT_DIR, "lib/letters/types.js")),
    schemas: require(join(OUT_DIR, "lib/letters/schemas.js")),
    storage: require(join(OUT_DIR, "lib/letters/storage.js")),
    formatters: require(join(OUT_DIR, "lib/letters/formatters.js")),
    navConfig: require(join(OUT_DIR, "components/layout/nav-config.js")),
    residentNav: require(
      join(OUT_DIR, "components/resident/resident-nav-config.js")
    ),
  }
}

const {
  constants,
  types,
  schemas,
  storage,
  formatters,
  navConfig,
  residentNav,
} = loadLettersUiTestModules()

test.after(() => {
  rmSync(OUT_DIR, { recursive: true, force: true })
})

function collectFiles(dir) {
  const results = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      results.push(...collectFiles(full))
    } else if (/\.(ts|tsx)$/.test(entry)) {
      results.push(full)
    }
  }
  return results
}

function makeFakeFile({ name, type, bytes }) {
  const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return {
    name,
    type,
    size: uint8.byteLength,
    async arrayBuffer() {
      return uint8.buffer.slice(
        uint8.byteOffset,
        uint8.byteOffset + uint8.byteLength
      )
    },
  }
}

function makeJpegBytes(size = 64) {
  const bytes = new Uint8Array(size)
  bytes[0] = 0xff
  bytes[1] = 0xd8
  bytes[2] = 0xff
  bytes[3] = 0xe0
  return bytes
}

function makePdfBytes(size = 64) {
  const bytes = new Uint8Array(size)
  const header = new TextEncoder().encode("%PDF-1.4\n")
  bytes.set(header, 0)
  return bytes
}

test("Admin navigation enforces role visibility for /surat and resolves routes & breadcrumbs", () => {
  const suratNav = navConfig.NAV_ITEMS.find((item) => item.href === "/surat")
  assert.ok(suratNav, "Admin sidebar must include /surat")
  assert.deepEqual(suratNav.requiredRoles, [
    "ketua_rt",
    "sekretaris",
    "pengurus",
  ])

  const canSeeSurat = (roles) =>
    !suratNav.requiredRoles ||
    suratNav.requiredRoles.some((r) => roles.includes(r))

  assert.equal(canSeeSurat(["ketua_rt"]), true)
  assert.equal(canSeeSurat(["sekretaris"]), true)
  assert.equal(canSeeSurat(["pengurus"]), true)
  assert.equal(canSeeSurat(["bendahara"]), false)
  assert.equal(canSeeSurat(["warga"]), false)

  assert.equal(navConfig.getRouteTitle("/surat"), "Surat Pengantar")
  assert.equal(navConfig.getRouteTitle("/surat/jenis"), "Jenis Surat")
  assert.equal(
    navConfig.getRouteTitle("/surat/11111111-1111-4111-8111-111111111101"),
    "Detail Permohonan Surat"
  )

  assert.deepEqual(navConfig.getAdminBreadcrumbs("/surat"), [
    { label: "Surat Pengantar" },
  ])
  assert.deepEqual(navConfig.getAdminBreadcrumbs("/surat/jenis"), [
    { label: "Surat Pengantar", href: "/surat" },
    { label: "Jenis Surat" },
  ])
  assert.deepEqual(
    navConfig.getAdminBreadcrumbs(
      "/surat/11111111-1111-4111-8111-111111111101"
    ),
    [
      { label: "Surat Pengantar", href: "/surat" },
      { label: "Detail Permohonan" },
    ]
  )
})

test("Resident bottom navigation keeps exact 5 slots and highlights Layanan on /resident/letters routes", () => {
  assert.equal(residentNav.RESIDENT_NAV_ITEMS.length, 5)
  assert.deepEqual(
    residentNav.RESIDENT_NAV_ITEMS.map((i) => i.href),
    [
      "/resident",
      "/resident/bills",
      "/resident/announcements",
      "/resident/layanan",
      "/resident/profile",
    ]
  )

  for (const path of [
    "/resident/letters",
    "/resident/letters/new",
    "/resident/letters/11111111-1111-4111-8111-111111111101",
  ]) {
    assert.equal(
      residentNav.isResidentRouteActive(path, "/resident/layanan"),
      true,
      `Layanan must be active on ${path}`
    )
    assert.equal(
      residentNav.isResidentRouteActive(path, "/resident"),
      false
    )
    assert.equal(
      residentNav.isResidentRouteActive(path, "/resident/bills"),
      false
    )
  }
})

test("Canonical 6 letter statuses exclude pending alias and format WIB timestamps cleanly", () => {
  assert.deepEqual(constants.LETTER_STATUSES, [
    "submitted",
    "reviewing",
    "approved",
    "rejected",
    "completed",
    "cancelled",
  ])
  assert.equal(constants.LETTER_STATUSES.includes("pending"), false)

  const filterValues = formatters.LETTER_STATUS_FILTER_OPTIONS.map(
    (opt) => opt.value
  )
  assert.deepEqual(filterValues, [
    "all",
    "submitted",
    "reviewing",
    "approved",
    "rejected",
    "completed",
    "cancelled",
  ])
  assert.equal(filterValues.includes("pending"), false)

  const wibDateTime = formatters.formatLetterDateTime("2026-11-15T14:00:00.000Z")
  assert.ok(wibDateTime.includes("WIB"), "Timestamp must end with WIB")
  assert.ok(wibDateTime.includes("21"), "14:00Z must map to 21 WIB")
  assert.equal(formatters.formatLetterDateTime(null), "-")
  assert.equal(formatters.formatLetterDateShort(null), "-")

  assert.equal(formatters.formatLetterFileSize(512), "512 B")
  assert.equal(formatters.formatLetterFileSize(2048), "2.0 KB")
  assert.equal(formatters.formatLetterFileSize(2 * 1024 * 1024), "2.00 MB")

  assert.equal(
    formatters.getLetterRequestCode("11111111-1111-4111-8111-111111111101"),
    "SRT-11111111"
  )
})

test("Role matrix, pengurus metadata-only restriction, and document presentation helpers enforce least privilege", () => {
  assert.equal(types.canReadLettersAdmin(["ketua_rt"]), true)
  assert.equal(types.canReadLettersAdmin(["sekretaris"]), true)
  assert.equal(types.canReadLettersAdmin(["pengurus"]), true)
  assert.equal(types.canReadLettersAdmin(["bendahara"]), false)
  assert.equal(types.canManageLetters(["ketua_rt"]), true)
  assert.equal(types.canManageLetters(["sekretaris"]), true)
  assert.equal(types.canManageLetters(["pengurus"]), false)
  assert.equal(types.isLetterMetadataOnlyRole(["pengurus"]), true)
  assert.equal(types.isLetterMetadataOnlyRole(["ketua_rt"]), false)

  assert.equal(formatters.canShowManageLettersCta(["ketua_rt"]), true)
  assert.equal(formatters.canShowManageLettersCta(["sekretaris"]), true)
  assert.equal(formatters.canShowManageLettersCta(["pengurus"]), false)
  assert.equal(formatters.canShowManageLettersCta(["bendahara"]), false)

  const pengurusNotice = formatters.getLetterRoleBannerNotice(["pengurus"])
  assert.ok(pengurusNotice !== null)
  assert.ok(pengurusNotice.title.toLowerCase().includes("metadata"))
  assert.equal(formatters.getLetterRoleBannerNotice(["ketua_rt"]), null)
  assert.equal(formatters.getLetterRoleBannerNotice(["sekretaris"]), null)

  const pengurusPresentation = formatters.getLetterDocumentsPresentation({
    request: {
      attachments: [],
      hasIssuedPdf: true,
      issuedPdfUrl: "/api/letters/1/issued",
      issuedDownloadUrl: "/api/letters/1/issued?download=1",
    },
    permissions: {
      canAccessDocuments: false,
      isMetadataOnly: true,
    },
  })
  assert.equal(pengurusPresentation.kind, "restricted")
  assert.equal("attachments" in pengurusPresentation, false)
  assert.equal("issuedPdfUrl" in pengurusPresentation, false)

  const sekretarisPresentation = formatters.getLetterDocumentsPresentation({
    request: {
      attachments: [
        {
          fileId: "att-1",
          fileName: "ktp.jpg",
          contentType: "image/jpeg",
          sizeBytes: 1024,
          uploadedAt: "2026-11-15T10:00:00.000Z",
          downloadUrl: "/api/letters/req-1/attachments/att-1",
        },
      ],
      hasIssuedPdf: true,
      issuedPdfUrl: "/api/letters/req-1/issued",
      issuedDownloadUrl: "/api/letters/req-1/issued?download=1",
    },
    permissions: {
      canAccessDocuments: true,
      isMetadataOnly: false,
    },
  })
  assert.equal(sekretarisPresentation.kind, "available")
  if (sekretarisPresentation.kind === "available") {
    assert.equal(sekretarisPresentation.attachments.length, 1)
    assert.equal(sekretarisPresentation.issuedPdfUrl, "/api/letters/req-1/issued")
  }
})

test("Review workflow helper matches RPC transitions and rejection note requirements", () => {
  assert.deepEqual(formatters.getAllowedReviewDecisions("submitted"), [
    "reviewing",
    "approved",
    "rejected",
  ])
  assert.deepEqual(formatters.getAllowedReviewDecisions("reviewing"), [
    "approved",
    "rejected",
  ])
  for (const terminal of ["approved", "rejected", "completed", "cancelled"]) {
    assert.deepEqual(formatters.getAllowedReviewDecisions(terminal), [])
  }

  assert.equal(
    formatters.getLetterReviewActionMeta("rejected").requiresNotes,
    true
  )
  assert.equal(
    formatters.getLetterReviewActionMeta("approved").requiresNotes,
    false
  )
  assert.equal(
    formatters.getLetterReviewActionMeta("reviewing").requiresNotes,
    false
  )

  const rejectedWithoutNotes = schemas.reviewLetterRequestSchema.safeParse({
    requestId: "11111111-1111-4111-8111-111111111101",
    decision: "rejected",
    adminNotes: "  ",
  })
  assert.equal(rejectedWithoutNotes.success, false)

  const rejectedWithNotes = schemas.reviewLetterRequestSchema.safeParse({
    requestId: "11111111-1111-4111-8111-111111111101",
    decision: "rejected",
    adminNotes: "Dokumen KK kurang jelas",
  })
  assert.equal(rejectedWithNotes.success, true)
})

test("Client schemas and binary attachment validators block invalid payloads and files before upload", async () => {
  assert.equal(
    schemas.createLetterRequestSchema.safeParse({
      letterTypeId: "11111111-1111-4111-8111-111111111101",
      purpose: "   ",
    }).success,
    false
  )
  assert.equal(
    schemas.createLetterRequestSchema.safeParse({
      letterTypeId: "not-a-uuid",
      purpose: "Mengurus surat keterangan domisili untuk bank",
    }).success,
    false
  )
  assert.equal(
    schemas.createLetterRequestSchema.safeParse({
      letterTypeId: "11111111-1111-4111-8111-111111111101",
      purpose: "Mengurus surat keterangan domisili untuk bank",
    }).success,
    true
  )

  const badExt = await storage.validateLetterAttachmentFile(
    makeFakeFile({
      name: "script.exe",
      type: "application/octet-stream",
      bytes: makeJpegBytes(32),
    })
  )
  assert.equal(badExt.ok, false)

  const oversized = await storage.validateLetterAttachmentFile(
    makeFakeFile({
      name: "huge.jpg",
      type: "image/jpeg",
      bytes: new Uint8Array(5 * 1024 * 1024 + 1),
    })
  )
  assert.equal(oversized.ok, false)

  const validImg = await storage.validateLetterAttachmentFile(
    makeFakeFile({
      name: "ktp.jpg",
      type: "image/jpeg",
      bytes: makeJpegBytes(128),
    })
  )
  assert.equal(validImg.ok, true)

  const nonPdfIssued = await storage.validateIssuedLetterPdfFile(
    makeFakeFile({
      name: "surat.jpg",
      type: "image/jpeg",
      bytes: makeJpegBytes(128),
    })
  )
  assert.equal(nonPdfIssued.ok, false)

  const validIssued = await storage.validateIssuedLetterPdfFile(
    makeFakeFile({
      name: "surat-terbit.pdf",
      type: "application/pdf",
      bytes: makePdfBytes(128),
    })
  )
  assert.equal(validIssued.ok, true)
})

test("Letters UI components and App Router pages uphold security, Suspense, role guards, and memory cleanup hygiene", () => {
  const uiFiles = [
    ...collectFiles(resolve(ROOT, "src/components/letters")),
    ...collectFiles(resolve(ROOT, "src/app/(admin)/surat")),
    ...collectFiles(resolve(ROOT, "src/app/(resident)/resident/letters")),
  ]

  assert.equal(uiFiles.length >= 16, true, "Expected all 10 components + 6 pages")

  for (const file of uiFiles) {
    const src = readFileSync(file, "utf8")
    assert.equal(
      src.includes("service_role"),
      false,
      `${file} must not reference service_role`
    )
    assert.equal(
      src.includes("supabaseAdmin"),
      false,
      `${file} must not reference supabaseAdmin`
    )
    assert.equal(
      src.includes("createSignedUrl"),
      false,
      `${file} must never create signed storage URLs directly`
    )
    assert.equal(
      src.includes("getPublicUrl"),
      false,
      `${file} must never construct public storage URLs`
    )
    assert.equal(
      src.includes('.select("*")'),
      false,
      `${file} must never call select("*")`
    )
    assert.equal(
      src.includes("supporting_doc_paths"),
      false,
      `${file} must never expose raw supporting_doc_paths column`
    )
    assert.equal(
      src.includes("issued_file_path"),
      false,
      `${file} must never expose raw issued_file_path column`
    )
  }

  for (const adminPage of [
    "src/app/(admin)/surat/page.tsx",
    "src/app/(admin)/surat/[id]/page.tsx",
    "src/app/(admin)/surat/jenis/page.tsx",
  ]) {
    const src = readFileSync(resolve(ROOT, adminPage), "utf8")
    assert.ok(
      src.includes("canReadLettersAdmin"),
      `${adminPage} must enforce canReadLettersAdmin`
    )
    assert.ok(
      src.includes('redirect("/no-access")'),
      `${adminPage} must redirect unauthorized bendahara to /no-access`
    )
    assert.ok(
      src.includes("<Suspense"),
      `${adminPage} must wrap auth & async searchParams/params inside Suspense`
    )
  }

  for (const residentPage of [
    "src/app/(resident)/resident/letters/page.tsx",
    "src/app/(resident)/resident/letters/new/page.tsx",
    "src/app/(resident)/resident/letters/[id]/page.tsx",
  ]) {
    const src = readFileSync(resolve(ROOT, residentPage), "utf8")
    assert.ok(
      src.includes("requireResidentContext"),
      `${residentPage} must enforce requireResidentContext`
    )
    assert.ok(
      src.includes("<Suspense"),
      `${residentPage} must wrap auth & async params/searchParams inside Suspense`
    )
  }

  const viewerSrc = readFileSync(
    resolve(ROOT, "src/components/letters/letter-document-viewer.tsx"),
    "utf8"
  )
  assert.ok(
    viewerSrc.includes("URL.revokeObjectURL"),
    "LetterDocumentViewer must revoke created object URLs on cleanup"
  )
  assert.ok(
    viewerSrc.includes("letter-documents-restricted"),
    "LetterDocumentViewer must show restricted fallback instead of fetching for pengurus"
  )

  const createFormSrc = readFileSync(
    resolve(ROOT, "src/components/letters/resident-letter-create-form.tsx"),
    "utf8"
  )
  assert.ok(
    createFormSrc.includes("URL.revokeObjectURL"),
    "ResidentLetterCreateForm must revoke queued image object URLs"
  )
  assert.ok(
    createFormSrc.includes("createdRequest"),
    "ResidentLetterCreateForm must reuse createdRequest on attachment retry to avoid duplicates"
  )

  const adminDetailSrc = readFileSync(
    resolve(ROOT, "src/components/letters/letters-admin-detail-view.tsx"),
    "utf8"
  )
  assert.ok(
    adminDetailSrc.includes("letter-purpose-restricted"),
    "LettersAdminDetailView must suppress purpose for pengurus"
  )

  const layananSrc = readFileSync(
    resolve(ROOT, "src/app/(resident)/resident/layanan/page.tsx"),
    "utf8"
  )
  assert.ok(layananSrc.includes("/resident/letters"))

  const dashboardSrc = readFileSync(
    resolve(ROOT, "src/components/resident/resident-dashboard-view.tsx"),
    "utf8"
  )
  assert.ok(dashboardSrc.includes("/resident/letters"))
  assert.ok(dashboardSrc.includes("/resident/letters/new"))
})
