# RLS Architecture & Security Policy Matrix — Smart RT

Dokumen ini merupakan hasil audit dan rancangan final **Row Level Security (RLS)** untuk **28 tabel** pada schema `public` database **Smart RT** sebelum implementasi migrasi Step 10.

> [!IMPORTANT]
> Dokumen ini adalah tahap **desain dan audit**. Tidak ada perubahan pada SQL migration, tidak ada aktivasi RLS, dan tidak ada pembuatan policy pada tahap Step 09.4.

---

## 1. Rangkuman Arsitektur Keamanan & Klasifikasi 28 Tabel

Seluruh 28 tabel pada schema `public` dikelompokkan menjadi **5 kategori akses**:

| Kategori | Jumlah | Daftar Tabel | Prinsip Akses |
| :--- | :---: | :--- | :--- |
| **1. Global Data** | 1 | `roles` | Read-only untuk `authenticated`; tidak dapat dimodifikasi oleh client (`authenticated`/`anon`). |
| **2. User-Owned Data** | 1 | `profiles` | Terikat ke `auth.uid()`; dilindungi column-level `GRANT UPDATE` + trigger `protect_super_admin_column()`. |
| **3. Tenant-Owned Data** | 21 | `tenants`, `tenant_members`, `member_roles`, `households`, `residents`, `vehicles`, `dues`, `bills`, `payments`, `cash_categories`, `cash_transactions`, `announcements`, `announcement_recipients`, `complaints`, `complaint_replies`, `complaint_status_history`, `letter_types`, `letter_requests`, `activities`, `activity_participants`, `notifications` | Isolasi ketat per `tenant_id` berbasis keanggotaan aktif di `tenant_members` dan role di `member_roles`. |
| **4. Sensitive Data** | 2 | `resident_private_data`, `resident_documents` | Isolasi ekstra ketat: hanya `ketua_rt`, `sekretaris`, dan `warga` pemilik data (`resident_id` miliknya). `bendahara`, `pengurus`, dan `super_admin` (default) ditolak. |
| **5. Backend-Only Data** | 3 | `payment_webhook_events`, `letter_sequences`, `audit_logs` | Tidak ada akses tulis langsung dari client; `payment_webhook_events` & `letter_sequences` tertutup total bagi client (`service_role` / RPC `SECURITY DEFINER` saja); `audit_logs` hanya `SELECT` terbatas untuk `super_admin`, `ketua_rt`, `sekretaris`, dan `bendahara`. |

---

## 2. Aturan Tenant Isolation

1. **Larangan Mutlak Penggunaan `profiles.active_tenant_id` sebagai Otorisasi**:
   - Kolom `profiles.active_tenant_id` **hanya** merupakan preferensi UI/konteks kerja terakhir user dan dapat diubah sendiri oleh user melalui `GRANT UPDATE (..., active_tenant_id)`.
   - **Tidak ada satu pun RLS policy** yang boleh mengandalkan `active_tenant_id` untuk menentukan hak akses.
2. **Sumber Kebenaran Otorisasi Tenant**:
   - User dinyatakan berhak mengakses suatu `tenant_id` **hanya jika** terdapat baris pada `public.tenant_members` dengan `user_id = auth.uid()`, `tenant_id = <row.tenant_id>`, `status = 'active'`, dan `tenants.status = 'active'` serta `tenants.deleted_at IS NULL`.
3. **Pertahanan Berlapis dengan Composite Foreign Key**:
   - Seluruh relasi antar-tabel tenant-owned sudah menggunakan composite FK `(tenant_id, <fk_id>)`, sehingga meskipun ada bug di aplikasi, database menolak referensi lintas tenant.

---

## 3. Aturan Kepemilikan Data (Data Ownership)

| Tingkat Kepemilikan | Mekanisme Penentuan Pemilik | Tabel Terkait |
| :--- | :--- | :--- |
| **User-Owned** | `id = auth.uid()` atau `recipient_user_id = auth.uid()` | `profiles`, `notifications` |
| **Member-Owned** | `member_id = get_my_member_id(tenant_id)` | `tenant_members`, `member_roles`, `complaints` (`reporter_member_id`), `complaint_replies`, `letter_requests` (`requested_by_member_id`) |
| **Resident-Owned** | `resident_id = get_my_resident_id(tenant_id)` | `resident_private_data`, `resident_documents`, `activity_participants`, `bills` (jika `resident_id IS NOT NULL`), `letter_requests` |
| **Household-Owned** | `household_id = get_my_household_id(tenant_id)` | `households`, `residents`, `vehicles`, `bills` (jika `household_id IS NOT NULL`), `payments` (via `bills`), `announcement_recipients` |

---

## 4. Helper Functions RLS yang Dibutuhkan (Step 10)

Seluruh helper function berikut wajib dibuat dengan:
- `LANGUAGE sql` atau `plpgsql` dengan atribut **`STABLE`** (menandakan fungsi hanya membaca data tanpa mengubah state dan konsisten dalam satu *table scan*, sehingga optimizer dapat memanfaatkannya dalam rencana eksekusi — bukan jaminan cache tunggal per statement).
- **`SECURITY DEFINER`**, dimiliki oleh role `postgres` (table owner), dan **`SET search_path = public, pg_temp`** dengan seluruh nama tabel di-qualify (`public.*`) guna mencegah *search_path hijacking*.
- **`REVOKE ALL ON FUNCTION ... FROM PUBLIC; GRANT EXECUTE ON FUNCTION ... TO authenticated;`** (tidak diekspos ke `anon`).
- **Tanpa Ambiguitas Membership**: Tabel `public.tenant_members` memiliki constraint `uq_tenant_members_tenant_user UNIQUE (tenant_id, user_id)` (1 user maksimal memiliki 1 keanggotaan per tenant) dan `residents.household_id` bersifat `NOT NULL` (`N:1`), sehingga `get_my_member_id`, `get_my_resident_id`, dan `get_my_household_id` bersifat deterministik (mengembalikan paling banyak 1 UUID atau `NULL` bila status bukan `'active'`).

| Function Signature | Return | Logika Inti |
| :--- | :--- | :--- |
| `public.is_super_admin()` | `boolean` | `EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_super_admin IS TRUE)` |
| `public.is_tenant_member(p_tenant_id uuid)` | `boolean` | `EXISTS (SELECT 1 FROM public.tenant_members tm JOIN public.tenants t ON t.id = tm.tenant_id WHERE tm.tenant_id = p_tenant_id AND tm.user_id = auth.uid() AND tm.status = 'active' AND t.status = 'active' AND t.deleted_at IS NULL)` |
| `public.has_tenant_role(p_tenant_id uuid, p_roles text[])` | `boolean` | `EXISTS (SELECT 1 FROM public.tenant_members tm JOIN public.tenants t ON t.id = tm.tenant_id JOIN public.member_roles mr ON mr.member_id = tm.id AND mr.tenant_id = tm.tenant_id JOIN public.roles r ON r.id = mr.role_id WHERE tm.tenant_id = p_tenant_id AND tm.user_id = auth.uid() AND tm.status = 'active' AND t.status = 'active' AND t.deleted_at IS NULL AND r.code = ANY(p_roles))` |
| `public.get_my_member_id(p_tenant_id uuid)` | `uuid` | `SELECT tm.id FROM public.tenant_members tm WHERE tm.tenant_id = p_tenant_id AND tm.user_id = auth.uid() AND tm.status = 'active' LIMIT 1` |
| `public.get_my_resident_id(p_tenant_id uuid)` | `uuid` | `SELECT tm.resident_id FROM public.tenant_members tm WHERE tm.tenant_id = p_tenant_id AND tm.user_id = auth.uid() AND tm.status = 'active' LIMIT 1` |
| `public.get_my_household_id(p_tenant_id uuid)` | `uuid` | `SELECT r.household_id FROM public.tenant_members tm JOIN public.residents r ON r.id = tm.resident_id AND r.tenant_id = tm.tenant_id WHERE tm.tenant_id = p_tenant_id AND tm.user_id = auth.uid() AND tm.status = 'active' AND r.deleted_at IS NULL LIMIT 1` |

---

## 5. Risiko Recursive RLS & Dependency Analysis

- **Sumber Risiko**:
  1. Policy pada `tenant_members` memanggil subquery langsung ke `tenant_members` -> **Infinite recursion (`42P17`)**.
  2. Policy pada `profiles` mengecek `is_super_admin` dengan subquery ke `profiles` -> **Infinite recursion**.
  3. Policy pada `residents` atau `households` mengecek `tenant_members` sementara `tenant_members` mengecek `residents` -> **Circular recursion**.
- **Dependency Analysis (Arah Baca Helper vs Policy)**:
  - **Tabel Lookup Inti (dibaca oleh helper)**: `profiles`, `tenants`, `tenant_members`, `member_roles`, `roles`, `residents`.
  - **Tabel Leaf / Domain (hanya memanggil helper)**: `households`, `vehicles`, `dues`, `bills`, `payments`, `cash_categories`, `cash_transactions`, `announcements`, `announcement_recipients`, `complaints`, `complaint_replies`, `complaint_status_history`, `letter_types`, `letter_requests`, `activities`, `activity_participants`, `notifications`, `audit_logs`, `resident_private_data`, `resident_documents`.
  - **Tabel Backend-Only**: `payment_webhook_events`, `letter_sequences`.
- **Mitigasi**:
  1. Seluruh helper RLS (`is_super_admin`, `is_tenant_member`, `has_tenant_role`, `get_my_member_id`, `get_my_resident_id`, `get_my_household_id`) dibuat dengan `SECURITY DEFINER` dan dimiliki oleh table owner (`postgres`). Selama `FORCE ROW LEVEL SECURITY` tidak diaktifkan pada 6 tabel lookup inti, pembacaan internal oleh owner di dalam `SECURITY DEFINER` melewati RLS sehingga memutus siklus dependensi.
  2. Pada `profiles`, policy `SELECT`/`UPDATE` milik sendiri menggunakan `id = auth.uid()` langsung tanpa subquery ke `profiles`.

---

## 6. Matriks 28 Tabel × Role × Operasi CRUD

Keterangan Singkatan:
- **S** = `SELECT`, **I** = `INSERT`, **U** = `UPDATE`, **D** = `DELETE`
- **All** = seluruh baris pada `tenant_id` aktif (atau seluruh tenant untuk `super_admin`)
- **Own** = milik `auth.uid()` / `member_id` / `resident_id` sendiri
- **Own HH** = milik `household_id` sendiri
- **—** = ditolak total
- **S\*** / **I\*** / **U\*** = bersyarat (dijelaskan di kolom *Catatan & Guard*)

### 6.1 Global, User-Owned, & Tenant Access (5 Tabel)

| No | Tabel | `super_admin` | `ketua_rt` | `sekretaris` | `bendahara` | `pengurus` | `warga` | `anon` | Catatan & Guard (`WITH CHECK` / Batasan) |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| 1 | `roles` | S | S | S | S | S | S | — | Global read-only; tulis hanya via migration/`service_role`. |
| 2 | `profiles` | S (All), U (Own) | S, U (Own) | S, U (Own) | S, U (Own) | S, U (Own) | S, U (Own) | — | `INSERT` hanya via trigger `auth.users`; `UPDATE` dibatasi kolom `full_name, phone, avatar_path, active_tenant_id`. |
| 3 | `tenants` | S, I, U, D | S (Own) | S (Own) | S (Own) | S (Own) | S (Own) | — | Member hanya baca tenant aktif tempat ia terdaftar; perubahan `status` tenant hanya `super_admin`. |
| 4 | `tenant_members` | S, I, U, D | S, I, U, D (All) | S (All) | S (All) | S (All) | S (Own) | — | Hanya `ketua_rt` / `super_admin` yang boleh mengubah keanggotaan atau `status`. |
| 5 | `member_roles` | S, I, U, D | S, I, U, D (All) | S (All) | S (All) | S (All) | S (Own) | — | Anti-eskalasi: role selain `ketua_rt` & `super_admin` dilarang keras `I/U/D` pada `member_roles`. |

### 6.2 Resident & Household Domain (5 Tabel)

| No | Tabel | `super_admin` | `ketua_rt` | `sekretaris` | `bendahara` | `pengurus` | `warga` | `anon` | Catatan & Guard (`WITH CHECK` / Batasan) |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| 6 | `households` | S | S, I, U, D (All) | S, I, U, D (All) | S (All) | S (All) | S (Own HH) | — | `warga` hanya melihat KK miliknya; soft delete disarankan via `deleted_at`. |
| 7 | `residents` | S | S, I, U, D (All) | S, I, U, D (All) | S (All) | S (All) | S (Own HH) | — | Tidak mengandung NIK; `warga` melihat anggota keluarganya sendiri. |
| 8 | `resident_private_data` | **—** | S, I, U, D (All) | S, I, U, D (All) | **—** | **—** | S (Own) | — | **Data sensitif (NIK, TTL)**: tertutup bagi `bendahara`, `pengurus`, dan default `super_admin`. |
| 9 | `resident_documents` | **—** | S, I, U, D (All) | S, I, U, D (All) | **—** | **—** | S (Own), I\* (Own) | — | `warga` hanya boleh `INSERT` dokumen miliknya dengan `verified_by IS NULL AND verified_at IS NULL`. |
| 10 | `vehicles` | S | S, I, U, D (All) | S, I, U, D (All) | S (All) | S (All) | S, I, U, D (Own HH) | — | `warga` mengelola kendaraan pada `household_id` miliknya sendiri. |

### 6.3 Finance & Cash Management Domain (6 Tabel)

| No | Tabel | `super_admin` | `ketua_rt` | `sekretaris` | `bendahara` | `pengurus` | `warga` | `anon` | Catatan & Guard (`WITH CHECK` / Batasan) |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| 11 | `dues` | S | S, I, U, D (All) | S (All) | S, I, U, D (All) | S (All) | S\* (Active) | — | `warga` hanya baca jenis iuran `is_active = true`. |
| 12 | `bills` | S | S (All) | S (All) | S, I, U (All) | S (All) | S (Own HH / Own) | — | Tidak ada `DELETE` langsung (gunakan `status = 'cancelled'`). `warga` hanya lihat tagihan KK/dirinya. |
| 13 | `payments` | S | S (All) | S (All) | S (All), I/U\* (via RPC) | S (All) | S (Own bill), I\* | — | `warga` hanya `INSERT` (`payment_type = 'payment'`, `status = 'pending'`, `paid_by_user_id = auth.uid()`, `verified_by IS NULL`, `verified_at IS NULL`) untuk bill miliknya; **tanpa hak `UPDATE`**. Verifikasi, penolakan, dan refund wajib melalui **RPC atomik** (`SECURITY DEFINER`), bukan `UPDATE` langsung dari client. |
| 14 | `payment_webhook_events` | **—** (via `service_role`) | **—** | **—** | **—** | **—** | **—** | — | **Backend-only**: tertutup total dari seluruh client (`authenticated` & `anon`). |
| 15 | `cash_categories` | S | S, I, U, D (All) | S (All) | S, I, U, D (All) | S (All) | S (All) | — | Transparansi kategori kas RT. |
| 16 | `cash_transactions` | S | S (All) | S (All) | S, I, U (All) | S (All) | **—** (via View/RPC) | — | `warga` **tidak** membaca `cash_transactions` langsung (mencegah eksposur `payment_id`, `created_by`, `attachment_path`); transparansi kas diberikan melalui view/RPC khusus (lihat Bagian 17). `DELETE` dilarang untuk menjaga jejak audit. |

### 6.4 Announcements, Complaints, & Letters Domain (8 Tabel)

| No | Tabel | `super_admin` | `ketua_rt` | `sekretaris` | `bendahara` | `pengurus` | `warga` | `anon` | Catatan & Guard (`WITH CHECK` / Batasan) |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| 17 | `announcements` | S | S, I, U, D (All) | S, I, U, D (All) | S (All) | S, I, U, D (All) | S\* (Published) | — | `warga` hanya baca `status = 'published' AND deleted_at IS NULL` dan sesuai `target_type` (`all`, atau `role`/`household` yang cocok). |
| 18 | `announcement_recipients` | S | S, I, U, D (All) | S, I, U, D (All) | S (All) | S, I, U, D (All) | S\* (Target) | — | `warga` hanya melihat baris target yang relevan dengan role atau household miliknya. |
| 19 | `complaints` | S | S, U (All) | S, U (All) | S (All) | S, U (All) | S, I\* (Own), U\* | — | `warga` `INSERT` (`reporter_member_id = my_member_id`, `status = 'open'`) & `UPDATE` terbatas kolom konten (`category`, `title`, `description`, `photo_path`) hanya saat `status = 'open'` (lihat Bagian 13). |
| 20 | `complaint_replies` | S | S, I (All) | S, I (All) | S (All) | S, I (All) | S, I\* (Own) | — | `warga` hanya baca/balas jika `author_member_id = my_member_id` **dan** `complaint_id` milik dirinya sendiri pada tenant yang sama (lihat Bagian 13). |
| 21 | `complaint_status_history` | S | S, I (All) | S, I (All) | S (All) | S, I (All) | S (Own) | — | **Append-only**: tidak ada `UPDATE`/`DELETE` bagi seluruh role client. |
| 22 | `letter_types` | S | S, I, U, D (All) | S, I, U, D (All) | S (All) | S (All) | S\* (Active) | — | `warga` hanya baca jenis surat `is_active = true`. |
| 23 | `letter_sequences` | **—** (via RPC/`service_role`) | **—** | **—** | **—** | **—** | **—** | — | **Backend-only**: dikelola oleh RPC atomik `SECURITY DEFINER` agar nomor surat unik & bebas race condition. |
| 24 | `letter_requests` | S | S, U (All) | S, U (All) | S (All) | S (All) | S (Own), I\* (Own) | — | `warga` `INSERT` (`requested_by_member_id = my_member_id`, `status = 'submitted'`, `letter_number IS NULL`, `reviewed_by IS NULL`). |

### 6.5 Activities, Notifications, & Audit Domain (4 Tabel)

| No | Tabel | `super_admin` | `ketua_rt` | `sekretaris` | `bendahara` | `pengurus` | `warga` | `anon` | Catatan & Guard (`WITH CHECK` / Batasan) |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| 25 | `activities` | S | S, I, U, D (All) | S, I, U, D (All) | S (All) | S, I, U, D (All) | S (All) | — | `warga` hanya baca kegiatan dengan `deleted_at IS NULL`. |
| 26 | `activity_participants` | S | S, I, U, D (All) | S, I, U, D (All) | S (All) | S, I, U, D (All) | S (All), I\*/U\* (Own) | — | `warga` hanya dapat RSVP untuk `resident_id = get_my_resident_id(tenant_id)`. |
| 27 | `notifications` | S | S, U\* (Own) | S, U\* (Own) | S, U\* (Own) | S, U\* (Own) | S, U\* (Own) | — | `SELECT`/`UPDATE` hanya jika `recipient_user_id = auth.uid() AND is_tenant_member(tenant_id)`. `UPDATE` dibatasi ke `is_read`, `read_at`. `INSERT` hanya via `service_role` / `SECURITY DEFINER`. |
| 28 | `audit_logs` | S (All) | S (Own tenant) | S (Own tenant) | S (Own tenant) | **—** | **—** | — | **Append-only & system-generated**: tidak ada `INSERT`, `UPDATE`, maupun `DELETE` langsung dari client. |

---

## 7. Strategi `super_admin`

1. **Penetapan & Proteksi**:
   - `profiles.is_super_admin` dilindungi oleh `REVOKE UPDATE` + column-level `GRANT UPDATE` dan trigger `protect_super_admin_column()` (`BEFORE INSERT OR UPDATE`).
   - Penetapan `super_admin` hanya melalui SQL console / `service_role` (non-JWT `authenticated`/`anon`).
2. **Batas Privasi**:
   - `super_admin` memiliki akses manajemen platform (`tenants`, `tenant_members`, `member_roles`, `audit_logs`, serta monitoring operasional), **namun tidak diberikan akses baca default** ke `resident_private_data` dan `resident_documents` guna melindungi PII sensitif (NIK/KTP/KK) warga.

---

## 8. Strategi `service_role`

- Dalam arsitektur Supabase, role `service_role` memiliki atribut `BYPASSRLS` secara default.
- `service_role` hanya digunakan di **server-side** (Next.js Route Handlers / Edge Functions untuk payment webhook, cron penagihan, atau tugas administratif platform) dan **tidak pernah** dikirim ke browser.
- Tabel `payment_webhook_events` dan `letter_sequences` hanya diakses oleh `service_role` atau RPC `SECURITY DEFINER` yang tervalidasi.

---

## 9. Strategi `FORCE ROW LEVEL SECURITY`

- **`ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`** wajib diaktifkan pada **seluruh 28 tabel**.
- **Analisis Owner, `BYPASSRLS`, dan `FORCE ROW LEVEL SECURITY`**:
  - `FORCE ROW LEVEL SECURITY` **bukan** penyebab langsung recursion; ia hanya memaksa **table owner** (`postgres`, yang pada managed Supabase tidak memiliki atribut `SUPERUSER`/`BYPASSRLS` untuk melewati `FORCE RLS`) agar ikut tunduk pada RLS policy tabel tersebut.
  - Apabila `FORCE ROW LEVEL SECURITY` diaktifkan pada 6 tabel lookup inti (`profiles`, `tenants`, `tenant_members`, `member_roles`, `roles`, `residents`), maka fungsi helper `SECURITY DEFINER` milik `postgres` akan ikut dievaluasi oleh policy tabelnya sendiri dan memicu siklus dependensi (`42P17`).
  - Role `service_role` memiliki `BYPASSRLS` sehingga tetap melewati baik `ENABLE` maupun `FORCE ROW LEVEL SECURITY`.
  - **Keputusan Desain**: Gunakan `ENABLE ROW LEVEL SECURITY` pada semua 28 tabel **tanpa** `FORCE ROW LEVEL SECURITY` pada 6 tabel lookup inti maupun tabel yang ditulis oleh trigger/RPC milik `postgres` (seperti `audit_logs` dan `notifications`), dikombinasikan dengan pengetatan `REVOKE`/`GRANT` PostgreSQL.

---

## 10. Evaluasi Grants & Privilege PostgreSQL

Agar tidak ada celah yang melewati RLS atau mengizinkan manipulasi kolom sensitif:
1. **`anon`**: `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;` dan `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;` (seluruh endpoint data Smart RT mewajibkan autentikasi).
2. **Backend-Only Tables (`payment_webhook_events`, `letter_sequences`)**: `REVOKE ALL ON public.payment_webhook_events, public.letter_sequences FROM authenticated, anon;`.
3. **Append-Only Tables (`audit_logs`, `complaint_status_history`)**: `REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM authenticated, anon;` dan `REVOKE UPDATE, DELETE ON public.complaint_status_history FROM authenticated, anon;`.
4. **Global Catalog (`roles`)**: `REVOKE INSERT, UPDATE, DELETE ON public.roles FROM authenticated, anon;`.
5. **Column-Level Privileges**:
   - `profiles`: sudah diterapkan (`REVOKE UPDATE` + `GRANT UPDATE (full_name, phone, avatar_path, active_tenant_id)`).
   - `notifications`: terapkan `REVOKE UPDATE ON public.notifications FROM authenticated; GRANT UPDATE (is_read, read_at) ON public.notifications TO authenticated;` agar user tidak dapat mengubah `recipient_user_id`, `tenant_id`, atau `body` notifikasi.

---

## 11. Daftar Skenario Security Testing (Untuk Step 10)

1. **Cross-Tenant Isolation**: User Tenant A mencoba `SELECT`/`INSERT`/`UPDATE`/`DELETE` data Tenant B meskipun `profiles.active_tenant_id` diubah ke Tenant B -> **Ditolak**.
2. **Recursive RLS Check**: Query `SELECT` pada `tenant_members`, `member_roles`, `residents`, dan `profiles` sebagai `authenticated` tidak memicu error `42P17 (infinite recursion detected)`.
3. **Sensitive PII Protection**: `bendahara`, `pengurus`, dan `warga` lain mencoba `SELECT` `resident_private_data` & `resident_documents` milik warga lain -> **Ditolak (0 rows)**.
4. **Privilege Escalation**:
   - `warga` / `sekretaris` mencoba `INSERT`/`UPDATE` `member_roles` untuk menjadikan dirinya `ketua_rt` -> **Ditolak**.
   - `authenticated` mencoba `UPDATE profiles SET is_super_admin = true` -> **Ditolak**.
5. **Payment Manipulation**: `warga` mencoba `INSERT payments` dengan `status = 'verified'` atau `payment_type = 'refund'` -> **Ditolak**.
6. **Backend-Only & Append-Only**: `authenticated` mencoba `SELECT` `payment_webhook_events` / `letter_sequences` atau `INSERT`/`UPDATE`/`DELETE` `audit_logs` -> **Ditolak**.
7. **`anon` Rejection**: Request tanpa JWT (`anon`) ke seluruh 28 tabel -> **Ditolak**.

---

## 12. Daftar Risiko & Rekomendasi Mitigasi

| No | Risiko | Dampak | Rekomendasi Mitigasi |
| :---: | :--- | :--- | :--- |
| 1 | `warga` memodifikasi kolom sensitif pada `payments` (mis. `status = 'verified'`) atau `letter_requests` (`letter_number`) | Fraud keuangan / pemalsuan surat | Gunakan `WITH CHECK` ketat pada policy `INSERT` `warga` + arahkan verifikasi pembayaran & penerbitan surat ke RPC atomik `SECURITY DEFINER`. |
| 2 | `ketua_rt` menghapus role `ketua_rt` terakhir pada tenant | Tenant terkunci tanpa admin | Tambahkan validasi di RPC/trigger pada Step 10 agar minimal 1 `ketua_rt` aktif tetap ada (atau pemulihan oleh `super_admin`). |
| 3 | `notifications` dimodifikasi isi pesannya oleh penerima | Integritas pesan sistem rusak | Terapkan column-level `GRANT UPDATE (is_read, read_at)` pada `notifications`. |
| 4 | Infinite recursion jika `FORCE ROW LEVEL SECURITY` dipasang sembarangan | Aplikasi lumpuh (`42P17`) | Gunakan `ENABLE ROW LEVEL SECURITY` + helper `SECURITY DEFINER` tanpa `FORCE RLS` pada tabel lookup keanggotaan. |


---

## 13. Complaint Ownership Validation

1. **Validasi Kepemilikan `complaint_replies` untuk `warga`**:
   - Policy `SELECT` dan `INSERT` (`WITH CHECK`) pada `public.complaint_replies` untuk `warga` wajib memeriksa **dua** syarat sekaligus:
     1. `author_member_id = public.get_my_member_id(tenant_id)`
     2. `EXISTS (SELECT 1 FROM public.complaints c WHERE c.id = complaint_id AND c.tenant_id = complaint_replies.tenant_id AND c.reporter_member_id = public.get_my_member_id(tenant_id) AND c.deleted_at IS NULL)`
   - Dengan demikian, warga tidak dapat menyisipkan balasan ke pengaduan milik warga lain meskipun mengetahui `complaint_id`-nya.
2. **Pembatasan Kolom `UPDATE` `complaints` untuk `warga`**:
   - Policy `UPDATE` `warga` hanya berlaku bila `reporter_member_id = public.get_my_member_id(tenant_id)` dan `status = 'open'` (`USING` & `WITH CHECK`).
   - Kolom yang boleh diubah oleh `warga` dibatasi hanya pada konten pengaduan (`category`, `title`, `description`, `photo_path`), sedangkan `status`, `priority`, `reporter_member_id`, `tenant_id`, dan `deleted_at` tidak boleh diubah oleh `warga` (ditegakkan via trigger `BEFORE UPDATE` atau pembatasan `WITH CHECK` + RPC untuk transisi status oleh pengurus).

---

## 14. Finance Column-Level Security & Atomic RPC

1. **Pembatasan `UPDATE` pada `public.payments`**:
   - `REVOKE UPDATE ON public.payments FROM authenticated, anon;` — client tidak diperbolehkan melakukan `UPDATE` langsung ke kolom sensitif (`status`, `amount`, `payment_type`, `parent_payment_id`, `bill_id`, `verified_by`, `verified_at`).
   - Warga hanya memiliki hak `INSERT` dengan `WITH CHECK`: `payment_type = 'payment'`, `status = 'pending'`, `parent_payment_id IS NULL`, `paid_by_user_id = auth.uid()`, `verified_by IS NULL`, `verified_at IS NULL`, serta `bill_id` milik rumah tangga/dirinya.
2. **Alur Verifikasi, Penolakan, Refund, dan Konsistensi `bills` via RPC Atomik (`SECURITY DEFINER`)**:
   - Seluruh transisi status `payments` wajib melalui RPC atomik (hanya untuk `bendahara` pada tenant aktif, atau `service_role` pada webhook):
     - `verify_payment_and_reconcile(p_payment_id uuid, p_cash_category_id uuid)`: mengunci baris `payments` dan `bills` (`FOR UPDATE`), mengubah `payments.status = 'verified'`, mengisi `verified_by = auth.uid()` dan `verified_at = now()`, menghitung ulang `bills.paid_amount` (`SUM(verified payments) - SUM(verified refunds)`), memperbarui `bills.status` (`paid` bila `paid_amount >= amount`, `partial` bila `0 < paid_amount < amount`) dan `bills.paid_at`, lalu mencatat `cash_transactions` (`income`) dan `audit_logs` dalam **satu transaksi atomik**.
     - `reject_payment(p_payment_id uuid, p_notes text)`: mengubah `payments.status = 'rejected'` beserta `verified_by`/`verified_at` dan `audit_logs`.
     - `process_refund(p_parent_payment_id uuid, p_amount numeric, p_cash_category_id uuid, p_notes text)`: memanfaatkan lock `FOR UPDATE` pada parent payment (`validate_payment_and_refund()`), membuat baris `payment_type = 'refund'` berstatus `'verified'`, menghitung ulang `bills.paid_amount` dan `bills.status` (`refunded` / `partial` / `unpaid`), serta mencatat `cash_transactions` (`expense`) dan `audit_logs`.

---

## 15. Storage Security Matrix

> [!IMPORTANT]
> RLS pada tabel `public.*` **tidak otomatis melindungi** file di Supabase Storage. Setiap private bucket wajib dilindungi policy pada `storage.objects` serta konvensi path `{tenant_id}/...` (sesuai [storage-design.md](file:///Users/iqbalsahrizal/Documents/CODING/Personal%20Project/smart-rt/docs/database/storage-design.md)).

| Bucket ID (Private) | Konvensi Path | `ketua_rt` | `sekretaris` | `bendahara` | `pengurus` | `warga` | `super_admin` | Signed URL & Guard |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| `resident-documents` | `{tenant_id}/{resident_id}/{file_id}.{ext}` | S, I, D | S, I, D | **—** | **—** | S, I, D (Own `resident_id`) | **—** (default) | TTL singkat `60–300` detik; `SELECT` & `INSERT` hanya setelah verifikasi tenant + `resident_id = get_my_resident_id(tenant_id)` atau role `ketua_rt`/`sekretaris`. |
| `payment-proofs` | `{tenant_id}/{bill_id}/{file_id}.{ext}` | S | S | S, I | S | S, I (Own bill) | **—** | `DELETE` dilarang setelah `payment` berstatus `verified`. |
| `complaints` | `{tenant_id}/{complaint_id}/{file_id}.{ext}` | S, I | S, I | S | S, I | S, I (Own complaint) | **—** | Terikat kepemilikan `complaint_id` untuk `warga`. |
| `letter-requests` | `{tenant_id}/{request_id}/{file_id}.{ext}` | S, I | S, I | S | S | S, I (Own request) | **—** | Terikat `requested_by_member_id` / `resident_id` milik `warga`. |
| `issued-letters` | `{tenant_id}/{request_id}/{file_id}.pdf` | S, I | S, I | S | S | S (Own request) | **—** | Upload hanya `sekretaris`, `ketua_rt`, atau `service_role`. |
| `activity-docs` | `{tenant_id}/{activity_id}/{file_id}.{ext}` | S, I, D | S, I, D | S | S, I, D | S (Active member) | **—** | Seluruh anggota aktif tenant dapat mengunduh dokumentasi kegiatan. |

- **Penerbitan Signed URL**: Signed URL hanya diterbitkan oleh backend/endpoint terotorisasi (atau Supabase Storage API setelah policy `storage.objects` `SELECT` lolos); tidak ada bucket berstatus `public = true`.

---

## 16. Last `ketua_rt` Protection

- **Risiko**: Penghapusan baris `member_roles` untuk role `ketua_rt`, pengubahan `tenant_members.status` menjadi `'inactive'`/`'invited'`, atau penghapusan `tenant_members` bagi `ketua_rt` terakhir dapat mengunci tenant tanpa administrator.
- **Mekanisme Aman Concurrency**:
  1. Buat trigger `BEFORE DELETE OR UPDATE` pada `public.member_roles` dan `public.tenant_members` (atau wajibkan mutasi role melalui RPC atomik `manage_member_role(...)`).
  2. Di dalam trigger/RPC, lakukan row lock pada parent tenant:
     `SELECT id FROM public.tenants WHERE id = v_tenant_id FOR UPDATE;`
     sebelum menghitung jumlah anggota aktif (`tenant_members.status = 'active'`) yang masih memiliki role `ketua_rt`.
  3. Apabila operasi menyebabkan jumlah `ketua_rt` aktif pada tenant aktif (`tenants.deleted_at IS NULL`) menjadi `0`, raise exception — sehingga dua transaksi paralel yang mencoba mendemosi dua `ketua_rt` terakhir akan diserialisasi oleh lock `tenants` dan transaksi kedua ditolak.

---

## 17. Cash Transparency Architecture

- **Evaluasi Risiko**: Mengizinkan `warga` melakukan `SELECT` langsung pada `public.cash_transactions` berisiko membuka kolom `payment_id` (korelasi waktu pembayaran iuran individu), `created_by` (identitas `user_id` pengurus), dan `attachment_path`.
- **Rancangan View / RPC Transparansi Kas**:
  - Tutup akses `SELECT` langsung `warga` pada `public.cash_transactions`.
  - Sediakan RPC `SECURITY DEFINER` (`public.get_tenant_cash_ledger(p_tenant_id uuid)`) atau view `public.cash_transparency_view` (`WITH (security_invoker = false)` milik `postgres` yang memfilter `WHERE public.is_tenant_member(tenant_id)` secara eksplisit di dalam definisi view).
  - **Kolom yang Diizinkan**: `id`, `tenant_id`, `category_id`, `type`, `amount`, `transaction_date`, `description` (tanpa `payment_id`, `created_by`, `attachment_path`).
  - **Anti-Bypass Guarantee**: Karena `is_tenant_member(tenant_id)` dievaluasi di dalam definisi view/RPC, user non-member dan `anon` tidak pernah dapat membaca data lintas tenant melalui view tersebut (`REVOKE ALL FROM anon`).

---

## 18. Helper Function Ownership and Privilege Audit

1. **Owner & `BYPASSRLS`**: Seluruh helper RLS (`is_super_admin`, `is_tenant_member`, `has_tenant_role`, `get_my_member_id`, `get_my_resident_id`, `get_my_household_id`) dimiliki oleh `postgres` (table owner seluruh tabel `public.*`). Karena 6 tabel lookup inti tidak memakai `FORCE ROW LEVEL SECURITY`, eksekusi di dalam `SECURITY DEFINER` milik `postgres` melewati RLS tabel-tabel tersebut tanpa memerlukan atribut `SUPERUSER`.
2. **Pencegahan Penggantian/Pembuatan Fungsi Berbahaya**:
   - Pastikan `REVOKE CREATE ON SCHEMA public FROM PUBLIC;` sehingga `authenticated` dan `anon` tidak dapat membuat atau menimpa fungsi/objek di schema `public`.
3. **Keamanan `search_path` & `EXECUTE`**:
   - Seluruh fungsi `SECURITY DEFINER` wajib memakai `SET search_path = public, pg_temp` dan menuliskan prefix schema `public.*` secara eksplisit pada setiap referensi tabel/fungsi.
   - Terapkan `REVOKE ALL ON FUNCTION ... FROM PUBLIC;` diikuti `GRANT EXECUTE ON FUNCTION ... TO authenticated;` untuk helper RLS, serta `REVOKE ALL` dari `anon`.

---

## 19. Final Implementation Checklist (Step 10)

1. [ ] Terapkan `REVOKE CREATE ON SCHEMA public FROM PUBLIC;` dan `REVOKE ALL ON ALL TABLES, FUNCTIONS IN SCHEMA public FROM anon;`.
2. [ ] Buat 6 helper RLS (`SECURITY DEFINER`, `STABLE`, `SET search_path = public, pg_temp`, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO authenticated`).
3. [ ] Aktifkan `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` pada **seluruh 28 tabel** (tanpa `FORCE RLS` pada 6 tabel lookup inti).
4. [ ] Terapkan policy `SELECT`, `INSERT`, `UPDATE`, `DELETE` terpisah per tabel sesuai Matriks Bagian 6 + validasi `complaint_replies` (Bagian 13).
5. [ ] Terapkan `REVOKE`/`GRANT` kolom pada `notifications` (`is_read`, `read_at`) dan `payments` (hanya `INSERT` warga berstatus `pending`; verifikasi/refund via RPC atomik Bagian 14).
6. [ ] Implementasikan trigger/RPC proteksi `ketua_rt` terakhir dengan `FOR UPDATE` pada `tenants` (Bagian 16).
7. [ ] Implementasikan `get_tenant_cash_ledger` / `cash_transparency_view` (Bagian 17).
8. [ ] Konfigurasikan 6 private buckets dan RLS policies pada `storage.objects` (Bagian 15).
9. [ ] Jalankan seluruh skenario security testing pada Bagian 11 di PostgreSQL 15+ / Supabase lokal.
