# Table Dictionary — Smart RT Database Schema (Refined v2)

Spesifikasi lengkap **28 tabel PostgreSQL** untuk **Smart RT**. Seluruh tabel menggunakan `uuid` PK, penamaan `snake_case`, `timestamptz`, `numeric(14, 2)` untuk nilai uang, serta **composite foreign keys** `(tenant_id, ref_id)` untuk mencegah relasi lintas tenant.

---

## 1. Multi-Tenant & Access Control

### 1.1 `tenants`
**Fungsi**: Identitas RT/RW, wilayah administratif, konfigurasi, dan status aktif tenant.

| Kolom | Tipe Data | Null | Key / Constraint | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NOT NULL | PK | `gen_random_uuid()` |
| `code` | `text` | NOT NULL | | Kode/slug unik tenant |
| `name` | `text` | NOT NULL | | Contoh: `RT 04 / RW 02` |
| `rt_number` | `text` | NOT NULL | | Nomor RT |
| `rw_number` | `text` | NOT NULL | | Nomor RW |
| `kelurahan` | `text` | NOT NULL | | Kelurahan / Desa |
| `kecamatan` | `text` | NOT NULL | | Kecamatan |
| `city` | `text` | NOT NULL | | Kota / Kabupaten |
| `province` | `text` | NOT NULL | | Provinsi |
| `status` | `text` | NOT NULL | CHECK | `active`, `inactive`, `suspended` |
| `settings` | `jsonb` | NOT NULL | DEFAULT `'{}'` | Konfigurasi spesifik RT |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |
| `deleted_at` | `timestamptz` | NULL | | Soft delete |

**Unique & Index**: `uq_tenants_code` (`code`) WHERE `deleted_at IS NULL`; `idx_tenants_status` (`status`).

---

### 1.2 `profiles`
**Fungsi**: Profil akun user yang terhubung 1:1 dengan `auth.users` (terpisah dari data kependudukan).

| Kolom | Tipe Data | Null | Key / Constraint | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NOT NULL | PK, FK -> `auth.users(id) ON DELETE CASCADE` | |
| `full_name` | `text` | NOT NULL | | Nama tampilan akun |
| `phone` | `text` | NULL | | Nomor telepon akun |
| `avatar_path` | `text` | NULL | | Path avatar di Storage |
| `active_tenant_id` | `uuid` | NULL | FK -> `tenants(id) ON DELETE SET NULL` | Preferensi UI saja (bukan otorisasi) |
| `is_super_admin` | `boolean` | NOT NULL | DEFAULT `false` | Dilindungi REVOKE UPDATE + trigger |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |

**Index**: `idx_profiles_active_tenant` (`active_tenant_id`).

---

### 1.3 `roles`
**Fungsi**: Master daftar role level tenant.

| Kolom | Tipe Data | Null | Key / Constraint | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NOT NULL | PK | `gen_random_uuid()` |
| `code` | `text` | NOT NULL | UNIQUE | `ketua_rt`, `sekretaris`, `bendahara`, `pengurus`, `warga` |
| `name` | `text` | NOT NULL | | Nama role |
| `description` | `text` | NULL | | |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |

---

### 1.4 `tenant_members`
**Fungsi**: Keanggotaan user dalam tenant tertentu; mendukung multi-tenant dan penautan ke satu `resident`.

| Kolom | Tipe Data | Null | Key / Constraint | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NOT NULL | PK, UNIQUE `(tenant_id, id)` | Composite unique untuk FK anak |
| `tenant_id` | `uuid` | NOT NULL | FK -> `tenants(id) ON DELETE CASCADE` | |
| `user_id` | `uuid` | NOT NULL | FK -> `profiles(id) ON DELETE CASCADE` | |
| `resident_id` | `uuid` | NULL | Composite FK -> `residents(tenant_id, id) ON DELETE SET NULL` | Menjamin resident milik tenant yang sama |
| `status` | `text` | NOT NULL | CHECK | `invited`, `active`, `inactive` |
| `joined_at` | `timestamptz` | NULL | | |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |

**Unique & Index**: `uq_tenant_members_tenant_user` (`tenant_id`, `user_id`); `uq_tenant_members_tenant_resident` (`tenant_id`, `resident_id`) WHERE `resident_id IS NOT NULL`; `idx_tenant_members_user_status` (`user_id`, `status`).

---

### 1.5 `member_roles`
**Fungsi**: Penugasan multi-role per anggota tenant.

| Kolom | Tipe Data | Null | Key / Constraint | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NOT NULL | PK | `gen_random_uuid()` |
| `tenant_id` | `uuid` | NOT NULL | FK -> `tenants(id) ON DELETE CASCADE` | |
| `member_id` | `uuid` | NOT NULL | Composite FK -> `tenant_members(tenant_id, id) ON DELETE CASCADE` | |
| `role_id` | `uuid` | NOT NULL | FK -> `roles(id) ON DELETE RESTRICT` | |
| `assigned_by` | `uuid` | NULL | FK -> `profiles(id) ON DELETE SET NULL` | |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |

**Unique & Index**: `uq_member_roles_member_role` (`member_id`, `role_id`); `idx_member_roles_tenant_member` (`tenant_id`, `member_id`).

---

## 2. Resident & Household Management

### 2.1 `households`
**Fungsi**: Data Kartu Keluarga dan unit hunian warga.

| Kolom | Tipe Data | Null | Key / Constraint | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NOT NULL | PK, UNIQUE `(tenant_id, id)` | |
| `tenant_id` | `uuid` | NOT NULL | FK -> `tenants(id) ON DELETE CASCADE` | |
| `kk_number` | `text` | NOT NULL | | Nomor KK (dibatasi RLS untuk pengurus & pemilik KK) |
| `head_resident_id` | `uuid` | NULL | Composite FK -> `residents(tenant_id, id) ON DELETE SET NULL` | |
| `address` | `text` | NOT NULL | | Alamat lengkap |
| `block_unit` | `text` | NULL | | Blok / nomor rumah |
| `residence_status` | `text` | NOT NULL | CHECK | `tetap`, `kontrak`, `kos`, `lainnya` |
| `status` | `text` | NOT NULL | CHECK | `active`, `inactive` |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |
| `deleted_at` | `timestamptz` | NULL | | Soft delete |

**Unique & Index**: `uq_households_tenant_kk` (`tenant_id`, `kk_number`) WHERE `deleted_at IS NULL`; `idx_households_tenant_status` (`tenant_id`, `status`) WHERE `deleted_at IS NULL`.

---

### 2.2 `residents`
**Fungsi**: Data kependudukan non-sensitif (identitas sensitif dipisahkan ke `resident_private_data`).

| Kolom | Tipe Data | Null | Key / Constraint | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NOT NULL | PK, UNIQUE `(tenant_id, id)` | |
| `tenant_id` | `uuid` | NOT NULL | FK -> `tenants(id) ON DELETE CASCADE` | |
| `household_id` | `uuid` | NOT NULL | Composite FK -> `households(tenant_id, id) ON DELETE RESTRICT` | |
| `full_name` | `text` | NOT NULL | | Nama lengkap |
| `gender` | `text` | NOT NULL | CHECK | `L`, `P` |
| `phone` | `text` | NULL | | Nomor telepon |
| `family_role` | `text` | NOT NULL | CHECK | `kepala_keluarga`, `istri`, `anak`, `famili_lain` |
| `residency_status` | `text` | NOT NULL | CHECK | `aktif`, `pindah`, `meninggal`, `nonaktif` |
| `stay_status` | `text` | NOT NULL | CHECK | `tetap`, `kontrak`, `kos`, `lainnya` |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |
| `deleted_at` | `timestamptz` | NULL | | Soft delete |

**Index**: `idx_residents_tenant_household` (`tenant_id`, `household_id`) WHERE `deleted_at IS NULL`; `idx_residents_tenant_name` (`tenant_id`, `full_name`) WHERE `deleted_at IS NULL`.

---

### 2.3 `resident_private_data`
**Fungsi**: Penyimpanan terpisah untuk data identitas sensitif (NIK, tempat/tanggal lahir, catatan identitas) dengan RLS ketat.

| Kolom | Tipe Data | Null | Key / Constraint | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NOT NULL | PK | `gen_random_uuid()` |
| `tenant_id` | `uuid` | NOT NULL | FK -> `tenants(id) ON DELETE CASCADE` | |
| `resident_id` | `uuid` | NOT NULL | Composite FK -> `residents(tenant_id, id) ON DELETE CASCADE` | Relasi 1:1 |
| `nik` | `text` | NOT NULL | | NIK 16 digit (akses terbatas) |
| `birth_place` | `text` | NOT NULL | | Tempat lahir |
| `birth_date` | `date` | NOT NULL | | Tanggal lahir |
| `extra_notes` | `text` | NULL | | Catatan administratif sensitif |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |
| `deleted_at` | `timestamptz` | NULL | | Mengikuti soft delete resident |

**Unique & Index**: `uq_resident_private_resident` (`resident_id`); `uq_resident_private_tenant_nik` (`tenant_id`, `nik`) WHERE `deleted_at IS NULL`.

---

### 2.4 `resident_documents`
**Fungsi**: Metadata dokumen penduduk yang file-nya disimpan di bucket private Supabase Storage.

| Kolom | Tipe Data | Null | Key / Constraint | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NOT NULL | PK | |
| `tenant_id` | `uuid` | NOT NULL | FK -> `tenants(id) ON DELETE CASCADE` | |
| `resident_id` | `uuid` | NOT NULL | Composite FK -> `residents(tenant_id, id) ON DELETE CASCADE` | |
| `document_type` | `text` | NOT NULL | CHECK | `ktp`, `kk`, `akta`, `domisili`, `lainnya` |
| `storage_path` | `text` | NOT NULL | UNIQUE | `{tenant_id}/{resident_id}/{file_id}.{ext}` |
| `mime_type` | `text` | NOT NULL | | |
| `file_size_bytes` | `integer` | NOT NULL | CHECK (`file_size_bytes > 0`) | |
| `verified_by` | `uuid` | NULL | FK -> `profiles(id) ON DELETE SET NULL` | |
| `verified_at` | `timestamptz` | NULL | | |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |

**Index**: `idx_resident_docs_tenant_resident` (`tenant_id`, `resident_id`).

---

### 2.5 `vehicles`
**Fungsi**: Data kendaraan milik rumah tangga/warga.

| Kolom | Tipe Data | Null | Key / Constraint | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NOT NULL | PK | |
| `tenant_id` | `uuid` | NOT NULL | FK -> `tenants(id) ON DELETE CASCADE` | |
| `household_id` | `uuid` | NOT NULL | Composite FK -> `households(tenant_id, id) ON DELETE CASCADE` | |
| `resident_id` | `uuid` | NULL | Composite FK -> `residents(tenant_id, id) ON DELETE SET NULL` | |
| `vehicle_type` | `text` | NOT NULL | CHECK | `motor`, `mobil`, `lainnya` |
| `plate_number` | `text` | NOT NULL | | Nomor polisi |
| `brand_model` | `text` | NULL | | |
| `color` | `text` | NULL | | |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |

**Unique & Index**: `uq_vehicles_tenant_plate` (`tenant_id`, `plate_number`); `idx_vehicles_tenant_household` (`tenant_id`, `household_id`).

---

## 3. Finance Management

### 3.1 `dues`
**Fungsi**: Master jenis iuran RT.

| Kolom | Tipe Data | Null | Key / Constraint | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NOT NULL | PK, UNIQUE `(tenant_id, id)` | |
| `tenant_id` | `uuid` | NOT NULL | FK -> `tenants(id) ON DELETE CASCADE` | |
| `name` | `text` | NOT NULL | | |
| `description` | `text` | NULL | | |
| `amount` | `numeric(14,2)` | NOT NULL | CHECK (`amount >= 0`) | |
| `billing_cycle` | `text` | NOT NULL | CHECK | `monthly`, `yearly`, `one_time` |
| `target_scope` | `text` | NOT NULL | CHECK | `household`, `resident` |
| `is_active` | `boolean` | NOT NULL | DEFAULT `true` | |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |

**Index**: `idx_dues_tenant_active` (`tenant_id`, `is_active`).

---

### 3.2 `bills`
**Fungsi**: Tagihan iuran per periode; mendukung status pembayaran penuh, parsial, dan refund.

| Kolom | Tipe Data | Null | Key / Constraint | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NOT NULL | PK, UNIQUE `(tenant_id, id)` | |
| `tenant_id` | `uuid` | NOT NULL | FK -> `tenants(id) ON DELETE CASCADE` | |
| `due_id` | `uuid` | NOT NULL | Composite FK -> `dues(tenant_id, id) ON DELETE RESTRICT` | |
| `household_id` | `uuid` | NULL | Composite FK -> `households(tenant_id, id) ON DELETE RESTRICT` | |
| `resident_id` | `uuid` | NULL | Composite FK -> `residents(tenant_id, id) ON DELETE RESTRICT` | |
| `period_year` | `smallint` | NOT NULL | CHECK (`period_year BETWEEN 2000 AND 2100`) (`chk_bills_period_year`) | |
| `period_month` | `smallint` | NOT NULL | CHECK (`period_month BETWEEN 1 AND 12`) | |
| `amount` | `numeric(14,2)` | NOT NULL | CHECK (`amount >= 0`) | Total tagihan |
| `paid_amount` | `numeric(14,2)` | NOT NULL | DEFAULT `0`, CHECK (`paid_amount >= 0`) | Total terbayar neto terverifikasi |
| `due_date` | `date` | NOT NULL | | |
| `status` | `text` | NOT NULL | CHECK | `unpaid`, `partial`, `pending_verification`, `paid`, `overdue`, `cancelled`, `refunded` |
| `paid_at` | `timestamptz` | NULL | | |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |

**Check Constraints**:
- `chk_bills_exclusive_target`: `(household_id IS NOT NULL AND resident_id IS NULL) OR (household_id IS NULL AND resident_id IS NOT NULL)`.
- `chk_bills_paid_status`: `(status <> 'paid' OR paid_amount >= amount)`.
**Unique Constraints**:
- `uq_bills_household_period` (`tenant_id`, `due_id`, `household_id`, `period_year`, `period_month`) WHERE `household_id IS NOT NULL AND status <> 'cancelled'`
- `uq_bills_resident_period` (`tenant_id`, `due_id`, `resident_id`, `period_year`, `period_month`) WHERE `resident_id IS NOT NULL AND status <> 'cancelled'`
**Index**: `idx_bills_tenant_period_status` (`tenant_id`, `period_year`, `period_month`, `status`), `idx_bills_household` (`tenant_id`, `household_id`, `status`).

---

### 3.3 `payments`
**Fungsi**: Riwayat pembayaran tagihan (penuh, parsial, pembayaran ulang, gateway) dan refund tanpa menghapus histori.

| Kolom | Tipe Data | Null | Key / Constraint | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NOT NULL | PK, UNIQUE `(tenant_id, id)` | |
| `tenant_id` | `uuid` | NOT NULL | FK -> `tenants(id) ON DELETE CASCADE` | |
| `bill_id` | `uuid` | NOT NULL | Composite FK -> `bills(tenant_id, id) ON DELETE RESTRICT` | |
| `payment_type` | `text` | NOT NULL | CHECK | `payment`, `refund` |
| `parent_payment_id` | `uuid` | NULL | Composite FK -> `payments(tenant_id, id) ON DELETE RESTRICT` | Diisi jika `payment_type = 'refund'` |
| `paid_by_user_id` | `uuid` | NULL | FK -> `profiles(id) ON DELETE SET NULL` | |
| `amount` | `numeric(14,2)` | NOT NULL | CHECK (`amount > 0`) | |
| `payment_method` | `text` | NOT NULL | CHECK | `transfer`, `qris`, `cash`, `gateway` |
| `proof_storage_path` | `text` | NULL | | `{tenant_id}/{bill_id}/{file_id}.{ext}` |
| `gateway_provider` | `text` | NULL | | `midtrans`, `xendit`, dll. |
| `gateway_reference` | `text` | NULL | | ID transaksi eksternal |
| `idempotency_key` | `text` | NULL | | Kunci idempotency untuk gateway/retry |
| `status` | `text` | NOT NULL | CHECK | `pending`, `verified`, `failed`, `rejected`, `refunded` |
| `notes` | `text` | NULL | | |
| `verified_by` | `uuid` | NULL | FK -> `profiles(id) ON DELETE SET NULL` | |
| `verified_at` | `timestamptz` | NULL | | |
| `paid_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |

**Unique & Index**: `uq_payments_idempotency` (`tenant_id`, `idempotency_key`) WHERE `idempotency_key IS NOT NULL`; `idx_payments_tenant_status` (`tenant_id`, `status`, `paid_at`); `idx_payments_bill` (`bill_id`).

---

### 3.4 `payment_webhook_events`
**Fungsi**: Mencatat dan menjamin *idempotency* event webhook dari payment gateway agar tidak diproses ganda.

| Kolom | Tipe Data | Null | Key / Constraint | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NOT NULL | PK | |
| `tenant_id` | `uuid` | NULL | FK -> `tenants(id) ON DELETE SET NULL` | |
| `provider` | `text` | NOT NULL | | Misal `midtrans`, `xendit` |
| `event_id` | `text` | NOT NULL | | ID event unik dari provider |
| `payment_id` | `uuid` | NULL | Composite FK `fk_webhook_payment` -> `payments(tenant_id, id) ON DELETE RESTRICT` | Wajib punya `tenant_id` jika `payment_id` terisi (`chk_webhook_payment_tenant`) |
| `payload` | `jsonb` | NOT NULL | | Payload webhook terverifikasi signature |
| `processing_status` | `text` | NOT NULL | CHECK | `received`, `processed`, `ignored`, `failed` |
| `processed_at` | `timestamptz` | NULL | | |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |

**Unique & Index**: `uq_webhook_provider_event` (`provider`, `event_id`).

---

### 3.5 `cash_categories`
**Fungsi**: Kategori kas masuk dan kas keluar per tenant.

| Kolom | Tipe Data | Null | Key / Constraint | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NOT NULL | PK, UNIQUE `(tenant_id, id)` | |
| `tenant_id` | `uuid` | NOT NULL | FK -> `tenants(id) ON DELETE CASCADE` | |
| `name` | `text` | NOT NULL | | |
| `type` | `text` | NOT NULL | CHECK | `income`, `expense` |
| `is_active` | `boolean` | NOT NULL | DEFAULT `true` | |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |

**Unique**: `uq_cash_categories_tenant_name_type` (`tenant_id`, `name`, `type`).

---

### 3.6 `cash_transactions`
**Fungsi**: Buku kas umum RT; terhubung 1:1 ke `payments` terverifikasi untuk mencegah transaksi kas ganda.

| Kolom | Tipe Data | Null | Key / Constraint | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NOT NULL | PK | |
| `tenant_id` | `uuid` | NOT NULL | FK -> `tenants(id) ON DELETE CASCADE` | |
| `category_id` | `uuid` | NOT NULL | Composite FK -> `cash_categories(tenant_id, id) ON DELETE RESTRICT` | |
| `payment_id` | `uuid` | NULL | Composite FK -> `payments(tenant_id, id) ON DELETE RESTRICT` | Referensi pembayaran/refund |
| `type` | `text` | NOT NULL | CHECK | `income`, `expense` |
| `amount` | `numeric(14,2)` | NOT NULL | CHECK (`amount > 0`) | |
| `transaction_date` | `date` | NOT NULL | | |
| `description` | `text` | NOT NULL | | |
| `attachment_path` | `text` | NULL | | Path nota/kwitansi di Storage |
| `created_by` | `uuid` | NOT NULL | FK -> `profiles(id) ON DELETE RESTRICT` | |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |

**Unique & Index**: `uq_cash_tx_payment` (`payment_id`) WHERE `payment_id IS NOT NULL`; `idx_cash_tx_tenant_date` (`tenant_id`, `transaction_date`).

---

## 4. Announcement Management

### 4.1 `announcements`
| Kolom | Tipe Data | Null | Key / Constraint | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NOT NULL | PK, UNIQUE `(tenant_id, id)` | |
| `tenant_id` | `uuid` | NOT NULL | FK -> `tenants(id) ON DELETE CASCADE` | |
| `author_id` | `uuid` | NOT NULL | FK -> `profiles(id) ON DELETE RESTRICT` | |
| `title` | `text` | NOT NULL | | |
| `content` | `text` | NOT NULL | | |
| `attachment_path` | `text` | NULL | | |
| `status` | `text` | NOT NULL | CHECK | `draft`, `published`, `archived` |
| `target_type` | `text` | NOT NULL | CHECK | `all`, `role`, `household` |
| `published_at` | `timestamptz` | NULL | | |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |
| `deleted_at` | `timestamptz` | NULL | | Soft delete |

**Index**: `idx_announcements_tenant_pub` (`tenant_id`, `status`, `published_at`) WHERE `deleted_at IS NULL`.

### 4.2 `announcement_recipients`
| Kolom | Tipe Data | Null | Key / Constraint | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NOT NULL | PK | |
| `tenant_id` | `uuid` | NOT NULL | FK -> `tenants(id) ON DELETE CASCADE` | |
| `announcement_id` | `uuid` | NOT NULL | Composite FK -> `announcements(tenant_id, id) ON DELETE CASCADE` | |
| `role_id` | `uuid` | NULL | FK -> `roles(id) ON DELETE CASCADE` | |
| `household_id` | `uuid` | NULL | Composite FK -> `households(tenant_id, id) ON DELETE CASCADE` | |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |

**Check Constraint**: `(role_id IS NOT NULL AND household_id IS NULL) OR (role_id IS NULL AND household_id IS NOT NULL)`.
**Unique Indexes**:
- `uq_ann_recipients_role` (`tenant_id`, `announcement_id`, `role_id`) WHERE `role_id IS NOT NULL`
- `uq_ann_recipients_household` (`tenant_id`, `announcement_id`, `household_id`) WHERE `household_id IS NOT NULL`

---

## 5. Complaint Management

### 5.1 `complaints`
| Kolom | Tipe Data | Null | Key / Constraint | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NOT NULL | PK, UNIQUE `(tenant_id, id)` | |
| `tenant_id` | `uuid` | NOT NULL | FK -> `tenants(id) ON DELETE CASCADE` | |
| `reporter_member_id` | `uuid` | NOT NULL | Composite FK -> `tenant_members(tenant_id, id) ON DELETE RESTRICT` | |
| `category` | `text` | NOT NULL | | |
| `title` | `text` | NOT NULL | | |
| `description` | `text` | NOT NULL | | |
| `photo_path` | `text` | NULL | | `{tenant_id}/{complaint_id}/{file_id}.{ext}` |
| `priority` | `text` | NOT NULL | CHECK | `low`, `medium`, `high` |
| `status` | `text` | NOT NULL | CHECK | `open`, `in_progress`, `resolved`, `rejected` |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |
| `deleted_at` | `timestamptz` | NULL | | Soft delete |

**Index**: `idx_complaints_tenant_status` (`tenant_id`, `status`, `created_at`) WHERE `deleted_at IS NULL`.

### 5.2 `complaint_replies`
**Fungsi**: Percakapan/tanggapan antara pelapor dan pengurus (terpisah dari perubahan status).

| Kolom | Tipe Data | Null | Key / Constraint | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NOT NULL | PK | |
| `tenant_id` | `uuid` | NOT NULL | FK -> `tenants(id) ON DELETE CASCADE` | |
| `complaint_id` | `uuid` | NOT NULL | Composite FK -> `complaints(tenant_id, id) ON DELETE CASCADE` | |
| `author_member_id` | `uuid` | NOT NULL | Composite FK -> `tenant_members(tenant_id, id) ON DELETE RESTRICT` | |
| `message` | `text` | NOT NULL | | |
| `attachment_path` | `text` | NULL | | |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |

**Index**: `idx_complaint_replies_complaint` (`complaint_id`, `created_at`).

### 5.3 `complaint_status_history`
**Fungsi**: Log *append-only* perubahan status pengaduan (hanya dapat dibuat oleh pengurus berwenang, tidak bisa dimanipulasi warga biasa).

| Kolom | Tipe Data | Null | Key / Constraint | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NOT NULL | PK | |
| `tenant_id` | `uuid` | NOT NULL | FK -> `tenants(id) ON DELETE CASCADE` | |
| `complaint_id` | `uuid` | NOT NULL | Composite FK -> `complaints(tenant_id, id) ON DELETE CASCADE` | |
| `changed_by_member_id` | `uuid` | NOT NULL | Composite FK -> `tenant_members(tenant_id, id) ON DELETE RESTRICT` | |
| `previous_status` | `text` | NOT NULL | CHECK | `open`, `in_progress`, `resolved`, `rejected` |
| `new_status` | `text` | NOT NULL | CHECK | `open`, `in_progress`, `resolved`, `rejected` |
| `reason` | `text` | NULL | | Alasan perubahan status |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |

**Index**: `idx_complaint_status_hist_complaint` (`complaint_id`, `created_at`).

---

## 6. Letter Management

### 6.1 `letter_types`
| Kolom | Tipe Data | Null | Key / Constraint | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NOT NULL | PK, UNIQUE `(tenant_id, id)` | |
| `tenant_id` | `uuid` | NOT NULL | FK -> `tenants(id) ON DELETE CASCADE` | |
| `code` | `text` | NOT NULL | | |
| `name` | `text` | NOT NULL | | |
| `description` | `text` | NULL | | |
| `required_documents` | `jsonb` | NOT NULL | DEFAULT `'[]'` | |
| `is_active` | `boolean` | NOT NULL | DEFAULT `true` | |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |

**Unique**: `uq_letter_types_tenant_code` (`tenant_id`, `code`).

### 6.2 `letter_sequences`
**Fungsi**: Counter atomik penomoran surat per `(tenant_id, period_year)` untuk mencegah duplikasi saat concurrent requests.

| Kolom | Tipe Data | Null | Key / Constraint | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NOT NULL | PK | |
| `tenant_id` | `uuid` | NOT NULL | FK -> `tenants(id) ON DELETE CASCADE` | |
| `period_year` | `smallint` | NOT NULL | | Tahun berjalan |
| `last_number` | `integer` | NOT NULL | DEFAULT `0` | Nomor urut terakhir |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |

**Unique**: `uq_letter_sequences_tenant_year` (`tenant_id`, `period_year`).

### 6.3 `letter_requests`
| Kolom | Tipe Data | Null | Key / Constraint | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NOT NULL | PK | |
| `tenant_id` | `uuid` | NOT NULL | FK -> `tenants(id) ON DELETE CASCADE` | |
| `letter_type_id` | `uuid` | NOT NULL | Composite FK -> `letter_types(tenant_id, id) ON DELETE RESTRICT` | |
| `resident_id` | `uuid` | NOT NULL | Composite FK -> `residents(tenant_id, id) ON DELETE RESTRICT` | Subjek surat |
| `requested_by_member_id` | `uuid` | NOT NULL | Composite FK -> `tenant_members(tenant_id, id) ON DELETE RESTRICT` | Pemohon |
| `purpose` | `text` | NOT NULL | | |
| `supporting_doc_paths` | `jsonb` | NOT NULL | DEFAULT `'[]'` | Path di bucket `letter-requests` |
| `status` | `text` | NOT NULL | CHECK | `submitted`, `reviewing`, `approved`, `rejected`, `completed` |
| `admin_notes` | `text` | NULL | | |
| `letter_number` | `text` | NULL | | Unik per tenant saat terbit |
| `issued_file_path` | `text` | NULL | | Path PDF di bucket `issued-letters` |
| `reviewed_by` | `uuid` | NULL | FK -> `profiles(id) ON DELETE SET NULL` | |
| `reviewed_at` | `timestamptz` | NULL | | |
| `issued_at` | `timestamptz` | NULL | | |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |

**Unique & Index**: `uq_letter_requests_tenant_number` (`tenant_id`, `letter_number`) WHERE `letter_number IS NOT NULL`; `idx_letter_requests_tenant_status` (`tenant_id`, `status`, `created_at`).

---

## 7. Community Activities

### 7.1 `activities`
| Kolom | Tipe Data | Null | Key / Constraint | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NOT NULL | PK, UNIQUE `(tenant_id, id)` | |
| `tenant_id` | `uuid` | NOT NULL | FK -> `tenants(id) ON DELETE CASCADE` | |
| `title` | `text` | NOT NULL | | |
| `description` | `text` | NULL | | |
| `location` | `text` | NOT NULL | | |
| `start_at` | `timestamptz` | NOT NULL | | |
| `end_at` | `timestamptz` | NULL | CHECK (`end_at IS NULL OR end_at >= start_at`) (`chk_activities_date_range`) | |
| `status` | `text` | NOT NULL | CHECK | `scheduled`, `ongoing`, `completed`, `cancelled` |
| `documentation_paths` | `jsonb` | NOT NULL | DEFAULT `'[]'` | |
| `created_by` | `uuid` | NOT NULL | FK -> `profiles(id) ON DELETE RESTRICT` | |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |
| `deleted_at` | `timestamptz` | NULL | | Soft delete |

**Index**: `idx_activities_tenant_start` (`tenant_id`, `start_at`) WHERE `deleted_at IS NULL`.

### 7.2 `activity_participants`
| Kolom | Tipe Data | Null | Key / Constraint | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NOT NULL | PK | |
| `tenant_id` | `uuid` | NOT NULL | FK -> `tenants(id) ON DELETE CASCADE` | |
| `activity_id` | `uuid` | NOT NULL | Composite FK -> `activities(tenant_id, id) ON DELETE CASCADE` | |
| `resident_id` | `uuid` | NOT NULL | Composite FK -> `residents(tenant_id, id) ON DELETE CASCADE` | |
| `rsvp_status` | `text` | NOT NULL | CHECK | `invited`, `attending`, `attended`, `absent` |
| `registered_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |

**Unique**: `uq_activity_participants` (`activity_id`, `resident_id`).

---

## 8. Notification & Audit

### 8.1 `notifications`
| Kolom | Tipe Data | Null | Key / Constraint | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NOT NULL | PK | |
| `tenant_id` | `uuid` | NOT NULL | FK -> `tenants(id) ON DELETE CASCADE` | |
| `recipient_user_id` | `uuid` | NOT NULL | FK -> `profiles(id) ON DELETE CASCADE`, Composite FK `fk_notifications_member` -> `tenant_members(tenant_id, user_id) ON DELETE CASCADE` | |
| `title` | `text` | NOT NULL | | |
| `body` | `text` | NOT NULL | | |
| `type` | `text` | NOT NULL | | `bill`, `payment`, `announcement`, `complaint`, `letter`, `activity` |
| `reference_type` | `text` | NULL | | |
| `reference_id` | `uuid` | NULL | | |
| `is_read` | `boolean` | NOT NULL | DEFAULT `false` | |
| `read_at` | `timestamptz` | NULL | | |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |

**Index**: `idx_notifications_user_unread` (`recipient_user_id`, `tenant_id`, `is_read`, `created_at`).

### 8.2 `audit_logs`
| Kolom | Tipe Data | Null | Key / Constraint | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NOT NULL | PK | |
| `tenant_id` | `uuid` | NULL | FK -> `tenants(id) ON DELETE SET NULL` | NULL hanya untuk aksi `super_admin` |
| `actor_user_id` | `uuid` | NULL | FK -> `profiles(id) ON DELETE SET NULL` | |
| `action` | `text` | NOT NULL | | |
| `entity_type` | `text` | NOT NULL | | |
| `entity_id` | `uuid` | NULL | | |
| `metadata` | `jsonb` | NOT NULL | DEFAULT `'{}'` | Tanpa nilai NIK/KK mentah |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT `now()` | |

**Index**: `idx_audit_logs_tenant_created` (`tenant_id`, `created_at`).
