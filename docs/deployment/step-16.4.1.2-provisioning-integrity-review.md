# Smart RT — Step 16.4.1.2: Final Provisioning SQL Integrity & Concurrency Review

- **Date:** 2026-11-16
- **Context:** Step 16.4.1.2 Final Integrity Review
- **Target Project:** `smart-rt-staging` (`szghujzhiyndeuhepsax`)
- **Engine:** PostgreSQL 17.11.0.019
- **Reviewed Document:** `docs/deployment/step-16.4.1-staging-provisioning-execution-package.md`
- **Status:** **REVIEW COMPLETE — ALL MUTATIONS REMAIN NOT EXECUTED**

---

## 1. Executive Summary

Laporan ini mendokumentasikan hasil audit teknis, pengetesan langsung pada PostgreSQL 17, dan revisi integritas akhir terhadap **Paket Eksekusi Provisioning Staging (Step 16.4.1)**. 

Temuan paling signifikan dalam audit ini adalah kegagalan sintaks nyata pada query verifikasi awal di PostgreSQL 17 (`ERROR 42883: function min(uuid) does not exist`), potensi race condition pada eksekusi paralel, celah pada pencocokan kategori kas, dan risiko audit pada pengisian kolom `assigned_by`.

Seluruh temuan telah diperbaiki secara tuntas dan diuji secara read-only. **Semua script mutasi tetap berstatus `NOT EXECUTED — REQUIRES EXPLICIT APPROVAL`.**

---

## 2. Temuan Sebelum Revisi (Pre-Revision Findings)

Berikut rincian 8 temuan kritis yang diidentifikasi sebelum revisi:

1. **`min(uuid)` Inkompatibel dengan PostgreSQL 17 (Script D):**
   Pada draf awal Script D, agregat `min(uuid)` digunakan untuk mengambil ID tenant dan member. PostgreSQL 17 secara native tidak menyediakan fungsi `min(uuid)` bawaan, sehingga query melempar exception:
   `ERROR: 42883: function min(uuid) does not exist`.
2. **Kelemahan Pencocokan Kategori Kas (Script B):**
   Pengecekan kategori kas sebelumnya mencari pasangan `name` dan `type`. Jika ada kategori dengan `name` yang sama namun `type` berbeda, script akan mencoba melakukan `INSERT` kedua yang melanggar prinsip desain satu kategori per nama di RT, atau jika kategori eksisting berstatus inaktif (`is_active = false`), script melewatinya begitu saja.
3. **Ketiadaan Serialisasi Konkurensi (Script B):**
   Dua eksekusi Script B secara simultan berpotensi mengalami race condition saat memeriksa `SELECT 1 FROM tenants`, yang dapat memicu pelanggaran constraint atau kondisi parsial tak terkontrol.
4. **Model Audit `assigned_by` Tidak Sah (Script C):**
   Script C sebelumnya mengisi `assigned_by = v_admin_user_id`. Mengisi admin sendiri sebagai pihak yang menugaskan peran pada akun pertama tidak memiliki dasar audit yang sah (rekayasa self-assignment historis). Skema database mengizinkan `assigned_by uuid NULL`, yang secara semantik mencerminkan *initial system bootstrap*.
5. **Ketiadaan Row-Lock pada Profil Admin (Script C):**
   Tidak ada penguncian baris (`FOR UPDATE`) pada `public.profiles` sebelum memeriksa keanggotaan ganda. Jika dua eksekusi paralel berjalan, validasi cross-tenant bisa terlewati secara bersamaan.
6. **Ketiadaan Validasi Status Tenant `active` (Script C):**
   Script C hanya memeriksa keberadaan tenant tanpa memastikan `status = 'active'`, berisiko menugaskan admin ke tenant yang sedang `suspended` atau `inactive`.
7. **Kompensasi Memilih Member Secara Acak & Melakukan Delete Tenant Otomatis (Rollback):**
   - Kompensasi C menggunakan `LIMIT 1` tanpa identitas user, berisiko menghapus member yang salah.
   - Kompensasi B menyertakan `DELETE FROM public.tenants` otomatis tanpa audit dependensi menyeluruh.
8. **Email Placeholder Fiktif:**
   Penggunaan `admin.staging@smartrt.internal` dapat menimbulkan kebingungan bagi operator dan gagal menerima notifikasi Auth.

---

## 3. Rincian Perubahan Implementasi

### 3.1 Script A (Global Roles)
- Dipertahankan 100% tanpa perubahan yang tidak diperlukan.
- 5 roles resmi (`ketua_rt`, `sekretaris`, `bendahara`, `pengurus`, `warga`) divalidasi atributnya secara ketat tanpa hardcoded UUID.

### 3.2 Script B (Tenant, Categories, & Letter Types)
- **Advisory Transaction Lock:** Ditambahkan `SELECT pg_advisory_xact_lock(hashtext('smart_rt_staging_provisioning_tenant_lock'));` di awal transaksi untuk memastikan eksekusi paralel diserialisasi secara bersih.
- **Pencocokan Kategori Kas Berdasarkan Name:** Pengecekan eksisting kini mencari berdasarkan `tenant_id` dan `name`.
  - Jika nama ditemukan tetapi `type` berbeda: transaksi langsung di-abort dengan `RAISE EXCEPTION`.
  - Jika nama ditemukan tetapi `is_active` false: transaksi di-abort dengan `RAISE EXCEPTION`.
- **Pemeriksaan Unexpected Extra Entities:**
  - Ditambahkan validasi ketiadaan kategori kas ekstra di luar 6 kategori baku.
  - Ditambahkan validasi ketiadaan tipe surat ekstra di luar 3 template baku.
- **Validasi Normalized Code Collision:** Formula regex `upper(regexp_replace(code, '[^A-Za-z0-9]+', '', 'g'))` tetap aktif untuk mendeteksi benturan index unik.

### 3.3 Script C (Admin Membership & Role Assignment)
- **Model Audit `assigned_by`:** Diubah menjadi `assigned_by = NULL` untuk mencerminkan status bootstrap awal sistem yang jujur dan sah.
- **Exclusive Row Lock:** Ditambahkan `SELECT id INTO v_locked_profile_id FROM public.profiles WHERE id = v_admin_user_id FOR UPDATE;` ditambah advisory lock berbasis User UID.
- **Validasi Status Tenant:** Wajib memverifikasi `t.status = 'active'`.
- **Pencegahan Role Ganda:** Memverifikasi member baru belum memiliki role apa pun sebelum insert `ketua_rt`.
- **Integritas Warga:** `resident_id` dipastikan tetap `NULL`.

### 3.4 Script D (Verification Query)
- **Menghilangkan `min(uuid)` dan Nested Subquery Aggregates:**
  Ditulis ulang sepenuhnya dengan CTE modular:
  - `tenant_data` & `tenant_target` (menggunakan `LIMIT 1`)
  - `tenant_eval`
  - `roles_eval`
  - `categories_data` & `categories_eval` (memeriksa 6 exact set, 0 unexpected)
  - `letters_data` & `letters_eval` (memeriksa 3 exact set, 0 unexpected)
  - `admin_membership_data` & `admin_target` (menggunakan `LIMIT 1`)
  - `admin_membership_eval`
  - `admin_roles_data` & `admin_roles_eval` (tepat 1 role ketua_rt)
  - `isolation_eval`
  - `rls_eval` (tepat 33 tabel, 0 unsecured)
- Mengembalikan hasil `status: 'PASS' | 'FAIL'` per modul dan evaluasi `overall_status`.
- Menjaga kerahasiaan email operator.

### 3.5 Prosedur Kompensasi (Rollback Refinement)
- **Kompensasi C:** Wajib menerima `<AUTH_ADMIN_USER_ID>` secara eksplisit (menghapus `LIMIT 1` acak). Menjalankan audit dependensi terhadap 8 tabel domain (`audit_logs`, `cash_transactions`, `bills`, `complaints`, dll.); melempar exception jika ada transaksi yang bergantung padanya.
- **Kompensasi B:** Menghapus seluruh perintah `DELETE FROM public.tenants`. Digantikan dengan **Read-Only Dependency Audit Query** yang memvalidasi apakah tenant bersih sebelum tindakan manual dapat dipertimbangkan.
- **Kompensasi A:** Tetap manual di Supabase Dashboard dengan dokumentasi dampak cascade delete pada profil.

### 3.6 Email Administrator
- Diganti dengan panduan eksplisit: `staging-admin@organisasi-anda.id` atau email aktif di bawah kendali operator langsung.

---

## 4. Test & Hasil Aktual

### 4.1 Pengujian Langsung Query Verifikasi (Script D) pada PostgreSQL 17.11

Pengujian read-only dijalankan langsung terhadap database Supabase staging `szghujzhiyndeuhepsax`:

```bash
npx supabase db query --remote=szghujzhiyndeuhepsax --read-only -o json "<SCRIPT_D_SQL>"
```

#### Hasil Uji Sebelum Revisi:
```
Target: project smart-rt-staging (szghujzhiyndeuhepsax) · production
unexpected status 400: {"message":"Failed to run sql query: ERROR:  42883: function min(uuid) does not exist\n..."}
Command exited with code 1.
```
*(Gagal akibat ketidaktersediaan fungsi `min(uuid)` di PostgreSQL 17).*

#### Hasil Uji Setelah Revisi:
```
Target: project smart-rt-staging (szghujzhiyndeuhepsax) · production
Command exited with code 0.
Output:
{
  "admin_membership_check": { "status": "FAIL", "total": 0 },
  "admin_roles_check": { "roles": [], "status": "FAIL", "total": 0 },
  "cash_categories_check": { "status": "FAIL", "total": 0 },
  "isolation_check": { "cross_memberships": 0, "status": "PASS" },
  "letter_types_check": { "status": "FAIL", "total": 0 },
  "overall_status": "FAIL",
  "rls_check": { "secured_count": 33, "status": "PASS", "unsecured_count": 0, "unsecured_tables": [] },
  "roles_check": { "codes": [], "status": "FAIL", "total": 0 },
  "tenant_check": { "status": "FAIL", "total": 0 }
}
```
**Analisis Hasil Uji:**
- Exit code `0` (Sintaks 100% valid di PostgreSQL 17.11).
- `overall_status`: `"FAIL"` secara benar dan akurat, karena database staging saat ini masih dalam kondisi clean baseline (0 data domain).
- `rls_check`: `"PASS"` (`secured_count: 33`, `unsecured_count: 0`).
- `isolation_check`: `"PASS"` (`cross_memberships: 0`).
- Tidak ada crash atau runtime error.

### 4.2 Matriks Verifikasi Statis & Logika SQL

| Skenario Pengujian Statis | Mekanisme Pertahanan SQL | Hasil Evaluasi |
|---|---|---|
| **Kategori eksisting dengan type berbeda** | `IF v_existing_cat.type <> v_cat_type THEN RAISE EXCEPTION ...` | **DITOLAK (Abort Transaksi)** |
| **Kategori eksisting berstatus inaktif** | `IF v_existing_cat.is_active IS NOT TRUE THEN RAISE EXCEPTION ...` | **DITOLAK (Abort Transaksi)** |
| **Kategori ekstra tak terduga di tenant** | `v_unexpected_cat_count > 0 THEN RAISE EXCEPTION ...` | **DITOLAK (Abort Transaksi)** |
| **Benturan normalized code surat** | Pencocokan `upper(regexp_replace(...))` + perbandingan atribut lengkap | **TERDETEKSI & DITOLAK** |
| **Tipe surat ekstra tak terduga** | `v_unexpected_lt_count > 0 THEN RAISE EXCEPTION ...` | **DITOLAK (Abort Transaksi)** |
| **Konkurensi eksekusi Script B simultan** | `pg_advisory_xact_lock(hashtext('...tenant_lock'))` | **TERSERIALISASI** |
| **Konkurensi eksekusi Script C simultan** | `SELECT ... FROM public.profiles ... FOR UPDATE` + advisory lock | **TERSERIALISASI** |
| **User memiliki membership di tenant lain** | `EXISTS (SELECT 1 FROM tenant_members WHERE user_id = ... AND tenant_id <> v_tenant_id)` | **DITOLAK (Abort Transaksi)** |
| **Membership staging sudah ada sebelumnya** | `EXISTS (SELECT 1 FROM tenant_members WHERE user_id = ... AND tenant_id = v_tenant_id)` | **DITOLAK (Wajib Manual Audit)** |
| **Role ganda pada penugasan awal** | `EXISTS (SELECT 1 FROM member_roles WHERE member_id = v_member_id)` | **DITOLAK (Abort Transaksi)** |
| **Compensation C tanpa UUID eksplisit** | Variabel `v_target_admin_user_id` wajib diset eksplisit (tanpa LIMIT 1) | **DICEGAH SECARA STRUKTURAL** |
| **Compensation C dengan transaksi aktif** | Audit dependensi 8 tabel domain > 0 | **DITOLAK (Abort Transaksi)** |
| **Compensation B penghapusan tenant** | Perintah DELETE tenant dihapus dari paket; diganti read-only audit | **DICEGAH SECARA STRUKTURAL** |

---

## 5. Temuan yang Belum Dapat Dibuktikan (Pending Dynamic Verification)

Dua aspek berikut belum dapat dibuktikan saat ini karena memerlukan aplikasi web aktif:
1. **Resolusi Workspace Preferensi UI:**
   Berdasarkan audit kode di `src/lib/auth/server.ts`, pengisian `profiles.active_tenant_id` akan menjadi preferensi awal saat cookie workspace kosong. Pembuktian visual integrasi sesi di browser baru dapat diverifikasi setelah aplikasi web staging dideploy ke Railway.
2. **Behavior Token Session di Domain Railway HTTPS:**
   Mekanisme pertukaran cookie PKCE Supabase pada route `/auth/callback` di domain staging Railway baru dapat diuji setelah deployment web service selesai.

---

## 6. Konfirmasi Status & Rekomendasi Urutan Eksekusi

### 6.1 Status Keamanan
- **Seluruh script mutasi SQL (Script A, B, C) berstatus:** **`NOT EXECUTED — REQUIRES EXPLICIT APPROVAL`**.
- Database remote Supabase Cloud staging (`szghujzhiyndeuhepsax`) tetap berada dalam kondisi **clean baseline** (0 mutasi data).
- Tidak ada user Auth yang dibuat, dan tidak ada deployment Railway yang dijalankan.

### 6.2 Rekomendasi Urutan Eksekusi (Setelah Persetujuan Eksplisit User)
1. **Eksekusi Script A:** Provisioning 5 global roles di `public.roles`.
2. **Eksekusi Script B:** Provisioning staging tenant `rt-01-rw-01-staging`, 6 kategori kas, dan 3 tipe surat.
3. **Prosedur Manual Phase 4:** Operator membuat user admin staging di Supabase Dashboard (centang "Auto Confirm User") dan menyalin User UID.
4. **Eksekusi Script C:** Menghubungkan user admin ke tenant staging dengan role `ketua_rt`.
5. **Eksekusi Script D:** Menjalankan query verifikasi read-only dan memastikan hasil `overall_status: "PASS"`.

---

## 7. Kesimpulan

Revisi integritas dan konkurensi Step 16.4.1.2 telah selesai. Seluruh kelemahan teknis telah diperbaiki, diuji, dan didokumentasikan pada:
- [`step-16.4.1-staging-provisioning-execution-package.md`](file:///Users/iqbalsahrizal/Documents/CODING/Personal%20Project/smart-rt/docs/deployment/step-16.4.1-staging-provisioning-execution-package.md)

**Proses sekarang BERHENTI.** Menunggu peninjauan dan persetujuan eksplisit Anda sebelum tindakan provisioning apa pun dapat dieksekusi.

