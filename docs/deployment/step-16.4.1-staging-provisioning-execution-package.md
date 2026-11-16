# Smart RT — Step 16.4.1: Staging Provisioning Execution Package (Targeted Compensation C Fix & Final Review)

- **Date:** 2026-11-16
- **Revision:** Step 16.4.1.5 Targeted Compensation C Fix & Final Review
- **Target Project:** `smart-rt-staging`
- **Project Ref:** `szghujzhiyndeuhepsax`
- **Region:** `ap-southeast-1`
- **Database Engine:** `PostgreSQL 17.11` (`17.11.0.019`)
- **Status:** **NOT EXECUTED — REQUIRES EXPLICIT APPROVAL**

---

## 1. Executive Summary & Safety Policy

Dokumen ini merupakan **Paket Eksekusi Provisioning Resmi Final (Telah Menutup Seluruh Temuan Integritas, Kompensasi C PostgreSQL 17 Fix, dan Final Safety Review)** untuk menyiapkan data awal pada Supabase Cloud staging project (`szghujzhiyndeuhepsax`).

Penyempurnaan definitif pada revisi penutupan Step 16.4.1.5:
1. **Script A (Roles):** Mempertahankan 5 roles baku dengan validasi kesesuaian atribut eksisting tanpa hardcoded UUID.
2. **Script B (Tenant & Referensi):** Concurrency lock via advisory transaction lock, validasi cash categories strict (`count per name`, tolak mismatch tipe, tolak inaktif, tolak kategori ekstra), dan validasi letter types (normalized collision check).
3. **Script C (Membership):** Row-level lock `FOR UPDATE` pada profil, isolasi lintas-tenant, status tenant wajib `active`, penolakan membership ganda, penolakan role ganda, `assigned_by = NULL`, dan `resident_id = NULL`.
4. **Script D (Verification):** Validasi exact administrator UID (`<AUTH_ADMIN_USER_ID>`), modul CTE bersih tanpa `min(uuid)` dan tanpa nested aggregates, teruji 100% kompatibel di PostgreSQL 17.11, serta evaluasi eksplisit `PASS`/`FAIL`.
5. **Kompensasi C (Exact Role Assignment Guard, Non-Aggregated UUID, Row Count Check & 17-Relation Audit):** Menghilangkan seluruh fungsi inkompatibel `min(uuid)`. Memeriksa `count(*) = 1` terlebih dahulu, mengambil exact role assignment via SELECT terpisah, memvalidasi role `'ketua_rt'`, menghapus role spesifik berdasarkan primary key, memverifikasi `ROW_COUNT = 1` via `GET DIAGNOSTICS`, dan mengaudit ketiadaan data pada seluruh 17 relasi foreign key domain dan audit sebelum menghapus keanggotaan (juga diverifikasi `ROW_COUNT = 1`). Tidak menghapus Auth user maupun profil.
6. **Kompensasi B (Complete 30-Table Dependency Audit):** Menghapus seluruh klausa `DELETE` otomatis. Mengaudit seluruh 30 tabel yang mereferensikan `public.tenants` dengan metrik `no_checked_dependencies_found` yang memeriksa ke-30 tabel secara eksplisit satu-lawan-satu di dalam klausa `UNION ALL`.

> [!CAUTION]
> **READ-ONLY PREPARATION ONLY:**
> Seluruh script mutasi SQL dalam paket ini **BELUM DIJALANKAN (NOT EXECUTED)**.
> Dilarang menjalankan DDL/DML, membuat Auth user, atau mendeploy aplikasi ke staging sebelum paket ini ditinjau dan disetujui secara eksplisit oleh user.

---

## 2. Phase 1 — Final Schema Validation & FK Catalog Inventory

Berdasarkan introspeksi katalog sistem `pg_constraint` remote PostgreSQL 17.11 staging:

### 2.1 Ringkasan 7 Tabel Provisioning
- **`public.roles`:** PK `id`, Unique `code`, Check 5 role baku (`ketua_rt`, `sekretaris`, `bendahara`, `pengurus`, `warga`).
- **`public.tenants`:** PK `id`, Unique `code WHERE deleted_at IS NULL`, Check status `('active', 'inactive', 'suspended')`.
- **`public.cash_categories`:** PK `id`, FK `tenant_id -> tenants(id) ON DELETE CASCADE`, Check type `('income', 'expense')`, Unique `(tenant_id, name, type)` dan `(tenant_id, id)`.
- **`public.letter_types`:** PK `id`, FK `tenant_id -> tenants(id) ON DELETE CASCADE`, Unique `(tenant_id, code)`, `(tenant_id, id)`, dan `uq_letter_types_tenant_normalized_code`.
- **`public.profiles`:** PK `id REFERENCES auth.users(id) ON DELETE CASCADE`, FK `active_tenant_id -> tenants(id) ON DELETE SET NULL`.
- **`public.tenant_members`:** PK `id`, FK `tenant_id -> tenants(id) ON DELETE CASCADE`, FK `user_id -> profiles(id) ON DELETE CASCADE`, FK `resident_id -> residents(tenant_id, id) ON DELETE SET NULL` (resident_id bersifat **NULLABLE**).
- **`public.member_roles`:** PK `id`, FK `(tenant_id, member_id) -> tenant_members(tenant_id, id) ON DELETE CASCADE`, FK `role_id -> roles(id) ON DELETE RESTRICT`, FK `assigned_by -> profiles(id) ON DELETE SET NULL`.

### 2.2 Inventaris Lengkap FK Referencing `tenant_members`, `member_roles`, dan `profiles` (17 Relasi Domain)
1. `complaint_replies(tenant_id, author_member_id)` -> `tenant_members` (`RESTRICT`)
2. `complaint_status_history(tenant_id, changed_by_member_id)` -> `tenant_members` (`RESTRICT`)
3. `complaints(tenant_id, reporter_member_id)` -> `tenant_members` (`RESTRICT`)
4. `letter_requests(tenant_id, requested_by_member_id)` -> `tenant_members` (`RESTRICT`)
5. `member_roles(tenant_id, member_id)` -> `tenant_members` (`CASCADE`)
6. `notifications(tenant_id, recipient_user_id)` -> `tenant_members` (`CASCADE`)
7. `activities(created_by)` -> `profiles` (`RESTRICT`)
8. `activities(updated_by, cancelled_by)` -> `profiles` (`SET NULL`)
9. `activity_participants(recorded_by)` -> `profiles` (`SET NULL`)
10. `announcements(author_id)` -> `profiles` (`RESTRICT`)
11. `cash_transactions(created_by)` -> `profiles` (`RESTRICT`)
12. `letter_requests(reviewed_by)` -> `profiles` (`SET NULL`)
13. `payments(paid_by_user_id, verified_by)` -> `profiles` (`SET NULL`)
14. `resident_documents(verified_by)` -> `profiles` (`SET NULL`)
15. `resident_invitations(invited_by, redeemed_by, revoked_by)` -> `profiles` (`SET NULL`)
16. `ronda_assignments(created_by, attendance_recorded_by)` -> `profiles` (`SET NULL`)
17. `ronda_schedules(created_by, updated_by)` -> `profiles` (`SET NULL`)
*(Ditambah audit internal: `audit_logs(actor_user_id)` -> `profiles` (`SET NULL`)).*

### 2.3 Inventaris Lengkap FK Referencing `tenants` (Tepat 30 Tabel)
`activities`, `activity_participants`, `announcements`, `announcement_recipients`, `audit_logs`, `bills`, `cash_categories`, `cash_transactions`, `complaints`, `complaint_replies`, `complaint_status_history`, `dues`, `households`, `letter_requests`, `letter_sequences`, `letter_types`, `member_roles`, `notifications`, `payment_webhook_events`, `payments`, `profiles`, `resident_documents`, `resident_invitations`, `resident_private_data`, `residents`, `ronda_assignments`, `ronda_schedules`, `storage_deletion_queue`, `tenant_members`, `vehicles`.

---

## 3. Execution Sequence & Prerequisites

```
[Prasyarat: Step 16.3.3 Selesai — 23 Migrasi Diterapkan]
  │
  ├── 1. Script A (Phase 2): Global Roles SQL
  │      └── Memeriksa & memasukkan 5 roles global baku.
  │
  ├── 2. Script B (Phase 3): Staging Tenant & Reference Data SQL
  │      └── Serialisasi via pg_advisory_xact_lock.
  │      └── Validasi kategori kas strict (count per nama, tipe, status aktif, ketiadaan ekstra).
  │      └── Validasi letter types (normalized code collision & ketiadaan ekstra).
  │
  ├── 3. Prosedur Manual (Phase 4): Pembuatan Auth User di Supabase Dashboard
  │      └── Operator membuat user di Dashboard dengan "Auto Confirm User" = TRUE.
  │      └── Menggunakan email operator terkontrol (bukan email fiktif).
  │      └── Salin User UID (<AUTH_ADMIN_USER_ID>).
  │
  ├── 4. Script C (Phase 5): Tenant Membership & Role Assignment SQL
  │      └── Row-lock profile FOR UPDATE & advisory lock.
  │      └── Validasi status tenant 'active', ketiadaan membership ganda, dan menetapkan ketua_rt.
  │      └── assigned_by = NULL (self-bootstrap sah).
  │
  └── 5. Script D (Phase 6): Read-Only Verification SQL
         └── Validasi exact administrator UID, 5 roles, 1 tenant, 6 categories, 3 letter types.
         └── Evaluasi menyeluruh eksplisit PASS/FAIL tanpa min(uuid).
```

---

## 4. Phase 2 — Global Roles SQL

> **Status:** `NOT EXECUTED — REQUIRES EXPLICIT APPROVAL`
> **Karakteristik:** Idempoten, tanpa hardcoded UUID, memeriksa konsistensi atribut existing (`name`, `description`), dan melempar exception bila ada mismatch.

```sql
-- =============================================================================
-- SCRIPT A: PROVISIONING GLOBAL ROLES (NOT EXECUTED — REQUIRES EXPLICIT APPROVAL)
-- =============================================================================
BEGIN;

DO $$
DECLARE
    v_expected_roles jsonb := '[
        {"code": "ketua_rt", "name": "Ketua RT", "description": "Penanggung jawab utama operasional dan persetujuan RT"},
        {"code": "sekretaris", "name": "Sekretaris", "description": "Pengelola data kependudukan, pengumuman, dan surat pengantar"},
        {"code": "bendahara", "name": "Bendahara", "description": "Pengelola iuran, verifikasi pembayaran, dan buku kas RT"},
        {"code": "pengurus", "name": "Pengurus", "description": "Pengurus operasional lingkungan, pengaduan, dan kegiatan"},
        {"code": "warga", "name": "Warga", "description": "Warga terdaftar pada lingkungan RT"}
    ]'::jsonb;
    v_item jsonb;
    v_code text;
    v_name text;
    v_desc text;
    v_existing record;
BEGIN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_expected_roles)
    LOOP
        v_code := v_item->>'code';
        v_name := v_item->>'name';
        v_desc := v_item->>'description';

        SELECT id, code, name, description
        INTO v_existing
        FROM public.roles
        WHERE code = v_code;

        IF FOUND THEN
            -- Abort jika atribut existing tidak sesuai definisi baku aplikasi
            IF v_existing.name <> v_name OR COALESCE(v_existing.description, '') <> COALESCE(v_desc, '') THEN
                RAISE EXCEPTION 'Role % already exists with mismatched attributes: found (name: "%", desc: "%"), expected (name: "%", desc: "%")',
                    v_code, v_existing.name, v_existing.description, v_name, v_desc;
            END IF;
            RAISE NOTICE 'Role % already exists and strictly matches specification. Preserving existing record.', v_code;
        ELSE
            INSERT INTO public.roles (id, code, name, description)
            VALUES (gen_random_uuid(), v_code, v_name, v_desc);
            RAISE NOTICE 'Role % successfully created.', v_code;
        END IF;
    END LOOP;
END $$;

-- Verifikasi hasil insert
SELECT id, code, name, description, created_at
FROM public.roles
ORDER BY code;

COMMIT;
```

---

## 5. Phase 3 — Tenant & Reference Data SQL

> **Status:** `NOT EXECUTED — REQUIRES EXPLICIT APPROVAL`
> **Karakteristik:**
> - Dilindungi advisory transaction lock untuk serialisasi eksekusi konkuren.
> - Memvalidasi seluruh atribut tenant eksisting.
> - **Cash Categories Strict:** Menghitung baris per nama (`count > 1` di-abort, `count = 1` divalidasi tipe dan `is_active`, `count = 0` di-insert).
> - Menolak kategori kas atau tipe surat ekstra tak terduga (*exact expected set*).
> - Memvalidasi benturan normalized code pada tipe surat.

```sql
-- =============================================================================
-- SCRIPT B: PROVISIONING TENANT & REFERENCE DATA (NOT EXECUTED — REQUIRES EXPLICIT APPROVAL)
-- =============================================================================
BEGIN;

-- 0. Concurrency Protection & Serialisasi Provisioning Staging
SELECT pg_advisory_xact_lock(hashtext('smart_rt_staging_provisioning_tenant_lock'));

DO $$
DECLARE
    v_tenant_code text := 'rt-01-rw-01-staging';
    v_expected_name text := 'RT 01 / RW 01 Staging';
    v_expected_rt text := '01';
    v_expected_rw text := '01';
    v_expected_kel text := 'Kelurahan Simulasi';
    v_expected_kec text := 'Kecamatan Simulasi';
    v_expected_city text := 'Kota Jakarta Selatan';
    v_expected_prov text := 'DKI Jakarta';
    v_expected_letter_format text := '{seq}/RT01-RW01/{month}/{year}';
    
    v_tenant_id uuid;
    v_existing_tenant record;

    -- Expected Cash Categories (tepat 6 kategori)
    v_expected_categories jsonb := '[
        {"name": "Iuran Bulanan Warga", "type": "income"},
        {"name": "Sumbangan & Donasi", "type": "income"},
        {"name": "Kebersihan & Pengelolaan Sampah", "type": "expense"},
        {"name": "Keamanan & Penerangan", "type": "expense"},
        {"name": "Operasional & Kegiatan RT", "type": "expense"},
        {"name": "Pengembalian Dana (Refund)", "type": "expense"}
    ]'::jsonb;
    v_cat_item jsonb;
    v_cat_name text;
    v_cat_type text;
    v_matching_name_count integer;
    v_actual_type text;
    v_actual_active boolean;
    v_unexpected_cat_count integer;

    -- Expected Letter Types (tepat 3 template)
    v_expected_letter_types jsonb := '[
        {
            "code": "DOMISILI",
            "name": "Surat Pengantar Domisili",
            "description": "Surat keterangan domisili warga di lingkungan RT staging",
            "required_documents": ["Fotokopi KTP", "Fotokopi KK"]
        },
        {
            "code": "PENGANTAR_KTP",
            "name": "Surat Pengantar Pembuatan / Perpanjangan KTP",
            "description": "Pengantar administrasi kependudukan ke kelurahan",
            "required_documents": ["Fotokopi KK"]
        },
        {
            "code": "SKTM",
            "name": "Surat Keterangan Tidak Mampu",
            "description": "Pengantar pengurusan keringanan pendidikan atau kesehatan",
            "required_documents": ["Fotokopi KTP", "Fotokopi KK"]
        }
    ]'::jsonb;
    v_lt_item jsonb;
    v_lt_code text;
    v_lt_name text;
    v_lt_desc text;
    v_lt_docs jsonb;
    v_existing_lt record;
    v_unexpected_lt_count integer;
BEGIN
    -- 1. Safety Guard: Cegah keberadaan tenant aktif lain pada staging environment
    IF EXISTS (
        SELECT 1 FROM public.tenants
        WHERE code <> v_tenant_code AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Safety Guard Block: Another active tenant already exists in staging database. Multi-tenant provisioning is prohibited in this step.';
    END IF;

    -- 2. Validasi atau Buat Tenant Staging
    SELECT id, code, name, rt_number, rw_number, kelurahan, kecamatan, city, province, status, settings
    INTO v_existing_tenant
    FROM public.tenants
    WHERE code = v_tenant_code AND deleted_at IS NULL;

    IF FOUND THEN
        -- Bandingkan seluruh atribut penting dengan spesifikasi baku
        IF v_existing_tenant.name <> v_expected_name
           OR v_existing_tenant.rt_number <> v_expected_rt
           OR v_existing_tenant.rw_number <> v_expected_rw
           OR v_existing_tenant.kelurahan <> v_expected_kel
           OR v_existing_tenant.kecamatan <> v_expected_kec
           OR v_existing_tenant.city <> v_expected_city
           OR v_existing_tenant.province <> v_expected_prov
           OR v_existing_tenant.status <> 'active'
           OR COALESCE(v_existing_tenant.settings->>'letter_number_format', '') <> v_expected_letter_format
        THEN
            RAISE EXCEPTION 'Tenant % already exists but attributes mismatch specification: found (name: "%", rt/rw: "%/%", kel: "%", status: "%"), expected (name: "%", rt/rw: "%/%", kel: "%", status: "active")',
                v_tenant_code, v_existing_tenant.name, v_existing_tenant.rt_number, v_existing_tenant.rw_number,
                v_existing_tenant.kelurahan, v_existing_tenant.status, v_expected_name, v_expected_rt, v_expected_rw, v_expected_kel;
        END IF;

        v_tenant_id := v_existing_tenant.id;
        RAISE NOTICE 'Tenant % already exists and strictly matches specification (ID: %). Preserving existing record.', v_tenant_code, v_tenant_id;
    ELSE
        INSERT INTO public.tenants (
            id,
            code,
            name,
            rt_number,
            rw_number,
            kelurahan,
            kecamatan,
            city,
            province,
            status,
            settings
        )
        VALUES (
            gen_random_uuid(),
            v_tenant_code,
            v_expected_name,
            v_expected_rt,
            v_expected_rw,
            v_expected_kel,
            v_expected_kec,
            v_expected_city,
            v_expected_prov,
            'active',
            jsonb_build_object('letter_number_format', v_expected_letter_format)
        )
        RETURNING id INTO v_tenant_id;
        RAISE NOTICE 'Tenant % successfully created (ID: %).', v_tenant_code, v_tenant_id;
    END IF;

    -- 3. Validasi & Insert Cash Categories (Strict Collision & Type Integrity)
    FOR v_cat_item IN SELECT * FROM jsonb_array_elements(v_expected_categories)
    LOOP
        v_cat_name := v_cat_item->>'name';
        v_cat_type := v_cat_item->>'type';

        -- 3.1 Hitung seluruh baris dengan pasangan (tenant_id, name)
        SELECT count(*), min(type), bool_and(is_active)
        INTO v_matching_name_count, v_actual_type, v_actual_active
        FROM public.cash_categories
        WHERE tenant_id = v_tenant_id
          AND name = v_cat_name;

        -- 3.2 Tolak jika ditemukan lebih dari satu baris dengan nama ini
        IF v_matching_name_count > 1 THEN
            RAISE EXCEPTION 'Integrity Failure: Found % rows for category name "%" in tenant %. Exactly one row expected per category name.',
                v_matching_name_count, v_cat_name, v_tenant_code;
        END IF;

        -- 3.3 Validasi baris eksisting jika ditemukan
        IF v_matching_name_count = 1 THEN
            IF v_actual_type <> v_cat_type THEN
                RAISE EXCEPTION 'Category type mismatch for category "%" in tenant %: found type "%", expected "%". Multiple categories with same name and differing types are prohibited.',
                    v_cat_name, v_tenant_code, v_actual_type, v_cat_type;
            END IF;

            IF v_actual_active IS NOT TRUE THEN
                RAISE EXCEPTION 'Cash category "%" (%) exists in tenant % but is_active is false. Active category required.',
                    v_cat_name, v_cat_type, v_tenant_code;
            END IF;

            RAISE NOTICE 'Cash category "%" (%) matches specification. Skipping.', v_cat_name, v_cat_type;
        -- 3.4 Insert jika belum ada
        ELSE
            INSERT INTO public.cash_categories (id, tenant_id, name, type, is_active)
            VALUES (gen_random_uuid(), v_tenant_id, v_cat_name, v_cat_type, true);
            RAISE NOTICE 'Cash category "%" (%) created.', v_cat_name, v_cat_type;
        END IF;
    END LOOP;

    -- 3.5 Pemeriksaan unexpected extra cash categories (berdasarkan pasangan name, type)
    SELECT count(*)
    INTO v_unexpected_cat_count
    FROM public.cash_categories cc
    WHERE cc.tenant_id = v_tenant_id
      AND (cc.name, cc.type) NOT IN (
        ('Iuran Bulanan Warga', 'income'),
        ('Sumbangan & Donasi', 'income'),
        ('Kebersihan & Pengelolaan Sampah', 'expense'),
        ('Keamanan & Penerangan', 'expense'),
        ('Operasional & Kegiatan RT', 'expense'),
        ('Pengembalian Dana (Refund)', 'expense')
      );

    IF v_unexpected_cat_count > 0 THEN
        RAISE EXCEPTION 'Integrity Failure: Found % unexpected extra cash categories in staging tenant %. Provisioning must be deterministic.',
            v_unexpected_cat_count, v_tenant_code;
    END IF;

    -- 4. Validasi & Insert Letter Types (Termasuk Normalized Code Collision & Extra Check)
    FOR v_lt_item IN SELECT * FROM jsonb_array_elements(v_expected_letter_types)
    LOOP
        v_lt_code := v_lt_item->>'code';
        v_lt_name := v_lt_item->>'name';
        v_lt_desc := v_lt_item->>'description';
        v_lt_docs := v_lt_item->'required_documents';

        -- Cari apakah ada record dengan exact code ATAU normalized code collision
        SELECT id, code, name, description, required_documents, is_active
        INTO v_existing_lt
        FROM public.letter_types
        WHERE tenant_id = v_tenant_id
          AND (
            code = v_lt_code
            OR upper(regexp_replace(code, '[^A-Za-z0-9]+', '', 'g')) = upper(regexp_replace(v_lt_code, '[^A-Za-z0-9]+', '', 'g'))
          );

        IF FOUND THEN
            -- Periksa kesesuaian menyeluruh
            IF v_existing_lt.code <> v_lt_code
               OR v_existing_lt.name <> v_lt_name
               OR COALESCE(v_existing_lt.description, '') <> COALESCE(v_lt_desc, '')
               OR v_existing_lt.required_documents <> v_lt_docs
               OR v_existing_lt.is_active IS NOT TRUE
            THEN
                RAISE EXCEPTION 'Letter type % has collision or attribute mismatch: found (code: "%", name: "%", active: %), expected (code: "%", name: "%", active: true)',
                    v_lt_code, v_existing_lt.code, v_existing_lt.name, v_existing_lt.is_active, v_lt_code, v_lt_name;
            END IF;
            RAISE NOTICE 'Letter type % matches specification. Skipping.', v_lt_code;
        ELSE
            INSERT INTO public.letter_types (id, tenant_id, code, name, description, required_documents, is_active)
            VALUES (gen_random_uuid(), v_tenant_id, v_lt_code, v_lt_name, v_lt_desc, v_lt_docs, true);
            RAISE NOTICE 'Letter type % created.', v_lt_code;
        END IF;
    END LOOP;

    -- Pemeriksaan unexpected extra letter types
    SELECT count(*)
    INTO v_unexpected_lt_count
    FROM public.letter_types lt
    WHERE lt.tenant_id = v_tenant_id
      AND lt.code NOT IN ('DOMISILI', 'PENGANTAR_KTP', 'SKTM');

    IF v_unexpected_lt_count > 0 THEN
        RAISE EXCEPTION 'Integrity Failure: Found % unexpected extra letter types in staging tenant %. Provisioning must be deterministic.',
            v_unexpected_lt_count, v_tenant_code;
    END IF;

END $$;

-- Verifikasi hasil tenant staging & referensinya (Hanya data staging tenant)
SELECT 
    t.id AS tenant_id,
    t.code,
    t.name,
    t.status,
    (SELECT count(*) FROM public.cash_categories WHERE tenant_id = t.id) AS staging_cash_categories_count,
    (SELECT count(*) FROM public.letter_types WHERE tenant_id = t.id) AS staging_letter_types_count
FROM public.tenants t
WHERE t.code = 'rt-01-rw-01-staging' AND t.deleted_at IS NULL;

COMMIT;
```

---

## 6. Phase 4 — Admin Account Procedure (Manual Supabase Dashboard)

Prosedur manual oleh operator di antarmuka web Supabase Dashboard:

1. Buka browser dan masuk ke **[Supabase Dashboard](https://supabase.com/dashboard)**.
2. Pilih project **`smart-rt-staging`** (`szghujzhiyndeuhepsax`).
3. Pada navigasi sidebar kiri, klik **Authentication** -> **Users**.
4. Klik tombol **Add user** -> pilih **Create user**.
5. Isi formulir:
   - **Email:** Masukkan alamat email staging aktif yang berada di bawah kendali operator langsung (contoh: `staging-admin@organisasi-anda.id` atau email pengujian operator yang sah).
     *(PENTING: Jangan mengarang domain fiktif agar alur konfirmasi dan pengujian dapat dipantau).*
   - **Password:** Masukkan kata sandi kuat (minimal 12 karakter alfanumerik + simbol).
   - **Auto Confirm User:** **WAJIB DICENTANG (CHECKED)**.
     *(PENTING: Memastikan `email_confirmed_at` langsung terisi dan menghindari ketergantungan SMTP).*
6. Klik **Create user**.
7. Salin **User UID** dari tabel users (UUID format `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`).
8. Simpan User UID tersebut sebagai `<AUTH_ADMIN_USER_ID>` untuk digunakan pada Script C dan Script D.
9. **PERINGATAN KEAMANAN:** Jangan mencatat, membagikan, atau menyimpan password di dalam chat prompt, issue tracker, atau file git commit.

---

## 7. Phase 5 — Membership & Role Assignment SQL

> **Status:** `NOT EXECUTED — REQUIRES EXPLICIT APPROVAL`
> **Karakteristik:**
> - Dilindungi advisory lock dan exclusive row lock (`FOR UPDATE`) pada baris profil.
> - Memverifikasi Auth user dan email confirmation.
> - Menolak user jika memiliki membership di tenant lain.
> - Menolak eksekusi jika membership staging sudah ada (mewajibkan audit manual).
> - Menolak jika member sudah memiliki role assignment lain (mencegah role ganda).
> - Mengisi `assigned_by = NULL` (model audit self-bootstrap sah).
> - Menjaga `resident_id = NULL` tanpa membuat resident/household palsu.

```sql
-- =============================================================================
-- SCRIPT C: PROVISIONING MEMBERSHIP & ROLE (NOT EXECUTED — REQUIRES EXPLICIT APPROVAL)
-- =============================================================================
BEGIN;

DO $$
DECLARE
    -- Masukkan User UID yang disalin dari Supabase Dashboard:
    v_admin_user_id uuid := '<AUTH_ADMIN_USER_ID>'::uuid;
    v_tenant_code text := 'rt-01-rw-01-staging';
    v_tenant_id uuid;
    v_tenant_status text;
    v_ketua_role_id uuid;
    v_member_id uuid;
    v_user_confirmed_at timestamptz;
    v_locked_profile_id uuid;
BEGIN
    -- 0. Concurrency Protection: Advisory lock berbasis User UID
    PERFORM pg_advisory_xact_lock(hashtext('smart_rt_staging_provisioning_member_' || v_admin_user_id::text));

    -- 1. Validasi keberadaan Auth User di auth.users & konfirmasi email
    SELECT email_confirmed_at
    INTO v_user_confirmed_at
    FROM auth.users
    WHERE id = v_admin_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Prerequisite Failure: Auth user % does not exist in auth.users. Complete Phase 4 in Dashboard first.', v_admin_user_id;
    END IF;

    IF v_user_confirmed_at IS NULL THEN
        RAISE EXCEPTION 'Prerequisite Failure: Auth user % email is not confirmed. Ensure "Auto Confirm User" was checked during creation in Dashboard.', v_admin_user_id;
    END IF;

    -- 2. Concurrency Protection: Lock baris profile secara eksklusif (FOR UPDATE)
    SELECT id
    INTO v_locked_profile_id
    FROM public.profiles
    WHERE id = v_admin_user_id
    FOR UPDATE;

    IF v_locked_profile_id IS NULL THEN
        RAISE EXCEPTION 'Prerequisite Failure: Profile for user % not found in public.profiles. Verify trigger trg_auth_users_create_profile.', v_admin_user_id;
    END IF;

    -- 3. Resolve tenant_id staging & Validasi Status Harus 'active'
    SELECT id, status
    INTO v_tenant_id, v_tenant_status
    FROM public.tenants
    WHERE code = v_tenant_code AND deleted_at IS NULL;

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Prerequisite Failure: Staging tenant % not found. Execute Script B first.', v_tenant_code;
    END IF;

    IF v_tenant_status <> 'active' THEN
        RAISE EXCEPTION 'Prerequisite Failure: Staging tenant % has status "%". Tenant must be active.', v_tenant_code, v_tenant_status;
    END IF;

    -- 4. Validasi Isolasi: Pastikan user belum terdaftar pada tenant lain mana pun
    IF EXISTS (
        SELECT 1 FROM public.tenant_members
        WHERE user_id = v_admin_user_id AND tenant_id <> v_tenant_id
    ) THEN
        RAISE EXCEPTION 'Security Guard Block: User % already has membership in a different tenant. Cross-tenant admin assignment is strictly prohibited.', v_admin_user_id;
    END IF;

    -- 5. Validasi Duplikasi: Jika membership staging sudah ada, hentikan dan minta pemeriksaan manual
    IF EXISTS (
        SELECT 1 FROM public.tenant_members
        WHERE user_id = v_admin_user_id AND tenant_id = v_tenant_id
    ) THEN
        RAISE EXCEPTION 'Safety Guard Block: Tenant membership for user % already exists in staging tenant %. Automatic activation aborted. Manual inspection required.', v_admin_user_id, v_tenant_code;
    END IF;

    -- 6. Resolve role_id untuk 'ketua_rt'
    SELECT id
    INTO v_ketua_role_id
    FROM public.roles
    WHERE code = 'ketua_rt';

    IF v_ketua_role_id IS NULL THEN
        RAISE EXCEPTION 'Prerequisite Failure: Role ketua_rt not found in public.roles. Execute Script A first.';
    END IF;

    -- 7. Perbarui profile: set active_tenant_id sebagai preferensi UI default
    -- CATATAN KEAMANAN: active_tenant_id HANYA preferensi workspace UI Next.js,
    -- BUKAN sumber otorisasi RLS (RLS divalidasi via has_tenant_role / is_tenant_member).
    UPDATE public.profiles
       SET active_tenant_id = v_tenant_id,
           full_name = COALESCE(NULLIF(trim(full_name), ''), 'Ketua RT Staging')
     WHERE id = v_admin_user_id;

    -- 8. Insert tenant membership baru (resident_id tetap NULL)
    INSERT INTO public.tenant_members (
        id,
        tenant_id,
        user_id,
        resident_id,
        status,
        joined_at
    )
    VALUES (
        gen_random_uuid(),
        v_tenant_id,
        v_admin_user_id,
        NULL,
        'active',
        now()
    )
    RETURNING id INTO v_member_id;

    -- 9. Tetapkan role ketua_rt pada member_roles
    -- MODEL AUDIT: assigned_by diset NULL untuk initial system bootstrap
    -- (tidak merekayasa self-assignment historis), sesuai skema assigned_by uuid NULL.
    -- Validasi role assignment tunggal (member baru tidak boleh memiliki role lain)
    IF EXISTS (
        SELECT 1 FROM public.member_roles
        WHERE member_id = v_member_id
    ) THEN
        RAISE EXCEPTION 'Integrity Failure: Member % already has role assignments. Duplicate role assignment aborted.', v_member_id;
    END IF;

    INSERT INTO public.member_roles (
        id,
        tenant_id,
        member_id,
        role_id,
        assigned_by
    )
    VALUES (
        gen_random_uuid(),
        v_tenant_id,
        v_member_id,
        v_ketua_role_id,
        NULL
    );

    RAISE NOTICE 'Admin user % successfully provisioned as active member of tenant % with role ketua_rt (member_id: %).',
        v_admin_user_id, v_tenant_code, v_member_id;
END $$;

-- Verifikasi keanggotaan dan peran admin
SELECT 
    tm.id AS member_id,
    tm.tenant_id,
    t.code AS tenant_code,
    tm.user_id,
    p.full_name,
    tm.status AS member_status,
    tm.resident_id,
    r.code AS assigned_role,
    mr.assigned_by
FROM public.tenant_members tm
JOIN public.tenants t ON t.id = tm.tenant_id
JOIN public.profiles p ON p.id = tm.user_id
JOIN public.member_roles mr ON mr.member_id = tm.id
JOIN public.roles r ON r.id = mr.role_id
WHERE t.code = 'rt-01-rw-01-staging';

COMMIT;
```

---

## 8. Phase 6 — Verification (READ-ONLY SQL)

> **Status:** `TESTED & VERIFIED READ-ONLY ON POSTGRESQL 17.11`
> **Karakteristik:**
> - Menggunakan placeholder identitas administrator `<AUTH_ADMIN_USER_ID>` eksplisit (bukan `LIMIT 1`).
> - Menghasilkan `overall_status: 'FAIL'` bila UID salah, email belum terkonfirmasi, role bukan `ketua_rt`, atau memiliki role ganda.
> - Tanpa fungsi inkompatibel `min(uuid)` dan tanpa nested subquery aggregates.
> - Menjaga privasi (tanpa menampilkan email pribadi).

```sql
-- =============================================================================
-- SCRIPT D: COMPREHENSIVE READ-ONLY AUDIT & VERIFICATION QUERY (READ-ONLY)
-- =============================================================================
WITH
-- Target Administrator UID dari operator (Ganti placeholder ini sebelum verifikasi)
admin_input AS (
  SELECT '<AUTH_ADMIN_USER_ID>'::uuid AS target_user_id
),

-- 1. Evaluasi Staging Tenant
tenant_data AS (
  SELECT
    id AS tenant_id,
    code,
    name,
    rt_number,
    rw_number,
    kelurahan,
    kecamatan,
    city,
    province,
    status,
    settings->>'letter_number_format' AS letter_format
  FROM public.tenants
  WHERE code = 'rt-01-rw-01-staging' AND deleted_at IS NULL
),
tenant_target AS (
  SELECT tenant_id FROM tenant_data LIMIT 1
),
tenant_eval AS (
  SELECT
    count(*) = 1
    AND bool_and(
      name = 'RT 01 / RW 01 Staging'
      AND rt_number = '01'
      AND rw_number = '01'
      AND kelurahan = 'Kelurahan Simulasi'
      AND kecamatan = 'Kecamatan Simulasi'
      AND city = 'Kota Jakarta Selatan'
      AND province = 'DKI Jakarta'
      AND status = 'active'
      AND letter_format = '{seq}/RT01-RW01/{month}/{year}'
    ) AS is_valid,
    count(*) AS total_tenants
  FROM tenant_data
),

-- 2. Evaluasi Global Roles
roles_eval AS (
  SELECT
    count(*) = 5
    AND bool_and(
      (code = 'ketua_rt' AND name = 'Ketua RT' AND description = 'Penanggung jawab utama operasional dan persetujuan RT') OR
      (code = 'sekretaris' AND name = 'Sekretaris' AND description = 'Pengelola data kependudukan, pengumuman, dan surat pengantar') OR
      (code = 'bendahara' AND name = 'Bendahara' AND description = 'Pengelola iuran, verifikasi pembayaran, dan buku kas RT') OR
      (code = 'pengurus' AND name = 'Pengurus' AND description = 'Pengurus operasional lingkungan, pengaduan, dan kegiatan') OR
      (code = 'warga' AND name = 'Warga' AND description = 'Warga terdaftar pada lingkungan RT')
    ) AS is_valid,
    count(*) AS total_roles,
    coalesce(jsonb_agg(code ORDER BY code), '[]'::jsonb) AS role_codes
  FROM public.roles
),

-- 3. Evaluasi Cash Categories (Strict: 6 expected, 0 unexpected)
categories_data AS (
  SELECT cc.id, cc.name, cc.type, cc.is_active
  FROM public.cash_categories cc
  WHERE cc.tenant_id IN (SELECT tenant_id FROM tenant_target)
),
categories_eval AS (
  SELECT
    count(*) = 6
    AND bool_and(is_active IS TRUE)
    AND bool_and(
      (name = 'Iuran Bulanan Warga' AND type = 'income') OR
      (name = 'Sumbangan & Donasi' AND type = 'income') OR
      (name = 'Kebersihan & Pengelolaan Sampah' AND type = 'expense') OR
      (name = 'Keamanan & Penerangan' AND type = 'expense') OR
      (name = 'Operasional & Kegiatan RT' AND type = 'expense') OR
      (name = 'Pengembalian Dana (Refund)' AND type = 'expense')
    )
    AND count(*) FILTER (
      WHERE (name, type) NOT IN (
        ('Iuran Bulanan Warga', 'income'),
        ('Sumbangan & Donasi', 'income'),
        ('Kebersihan & Pengelolaan Sampah', 'expense'),
        ('Keamanan & Penerangan', 'expense'),
        ('Operasional & Kegiatan RT', 'expense'),
        ('Pengembalian Dana (Refund)', 'expense')
      )
    ) = 0 AS is_valid,
    count(*) AS total_categories
  FROM categories_data
),

-- 4. Evaluasi Letter Types (Strict: 3 expected, 0 unexpected)
letters_data AS (
  SELECT lt.id, lt.code, lt.name, lt.description, lt.required_documents, lt.is_active
  FROM public.letter_types lt
  WHERE lt.tenant_id IN (SELECT tenant_id FROM tenant_target)
),
letters_eval AS (
  SELECT
    count(*) = 3
    AND bool_and(is_active IS TRUE)
    AND bool_and(
      (code = 'DOMISILI' AND name = 'Surat Pengantar Domisili' AND description = 'Surat keterangan domisili warga di lingkungan RT staging' AND required_documents = '["Fotokopi KTP", "Fotokopi KK"]'::jsonb) OR
      (code = 'PENGANTAR_KTP' AND name = 'Surat Pengantar Pembuatan / Perpanjangan KTP' AND description = 'Pengantar administrasi kependudukan ke kelurahan' AND required_documents = '["Fotokopi KK"]'::jsonb) OR
      (code = 'SKTM' AND name = 'Surat Keterangan Tidak Mampu' AND description = 'Pengantar pengurusan keringanan pendidikan atau kesehatan' AND required_documents = '["Fotokopi KTP", "Fotokopi KK"]'::jsonb)
    )
    AND count(*) FILTER (
      WHERE code NOT IN ('DOMISILI', 'PENGANTAR_KTP', 'SKTM')
    ) = 0 AS is_valid,
    count(*) AS total_letter_types
  FROM letters_data
),

-- 5. Evaluasi Exact Administrator Auth, Profile & Staging Membership
admin_exact_data AS (
  SELECT
    ai.target_user_id,
    u.id AS auth_user_id,
    u.email_confirmed_at,
    p.id AS profile_id,
    p.active_tenant_id,
    p.full_name,
    tm.id AS member_id,
    tm.tenant_id AS member_tenant_id,
    tm.status AS member_status,
    tm.resident_id
  FROM admin_input ai
  LEFT JOIN auth.users u ON u.id = ai.target_user_id
  LEFT JOIN public.profiles p ON p.id = ai.target_user_id
  LEFT JOIN public.tenant_members tm ON tm.user_id = ai.target_user_id AND tm.tenant_id IN (SELECT tenant_id FROM tenant_target)
),
admin_membership_eval AS (
  SELECT
    count(aed.member_id) = 1
    AND bool_and(
      aed.auth_user_id IS NOT NULL
      AND aed.profile_id IS NOT NULL
      AND aed.email_confirmed_at IS NOT NULL
      AND aed.member_status = 'active'
      AND aed.resident_id IS NULL
      AND aed.active_tenant_id = (SELECT tenant_id FROM tenant_target)
    ) AS is_valid,
    bool_and(aed.auth_user_id IS NOT NULL) AS auth_user_exists,
    bool_and(aed.email_confirmed_at IS NOT NULL) AS email_is_confirmed,
    count(aed.member_id) AS staging_memberships_count
  FROM admin_exact_data aed
),

-- 6. Evaluasi Role Assignment untuk Exact Administrator (Tepat 1 role: ketua_rt)
admin_roles_data AS (
  SELECT mr.id, mr.member_id, r.code AS role_code
  FROM public.member_roles mr
  JOIN admin_exact_data aed ON aed.member_id = mr.member_id
  JOIN public.roles r ON r.id = mr.role_id
),
admin_roles_eval AS (
  SELECT
    count(*) = 1
    AND bool_and(role_code = 'ketua_rt') AS is_valid,
    count(*) AS total_assigned_roles,
    coalesce(jsonb_agg(role_code), '[]'::jsonb) AS assigned_roles
  FROM admin_roles_data
),

-- 7. Evaluasi Cross-Tenant Isolation untuk Exact Administrator
isolation_eval AS (
  SELECT
    count(*) = 0 AS is_valid,
    count(*) AS cross_tenant_memberships_count
  FROM public.tenant_members tm
  JOIN admin_input ai ON ai.target_user_id = tm.user_id
  WHERE tm.tenant_id NOT IN (SELECT tenant_id FROM tenant_target)
),

-- 8. Evaluasi RLS Integrity (Tepat 33 tabel, 0 unsecured)
rls_eval AS (
  SELECT
    count(*) FILTER (WHERE c.relrowsecurity IS TRUE) = 33
    AND count(*) FILTER (WHERE c.relrowsecurity IS NOT TRUE) = 0 AS is_valid,
    count(*) FILTER (WHERE c.relrowsecurity IS TRUE) AS total_secured_tables,
    count(*) FILTER (WHERE c.relrowsecurity IS NOT TRUE) AS total_unsecured_tables,
    coalesce(jsonb_agg(c.relname) FILTER (WHERE c.relrowsecurity IS NOT TRUE), '[]'::jsonb) AS unsecured_tables
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
)

SELECT jsonb_build_object(
  'overall_status', CASE
    WHEN coalesce((SELECT is_valid FROM tenant_eval), false)
     AND coalesce((SELECT is_valid FROM roles_eval), false)
     AND coalesce((SELECT is_valid FROM categories_eval), false)
     AND coalesce((SELECT is_valid FROM letters_eval), false)
     AND coalesce((SELECT is_valid FROM admin_membership_eval), false)
     AND coalesce((SELECT is_valid FROM admin_roles_eval), false)
     AND coalesce((SELECT is_valid FROM isolation_eval), false)
     AND coalesce((SELECT is_valid FROM rls_eval), false)
    THEN 'PASS'
    ELSE 'FAIL'
  END,
  'tenant_check', (SELECT jsonb_build_object('status', CASE WHEN coalesce(is_valid, false) THEN 'PASS' ELSE 'FAIL' END, 'total', total_tenants) FROM tenant_eval),
  'roles_check', (SELECT jsonb_build_object('status', CASE WHEN coalesce(is_valid, false) THEN 'PASS' ELSE 'FAIL' END, 'total', total_roles, 'codes', role_codes) FROM roles_eval),
  'cash_categories_check', (SELECT jsonb_build_object('status', CASE WHEN coalesce(is_valid, false) THEN 'PASS' ELSE 'FAIL' END, 'total', total_categories) FROM categories_eval),
  'letter_types_check', (SELECT jsonb_build_object('status', CASE WHEN coalesce(is_valid, false) THEN 'PASS' ELSE 'FAIL' END, 'total', total_letter_types) FROM letters_eval),
  'admin_identity_check', (SELECT jsonb_build_object('status', CASE WHEN coalesce(is_valid, false) THEN 'PASS' ELSE 'FAIL' END, 'auth_user_exists', auth_user_exists, 'email_confirmed', email_is_confirmed, 'staging_memberships', staging_memberships_count) FROM admin_membership_eval),
  'admin_roles_check', (SELECT jsonb_build_object('status', CASE WHEN coalesce(is_valid, false) THEN 'PASS' ELSE 'FAIL' END, 'total', total_assigned_roles, 'roles', assigned_roles) FROM admin_roles_eval),
  'isolation_check', (SELECT jsonb_build_object('status', CASE WHEN coalesce(is_valid, false) THEN 'PASS' ELSE 'FAIL' END, 'cross_memberships', cross_tenant_memberships_count) FROM isolation_eval),
  'rls_check', (SELECT jsonb_build_object('status', CASE WHEN coalesce(is_valid, false) THEN 'PASS' ELSE 'FAIL' END, 'secured_count', total_secured_tables, 'unsecured_count', total_unsecured_tables, 'unsecured_tables', unsecured_tables) FROM rls_eval)
) AS verification_report;
```

---

## 9. Rollback & Compensation Procedures

### 9.1 Kebijakan Kompensasi Defensif
1. **Dilarang Mass-Delete terhadap `public.roles`:** Katalog global role tidak boleh dihapus massal.
2. **Dilarang Menghapus Tenant Secara Otomatis:** Perintah `DELETE FROM public.tenants` dihapus dari paket. Digantikan oleh *Read-Only Dependency Audit* 30 tabel.
3. **Wajib Identitas Eksplisit:** Kompensasi keanggotaan wajib menerima parameter `<AUTH_ADMIN_USER_ID>` spesifik tanpa `LIMIT 1` acak.
4. **Exact Role Assignment Guard & Row Count Assertion:** Sebelum penghapusan role atau keanggotaan, wajib memvalidasi bahwa membership memiliki tepat satu role assignment (`count(*) = 1`) dan role tersebut adalah `'ketua_rt'` tanpa agregasi UUID `min(uuid)`. Penghapusan peran menggunakan primary key spesifik (`id = v_target_member_role_id`) dan diverifikasi dengan `GET DIAGNOSTICS ... = ROW_COUNT` (tepat 1 baris) sebelum melanjutkan ke penghapusan keanggotaan (juga diverifikasi tepat 1 baris).
5. **Audit Dependensi Lengkap (17 Relasi Domain):** Memeriksa seluruh 17 relasi foreign key domain dari katalog PostgreSQL; abort jika ditemukan dependensi transaksi/audit.
6. **Tidak Menghapus Auth User atau Audit History:** Kompensasi database hanya membersihkan keanggotaan tenant; akun Auth dikelola manual via Dashboard. Profil pengguna tidak dihapus, hanya kolom `active_tenant_id` yang direset jika merujuk tenant staging.

### 9.2 Prosedur Kompensasi Bertahap

#### Kompensasi Tahap C (Hapus Membership & Role Administrator Spesifik):
Dijalankan jika penugasan keanggotaan admin salah dan belum ada transaksi:
```sql
-- =============================================================================
-- KOMPENSASI TAHAP C: Hapus membership & role admin staging tertentu secara aman
-- Dilengkapi Exact Role Assignment Guard & Audit 17 Relasi Foreign Key
-- =============================================================================
BEGIN;

DO $$
DECLARE
    -- Wajib menentukan UUID user admin staging secara eksplisit:
    v_target_admin_user_id uuid := '<AUTH_ADMIN_USER_ID>'::uuid;
    v_tenant_code text := 'rt-01-rw-01-staging';
    v_tenant_id uuid;
    v_member_id uuid;
    v_role_count integer;
    v_assigned_role_code text;
    v_target_member_role_id uuid;
    v_dependency_count integer;
    v_deleted_role_count integer;
    v_deleted_member_count integer;
BEGIN
    -- 1. Validasi tenant staging
    SELECT id INTO v_tenant_id
    FROM public.tenants
    WHERE code = v_tenant_code AND deleted_at IS NULL;

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Target tenant % not found. Cannot proceed with compensation.', v_tenant_code;
    END IF;

    -- 2. Validasi keanggotaan spesifik milik user yang dimaksud pada tenant staging
    SELECT id INTO v_member_id
    FROM public.tenant_members
    WHERE tenant_id = v_tenant_id
      AND user_id = v_target_admin_user_id;

    IF v_member_id IS NULL THEN
        RAISE EXCEPTION 'Member for user % in tenant % not found. Compensation aborted.',
            v_target_admin_user_id, v_tenant_code;
    END IF;

    -- 3. Exact Role Assignment Guard: Validasi jumlah dan tipe peran sebelum penghapusan
    -- Langkah 1: Hitung jumlah role assignment menggunakan count(*)
    SELECT count(*)
    INTO v_role_count
    FROM public.member_roles
    WHERE tenant_id = v_tenant_id
      AND member_id = v_member_id;

    -- Langkah 2: Batalkan transaksi jika tidak tepat satu role assignment
    IF v_role_count = 0 THEN
        RAISE EXCEPTION 'Exact Role Guard Block: Member % in tenant % has no role assignments. Exactly one ketua_rt role expected. Compensation aborted.',
            v_member_id, v_tenant_code;
    END IF;

    IF v_role_count > 1 THEN
        RAISE EXCEPTION 'Exact Role Guard Block: Member % in tenant % has % role assignments (> 1). Expected exactly one ketua_rt role. Manual inspection required.',
            v_member_id, v_tenant_code, v_role_count;
    END IF;

    -- Langkah 3: Ambil UUID dan kode peran spesifik via SELECT terpisah (tanpa agregasi UUID)
    SELECT mr.id, r.code
    INTO v_target_member_role_id, v_assigned_role_code
    FROM public.member_roles mr
    JOIN public.roles r ON r.id = mr.role_id
    WHERE mr.tenant_id = v_tenant_id
      AND mr.member_id = v_member_id;

    -- Langkah 4: Batalkan transaksi kecuali kodenya adalah ketua_rt
    IF v_assigned_role_code <> 'ketua_rt' THEN
        RAISE EXCEPTION 'Exact Role Guard Block: Member % in tenant % has unexpected role "%". Expected strictly "ketua_rt". Compensation aborted.',
            v_member_id, v_tenant_code, v_assigned_role_code;
    END IF;

    -- 4. Audit Dependensi Menyeluruh (17 Relasi FK Domain & Audit)
    SELECT (
      (SELECT count(*) FROM public.complaint_replies WHERE tenant_id = v_tenant_id AND author_member_id = v_member_id) +
      (SELECT count(*) FROM public.complaint_status_history WHERE tenant_id = v_tenant_id AND changed_by_member_id = v_member_id) +
      (SELECT count(*) FROM public.complaints WHERE tenant_id = v_tenant_id AND reporter_member_id = v_member_id) +
      (SELECT count(*) FROM public.letter_requests WHERE tenant_id = v_tenant_id AND (requested_by_member_id = v_member_id OR reviewed_by = v_target_admin_user_id)) +
      (SELECT count(*) FROM public.notifications WHERE tenant_id = v_tenant_id AND recipient_user_id = v_target_admin_user_id) +
      (SELECT count(*) FROM public.activities WHERE tenant_id = v_tenant_id AND (created_by = v_target_admin_user_id OR updated_by = v_target_admin_user_id OR cancelled_by = v_target_admin_user_id)) +
      (SELECT count(*) FROM public.activity_participants WHERE recorded_by = v_target_admin_user_id) +
      (SELECT count(*) FROM public.announcements WHERE tenant_id = v_tenant_id AND author_id = v_target_admin_user_id) +
      (SELECT count(*) FROM public.cash_transactions WHERE tenant_id = v_tenant_id AND created_by = v_target_admin_user_id) +
      (SELECT count(*) FROM public.payments WHERE tenant_id = v_tenant_id AND (paid_by_user_id = v_target_admin_user_id OR verified_by = v_target_admin_user_id)) +
      (SELECT count(*) FROM public.resident_documents WHERE tenant_id = v_tenant_id AND verified_by = v_target_admin_user_id) +
      (SELECT count(*) FROM public.resident_invitations WHERE tenant_id = v_tenant_id AND (invited_by = v_target_admin_user_id OR redeemed_by = v_target_admin_user_id OR revoked_by = v_target_admin_user_id)) +
      (SELECT count(*) FROM public.ronda_assignments WHERE tenant_id = v_tenant_id AND (created_by = v_target_admin_user_id OR attendance_recorded_by = v_target_admin_user_id)) +
      (SELECT count(*) FROM public.ronda_schedules WHERE tenant_id = v_tenant_id AND (created_by = v_target_admin_user_id OR updated_by = v_target_admin_user_id)) +
      (SELECT count(*) FROM public.storage_deletion_queue WHERE tenant_id = v_tenant_id AND requested_by = v_target_admin_user_id) +
      (SELECT count(*) FROM public.audit_logs WHERE tenant_id = v_tenant_id AND actor_user_id = v_target_admin_user_id)
    ) INTO v_dependency_count;

    IF v_dependency_count > 0 THEN
        RAISE EXCEPTION 'Safety Guard Block: Cannot remove membership for user % (member_id: %). Found % active dependency/transaction records across 17 relations. Compensation aborted.',
            v_target_admin_user_id, v_member_id, v_dependency_count;
    END IF;

    -- 5. Hapus role ketua_rt yang telah terverifikasi secara spesifik (berdasarkan v_target_member_role_id)
    DELETE FROM public.member_roles
    WHERE id = v_target_member_role_id
      AND tenant_id = v_tenant_id
      AND member_id = v_member_id;

    -- Langkah 6a: Periksa affected row count untuk penghapusan role (harus tepat 1 baris)
    GET DIAGNOSTICS v_deleted_role_count = ROW_COUNT;
    IF v_deleted_role_count <> 1 THEN
        RAISE EXCEPTION 'Safety Guard Block: Expected exactly 1 role deletion for role id %, but % rows were affected. Transaction aborted.',
            v_target_member_role_id, v_deleted_role_count;
    END IF;

    -- 6. Hapus keanggotaan spesifik milik user tersebut
    DELETE FROM public.tenant_members
    WHERE id = v_member_id
      AND tenant_id = v_tenant_id
      AND user_id = v_target_admin_user_id;

    -- Langkah 6b: Periksa affected row count untuk penghapusan keanggotaan (harus tepat 1 baris)
    GET DIAGNOSTICS v_deleted_member_count = ROW_COUNT;
    IF v_deleted_member_count <> 1 THEN
        RAISE EXCEPTION 'Safety Guard Block: Expected exactly 1 member deletion for member id %, but % rows were affected. Transaction aborted.',
            v_member_id, v_deleted_member_count;
    END IF;

    -- 7. Reset preferensi active_tenant_id pada profil
    UPDATE public.profiles
       SET active_tenant_id = NULL
     WHERE id = v_target_admin_user_id AND active_tenant_id = v_tenant_id;

    RAISE NOTICE 'Compensation Stage C successful: Verified ketua_rt role (id: %) and member (id: %) for user % in tenant % successfully deleted.',
        v_target_member_role_id, v_member_id, v_target_admin_user_id, v_tenant_code;
END $$;

COMMIT;
```

#### Kompensasi Tahap B (Complete 30-Table Read-Only Dependency Audit):
Tidak menjalankan DELETE otomatis terhadap tenant atau referensinya. Menjalankan query audit menyeluruh terhadap ke-30 tabel yang mereferensikan `public.tenants`:
```sql
-- =============================================================================
-- KOMPENSASI TAHAP B: COMPLETE 30-TABLE READ-ONLY DEPENDENCY AUDIT (TIDAK MELAKUKAN DELETE)
-- CATATAN: Hasil audit read-only ini TIDAK otomatis mengotorisasi penghapusan tenant.
-- Penghapusan tenant staging membutuhkan persetujuan dan prosedur DDL/DML terpisah.
-- =============================================================================
SELECT jsonb_build_object(
  'tenant_code', t.code,
  'tenant_id', t.id,
  'dependencies_inventory_count', 30,
  'dependencies_inventory', jsonb_build_object(
    'activities', (SELECT count(*) FROM public.activities WHERE tenant_id = t.id),
    'activity_participants', (SELECT count(*) FROM public.activity_participants WHERE tenant_id = t.id),
    'announcements', (SELECT count(*) FROM public.announcements WHERE tenant_id = t.id),
    'announcement_recipients', (SELECT count(*) FROM public.announcement_recipients WHERE tenant_id = t.id),
    'audit_logs', (SELECT count(*) FROM public.audit_logs WHERE tenant_id = t.id),
    'bills', (SELECT count(*) FROM public.bills WHERE tenant_id = t.id),
    'cash_categories', (SELECT count(*) FROM public.cash_categories WHERE tenant_id = t.id),
    'cash_transactions', (SELECT count(*) FROM public.cash_transactions WHERE tenant_id = t.id),
    'complaints', (SELECT count(*) FROM public.complaints WHERE tenant_id = t.id),
    'complaint_replies', (SELECT count(*) FROM public.complaint_replies WHERE tenant_id = t.id),
    'complaint_status_history', (SELECT count(*) FROM public.complaint_status_history WHERE tenant_id = t.id),
    'dues', (SELECT count(*) FROM public.dues WHERE tenant_id = t.id),
    'households', (SELECT count(*) FROM public.households WHERE tenant_id = t.id),
    'letter_requests', (SELECT count(*) FROM public.letter_requests WHERE tenant_id = t.id),
    'letter_sequences', (SELECT count(*) FROM public.letter_sequences WHERE tenant_id = t.id),
    'letter_types', (SELECT count(*) FROM public.letter_types WHERE tenant_id = t.id),
    'member_roles', (SELECT count(*) FROM public.member_roles WHERE tenant_id = t.id),
    'notifications', (SELECT count(*) FROM public.notifications WHERE tenant_id = t.id),
    'payment_webhook_events', (SELECT count(*) FROM public.payment_webhook_events WHERE tenant_id = t.id),
    'payments', (SELECT count(*) FROM public.payments WHERE tenant_id = t.id),
    'profiles_active', (SELECT count(*) FROM public.profiles WHERE active_tenant_id = t.id),
    'resident_documents', (SELECT count(*) FROM public.resident_documents WHERE tenant_id = t.id),
    'resident_invitations', (SELECT count(*) FROM public.resident_invitations WHERE tenant_id = t.id),
    'resident_private_data', (SELECT count(*) FROM public.resident_private_data WHERE tenant_id = t.id),
    'residents', (SELECT count(*) FROM public.residents WHERE tenant_id = t.id),
    'ronda_assignments', (SELECT count(*) FROM public.ronda_assignments WHERE tenant_id = t.id),
    'ronda_schedules', (SELECT count(*) FROM public.ronda_schedules WHERE tenant_id = t.id),
    'storage_deletion_queue', (SELECT count(*) FROM public.storage_deletion_queue WHERE tenant_id = t.id),
    'tenant_members', (SELECT count(*) FROM public.tenant_members WHERE tenant_id = t.id),
    'vehicles', (SELECT count(*) FROM public.vehicles WHERE tenant_id = t.id)
  ),
  'no_checked_dependencies_found', (
    SELECT (count(*) = 0) FROM (
      SELECT 1 FROM public.activities WHERE tenant_id = t.id
      UNION ALL SELECT 1 FROM public.activity_participants WHERE tenant_id = t.id
      UNION ALL SELECT 1 FROM public.announcements WHERE tenant_id = t.id
      UNION ALL SELECT 1 FROM public.announcement_recipients WHERE tenant_id = t.id
      UNION ALL SELECT 1 FROM public.audit_logs WHERE tenant_id = t.id
      UNION ALL SELECT 1 FROM public.bills WHERE tenant_id = t.id
      UNION ALL SELECT 1 FROM public.cash_categories WHERE tenant_id = t.id
      UNION ALL SELECT 1 FROM public.cash_transactions WHERE tenant_id = t.id
      UNION ALL SELECT 1 FROM public.complaints WHERE tenant_id = t.id
      UNION ALL SELECT 1 FROM public.complaint_replies WHERE tenant_id = t.id
      UNION ALL SELECT 1 FROM public.complaint_status_history WHERE tenant_id = t.id
      UNION ALL SELECT 1 FROM public.dues WHERE tenant_id = t.id
      UNION ALL SELECT 1 FROM public.households WHERE tenant_id = t.id
      UNION ALL SELECT 1 FROM public.letter_requests WHERE tenant_id = t.id
      UNION ALL SELECT 1 FROM public.letter_sequences WHERE tenant_id = t.id
      UNION ALL SELECT 1 FROM public.letter_types WHERE tenant_id = t.id
      UNION ALL SELECT 1 FROM public.member_roles WHERE tenant_id = t.id
      UNION ALL SELECT 1 FROM public.notifications WHERE tenant_id = t.id
      UNION ALL SELECT 1 FROM public.payment_webhook_events WHERE tenant_id = t.id
      UNION ALL SELECT 1 FROM public.payments WHERE tenant_id = t.id
      UNION ALL SELECT 1 FROM public.profiles WHERE active_tenant_id = t.id
      UNION ALL SELECT 1 FROM public.resident_documents WHERE tenant_id = t.id
      UNION ALL SELECT 1 FROM public.resident_invitations WHERE tenant_id = t.id
      UNION ALL SELECT 1 FROM public.resident_private_data WHERE tenant_id = t.id
      UNION ALL SELECT 1 FROM public.residents WHERE tenant_id = t.id
      UNION ALL SELECT 1 FROM public.ronda_assignments WHERE tenant_id = t.id
      UNION ALL SELECT 1 FROM public.ronda_schedules WHERE tenant_id = t.id
      UNION ALL SELECT 1 FROM public.storage_deletion_queue WHERE tenant_id = t.id
      UNION ALL SELECT 1 FROM public.tenant_members WHERE tenant_id = t.id
      UNION ALL SELECT 1 FROM public.vehicles WHERE tenant_id = t.id
    ) all_30_tables
  )
) AS tenant_dependency_audit
FROM public.tenants t
WHERE t.code = 'rt-01-rw-01-staging' AND t.deleted_at IS NULL;
```

#### Kompensasi Tahap A (User Auth):
Hanya dilakukan secara manual via **Supabase Dashboard -> Authentication -> Users -> Delete User**.
*(CATATAN: Penghapusan user Auth memicu cascade delete terhadap `public.profiles`. Jangan menghapus akun jika masih terhubung dengan data transaksi di database).*

---

## 10. Daftar Risiko & Mitigasi

| Risiko Potensial | Tingkat | Mitigasi yang Ditetapkan |
|---|---|---|
| **Eksekusi Konkuren / Race Condition** | Sedang | Advisory transaction locks pada Script B & Script C, plus exclusive row lock `FOR UPDATE` pada baris profile. |
| **Silent Corruption pada Kategori Kas** | Sedang | Hitung baris per nama (`count > 1` abort), validasi tipe dan status aktif, serta periksa ketiadaan kategori ekstra. |
| **Identitas Administrator Salah** | Tinggi | Script D memvalidasi exact administrator UID (`<AUTH_ADMIN_USER_ID>`) dan menghasilkan `FAIL` bila salah/tidak cocok. |
| **Penghapusan Role yang Tidak Sesuai** | Tinggi | Kompensasi C memvalidasi membership memiliki tepat satu role `'ketua_rt'` sebelum menghapus baris. |
| **Klaim Audit Dependensi Parsial** | Sedang | Kompensasi B memeriksa seluruh 30 tabel FK tenant satu-lawan-satu di dalam `UNION ALL`. |

---

## 11. Status Akhir

- **Status Paket:** **`PASS — READY FOR FINAL OPERATOR APPROVAL`**
- **Tindakan Saat Ini:** **BERHENTI.** Menunggu review dan persetujuan eksplisit operator.
