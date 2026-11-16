import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import test from "node:test"

import { loadActivitiesTestModules } from "./helpers/load-activities-modules.mjs"

const {
  constants,
  types,
  errors,
  schemas,
  storage,
  formatters,
  repository,
  queryKeys,
} = loadActivitiesTestModules()

const VALID_UUID_1 = "11111111-1111-4111-8111-111111111101"
const VALID_UUID_2 = "22222222-2222-4222-8222-222222222202"
const VALID_UUID_3 = "33333333-3333-4333-8333-333333333303"

function makeJpegBytes(size = 32) {
  const buf = new Uint8Array(size)
  buf.set([0xff, 0xd8, 0xff, 0xe0], 0)
  return buf
}

function makePngBytes(size = 32) {
  const buf = new Uint8Array(size)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return buf
}

function makeWebpBytes(size = 32) {
  const buf = new Uint8Array(size)
  buf.set([0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], 0)
  return buf
}

function makePdfBytes(size = 32) {
  const buf = new Uint8Array(size)
  buf.set(new TextEncoder().encode("%PDF-1.4\n"), 0)
  return buf
}

test("Activities role permission matrix strictly matches Step 15.1/15.2 specification", () => {
  assert.equal(types.canReadActivitiesAdmin(["ketua_rt"]), true)
  assert.equal(types.canReadActivitiesAdmin(["sekretaris"]), true)
  assert.equal(types.canReadActivitiesAdmin(["pengurus"]), true)
  assert.equal(types.canReadActivitiesAdmin(["bendahara"]), false)
  assert.equal(types.canReadActivitiesAdmin(["warga"]), false)
  assert.equal(types.canReadActivitiesAdmin([]), false)

  assert.equal(types.canManageActivities(["ketua_rt"]), true)
  assert.equal(types.canManageActivities(["sekretaris"]), true)
  assert.equal(types.canManageActivities(["pengurus"]), false)
  assert.equal(types.canManageActivities(["bendahara"]), false)
  assert.equal(types.canManageActivities(["warga"]), false)

  assert.equal(types.canOperateActivities(["ketua_rt"]), true)
  assert.equal(types.canOperateActivities(["sekretaris"]), true)
  assert.equal(types.canOperateActivities(["pengurus"]), true)
  assert.equal(types.canOperateActivities(["bendahara"]), false)
  assert.equal(types.canOperateActivities(["warga"]), false)

  assert.equal(types.canTransitionActivityStatus(["pengurus"], "ongoing"), true)
  assert.equal(types.canTransitionActivityStatus(["pengurus"], "completed"), true)
  assert.equal(types.canTransitionActivityStatus(["pengurus"], "cancelled"), false)
  assert.equal(types.canTransitionActivityStatus(["ketua_rt"], "cancelled"), true)
  assert.equal(types.canTransitionActivityStatus(["sekretaris"], "cancelled"), true)
  assert.equal(types.canTransitionActivityStatus(["bendahara"], "ongoing"), false)

  assert.equal(types.canUploadActivityDoc(["pengurus"]), true)
  assert.equal(types.canUploadActivityDoc(["bendahara"]), false)
  assert.equal(types.canRemoveActivityDoc(["pengurus"]), false)
  assert.equal(types.canRemoveActivityDoc(["ketua_rt"]), true)
  assert.equal(types.canRemoveActivityDoc(["sekretaris"]), true)
})

test("Activities Zod schemas enforce date ranges, categories, pagination bounds, and strip client tenant/resident IDs", () => {
  const startIso = "2026-12-01T08:00:00.000Z"
  const endIso = "2026-12-01T11:00:00.000Z"
  const deadlineIso = "2026-12-01T09:00:00.000Z"

  const validCreate = schemas.createActivitySchema.safeParse({
    title: "  Kerja Bakti Blok A  ",
    location: "  Lapangan RT 01  ",
    startAt: startIso,
    endAt: endIso,
    registrationDeadline: deadlineIso,
    category: "kerja_bakti",
    maxParticipants: 25,
    tenantId: VALID_UUID_2,
    residentId: VALID_UUID_3,
  })
  assert.equal(validCreate.success, true)
  assert.equal(validCreate.data.title, "Kerja Bakti Blok A")
  assert.equal(validCreate.data.location, "Lapangan RT 01")
  assert.equal("tenantId" in validCreate.data, false)
  assert.equal("residentId" in validCreate.data, false)

  const badEnd = schemas.createActivitySchema.safeParse({
    title: "Kerja Bakti",
    location: "Lapangan",
    startAt: endIso,
    endAt: startIso,
  })
  assert.equal(badEnd.success, false)

  const badDeadline = schemas.createActivitySchema.safeParse({
    title: "Kerja Bakti",
    location: "Lapangan",
    startAt: startIso,
    endAt: endIso,
    registrationDeadline: "2026-12-01T12:00:00.000Z",
  })
  assert.equal(badDeadline.success, false)

  const badMax = schemas.createActivitySchema.safeParse({
    title: "Kerja Bakti",
    location: "Lapangan",
    startAt: startIso,
    maxParticipants: 0,
  })
  assert.equal(badMax.success, false)

  const badFilter = schemas.activityListFiltersSchema.safeParse({
    pageSize: 999,
  })
  assert.equal(badFilter.success, false)

  const validFilter = schemas.activityListFiltersSchema.safeParse({
    status: "scheduled",
    category: "rapat",
    upcomingOnly: "true",
    page: "2",
    pageSize: "20",
  })
  assert.equal(validFilter.success, true)
  assert.equal(validFilter.data.upcomingOnly, true)
  assert.equal(validFilter.data.page, 2)
  assert.equal(validFilter.data.pageSize, 20)
})

test("Activities storage validates magic bytes (JPEG, PNG, WebP, PDF), rejects spoofing, and builds proxy URLs without raw storage paths", async () => {
  for (const [ext, mime, bytes] of [
    ["jpg", "image/jpeg", makeJpegBytes()],
    ["png", "image/png", makePngBytes()],
    ["webp", "image/webp", makeWebpBytes()],
    ["pdf", "application/pdf", makePdfBytes()],
  ]) {
    const file = new File([bytes], `doc.${ext}`, { type: mime })
    const res = await storage.validateActivityDocFile(file)
    assert.equal(res.ok, true, `${ext} must validate`)
    assert.equal(res.file.mimeType, mime)
  }

  // Spoofed PDF header declared as image/png must fail
  const spoofedFile = new File([makePdfBytes()], "fake.png", {
    type: "image/png",
  })
  const spoofedRes = await storage.validateActivityDocFile(spoofedFile)
  assert.equal(spoofedRes.ok, false)

  // Oversize (> 10 MiB) rejected
  const oversizeFile = new File(
    [new Uint8Array(constants.MAX_ACTIVITY_DOC_BYTES + 1)],
    "huge.pdf",
    { type: "application/pdf" }
  )
  const oversizeRes = await storage.validateActivityDocFile(oversizeFile)
  assert.equal(oversizeRes.ok, false)

  // Path & proxy URL construction
  const builtPath = storage.buildActivityDocPath(VALID_UUID_1, VALID_UUID_2, "webp")
  assert.equal(storage.isValidActivityDocPath(builtPath), true)
  assert.equal(
    storage.activityDocPathBelongsTo(builtPath, VALID_UUID_1, VALID_UUID_2),
    true
  )
  assert.equal(
    storage.activityDocPathBelongsTo(builtPath, VALID_UUID_3, VALID_UUID_2),
    false
  )
  const fileId = storage.extractActivityDocFileId(builtPath)
  assert.ok(fileId)

  const viewUrl = storage.buildActivityDocApiUrl(VALID_UUID_2, fileId, false)
  const downloadUrl = storage.buildActivityDocApiUrl(VALID_UUID_2, fileId, true)
  assert.equal(
    viewUrl,
    `/api/activities/${VALID_UUID_2}/documents/${fileId}`
  )
  assert.equal(
    downloadUrl,
    `/api/activities/${VALID_UUID_2}/documents/${fileId}?download=1`
  )
  assert.equal(viewUrl.includes("activity-docs"), false)
  assert.equal(viewUrl.includes(VALID_UUID_1), false)
})

test("mapActivityDbError translates SQLSTATE codes into safe error codes without leaking SQL details", () => {
  const cases = [
    [
      { code: "42501", message: "Unauthenticated" },
      undefined,
      401,
      "UNAUTHORIZED",
    ],
    [
      {
        code: "42501",
        message: "Forbidden: resident or household is inactive or unlinked",
      },
      { operation: "register" },
      403,
      "INELIGIBLE_RESIDENT",
    ],
    [
      { code: "42501", message: "Forbidden: requires ketua_rt role" },
      undefined,
      403,
      "FORBIDDEN",
    ],
    [
      { code: "P0002", message: "Activity 123 not found or deleted" },
      undefined,
      404,
      "NOT_FOUND",
    ],
    [
      { code: "23505", message: "Already registered for this activity" },
      { operation: "register" },
      409,
      "DUPLICATE_REGISTRATION",
    ],
    [
      {
        code: "23514",
        message: "Activity participant capacity reached (1 / 1)",
      },
      { operation: "register" },
      409,
      "CAPACITY_FULL",
    ],
    [
      { code: "22023", message: "Activity registration deadline has passed" },
      { operation: "register" },
      400,
      "DEADLINE_PASSED",
    ],
    [
      { code: "22023", message: "Self-registration is closed for this activity" },
      { operation: "register" },
      400,
      "REGISTRATION_CLOSED",
    ],
    [
      { code: "22023", message: "Invalid activity transition completed -> ongoing" },
      { operation: "transition" },
      400,
      "INVALID_STATE",
    ],
    [
      { code: "23503", message: "Resident abc is inactive or deleted" },
      { operation: "add_participant" },
      400,
      "INELIGIBLE_RESIDENT",
    ],
    [
      { code: "23514", message: "Activity documentation limit (20 objects) exceeded" },
      { operation: "attach_doc" },
      400,
      "DOCUMENT_LIMIT_REACHED",
    ],
    [
      { code: "55P03", message: "canceling statement due to lock timeout" },
      undefined,
      409,
      "LOCK_TIMEOUT",
    ],
  ]

  for (const [dbErr, ctx, expectedStatus, expectedCode] of cases) {
    const mapped = errors.mapActivityDbError(dbErr, ctx)
    assert.equal(mapped.status, expectedStatus)
    assert.equal(mapped.code, expectedCode)
    assert.equal(mapped.message.includes("SELECT"), false)
    assert.equal(mapped.message.includes("pg_"), false)
  }
})

test("Activities query keys isolate workspaces/users cleanly and formatters clarify roster removal semantics", () => {
  const kAdmin1 = queryKeys.activitiesQueryKeys.list("admin", VALID_UUID_1, "user-a", { page: 1 })
  const kAdmin2 = queryKeys.activitiesQueryKeys.list("admin", VALID_UUID_2, "user-a", { page: 1 })
  const kRes1 = queryKeys.activitiesQueryKeys.list("resident", VALID_UUID_1, "user-a", { page: 1 })
  const kResB = queryKeys.activitiesQueryKeys.list("resident", VALID_UUID_1, "user-b", { page: 1 })

  assert.notDeepEqual(kAdmin1, kAdmin2)
  assert.notDeepEqual(kAdmin1, kRes1)
  assert.notDeepEqual(kRes1, kResB)

  const inv = queryKeys.getActivityMutationInvalidationKeys({
    tenantId: VALID_UUID_1,
    activityId: VALID_UUID_2,
  })
  assert.deepEqual(inv, [
    ["activities", "admin", VALID_UUID_1],
    ["activities", "resident", VALID_UUID_1],
    ["analytics", "admin", VALID_UUID_1],
    ["analytics", "resident", VALID_UUID_1],
  ])

  assert.match(formatters.ACTIVITY_ROSTER_REMOVAL_SEMANTICS_NOTE, /menghapus.*daftar peserta aktif/i)
  assert.equal(
    formatters.formatActivityQuotaSummary(3, 10),
    "3 / 10 kuota terisi (7 tersisa)"
  )
})

function collectTsFiles(dirPath) {
  const results = []
  for (const entry of readdirSync(dirPath)) {
    const full = join(dirPath, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      results.push(...collectTsFiles(full))
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      results.push(full)
    }
  }
  return results
}

test("Activities module has zero select('*'), direct DML, service_role, or signed/public Storage URLs", () => {
  const root = process.cwd()
  const files = [
    ...collectTsFiles(resolve(root, "src/lib/activities")),
    resolve(root, "src/app/actions/activities.ts"),
    ...collectTsFiles(resolve(root, "src/app/api/activities")),
    ...collectTsFiles(resolve(root, "src/app/api/resident/activities")),
  ]

  assert.equal(repository.ACTIVITY_SELECT_COLUMNS.includes("*"), false)
  assert.equal(
    repository.ACTIVITY_PARTICIPANT_SELECT_COLUMNS.includes("*"),
    false
  )

  for (const filePath of files) {
    const content = readFileSync(filePath, "utf8")
    assert.equal(
      /\.select\(\s*["'`]\s*\*/.test(content),
      false,
      `select('*') forbidden in ${filePath}`
    )
    assert.equal(
      /service_role|createAdminClient|SUPABASE_SERVICE_ROLE_KEY/i.test(content),
      false,
      `service_role usage forbidden in ${filePath}`
    )
    assert.equal(
      /\.from\(\s*["'`](?:activities|activity_participants)["'`]\s*\)[\s\S]{0,120}\.(insert|update|delete|upsert)\(/.test(
        content
      ),
      false,
      `Direct DML on activities/activity_participants forbidden in ${filePath}`
    )
    assert.equal(
      /createSignedUrl|getPublicUrl/.test(content),
      false,
      `Public or signed Storage URL forbidden in ${filePath}`
    )
  }
})
