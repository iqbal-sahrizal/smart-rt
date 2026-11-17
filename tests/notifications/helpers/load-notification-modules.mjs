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
const OUT_DIR = `/tmp/smart-rt-notifications-test-dist-${process.pid}`

const SOURCE_FILES = [
  "src/lib/residents/schemas.ts",
  "src/lib/notifications/types.ts",
  "src/lib/notifications/push-payload.ts",
  "src/lib/notifications/dispatcher.ts",
  "src/lib/notifications/enqueue-rpc.ts",
]

let cached = null

export function loadNotificationTestModules() {
  if (cached) return cached

  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })
  try {
    symlinkSync(
      resolve(ROOT, "node_modules"),
      join(OUT_DIR, "node_modules"),
      "dir"
    )
  } catch {
    // ignore if already linked
  }

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

  const notificationTypesMod = require(join(OUT_DIR, "lib/notifications/types.js"))
  const pushPayloadMod = require(join(OUT_DIR, "lib/notifications/push-payload.js"))
  const dispatcherMod = require(join(OUT_DIR, "lib/notifications/dispatcher.js"))
  const enqueueRpcMod = require(join(OUT_DIR, "lib/notifications/enqueue-rpc.js"))

  cached = {
    notificationTypes: notificationTypesMod,
    pushPayload: pushPayloadMod,
    dispatcher: dispatcherMod,
    enqueueRpc: enqueueRpcMod,
    OUT_DIR,
  }

  return cached
}

