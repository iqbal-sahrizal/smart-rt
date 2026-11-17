# Smart RT Android — Phase 2.2: Path Validation Hardening Report

**Date:** 2026-11-17  
**Branch:** `staging`  
**Scope:** `TrustedOriginPolicy.kt` and `TrustedOriginPolicyTest.kt` only. No other files changed.

---

## Status: ✅ PASS

All regression build targets completed successfully. 44 unit tests pass with zero failures.

---

## 1. Initial Findings

### 1.1 Vulnerability in Phase 2.1 Validator

The Phase 2.1 `validateDocumentPath` implementation performed a **single-pass `URLDecoder.decode()`** before checking for traversal sequences (`..`, `\`, `\u0000`).

A single decode pass is insufficient against multi-layer percent-encoding:

| Input | After 1 decode | After 2 decodes | Phase 2.1 verdict |
|---|---|---|---|
| `/api/letters/%252e%252e/secrets` | `/api/letters/%2e%2e/secrets` | `/api/letters/../secrets` | ✅ **PASSED** (incorrect — should fail) |
| `/api/letters/%25252e%25252e/secrets` | `/api/letters/%252e%252e/secrets` | `/api/letters/%2e%2e/secrets` | ✅ **PASSED** (incorrect) |
| `/api/letters/%252e%252e%252fconfig` | `/api/letters/%2e%2e%2fconfig` | `/api/letters/../config` | ✅ **PASSED** (incorrect) |
| `/api/letters/%255c%255cconfig` | `/api/letters/%5c%5cconfig` | `/api/letters/\\\\config` | ✅ **PASSED** (incorrect) |

The root cause: after one decode pass, the result still contains `%2e%2e` or `%5c` as literal ASCII characters (percent-two-e, not dot-dot). The string check `decoded.contains("..")` searched for the literal string `..`, which was not yet present. Only a second decode pass would reveal the traversal.

### 1.2 Additional Gaps Identified

| Attack Vector | Phase 2.1 Handling |
|---|---|
| `%252e%252e` (double-encoded `..`) | **Not caught** (single decode only) |
| `%25252e` (triple-encoded `.`) | **Not caught** |
| `%2500` (double-encoded null byte) | **Not caught** (`%25` → `%`, then `%00` on second pass) |
| `%2f` decoding to `/` creating `//` | Partial — only checked `startsWith("//")` on raw, not decoded-slash double-slash |
| Malformed `%ZZ` / `%2` / trailing `%` | Caught correctly (URLDecoder throws) |
| Encoded null `%00` | Caught correctly (after decode, `\u0000` check) |

---

## 2. Changes Made

**File:** [`android/app/src/main/java/id/smartrt/resident/security/TrustedOriginPolicy.kt`](file:///Users/iqbalsahrizal/Documents/CODING/Personal%20Project/smart-rt/android/app/src/main/java/id/smartrt/resident/security/TrustedOriginPolicy.kt)

The `validateDocumentPath` method was rewritten with a **4-layer fail-closed architecture**. No other methods were modified. The five allowlisted endpoint prefixes are unchanged.

### Layer 0 — Raw Pattern Rejection (pre-decode)

Applied to the raw path string **before any decoding**:

- **Reject literal null byte** (`\u0000`) in raw input.
- **Reject `%25` in the path component.** `%25` is an encoded percent-sign. Its presence in the path component indicates attempted double-encoding (e.g. `%252e` decodes to `%2e`, which then decodes to `.`). Legitimate API paths in this application never require a literal `%` character in the path segment. This single check eliminates the entire class of double- and triple-encoded traversal attacks at zero decode cost.
- **Reject `%00` in the path component.** An encoded null byte.
- **Reject double leading slash** (`//`) in the raw trimmed string.

> [!IMPORTANT]
> The `%25` rejection in Layer 0 is the primary mitigation for double-encoding. It eliminates `%252e`, `%25252e`, `%252e%252e%252f`, `%255c`, and `%2500` in a single constant-time regex check before any decoding occurs.

### Layer 1 — Iterative Decode Loop (up to 3 passes)

The path component (before `?`) is decoded in a loop of up to `MAX_DECODE_ITERATIONS = 3` passes:

- Each pass calls `URLDecoder.decode(current, "UTF-8")`.
- After each pass, checks for `..`, `\`, `\u0000`, `//` are applied immediately.
- A malformed percent sequence at any pass causes immediate rejection.
- The loop exits early when the string stabilises (no further change between passes).
- 3 passes are sufficient to catch triple-encoded inputs; beyond this depth, encoding is pathological and rejected by default via Layer 0.

**Why iterative decode AND Layer 0?**  
Layer 0 catches multi-encoding attacks fast and without ambiguity. Layer 1 catches any single-encoded variants that survive Layer 0, and provides defence-in-depth if the Layer 0 regex were somehow bypassed.

### Layer 2 — URI Structure Validation

Unchanged from Phase 2.1:
- Rejects absolute URIs (scheme present).
- Rejects authority, host, userInfo, port components.
- Adds post-decode double-slash check on the fully-decoded path.

### Layer 3 — Normalized Allowlist Check

Unchanged from Phase 2.1:
- `URI.normalize()` collapses any remaining dot-segments.
- Allowlist prefix matching against the five permitted endpoints.

### Layer 4 — Query Parameter Inspection

Unchanged from Phase 2.1:
- Rejects `://` and `%3A%2F%2F` (encoded `://`) in query values.
- Does **not** decode query values (prevents redirect-param manipulation).
- Detects `download=1` / `download=true` flag.

---

## 3. New Tests Added

**File:** [`android/app/src/test/java/id/smartrt/resident/security/TrustedOriginPolicyTest.kt`](file:///Users/iqbalsahrizal/Documents/CODING/Personal%20Project/smart-rt/android/app/src/test/java/id/smartrt/resident/security/TrustedOriginPolicyTest.kt)

The original Phase 2.1 traversal tests were consolidated and renamed as the regression baseline. 8 new test methods were added for Phase 2.2:

| New Test Method | Inputs Covered |
|---|---|
| `validateDocumentPath_rejectsSingleEncodedPathTraversal` (renamed/expanded from Phase 2.1) | `%2e%2e`, `%2E%2E%2F`, `../..`, `\\.\\`, `%5c`, `..%2f`, `%2e%2e%5c` |
| `validateDocumentPath_rejectsDoubleEncodedDotSegments` | `%252e%252e`, `%25252e%25252e`, `%252e%252e%252f` |
| `validateDocumentPath_rejectsDoubleEncodedBackslash` | `%255c%255c` |
| `validateDocumentPath_rejectsMalformedPercentEncoding` | `%2` (incomplete), `%ZZ` (invalid hex), `%` (truncated) |
| `validateDocumentPath_rejectsEncodedNullByte` | `%00`, `%2500` (double-encoded null) |
| `validateDocumentPath_rejectsEncodedSlashVariants` | `%2f` (encoded slash), `%5c` (encoded backslash) |
| `validateDocumentPath_rejectsAbsoluteUrlAndSchemeInjection` | `https://`, `javascript:`, `data:`, `http%3A//` in query |
| `validateDocumentPath_allFiveAllowedPrefixesStillAccepted` | All five endpoint prefixes — regression guard |
| `validateDocumentPath_downloadFlagStillDetected` | `?download=1` — regression guard |

---

## 4. Regression Results

### Unit Tests

**Run:** `./gradlew compileDebugKotlin testDebugUnitTest`  
**Result:** BUILD SUCCESSFUL

| Test Suite | Phase 2.1 Tests | Phase 2.2 Tests | Failures | Errors |
|---|---|---|---|---|
| `TrustedOriginPolicyTest` | 15 | **23** | 0 | 0 |
| `SmartRtNativeBridgeTest` | 12 | 12 | 0 | 0 |
| `WebViewBackNavigationTest` | 7 | 7 | 0 | 0 |
| `SmartRtWebViewConfigTest` | 2 | 2 | 0 | 0 |
| **Total** | **36** | **44** | **0** | **0** |

### Lint

**Run:** `./gradlew lintDebug`  
**Result:** BUILD SUCCESSFUL — zero Errors. No new warnings introduced.

### Assemble All Variants

**Run:** `./gradlew assembleDebug assembleStaging assembleRelease`  
**Result:** BUILD SUCCESSFUL (132 tasks)

| Variant | APK | Status |
|---|---|---|
| Debug | `app/build/outputs/apk/debug/app-debug.apk` | ✅ |
| Staging | `app/build/outputs/apk/staging/app-staging.apk` | ✅ |
| Release | `app/build/outputs/apk/release/app-release-unsigned.apk` | ✅ |

---

## 5. Design Decisions

### Why reject `%25` in the path component?

Legitimate Smart RT API paths follow the pattern `/api/{endpoint}/{uuid}/{action}`. UUIDs and action names are alphanumeric with hyphens. No path segment in the allowed document endpoints requires a literal `%` character. Rejecting `%25` is therefore both correct and conservative.

An alternative — iterating decodes without the Layer 0 check — would correctly catch multi-encoding too, but would require more decode work and would leave a narrow window for exotic Unicode normalization attacks. The Layer 0 raw rejection is simpler, faster, and easier to audit.

### Why not decode query parameters?

Query parameters are inspected for scheme injection patterns (`://`, `%3A%2F%2F`) but are **not decoded** before that check. Decoding query parameters to validate them creates a risk of redirect manipulation: a parameter like `redirect=%252fpath` decoded to `redirect=%2fpath` decoded again to `redirect=/path` could be treated as safe while the backend interprets the encoded form differently. By not decoding query params, the validator applies a uniform surface-level rejection of dangerous patterns.

### Why `MAX_DECODE_ITERATIONS = 3`?

- 1 pass: catches single-encoding (`%2e` → `.`).
- 2 passes: catches double-encoding (`%252e` → `%2e` → `.`).
- 3 passes: catches triple-encoding (`%25252e` → `%252e` → `%2e` → `.`).

Beyond 3 passes, percent-encoding depth is pathological. Layer 0 (`%25` rejection) already makes the iterative loop redundant for depths ≥ 2 for the specific traversal patterns. The loop provides defence-in-depth for any unexpected bypass.

---

## 6. Remaining Risks

| Risk | Severity | Notes |
|---|---|---|
| Instrumentation tests not run | Accepted | No emulator attached. Deferred to on-device phase. |
| Query parameter encoding variants not exhaustively tested | Low | Scheme injection via encoded colon + encoded slash `%3a%2f%2f` (lowercase) is covered. Additional exotic encodings (`%3A%2f%2F` mixed case) are covered by `ignoreCase = true` on the check. |
| URI normalization edge cases on non-standard JVM implementations | Very low | `java.net.URI` normalization behaviour is well-specified in RFC 3986. Android uses a consistent implementation. |
| Allowed path prefix leaks broader access than needed | Known / accepted | `/api/letters/`, `/api/activities/`, `/api/payments/`, `/api/complaints/`, `/api/community-feed/media/` are intentionally broad within their prefixes. Backend authentication and RLS are the authoritative access control — the native bridge path allowlist is a defense-in-depth layer, not a replacement. |

---

## 7. Files Changed in Phase 2.2

| File | Change |
|---|---|
| `android/app/src/main/java/id/smartrt/resident/security/TrustedOriginPolicy.kt` | `validateDocumentPath` rewritten with 4-layer fail-closed architecture; `MAX_DECODE_ITERATIONS`, `RAW_ENCODED_PERCENT`, `RAW_ENCODED_NULL` constants added to companion object |
| `android/app/src/test/java/id/smartrt/resident/security/TrustedOriginPolicyTest.kt` | 8 new test methods covering double-encoding, triple-encoding, encoded backslash, malformed encoding, encoded null bytes, encoded slash variants, absolute URL injection, and all-five-prefixes regression |

No other files modified. Next.js, Supabase, database, RLS, RPC, and all non-Android code are unchanged.

---

## 8. Next Phase

Phase 2.2 is complete. Stopped as instructed.

**Pending user review before Phase 3.**

