# Smart RT — Step 16.3: Supabase Cloud Staging Preflight Report (Phase 3–4)

**Tanggal:** 2026-11-16  
**Target Environment:** `smart-rt-staging` (`szghujzhiyndeuhepsax`)  
**Status Akhir:** `PASS WITH BLOCKERS`

> **Mode Preflight (Read-Only):** Tidak ada migrasi yang diterapkan ke database remote. Tidak ada `db push` tanpa `--dry-run`, tidak ada `db reset`, `migration repair`, `--include-all`, `--include-seed`, `--include-roles`, maupun aktivasi scheduler/worker/Edge Functions/SMTP/Railway.

---

## 1. Project Identity Verification

Hasil pemeriksaan `npx supabase projects list` (Supabase CLI `3.1.0`):

| Field | Nilai Terverifikasi | Kecocokan Target |
|---|---|---|
| **Project Name** | `smart-rt-staging` | Sesuai (`smart-rt-staging`) |
| **Project Reference (`id` / `ref`)** | `szghujzhiyndeuhepsax` | Sesuai (`szghujzhiyndeuhepsax`) |
| **Region** | `ap-southeast-1` | Sesuai (`ap-southeast-1`) |
| **Status** | `ACTIVE_HEALTHY` | Aktif & sehat |
| **Database Host** | `db.szghujzhiyndeuhepsax.supabase.co` | Sesuai host project staging |
| **Database Version** | `17.11.0.019` (`postgres_engine: "17"`, `release_channel: "ga"`) | PostgreSQL 17 (catatan: `supabase/config.toml` lokal masih `major_version = 15`) |
| **Created At** | `2026-11-16T06:23:49.290266Z` | Project staging baru |
| **Isolasi Project Lain** | Terpisah dari `eitjcadtgmzmwrmmjndd` (`INACTIVE`) dan `ezeegkqvpfuusihborap` (`ACTIVE_HEALTHY` / bukan staging) | Terkonfirmasi bukan production |
| **Local Link (`supabase/.temp/`)** | Belum ter-link (`linked: false`); seluruh operasi memakai flag eksplisit `--remote=szghujzhiyndeuhepsax` | Aman |

---

## 2. Remote Migration History

Hasil `npx supabase migration list --remote=szghujzhiyndeuhepsax`:
- Target terverifikasi: `project szghujzhiyndeuhepsax`
- Jumlah migrasi yang sudah tercatat pada tabel riwayat migrasi remote: **`0`** (kolom `"remote"` bernilai kosong `""` untuk seluruh 23 entri).
- Database remote `smart-rt-staging` terkonfirmasi masih kosong / bersih dari migrasi Smart RT.

---

## 3. Local vs Remote Migration Comparison

| No | Migration File | Local | Remote (`szghujzhiyndeuhepsax`) | Status |
|---|---|---|---|---|
| 1 | `20261113000100_create_extensions.sql` | Ada | Belum diterapkan | Pending |
| 2 | `20261113000200_create_tenant_access.sql` | Ada | Belum diterapkan | Pending |
| 3 | `20261113000300_create_resident_domain.sql` | Ada | Belum diterapkan | Pending |
| 4 | `20261113000400_create_finance_domain.sql` | Ada | Belum diterapkan | Pending |
| 5 | `20261113000500_create_communication_domain.sql` | Ada | Belum diterapkan | Pending |
| 6 | `20261113000600_create_activity_domain.sql` | Ada | Belum diterapkan | Pending |
| 7 | `20261113000700_create_audit_notification_domain.sql` | Ada | Belum diterapkan | Pending |
| 8 | `20261113000800_create_database_functions.sql` | Ada | Belum diterapkan | Pending |
| 9 | `20261113000900_create_database_triggers.sql` | Ada | Belum diterapkan | Pending |
| 10 | `20261113001000_harden_privileges_and_rls_helpers.sql` | Ada | Belum diterapkan | Pending |
| 11 | `20261113001100_enable_rls_and_policies.sql` | Ada | Belum diterapkan | Pending |
| 12 | `20261113001200_harden_rls_policies_and_insert_guards.sql` | Ada | Belum diterapkan | Pending |
| 13 | `20261113001300_security_hardening_guards.sql` | Ada | Belum diterapkan | Pending |
| 14 | `20261114001400_security_hardening_corrections.sql` | Ada | Belum diterapkan | Pending |
| 15 | `20261114001500_storage_and_atomic_rpcs.sql` | Ada | Belum diterapkan | Pending |
| 16 | `20261114001600_storage_orphan_scan_state.sql` | Ada | Belum diterapkan | Pending |
| 17 | `20261115001700_resident_payment_rejection_reason_rpc.sql` | Ada | Belum diterapkan | Pending |
| 18 | `20261115001800_manual_cash_transaction_audit.sql` | Ada | Belum diterapkan | Pending |
| 19 | `20261115001900_resident_invitations.sql` | Ada | Belum diterapkan | Pending |
| 20 | `20261115002000_create_ronda_schedule.sql` | Ada | Belum diterapkan | Pending |
| 21 | `20261115002100_complaints_security_gap_closure.sql` | Ada | Belum diterapkan | Pending |
| 22 | `20261115002200_letters_security_gap_closure.sql` | Ada | Belum diterapkan | Pending |
| 23 | `20261116002300_activities_security_gap_closure.sql` | Ada | Belum diterapkan | Pending |

- **Total Local Migrations:** `23`
- **Total Remote Applied Migrations:** `0`
- **Total Pending Migrations:** `23`
- **Urutan Timestamp & Konsistensi:** Kronologis bersih, tanpa duplikasi nomor versi maupun file di luar `supabase/migrations/`.

---

## 4. Dry-Run Output Summary

Hasil `npx supabase db push --dry-run --remote=szghujzhiyndeuhepsax`:
- **Exit code:** `0`
- **Target CLI:** `Target: project smart-rt-staging (szghujzhiyndeuhepsax) · production` *(catatan: Supabase CLI menandai branch utama project baru sebagai `production` secara internal, namun `project_name` dan `project_ref` terverifikasi tepat ke `smart-rt-staging` / `szghujzhiyndeuhepsax`)*.
- **State JSON:** `"upToDate": false`, `"dryRun": true`, `"migrations": [ ... 23 file berurutan dari 20261113000100 s.d. 20261116002300 ... ]`, `"seeds": []`, `"roles": []`, `"message": "Finished supabase db push."`.
- **Pernyataan CLI:** `DRY RUN: migrations will *not* be pushed to the database.`
- **Catatan Penting Perilaku CLI:** `supabase db push --dry-run` membandingkan file lokal dengan tabel riwayat migrasi remote dan mencetak daftar migrasi pending **tanpa mengeksekusi SQL di dalam PostgreSQL remote**. Oleh karena itu, potensi kegagalan privilege/kolom pada managed Supabase Cloud diaudit secara eksplisit pada Bagian 5 di bawah.

---

## 5. Daftar Operasi yang Berpotensi Bermasalah pada Managed Supabase Cloud

Audit terhadap ke-23 file migrasi menemukan area berikut yang menyentuh schema/role terkelola Supabase atau berbeda antara lokal dan Cloud:

| Kategori & Tingkat Risiko | Lokasi Migrasi | Operasi Aktual | Dampak / Potensi Masalah pada Managed Supabase Cloud |
|---|---|---|---|
| **Tinggi — Privilege `storage.buckets` & `storage.objects`** | `20261114001500_storage_and_atomic_rpcs.sql:42-44` | `REVOKE ALL ON storage.buckets FROM anon;`<br>`REVOKE ALL ON storage.objects FROM anon;`<br>`REVOKE UPDATE, DELETE ON storage.objects FROM authenticated;` | Pada Supabase Cloud, tabel `storage.buckets` dan `storage.objects` dimiliki oleh `supabase_storage_admin`, sedangkan migrasi CLI berjalan sebagai role `postgres` (bukan superuser). Perintah `REVOKE` langsung pada tabel milik `supabase_storage_admin` berisiko ditolak dengan `ERROR: must be owner of table` atau `permission denied`. |
| **Tinggi — Kolom Schema Managed Storage & RLS Policy `storage.objects`** | `20261114001500_storage_and_atomic_rpcs.sql:21-39, 351-355, 473-754`<br>`20261116002300_activities_security_gap_closure.sql:428-469` | `INSERT INTO storage.buckets (..., versioning_status)` dan `CREATE POLICY` / `DROP POLICY IF EXISTS` pada `storage.objects` yang mereferensikan kolom `archived_at` & `is_delete_marker`. | 1) Bergantung pada ketersediaan kolom `versioning_status`, `archived_at`, dan `is_delete_marker` di schema `storage` milik project `smart-rt-staging` (`17.11.0.019`).<br>2) `CREATE POLICY` / `DROP POLICY` pada `storage.objects` mensyaratkan role `postgres` memiliki ownership/delegasi policy pada `storage.objects` di Managed Cloud. |
| **Sedang — Trigger pada `auth.users`** | `20261113000900_create_database_triggers.sql:74-76`<br>`20261113000800_create_database_functions.sql:16-38` | `CREATE TRIGGER trg_auth_users_create_profile AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();` | `auth.users` dimiliki oleh `supabase_auth_admin`. Managed Supabase Cloud umumnya mengizinkan `postgres` membuat trigger pada `auth.users`, namun hal ini belum teruji pada `szghujzhiyndeuhepsax` sebelum eksekusi aktual. Fungsi `handle_new_user()` sendiri aman (`SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE ALL ... FROM PUBLIC`). |
| **Sedang — Perbedaan Versi PostgreSQL Lokal vs Staging** | `supabase/config.toml:16` vs remote `17.11.0.019` | Lokal memakai `major_version = 15`, sementara `smart-rt-staging` berjalan di PostgreSQL `17.11.0.019`. | Tidak ditemukan sintaks SQL yang inkompatibel dengan PG 17, tetapi struktur tabel internal `storage.*` dan perilaku role default mengikuti PostgreSQL 17 Cloud. |
| **Aman — Default Privileges `postgres` & Schema `public`** | `20261113001000_harden_privileges_and_rls_helpers.sql:8-10, 86-98` | `REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated, service_role;` dan `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public ...` | Secara eksplisit menargetkan `FOR ROLE postgres` (tidak mengubah `supabase_admin`), sehingga selaras dengan role eksekusi CLI pada Supabase Cloud. |
| **Aman — Extensions** | `20261113000100_create_extensions.sql:3`<br>`20261115001900_resident_invitations.sql:242-243` | `CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";` dan penggunaan `extensions.gen_random_bytes` / `extensions.digest`. | `pgcrypto` di schema `extensions` didukung penuh pada Managed Supabase Cloud. |
| **Aman — Scheduler, Cron, Vault, Seed, & Local URLs** | Seluruh 23 file di `supabase/migrations/` | Pemeriksaan `pg_cron`, `pg_net`, `vault`, `127.0.0.1`, `localhost`, `host.docker.internal`, `supabase_kong_smart-rt`, `storage-deletion-worker`, `storage-orphan-scan`. | **`0` temuan.** Tidak ada migrasi yang mengaktifkan cron/scheduler/worker lokal. Setup scheduler terpisah di `supabase/ops/storage-scheduler-setup.sql`, dan `seed.sql` tidak ikut dieksekusi (`"seeds": []`). |

---

## 6. Risiko dan Rekomendasi Penanganan

1. **Verifikasi Read-Only Struktur Schema `storage` & Ownership di `smart-rt-staging` Sebelum Push:**
   - Karena `supabase db push --dry-run` tidak mengeksekusi SQL ke PostgreSQL remote, jalankan pengecekan read-only (misalnya melalui Supabase Dashboard SQL Editor pada project `smart-rt-staging`) untuk memastikan:
     - Kolom `storage.buckets.versioning_status`, `storage.objects.archived_at`, dan `storage.objects.is_delete_marker` memang ada pada instance Storage Cloud `szghujzhiyndeuhepsax`.
     - Role/owner saat ini atas `storage.buckets`, `storage.objects`, dan `auth.users` mengizinkan eksekusi `REVOKE` dan `CREATE POLICY` / `CREATE TRIGGER` oleh `postgres`.
2. **Rencana Mitigasi Jika `20261114001500` Gagal di `REVOKE ... ON storage.*`:**
   - Jangan gunakan `migration repair` atau mengedit riwayat migrasi lama jika bukan atas keputusan eksplisit pasca-evaluasi.
   - Jika `supabase db push` nanti menolak `REVOKE ALL ON storage.buckets/objects` karena ownership `supabase_storage_admin`, cek apakah `storage.buckets` dan `storage.objects` sudah memiliki least-privilege bawaan / RLS aktif di Cloud, lalu siapkan langkah remediate yang bersih (mis. penyesuaian pre-apply yang disetujui untuk migration `0015` sebelum berhasil diterapkan atau migrasi kompatibilitas Cloud) karena `0015` dibungkus dalam transaksi `BEGIN; ... COMMIT;`.
3. **Verifikasi `trg_auth_users_create_profile` Saat Step Penerapan Nanti:**
   - Setelah nanti mendapat persetujuan untuk push migrasi, pastikan trigger `trg_auth_users_create_profile` pada `auth.users` benar-benar terbentuk di `pg_trigger` (karena dibutuhkan alur registrasi & aktivasi undangan warga).
4. **Sinkronisasi Versi Config Lokal (`config.toml`):**
   - Catat bahwa `smart-rt-staging` memakai PostgreSQL `17.11.0.019` sedangkan `supabase/config.toml` masih `major_version = 15`. Penyelarasan bisa dipertimbangkan di step terpisah jika diperlukan.

---

## 7. Keputusan & Status Akhir

- **Status:** **`PASS WITH BLOCKERS`**
- **Ringkasan:** Identitas project `smart-rt-staging` (`szghujzhiyndeuhepsax`), kebersihan riwayat migrasi remote (`0` applied), ketiadaan scheduler/worker/endpoint lokal, dan hasil `supabase db push --dry-run` (`23` pending migrations) semuanya **terverifikasi dan lulus**. Status tidak dinyatakan `PASS` penuh karena `db push --dry-run` tidak mengeksekusi SQL terhadap remote PostgreSQL 17, sehingga **potensi blocker Managed Supabase Cloud** pada `20261114001500_storage_and_atomic_rpcs.sql` (`REVOKE` dan kolom/policy pada `storage.buckets` & `storage.objects`) serta `20261113000900` (`CREATE TRIGGER ON auth.users`) perlu dikonfirmasi/disepakati penanganannya sebelum menjalankan `supabase db push` yang sebenarnya.

