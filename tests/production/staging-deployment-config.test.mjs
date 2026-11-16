import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const ROOT = process.cwd()

function readProjectFile(relPath) {
  const fullPath = resolve(ROOT, relPath)
  assert.equal(existsSync(fullPath), true, `Missing required file: ${relPath}`)
  return readFileSync(fullPath, "utf8")
}

test("package.json declares Node 22.x engine and clean Next.js build script", () => {
  const pkg = JSON.parse(readProjectFile("package.json"))
  assert.equal(pkg.engines?.node, "22.x")
  assert.equal(pkg.scripts?.build, "next build")
  assert.equal(pkg.scripts?.start, "next start")
})

test(".dockerignore excludes secrets, build artifacts, and non-runtime directories", () => {
  const dockerignore = readProjectFile(".dockerignore")
  const lines = dockerignore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))

  for (const requiredPattern of [
    ".env",
    ".env.*",
    "!.env.example",
    "supabase/functions/.env*",
    ".git",
    "node_modules",
    ".next",
    "supabase",
    "tests",
    "docs",
  ]) {
    assert.ok(
      lines.includes(requiredPattern),
      `.dockerignore must include ${requiredPattern}`
    )
  }
})

test("Dockerfile enforces Node 22 LTS multi-stage non-root build and 0.0.0.0 runtime binding", () => {
  const dockerfile = readProjectFile("Dockerfile")
  const nonCommentDockerfile = dockerfile
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n")

  assert.match(nonCommentDockerfile, /^FROM node:22-bookworm-slim AS base$/m)
  assert.match(nonCommentDockerfile, /^FROM deps AS builder$/m)
  assert.match(nonCommentDockerfile, /^FROM base AS runner$/m)
  assert.match(nonCommentDockerfile, /^ARG NEXT_PUBLIC_SUPABASE_URL$/m)
  assert.match(nonCommentDockerfile, /^ARG NEXT_PUBLIC_SUPABASE_ANON_KEY$/m)
  assert.match(nonCommentDockerfile, /^RUN npm run build$/m)
  assert.doesNotMatch(nonCommentDockerfile, /--webpack/)
  assert.doesNotMatch(nonCommentDockerfile, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.doesNotMatch(nonCommentDockerfile, /STORAGE_DELETION_WORKER_SECRET/)
  assert.doesNotMatch(nonCommentDockerfile, /COPY.*\.env/i)
  assert.match(nonCommentDockerfile, /^ENV NODE_ENV=production$/m)
  assert.match(nonCommentDockerfile, /^ENV HOSTNAME=0\.0\.0\.0$/m)
  assert.match(nonCommentDockerfile, /^USER nextjs$/m)
  assert.match(
    nonCommentDockerfile,
    /CMD \["node", "node_modules\/next\/dist\/bin\/next", "start", "-H", "0\.0\.0\.0"\]/
  )
})

test("railway.toml configures Dockerfile build, /api/health healthcheck, and staging safety guards", () => {
  const railwayToml = readProjectFile("railway.toml")

  assert.match(railwayToml, /"\$schema" = "https:\/\/railway\.com\/railway\.schema\.json"/)
  assert.match(railwayToml, /builder = "DOCKERFILE"/)
  assert.match(railwayToml, /dockerfilePath = "Dockerfile"/)
  assert.match(
    railwayToml,
    /startCommand = "node node_modules\/next\/dist\/bin\/next start -H 0\.0\.0\.0"/
  )
  assert.match(railwayToml, /healthcheckPath = "\/api\/health"/)
  assert.match(railwayToml, /restartPolicyType = "ON_FAILURE"/)
  assert.doesNotMatch(railwayToml, /preDeployCommand/)
  assert.doesNotMatch(railwayToml, /cronSchedule/)
  assert.doesNotMatch(railwayToml, /postgres/i)
})

test("docs/deployment/staging-environment.md documents variable scopes without secret leakage", () => {
  const doc = readProjectFile("docs/deployment/staging-environment.md")

  for (const requiredToken of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NODE_ENV",
    "PORT",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "STORAGE_DELETION_WORKER_SECRET",
    "STORAGE_ORPHAN_SCAN_URL",
    "/api/health",
    "staging",
  ]) {
    assert.ok(doc.includes(requiredToken), `Missing doc reference: ${requiredToken}`)
  }

  // Must never contain real JWTs, service secrets, or local demo credentials
  assert.doesNotMatch(doc, /\beyJ[A-Za-z0-9_-]{10,}\./)
  assert.doesNotMatch(doc, /sb_secret_[A-Za-z0-9_-]{8,}/)
  assert.doesNotMatch(doc, /sb_publishable_[A-Za-z0-9_-]{8,}/)
})
