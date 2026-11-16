# Smart RT — Step 16.4.1.1: Provisioning Safety Review & Revision Report

- **Date:** 2026-11-16
- **Context:** Supabase Cloud Staging Provisioning Review
- **Project Ref:** `szghujzhiyndeuhepsax`
- **Reviewed Document:** `docs/deployment/step-16.4.1-staging-provisioning-execution-package.md`
- **Status:** **REVIEW COMPLETE — ALL MUTATIONS REMAIN NOT EXECUTED**

---

## 1. Executive Summary

Berdasarkan review mendalam terhadap rancangan awal Step 16.4.1, ditemukan beberapa area kritis yang berpotensi menimbulkan *silent corruption*, pelanggaran isolasi data, atau kerusakan relasi akibat rollback yang terlalu agresif.

Telah dilakukan revisi menyeluruh pada dokumen `docs/deployment/step-16.4.1-staging-provisioning-execution-package.md`. Laporan ini merinci temuan sebelum revisi, perubahan SQL yang diterapkan, alasan teknis di balik setiap perbaikan, risiko residual yang tersisa, serta rekomendasi urutan eksekusi.

> [!IMPORTANT]
> **Safety Guarantee:**
> Seluruh script mutasi SQL (Script A, Script B, Script C) serta prosedur kompensasi **TETAP BERSTATUS `NOT EXECUTED — REQUIRES EXPLICIT APPROVAL`**. Tidak ada perubahan yang dieksekusi ke database remote Supabase staging pada step ini.

---

## 2. Temuan Sebelum Revisi (Pre-Revision Audit)

Pada versi awal Step 16.4.1, terdapat 6 kelemahan utama yang diidentifikasi:

1. **`ON CONFLICT DO NOTHING` Tanpa Validasi Atribut (Script B):**
   Pada penyisipan `cash_categories` dan `letter_types`, penggunaan klausa `ON CONFLICT DO NOTHING` dapat menyebabkan kegagalan tersembunyi (*silent ignoring*). Jika kategori atau tipe surat dengan nama/kode sama sudah ada di database namun memiliki tipe, deskripsi, atau dokumen syarat yang berbeda atau berstatus `is_active = false`, script sebelumnya akan mengabaikannya tanpa memberi peringatan atau memvalidasi kesesuaian.
2. **Validasi Tenant Existing Kurang Menyeluruh (Script B):**
   Jika tenant `rt-01-rw-01-staging` sudah ada di database, script sebelumnya langsung mengambil `id` tanpa membandingkan apakah atribut penting (nama, nomor RT/RW, kelurahan, kecamatan, kota, provinsi, status, format nomor surat) identik dengan spesifikasi.
3. **Risiko Benturan Normalized Code pada `letter_types` (Script B):**
   Database memiliki unique index `uq_letter_types_tenant_normalized_code` (`upper(regexp_replace(code, '[^A-Za-z0-9]+', '', 'g'))`). Jika ada data yang memiliki normalized code bertabrakan namun exact codenya berbeda, insert dapat gagal melempar error tak terduga.
4. **Auto-Update Status Membership Tanpa Audit Manual (Script C):**
   Script C sebelumnya menggunakan `ON CONFLICT (tenant_id, user_id) DO UPDATE SET status = 'active'`. Pola ini berbahaya karena dapat mengaktifkan keanggotaan yang sebelumnya dinonaktifkan atau ditangguhkan tanpa investigasi operator. Selain itu, belum ada pengecekan apakah user yang dimasukkan sudah memiliki membership di tenant lain.
5. **Verifikasi Asumtif & Kurang Eksplisit (Script D):**
   Query verifikasi sebelumnya memeriksa `total_auth_users = 1`. Di lingkungan cloud staging, proyek Supabase mungkin memiliki user lama (misal user operator/developer). Verifikasi seharusnya berfokus pada ketepatan user yang di-provision, memeriksa seluruh 5 role, 6 kategori, dan 3 tipe surat secara mendalam, serta mengembalikan status evaluatif eksplisit (`PASS`/`FAIL`).
6. **Rollback Destruktif Terhadap Global Roles (Bagian Rollback):**
   Script rollback sebelumnya menyertakan `DELETE FROM public.roles ...`. Hal ini sangat berisiko karena `public.roles` adalah katalog global sistem. Menghapus role global dapat memicu error `RESTRICT` jika ada tabel lain yang menggunakannya, atau menghancurkan integritas relasi sistem.

---

## 3. Rincian Perubahan SQL & Penjelasannya

### 3.1 Script A — Global Roles SQL
- **Perubahan:** Mempertahankan arsitektur yang sudah baik. Menjamin kelima role baku (`ketua_rt`, `sekretaris`, `bendahara`, `pengurus`, `warga`) diproses menggunakan `gen_random_uuid()` tanpa hardcoded UUID.
- **Validasi Ketat:** Membandingkan `name` dan `description` jika kode role sudah ada. Jika ada ketidaksesuaian nilai pada katalog sistem, transaksi langsung dihentikan dengan `RAISE EXCEPTION`.

### 3.2 Script B — Staging Tenant & Reference Data SQL
- **Validasi Komprehensif Tenant Existing:**
  Jika `rt-01-rw-01-staging` sudah ada di `public.tenants`, script memvalidasi kesamaan seluruh kolom:
  `name`, `rt_number`, `rw_number`, `kelurahan`, `kecamatan`, `city`, `province`, `status = 'active'`, dan `settings->>'letter_number_format'`. Mismatch atribut apa pun akan memicu `RAISE EXCEPTION`.
- **Safety Guard Isolasi Single-Tenant:**
  Script secara eksplisit memeriksa ketiadaan tenant aktif lain (`WHERE code <> 'rt-01-rw-01-staging' AND deleted_at IS NULL`) guna mencegah provisioning tenant ganda di staging.
- **Validasi Tiap Kategori Kas (Tanpa `ON CONFLICT DO NOTHING` Buta):**
  Menggunakan perulangan validasi eksplisit untuk 6 kategori kas terstandar. Jika kategori sudah ada, memverifikasi `is_active IS TRUE`. Jika tidak aktif, transaksi di-abort. Jika belum ada, baru dilakukan insert.
- **Validasi Tiap Tipe Surat & Deteksi Normalized Collision:**
  Menggunakan query pencocokan yang menyertakan formula regex normalized code `upper(regexp_replace(code, '[^A-Za-z0-9]+', '', 'g'))`. Memeriksa kesesuaian `code`, `name`, `description`, `required_documents`, dan `is_active IS TRUE`.
- **Atomisitas:** Seluruh blok dibungkus dalam satu transaksi `BEGIN ... COMMIT`.

### 3.3 Script C — Tenant Membership & Role Assignment SQL
- **Validasi Prasyarat Auth & Email Confirmation:**
  Memeriksa keberadaan `auth.users(id)` dan memastikan `email_confirmed_at IS NOT NULL`. Jika email belum terkonfirmasi, script menolak eksekusi dan menginstruksikan operator untuk mencentang "Auto Confirm User".
- **Validasi Profil Otomatis:**
  Memastikan baris pada `public.profiles` telah terbentuk via trigger `trg_auth_users_create_profile`.
- **Pencegahan Keanggotaan Lintas Tenant:**
  Memeriksa apakah user sudah terdaftar di tenant lain (`WHERE user_id = v_admin_user_id AND tenant_id <> v_tenant_id`). Jika ada, eksekusi dibatalkan demi menjaga isolasi tenant staging.
- **Pencegahan Overwrite Membership Existing:**
  Menghapus `ON CONFLICT DO UPDATE`. Jika membership user pada tenant staging sudah ada, transaksi **dihentikan** (`RAISE EXCEPTION`) dan mewajibkan pemeriksaan manual operator.
- **Klarifikasi Otorisasi vs Preferensi UI:**
  Mendokumentasikan bahwa `profiles.active_tenant_id` hanyalah preferensi tampilan workspace Next.js, sedangkan otorisasi RLS sepenuhnya bersumber dari `tenant_members` dan `member_roles`.
- **Model Audit `assigned_by`:**
  Kolom `assigned_by` pada `member_roles` diisi dengan `v_admin_user_id` (admin pembuat awal), yang terverifikasi sebagai profil sah.
- **Integritas Warga:**
  Kolom `resident_id` dipastikan tetap `NULL` tanpa membuat data warga atau KK palsu.

### 3.4 Script D — Verification SQL (Read-Only)
- **Evaluasi Eksplisit `PASS`/`FAIL`:**
  Setiap domain audit (roles, tenant, cash categories, letter types, admin membership, cross-tenant isolation, RLS) mengembalikan flag `status: 'PASS' | 'FAIL'` serta nilai `overall_status: 'PASS' | 'FAIL'`.
- **Pemeriksaan Isi Mendalam:**
  Memeriksa atribut spesifik dari 5 roles, 6 kategori kas, dan 3 tipe surat milik staging tenant, bukan sekadar menghitung `count(*)`.
- **Menghilangkan Asumsi `total_auth_users = 1`:**
  Memverifikasi admin staging berdasarkan linking keanggotaan tenant, bukan dari jumlah total user di Supabase Auth.
- **Privasi:**
  Tidak menampilkan email mentah atau kredensial pada hasil query verifikasi.

### 3.5 Rollback & Kompensasi Berjenjang
- **Menghapus Mass-Delete Roles:**
  Katalog `public.roles` tidak lagi dihapus pada rollback untuk mencegah rusaknya foreign key `RESTRICT` pada sistem.
- **Kompensasi Modular & Defensif:**
  - *Kompensasi Tahap C:* Hapus `member_roles` dan `tenant_members` admin staging.
  - *Kompensasi Tahap B:* Hapus `cash_categories`, `letter_types`, dan `tenants` hanya jika keanggotaan sudah kosong.
  - *Kompensasi Tahap A:* Hapus user Auth secara manual via Supabase Dashboard UI.
- **Prinsip Utama:** Lebih baik mempertahankan data staging yang ada untuk diaudit daripada menjalankan query delete agresif yang berisiko.

---

## 4. Analisis Risiko Residual (Residual Risks)

| Risiko Tersisa | Tingkat | Mitigasi yang Ditetapkan |
|---|---|---|
| **Human Error Pengisian User UID** | Rendah | Script C memverifikasi keberadaan UID di `auth.users` dan `public.profiles` sebelum melakukan aksi apa pun. Jika salah salin, transaksi langsung abort. |
| **Lupa Mencentang Auto Confirm** | Rendah | Script C memverifikasi `email_confirmed_at IS NOT NULL`. Jika lupa dicentang di Dashboard, Script C akan menolak eksekusi. |
| **Penyalahgunaan Akun Staging** | Sedang | Password akun staging dikelola langsung oleh operator di Dashboard UI dan tidak pernah dicatat pada dokumen atau repository. |

---

## 5. Konfirmasi Status & Rekomendasi Urutan Eksekusi

### 5.1 Status Keamanan
- **Seluruh SQL mutasi berstatus:** **`NOT EXECUTED — REQUIRES EXPLICIT APPROVAL`**.
- Database remote Supabase Cloud staging (`szghujzhiyndeuhepsax`) tetap berada dalam kondisi **clean baseline** (0 data domain).

### 5.2 Rekomendasi Urutan Eksekusi (Setelah Persetujuan User)

1. **Langkah 1 (SQL):** Jalankan **Script A (Global Roles)** di Supabase Dashboard SQL Editor atau Supabase CLI.
2. **Langkah 2 (SQL):** Jalankan **Script B (Tenant & Reference Data)**.
3. **Langkah 3 (Manual):** Operator membuka Supabase Dashboard -> Authentication -> Users -> Add user (centang "Auto Confirm User") dan salin User UID.
4. **Langkah 4 (SQL):** Masukkan User UID ke dalam **Script C (Membership & Role)** lalu jalankan.
5. **Langkah 5 (SQL Read-Only):** Jalankan **Script D (Verification Query)** dan pastikan `overall_status` menghasilkan `'PASS'`.

---

## 6. Kesimpulan

Revisi keselamatan telah selesai diintegrasikan ke dalam file:
- [`step-16.4.1-staging-provisioning-execution-package.md`](file:///Users/iqbalsahrizal/Documents/CODING/Personal%20Project/smart-rt/docs/deployment/step-16.4.1-staging-provisioning-execution-package.md)

Proses sekarang **BERHENTI** untuk menunggu peninjauan dan persetujuan eksplisit user sebelum eksekusi tahap apa pun dapat dimulai.

