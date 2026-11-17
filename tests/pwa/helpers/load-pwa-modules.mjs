import { createRequire } from "node:module"
import {
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"

const require = createRequire(import.meta.url)
const ts = require("typescript")

const ROOT = process.cwd()
const OUT_DIR = `/tmp/smart-rt-pwa-test-dist-${process.pid}`

const SOURCE_FILES = [
  "src/lib/design-tokens.ts",
  "src/app/manifest.ts",
  "src/lib/pwa/sw-policy.ts",
]

let cached = null

export function loadPwaTestModules() {
  if (cached) return cached

  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })
  symlinkSync(
    resolve(ROOT, "node_modules"),
    join(OUT_DIR, "node_modules"),
    "dir"
  )

  for (const relPath of SOURCE_FILES) {
    const absIn = resolve(ROOT, relPath)
    const sourceText = readFileSync(absIn, "utf8")
    const result = ts.transpileModule(sourceText, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
        resolveJsonModule: true,
      },
      fileName: absIn,
    })

    const outPath = join(
      OUT_DIR,
      relPath.replace(/^src\//, "").replace(/\.ts$/, ".js")
    )
    mkdirSync(dirname(outPath), { recursive: true })

    const depth = relPath.replace(/^src\//, "").split("/").length - 1
    const prefix = depth > 0 ? "../".repeat(depth) : "./"
    const rewritten = result.outputText.replace(
      /require\(["']@\/(.*?)["']\)/g,
      (_match, sub) => `require("${prefix}${sub}")`
    )

    writeFileSync(outPath, rewritten, "utf8")
  }

  const manifestMod = require(join(OUT_DIR, "app/manifest.js"))
  const swPolicyMod = require(join(OUT_DIR, "lib/pwa/sw-policy.js"))
  const designTokensMod = require(join(OUT_DIR, "lib/design-tokens.js"))

  cached = {
    manifest: manifestMod.default || manifestMod,
    swPolicy: swPolicyMod,
    designTokens: designTokensMod,
    OUT_DIR,
  }

  return cached
}

