# Security & Row Level Security (RLS) Design — Smart RT

Dokumen ini mendefinisikan strategi keamanan multi-tenant, otorisasi berbasis role (RBAC), perlindungan data sensitif, dan rancangan **PostgreSQL Row Level Security (RLS)** untuk **Smart RT**.

---

## 1. Prinsip Keamanan Utama

1. **Zero Trust pada Client**: Nilai `tenant_id` atau `profiles.active_tenant_id` dari frontend **tidak pernah** dijadikan bukti otorisasi. Seluruh isolasi divalidasi di server/database menggunakan `auth.uid()` dan tabel `tenant_members`.
2. **RLS Wajib Aktif**: Seluruh tabel operasional wajib mengaktifkan `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`.
3. **Pemisahan Kolom Sensitif**: Karena RLS bekerja di level **baris**, data identitas sensitif (`nik`, `birth_place`, `birth_date`) dipisahkan ke `resident_private_data` agar query direktori `residents` tidak berisiko membocorkan NIK.

---

## 2. Helper Functions RLS & Anti-Recursive Design

Untuk menghindari *infinite recursion* saat policy RLS di tabel `tenant_members` atau `member_roles` melakukan subquery ke tabelnya sendiri, helper function menggunakan `SECURITY DEFINER` dengan pengamanan ketat:

- **`SET search_path = public, pg_temp`**: Mencegah *search_path hijacking*.
- **Pembatasan Hak `EXECUTE`**: `REVOKE ALL ON FUNCTION ... FROM PUBLIC; GRANT EXECUTE ON FUNCTION ... TO authenticated;`.
- **`SECURITY DEFINER` Terbatas**: Hanya digunakan pada 3 fungsi helper baca-saja berikut yang tidak menerima input SQL dinamis:

1. `is_super_admin() RETURNS boolean`:
   - Mengecek `EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_super_admin = true)`.
2. `is_tenant_member(p_tenant_id uuid) RETURNS boolean`:
   - Mengecek `EXISTS (SELECT 1 FROM public.tenant_members tm JOIN public.tenants t ON t.id = tm.tenant_id WHERE tm.tenant_id = p_tenant_id AND tm.user_id = auth.uid() AND tm.status = 'active' AND t.status = 'active' AND t.deleted_at IS NULL)`.
3. `has_tenant_role(p_tenant_id uuid, p_roles text[]) RETURNS boolean`:
   - Mengecek apakah `auth.uid()` adalah anggota aktif di `p_tenant_id` dan memiliki minimal satu role pada `member_roles` JOIN `roles` dengan `roles.code = ANY(p_roles)`.

---

## 3. Keamanan `super_admin` (Anti Privilege Escalation)

1. **Column-Level Privilege**: `REVOKE UPDATE ON public.profiles FROM authenticated, anon; GRANT UPDATE (full_name, phone, avatar_path, active_tenant_id) ON public.profiles TO authenticated;` sehingga API client tidak dapat mengirim perubahan `is_super_admin`.
2. **Trigger Perlindungan**: Trigger `BEFORE INSERT OR UPDATE ON profiles` (`protect_super_admin_column()`) memverifikasi `current_user IN ('postgres', 'supabase_admin', 'service_role')` sekaligus `request.jwt.claim.role NOT IN ('authenticated', 'anon')`.
3. **Pemberian & Pencabutan Akses**: Penunjukan atau pencabutan `super_admin` hanya dilakukan melalui SQL console / migration administratif terpercaya, bukan lewat endpoint aplikasi publik.

---

## 4. Perlindungan Data Sensitif (`resident_private_data` & `households.kk_number`)

- **Role Pengurus Berwenang**: Hanya `ketua_rt` dan `sekretaris` pada `tenant_id` yang sama yang dapat `SELECT` / `INSERT` / `UPDATE` `resident_private_data`. (`bendahara` dan `pengurus` umum tidak membutuhkan akses NIK).
- **Pemilik Data**: Seorang `warga` hanya dapat `SELECT` baris `resident_private_data` milik `resident_id` yang tertaut ke `tenant_members.resident_id` miliknya (atau anggota KK yang sama jika diizinkan kebijakan RT).
- **Proteksi Query Client**: Aplikasi frontend wajib memanggil kolom eksplisit pada `residents` untuk tampilan direktori dan hanya mengambil `resident_private_data` pada halaman detail profil/administrasi surat yang terotorisasi.
- **Audit**: Setiap akses ubah/hapus pada `resident_private_data` dicatat di `audit_logs` tanpa menyimpan nilai NIK mentah di kolom `metadata`.

---

## 5. Matriks Akses RLS per Role

Keterangan: **All** = seluruh baris dalam `tenant_id` aktif; **Own** = hanya data milik sendiri / `household_id` sendiri; **—** = ditolak.

| Tabel / Domain | `super_admin` | `ketua_rt` | `sekretaris` | `bendahara` | `pengurus` | `warga` |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `tenants` | S, I, U, D | S (Own) | S (Own) | S (Own) | S (Own) | S (Own) |
| `profiles` | S, U (Own) | S, U (Own) | S, U (Own) | S, U (Own) | S, U (Own) | S, U (Own) |
| `tenant_members` & `member_roles` | S, I, U, D | S, I, U, D (All) | S (All) | S (All) | S (All) | S (Own) |
| `households` & `residents` | S | S, I, U, D (All) | S, I, U, D (All) | S (All) | S (All) | S (Own HH) |
| `resident_private_data` & `resident_documents` | — (by default) | S, I, U, D (All) | S, I, U, D (All) | — | — | S (Own) |
| `vehicles` | S | S, I, U, D (All) | S, I, U, D (All) | S (All) | S (All) | S, I, U (Own HH) |
| `dues` & `cash_categories` | S | S, I, U, D (All) | S (All) | S, I, U, D (All) | S (All) | S (All active) |
| `bills` & `cash_transactions` | S | S (All) | S (All) | S, I, U (All) | S (All) | S (Own HH) |
| `payments` | S | S (All) | S (All) | S, I, U (All) | S (All) | S, I (Own HH) |
| `announcements` & `recipients` | S | S, I, U, D (All) | S, I, U, D (All) | S (All) | S, I, U (All) | S (Published/Target) |
| `complaints` | S | S, U (All) | S, U (All) | S (All) | S, U (All) | S, I (Own), U (Own open) |
| `complaint_replies` | S | S, I (All) | S, I (All) | S (All) | S, I (All) | S, I (Own complaint) |
| `complaint_status_history` | S | S, I (All) | S, I (All) | S (All) | S, I (All) | S (Own complaint) |
| `letter_types` | S | S, I, U, D (All) | S, I, U, D (All) | S (All) | S (All) | S (Active) |
| `letter_requests` | S | S, U (All) | S, U (All) | S (All) | S (All) | S, I (Own) |
| `activities` & `participants` | S | S, I, U, D (All) | S, I, U, D (All) | S (All) | S, I, U (All) | S (All), I/U (Own RSVP) |
| `notifications` | S | S, U (Own) | S, U (Own) | S, U (Own) | S, U (Own) | S, U (Own) |
| `audit_logs` | S (All) | S (Own tenant) | S (Own tenant) | S (Own tenant) | — | — |

*(Catatan: `audit_logs`, `complaint_status_history`, dan `payment_webhook_events` bersifat append-only — tidak ada hak `UPDATE` atau `DELETE` untuk role aplikasi biasa; insert `audit_logs` dan `notifications` sistem dijalankan melalui trigger/RPC `SECURITY DEFINER` atau `service_role`.)*

