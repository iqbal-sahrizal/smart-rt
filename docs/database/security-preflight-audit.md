# Security Preflight Audit — Smart RT (Step 10.1.2 Final)

Dokumen ini merupakan finalisasi audit keamanan preflight sebelum implementasi **Step 10.2 (PostgreSQL Privileges, RLS Helpers, dan RLS Policies)**.

> [!IMPORTANT]
> Dokumen ini **bukan** klaim bahwa database sudah aman. Saat ini seluruh **28 tabel belum mengaktifkan RLS** dan masih memiliki grant luas kepada `anon` serta `authenticated`. Seluruh contoh SQL pada Bagian 4 berstatus **NON-EXECUTABLE** (rencana untuk Step 10.2).

---

## 1. Temuan Aktual Terverifikasi & Klasifikasi Severity

| ID | Severity | Temuan Aktual Terverifikasi | Dampak |
| :---: | :---: | :--- | :--- |
| **F-01** | **CRITICAL** | **RLS belum aktif pada 28 tabel `public`**: `relrowsecurity = false` dan 0 RLS policies. | Seluruh baris lintas tenant (termasuk `resident_private_data` NIK) belum terisolasi di level RLS. |
| **F-02** | **CRITICAL** | **Table ACL luas untuk `anon`, `authenticated`, dan `service_role`**: Hampir seluruh 28 tabel memberi `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` kepada `anon` & `authenticated`. (`TRUNCATE` melewati RLS `DELETE` policy). | User anonim atau terautentikasi memiliki privilege tingkat tabel yang terlalu permisif, termasuk ke `payment_webhook_events`, `letter_sequences`, dan `audit_logs`. |
| **F-03** | **HIGH** | **Default privileges `postgres` pada `public` terlalu luas**: `TABLES` (ALL), `SEQUENCES` (`SELECT, UPDATE, USAGE`), dan `FUNCTIONS` (`EXECUTE`) otomatis diberikan kepada `anon`, `authenticated`, dan `service_role`. | Setiap objek baru yang dibuat oleh `postgres` otomatis terekspos ke `anon` dan `authenticated`. |
| **F-04** | **HIGH** | **Function ACL terlalu luas**: Seluruh **9 function** pada `public` memiliki `EXECUTE` untuk `anon`, `authenticated`, dan `service_role`; **8 function** (`set_updated_at`, `protect_super_admin_column`, `validate_bill_target_scope`, `validate_payment_and_refund`, `validate_cash_transaction_payment`, `validate_announcement_recipient`, `validate_announcement_target_change`, `validate_tenant_actor`) juga memiliki `EXECUTE` untuk `PUBLIC`; `handle_new_user()` adalah satu-satunya tanpa `PUBLIC EXECUTE`, tetapi masih memiliki grant langsung kepada `anon` dan `authenticated`. | Cabut `EXECUTE` dari `PUBLIC`, `anon`, dan `authenticated` untuk seluruh 9 trigger-only functions. Pencabutan `EXECUTE` pada trigger-only functions tidak menghalangi trigger berjalan karena pemanggilan trigger tidak bergantung pada privilege `EXECUTE` milik role pemicu. |
| **F-05** | **HIGH** | **Sequence ACL (`public`) memberikan `SELECT, UPDATE, USAGE` kepada `anon`, `authenticated`, `service_role`**. | Role `anon` tidak boleh memiliki akses sequence pada schema `public`. |
| **F-06** | **HIGH** | **Risiko konflik `validate_tenant_actor()` (`SECURITY INVOKER`) vs RLS**: `validate_tenant_actor()` membaca `public.tenant_members` dan `public.profiles.is_super_admin` lintas user. Saat RLS aktif, actor milik user lain tidak selalu terlihat oleh invoker. | Dapat menggagalkan operasi sah ketika pengurus/admin memvalidasi actor lain (lihat keputusan arsitektur Bagian 3). |
| **F-07** | **MEDIUM** | **Default privileges `supabase_admin` pada `public` ditemukan**: Merupakan bawaan manajemen internal Supabase. | **Jangan diubah sembarangan**; perlu peninjauan dampak agar tidak mengganggu extension/tooling Supabase. |
| **F-08** | **MEDIUM** | **Pembatasan kolom belum lengkap di luar `profiles`**: `profiles` sudah memiliki 4 column-level `UPDATE` grants (`full_name`, `phone`, `avatar_path`, `active_tenant_id`), namun `payments`, `complaints`, dan `notifications` belum dibatasi di level privilege. | Kolom sensitif seperti `payments.status` atau `notifications.body` masih perlu penguncian privilege/RPC di Step 10.2. |

---

## 2. Fakta Infrastruktur yang Wajib Dipertahankan (Jangan Diubah)

1. **Role Membership `authenticator`**: `authenticator` adalah anggota `anon`, `authenticated`, dan `service_role` — **dilarang mengubah membership ini** karena merupakan mekanisme inti PostgREST/Supabase.
2. **Role Attributes**: `postgres` (`rolsuper=false, rolbypassrls=true`) dan `service_role` (`rolsuper=false, rolbypassrls=true`) memiliki bypass RLS; `anon` & `authenticated` (`rolsuper=false, rolbypassrls=false`).
3. **4 Explicit Column-Level `UPDATE` Grants pada `profiles`**: `full_name`, `phone`, `avatar_path`, `active_tenant_id` untuk `authenticated` wajib dipertahankan.
4. **Schema Internal Supabase**: `auth`, `storage`, `graphql`, `realtime`, `extensions`, dan `supabase_functions` **tidak boleh** menjadi target migration privilege ini.

---

## 3. Keputusan Arsitektur: `validate_tenant_actor()`

Berdasarkan pemeriksaan [20261113000800_create_database_functions.sql](file:///Users/iqbalsahrizal/Documents/CODING/Personal%20Project/smart-rt/supabase/migrations/20261113000800_create_database_functions.sql#L257-L311) dan [20261113000900_create_database_triggers.sql](file:///Users/iqbalsahrizal/Documents/CODING/Personal%20Project/smart-rt/supabase/migrations/20261113000900_create_database_triggers.sql#L100-L134):
- **Keputusan**: Pada Step 10.2, `validate_tenant_actor()` **perlu diubah menjadi `SECURITY DEFINER`** (sementara 7 validator lain tetap `SECURITY INVOKER`).
- **Alasan Teknis**: `validate_tenant_actor()` harus memverifikasi `EXISTS` pada `public.tenant_members` dan `public.profiles (is_super_admin)` untuk `v_actor_id` yang bisa berbeda dari `auth.uid()` (mis. `ketua_rt` memvalidasi `paid_by_user_id` milik warga, atau pemeriksaan `is_super_admin` saat RLS `profiles` hanya membuka baris `id = auth.uid()`).
- **Syarat Keamanan Wajib**:
  1. Owner = `postgres` (`rolbypassrls=true`).
  2. `SET search_path = public, pg_temp`.
  3. Referensi objek schema-qualified (`public.tenant_members`, `public.profiles`) — sudah terpenuhi.
  4. Hanya mengembalikan boolean validasi internal (tidak mengembalikan data ke caller, tidak menerima `user_id` dari caller sebagai identitas otorisasi).
  5. Trigger pemanggil tetap `BEFORE INSERT OR UPDATE OF tenant_id, <actor_col>` (hanya berjalan saat field actor atau `tenant_id` berubah) — sudah terpenuhi di `0009`.
  6. `REVOKE ALL ON FUNCTION public.validate_tenant_actor() FROM PUBLIC, anon, authenticated;`.

---

## 4. Rencana Migration Korektif Step 10.2 (**NON-EXECUTABLE**)

> [!CAUTION]
> Seluruh cuplikan SQL di bawah ini berstatus **NON-EXECUTABLE** (hanya rancangan terurut untuk Step 10.2).

1. **Cabut privilege aplikasi yang terlalu luas pada seluruh 28 tabel `public`**:
   ```sql
   -- NON-EXECUTABLE (Step 10.2 Plan)
   REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
   ```
2. **Berikan privilege minimum `authenticated` per tabel & pertahankan 4 column-level `UPDATE` pada `profiles`**:
   ```sql
   -- NON-EXECUTABLE (Step 10.2 Plan)
   GRANT SELECT ON public.roles, public.audit_logs TO authenticated;
   GRANT SELECT ON public.profiles TO authenticated;
   GRANT UPDATE (full_name, phone, avatar_path, active_tenant_id) ON public.profiles TO authenticated;
   GRANT SELECT, UPDATE (is_read, read_at) ON public.notifications TO authenticated;
   GRANT SELECT, INSERT, UPDATE (category, title, description, photo_path) ON public.complaints TO authenticated;
   GRANT SELECT, INSERT ON public.payments, public.complaint_replies, public.complaint_status_history TO authenticated;
   -- ... (sisanya sesuai postgres-privilege-matrix.md; backend-only tables tetap tanpa grant)
   ```
3. **Cabut privilege sequence `public` yang tidak diperlukan**:
   ```sql
   -- NON-EXECUTABLE (Step 10.2 Plan)
   REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon;
   ```
4. **Cabut `EXECUTE` dari `PUBLIC`, `anon`, `authenticated` untuk seluruh 9 trigger-only functions (termasuk `handle_new_user()`)**:
   *(Pencabutan `EXECUTE` pada trigger-only functions tidak menghalangi trigger berjalan karena pemanggilan trigger tidak bergantung pada privilege `EXECUTE` milik role pemicu.)*
   ```sql
   -- NON-EXECUTABLE (Step 10.2 Plan)
   REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
   ```
5. **Berikan `GRANT EXECUTE` eksplisit hanya untuk 6 helper RLS & RPC client-callable kepada `authenticated`**:
   ```sql
   -- NON-EXECUTABLE (Step 10.2 Plan)
   GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
   GRANT EXECUTE ON FUNCTION public.is_tenant_member(uuid) TO authenticated;
   -- ... (4 helper lainnya + RPC atomik Step 10.2)
   ```
6. **Perbaiki default privileges `postgres` untuk objek baru pada schema `public`**:
   ```sql
   -- NON-EXECUTABLE (Step 10.2 Plan)
   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
   ```
7. **Evaluasi default privileges `supabase_admin`**: Dokumentasikan entri aktual `supabase_admin` dan **jangan ubah** sebelum dipastikan tidak memengaruhi fitur internal Supabase.
8. **Pertahankan `service_role`**: Pastikan `GRANT ALL ON ALL TABLES/SEQUENCES/FUNCTIONS IN SCHEMA public TO service_role;` tetap utuh untuk webhook, cron, dan backend admin.
9. **Pertahankan mekanisme internal Supabase**: Jangan menyentuh `authenticator` membership maupun schema `auth`, `storage` (selain bucket/policy `storage.objects`), `graphql`, `realtime`, `extensions`, `supabase_functions`.

---

## 5. Checklist Verifikasi Pasca-Implementasi Step 10.2

- [ ] `has_table_privilege`: `anon` mengembalikan `false` untuk seluruh 28 tabel (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`); `authenticated` mengembalikan `false` pada `payment_webhook_events` dan `letter_sequences`.
- [ ] `has_column_privilege`: `authenticated` hanya `true` untuk `UPDATE` pada `profiles` (`full_name`, `phone`, `avatar_path`, `active_tenant_id`), `notifications` (`is_read`, `read_at`), dan `complaints` (`category`, `title`, `description`, `photo_path`); `false` pada `profiles.is_super_admin`.
- [ ] `has_sequence_privilege`: `anon` mengembalikan `false` untuk seluruh sequence `public`.
- [ ] `has_function_privilege`: `PUBLIC` dan `anon` mengembalikan `false` untuk seluruh function `public`; `authenticated` mengembalikan `false` untuk 9 trigger-only functions dan `true` hanya untuk helper RLS + client RPC.
- [ ] `pg_default_acl`: `postgres` di schema `public` tidak lagi memberi grant default ke `PUBLIC`, `anon`, atau `authenticated`.
- [ ] `relrowsecurity`: `SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true;` bernilai **28**.
- [ ] `pg_policies`: Seluruh 28 tabel memiliki policy sesuai [rls-policy-matrix.md](file:///Users/iqbalsahrizal/Documents/CODING/Personal%20Project/smart-rt/docs/database/rls-policy-matrix.md).
- [ ] **Anon access denial**: Request PostgREST tanpa JWT (`anon`) ke seluruh 28 tabel ditolak.
- [ ] **Authenticated least privilege**: Uji lintas tenant, eskalasi role, `payments`, `audit_logs`, `resident_private_data`, dan `cash_transactions` semuanya sesuai matriks.
- [ ] **Service role backend access**: `service_role` tetap dapat mengakses `payment_webhook_events`, `letter_sequences`, dan operasi backend lainnya.
