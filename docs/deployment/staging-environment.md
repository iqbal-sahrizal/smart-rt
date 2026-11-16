# Smart RT — Railway Staging Environment & Isolation Guide

Dokumen ini mendefinisikan konfigurasi environment, isolasi infrastruktur, dan checklist keamanan untuk deployment **staging Smart RT di Railway** menggunakan Node.js 22 LTS container dan backend terpisah di **Supabase Cloud (project staging)**.

> **Scope Step 16.2:** Dokumen ini hanya berlaku untuk environment **staging**. Jangan menyalin credential production, jangan mengaktifkan deployment production, dan jangan menghubungkan aplikasi staging ke database lokal atau database production.

---

## 1. Arsitektur Staging

| Komponen | Platform / Runtime | Peran di Staging |
|---|---|---|
| **Web Application (Next.js 16 App Router)** | Railway Service (`smart-rt-web`) via `Dockerfile` (`node:22-bookworm-slim`) | Menjalankan `next start -H 0.0.0.0` pada `$PORT`, melayani SSR, Server Actions (`bodySizeLimit: "16mb"`), private storage proxy routes, dan `GET /api/health`. |
| **Database, Auth, Storage, Scheduler** | Supabase Cloud Project terpisah (`smart-rt-staging`) | Menyediakan PostgreSQL + RLS, Auth, Private Storage buckets, dan `pg_cron` / Vault scheduler. |
| **Background Storage Workers** | Supabase Edge Functions (`storage-deletion-worker`, `storage-orphan-scan`) | Memproses antrean penghapusan storage object dan orphan scan di dalam project Supabase staging. |

Konfigurasi deployment Railway didefinisikan melalui:
- [Dockerfile](../../Dockerfile) — Multi-stage build Node.js 22 LTS, non-root user (`nextjs:nodejs`), tanpa `output: "standalone"` dan tanpa `--webpack`.
- [.dockerignore](../../.dockerignore) — Memblokir `.env*`, `node_modules`, `.next`, `.git`, `tests/`, `supabase/`, dan `docs/` dari build context.
- [railway.toml](../../railway.toml) — `builder = "DOCKERFILE"`, `healthcheckPath = "/api/health"`, `restartPolicyType = "ON_FAILURE"`, tanpa `preDeployCommand`.

---

## 2. Environment Variables Matrix (Staging)

Semua variabel dipisahkan secara ketat berdasarkan batas eksekusi dan tingkat kerahasiaannya. **Jangan pernah menempatkan `SUPABASE_SERVICE_ROLE_KEY` atau `STORAGE_DELETION_WORKER_SECRET` di Railway Web Service maupun dengan prefix `NEXT_PUBLIC_`.**

### 2.1 Public Client & Next.js App Variables (Railway Web Service — `staging`)

Variabel ini aman untuk di-bundle ke browser client karena tunduk pada RLS PostgreSQL dan Storage policies, **tetapi tetap wajib diisi sebelum build container** (`ARG` saat `docker build` + `ENV` saat runtime):

| Variable | Wajib | Build Time | Runtime | Sumber / Ketentuan Staging |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Ya | **Ya** (inlined untuk `createBrowserClient`) | **Ya** (`isSupabaseConfigured()`, SSR/Proxy) | URL origin Supabase **staging** (contoh: `https://<staging-project-ref>.supabase.co`). **Dilarang** menyertakan suffix `/rest/v1/`. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Ya | **Ya** (inlined untuk `createBrowserClient`) | **Ya** (`isSupabaseConfigured()`, SSR/Proxy) | Public `anon` / publishable key milik project Supabase **staging**. Jangan pernah mengisi `service_role` key. |

> **Catatan Railway Docker Build:** Railway secara otomatis meneruskan Service Variables sebagai Docker `--build-arg` ke `Dockerfile` yang mendeklarasikan `ARG NEXT_PUBLIC_SUPABASE_URL` dan `ARG NEXT_PUBLIC_SUPABASE_ANON_KEY`. Karena itu kedua variabel ini wajib sudah terisi di Railway `staging` service sebelum deploy pertama dijalankan.

### 2.2 Server-only Next.js Runtime Variables (Railway Web Service — `staging`)

| Variable | Wajib | Diatur Oleh | Keterangan |
|---|---|---|---|
| `NODE_ENV` | Ya | `Dockerfile` (`ENV NODE_ENV=production`) | Mengaktifkan header keamanan HTTPS `Strict-Transport-Security` di `src/lib/security/headers.ts` dan memastikan `/components` UI preview route dinonaktifkan. |
| `PORT` | Otomatis | Railway platform injection (`Dockerfile` fallback `3000`) | Railway menyuntikkan `PORT` secara dinamis. `startCommand` menggunakan `node node_modules/next/dist/bin/next start -H 0.0.0.0`, sehingga Next.js otomatis mendengarkan `0.0.0.0:$PORT`. |

**Konfirmasi Keamanan App Runtime:**
- Kode aplikasi di `src/` tidak membaca `SUPABASE_SERVICE_ROLE_KEY` maupun `STORAGE_DELETION_WORKER_SECRET`.
- Seluruh upload/download private document berjalan melalui authenticated proxy route & Server Actions di atas session user + RLS (`bodySizeLimit: "16mb"` pada `next.config.ts` untuk batas file `10 MiB` + multipart overhead).

### 2.3 Supabase Edge Functions Variables (Supabase Staging Project Secrets — BUKAN di Railway)

Dikonfigurasi hanya pada project Supabase staging melalui **Supabase Dashboard -> Edge Functions -> Secrets** atau CLI `supabase secrets set` (tidak pernah di `.env.local` app atau Railway):

| Variable | Wajib | Nilai / Ketentuan Staging |
|---|---|---|
| `SUPABASE_URL` | Ya | URL project Supabase staging (`https://<staging-project-ref>.supabase.co`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Ya | `service_role` secret khusus project Supabase **staging**. |
| `STORAGE_DELETION_WORKER_SECRET` | Ya | Secret acak unik untuk staging minimal **32 UTF-8 bytes** (misal hasil `openssl rand -hex 32`). Jangan gunakan ulang secret lokal atau production. |

Variabel opsional tuning worker / orphan scan (default sudah aman, lihat [`.env.example`](../../.env.example)):
- `WORKER_BATCH_SIZE` (`10`)
- `WORKER_LEASE_SECONDS` (`300`)
- `WORKER_STORAGE_TIMEOUT_MS` (`60000`)
- `WORKER_DB_TIMEOUT_MS` (`10000`)
- `WORKER_RENEW_MARGIN_MS` (`120000`)
- `WORKER_MAX_JOBS_PER_INVOCATION` (`50`)
- `WORKER_INVOCATION_TIMEOUT_MS` (`110000`)
- `WORKER_ORPHAN_RETENTION_HOURS` (`24`)
- `WORKER_ORPHAN_SCAN_LIMIT` (`100`)
- `ORPHAN_LEASE_RENEW_THRESHOLD_MS` (`120000`)
- `ORPHAN_DOMAIN_RETENTION_DAYS` (`7`)
- `ORPHAN_DOMAIN_RETENTION_LIMIT` (`100`)

### 2.4 Supabase Vault / Scheduler Variables (Supabase Staging `vault.secrets`)

Digunakan oleh `pg_cron` / scheduler Edge Function (`supabase/ops/storage-scheduler-setup.sql`) pada tahap konfigurasi Supabase staging:

| Vault Secret Name | Wajib | Nilai Staging |
|---|---|---|
| `STORAGE_ORPHAN_SCAN_URL` | Ya | `https://<staging-project-ref>.supabase.co/functions/v1/storage-orphan-scan` |
| `STORAGE_DELETION_WORKER_SECRET` | Ya | Harus identik dengan `STORAGE_DELETION_WORKER_SECRET` pada Edge Functions project staging. |

---

## 3. Panduan Isolasi Staging (Railway & Supabase)

### 3.1 Struktur Railway (Staging Only)

1. Buat Railway Project bernama **`Smart RT`**.
2. Di dalam project tersebut, siapkan **environment `staging`** saja terlebih dahulu. **Jangan membuat atau men-deploy environment `production` pada tahap ini.**
3. Tambahkan satu web service (`smart-rt-web`) yang terhubung ke repository Git pada **dedicated branch `staging`** (`Build -> Dockerfile`, terkonfigurasi lewat `railway.toml`).
   - *Catatan status Git saat ini:* repository lokal baru memiliki branch `main` dan belum memiliki remote origin. Buat remote repository dan push branch `staging` sebelum mengaktifkan auto-deploy Railway.
4. Jangan menambahkan Railway PostgreSQL plugin atau Railway cron service — PostgreSQL dan cron scheduler sepenuhnya dikelola di project Supabase Cloud staging.
5. Jangan menambahkan `preDeployCommand` migrasi otomatis di Railway (`railway.toml` sengaja tidak mendefinisikan `preDeployCommand`). Migrasi database dilakukan terpisah dan terkontrol melalui workflow Supabase CLI.
6. Pastikan Healthcheck Railway diarahkan ke `/api/health`:
   - Saat env Supabase lengkap: HTTP `200`, `{"status":"ok","configured":true}`, `Cache-Control: no-store`.
   - Saat env Supabase belum terisi / invalid: HTTP `503`, `{"status":"degraded","configured":false}`, `Cache-Control: no-store`.
   - Tidak ada nama/nilai environment variable, stack trace, atau kredensial yang dikembalikan pada response body.

### 3.2 Isolasi Supabase Staging Project

- Buat project Supabase Cloud baru yang didedikasikan khusus untuk staging (misal `smart-rt-staging`).
- Pastikan project staging **100% terpisah** dari environment lokal (`127.0.0.1:54321`) maupun project production masa depan:
  - URL project (`NEXT_PUBLIC_SUPABASE_URL`) berbeda.
  - `anon` key, `service_role` key, database password, dan JWT secret berbeda.
  - `STORAGE_DELETION_WORKER_SECRET` di-generate ulang khusus untuk staging.
  - Supabase Auth **Site URL** dan **Redirect URLs** hanya mengizinkan domain Railway staging (`https://<smart-rt-staging-domain>.up.railway.app/**`).

---

## 4. Checklist Sebelum Deploy Pertama ke Staging

1. [ ] Remote repository Git dibuat dan branch `staging` telah di-push.
2. [ ] Project Supabase Cloud `smart-rt-staging` tersedia (schema/migration staging akan disiapkan pada tahap berikutnya).
3. [ ] Railway Project `Smart RT` -> Environment `staging` -> Service `smart-rt-web` terhubung ke branch `staging`.
4. [ ] Railway Service Variables terisi:
   - `NEXT_PUBLIC_SUPABASE_URL` (staging URL tanpa `/rest/v1/`)
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (staging anon key)
   - Pastikan **tidak ada** `SUPABASE_SERVICE_ROLE_KEY`, `.env.local` value, atau URL local `127.0.0.1` di Railway.
5. [ ] Supabase Staging Edge Function Secrets & Vault Secrets siap (`SUPABASE_SERVICE_ROLE_KEY`, `STORAGE_DELETION_WORKER_SECRET`, `STORAGE_ORPHAN_SCAN_URL`).
6. [ ] Verifikasi pasca-deploy hanya menembak `GET https://<staging-domain>/api/health` (`200 ok`) dan login/smoke test menggunakan akun uji staging (bukan data warga asli).

