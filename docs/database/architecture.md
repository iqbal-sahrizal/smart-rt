# Arsitektur Database Smart RT (Refined v2)

Dokumen ini merupakan rancangan final arsitektur database **Smart RT** menggunakan **Supabase PostgreSQL**, disiapkan untuk tahap implementasi SQL migration (Step 09). Arsitektur ini mendukung operasional satu RT secara langsung dan siap berkembang menjadi platform **SaaS Multi-Tenant** untuk banyak RT/RW.

---

## 1. Domain Fungsional & Daftar Tabel (28 Tabel Inti)

| Domain | Tabel | Fungsi Utama |
| :--- | :--- | :--- |
| **Multi-Tenant & Access** | `tenants`, `profiles`, `roles`, `tenant_members`, `member_roles` | Isolasi tenant RT/RW, akun user, keanggotaan multi-RT, dan multi-role RBAC |
| **Kependudukan** | `households`, `residents`, `resident_private_data`, `resident_documents`, `vehicles` | Data KK, penduduk non-sensitif, pemisahan data sensitif (NIK), dokumen privat, kendaraan |
| **Keuangan** | `dues`, `bills`, `payments`, `payment_webhook_events`, `cash_categories`, `cash_transactions` | Master iuran, tagihan, pembayaran penuh/parsial/refund, idempotency webhook, buku kas |
| **Pengumuman** | `announcements`, `announcement_recipients` | Pengumuman RT dengan target global, per role, atau per rumah tangga |
| **Pengaduan** | `complaints`, `complaint_replies`, `complaint_status_history` | Laporan warga, percakapan tanggapan, dan riwayat status immutable |
| **Surat Pengantar** | `letter_types`, `letter_requests`, `letter_sequences` | Jenis surat, pengajuan warga, penomoran surat aman konkurensi, dokumen terbit |
| **Kegiatan** | `activities`, `activity_participants` | Jadwal kegiatan RT, lokasi, dokumentasi, dan peserta |
| **Notifikasi & Audit** | `notifications`, `audit_logs` | Notifikasi in-app terikat tenant dan jejak audit immutable |

*(Catatan: `device_tokens` untuk Web Push / FCM direncanakan sebagai tabel aditif pada fase integrasi push notification berikutnya.)*

---

## 2. Prinsip Desain & Integritas Data

- **Primary Key**: Seluruh tabel menggunakan `uuid` (`gen_random_uuid()`), kecuali `profiles.id` yang mereferensikan `auth.users(id)`. NIK dan Nomor KK tidak pernah dijadikan primary key.
- **Naming Convention**: Seluruh tabel dan kolom menggunakan `snake_case`.
- **Timestamp**: Seluruh waktu menggunakan `timestamptz` (`created_at`, `updated_at`).
- **Tipe Data Finansial**: Seluruh nilai uang menggunakan `numeric(14, 2)` untuk presisi akuntansi tanpa galat floating-point.
- **Composite Foreign Keys Antar-Tenant**: Tabel induk ber-`tenant_id` memiliki constraint `UNIQUE (tenant_id, id)`. Seluruh tabel anak menggunakan composite foreign key `(tenant_id, parent_id)` ke `(tenant_id, id)` milik induknya, sehingga mustahil secara skema terjadi relasi lintas tenant. Untuk composite FK yang opsional (`households.head_resident_id`, `tenant_members.resident_id`, `vehicles.resident_id`), digunakan sintaks PostgreSQL 15+ `ON DELETE SET NULL (<column>)` agar `tenant_id` tetap `NOT NULL`.
- **Global System Role Catalog**: Tabel `roles` bersifat global (`ketua_rt`, `sekretaris`, `bendahara`, `pengurus`, `warga`) dan dibagikan ke seluruh tenant, sedangkan penugasannya diikat ke tenant tertentu melalui `member_roles (tenant_id, member_id, role_id)`.
- **Soft Delete**: Entitas bersejarah (`tenants`, `households`, `residents`, `announcements`, `complaints`, `activities`) memakai `deleted_at timestamptz` dengan **partial unique index** (`WHERE deleted_at IS NULL`) agar penghapusan lunak tidak memblokir pendaftaran ulang data valid.
- **File Storage**: Tidak ada binary (`bytea`) di PostgreSQL. File disimpan di **Supabase Storage** dan database hanya menyimpan `storage_path`.

---

## 3. Arsitektur Multi-Tenant & Pemisahan User–Resident

### A. Siklus Hidup Tenant
1. **Pembuatan Tenant**: Dilakukan oleh platform `super_admin` melalui sistem terpercaya (membuat baris `tenants` dengan `status = 'active'` dan data awal `cash_categories` + `letter_types`).
2. **Bergabung ke Tenant**: User melakukan autentikasi via **Supabase Auth** (`auth.users` -> `profiles`), lalu ditautkan ke tenant melalui `tenant_members (tenant_id, user_id)`.
3. **Mendapatkan Role**: Role diberikan di `member_roles (tenant_id, member_id, role_id)` yang merujuk pada master `roles` (`ketua_rt`, `sekretaris`, `bendahara`, `pengurus`, `warga`). Satu anggota bisa memiliki beberapa role sekaligus.
4. **Multi-Tenant Membership**: Satu `user_id` dapat bergabung ke beberapa RT berbeda melalui baris `tenant_members` terpisah.
5. **Menentukan Tenant Aktif**: `profiles.active_tenant_id` hanya berfungsi sebagai preferensi UI untuk *tenant switcher*. **Otorisasi tidak pernah bergantung pada `active_tenant_id` atau `tenant_id` dari frontend**; seluruh akses divalidasi oleh RLS terhadap keanggotaan aktif di `tenant_members`.

### B. Pemisahan `auth.users`, `profiles`, dan `residents`
- `auth.users` & `profiles`: Identitas login aplikasi.
- `residents`: Data kependudukan (seorang warga seperti anak/lansia tetap tercatat meski belum punya akun login).
- `tenant_members.resident_id`: Menautkan akun login di tenant tertentu ke satu data penduduk. Constraint `UNIQUE (tenant_id, resident_id) WHERE resident_id IS NOT NULL` menjamin **satu penduduk maksimal terhubung ke satu akun dalam satu tenant**, sementara satu `households` tetap bisa memiliki banyak `residents` dengan akun login masing-masing.

---

## 4. Pemisahan Data Sensitif & Keamanan Super Admin

- **Data Sensitif (`resident_private_data`)**: Karena PostgreSQL RLS bekerja pada level **baris**, bukan kolom, `nik`, `birth_place`, `birth_date`, dan catatan identitas sensitif dipisahkan dari `residents` ke tabel `resident_private_data` (`1:1` dengan `residents`). Query direktori warga biasa pada `residents` tidak pernah menyentuh `resident_private_data`.
- **Proteksi `super_admin`**: `profiles.is_super_admin` dilindungi oleh pencabutan hak `UPDATE (is_super_admin)` dari role `authenticated`/`anon` dan trigger pencegah eskalasi hak, sehingga tidak dapat diubah melalui API client maupun update profile biasa.

Detail lengkap keamanan dan matriks RLS dibahas pada [security-design.md](file:///Users/iqbalsahrizal/Documents/CODING/Personal%20Project/smart-rt/docs/database/security-design.md).

---

## 5. Arsitektur Keuangan & Kesiapan Skalabilitas

- **Tagihan Eksklusif (`bills`)**: Constraint `CHECK` memastikan satu tagihan hanya ditujukan ke `household_id` **atau** `resident_id` (tidak keduanya, tidak kosong keduanya) sesuai `dues.target_scope`.
- **Pembayaran Penuh, Parsial, Ulang, & Refund**: `bills.paid_amount` melacak akumulasi pembayaran terverifikasi dikurangi refund terverifikasi. `payments` mendukung `payment_type` (`payment` | `refund`), `parent_payment_id` untuk jejak refund tanpa menghapus histori, serta `idempotency_key` dan `payment_webhook_events` untuk mencegah pemrosesan ganda webhook payment gateway.
- **Rekonsiliasi Atomik**: Verifikasi pembayaran / refund memperbarui `payments`, menghitung ulang `bills.paid_amount` & `bills.status`, dan mencatat satu baris di `cash_transactions` (`UNIQUE (payment_id)`) secara atomik dalam satu transaksi database.
