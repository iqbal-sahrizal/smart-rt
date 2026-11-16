# Step 10.2.1 — Live Database Validation Report

Laporan hasil eksekusi dan validasi langsung migrasi `20261113001000_harden_privileges_and_rls_helpers.sql` pada local Supabase PostgreSQL (`127.0.0.1:54322`).

---

## 1. Environment & Target Database
- **OS**: macOS `15.3.1` (`arm64`)
- **Target Database**: Local Supabase PostgreSQL (`127.0.0.1:54322`, container `supabase_db_smart-rt`)
- **PostgreSQL Version**: `PostgreSQL 15.19 on aarch64-unknown-linux-gnu`

## 2. Status Docker & Supabase
- **Docker Daemon**: Running (**PASS**)
- **Local Supabase Stack**: Running (`127.0.0.1:54322` aktif; `imgproxy`, `edge_runtime`, `pooler` tidak aktif/dikecualikan) (**PASS**)

## 3. Status Migration 0010
- **Sebelum Eksekusi**: `npx supabase migration list --local` menunjukkan `20261113000100` s.d. `20261113000900` sudah diterapkan, dan `20261113001000` belum diterapkan.
- **Eksekusi**: `npx supabase migration up --local` menerapkan `20261113001000_harden_privileges_and_rls_helpers.sql` tanpa error (**PASS**).

## 4. Hasil Audit Table Privileges (**PASS**)
- **`anon` & `PUBLIC`**: `0` tabel memiliki privilege (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` semuanya `false`).
- **`service_role`**: Memiliki `SELECT, INSERT, UPDATE, DELETE` penuh pada seluruh **28 tabel**.
- **`authenticated`**:
  - `TRUNCATE`, `REFERENCES`, `TRIGGER`: `false` pada seluruh **28 tabel**.
  - `payment_webhook_events` & `letter_sequences`: `false` untuk seluruh operasi (`SELECT, INSERT, UPDATE, DELETE`).
  - `profiles`, `complaints`, `notifications`: `false` untuk table-level `UPDATE`.
  - `roles`, `audit_logs`: hanya `SELECT`.
  - `payments`, `complaint_replies`, `complaint_status_history`: hanya `SELECT, INSERT`.
  - `bills`, `cash_transactions`, `letter_requests`: hanya `SELECT, INSERT, UPDATE`.
  - 15 tabel domain CRUD lainnya: `SELECT, INSERT, UPDATE, DELETE` (siap dibatasi RLS di Step 10.2.2).

## 5. Hasil Audit Column Privileges (**PASS**)
Dari `pg_attribute.attacl` + `aclexplode()`, terdapat tepat **10 column-level `UPDATE` grants** kepada `authenticated` dan tidak ada grant kolom lain:
- `profiles`: `full_name`, `phone`, `avatar_path`, `active_tenant_id`
- `complaints`: `category`, `title`, `description`, `photo_path`
- `notifications`: `is_read`, `read_at`

## 6. Hasil Audit Sequence Privileges (**PASS**)
- `0` sequence pada schema `public` (seluruh 28 tabel memakai `uuid DEFAULT gen_random_uuid()`).

## 7. Hasil Audit Function Privileges (**PASS**)
- **9 trigger-only functions**: `pub_exec = f`, `anon_exec = f`, `auth_exec = f`, `svc_exec = t`.
- **6 RLS helper functions**: `pub_exec = f`, `anon_exec = f`, `auth_exec = t`, `svc_exec = t`.

## 8. Hasil Audit Default Privileges (`pg_default_acl`) (**PASS**)
- **Owner `postgres` pada schema `public`**:
  - `r` (tables), `S` (sequences), `f` (functions): hanya kepada `postgres` dan `service_role`; `0` grant kepada `PUBLIC`, `anon`, maupun `authenticated`.
- **Owner `supabase_admin` pada schema `public`**: Tidak diubah (tetap sesuai bawaan Supabase).

## 9. Hasil Audit Enam Helper Functions (**PASS**)
Seluruh 6 fungsi (`is_super_admin()`, `is_tenant_member(uuid)`, `has_tenant_role(uuid, text[])`, `get_my_member_id(uuid)`, `get_my_resident_id(uuid)`, `get_my_household_id(uuid)`) terverifikasi di `pg_proc`:
- `owner = postgres`
- `prosecdef = true` (`SECURITY DEFINER`)
- `provolatile = 's'` (`STABLE`)
- `proconfig = {"search_path=public, pg_temp"}`
- Menggunakan `auth.uid()` secara internal, schema-qualified (`public.*`), tanpa parameter `user_id` bebas.

## 10. Hasil Audit `validate_tenant_actor()` (**PASS**)
- `owner = postgres`
- `prosecdef = true` (`SECURITY DEFINER`)
- `proconfig = {"search_path=public, pg_temp"}`
- `pub_exec = f`, `anon_exec = f`, `auth_exec = f`, `svc_exec = t`.

## 11. Hasil Audit 32 Triggers (**PASS** — Catalog Verification; DML Smoke Test **NOT TESTED**)
- `total_triggers = 32`, `enabled_triggers = 32` (`tgenabled = 'O'` pada seluruh 31 trigger `public` + 1 trigger `auth.users`).

## 12. Hasil Audit RLS (**PASS**)
- `public_tables = 28`
- `rls_enabled_count = 0`
- `force_rls_count = 0`
- `policy_count = 0`

## 13. Smoke Test Results (**NOT TESTED**)
- Kondisi fixture saat ini: `auth.users = 0`, `public.tenants = 1`, `public.tenant_members = 0`.
- Sesuai instruksi, tidak dibuat pengguna/data buatan permanen sehingga pemanggilan runtime 6 helper functions ditandai **NOT TESTED** (audit katalog & definisi SQL telah **PASS**).

## 14. Daftar Temuan & Rekomendasi
1. **Tidak ada temuan kegagalan** pada privilege, default ACL `postgres`, helper functions, `validate_tenant_actor()`, maupun trigger catalog setelah migration `0010`.
2. **`supabase_admin` default ACL**: Masih aktif di `public` sebagai bawaan Supabase (sesuai desain, tidak diubah).
3. **RLS masih nonaktif (`0/28`)**: Isolasi baris antar-tenant baru akan aktif setelah **Step 10.2.2**.

## 15. Kesimpulan
**Step 10.2.1 LAYAK DINYATAKAN SELESAI** — seluruh migration, privilege hardening, 6 RLS helper functions, `validate_tenant_actor()`, dan 32 trigger telah terverifikasi pada local Supabase PostgreSQL (`127.0.0.1:54322`), dan siap dilanjutkan ke **Step 10.2.2** setelah review Anda.

