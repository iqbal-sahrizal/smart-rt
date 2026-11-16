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
const OUT_DIR = `/tmp/smart-rt-community-feed-test-dist-${process.pid}`

const SOURCE_FILES = [
  "src/lib/auth/types.ts",
  "src/lib/auth/workspace.ts",
  "src/lib/residents/schemas.ts",
  "src/lib/community-feed/constants.ts",
  "src/lib/community-feed/types.ts",
  "src/lib/community-feed/errors.ts",
  "src/lib/community-feed/schemas.ts",
  "src/lib/community-feed/storage.ts",
  "src/lib/community-feed/formatters.ts",
  "src/lib/community-feed/repository.ts",
  "src/lib/community-feed/query-keys.ts",
]

let cached = null

export function loadCommunityFeedTestModules() {
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
    const rewritten = result.outputText
      .replace(
        /require\("@\/([^"]+)"\)/g,
        (_match, target) => `require("${prefix}${target}")`
      )
      .replace(/require\("server-only"\)/g, "({})")
    writeFileSync(outPath, rewritten, "utf8")
  }

  cached = {
    authTypes: require(join(OUT_DIR, "lib/auth/types.js")),
    constants: require(join(OUT_DIR, "lib/community-feed/constants.js")),
    types: require(join(OUT_DIR, "lib/community-feed/types.js")),
    errors: require(join(OUT_DIR, "lib/community-feed/errors.js")),
    schemas: require(join(OUT_DIR, "lib/community-feed/schemas.js")),
    storage: require(join(OUT_DIR, "lib/community-feed/storage.js")),
    formatters: require(join(OUT_DIR, "lib/community-feed/formatters.js")),
    repository: require(join(OUT_DIR, "lib/community-feed/repository.js")),
    queryKeys: require(join(OUT_DIR, "lib/community-feed/query-keys.js")),
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
