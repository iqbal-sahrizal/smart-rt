import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import crypto from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import test from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const { createClient } = require("@supabase/supabase-js")
const { createServerClient } = require("@supabase/ssr")

const ROOT = process.cwd()
const OUT_DIR = `/tmp/smart-rt-prod-readiness-test-${process.pid}`

function transpileIntoOutDir(relPaths) {
  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })
  symlinkSync(
    resolve(ROOT, "node_modules"),
    join(OUT_DIR, "node_modules"),
    "dir"
  )

  for (const relPath of relPaths) {
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
      relPath.replace(/^src\//, "").replace(/\.tsx?$/, ".js")
    )
    mkdirSync(dirname(outPath), { recursive: true })

    const depth = relPath.replace(/^src\//, "").split("/").length - 1
    const prefix = depth === 0 ? "./" : "../".repeat(depth)
    const rewritten = result.outputText
      .replace(/require\("@\/([^"]+)"\)/g, (_m, target) => `require("${prefix}${target}")`)
      .replace(/require\("\.\/src\/([^"]+)"\)/g, (_m, target) => `require("./${target}")`)
      .replace(/require\("server-only"\);?\s*/g, "")

    writeFileSync(outPath, rewritten, "utf8")
  }
}

function collectCssFiles(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectCssFiles(full))
    else if (entry.name.endsWith(".css")) out.push(full)
  }
  return out
}

function runSupabaseCliStatus() {
  return JSON.parse(
    execFileSync("npx", ["supabase", "status", "-o", "json"], {
      encoding: "utf8",
      env: { ...process.env, HOME: "/tmp" },
    })
  )
}

function runSql(sql) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_smart-rt",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-t",
      "-A",
    ],
    { input: sql, encoding: "utf8" }
  ).trim()
}

transpileIntoOutDir([
  "src/lib/security/headers.ts",
  "src/lib/supabase/config.ts",
  "src/lib/invitations/auth-flow.ts",
  "src/lib/finance/storage.ts",
  "src/lib/activities/constants.ts",
  "src/lib/activities/storage.ts",
  "src/lib/letters/constants.ts",
  "src/lib/letters/storage.ts",
  "src/lib/complaints/constants.ts",
  "src/lib/complaints/storage.ts",
])

const securityHeadersMod = require(join(OUT_DIR, "lib/security/headers.js"))
const supabaseConfigMod = require(join(OUT_DIR, "lib/supabase/config.js"))
const invitationFlowMod = require(join(OUT_DIR, "lib/invitations/auth-flow.js"))
const financeStorageMod = require(join(OUT_DIR, "lib/finance/storage.js"))
const activityStorageMod = require(join(OUT_DIR, "lib/activities/storage.js"))
const letterStorageMod = require(join(OUT_DIR, "lib/letters/storage.js"))
const complaintStorageMod = require(join(OUT_DIR, "lib/complaints/storage.js"))

test.after(() => {
  rmSync(OUT_DIR, { recursive: true, force: true })
})

test("BLOCKER-1: Production build script and .next static CSS contain compiled Tailwind v4 utilities without raw @apply", () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"))
  assert.equal(pkg.scripts.build, "next build")
  assert.equal(pkg.scripts.build.includes("--webpack"), false)

  const cssFiles = collectCssFiles(resolve(ROOT, ".next/static"))
  assert.ok(cssFiles.length > 0, "Expected built CSS chunks inside .next/static/")
  const combinedCss = cssFiles.map((f) => readFileSync(f, "utf8")).join("\n")

  assert.match(combinedCss, /\.flex\s*\{/)
  assert.match(combinedCss, /\.grid\s*\{/)
  assert.match(combinedCss, /--color-primary/)
  assert.equal(/@apply\b/.test(combinedCss), false, "Raw @apply must not remain in compiled CSS")
  assert.equal(/@theme\s+inline\b/.test(combinedCss), false, "Raw @theme inline must not remain in compiled CSS")
})

test("BLOCKER-2: Server Actions bodySizeLimit is >= 16mb and module upload validators enforce exact 5MiB/10MiB ceilings", async () => {
  const nextConfigSrc = readFileSync(resolve(ROOT, "next.config.ts"), "utf8")
  const match = nextConfigSrc.match(/bodySizeLimit:\s*"(\d+)mb"/)
  assert.ok(match, "bodySizeLimit must be configured in next.config.ts")
  assert.ok(Number(match[1]) >= 16, `Expected bodySizeLimit >= 16mb, got ${match[1]}mb`)

  const makeOversizedFile = (bytes, mime, name) => {
    const buf = new Uint8Array(bytes)
    if (mime === "application/pdf") {
      buf.set([0x25, 0x50, 0x44, 0x46, 0x2d])
    } else {
      buf.set([0xff, 0xd8, 0xff, 0xe0])
    }
    return new File([buf], name, { type: mime })
  }

  // Payment proof max 5 MiB
  const okPayment = await financeStorageMod.validatePaymentProofFile(
    makeOversizedFile(5 * 1024 * 1024, "image/jpeg", "proof.jpg")
  )
  assert.equal(okPayment.ok, true)
  const overPayment = await financeStorageMod.validatePaymentProofFile(
    makeOversizedFile(5 * 1024 * 1024 + 1, "image/jpeg", "proof.jpg")
  )
  assert.equal(overPayment.ok, false)

  // Complaint photo max 5 MiB
  const overComplaint = await complaintStorageMod.validateComplaintPhotoFile(
    makeOversizedFile(5 * 1024 * 1024 + 1, "image/jpeg", "photo.jpg")
  )
  assert.equal(overComplaint.ok, false)

  // Letter supporting doc max 5 MiB, issued letter PDF max 10 MiB
  const overLetterAtt = await letterStorageMod.validateLetterAttachmentFile(
    makeOversizedFile(5 * 1024 * 1024 + 1, "application/pdf", "kk.pdf")
  )
  assert.equal(overLetterAtt.ok, false)
  const okIssuedPdf = await letterStorageMod.validateIssuedLetterPdfFile(
    makeOversizedFile(10 * 1024 * 1024, "application/pdf", "surat.pdf")
  )
  assert.equal(okIssuedPdf.ok, true)
  const overIssuedPdf = await letterStorageMod.validateIssuedLetterPdfFile(
    makeOversizedFile(10 * 1024 * 1024 + 1, "application/pdf", "surat.pdf")
  )
  assert.equal(overIssuedPdf.ok, false)

  // Activity doc max 10 MiB
  const okActivityDoc = await activityStorageMod.validateActivityDocFile(
    makeOversizedFile(10 * 1024 * 1024, "application/pdf", "doc.pdf")
  )
  assert.equal(okActivityDoc.ok, true)
  const overActivityDoc = await activityStorageMod.validateActivityDocFile(
    makeOversizedFile(10 * 1024 * 1024 + 1, "application/pdf", "doc.pdf")
  )
  assert.equal(overActivityDoc.ok, false)
})

test("BLOCKER-3: Environment URL validation rejects /rest/v1/ suffix and .env.example contains only safe placeholders", () => {
  const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const prevKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co/rest/v1/"
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-placeholder"
    assert.equal(supabaseConfigMod.isSupabaseConfigured(), false)
    assert.throws(() => supabaseConfigMod.getSupabaseConfig(), /without \/rest\/v1/)

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
    assert.equal(supabaseConfigMod.isSupabaseConfigured(), true)
    assert.deepEqual(supabaseConfigMod.getSupabaseConfig(), {
      url: "https://example.supabase.co",
      anonKey: "anon-key-placeholder",
    })
  } finally {
    process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = prevKey
  }

  const envExample = readFileSync(resolve(ROOT, ".env.example"), "utf8")
  const envExampleAssignments = envExample
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0 && !line.trim().startsWith("#"))
    .join("\n")
  assert.equal(envExampleAssignments.includes("/rest/v1"), false)
  assert.equal(/sb_publishable_[A-Za-z0-9_]+/.test(envExample), false)
  assert.equal(/sb_secret_[A-Za-z0-9_]+/.test(envExample), false)
  assert.equal(/ezeegkqvpfuusihborap/.test(envExample), false)
  assert.equal(/^NEXT_PUBLIC_.*(SECRET|SERVICE_ROLE)/m.test(envExampleAssignments), false)
  assert.ok(envExample.includes("STORAGE_DELETION_WORKER_SECRET"))
  assert.ok(envExample.includes("SUPABASE_SERVICE_ROLE_KEY"))
})

test("BLOCKER-4: Invitation activation handles Confirm Email ON cleanly without account enumeration or broken redirects", () => {
  // Confirm Email OFF -> immediate session
  assert.deepEqual(
    invitationFlowMod.resolveActivationSignUpOutcome({
      signUpError: null,
      hasSignUpSession: true,
    }),
    { action: "redeem_now" }
  )

  // Confirm Email ON -> no session -> attempts signIn to differentiate confirmed owner vs unconfirmed
  assert.deepEqual(
    invitationFlowMod.resolveActivationSignUpOutcome({
      signUpError: null,
      hasSignUpSession: false,
    }),
    { action: "attempt_sign_in" }
  )

  // Unconfirmed new OR existing user -> guided confirmation step, never falls back to fake error
  const unconfirmedRes = invitationFlowMod.resolveActivationSignInOutcome({
    signInError: { code: "email_not_confirmed", message: "Email not confirmed" },
    hasSignInSession: false,
  })
  assert.equal(unconfirmedRes.action, "needs_email_confirmation")

  // Existing confirmed account with matching password -> immediate redeem
  assert.deepEqual(
    invitationFlowMod.resolveActivationSignInOutcome({
      signInError: null,
      hasSignInSession: true,
    }),
    { action: "redeem_now" }
  )

  // Wrong password -> neutral anti-enumeration copy (does not leak account existence)
  const wrongPwRes = invitationFlowMod.resolveActivationSignInOutcome({
    signInError: { code: "invalid_credentials", message: "Invalid login credentials" },
    hasSignInSession: false,
  })
  assert.equal(wrongPwRes.action, "fail")
  assert.equal(wrongPwRes.error.toLowerCase().includes("sudah terdaftar"), false)

  // Email redirect builder targets /auth/callback with safe encoded /activate-account next path
  const redirectUrl = invitationFlowMod.buildActivationEmailRedirectTo(
    "https://smart-rt.example.com/",
    "tok-abc-123"
  )
  assert.equal(
    redirectUrl,
    "https://smart-rt.example.com/auth/callback?next=%2Factivate-account%3Ftoken%3Dtok-abc-123"
  )
  assert.equal(
    invitationFlowMod.buildActivationEmailRedirectTo("javascript:alert(1)", "tok"),
    undefined
  )

  const callbackSrc = readFileSync(
    resolve(ROOT, "src/app/auth/callback/route.ts"),
    "utf8"
  )
  assert.ok(callbackSrc.includes("exchangeCodeForSession"))
  assert.ok(callbackSrc.includes("verifyOtp"))
  assert.ok(callbackSrc.includes("resolveSafeNextPath"))
})

test("WARNINGS 5, 6, 7, 8: /components is non-public & production-gated, global security headers exclude dev HSTS, payment proxy checks pending deletion, /api/health leaks nothing", () => {
  // 5. Public /components route removed from PUBLIC_PATHS and gated in production
  const mwSrc = readFileSync(resolve(ROOT, "src/lib/supabase/middleware.ts"), "utf8")
  assert.equal(mwSrc.includes('"/components"'), false)
  assert.ok(mwSrc.includes('"/auth/callback"'))
  assert.ok(mwSrc.includes('!pathname.startsWith("/api/")'))

  const compPageSrc = readFileSync(resolve(ROOT, "src/app/components/page.tsx"), "utf8")
  assert.ok(compPageSrc.includes('process.env.NODE_ENV === "production"'))
  assert.ok(compPageSrc.includes("notFound()"))

  // 6. Global security headers
  const prodHeaders = securityHeadersMod.buildGlobalSecurityHeaders(true)
  const devHeaders = securityHeadersMod.buildGlobalSecurityHeaders(false)
  const toMap = (arr) => Object.fromEntries(arr.map((h) => [h.key, h.value]))
  const prodMap = toMap(prodHeaders)
  const devMap = toMap(devHeaders)

  assert.equal(prodMap["X-Frame-Options"], "DENY")
  assert.equal(prodMap["X-Content-Type-Options"], "nosniff")
  assert.equal(prodMap["Referrer-Policy"], "strict-origin-when-cross-origin")
  assert.ok(prodMap["Permissions-Policy"].includes("camera=()"))
  assert.ok(prodMap["Strict-Transport-Security"].includes("max-age=31536000"))
  assert.equal(devMap["Strict-Transport-Security"], undefined)

  // 7. Payment proof proxy enforces pending deletion & retired path check
  const paymentProxySrc = readFileSync(
    resolve(ROOT, "src/app/api/payments/[id]/proof/route.ts"),
    "utf8"
  )
  assert.ok(paymentProxySrc.includes("is_storage_object_deletion_pending"))
  assert.ok(paymentProxySrc.includes("is_storage_object_path_retired"))
  assert.ok(paymentProxySrc.includes("paymentProofPathBelongsTo"))
  assert.ok(paymentProxySrc.includes("private, no-store"))
  assert.ok(paymentProxySrc.includes("X-Content-Type-Options"))
  assert.equal(paymentProxySrc.includes("createSignedUrl"), false)
  assert.equal(paymentProxySrc.includes("getPublicUrl"), false)

  // 8. /api/health leaks nothing & skips DB queries
  const healthSrc = readFileSync(resolve(ROOT, "src/app/api/health/route.ts"), "utf8")
  assert.ok(healthSrc.includes("isSupabaseConfigured"))
  assert.equal(healthSrc.includes("NEXT_PUBLIC_SUPABASE_URL"), false)
  assert.equal(healthSrc.includes(".from("), false)
  assert.equal(healthSrc.includes("service_role"), false)
})

test("Integration: Invitation replay, concurrent redemption, and payment-proof pending deletion RPC work safely on local DB", async () => {
  const status = runSupabaseCliStatus()
  const url = status.API_URL || "http://127.0.0.1:54321"
  const admin = createClient(url, status.SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const tag = Date.now()
  const pw = "TestPassword123!"
  const email = `prod.qa.${tag}@example.com`
  const rawToken = `tok_${crypto.randomBytes(24).toString("hex")}`
  const tokenHash = crypto.createHash("sha256").update(rawToken, "utf8").digest("hex")

  const { data: userRes, error: userErr } = await admin.auth.admin.createUser({
    email,
    password: pw,
    email_confirm: true,
  })
  assert.ifError(userErr)
  const uid = userRes.user.id
  let tid = null
  let objPath = null

  try {
    tid = runSql(`
      WITH t AS (
        INSERT INTO public.tenants (code, name, rt_number, rw_number, kelurahan, kecamatan, city, province, status)
        VALUES ('rt-prod-${tag}', 'RT Prod QA', '01', '01', 'K', 'K', 'B', 'J', 'active')
        RETURNING id
      ),
      hh AS (
        INSERT INTO public.households (tenant_id, kk_number, address, status)
        VALUES ((SELECT id FROM t), '3273010101010777', 'Jl Test 1', 'active')
        RETURNING id
      ),
      res AS (
        INSERT INTO public.residents (tenant_id, household_id, full_name, gender, family_role, residency_status)
        VALUES ((SELECT id FROM t), (SELECT id FROM hh), 'Warga Prod', 'L', 'kepala_keluarga', 'aktif')
        RETURNING id
      ),
      du AS (
        INSERT INTO public.dues (tenant_id, name, amount, billing_cycle, target_scope, is_active)
        VALUES ((SELECT id FROM t), 'Iuran QA', 50000, 'monthly', 'household', true)
        RETURNING id
      ),
      bi AS (
        INSERT INTO public.bills (tenant_id, due_id, household_id, period_year, period_month, amount, due_date, status)
        VALUES ((SELECT id FROM t), (SELECT id FROM du), (SELECT id FROM hh), 2026, 11, 50000, current_date + 7, 'pending_verification')
        RETURNING id
      )
      SELECT (SELECT id FROM t)::text;
    `)
    const resId = runSql(`SELECT id::text FROM public.residents WHERE tenant_id='${tid}' LIMIT 1;`)
    const billId = runSql(`SELECT id::text FROM public.bills WHERE tenant_id='${tid}' LIMIT 1;`)
    const payId = crypto.randomUUID()
    objPath = `${tid}/${payId}/${crypto.randomUUID()}.jpg`

    runSql(`
      INSERT INTO public.resident_invitations (tenant_id, resident_id, email, token_hash, status, expires_at)
      VALUES ('${tid}', '${resId}', '${email}', '${tokenHash}', 'pending', now() + interval '7 days');
    `)

    // Sign in two independent client sessions for the confirmed user to test concurrent replay
    const signInClient = async () => {
      const c = createServerClient(url, status.ANON_KEY, {
        cookies: { getAll: () => [], setAll: () => {} },
      })
      const { error } = await c.auth.signInWithPassword({ email, password: pw })
      assert.ifError(error)
      return c
    }

    const [c1, c2] = await Promise.all([signInClient(), signInClient()])
    const [r1, r2] = await Promise.all([
      c1.rpc("redeem_resident_invitation", { p_token: rawToken }),
      c2.rpc("redeem_resident_invitation", { p_token: rawToken }),
    ])

    const okCount = [r1, r2].filter((r) => !r.error).length
    const failCount = [r1, r2].filter((r) => Boolean(r.error)).length
    assert.equal(okCount, 1, "Exactly one concurrent invitation redemption must succeed")
    assert.equal(failCount, 1, "Second concurrent/replay redemption must be rejected")

    // Now that uid is an active tenant member, create payment and verify pending-deletion RPC
    runSql(`
      INSERT INTO public.payments (id, tenant_id, bill_id, paid_by_user_id, amount, payment_method, status)
      VALUES ('${payId}', '${tid}', '${billId}', '${uid}', 50000, 'transfer', 'pending');
    `)

    // Verify pending-deletion RPC flags queued payment-proof object cleanly
    const { error: upErr } = await admin.storage
      .from("payment-proofs")
      .upload(objPath, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), {
        contentType: "image/jpeg",
      })
    assert.ifError(upErr)
    const { error: attErr } = await c1.rpc("attach_payment_proof", {
      p_payment_id: payId,
      p_storage_path: objPath,
    })
    assert.ifError(attErr)

    const beforeQueue = await c1.rpc("is_storage_object_deletion_pending", {
      p_bucket_id: "payment-proofs",
      p_object_path: objPath,
    })
    assert.equal(beforeQueue.data, false)

    runSql(`
      INSERT INTO public.storage_deletion_queue (tenant_id, bucket_id, object_path, entity_type, entity_id, reason, status)
      VALUES ('${tid}', 'payment-proofs', '${objPath}', 'payment', '${payId}', 'test_pending_deletion', 'pending');
    `)

    const duringQueue = await c1.rpc("is_storage_object_deletion_pending", {
      p_bucket_id: "payment-proofs",
      p_object_path: objPath,
    })
    assert.equal(duringQueue.data, true)
  } finally {
    if (objPath) {
      await admin.storage.from("payment-proofs").remove([objPath]).catch(() => {})
    }
    if (tid) {
      runSql(`
        DELETE FROM public.audit_logs WHERE tenant_id='${tid}';
        DELETE FROM public.storage_deletion_queue WHERE tenant_id='${tid}';
        DELETE FROM public.payments WHERE tenant_id='${tid}';
        DELETE FROM public.bills WHERE tenant_id='${tid}';
        DELETE FROM public.dues WHERE tenant_id='${tid}';
        DELETE FROM public.resident_invitations WHERE tenant_id='${tid}';
        DELETE FROM public.member_roles WHERE tenant_id='${tid}';
        DELETE FROM public.tenant_members WHERE tenant_id='${tid}';
        DELETE FROM public.residents WHERE tenant_id='${tid}';
        DELETE FROM public.households WHERE tenant_id='${tid}';
        DELETE FROM public.tenants WHERE id='${tid}';
      `)
    }
    await admin.auth.admin.deleteUser(uid)
  }
})
