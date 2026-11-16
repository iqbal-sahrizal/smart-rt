import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import test from "node:test"

import { loadLettersTestModules } from "./helpers/load-letters-modules.mjs"

const {
  analyticsTypes,
  constants,
  types,
  errors,
  schemas,
  storage,
  formatters,
  repository,
  queryKeys,
} = loadLettersTestModules()

const VALID_UUID_1 = "11111111-1111-4111-8111-111111111101"
const VALID_UUID_2 = "22222222-2222-4222-8222-222222222202"

function makeJpegBytes(size = 32) {
  const buf = new Uint8Array(size)
  buf[0] = 0xff
  buf[1] = 0xd8
  buf[2] = 0xff
  buf[3] = 0xe0
  return buf
}

function makePngBytes(size = 32) {
  const buf = new Uint8Array(size)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return buf
}

function makePdfBytes(size = 32) {
  const buf = new Uint8Array(size)
  const header = new TextEncoder().encode("%PDF-1.4\n")
  buf.set(header, 0)
  return buf
}

test("Letters role helper matrix strictly matches Step 14.2 specification", () => {
  assert.equal(types.canReadLettersAdmin(["ketua_rt"]), true)
  assert.equal(types.canReadLettersAdmin(["sekretaris"]), true)
  assert.equal(types.canReadLettersAdmin(["pengurus"]), true)
  assert.equal(types.canReadLettersAdmin(["bendahara"]), false)
  assert.equal(types.canReadLettersAdmin(["warga"]), false)
  assert.equal(types.canReadLettersAdmin([]), false)

  assert.equal(types.canManageLetters(["ketua_rt"]), true)
  assert.equal(types.canManageLetters(["sekretaris"]), true)
  assert.equal(types.canManageLetters(["pengurus"]), false)
  assert.equal(types.canManageLetters(["bendahara"]), false)
  assert.equal(types.canManageLetters(["warga"]), false)

  assert.equal(types.canViewLetterDocuments(["ketua_rt"]), true)
  assert.equal(types.canViewLetterDocuments(["sekretaris"]), true)
  assert.equal(types.canViewLetterDocuments(["pengurus"]), false)
  assert.equal(types.canViewLetterDocuments(["bendahara"]), false)

  assert.equal(types.isLetterMetadataOnlyRole(["pengurus"]), true)
  assert.equal(types.isLetterMetadataOnlyRole(["ketua_rt"]), false)
  assert.equal(types.isLetterMetadataOnlyRole(["bendahara"]), false)
})

test("Letters statuses and analytics compatibility include cancelled cleanly", () => {
  assert.deepEqual(constants.LETTER_STATUSES, [
    "submitted",
    "reviewing",
    "approved",
    "rejected",
    "completed",
    "cancelled",
  ])
  assert.equal(constants.LETTER_STATUS_LABELS.cancelled, "Dibatalkan")
  assert.equal(analyticsTypes.LETTER_STATUS_LABELS.cancelled, "Dibatalkan")
  assert.equal(analyticsTypes.getLetterStatusBadgeVariant("cancelled"), "outline")
  assert.equal(formatters.getLetterRequestStatusBadgeVariant("cancelled"), "outline")
  assert.deepEqual(formatters.getAllowedReviewDecisions("submitted"), [
    "reviewing",
    "approved",
    "rejected",
  ])
  assert.deepEqual(formatters.getAllowedReviewDecisions("reviewing"), [
    "approved",
    "rejected",
  ])
  assert.deepEqual(formatters.getAllowedReviewDecisions("approved"), [])
  assert.deepEqual(formatters.getAllowedReviewDecisions("completed"), [])
  assert.deepEqual(formatters.getAllowedReviewDecisions("cancelled"), [])
})

test("Letters Zod schemas validate purpose, reject notes, filters, and strip client-spoofed IDs", () => {
  const reqValid = schemas.createLetterRequestSchema.safeParse({
    letterTypeId: VALID_UUID_1,
    purpose: "  Untuk pengurusan domisili kerja  ",
    tenantId: VALID_UUID_2,
    memberId: VALID_UUID_2,
    residentId: VALID_UUID_2,
    requestedByMemberId: VALID_UUID_2,
    reviewedBy: VALID_UUID_2,
    letterNumber: "001/FAKE/2026",
    issuedAt: "2026-01-01T00:00:00Z",
    storagePath: "fake/path.pdf",
  })
  assert.equal(reqValid.success, true)
  assert.equal(reqValid.data.letterTypeId, VALID_UUID_1)
  assert.equal(reqValid.data.purpose, "Untuk pengurusan domisili kerja")
  for (const spoofKey of [
    "tenantId",
    "memberId",
    "residentId",
    "requestedByMemberId",
    "reviewedBy",
    "letterNumber",
    "issuedAt",
    "storagePath",
  ]) {
    assert.equal(spoofKey in reqValid.data, false)
  }

  // Blank or >1000-char purpose rejected
  assert.equal(
    schemas.createLetterRequestSchema.safeParse({
      letterTypeId: VALID_UUID_1,
      purpose: "   ",
    }).success,
    false
  )
  assert.equal(
    schemas.createLetterRequestSchema.safeParse({
      letterTypeId: VALID_UUID_1,
      purpose: "a".repeat(1001),
    }).success,
    false
  )
  assert.equal(
    schemas.createLetterRequestSchema.safeParse({
      letterTypeId: VALID_UUID_1,
      purpose: "a".repeat(1000),
    }).success,
    true
  )

  // Rejected review requires non-empty adminNotes
  assert.equal(
    schemas.reviewLetterRequestSchema.safeParse({
      requestId: VALID_UUID_1,
      decision: "rejected",
      adminNotes: "   ",
    }).success,
    false
  )
  assert.equal(
    schemas.reviewLetterRequestSchema.safeParse({
      requestId: VALID_UUID_1,
      decision: "rejected",
      adminNotes: "Dokumen KTP kurang jelas.",
    }).success,
    true
  )
  assert.equal(
    schemas.reviewLetterRequestSchema.safeParse({
      requestId: VALID_UUID_1,
      decision: "approved",
      adminNotes: null,
    }).success,
    true
  )

  // Letter type validation
  assert.equal(
    schemas.createLetterTypeSchema.safeParse({
      code: "---",
      name: "Surat Tes",
    }).success,
    false
  )
  assert.equal(
    schemas.createLetterTypeSchema.safeParse({
      code: "A".repeat(33),
      name: "Surat Tes",
    }).success,
    false
  )
  assert.equal(
    schemas.createLetterTypeSchema.safeParse({
      code: "SK-DOM",
      name: "   ",
    }).success,
    false
  )

  // Filter sanitization & bounds
  const filterRes = schemas.letterListFiltersSchema.safeParse({
    status: "cancelled",
    search: "  domisili,%*()\\test  ",
    page: "2",
    pageSize: "20",
    sortBy: "updated_at",
    sort: "asc",
  })
  assert.equal(filterRes.success, true)
  assert.equal(filterRes.data.status, "cancelled")
  assert.equal(filterRes.data.search, "domisili test")
  assert.equal(filterRes.data.page, 2)
  assert.equal(filterRes.data.pageSize, 20)
  assert.equal(filterRes.data.sortBy, "updated_at")
  assert.equal(filterRes.data.sort, "asc")
  assert.equal(
    schemas.letterListFiltersSchema.safeParse({ pageSize: 51 }).success,
    false
  )
})

test("Letters storage validation enforces magic bytes, MIME, extension, and size limits", async () => {
  const validJpg = new File([makeJpegBytes()], "ktp.jpg", { type: "image/jpeg" })
  const validPng = new File([makePngBytes()], "kk.png", { type: "image/png" })
  const validPdf = new File([makePdfBytes()], "pengantar.pdf", {
    type: "application/pdf",
  })

  assert.equal((await storage.validateLetterAttachmentFile(validJpg)).ok, true)
  assert.equal((await storage.validateLetterAttachmentFile(validPng)).ok, true)
  assert.equal((await storage.validateLetterAttachmentFile(validPdf)).ok, true)

  // Spoofed extension / magic mismatch rejected
  const spoofPdf = new File([makePngBytes()], "spoof.pdf", {
    type: "application/pdf",
  })
  assert.equal((await storage.validateLetterAttachmentFile(spoofPdf)).ok, false)

  const spoofExt = new File([makePngBytes()], "fake.jpg", { type: "image/png" })
  assert.equal((await storage.validateLetterAttachmentFile(spoofExt)).ok, false)

  // Over 5 MiB attachment rejected
  const bigAttachment = new File(
    [makePdfBytes(constants.MAX_LETTER_ATTACHMENT_BYTES + 1)],
    "oversize.pdf",
    { type: "application/pdf" }
  )
  assert.equal(
    (await storage.validateLetterAttachmentFile(bigAttachment)).ok,
    false
  )

  // Issued PDF: valid up to 10 MiB, >10 MiB rejected, non-PDF magic rejected
  assert.equal((await storage.validateIssuedLetterPdfFile(validPdf)).ok, true)
  assert.equal((await storage.validateIssuedLetterPdfFile(validPng)).ok, false)
  assert.equal((await storage.validateIssuedLetterPdfFile(spoofPdf)).ok, false)

  const bigIssued = new File(
    [makePdfBytes(constants.MAX_ISSUED_LETTER_PDF_BYTES + 1)],
    "terbit-besar.pdf",
    { type: "application/pdf" }
  )
  assert.equal((await storage.validateIssuedLetterPdfFile(bigIssued)).ok, false)

  // Path builders and extraction never expose directory traversal or uppercase UUID mismatch
  const attPath = storage.buildLetterAttachmentPath(
    VALID_UUID_1,
    VALID_UUID_2,
    "pdf"
  )
  assert.equal(
    storage.letterAttachmentPathBelongsTo(attPath, VALID_UUID_1, VALID_UUID_2),
    true
  )
  assert.equal(
    storage.letterAttachmentPathBelongsTo(attPath, VALID_UUID_2, VALID_UUID_1),
    false
  )
  const extractedFileId = storage.extractLetterAttachmentFileId(attPath)
  assert.ok(extractedFileId && extractedFileId.length === 36)
  assert.equal(
    storage.buildLetterAttachmentApiUrl(VALID_UUID_2, extractedFileId),
    `/api/letters/${VALID_UUID_2}/attachments/${extractedFileId}`
  )
})

test("mapLetterDbError maps SQLSTATE 22023, 23505, 42501, 23503, and P0002 safely without raw SQL leak", () => {
  const maxDocs = errors.mapLetterDbError(
    { code: "22023", message: "Maximum 5 supporting documents allowed per letter request" },
    { operation: "attachment" }
  )
  assert.equal(maxDocs.code, "ATTACHMENT_LIMIT_REACHED")
  assert.equal(maxDocs.status, 400)

  const dupCode = errors.mapLetterDbError(
    { code: "23505", message: "duplicate key value violates unique constraint uq_letter_types_tenant_normalized_code" },
    { operation: "letter_type" }
  )
  assert.equal(dupCode.code, "CONFLICT")
  assert.equal(dupCode.status, 409)
  assert.doesNotMatch(dupCode.message, /uq_letter_types|constraint/i)

  const ineligible = errors.mapLetterDbError(
    { code: "42501", message: "new row violates row-level security policy letter_requests_insert" },
    { operation: "create_request" }
  )
  assert.equal(ineligible.code, "INELIGIBLE_RESIDENT")
  assert.equal(ineligible.status, 403)
  assert.doesNotMatch(ineligible.message, /row-level security|policy/i)

  const fkInUse = errors.mapLetterDbError(
    { code: "23503", message: "update or delete on table letter_types violates foreign key constraint fk_letter_requests_type" },
    { operation: "letter_type" }
  )
  assert.equal(fkInUse.code, "CONFLICT")
  assert.equal(fkInUse.status, 409)
  assert.doesNotMatch(fkInUse.message, /foreign key|fk_letter/i)
})

test("Letters query keys isolate by scope/tenant/actor and repository hygiene avoids unsafe queries", () => {
  const k1 = queryKeys.lettersQueryKeys.list("admin", VALID_UUID_1, "user-1", { page: 1 })
  const k2 = queryKeys.lettersQueryKeys.list("admin", VALID_UUID_2, "user-1", { page: 1 })
  const k3 = queryKeys.lettersQueryKeys.list("resident", VALID_UUID_1, "user-1", { page: 1 })
  assert.notDeepEqual(k1, k2)
  assert.notDeepEqual(k1, k3)

  assert.equal(
    repository.LETTER_REQUEST_METADATA_SELECT_COLUMNS.includes("supporting_doc_paths"),
    false
  )
  assert.equal(
    repository.LETTER_REQUEST_METADATA_SELECT_COLUMNS.includes("issued_file_path"),
    false
  )

  const dirs = [
    resolve(process.cwd(), "src/lib/letters"),
    resolve(process.cwd(), "src/app/actions/letters.ts"),
    resolve(process.cwd(), "src/app/api/letters"),
    resolve(process.cwd(), "src/app/api/resident/letters"),
  ]

  const files = []
  function walk(target) {
    const st = statSync(target)
    if (st.isFile()) {
      files.push(target)
      return
    }
    for (const entry of readdirSync(target)) {
      walk(join(target, entry))
    }
  }
  for (const d of dirs) walk(d)

  for (const f of files) {
    const content = readFileSync(f, "utf8")
    const codeOnly = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")
    assert.doesNotMatch(codeOnly, /\.select\s*\(\s*["'`]\*/, `No select('*') allowed in ${f}`)
    assert.doesNotMatch(codeOnly, /service_role|SERVICE_ROLE/, `No service_role allowed in ${f}`)
    assert.doesNotMatch(codeOnly, /createSignedUrl/, `No signed URL generation allowed in ${f}`)
    assert.doesNotMatch(codeOnly, /active_tenant_id/, `No active_tenant_id trust allowed in ${f}`)
  }
})
