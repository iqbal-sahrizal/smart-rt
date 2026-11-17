import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test, { describe } from "node:test"

import { loadPwaTestModules } from "./helpers/load-pwa-modules.mjs"

const ROOT = process.cwd()

describe("Service Worker Policy & Conservative Cache Invalidation", () => {
  const { swPolicy } = loadPwaTestModules()
  const {
    SW_CACHE_PREFIX,
    SW_CACHE_VERSION,
    SW_STATIC_CACHE_NAME,
    SW_OFFLINE_FALLBACK_URL,
    SW_PRECACHE_URLS,
    classifyRequestForCache,
    isResponseSafeToCache,
    getObsoleteCacheNames,
    shouldReloadOnControllerChange,
  } = swPolicy

  test("cache constants conform to versioned prefix conventions", () => {
    assert.equal(SW_CACHE_PREFIX, "smart-rt-static-")
    assert.equal(SW_CACHE_VERSION, "v1")
    assert.equal(SW_STATIC_CACHE_NAME, "smart-rt-static-v1")
    assert.equal(SW_OFFLINE_FALLBACK_URL, "/offline.html")
    assert.ok(SW_PRECACHE_URLS.includes("/offline.html"))
    assert.ok(SW_PRECACHE_URLS.includes("/manifest.webmanifest"))
    assert.ok(SW_PRECACHE_URLS.includes("/icons/icon-192x192.png"))
  })

  describe("classifyRequestForCache: Strict Request Boundaries", () => {
    const origin = "https://smartrt.id"

    test("bypasses mutation HTTP methods immediately", () => {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const result = classifyRequestForCache({
          url: `${origin}/resident/bills`,
          method,
          appOrigin: origin,
        })
        assert.equal(
          result,
          "bypass",
          `Method ${method} must always bypass cache`
        )
      }
    })

    test("bypasses all cross-origin requests (e.g. Supabase REST, Storage, Auth)", () => {
      const crossOrigins = [
        "https://szghujzhiyndeuhepsax.supabase.co/rest/v1/residents",
        "https://szghujzhiyndeuhepsax.supabase.co/auth/v1/user",
        "https://szghujzhiyndeuhepsax.supabase.co/storage/v1/object/public/complaint-attachments/test.jpg",
        "https://fonts.googleapis.com/css2?family=Inter",
      ]

      for (const crossUrl of crossOrigins) {
        const result = classifyRequestForCache({
          url: crossUrl,
          method: "GET",
          appOrigin: origin,
        })
        assert.equal(
          result,
          "bypass",
          `Cross-origin request to ${crossUrl} must bypass service worker cache`
        )
      }
    })

    test("bypasses sensitive authenticated API endpoints and Supabase SSR auth paths", () => {
      const sensitiveUrls = [
        `${origin}/api/letters/550e8400-e29b-41d4-a716-446655440000/issued`,
        `${origin}/api/community-feed/media/feed-123.jpg`,
        `${origin}/api/payments/proof/pay-987`,
        `${origin}/auth/callback?code=abc123xyz`,
        `${origin}/auth/v1/callback`,
        `${origin}/auth/signout`,
      ]

      for (const sensitiveUrl of sensitiveUrls) {
        const result = classifyRequestForCache({
          url: sensitiveUrl,
          method: "GET",
          appOrigin: origin,
        })
        assert.equal(
          result,
          "bypass",
          `Sensitive endpoint ${sensitiveUrl} must never be cached`
        )
      }
    })

    test("bypasses Next.js Server Actions and RSC flight data", () => {
      // Server Action via header
      const actionResult = classifyRequestForCache({
        url: `${origin}/resident/profile`,
        method: "POST",
        appOrigin: origin,
        headers: { "next-action": "some-action-hash" },
      })
      assert.equal(actionResult, "bypass")

      // RSC via query parameter
      const rscQueryResult = classifyRequestForCache({
        url: `${origin}/resident/bills?_rsc=1a2b3c`,
        method: "GET",
        appOrigin: origin,
      })
      assert.equal(
        rscQueryResult,
        "bypass",
        "RSC query param request must bypass cache to preserve fresh SSR data"
      )

      // RSC via header
      const rscHeaderResult = classifyRequestForCache({
        url: `${origin}/resident/bills`,
        method: "GET",
        appOrigin: origin,
        headers: { rsc: "1" },
      })
      assert.equal(
        rscHeaderResult,
        "bypass",
        "RSC header request must bypass cache"
      )
    })

    test("classifies immutable Next.js chunks as cache-first-immutable", () => {
      const chunkUrls = [
        `${origin}/_next/static/chunks/app/resident/page-b12489c.js`,
        `${origin}/_next/static/chunks/framework-4819aef.js`,
        `${origin}/_next/static/css/app-globals-19f8a9.css`,
        `${origin}/_next/static/media/inter-latin-400.woff2`,
      ]

      for (const chunkUrl of chunkUrls) {
        const result = classifyRequestForCache({
          url: chunkUrl,
          method: "GET",
          appOrigin: origin,
        })
        assert.equal(
          result,
          "cache-first-immutable",
          `Immutable static asset ${chunkUrl} should use cache-first-immutable`
        )
      }
    })

    test("classifies static icons and manifest as stale-while-revalidate-static", () => {
      const staticAssets = [
        `${origin}/icons/icon-192x192.png`,
        `${origin}/icons/icon-512x512.png`,
        `${origin}/icons/icon-maskable-192x192.png`,
        `${origin}/manifest.webmanifest`,
        `${origin}/offline.html`,
      ]

      for (const assetUrl of staticAssets) {
        const result = classifyRequestForCache({
          url: assetUrl,
          method: "GET",
          appOrigin: origin,
        })
        assert.equal(
          result,
          "stale-while-revalidate-static",
          `Static public asset ${assetUrl} should use stale-while-revalidate`
        )
      }
    })

    test("classifies HTML navigations as network-only-navigate", () => {
      const navRoutes = [
        `${origin}/resident`,
        `${origin}/resident/bills`,
        `${origin}/resident/community-feed`,
        `${origin}/resident/letters`,
        `${origin}/resident/profile`,
      ]

      for (const navUrl of navRoutes) {
        const result = classifyRequestForCache({
          url: navUrl,
          method: "GET",
          mode: "navigate",
          appOrigin: origin,
        })
        assert.equal(
          result,
          "network-only-navigate",
          `HTML Navigation to ${navUrl} must be network-only to prevent stale sessions`
        )
      }
    })
  })

  describe("isResponseSafeToCache: Leak Prevention", () => {
    test("rejects non-200 responses", () => {
      for (const status of [0, 206, 301, 302, 401, 403, 404, 500]) {
        assert.equal(
          isResponseSafeToCache({ status }),
          false,
          `Status ${status} must not be cached`
        )
      }
    })

    test("rejects responses with Set-Cookie header or flag", () => {
      const safe = isResponseSafeToCache({
        status: 200,
        hasSetCookie: true,
      })
      assert.equal(safe, false, "Must reject responses carrying Set-Cookie")
    })

    test("rejects responses with no-store or private Cache-Control", () => {
      assert.equal(
        isResponseSafeToCache({
          status: 200,
          cacheControl: "no-store, no-cache",
        }),
        false
      )
      assert.equal(
        isResponseSafeToCache({
          status: 200,
          cacheControl: "private, max-age=0",
        }),
        false
      )
    })

    test("approves clean 200 responses with static or immutable Cache-Control", () => {
      assert.equal(
        isResponseSafeToCache({
          status: 200,
          cacheControl: "public, max-age=31536000, immutable",
        }),
        true
      )
      assert.equal(
        isResponseSafeToCache({
          status: 200,
          cacheControl: "public, max-age=86400",
        }),
        true
      )
      assert.equal(isResponseSafeToCache({ status: 200 }), true)
    })
  })

  describe("getObsoleteCacheNames: Precise Purge Scope", () => {
    test("purges only obsolete Smart RT static caches, leaving current and third-party caches intact", () => {
      const existingCaches = [
        "smart-rt-static-v1", // current
        "smart-rt-static-v0", // obsolete
        "smart-rt-static-old-alpha", // obsolete
        "smart-rt-other-bucket", // not matching prefix
        "supabase-auth-token", // unrelated
        "tanstack-query-cache", // unrelated
      ]

      const toDelete = getObsoleteCacheNames(existingCaches)
      assert.deepEqual(toDelete.sort(), [
        "smart-rt-static-old-alpha",
        "smart-rt-static-v0",
      ])
      assert.ok(
        !toDelete.includes("smart-rt-static-v1"),
        "Current cache must never be deleted"
      )
      assert.ok(
        !toDelete.includes("supabase-auth-token"),
        "Unrelated cache must never be deleted"
      )
    })
  })

  describe("shouldReloadOnControllerChange: Infinite Loop & Trapping Prevention", () => {
    test("rejects reload on first-time installation (no prior controller)", () => {
      const reload = shouldReloadOnControllerChange({
        hasExistingController: false,
        userConfirmedUpdate: false,
        alreadyReloaded: false,
      })
      assert.equal(
        reload,
        false,
        "First-time worker claim must not reload page unexpectedly"
      )
    })

    test("rejects reload when user has not yet confirmed the update", () => {
      const reload = shouldReloadOnControllerChange({
        hasExistingController: true,
        userConfirmedUpdate: false,
        alreadyReloaded: false,
      })
      assert.equal(
        reload,
        false,
        "Update without explicit user confirmation must not disrupt active user session"
      )
    })

    test("rejects reload if already reloaded to prevent reload loops", () => {
      const reload = shouldReloadOnControllerChange({
        hasExistingController: true,
        userConfirmedUpdate: true,
        alreadyReloaded: true,
      })
      assert.equal(reload, false, "Must never reload twice in single session")
    })

    test("approves reload only when existing controller was present, update was confirmed, and not reloaded yet", () => {
      const reload = shouldReloadOnControllerChange({
        hasExistingController: true,
        userConfirmedUpdate: true,
        alreadyReloaded: false,
      })
      assert.equal(reload, true, "Must trigger clean reload upon user consent")
    })
  })

  describe("public/sw.js: Script Structure & Safety Verification", () => {
    const swSource = readFileSync(resolve(ROOT, "public/sw.js"), "utf8")

    test("does not call self.skipWaiting() automatically in install event", () => {
      const installStart = swSource.indexOf('addEventListener("install"')
      const activateStart = swSource.indexOf('addEventListener("activate"')
      assert.ok(installStart !== -1, "Must define install event listener")
      assert.ok(activateStart > installStart, "Activate must follow install")
      const installBlock = swSource.slice(installStart, activateStart)
      const executableLines = installBlock
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n")

      assert.doesNotMatch(
        executableLines,
        /self\.skipWaiting\(\)/,
        "Must NOT auto-skipWaiting in install listener to prevent breaking in-flight transactions"
      )
    })

    test("listens for SKIP_WAITING message before activating new worker", () => {
      assert.match(
        swSource,
        /addEventListener\(["']message["']/,
        "Must listen for postMessage events"
      )
      assert.match(
        swSource,
        /event\.data(?:\.type|\s*&&\s*event\.data\.type)\s*===\s*["']SKIP_WAITING["']/,
        "Must check for SKIP_WAITING type"
      )
      assert.match(
        swSource,
        /self\.skipWaiting\(\)/,
        "Must call skipWaiting only after message"
      )
    })

    test("cleans obsolete caches in activate event", () => {
      assert.match(
        swSource,
        /addEventListener\(["']activate["']/,
        "Must define activate event listener"
      )
      assert.match(
        swSource,
        /caches\.keys\(\)/,
        "Must query caches in activate"
      )
      assert.match(
        swSource,
        /caches\.delete\(/,
        "Must delete obsolete caches in activate"
      )
    })

    test("intercepts navigation requests with network-only-navigate and offline fallback", () => {
      assert.match(
        swSource,
        /addEventListener\(["']fetch["']/,
        "Must define fetch listener"
      )
      assert.match(
        swSource,
        /SW_OFFLINE_FALLBACK_URL/,
        "Must reference offline fallback URL"
      )
      assert.match(
        swSource,
        /offline\.html/,
        "Must have offline.html in cache precache"
      )
    })
  })
})
