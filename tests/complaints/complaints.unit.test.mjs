import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

import { loadComplaintsTestModules } from "./helpers/load-complaints-modules.mjs"

const { constants, types, schemas, storage, repository, queryKeys } =
  loadComplaintsTestModules()

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

function makeWebpBytes(size = 32) {
  const buf = new Uint8Array(size)
  buf.set([0x52, 0x49, 0x46, 0x46], 0) // RIFF
  buf.set([0x57, 0x45, 0x42, 0x50], 8) // WEBP
  return buf
}

test("Complaints role permission helpers match exact Step 13.2 authorization matrix", () => {
  assert.equal(types.canReadComplaintsAdmin(["ketua_rt"]), true)
  assert.equal(types.canReadComplaintsAdmin(["sekretaris"]), true)
  assert.equal(types.canReadComplaintsAdmin(["pengurus"]), true)
  assert.equal(types.canReadComplaintsAdmin(["bendahara"]), true)
  assert.equal(types.canReadComplaintsAdmin(["warga"]), false)
  assert.equal(types.canReadComplaintsAdmin([]), false)

  assert.equal(types.canManageComplaints(["ketua_rt"]), true)
  assert.equal(types.canManageComplaints(["sekretaris"]), true)
  assert.equal(types.canManageComplaints(["pengurus"]), true)
  assert.equal(types.canManageComplaints(["bendahara"]), false)
  assert.equal(types.canManageComplaints(["warga"]), false)

  assert.equal(types.canViewComplaintPhotos(["ketua_rt"]), true)
  assert.equal(types.canViewComplaintPhotos(["sekretaris"]), true)
  assert.equal(types.canViewComplaintPhotos(["pengurus"]), true)
  assert.equal(types.canViewComplaintPhotos(["bendahara"]), false)

  assert.equal(types.isComplaintMetadataOnlyRole(["bendahara"]), true)
  assert.equal(types.isComplaintMetadataOnlyRole(["ketua_rt"]), false)
  assert.equal(types.isComplaintMetadataOnlyRole(["bendahara", "pengurus"]), false)
})

test("Complaints schemas validate inputs cleanly and strip client-spoofed fields", () => {
  assert.deepEqual(constants.COMPLAINT_CATEGORIES, [
    "Fasilitas",
    "Kebersihan",
    "Keamanan",
  ])

  const created = schemas.createComplaintSchema.parse({
    category: "Fasilitas",
    title: "  Lampu Jalan Padam  ",
    description: "Lampu penerangan di depan pos ronda mati sejak kemarin.",
    tenant_id: "spoof",
    reporter_member_id: "spoof",
    priority: "high",
    status: "resolved",
    photo_path: "spoof.jpg",
  })
  assert.deepEqual(created, {
    category: "Fasilitas",
    title: "Lampu Jalan Padam",
    description: "Lampu penerangan di depan pos ronda mati sejak kemarin.",
  })

  assert.equal(
    schemas.createComplaintSchema.safeParse({
      category: "Lainnya",
      title: "Judul valid",
      description: "Deskripsi minimal sepuluh karakter.",
    }).success,
    false
  )

  assert.equal(
    schemas.createComplaintSchema.safeParse({
      category: "Kebersihan",
      title: "Pend",
      description: "Pendek",
    }).success,
    false
  )

  const transitionOk = schemas.transitionComplaintStatusSchema.safeParse({
    complaintId: "11111111-1111-4111-8111-111111111111",
    newStatus: "in_progress",
    reason: "  Sedang ditangani  ",
  })
  assert.equal(transitionOk.success, true)
  assert.equal(transitionOk.data.reason, "Sedang ditangani")

  // Reopen to open is forbidden
  assert.equal(
    schemas.transitionComplaintStatusSchema.safeParse({
      complaintId: "11111111-1111-4111-8111-111111111111",
      newStatus: "open",
    }).success,
    false
  )

  assert.equal(
    schemas.softDeleteComplaintSchema.safeParse({
      complaintId: "11111111-1111-4111-8111-111111111111",
      reason: "ab",
    }).success,
    false
  )

  assert.equal(
    schemas.sanitizeComplaintSearchTerm("jalan, rusak(%)*_\\ test"),
    "jalan rusak test"
  )
})

test("Complaints photo validation verifies magic bytes, MIME, extension, size, and storage path", async () => {
  const validJpeg = new File([makeJpegBytes()], "bukti.jpg", {
    type: "image/jpeg",
  })
  const jpegRes = await storage.validateComplaintPhotoFile(validJpeg)
  assert.equal(jpegRes.ok, true)
  assert.equal(jpegRes.file.mimeType, "image/jpeg")
  assert.equal(jpegRes.file.extension, "jpg")

  const validPng = new File([makePngBytes()], "bukti.png", {
    type: "image/png",
  })
  const pngRes = await storage.validateComplaintPhotoFile(validPng)
  assert.equal(pngRes.ok, true)
  assert.equal(pngRes.file.mimeType, "image/png")
  assert.equal(pngRes.file.extension, "png")

  const validWebp = new File([makeWebpBytes()], "bukti.webp", {
    type: "image/webp",
  })
  const webpRes = await storage.validateComplaintPhotoFile(validWebp)
  assert.equal(webpRes.ok, true)
  assert.equal(webpRes.file.mimeType, "image/webp")
  assert.equal(webpRes.file.extension, "webp")

  // Reject oversized file > 5 MiB
  const oversized = new File(
    [makeJpegBytes(constants.MAX_COMPLAINT_PHOTO_BYTES + 1)],
    "besar.jpg",
    { type: "image/jpeg" }
  )
  assert.equal((await storage.validateComplaintPhotoFile(oversized)).ok, false)

  // Reject invalid MIME
  const invalidMime = new File([makePngBytes()], "doc.pdf", {
    type: "application/pdf",
  })
  assert.equal((await storage.validateComplaintPhotoFile(invalidMime)).ok, false)

  // Reject mismatched magic bytes vs MIME
  const spoofedMime = new File([makeJpegBytes()], "fake.png", {
    type: "image/png",
  })
  assert.equal((await storage.validateComplaintPhotoFile(spoofedMime)).ok, false)

  // Reject mismatched extension
  const badExt = new File([makeJpegBytes()], "foto.png", {
    type: "image/jpeg",
  })
  assert.equal((await storage.validateComplaintPhotoFile(badExt)).ok, false)

  // Reject forged magic bytes
  const badBytes = new File(
    [new TextEncoder().encode("not an image payload")],
    "forged.jpg",
    { type: "image/jpeg" }
  )
  assert.equal((await storage.validateComplaintPhotoFile(badBytes)).ok, false)

  // Path builder & tenant/complaint ownership matcher
  const t1 = "11111111-1111-4111-8111-111111111111"
  const c1 = "22222222-2222-4222-8222-222222222222"
  const c2 = "33333333-3333-4333-8333-333333333333"
  const built = storage.buildComplaintPhotoPath(t1, c1, "webp")
  assert.equal(storage.isValidComplaintPhotoPath(built), true)
  assert.equal(storage.complaintPhotoPathBelongsTo(built, t1, c1), true)
  assert.equal(storage.complaintPhotoPathBelongsTo(built, t1, c2), false)
})

test("Complaints query keys & error mapping enforce isolation and zero SQL leakage", () => {
  const t1 = "11111111-1111-4111-8111-111111111111"
  const t2 = "22222222-2222-4222-8222-222222222222"
  assert.notDeepEqual(
    queryKeys.complaintsQueryKeys.list("admin", t1, "u1"),
    queryKeys.complaintsQueryKeys.list("admin", t2, "u1")
  )
  assert.notDeepEqual(
    queryKeys.complaintsQueryKeys.list("admin", t1, "u1"),
    queryKeys.complaintsQueryKeys.list("resident", t1, "u1")
  )
  assert.notDeepEqual(
    queryKeys.complaintsQueryKeys.list("admin", t1, "ketua"),
    queryKeys.complaintsQueryKeys.list("admin", t1, "bendahara")
  )

  const repoText = readFileSync(
    resolve(process.cwd(), "src/lib/complaints/repository.ts"),
    "utf8"
  )
  assert.ok(!repoText.includes(".select(\"*\")"))
  assert.ok(!repoText.includes(".select('*')"))
  assert.ok(!repository.COMPLAINT_METADATA_SELECT_COLUMNS.includes("photo_path"))

  const err42501 = repository.mapComplaintDbError({
    code: "42501",
    message: "permission denied for table complaints",
  })
  assert.equal(err42501.status, 403)
  assert.ok(!err42501.message.includes("table complaints"))
})
