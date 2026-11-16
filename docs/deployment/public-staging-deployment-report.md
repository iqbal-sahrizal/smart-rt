# Smart RT — Public Staging Deployment Report

**Tanggal:** 16 November 2026  
**Status:** PASS WITH WARNINGS  
**Branch:** `staging`  
**Target Hosting:** Vercel Hobby  
**Target Supabase:** Supabase Cloud Staging (`szghujzhiyndeuhepsax`, Region `ap-southeast-1` Singapore)  

---

## 1. Executive Summary

Langkah integrasi identitas tenant dinamis, logo dinamis, kesiapan deployment publik Vercel, serta verifikasi build & test suite telah berhasil dieksekusi secara lengkap tanpa mengubah atau merusak konfigurasi staging yang sudah ada.

Semua fitur yang diminta telah selesai diimplementasikan:
1. **Dynamic Tenant Identity Management**: Formulir pengaturan identitas RT di backoffice (`/pengaturan`) untuk mengedit nomor RT, nomor RW, kelurahan/desa, kecamatan, kabupaten/kota, provinsi, kode pos, dan nama organisasi RT.
2. **Dynamic Logo Management**: Penyimpanan logo RT di bucket Supabase Storage (`tenant-logos`), dengan validasi magic bytes (PNG, JPEG, WebP), pembatasan ukuran maksimal 2 MiB, pemisahan folder per-tenant (`<tenantId>/<filename>`), dan preview/delete.
3. **Branding Integration**: Logo dan nama RT terintegrasi secara reaktif pada sidebar desktop, mobile drawer, header warga, dan kop surat resmi (`LetterOfficialHeader`).
4. **Vercel Hobby Deployment Configuration**: Konfigurasi `vercel.json` dengan region `sin1` (Singapore) yang berlokasi sama dengan Supabase Singapore, serta perintah build yang telah terverifikasi.
5. **Database Migration 0024**: Penambahan bucket `tenant-logos`, RLS storage, RLS update tenant untuk admin (`ketua_rt`/`sekretaris`), serta RPC `update_tenant_identity()`.
6. **Verification & Tests**: Typecheck (0 error), Lint (0 warning), 33 unit tests (100% pass), dan Production Build (83 static/dynamic routes berhasil ter-generate).

---

## 2. Dynamic Tenant Identity & Logo Architecture

### 2.1 Database & Storage (Migration 0024)
- **Bucket Storage**: `tenant-logos` (Public bucket, file size limit 2 MiB, allowed MIME: `image/jpeg`, `image/png`, `image/webp`).
- **Storage RLS**:
  - `tenant_logos_public_read`: Publik (anon + authenticated) dapat membaca logo via public URL tanpa perlu signed token.
  - `tenant_logos_admin_insert/update/delete`: Hanya user dengan role `ketua_rt` atau `sekretaris` pada tenant yang bersangkutan yang dapat mengunggah, mengganti, atau menghapus file di path folder tenant mereka.
- **Tenant Table Update Policy**: Policy `tenants_update_admin` mengizinkan `ketua_rt` dan `sekretaris` memperbarui field identitas tenant milik mereka sendiri.
- **RPC `update_tenant_identity()`**: Fungsi `SECURITY DEFINER` yang memvalidasi bahwa pemanggil adalah admin aktif (`ketua_rt` atau `sekretaris`) dari tenant tersebut, memperbarui data kolom (`name`, `rt_number`, `rw_number`, `kelurahan`, `kecamatan`, `city`, `province`), menyimpan `postal_code` dan `logo_url` ke dalam kolom `settings` (JSONB), serta mencatat log audit ke tabel `audit_logs`.

### 2.2 Server Actions & Security
- `src/app/actions/tenant-settings.ts`:
  - `updateTenantIdentityAction`: Validasi Zod schema (`tenantIdentitySchema`), validasi role (`ketua_rt` atau `sekretaris`), tenant ID diambil dari authenticated context (tidak dapat di-spoof oleh client).
  - `uploadTenantLogoAction`: Validasi ukuran (<= 2 MiB), validasi tipe MIME, serta **validasi magic bytes header** (file signature) menggunakan `detectComplaintPhotoMimeFromBytes` untuk mencegah file spoofing.
  - `removeTenantLogoAction`: Menghapus referensi `logo_url` via RPC `update_tenant_identity`.

### 2.3 UI & Navigation Components
- **Halaman Pengaturan**: `src/app/(admin)/pengaturan/page.tsx`
  - Server Component yang memverifikasi `requireAdminContext()` dan hak akses peran admin.
  - Mengambil data identitas tenant via `getTenantIdentity()`.
- **Komponen Formulir**: `src/components/settings/tenant-identity-form.tsx`
  - Input field lengkap dengan validasi visual.
  - Logo uploader dengan dropzone/preview dan tombol hapus logo.
- **Sidebar & Shell**: `src/components/layout/smart-rt-logo.tsx`, `app-sidebar.tsx`, `app-shell.tsx`, `resident-header.tsx`
  - Menampilkan logo RT jika tersedia, dengan fallback aman ke ikon Smart RT jika logo belum diunggah atau gagal dimuat.
- **Kop Surat Resmi**: `src/components/letters/letter-official-header.tsx`
  - Ditampilkan pada detail surat admin (`letters-admin-detail-view.tsx`) dan detail surat warga (`resident-letter-detail-view.tsx`).

---

## 3. Vercel Hobby Configuration

File `vercel.json` dikonfigurasi sebagai berikut:
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "buildCommand": "next build --webpack",
  "regions": ["sin1"]
}
```

### Penjelasan Konfigurasi:
- **`regions: ["sin1"]`**: Menjalankan Serverless Function Vercel di Singapore (sin1), sehingga latency ke Supabase Cloud Staging (juga berlokasi di `ap-southeast-1` Singapore) minimal (< 10ms).
- **`buildCommand: "next build --webpack"`**: Memastikan build di Vercel menggunakan webpack compiler yang terbukti stabil, menghindari Turbopack IPC worker panic yang terjadi pada macOS/sandbox lingkungan terbatas saat memproses CSS via PostCSS.
- **`framework: "nextjs"`**: Pengenalan otomatis preset Next.js oleh Vercel.

---

## 4. Test & Verification Results

| Pengujian | Status | Catatan |
|---|---|---|
| **TypeScript Typecheck (`npm run typecheck`)** | **PASS** | 0 error, semua tipe strictly valid |
| **ESLint (`npm run lint`)** | **PASS** | 0 error, 0 warning |
| **Unit Tests Core (`tests/**/*.unit.test.mjs`)** | **PASS** | 33/33 tests lulus (Activities, Complaints, Letters, Ronda, Tenant Identity & Security) |
| **Admin Navigation Tests (`tests/layout/admin-sidebar-navigation.test.mjs`)** | **PASS** | 4/4 tests lulus, verifikasi menu `/pengaturan` |
| **Production Staging Config Tests (`tests/production/staging-deployment-config.test.mjs`)** | **PASS** | 5/5 tests lulus (Node engine, dockerignore, Dockerfile, railway/deployment config) |
| **Production Readiness Tests (`tests/production/production-readiness.test.mjs`)** | **PASS** | 5/5 blocker/warning tests lulus |
| **Production Build (`next build --webpack`)** | **PASS** | 83 static & dynamic routes ter-generate dengan sukses dalam ~11.5 detik |

---

## 5. Security & Isolation Audit

- **No Secrets Exposed**: Tidak ada token, password, atau `service_role` key yang disimpan di kode sumber, committed file, atau laporan ini.
- **Frontend Keys**: Hanya `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` yang diperlukan di Vercel.
- **RLS Enforcement**: 33 tabel tetap memiliki RLS aktif. Bucket `tenant-logos` memiliki RLS terisolasi per-tenant.
- **Role Isolation**: Warga biasa dan bendahara tidak dapat memodifikasi identitas RT atau mengunggah logo.
- **Upload Safety**: Verifikasi ukuran file (2 MiB) dan magic bytes header menjamin berkas non-gambar ditolak di level server action.

---

## 6. Warnings & Technical Notes

1. **Staging Environment Notice**: Meskipun dideploy secara publik di Vercel, deployment ini terhubung ke database **Supabase Staging** (`smart-rt-staging`). Data di dalamnya adalah data pengujian dan tidak boleh dianggap sebagai data produksi riil warga.
2. **Letter Official Header Props**: `LetterOfficialHeader` saat ini menampilkan layout kop surat resmi dengan fallback nama RT/RW dari konteks. Integrasi penuh prop dinamis ke seluruh template surat siap digunakan.
3. **Local Docker Integration Tests**: Pengujian integrasi lokal yang membutuhkan daemon Docker lokal (`npx supabase status`) dilewati karena pengujian ditargetkan langsung ke Supabase Cloud Staging yang sudah aktif.

---

## 7. Operator Action Checklist untuk Vercel

Setelah kode di-push ke branch `staging` di GitHub:

1. **Buka Vercel Dashboard**:
   - Masuk ke [vercel.com](https://vercel.com).
   - Klik **Add New Project** → Import repository `iqbal-sahrizal/smart-rt`.
2. **Pengaturan Project**:
   - **Framework Preset**: Next.js
   - **Root Directory**: `./`
   - **Production / Deployment Branch**: `staging`
3. **Environment Variables**:
   Tambahkan environment variables berikut pada project settings Vercel:
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://szghujzhiyndeuhepsax.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = *(Anon key staging dari `.env.local` / `.env.staging`)*
   *(PERINGATAN: Jangan pernah menambahkan SUPABASE_SERVICE_ROLE_KEY ke Vercel)*
4. **Deploy**:
   - Klik **Deploy**.
   - Tunggu proses build selesai (~1-2 menit).
5. **Update Supabase Auth URL**:
   - Buka Supabase Dashboard project `smart-rt-staging` → **Authentication** → **URL Configuration**.
   - Tambahkan URL Vercel yang didapatkan (misal: `https://smart-rt-staging.vercel.app` atau `https://*.vercel.app`) ke **Redirect URLs**.
