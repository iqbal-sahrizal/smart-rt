# Smart RT — Step 16.3.2: Final Migration Apply Readiness Gate (`smart-rt-staging`)

**Tanggal:** 2026-11-16  
**Target Project:** `smart-rt-staging` (`szghujzhiyndeuhepsax`, `ap-southeast-1`, `PostgreSQL 17.11`)  
**Referensi Audit:**
- [step-16.3-staging-preflight-report.md](./step-16.3-staging-preflight-report.md)
- [step-16.3-remote-compatibility-audit.md](./step-16.3-remote-compatibility-audit.md)
- [step-16.3.1-storage-acl-impact-assessment.md](./step-16.3.1-storage-acl-impact-assessment.md)

**Keputusan Akhir:** **`READY WITH WARNINGS`** *(Menunggu persetujuan eksplisit sebelum menjalankan `supabase db push` ke `szghujzhiyndeuhepsax`)*

> **Safety Gate:** Dokumen ini disusun sepenuhnya dalam mode **READ-ONLY**. Tidak ada migrasi yang diterapkan, tidak ada `db push` tanpa `--dry-run`, tidak ada `repair`, `reset`, `seed`, perubahan privilege, maupun deployment Edge Functions, scheduler, atau Railway.

---

## 1. Ringkasan Eksekutif

- **Kelengkapan & Urutan:** Seluruh **23 migrasi lokal** (`20261113000100` s.d. `20261116002300`) valid secara kronologis tanpa duplikasi nomor versi, tanpa ketergantungan pada `supabase/seed.sql`, dan tanpa aktivasi scheduler/worker lokal.
- **Kondisi Remote Terkini:** Hasil `npx supabase db push --dry-run --remote=szghujzhiyndeuhepsax` mengonfirmasi target tepat ke `smart-rt-staging (szghujzhiyndeuhepsax)`, `0` migrasi remote yang sudah diterapkan, `23` migrasi berstatus pending, `seeds: []`, dan `roles: []`.
- **Risiko & Warning:** Tidak ada blocker SQL fatal. Terdapat **3 warning terdaftar** (`STG-01`, `AUTH-01`, `PGV-01`) yang seluruhnya dapat diterima untuk deployment staging dengan syarat **SQL verifikasi pasca-apply (Bagian 5)** dijalankan segera setelah `db push` disetujui dan dieksekusi.
- **Catatan Dry-Run:** `supabase db push --dry-run` hanya membandingkan daftar file lokal terhadap tabel riwayat migrasi remote dan **tidak mengeksekusi SQL** di PostgreSQL remote; eksekusi transaksi aktual baru teruji saat `db push` disetujui.

---

## 2. Inventaris 23 Migrasi

| No | Version | File Migrasi | Domain / Fokus Utama | Status Remote (`szghujzhiyndeuhepsax`) |
|---|---|---|---|---|
| 1 | `20261113000100` | `20261113000100_create_extensions.sql` | Ekstensi `pgcrypto` di schema `extensions` | Pending |
| 2 | `20261113000200` | `20261113000200_create_tenant_access.sql` | Tabel `tenants`, `profiles`, `roles`, `tenant_members`, `member_roles` | Pending |
| 3 | `20261113000300` | `20261113000300_create_resident_domain.sql` | Tabel `households`, `residents`, `resident_private_data`, `resident_documents`, `vehicles` | Pending |
| 4 | `20261113000400` | `20261113000400_create_finance_domain.sql` | Tabel `dues`, `bills`, `payments`, `payment_webhook_events`, `cash_categories`, `cash_transactions` | Pending |
| 5 | `20261113000500` | `20261113000500_create_communication_domain.sql` | Tabel `announcements`, `announcement_recipients`, `complaints`, `complaint_replies`, `complaint_status_history`, `letter_types`, `letter_sequences`, `letter_requests` | Pending |
| 6 | `20261113000600` | `20261113000600_create_activity_domain.sql` | Tabel `activities`, `activity_participants` | Pending |
| 7 | `20261113000700` | `20261113000700_create_audit_notification_domain.sql` | Tabel `notifications`, `audit_logs` | Pending |
| 8 | `20261113000800` | `20261113000800_create_database_functions.sql` | Core validators & `handle_new_user()` | Pending |
| 9 | `20261113000900` | `20261113000900_create_database_triggers.sql` | 31 triggers `public.*` + trigger `trg_auth_users_create_profile` pada `auth.users` | Pending |
| 10 | `20261113001000` | `20261113001000_harden_privileges_and_rls_helpers.sql` | Hardening schema `public`, `REVOKE/GRANT`, `ALTER DEFAULT PRIVILEGES FOR ROLE postgres`, 6 RLS helpers | Pending |
| 11 | `20261113001100` | `20261113001100_enable_rls_and_policies.sql` | Mengaktifkan RLS & policy awal pada 28 tabel domain | Pending |
| 12 | `20261113001200` | `20261113001200_harden_rls_policies_and_insert_guards.sql` | Pengetatan policy & insert guards | Pending |
| 13 | `20261113001300` | `20261113001300_security_hardening_guards.sql` | Guard upload proof/doc & enforcement server timestamps | Pending |
| 14 | `20261114001400` | `20261114001400_security_hardening_corrections.sql` | Koreksi guard webhook & dokumen warga | Pending |
| 15 | `20261114001500` | `20261114001500_storage_and_atomic_rpcs.sql` | 6 private buckets, `storage_deletion_queue`, storage RLS policies, guard triggers, & 20+ RPC | Pending |
| 16 | `20261114001600` | `20261114001600_storage_orphan_scan_state.sql` | `storage_orphan_scan_state`, lease & orphan cleanup RPCs | Pending |
| 17 | `20261115001700` | `20261115001700_resident_payment_rejection_reason_rpc.sql` | RPC alasan penolakan pembayaran warga | Pending |
| 18 | `20261115001800` | `20261115001800_manual_cash_transaction_audit.sql` | Guard & audit trigger pengeluaran kas manual | Pending |
| 19 | `20261115001900` | `20261115001900_resident_invitations.sql` | `resident_invitations`, token hash (`pgcrypto`), & RPC aktivasi warga | Pending |
| 20 | `20261115002000` | `20261115002000_create_ronda_schedule.sql` | `ronda_schedules`, `ronda_assignments`, RLS, triggers, & RPC ronda | Pending |
| 21 | `20261115002100` | `20261115002100_complaints_security_gap_closure.sql` | Security hardening, RLS, audit triggers, & RPC pengaduan | Pending |
| 22 | `20261115002200` | `20261115002200_letters_security_gap_closure.sql` | Security hardening, RLS, audit triggers, & RPC surat | Pending |
| 23 | `20261116002300` | `20261116002300_activities_security_gap_closure.sql` | Security hardening kegiatan & alignment RLS policy bucket `activity-docs` | Pending |

**Ringkasan Baseline yang Diharapkan Setelah Apply:**
- **Public Tables:** `33` tabel (semuanya mengaktifkan RLS: `33/33`).
- **Public Policies:** `80` policy (`public` schema).
- **Public Functions / RPC:** `96` fungsi.
- **Storage Buckets:** `6` private buckets (`public = false`).
- **Storage Policies:** `12` policy pada `storage.objects` (`6 INSERT` + `6 SELECT`, semua `TO authenticated`), `0` policy pada `storage.buckets`.

---

## 3. Migration Risk Classification

| Kategori | Migrasi Terkait | Tingkat Risiko | Penjelasan & Alasan |
|---|---|---|---|
| **Storage (Tertinggi)** | `0015`, `0016` | **Tinggi (Non-Blocking)** | `20261114001500_storage_and_atomic_rpcs.sql` adalah migrasi dengan risiko eksekusi tertinggi (3.470 baris): menyentuh schema `storage` terkelola (`storage.buckets` + `storage.objects` yang dimiliki `supabase_storage_admin`), mengeksekusi `REVOKE` lintas ownership (`STG-01` -> warning non-fatal), menyisipkan kolom `versioning_status`, serta membuat 12 policy `storage.objects` (`supautils.policy_grants`), tabel `storage_deletion_queue`, dan 20+ RPC dalam satu transaksi. |
| **Trigger** | `0009`, `0013`–`0015`, `0018`–`0023` | **Sedang** | `0009` membuat 31 trigger di `public.*` dan 1 trigger lintas-schema `trg_auth_users_create_profile` pada `auth.users` (`supabase_auth_admin`). Terkonfirmasi aman oleh `TRIGGER` ACL + `supautils.drop_trigger_grants`, tetapi tetap wajib diverifikasi pasca-apply (`AUTH-01`). |
| **RLS & Privilege** | `0010`, `0011`, `0012`, `0013`, `0014` | **Sedang** | `0010` mencabut `USAGE`/`CREATE` `PUBLIC` pada `public` serta mengubah `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public`. Terverifikasi valid karena `postgres_is_pg_database_owner = true`. |
| **Feature-Specific Security** | `0018`, `0019`, `0020`, `0021`, `0022`, `0023` | **Sedang** | Menambahkan audit trigger, undangan warga (`extensions.gen_random_bytes`/`digest`), jadwal ronda, dan penutupan gap keamanan `complaints`/`letters`/`activities` (termasuk penggantian policy `storage.objects` untuk `activity-docs` di `0023`). |
| **Function & RPC** | `0008`, `0017` (+ RPC dalam `0015`–`0023`) | **Rendah–Sedang** | Fungsi menggunakan `SECURITY DEFINER SET search_path = public, pg_temp` dan `REVOKE/GRANT` eksplisit. |
| **Table & Constraint** | `0002`, `0003`, `0004`, `0005`, `0006`, `0007` | **Rendah** | DDL standar `public.*` sesuai urutan foreign key tanpa referensi forward. |
| **Schema & Extension** | `0001` | **Rendah** | `CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";` (`pgcrypto 1.3` sudah terpasang di remote). |

---

## 4. Known Warnings Register

| ID | Sumber & Ringkasan Warning | Dapat Diterima untuk Staging? | Mitigasi | Wajib Verifikasi Pasca-Apply? | Kondisi Penghentian (Stop / Rollback Gate) |
|---|---|---|---|---|---|
| **STG-01** | `REVOKE ALL ON storage.buckets/objects` (`0015:42-44`) oleh `postgres` tidak mencabut grant `anon=arwd` & `authenticated=arwd` milik `supabase_storage_admin` (warning non-fatal PostgreSQL). | **Ya** | RLS (`relrowsecurity = true`) aktif pada `storage.buckets` (`0` policy) dan `storage.objects` (hanya 12 policy `INSERT`/`SELECT` untuk `authenticated`), plus 6 bucket `public = false`. | **Ya (Wajib)** | Hentikan & selidiki jika: 1) `db push` melempar `ERROR 42501` di luar warning non-fatal, 2) ada bucket dengan `public = true`, 3) ada policy `storage.*` untuk `anon`/`PUBLIC`, atau 4) ada policy `UPDATE`/`DELETE`/`ALL` pada `storage.objects`. |
| **AUTH-01** | Trigger `trg_auth_users_create_profile` (`0009:74-76`) dipasang pada `auth.users` yang dimiliki `supabase_auth_admin`. | **Ya** | ACL `auth.users` memiliki bit `t` (`TRIGGER`), `postgres` memiliki `USAGE` pada `auth`, `supautils.drop_trigger_grants` mengizinkan pengelolaan trigger `auth.users`, dan `handle_new_user()` menggunakan `SECURITY DEFINER SET search_path = public, pg_temp`. | **Ya (Wajib)** | Hentikan & investigasi jika `trg_auth_users_create_profile` tidak muncul di `pg_trigger` untuk `auth.users` atau berstatus non-enabled (`tgenabled <> 'O'`). |
| **PGV-01** | `supabase/config.toml` lokal `major_version = 15`, sedangkan remote `smart-rt-staging` berjalan di `PostgreSQL 17.11`. | **Ya** | Seluruh konstruksi SQL di 23 migrasi telah diaudit kompatibel dengan PostgreSQL 17.11 (`pg_database_owner` & `storage.*` v17). | Opsional (`SELECT version()`) | Hentikan bila muncul syntax/catalog error PG17 saat eksekusi `db push`. |
| **OPS-01** *(Info)* | `seed.sql` tidak ikut dieksekusi (`seeds: []`), sehingga `public.roles` memiliki `0` baris tepat setelah `db push`. | **Ya** | Provisioning 5 role domain (`ketua_rt`, `sekretaris`, `bendahara`, `pengurus`, `warga`) dilakukan terpisah pasca-migrasi sebelum smoke test aplikasi. | Ya (konfirmasi sengaja kosong sampai tahap provisioning) | Jangan pernah menggunakan `--include-seed` dengan data demo dev di staging jika tidak dimaksudkan sebagai data uji terkontrol. |

---

## 5. Post-Apply Verification Plan (SQL READ-ONLY)

Setelah `supabase db push` disetujui dan dijalankan pada step berikutnya, eksekusi query read-only berikut melalui `npx supabase db query --remote=szghujzhiyndeuhepsax --read-only`:

```sql
-- Step 16.3 Post-Apply Read-Only Verification Baseline (smart-rt-staging)
SELECT jsonb_build_object(
  'applied_migrations_count', (
    SELECT count(*) FROM supabase_migrations.schema_migrations
  ),
  'public_tables_count', (
    SELECT count(*)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  ),
  'public_tables_without_rls', (
    SELECT coalesce(jsonb_agg(c.relname ORDER BY c.relname), '[]'::jsonb)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity IS NOT TRUE
  ),
  'public_policies_count', (
    SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
  ),
  'public_functions_count', (
    SELECT count(*)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  ),
  'critical_functions_present', (
    SELECT jsonb_agg(p.proname ORDER BY p.proname)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'handle_new_user',
        'is_super_admin',
        'is_tenant_member',
        'has_tenant_role',
        'is_storage_object_deletion_pending',
        'is_storage_object_path_retired',
        'claim_storage_deletion_jobs',
        'create_resident_invitation',
        'redeem_resident_invitation',
        'record_ronda_attendance',
        'create_activity',
        'request_delete_resident_document',
        'request_delete_complaint_photo'
      )
  ),
  'auth_users_triggers', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'tgname', t.tgname,
      'tgenabled', t.tgenabled,
      'fn', t.tgfoid::regproc::text
    ) ORDER BY t.tgname), '[]'::jsonb)
    FROM pg_trigger t
    WHERE t.tgrelid = 'auth.users'::regclass AND NOT t.tgisinternal
  ),
  'audit_triggers', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table', c.relname,
      'tgname', t.tgname,
      'tgenabled', t.tgenabled
    ) ORDER BY c.relname, t.tgname), '[]'::jsonb)
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
      AND t.tgname IN (
        'trg_audit_logs_validate_actor',
        'trg_cash_tx_audit_manual_expense',
        'trg_complaints_audit_insert',
        'trg_complaint_replies_audit_insert',
        'trg_letter_requests_audit_insert',
        'trg_letter_types_audit_changes'
      )
  ),
  'storage_buckets', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', id,
      'public', public,
      'file_size_limit', file_size_limit,
      'versioning_status', versioning_status
    ) ORDER BY id), '[]'::jsonb)
    FROM storage.buckets
  ),
  'storage_objects_policies', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'policyname', policyname,
      'cmd', cmd,
      'roles', roles
    ) ORDER BY policyname), '[]'::jsonb)
    FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
  ),
  'unsafe_storage_policies', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'tablename', tablename,
      'policyname', policyname,
      'cmd', cmd,
      'roles', roles
    )), '[]'::jsonb)
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND (
        tablename = 'buckets'
        OR 'anon' = ANY(roles)
        OR 'public' = ANY(roles)
        OR cmd IN ('UPDATE', 'DELETE', 'ALL')
      )
  ),
  'scheduler_extensions_installed', (
    SELECT coalesce(jsonb_agg(extname ORDER BY extname), '[]'::jsonb)
    FROM pg_extension
    WHERE extname IN ('pg_cron', 'pg_net')
  )
) AS post_apply_verification;
```

**Kriteria Lulus Verifikasi Pasca-Apply:**
- `applied_migrations_count = 23`
- `public_tables_count = 33` dan `public_tables_without_rls = []`
- `public_policies_count = 80` dan `public_functions_count >= 96`
- `auth_users_triggers` berisi `trg_auth_users_create_profile` (`tgenabled = "O"`)
- `audit_triggers` berisi ke-6 trigger audit (`tgenabled = "O"`)
- `storage_buckets` berisi tepat 6 bucket, semuanya `public: false` dan `versioning_status: "DISABLED"`
- `storage_objects_policies` berjumlah 12 (`6 INSERT` + `6 SELECT`, semua `roles: ["authenticated"]`)
- `unsafe_storage_policies = []`
- `scheduler_extensions_installed = []` (tidak ada `pg_cron`/`pg_net` aktif secara tidak sengaja)

---

## 6. Final Dry-Run Evidence

Eksekusi ulang `npx supabase db push --dry-run --remote=szghujzhiyndeuhepsax` sesudah audit kompatibilitas:

- **Exit Code:** `0`
- **Target Project Terkonfirmasi:** `smart-rt-staging (szghujzhiyndeuhepsax)`
- **Output Ringkas:**
  - `DRY RUN: migrations will *not* be pushed to the database.`
  - `upToDate: false`, `dryRun: true`
  - **23 pending migrations:** berurutan dari `20261113000100_create_extensions.sql` hingga `20261116002300_activities_security_gap_closure.sql`
  - `seeds: []`
  - `roles: []`
  - `message: "Finished supabase db push."`
- **State Remote:** Tetap kosong (`0` applied migrations, `0` perubahan schema/data/privilege).

---

## 7. Keputusan Akhir & Rekomendasi

- **Keputusan:** **`READY WITH WARNINGS`**
- **Tindakan Sekarang:** **BERHENTI.** Tidak menjalankan `supabase db push` tanpa `--dry-run`.
- **Langkah Berikutnya (Setelah Persetujuan Eksplisit User):**
  1. Jalankan `npx supabase db push --remote=szghujzhiyndeuhepsax` (tanpa `--include-seed`, `--include-roles`, `--include-all`, maupun `migration repair`).
  2. Eksekusi **Post-Apply Verification SQL (Bagian 5)** untuk memastikan seluruh kriteria lulus terpenuhi (khususnya `STG-01` & `AUTH-01`).
  3. Bila ada satu pun kondisi penghentian terpenuhi (misal transaksi `0015` gagal, `unsafe_storage_policies` tidak kosong, atau `trg_auth_users_create_profile` absen), hentikan pipeline staging sebelum melangkah ke Edge Functions atau Railway deployment.

