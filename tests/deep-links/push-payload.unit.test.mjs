import assert from "node:assert/strict"
import test, { describe } from "node:test"

import { loadDeepLinkTestModules } from "./helpers/load-deep-link-modules.mjs"

describe("buildPushNavigationPayload — notification deep-link contract (Phase 5.2)", () => {
  const { pushPayload } = loadDeepLinkTestModules()
  const { buildPushNavigationPayload } = pushPayload

  const sampleUuid = "11111111-1111-4111-8111-111111111111"

  test("resolves a Resident-scoped path for a known reference type", () => {
    const result = buildPushNavigationPayload("announcement", sampleUuid)
    assert.deepEqual(result, { path: `/resident/announcements/${sampleUuid}` })
  })

  test("resolves to the list route when no reference id is given", () => {
    const result = buildPushNavigationPayload("bills", null)
    assert.deepEqual(result, { path: "/resident/bills" })
  })

  test("never returns a full URL, only a relative path", () => {
    const result = buildPushNavigationPayload("announcement", sampleUuid)
    assert.ok(result.path.startsWith("/"))
    assert.ok(!result.path.includes("://"))
  })

  test("returns null for unknown reference types", () => {
    assert.equal(buildPushNavigationPayload("unknown_type", sampleUuid), null)
    assert.equal(buildPushNavigationPayload(null, sampleUuid), null)
  })

  test("ignores a malformed reference id rather than embedding it unsafely", () => {
    const result = buildPushNavigationPayload("announcement", "not-a-uuid; DROP TABLE")
    // resolveNotificationDestination falls back to the list route for an invalid id.
    assert.deepEqual(result, { path: "/resident/announcements" })
  })

  test("payload never contains a token, credential, or nested object — just a path string", () => {
    const result = buildPushNavigationPayload("bill", sampleUuid)
    const keys = Object.keys(result)
    assert.deepEqual(keys, ["path"])
    assert.equal(typeof result.path, "string")
  })
})
