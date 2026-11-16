# PostgreSQL Privilege Matrix — Smart RT (Step 10.1.2 Final)

Dokumen ini merupakan finalisasi matriks privilege PostgreSQL berdasarkan hasil **live local database audit** dan static audit `supabase/migrations/20261113000100_*` s.d. `20261113000900_*`, sebagai dasar implementasi **Step 10.2**.

> [!NOTE]
> **Status Audit**: Seluruh 13 fakta live database pada Bagian 1 telah terverifikasi. Tahap ini **tidak** mengubah migration SQL, database, `GRANT`/`REVOKE`, role membership, maupun mengaktifkan RLS.

---

## 1. Kondisi Aktual Terverifikasi (Live Database Audit)

1. **Tabel & RLS**: Terdapat **28 tabel** pada schema `public`; **seluruh 28 tabel belum mengaktifkan RLS** dan belum memiliki RLS policies.
2. **Table ACL**: Menunjukkan grant luas (`SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER`) kepada `anon`, `authenticated`, dan `service_role`.
3. **Explicit Column-Level Grants (`profiles`)**: Hanya terdapat **4 explicit column-level `UPDATE` grants** pada `public.profiles` (`full_name`, `phone`, `avatar_path`, `active_tenant_id`) kepada `authenticated` — wajib dipertahankan, dan table-level `UPDATE` tetap harus dicabut agar tidak mengalahkan pembatasan kolom.
4. **Sequence ACL (`public`)**: Memberikan `SELECT, UPDATE, USAGE` kepada `anon`, `authenticated`, dan `service_role`.
5. **Function ACL (`public`)**:
   - Seluruh **9 function** pada `public` (`set_updated_at`, `handle_new_user`, `protect_super_admin_column`, `validate_bill_target_scope`, `validate_payment_and_refund`, `validate_cash_transaction_payment`, `validate_announcement_recipient`, `validate_announcement_target_change`, `validate_tenant_actor`) saat ini memberikan `EXECUTE` kepada `anon`, `authenticated`, dan `service_role`.
   - **8 function** (`set_updated_at`, `protect_super_admin_column`, `validate_bill_target_scope`, `validate_payment_and_refund`, `validate_cash_transaction_payment`, `validate_announcement_recipient`, `validate_announcement_target_change`, `validate_tenant_actor`) juga memiliki `EXECUTE` kepada `PUBLIC`.
   - `handle_new_user()` adalah satu-satunya function tanpa `PUBLIC EXECUTE`, tetapi masih memiliki grant langsung kepada `anon` dan `authenticated`.
   - *(Catatan: Pencabutan `EXECUTE` pada trigger-only functions tidak menghalangi trigger berjalan karena pemanggilan trigger oleh PostgreSQL tidak bergantung pada privilege `EXECUTE` milik role pemicu DML.)*
6. **Default Privileges (`pg_default_acl`)**:
   - **Owner `postgres` pada schema `public`**:
     - `TABLES`: semua privilege kepada `anon`, `authenticated`, `service_role`.
     - `SEQUENCES`: `SELECT, UPDATE, USAGE` kepada `anon`, `authenticated`, `service_role`.
     - `FUNCTIONS`: `EXECUTE` kepada `anon`, `authenticated`, `service_role`.
   - **Owner `supabase_admin` pada `public`**: Ditemukan entri default privileges untuk `supabase_admin`; **memerlukan peninjauan dampak sebelum diubah** dan tidak boleh diubah secara sembarangan.
7. **Role & Membership**:
   - `postgres`: `rolsuper=false, rolbypassrls=true`.
   - `service_role`: `rolsuper=false, rolbypassrls=true`.
   - `supabase_admin`: `rolsuper=true, rolbypassrls=true`.
   - `anon` & `authenticated`: `rolsuper=false, rolbypassrls=false`.
   - `authenticator` merupakan anggota `anon`, `authenticated`, dan `service_role` — **tidak boleh diubah** (mekanisme inti PostgREST/Supabase).
8. **Schema `public`**: `anon` (`USAGE=true, CREATE=false`), `authenticated` (`USAGE=true, CREATE=false`), `service_role` (`USAGE=true, CREATE=false`), `postgres` (`USAGE=true, CREATE=true`).
9. **Scope Schema Internal Supabase**: Schema `auth`, `storage`, `graphql`, `realtime`, `extensions`, dan `supabase_functions` **tidak boleh** menjadi target migration keamanan aplikasi ini (kecuali konfigurasi Storage buckets/policies pada `storage.objects` yang memang bagian dari aplikasi).

---

## 2. Matriks Privilege Target — 28 Tabel Schema `public` (Step 10.2)

Perbedaan **Table-Level vs Column-Level Privilege**:
- **Table-Level `UPDATE`** mengizinkan modifikasi **seluruh kolom** tabel (termasuk kolom sensitif seperti `is_super_admin`, `status`, `verified_by`).
- **Column-Level `UPDATE`** hanya mengizinkan `UPDATE` pada kolom tertentu; apabila table-level `UPDATE` juga diberikan ke role yang sama, maka table-level `UPDATE` akan **mengalahkan** pembatasan kolom tersebut. Karena itu, pada `profiles`, `complaints`, dan `notifications`, table-level `UPDATE` wajib di-`REVOKE` dari `authenticated`.

Keterangan: **S** = `SELECT`, **I** = `INSERT`, **U** = `UPDATE`, **D** = `DELETE`, **—** = `REVOKE ALL` (termasuk `TRUNCATE`, `REFERENCES`, `TRIGGER` dicabut dari `PUBLIC`, `anon`, dan `authenticated`).

| No | Tabel | Kategori | `PUBLIC` | `anon` | `authenticated` (Target Step 10.2) | `service_role` | Catatan & Pembatasan Kolom |
| :---: | :--- | :--- | :---: | :---: | :--- | :---: | :--- |
| 1 | `roles` | Global | — | — | **S** | ALL | Global read-only; `I, U, D` dicabut |
| 2 | `profiles` | User-Owned | — | — | **S**, **U (`full_name`, `phone`, `avatar_path`, `active_tenant_id`)** | ALL | Pertahankan 4 column-level `UPDATE`; tanpa table-level `UPDATE`; `I, D` dicabut |
| 3 | `tenants` | Tenant-Owned | — | — | **S**, **I**, **U**, **D** (dibatasi RLS `is_super_admin()` / member `S`) | ALL | |
| 4 | `tenant_members` | Tenant-Owned | — | — | **S** (mutasi via RPC atau RLS `ketua_rt`/`super_admin`) | ALL | Proteksi `ketua_rt` terakhir via lock `tenants FOR UPDATE` |
| 5 | `member_roles` | Tenant-Owned | — | — | **S** (mutasi via RPC atau RLS `ketua_rt`/`super_admin`) | ALL | Anti-eskalasi + proteksi `ketua_rt` terakhir |
| 6 | `households` | Tenant-Owned | — | — | **S**, **I**, **U**, **D** (RLS) | ALL | `warga` hanya `S` (`Own HH`) |
| 7 | `residents` | Tenant-Owned | — | — | **S**, **I**, **U**, **D** (RLS) | ALL | Tidak memuat NIK |
| 8 | `resident_private_data` | Sensitive | — | — | **S**, **I**, **U**, **D** (RLS `ketua_rt`/`sekretaris`; `warga` `S` own) | ALL | Tertutup bagi `bendahara`, `pengurus`, dan default `super_admin` |
| 9 | `resident_documents` | Sensitive | — | — | **S**, **I**, **U**, **D** (RLS; `warga` hanya `S` & `I` own unverified) | ALL | `warga` dilarang mengisi `verified_by`/`verified_at` |
| 10 | `vehicles` | Tenant-Owned | — | — | **S**, **I**, **U**, **D** (RLS) | ALL | `warga` hanya `Own HH` |
| 11 | `dues` | Tenant-Owned | — | — | **S**, **I**, **U**, **D** (RLS) | ALL | `warga` hanya `S` (`is_active = true`) |
| 12 | `bills` | Tenant-Owned | — | — | **S**, **I**, **U** (`D` dicabut) | ALL | `paid_amount`, `status`, `paid_at` dikelola RPC atomik |
| 13 | `payments` | Tenant-Owned | — | — | **S**, **I** (**`U`, `D` dicabut**) | ALL | `warga` hanya `I` `pending`; verifikasi/refund via RPC atomik |
| 14 | `payment_webhook_events` | **Backend-Only** | — | — | **—** (`REVOKE ALL`) | ALL | Tertutup total bagi client |
| 15 | `cash_categories` | Tenant-Owned | — | — | **S**, **I**, **U**, **D** (RLS) | ALL | |
| 16 | `cash_transactions` | Tenant-Owned | — | — | **S**, **I**, **U** (`D` dicabut; RLS tolak `warga`) | ALL | Transparansi `warga` via view/RPC khusus |
| 17 | `announcements` | Tenant-Owned | — | — | **S**, **I**, **U**, **D** (RLS) | ALL | `warga` hanya `S` (`published`) |
| 18 | `announcement_recipients` | Tenant-Owned | — | — | **S**, **I**, **U**, **D** (RLS) | ALL | |
| 19 | `complaints` | Tenant-Owned | — | — | **S**, **I**, **U (`category`, `title`, `description`, `photo_path`)** (`D` dicabut) | ALL | Column-level `UPDATE` membatasi `warga`; status pengurus via RPC atomik |
| 20 | `complaint_replies` | Tenant-Owned | — | — | **S**, **I** (`U`, `D` dicabut) | ALL | `warga` hanya pada complaint miliknya |
| 21 | `complaint_status_history` | Tenant-Owned | — | — | **S**, **I** (**`U`, `D` dicabut** — append-only) | ALL | |
| 22 | `letter_types` | Tenant-Owned | — | — | **S**, **I**, **U**, **D** (RLS) | ALL | |
| 23 | `letter_sequences` | **Backend-Only** | — | — | **—** (`REVOKE ALL`) | ALL | Dikelola RPC atomik `SECURITY DEFINER` |
| 24 | `letter_requests` | Tenant-Owned | — | — | **S**, **I**, **U** (`D` dicabut) | ALL | `warga` hanya `I` (`submitted`, `letter_number IS NULL`) |
| 25 | `activities` | Tenant-Owned | — | — | **S**, **I**, **U**, **D** (RLS) | ALL | |
| 26 | `activity_participants` | Tenant-Owned | — | — | **S**, **I**, **U**, **D** (RLS; `warga` hanya `resident_id` sendiri) | ALL | Menghapus `S` daftar peserta penuh bagi `warga` |
| 27 | `notifications` | User/Tenant | — | — | **S**, **U (`is_read`, `read_at`)** (`I`, `D` dicabut) | ALL | `I` hanya via `service_role` / `SECURITY DEFINER` |
| 28 | `audit_logs` | **Backend/Audit** | — | — | **S** (**`I`, `U`, `D` dicabut**) | ALL | Append-only & system-generated |

---

## 3. Matriks Functions (Trigger-Only, RLS Helpers, & Client-Callable RPC)

*(Catatan: Pencabutan `EXECUTE` pada trigger-only functions tidak menghalangi trigger berjalan karena pemanggilan trigger tidak bergantung pada privilege `EXECUTE` milik role pemicu.)*

| Kategori | Nama Function | Security | `PUBLIC` | `anon` | `authenticated` | `service_role` |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **Trigger-Only (Existing `0008`)** | `set_updated_at()`, `protect_super_admin_column()`, `validate_bill_target_scope()`, `validate_payment_and_refund()`, `validate_cash_transaction_payment()`, `validate_announcement_recipient()`, `validate_announcement_target_change()` | `INVOKER` | — | — | — | — |
| **Trigger-Only (Existing `0008`, Evaluasi `DEFINER`)** | `validate_tenant_actor()` | `DEFINER` *(rencana 10.2)* | — | — | — | — |
| **Trigger-Only (`auth.users`)** | `handle_new_user()` | `DEFINER` | — | — | — | — |
| **RLS Helpers (Rencana `10.2`)** | `is_super_admin()`, `is_tenant_member(uuid)`, `has_tenant_role(uuid, text[])`, `get_my_member_id(uuid)`, `get_my_resident_id(uuid)`, `get_my_household_id(uuid)` | `DEFINER` | — | — | **EXECUTE** | EXECUTE |
| **Client-Callable RPC (Rencana `10.2`)** | `verify_payment_and_reconcile(...)`, `reject_payment(...)`, `process_refund(...)`, `update_complaint_status(...)`, `get_tenant_cash_ledger(uuid)`, `issue_letter_number(...)`, `manage_member_role(...)` | `DEFINER` | — | — | **EXECUTE** *(validasi role di dalam RPC)* | EXECUTE |

---

## 4. Sequences, Schema `public`, & Default Privileges

1. **Schema `public`**: Pertahankan `USAGE` untuk `anon`, `authenticated`, `service_role` (`CREATE=false`), dan `CREATE=true` hanya untuk `postgres`. Pastikan `REVOKE CREATE ON SCHEMA public FROM PUBLIC;`.
2. **Existing Sequences (`public`)**: Cabut `SELECT, UPDATE, USAGE` dari `PUBLIC` dan `anon`; pertahankan `service_role`.
3. **Default Privileges `postgres` (`public`)**: Cabut grant luas (`TABLES`, `SEQUENCES`, `FUNCTIONS`) dari `PUBLIC`, `anon`, dan `authenticated`; pertahankan akses `service_role` untuk kebutuhan backend.
4. **Default Privileges `supabase_admin` (`public`)**: Tercatat sebagai temuan audit; **tidak diubah sembarangan** tanpa evaluasi dampak terhadap mekanisme internal Supabase/extension.
