import assert from "node:assert/strict"
import { existsSync, readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"
import test, { describe } from "node:test"

import { loadPwaTestModules } from "./helpers/load-pwa-modules.mjs"

const ROOT = process.cwd()

function readPngDimensions(buffer) {
  const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  assert(
    buffer.subarray(0, 8).equals(PNG_HEADER),
    "File must start with PNG magic bytes"
  )
  const ihdrChunk = buffer.subarray(12, 16).toString("ascii")
  assert.equal(ihdrChunk, "IHDR", "First PNG chunk must be IHDR")
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  return { width, height }
}

describe("PWA Manifest & Mobile Viewport Integration", () => {
  const { manifest } = loadPwaTestModules()
  const manifestData = manifest()

  test("manifest exports required PWA metadata for standalone resident experience", () => {
    assert.equal(manifestData.name, "Smart RT")
    assert.equal(manifestData.short_name, "Smart RT")
    assert.equal(manifestData.start_url, "/resident")
    assert.equal(manifestData.scope, "/")
    assert.equal(manifestData.display, "standalone")
    assert.equal(manifestData.orientation, "portrait")
    assert.equal(manifestData.theme_color, "#2563EB")
    assert.equal(manifestData.background_color, "#F8FAFC")
    assert.ok(Array.isArray(manifestData.icons))
    assert.equal(manifestData.icons.length, 4)
  })

  test("manifest declares both standard (any) and maskable icons for Android", () => {
    const purposes = manifestData.icons.map((icon) => icon.purpose)
    assert.ok(purposes.includes("any"), "Must include 'any' purpose icons")
    assert.ok(
      purposes.includes("maskable"),
      "Must include 'maskable' purpose icons for adaptive Android launchers"
    )

    const sizes = manifestData.icons.map((icon) => icon.sizes)
    assert.ok(sizes.includes("192x192"), "Must include 192x192 icon")
    assert.ok(sizes.includes("512x512"), "Must include 512x512 icon")
  })

  test("all referenced manifest icons exist on disk and are valid PNGs with exact dimensions", () => {
    for (const icon of manifestData.icons) {
      const relPath = icon.src.replace(/^\//, "")
      const absPath = resolve(ROOT, "public", relPath)
      assert.ok(
        existsSync(absPath),
        `Icon file ${icon.src} must exist at ${absPath}`
      )

      const stat = statSync(absPath)
      assert.ok(stat.size > 1000, `Icon ${icon.src} must not be empty or tiny stub`)

      const buffer = readFileSync(absPath)
      const { width, height } = readPngDimensions(buffer)

      const [expectedW, expectedH] = icon.sizes.split("x").map(Number)
      assert.equal(
        width,
        expectedW,
        `Width of ${icon.src} must be ${expectedW}px`
      )
      assert.equal(
        height,
        expectedH,
        `Height of ${icon.src} must be ${expectedH}px`
      )
    }
  })

  test("apple-touch-icon exists and is a valid 180x180 PNG", () => {
    const absPath = resolve(ROOT, "public/icons/apple-touch-icon.png")
    assert.ok(existsSync(absPath), "apple-touch-icon.png must exist")
    const buffer = readFileSync(absPath)
    const { width, height } = readPngDimensions(buffer)
    assert.equal(width, 180)
    assert.equal(height, 180)
  })

  test("layout.tsx configures viewport-fit=cover and avoids accessibility zoom traps", () => {
    const layoutSource = readFileSync(resolve(ROOT, "src/app/layout.tsx"), "utf8")

    assert.match(
      layoutSource,
      /export const viewport: Viewport/,
      "Must export typed viewport object"
    )
    assert.match(
      layoutSource,
      /viewportFit:\s*"cover"/,
      "Must specify viewportFit: 'cover' for edge-to-edge mobile safe areas"
    )
    assert.match(
      layoutSource,
      /width:\s*"device-width"/,
      "Must specify width: 'device-width'"
    )
    assert.match(
      layoutSource,
      /initialScale:\s*1/,
      "Must specify initialScale: 1"
    )

    // Ensure accessibility zoom restrictions are NOT present
    assert.doesNotMatch(
      layoutSource,
      /userScalable:\s*false/,
      "Must not restrict user zoom (accessibility violation)"
    )
    assert.doesNotMatch(
      layoutSource,
      /maximumScale:\s*1/,
      "Must not cap maximumScale at 1 (accessibility violation)"
    )

    // Verify PwaManager integration
    assert.match(
      layoutSource,
      /<PwaManager\s*\/>/,
      "Must render <PwaManager /> in RootLayout"
    )

    // Verify Apple Web App capabilities
    assert.match(
      layoutSource,
      /appleWebApp:\s*\{[^}]*capable:\s*true/,
      "Must declare appleWebApp: { capable: true }"
    )
  })

  test("next.config.ts configures safe, uncacheable headers for sw.js", () => {
    const configSource = readFileSync(resolve(ROOT, "next.config.ts"), "utf8")

    assert.match(
      configSource,
      /source:\s*["']\/sw\.js["']/,
      "Must define explicit header rule for /sw.js"
    )
    assert.match(
      configSource,
      /Cache-Control/,
      "Must set Cache-Control for /sw.js"
    )
    assert.match(
      configSource,
      /no-cache,\s*no-store,\s*must-revalidate/,
      "Must enforce no-cache, no-store, must-revalidate on /sw.js"
    )
    assert.match(
      configSource,
      /Service-Worker-Allowed/,
      "Must set Service-Worker-Allowed header"
    )
  })

  test("offline.html fallback page exists and is properly structured", () => {
    const offlinePath = resolve(ROOT, "public/offline.html")
    assert.ok(existsSync(offlinePath), "public/offline.html must exist")

    const content = readFileSync(offlinePath, "utf8")
    assert.match(
      content,
      /viewport-fit=cover/,
      "offline.html must support safe-area viewport-fit=cover"
    )
    assert.match(
      content,
      /Smart RT/i,
      "offline.html must present Smart RT branding"
    )
    assert.match(
      content,
      /window\.addEventListener\("online"/,
      "offline.html must include automatic reconnect reload handler"
    )
  })
})

