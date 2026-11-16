import { execFileSync } from "node:child_process"
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
const OUT_DIR = "/tmp/smart-rt-complaints-test-dist"

const SOURCE_FILES = [
  "src/lib/auth/types.ts",
  "src/lib/residents/schemas.ts",
  "src/lib/complaints/constants.ts",
  "src/lib/complaints/types.ts",
  "src/lib/complaints/schemas.ts",
  "src/lib/complaints/storage.ts",
  "src/lib/complaints/repository.ts",
  "src/lib/complaints/query-keys.ts",
]

let cached = null

export function loadComplaintsTestModules() {
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
    const prefix = depth === 0 ? "./" : "../".repeat(depth)
    const rewritten = result.outputText.replace(
      /require\("@\/([^"]+)"\)/g,
      (_match, target) => `require("${prefix}${target}")`
    )
    writeFileSync(outPath, rewritten, "utf8")
  }

  cached = {
    constants: require(join(OUT_DIR, "lib/complaints/constants.js")),
    types: require(join(OUT_DIR, "lib/complaints/types.js")),
    schemas: require(join(OUT_DIR, "lib/complaints/schemas.js")),
    storage: require(join(OUT_DIR, "lib/complaints/storage.js")),
    repository: require(join(OUT_DIR, "lib/complaints/repository.js")),
    queryKeys: require(join(OUT_DIR, "lib/complaints/query-keys.js")),
  }
  return cached
}

export function runSupabaseCliStatus() {
  const raw = execFileSync("npx", ["supabase", "status", "-o", "json"], {
    encoding: "utf8",
    env: { ...process.env, HOME: "/tmp" },
  })
  return JSON.parse(raw)
}

