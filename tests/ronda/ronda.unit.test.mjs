import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

import { loadRondaTestModules } from "./helpers/load-ronda-modules.mjs"

const { types, schemas, repository, queryKeys } = loadRondaTestModules()

const VALID_UUID_1 = "11111111-1111-4111-8111-111111111101"
const VALID_UUID_2 = "22222222-2222-4222-8222-222222222202"
const VALID_UUID_3 = "33333333-3333-4333-8333-333333333303"

test("upsertRondaScheduleSchema accepts valid schedule including overnight shift and strips spoofed snapshot/tenant fields", () => {
  const parsed = schemas.upsertRondaScheduleSchema.safeParse({
    scheduleDate: "2026-12-20",
    shiftLabel: "  Ronda Malam  ",
    startTime: "22:00",
    endTime: "04:00",
    meetingPoint: " Pos Kamling 01 ",
    notes: " Bawa senter ",
    residentIds: [VALID_UUID_1, VALID_UUID_2],
    // Untrusted extra fields should not appear in parsed output
    tenantId: VALID_UUID_3,
    residentNameSnapshot: "Fake Snapshot",
    householdLabelSnapshot: "Fake Block",
  })

  assert.equal(parsed.success, true)
  assert.equal(parsed.data.scheduleId, null)
  assert.equal(parsed.data.scheduleDate, "2026-12-20")
  assert.equal(parsed.data.shiftLabel, "Ronda Malam")
  assert.equal(parsed.data.startTime, "22:00:00")
  assert.equal(parsed.data.endTime, "04:00:00")
  assert.equal(parsed.data.meetingPoint, "Pos Kamling 01")
  assert.equal(parsed.data.notes, "Bawa senter")
  assert.deepEqual(parsed.data.residentIds, [VALID_UUID_1, VALID_UUID_2])
  assert.equal("tenantId" in parsed.data, false)
  assert.equal("residentNameSnapshot" in parsed.data, false)
  assert.equal("householdLabelSnapshot" in parsed.data, false)
})

test("upsertRondaScheduleSchema rejects invalid calendar dates, equal start/end times, duplicates, empty residents, and oversized text", () => {
  assert.equal(
    schemas.upsertRondaScheduleSchema.safeParse({
      scheduleDate: "2026-02-30",
      residentIds: [VALID_UUID_1],
    }).success,
    false
  )

  assert.equal(
    schemas.upsertRondaScheduleSchema.safeParse({
      scheduleDate: "2026-12-20",
      startTime: "22:00",
      endTime: "22:00:00",
      residentIds: [VALID_UUID_1],
    }).success,
    false
  )

  assert.equal(
    schemas.upsertRondaScheduleSchema.safeParse({
      scheduleDate: "2026-12-20",
      residentIds: [VALID_UUID_1, VALID_UUID_1.toUpperCase()],
    }).success,
    false
  )

  assert.equal(
    schemas.upsertRondaScheduleSchema.safeParse({
      scheduleDate: "2026-12-20",
      residentIds: [],
    }).success,
    false
  )

  assert.equal(
    schemas.upsertRondaScheduleSchema.safeParse({
      scheduleDate: "2026-12-20",
      shiftLabel: "a".repeat(101),
      residentIds: [VALID_UUID_1],
    }).success,
    false
  )

  assert.equal(
    schemas.upsertRondaScheduleSchema.safeParse({
      scheduleDate: "2026-12-20",
      meetingPoint: "a".repeat(201),
      residentIds: [VALID_UUID_1],
    }).success,
    false
  )

  assert.equal(
    schemas.upsertRondaScheduleSchema.safeParse({
      scheduleDate: "2026-12-20",
      notes: "a".repeat(1001),
      residentIds: [VALID_UUID_1],
    }).success,
    false
  )
})

test("recordRondaAttendanceSchema validates statuses, notes max length, and clears cleanly on null", () => {
  const present = schemas.recordRondaAttendanceSchema.safeParse({
    assignmentId: VALID_UUID_1,
    attendanceStatus: "present",
    attendanceNotes: " Hadir tepat waktu ",
  })
  assert.equal(present.success, true)
  assert.equal(present.data.attendanceStatus, "present")
  assert.equal(present.data.attendanceNotes, "Hadir tepat waktu")

  const reset = schemas.recordRondaAttendanceSchema.safeParse({
    assignmentId: VALID_UUID_1,
    attendanceStatus: "",
    attendanceNotes: "   ",
  })
  assert.equal(reset.success, true)
  assert.equal(reset.data.attendanceStatus, null)
  assert.equal(reset.data.attendanceNotes, null)

  assert.equal(
    schemas.recordRondaAttendanceSchema.safeParse({
      assignmentId: VALID_UUID_1,
      attendanceStatus: null,
      attendanceNotes: "Catatan tanpa status",
    }).success,
    false
  )

  assert.equal(
    schemas.recordRondaAttendanceSchema.safeParse({
      assignmentId: VALID_UUID_1,
      attendanceStatus: "late",
      attendanceNotes: null,
    }).success,
    false
  )

  assert.equal(
    schemas.recordRondaAttendanceSchema.safeParse({
      assignmentId: VALID_UUID_1,
      attendanceStatus: "excused",
      attendanceNotes: "x".repeat(301),
    }).success,
    false
  )
})

test("rondaScheduleFiltersSchema validates date ordering and pagination", () => {
  const valid = schemas.rondaScheduleFiltersSchema.safeParse({
    fromDate: "2026-12-01",
    toDate: "2026-12-31",
    page: "2",
    pageSize: "15",
    sort: "asc",
  })
  assert.equal(valid.success, true)
  assert.equal(valid.data.page, 2)
  assert.equal(valid.data.pageSize, 15)
  assert.equal(valid.data.sort, "asc")

  assert.equal(
    schemas.rondaScheduleFiltersSchema.safeParse({
      fromDate: "2026-12-31",
      toDate: "2026-12-01",
    }).success,
    false
  )

  assert.equal(
    schemas.rondaScheduleFiltersSchema.safeParse({
      pageSize: "51",
    }).success,
    false
  )
})

test("role permission helpers enforce exact ronda authorization matrix", () => {
  assert.equal(types.canManageRonda(["ketua_rt"]), true)
  assert.equal(types.canManageRonda(["sekretaris"]), true)
  assert.equal(types.canManageRonda(["bendahara"]), false)
  assert.equal(types.canManageRonda(["pengurus"]), false)
  assert.equal(types.canManageRonda(["warga"]), false)
  assert.equal(types.canManageRonda([]), false)

  assert.equal(types.canReadAllRondaAttendance(["ketua_rt"]), true)
  assert.equal(types.canReadAllRondaAttendance(["sekretaris"]), true)
  assert.equal(types.canReadAllRondaAttendance(["bendahara"]), false)
  assert.equal(types.canReadAllRondaAttendance(["pengurus"]), false)
  assert.equal(types.canReadAllRondaAttendance(["warga"]), false)
})

test("mapRondaRpcError maps DB error codes to safe HTTP errors without exposing raw details", () => {
  const forbidden = repository.mapRondaRpcError({
    code: "42501",
    message: "raw postgres stack secret_table_name",
  })
  assert.equal(forbidden.status, 403)
  assert.equal(forbidden.message.includes("secret_table_name"), false)

  const conflictDate = repository.mapRondaRpcError({
    code: "23505",
    message: 'duplicate key value violates unique constraint "uq_ronda_schedules_tenant_date"',
  })
  assert.equal(conflictDate.status, 409)

  const notFound = repository.mapRondaRpcError({
    code: "P0002",
    message: "Jadwal ronda tidak ditemukan",
  })
  assert.equal(notFound.status, 404)

  const fk = repository.mapRondaRpcError({
    code: "23503",
    message: "Sebagian warga tidak ditemukan",
  })
  assert.equal(fk.status, 400)

  const internal = repository.mapRondaRpcError({
    code: "XX000",
    message: "internal pg detail should never leak",
  })
  assert.equal(internal.status, 500)
  assert.equal(internal.message.includes("should never leak"), false)
})

test("roster query column constant and repository code never select attendance_* or * from ronda_assignments", () => {
  const cols = repository.RONDA_ASSIGNMENT_ROSTER_COLUMNS
  assert.equal(cols.includes("*"), false)
  assert.equal(cols.includes("attendance_status"), false)
  assert.equal(cols.includes("attendance_notes"), false)
  assert.equal(cols.includes("attendance_recorded_by"), false)
  assert.equal(cols.includes("attendance_recorded_at"), false)

  const repoSource = readFileSync(
    resolve(process.cwd(), "src/lib/ronda/repository.ts"),
    "utf8"
  )
  const directAssignSelects = repoSource.match(
    /\.from\("ronda_assignments"\)\s*\.select\(([^)]+)\)/g
  )
  assert.ok(directAssignSelects && directAssignSelects.length >= 3)
  for (const call of directAssignSelects) {
    assert.equal(call.includes("*"), false, `Forbidden wildcard select: ${call}`)
    assert.equal(
      call.includes("attendance_"),
      false,
      `Forbidden attendance select: ${call}`
    )
  }
})

test("rondaQueryKeys and invalidation targets isolate by tenant/scope and cover list, detail, and attendance", () => {
  const t1List = queryKeys.rondaQueryKeys.list("admin", VALID_UUID_1, { page: 1 })
  const t2List = queryKeys.rondaQueryKeys.list("admin", VALID_UUID_2, { page: 1 })
  assert.notDeepEqual(t1List, t2List)

  const residentList = queryKeys.rondaQueryKeys.list("resident", VALID_UUID_1, {
    page: 1,
  })
  assert.notDeepEqual(t1List, residentList)

  const invKeys = queryKeys.getRondaMutationInvalidationKeys({
    tenantId: VALID_UUID_1,
    scheduleId: VALID_UUID_3,
    kind: "attendance",
  })
  assert.equal(invKeys.length, 6)
  assert.ok(
    invKeys.some(
      (k) =>
        JSON.stringify(k) ===
        JSON.stringify(queryKeys.rondaQueryKeys.detail("admin", VALID_UUID_1, VALID_UUID_3))
    )
  )
  assert.ok(
    invKeys.some(
      (k) =>
        JSON.stringify(k) ===
        JSON.stringify(queryKeys.rondaQueryKeys.detail("resident", VALID_UUID_1, VALID_UUID_3))
    )
  )
  assert.ok(
    invKeys.some(
      (k) =>
        JSON.stringify(k) ===
        JSON.stringify(queryKeys.rondaQueryKeys.adminAttendanceAll(VALID_UUID_1))
    )
  )
  assert.ok(
    invKeys.some(
      (k) =>
        JSON.stringify(k) ===
        JSON.stringify(queryKeys.rondaQueryKeys.myAttendanceAll(VALID_UUID_1))
    )
  )
})

test("listEligibleRondaResidentsWithClient enforces tenant, resident active/non-deleted, household active/non-deleted, and non-PII selects", async () => {
  const recordedCalls = {
    households: [],
    residents: [],
  }

  function makeBuilder(tableName, rows) {
    const ops = []
    const builder = {
      select(cols) {
        ops.push(["select", cols])
        return builder
      },
      eq(col, val) {
        ops.push(["eq", col, val])
        return builder
      },
      is(col, val) {
        ops.push(["is", col, val])
        return builder
      },
      ilike(col, val) {
        ops.push(["ilike", col, val])
        return builder
      },
      order(col, opts) {
        ops.push(["order", col, opts])
        return builder
      },
      limit(n) {
        ops.push(["limit", n])
        return builder
      },
      then(resolvePromise) {
        recordedCalls[tableName] = ops
        return Promise.resolve({ data: rows, error: null }).then(resolvePromise)
      },
    }
    return builder
  }

  const fakeSupabase = {
    from(table) {
      if (table === "households") {
        return makeBuilder("households", [
          { id: "hh-active", block_unit: "Blok A-1", address: "Jl. Mawar 1" },
        ])
      }
      if (table === "residents") {
        return makeBuilder("residents", [
          { id: "res-ok", full_name: "Warga Layak", household_id: "hh-active" },
          { id: "res-orphan-hh", full_name: "Warga HH Inactive/Deleted", household_id: "hh-excluded" },
        ])
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  }

  const candidates = await repository.listEligibleRondaResidentsWithClient(
    fakeSupabase,
    {
      tenantId: VALID_UUID_1,
      roles: ["ketua_rt"],
    }
  )

  assert.deepEqual(candidates, [
    {
      id: "res-ok",
      fullName: "Warga Layak",
      householdId: "hh-active",
      householdLabel: "Blok A-1",
    },
  ])

  assert.deepEqual(recordedCalls.households, [
    ["select", "id, block_unit, address"],
    ["eq", "tenant_id", VALID_UUID_1],
    ["eq", "status", "active"],
    ["is", "deleted_at", null],
  ])
  assert.deepEqual(recordedCalls.residents, [
    ["select", "id, full_name, household_id"],
    ["eq", "tenant_id", VALID_UUID_1],
    ["is", "deleted_at", null],
    ["eq", "residency_status", "aktif"],
    ["order", "full_name", { ascending: true }],
    ["limit", 500],
  ])
})


