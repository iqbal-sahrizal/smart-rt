# Smart RT — Step 16.3 Phase 5: Remote Compatibility Audit (`smart-rt-staging`)

**Tanggal:** 2026-11-16  
**Target Project:** `smart-rt-staging` (`szghujzhiyndeuhepsax`, `ap-southeast-1`)  
**PostgreSQL Remote:** `PostgreSQL 17.11 on aarch64-unknown-linux-gnu` (`17.11.0.019`)  
**Status Akhir:** **`PASS WITH WARNINGS`**

> **Mode Audit (Read-Only Only):** Seluruh pemeriksaan ke remote database dijalankan menggunakan `npx supabase db query --remote=szghujzhiyndeuhepsax --read-only` (dieksekusi sebagai `supabase_read_only_user` dalam transaksi read-only). Tidak ada migrasi yang diterapkan, tidak ada `db push` tanpa `--dry-run`, tidak ada `repair`, `reset`, `seed`, maupun perubahan schema/privilege/data.

---

## Ringkasan Eksekutif

- Seluruh 23 file migrasi lokal (`20261113000100` s.d. `20261116002300`) **kompatibel secara struktural dan eksekusi** dengan `smart-rt-staging` (PostgreSQL `17.11` + `supautils 4.0.0`).
- Kolom Storage baru yang dibutuhkan (`storage.buckets.versioning_status`, `storage.objects.archived_at`, `storage.objects.is_delete_marker`), default kolom `storage.buckets.type` (`'STANDARD'::storage.buckettype`), delegasi kebijakan RLS (`supautils.policy_grants`), serta izin trigger `auth.users` (`TRIGGER` + `supautils.drop_trigger_grants`) **seluruhnya terkonfirmasi tersedia** di remote.
- Ditemukan **3 warning non-blocking** — terutama perilaku PostgreSQL saat role `postgres` mengeksekusi `REVOKE ALL ON storage.buckets/objects` pada tabel milik `supabase_storage_admin`, serta perbedaan major version lokal (`15`) vs remote (`17.11`).

---

## 1. Storage Compatibility Audit

**Migrasi diaudit:**
- `20261114001500_storage_and_atomic_rpcs.sql` (baris 21–44, 351–355, 473–754)
- `20261116002300_activities_security_gap_closure.sql` (baris 428–469)

### Bukti Hasil Pemeriksaan System Catalog Remote (`szghujzhiyndeuhepsax`)

1. **Struktur Kolom & Default `storage.buckets` dan `storage.objects`:**
   - `storage.buckets.versioning_status`: **Ada** (`text`, `NOT NULL`, `DEFAULT 'DISABLED'::text`).
   - `storage.buckets.type`: **Ada** (`USER-DEFINED` `storage.buckettype`, `NOT NULL`, `DEFAULT 'STANDARD'::storage.buckettype`) — sehingga `INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types, versioning_status)` pada migrasi `0015:21` valid tanpa perlu menyebut kolom `type`.
   - `storage.objects.archived_at`: **Ada** (`timestamp with time zone`, nullable `YES`).
   - `storage.objects.is_delete_marker`: **Ada** (`boolean`, `NOT NULL`, `DEFAULT false`).
   - Bucket eksisting di remote: `0` (`storage_buckets_count = 0`); policy eksisting di schema `storage`: `0` (`storage_policies = []`).

2. **Ownership, Privilege & `supautils.policy_grants`:**
   - Pemilik `storage.buckets` & `storage.objects`: **`supabase_storage_admin`** (`postgres_is_storage_admin = false`).
   - ACL eksisting pada kedua tabel:
     `{supabase_storage_admin=a*r*w*d*D*x*t*m*/supabase_storage_admin, service_role=arwdDxtm/supabase_storage_admin, authenticated=arwd/supabase_storage_admin, anon=arwd/supabase_storage_admin, postgres=a*r*w*d*D*x*t*m*/supabase_storage_admin}`.
   - Privilege role `postgres`: `has_buckets_all = true`, `has_objects_all = true`, `USAGE` (with grant option `U*`) pada schema `storage`.
   - RLS status remote: `relrowsecurity = true` (aktif), `relforcerowsecurity = false` pada kedua tabel.
   - Konfigurasi `supautils 4.0.0`: `supautils.policy_grants` secara eksplisit mengizinkan `postgres` mengelola RLS policy pada `"storage.buckets"` dan `"storage.objects"`; `supautils.drop_trigger_grants` juga mencakup `"storage.buckets"` dan `"storage.objects"`.

### Temuan Storage Compatibility

| ID | File & Baris | Operasi | Bukti & Dampak | Tindakan Manual | Rekomendasi |
|---|---|---|---|---|---|
| **STG-01 (WARNING — Non-Fatal / ACL)** | `20261114001500_storage_and_atomic_rpcs.sql:42-44` | `REVOKE ALL ON storage.buckets FROM anon;`<br>`REVOKE ALL ON storage.objects FROM anon;`<br>`REVOKE UPDATE, DELETE ON storage.objects FROM authenticated;` | Grant `anon=arwd` dan `authenticated=arwd` pada remote diberikan oleh `supabase_storage_admin`, sedangkan migrasi berjalan sebagai `postgres` (`postgres_is_storage_admin = false`). Dalam PostgreSQL, `REVOKE` oleh non-owner/non-grantor memunculkan `WARNING: no privileges could be revoked` (tidak menggagalkan transaksi), namun grant tabel-level `anon=arwd` & `authenticated=arwd` berpotensi tetap ada. Mitigasi: RLS (`relrowsecurity = true`) tetap memblokir `anon` (0 policy) dan membatasi `authenticated` hanya pada policy `INSERT`/`SELECT`. | Opsional pasca-push (verifikasi ACL) | Tidak perlu mengubah file migrasi lama. Setelah `db push` nanti disetujui, cek ulang `relacl` pada `storage.buckets` dan `storage.objects` (serta konfirmasi via test RLS bahwa `anon` & `authenticated` UPDATE/DELETE tetap ditolak). |
| **STG-02 (PASS)** | `20261114001500:21-39, 351-355, 473-754` & `20261116002300:428-469` | Bucket seeding + `CREATE/DROP POLICY` pada `storage.objects` + filter `archived_at IS NULL AND is_delete_marker = false` | Kolom `versioning_status`, `archived_at`, `is_delete_marker` dan default `type` seluruhnya cocok. `supautils.policy_grants` mengizinkan `postgres` membuat/menghapus policy pada `storage.objects`. `postgres` memiliki `INSERT`/`UPDATE`/`SELECT` pada `storage.buckets` & `storage.objects`. | Tidak | Lanjutkan sebagaimana adanya. |

---

## 2. Auth Trigger Compatibility Audit

**Migrasi diaudit:**
- `20261113000800_create_database_functions.sql` (baris 16–38: `public.handle_new_user()`)
- `20261113000900_create_database_triggers.sql` (baris 73–76: `trg_auth_users_create_profile`)

### Bukti Hasil Pemeriksaan System Catalog Remote (`szghujzhiyndeuhepsax`)

1. **Struktur Kolom `auth.users`:**
   - Kolom yang digunakan `handle_new_user()` terkonfirmasi ada: `id` (`uuid`), `email` (`character varying`), `phone` (`text`), `raw_user_meta_data` (`jsonb`).
   - Kolom tambahan terverifikasi: `confirmed_at`, `email_confirmed_at`, `deleted_at` (`timestamp with time zone`).
2. **Trigger Eksisting & Risiko Konflik:**
   - `auth_users_triggers = []` (`0` non-internal trigger terpasang saat ini). Tidak ada konflik nama `trg_auth_users_create_profile`.
3. **Function Target Trigger:**
   - `public.handle_new_user()` dibuat di migrasi `0008` sebelum trigger di migrasi `0009`, dengan atribut aman: `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `ON CONFLICT (id) DO NOTHING`, serta `REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;`.
   - `public_functions = []` di remote (belum ada duplikasi fungsi).
4. **Privilege Schema `auth` & `auth.users`:**
   - Owner `auth.users`: `supabase_auth_admin` (`postgres_is_auth_admin = false`).
   - ACL `auth.users`: `{..., postgres=ar*wdDxtm/supabase_auth_admin}` — mencakup bit `t` (`TRIGGER`).
   - Pemeriksaan langsung: `has_auth_usage = true` dan `has_auth_users_trigger = true` untuk role `postgres`.
   - `supautils.drop_trigger_grants` juga mengizinkan `postgres` menjatuhkan/mengelola trigger di `"auth.users"`.

### Temuan Auth Trigger Compatibility

| ID | File & Baris | Operasi | Bukti & Dampak | Tindakan Manual | Rekomendasi |
|---|---|---|---|---|---|
| **AUTH-01 (PASS)** | `20261113000800:16-38` & `20261113000900:73-76` | `CREATE TRIGGER trg_auth_users_create_profile AFTER INSERT ON auth.users ...` | Role `postgres` memiliki `USAGE` pada schema `auth` dan `TRIGGER` (`t`) pada `auth.users`, semua kolom yang direferensikan tersedia, dan belum ada trigger bertabrakan. | Pasca-push verifikasi | Setelah migrasi diterapkan nanti, verifikasi trigger terdaftar di `pg_trigger` untuk `auth.users` dan uji pembuatan user baru mengisi `public.profiles`. |

---

## 3. PostgreSQL Version Compatibility Audit (`15` Lokal vs `17.11` Remote)

### Perbandingan Konfigurasi & Environment

| Aspek | Lokal (`supabase/config.toml`) | Remote (`smart-rt-staging`) | Status Kompatibilitas |
|---|---|---|---|
| **PostgreSQL Major Version** | `15` (`config.toml:16`) | **`17.11`** (`17.11.0.019`) | **WARNING (Minor Drift)** — tidak ada sintaks terblokir, tetapi versi lokal lebih tua. |
| **Schema `public` Ownership (PG15+ Standard)** | `pg_database_owner` / `postgres` | Owner: `pg_database_owner`; ACL: `=U/pg_database_owner, postgres=U/pg_database_owner, anon=U, authenticated=U, service_role=U`. `postgres_is_pg_database_owner = true`, `has_public_create = true`. | **PASS** — `REVOKE CREATE/USAGE ON SCHEMA public` dan `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public` di `20261113001000:8-10, 86-98` valid untuk PG 17. |
| **Extensions (`pgcrypto`)** | Dibuat di `20261113000100` pada schema `extensions` | `pgcrypto` `1.3` **sudah terpasang** di schema `extensions`; termasuk `supautils.privileged_extensions`. `CREATE EXTENSION IF NOT EXISTS "pgcrypto"` akan skip bersih (`NOTICE`). | **PASS** |
| **Scheduler / Worker Extensions (`pg_cron`, `pg_net`, `supabase_vault`)** | Tidak dipakai di 23 migrasi (terpisah di `supabase/ops/`) | `supabase_vault` `0.3.2` terpasang; `pg_cron` (`1.6.4`) dan `pg_net` (`0.20.4`) tersedia tetapi belum diinstal (`installed_version: null`). | **PASS** — tidak dibutuhkan oleh 23 migrasi inti. |
| **SQL & PL/pgSQL Syntax** | Standar PG15 (`WITH`, `JSONB`, `SECURITY DEFINER`, `SET search_path`, `extensions.gen_random_bytes`, `extensions.digest`, `NULL::timestamptz/uuid/jsonb/interval`) | PostgreSQL 17.11 tidak memiliki breaking deprecation terhadap konstruksi SQL/PL/pgSQL di 23 migrasi (tidak ada `WITH OIDS` atau katalog terhapus). | **PASS** |

| ID | File & Baris | Temuan | Dampak | Tindakan Manual | Rekomendasi |
|---|---|---|---|---|---|
| **PGV-01 (WARNING — Informational)** | `supabase/config.toml:16` | `major_version = 15` vs remote `17.11` | Tidak menghalangi migrasi, namun environment lokal berbeda versi mayor terhadap Cloud staging. | Tidak wajib di step ini (catatan evaluasi) | Biarkan `config.toml` tetap tidak berubah di Step 16.3; pertimbangkan penyelarasan `major_version` ke `17` hanya pada step maintenance terpisah bila diinginkan. |
| **PGV-02 (PASS — Informational)** | `20261113001000:86-98` | `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public ...` | Saat ini remote memiliki `pg_default_acl` bawaan untuk `postgres` pada `public` dan `storage` yang memberi akses default ke `anon`/`authenticated`. Migrasi `0010` akan mencabut default privileges `postgres` di schema `public` dan membatasinya ke `service_role`, tepat sesuai desain. | Tidak | Pastikan seluruh objek baru di schema `public` setelah `0010` memang dibuat sebagai `postgres` dengan grant eksplisit. |

---

## 4. Migration Dependency Audit (23 Migrasi)

Pemeriksaan urutan kronologis dan dependensi antar file di `supabase/migrations/`:

1. **Extension sebelum penggunaan (`PASS`):**
   - `20261113000100_create_extensions.sql` memasang `pgcrypto` di schema `extensions` sebelum `extensions.gen_random_bytes` & `extensions.digest` dipakai di `20261115001900_resident_invitations.sql:242-243, 492-493, 579, 678, 788`. (Di remote, `pgcrypto` `1.3` bahkan sudah tersedia di `extensions`.)
2. **Domain Tables & Foreign Keys (`PASS`):**
   - Urutan pembuatan tabel konsisten tanpa forward reference: `0002` (`tenants`, `profiles`, `roles`, `tenant_members`, `member_roles`) → `0003` (resident domain) → `0004` (finance domain) → `0005` (communication domain) → `0006` (activity domain) → `0007` (notifications & audit logs).
3. **Functions sebelum Triggers & Policies (`PASS`):**
   - `0008` mendefinisikan core helper & validator functions (`set_updated_at`, `handle_new_user`, `protect_super_admin_column`, `validate_*`) sebelum `0009` memasang trigger pada `public.*` dan `auth.users`.
   - `0010` mencabut default/table privilege berlebih dan membuat RLS helpers sebelum `0011` mengaktifkan RLS dan membuat policies.
   - `0012`–`0014` memperketat policy dan guard triggers sebelum `0015` membuat bucket, `storage_deletion_queue`, helper `is_storage_object_*`, policy `storage.objects`, dan 21+ RPC.
   - `0016`–`0023` membangun state orphan scan, rejection reason RPC, audit manual cash, invitations, ronda schedule, serta security gap closures (`complaints`, `letters`, `activities`) di atas schema `0002`–`0015`.
4. **Ketergantungan Seed Lokal (`PASS`):**
   - **`0` ketergantungan** terhadap `supabase/seed.sql` (`rt-04-rw-02-demo`, role seed rows, atau data demo) ditemukan di ke-23 file migrasi.
   - Catatan: tabel `public.roles` akan kosong (`0` baris) tepat setelah migrasi selesai hingga role aplikasi (`ketua_rt`, `sekretaris`, `bendahara`, `pengurus`, `warga`) di-provision secara terpisah sesuai prosedur staging setup (bukan via dev `seed.sql`).

---

## 5. Final Read-Only State Verification

Verifikasi ulang setelah seluruh query inspeksi selesai dijalankan:

- **Remote migration history (`npx supabase migration list --remote=szghujzhiyndeuhepsax`):** Tetap **`0` migrasi diterapkan** (`"remote": ""` untuk seluruh 23 file lokal).
- **Tabel `public` remote (`public_tables`):** **`[]`** (`0` tabel).
- **Function `public` remote (`public_functions`):** **`[]`** (`0` fungsi).
- **Schema `supabase_migrations` (`migration_tables`):** **`[]`** (`to_regclass('supabase_migrations.schema_migrations') = null`).
- **Storage remote:** **`0` buckets**, **`0` policies**.
- **Auth triggers remote (`auth.users`):** **`0` custom triggers**.

---

## 6. Rekomendasi Langkah Berikutnya

1. Audit menyatakan **tidak ada blocker SQL fatal** untuk menerapkan 23 migrasi ke `smart-rt-staging` (`szghujzhiyndeuhepsax`), dengan perhatian khusus pada **STG-01** (`REVOKE` non-fatal warning pada tabel `storage.*`) dan verifikasi pasca-apply untuk **AUTH-01** (`trg_auth_users_create_profile`).
2. **Jangan menjalankan `supabase db push` sebelum ada persetujuan eksplisit.** Setelah disetujui nanti, jalankan `supabase db push` dengan target eksplisit `szghujzhiyndeuhepsax`, lalu verifikasi langsung:
   - 23 migrasi tercatat di `supabase_migrations.schema_migrations`,
   - 6 bucket privat & seluruh RLS policy `storage.objects` terbentuk,
   - `relacl` & akses efektif `anon`/`authenticated` pada `storage.buckets` dan `storage.objects`,
   - `trg_auth_users_create_profile` aktif di `auth.users`.

