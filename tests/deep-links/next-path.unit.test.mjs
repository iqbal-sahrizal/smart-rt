import assert from "node:assert/strict"
import test, { describe } from "node:test"

import { loadDeepLinkTestModules } from "./helpers/load-deep-link-modules.mjs"

describe("resolveSafeNextPath — post-login return URL safety (Phase 5.2)", () => {
  const { nextPath } = loadDeepLinkTestModules()
  const { resolveSafeNextPath } = nextPath

  test("accepts the pre-existing activate-account allowance", () => {
    assert.equal(resolveSafeNextPath("/activate-account"), "/activate-account")
    assert.equal(
      resolveSafeNextPath("/activate-account?token=abc"),
      "/activate-account?token=abc"
    )
  })

  test("accepts Resident deep-link return targets", () => {
    assert.equal(resolveSafeNextPath("/resident"), "/resident")
    assert.equal(
      resolveSafeNextPath("/resident/announcements/uuid-123"),
      "/resident/announcements/uuid-123"
    )
    assert.equal(
      resolveSafeNextPath("/resident/bills?status=unpaid"),
      "/resident/bills?status=unpaid"
    )
  })

  test("rejects non-string, empty, and non-rooted input", () => {
    assert.equal(resolveSafeNextPath(undefined), null)
    assert.equal(resolveSafeNextPath(null), null)
    assert.equal(resolveSafeNextPath(123), null)
    assert.equal(resolveSafeNextPath(""), null)
    assert.equal(resolveSafeNextPath("resident"), null)
  })

  test("rejects protocol-relative and backslash open-redirect attempts", () => {
    assert.equal(resolveSafeNextPath("//evil.com/resident"), null)
    assert.equal(resolveSafeNextPath("/\\evil.com"), null)
    assert.equal(resolveSafeNextPath("https://evil.com/resident"), null)
  })

  test("rejects dot-segment traversal even within the resident prefix", () => {
    assert.equal(resolveSafeNextPath("/resident/../../login"), null)
    assert.equal(resolveSafeNextPath("/resident/..%2f..%2flogin"), null)
  })

  test("rejects lookalike routes outside the allowed scopes", () => {
    assert.equal(resolveSafeNextPath("/resident-invitations"), null)
    assert.equal(resolveSafeNextPath("/bills"), null)
    assert.equal(resolveSafeNextPath("/"), null)
    assert.equal(resolveSafeNextPath("/login"), null)
  })
})
