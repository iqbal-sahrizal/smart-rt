import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import test, { describe } from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const ROOT = process.cwd()
const OUT_DIR = `/tmp/smart-rt-invitation-test-dist-${process.pid}`

function loadModules() {
  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })
  try {
    symlinkSync(resolve(ROOT, "node_modules"), join(OUT_DIR, "node_modules"), "dir")
  } catch {
    // ignore
  }

  for (const relPath of [
    "src/lib/invitations/url.ts",
    "src/lib/supabase/config.ts",
    "src/lib/supabase/middleware.ts",
  ]) {
    const absIn = resolve(ROOT, relPath)
    const sourceText = readFileSync(absIn, "utf8")
    const result = ts.transpileModule(sourceText, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
      fileName: absIn,
    })
    const outPath = join(OUT_DIR, relPath.replace(/^src\//, "").replace(/\.ts$/, ".js"))
    mkdirSync(dirname(outPath), { recursive: true })
    const depth = relPath.replace(/^src\//, "").split("/").length - 1
    const prefix = depth > 0 ? "../".repeat(depth) : "./"
    const rewritten = result.outputText.replace(
      /require\(["']@\/(.*?)["']\)/g,
      (_m, sub) => `require("${prefix}${sub}")`
    )
    writeFileSync(outPath, rewritten, "utf8")
  }

  return {
    urlMod: require(join(OUT_DIR, "lib/invitations/url.js")),
    middlewareMod: require(join(OUT_DIR, "lib/supabase/middleware.js")),
  }
}

describe("Resident Invitation URL, Public AssetLinks & Middleware", () => {
  const { urlMod, middlewareMod } = loadModules()

  test("buildCanonicalActivationUrl produces canonical HTTPS domain without localhost in production/staging", () => {
    const prevEnv = process.env.NODE_ENV
    const prevAppUrl = process.env.NEXT_PUBLIC_APP_URL
    process.env.NODE_ENV = "production"
    delete process.env.NEXT_PUBLIC_APP_URL
    try {
      const url = urlMod.buildCanonicalActivationUrl("a".repeat(64))
      assert.ok(url.startsWith("https://smart-rt-nine.vercel.app/activate-account?token="))
      assert.ok(!url.includes("localhost"))
    } finally {
      process.env.NODE_ENV = prevEnv
      if (prevAppUrl !== undefined) process.env.NEXT_PUBLIC_APP_URL = prevAppUrl
    }
  })

  test("isTrustedAppOrigin rejects untrusted hosts and HTTP in non-dev", () => {
    const prevEnv = process.env.NODE_ENV
    process.env.NODE_ENV = "production"
    try {
      assert.equal(urlMod.isTrustedAppOrigin("https://smart-rt-nine.vercel.app"), true)
      assert.equal(urlMod.isTrustedAppOrigin("https://resident.smartrt.id"), true)
      assert.equal(urlMod.isTrustedAppOrigin("https://evil.example.com"), false)
      assert.equal(urlMod.isTrustedAppOrigin("http://localhost:3000"), false)
    } finally {
      process.env.NODE_ENV = prevEnv
    }
  })

  test("isPublicPath allows /.well-known/assetlinks.json and /activate-account without login redirect", () => {
    assert.equal(middlewareMod.isPublicPath("/.well-known/assetlinks.json"), true)
    assert.equal(middlewareMod.isPublicPath("/activate-account"), true)
    assert.equal(middlewareMod.isPublicPath("/resident"), false)
  })
})

