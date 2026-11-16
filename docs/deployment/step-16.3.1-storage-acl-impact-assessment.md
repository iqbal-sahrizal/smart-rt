# Smart RT — Step 16.3.1: Storage ACL Impact Assessment (`STG-01`)

**Tanggal:** 2026-11-16  
**Target Project:** `smart-rt-staging` (`szghujzhiyndeuhepsax`, `ap-southeast-1`)  
**PostgreSQL Remote:** `PostgreSQL 17.11` (`supautils 4.0.0`)  
**Status Akhir:** **`PASS WITH WARNINGS`**

> **Mode Investigasi (Read-Only Only):** Seluruh pemeriksaan pada remote `szghujzhiyndeuhepsax` dijalankan melalui `npx supabase db query --remote=szghujzhiyndeuhepsax --read-only` (user `supabase_read_only_user`). Tidak ada `db push`, tidak ada perubahan ACL/grants/policies/ownership/schema/data, dan tidak ada modifikasi pada file migrasi lama.

---

## 1. Audit ACL Aktual (`storage.buckets` & `storage.objects`)

### 1.1 Bukti SQL Read-Only yang Dijalankan

Query read-only dijalankan terhadap `pg_class`, `pg_namespace`, `pg_roles`, `pg_auth_members`, `aclexplode(c.relacl)`, `information_schema.role_table_grants`, `has_table_privilege`, `pg_policies`, `pg_default_acl`, dan `pg_trigger` (dengan koneksi read-only `supabase_read_only_user`).

### 1.2 Kepemilikan & Keanggotaan Role

| Objek / Role | Nilai Terverifikasi di Remote (`szghujzhiyndeuhepsax`) |
|---|---|
| Owner `storage.buckets` | `supabase_storage_admin` (`rolsuper = false`, `rolbypassrls = false`) |
| Owner `storage.objects` | `supabase_storage_admin` (`rolsuper = false`, `rolbypassrls = false`) |
| `postgres` `rolsuper` / `rolbypassrls` | `rolsuper = false`, `rolbypassrls = true` |
| `postgres` member of | `anon`, `authenticated`, `authenticator`, `pg_create_subscription`, `pg_monitor`, `pg_read_all_data`, `pg_signal_backend`, `service_role`, `supabase_privileged_role`, `pg_database_owner` |
| `postgres` member of `supabase_storage_admin`? | **Tidak (`false`)** (`supabase_storage_admin` termasuk `supautils.reserved_memberships` dan `supautils.reserved_roles`) |

### 1.3 Privilege Efektif & Grantor (`aclexplode` + `has_table_privilege`)

> Catatan teknis: `information_schema.role_table_grants` mengembalikan `[]` saat dieksekusi sebagai `supabase_read_only_user` karena filter visibilitas role SQL standar; hasil lengkap diperoleh langsung dari `pg_class.relacl` (`aclexplode`) dan `has_table_privilege(role, table, priv)`.

**Tabel `storage.buckets`:**
`relacl` = `{supabase_storage_admin=a*r*w*d*D*x*t*m*/supabase_storage_admin, service_role=arwdDxtm/supabase_storage_admin, authenticated=arwd/supabase_storage_admin, anon=arwd/supabase_storage_admin, postgres=a*r*w*d*D*x*t*m*/supabase_storage_admin}`

| Role | `SELECT` | `INSERT` | `UPDATE` | `DELETE` | `TRUNCATE` | `REFERENCES` | `TRIGGER` | `MAINTAIN` | Grantor | `is_grantable` |
|---|---|---|---|---|---|---|---|---|---|---|
| `anon` | Ya | Ya | Ya | Ya | Tidak | Tidak | Tidak | Tidak | `supabase_storage_admin` | Tidak (`false`) |
| `authenticated` | Ya | Ya | Ya | Ya | Tidak | Tidak | Tidak | Tidak | `supabase_storage_admin` | Tidak (`false`) |
| `service_role` | Ya | Ya | Ya | Ya | Ya | Ya | Ya | Ya | `supabase_storage_admin` | Tidak (`false`) |
| `postgres` | Ya | Ya | Ya | Ya | Ya | Ya | Ya | Ya | `supabase_storage_admin` | Ya (`true` / `*`) |

**Tabel `storage.objects`:**
`relacl` = `{supabase_storage_admin=a*r*w*d*D*x*t*m*/supabase_storage_admin, service_role=arwdDxtm/supabase_storage_admin, authenticated=arwd/supabase_storage_admin, anon=arwd/supabase_storage_admin, postgres=a*r*w*d*D*x*t*m*/supabase_storage_admin}`

| Role | `SELECT` | `INSERT` | `UPDATE` | `DELETE` | `TRUNCATE` | `REFERENCES` | `TRIGGER` | `MAINTAIN` | Grantor | `is_grantable` |
|---|---|---|---|---|---|---|---|---|---|---|
| `anon` | Ya | Ya | Ya | Ya | Tidak | Tidak | Tidak | Tidak | `supabase_storage_admin` | Tidak (`false`) |
| `authenticated` | Ya | Ya | Ya | Ya | Tidak | Tidak | Tidak | Tidak | `supabase_storage_admin` | Tidak (`false`) |
| `service_role` | Ya | Ya | Ya | Ya | Ya | Ya | Ya | Ya | `supabase_storage_admin` | Tidak (`false`) |
| `postgres` | Ya | Ya | Ya | Ya | Ya | Ya | Ya | Ya | `supabase_storage_admin` | Ya (`true` / `*`) |

### 1.4 Analisis Kemampuan `REVOKE` pada Migration `0015`

Di [20261114001500_storage_and_atomic_rpcs.sql](file:///Users/iqbalsahrizal/Documents/CODING/Personal%20Project/smart-rt/supabase/migrations/20261114001500_storage_and_atomic_rpcs.sql#L42-L44):
```sql
REVOKE ALL ON storage.buckets FROM anon;
REVOKE ALL ON storage.objects FROM anon;
REVOKE UPDATE, DELETE ON storage.objects FROM authenticated;
```

- **Apakah `postgres` bisa mencabut privilege yang diberikan `supabase_storage_admin`?** **Tidak.** Dalam PostgreSQL 17, `REVOKE` hanya mencabut ACL yang di-grant oleh `current_user` (atau role yang anggotanya mencakup `current_user`), atau oleh owner/superuser. Role `postgres` bukan superuser (`rolsuper = false`), bukan owner `storage.buckets`/`storage.objects`, dan bukan anggota `supabase_storage_admin`. Hak `WITH GRANT OPTION` (`a*r*w*...`) hanya mengizinkan `postgres` memberi atau mencabut grant yang dibuat oleh `postgres` sendiri—bukan milik `supabase_storage_admin`.
- **Apakah `REVOKE ALL` pada Migration `0015` akan benar-benar mengubah ACL?** **Tidak.** PostgreSQL akan mengeluarkan `WARNING: no privileges could be revoked for "buckets"` / `"objects"` (non-fatal, transaksi tetap lanjut), sementara ACL tabel `anon=arwd/supabase_storage_admin` dan `authenticated=arwd/supabase_storage_admin` pada kedua tabel akan **tetap identik seperti sebelum migrasi**.

---

## 2. Audit RLS Aktual & Kemampuan Akses Tiap Role (Kondisi Saat Ini)

### 2.1 Status RLS & Policy Remote Saat Ini

| Tabel | `relrowsecurity` | `relforcerowsecurity` | Jumlah Policy Saat Ini (`pg_policies`) | Trigger Proteksi Bawaan Terpasang |
|---|---|---|---|---|
| `storage.buckets` | `true` | `false` | **`0`** | `protect_buckets_delete`, `protect_bucket_control_insert/update*`, `enforce_versioning_status_transition`, dll. |
| `storage.objects` | `true` | `false` | **`0`** | `protect_objects_delete`, `update_objects_updated_at` |

### 2.2 Analisis Akses Aktual Sebelum Migrasi (ACL × `rolbypassrls` × RLS)

| Role | `rolbypassrls` | Lolos Table ACL? | Evaluasi RLS (`storage.buckets` & `storage.objects`) | Kemampuan Efektif Saat Ini (`SELECT` / `INSERT` / `UPDATE` / `DELETE`) |
|---|---|---|---|---|
| `anon` | `false` | Ya (`arwd`) | RLS aktif, **`0` policy** → **Default DENY** | **Tidak bisa** membaca, memasukkan, mengubah, atau menghapus baris apa pun (0 baris terlihat, write gagal error `42501` RLS violation). |
| `authenticated` | `false` | Ya (`arwd`) | RLS aktif, **`0` policy** → **Default DENY** | **Tidak bisa** membaca, memasukkan, mengubah, atau menghapus baris apa pun. |
| `service_role` | `true` | Ya (`arwdDxtm`) | **Bypass RLS** | Bisa `SELECT`, `INSERT`, `UPDATE`, `DELETE` (catatan: `protect_buckets_delete` / `protect_objects_delete` memblokir `DELETE` langsung melalui SQL di luar Storage API kecuali kondisi trigger Storage terpenuhi). |
| `postgres` | `true` | Ya (`arwdDxtm`) | **Bypass RLS** | Bisa `SELECT`, `INSERT`, `UPDATE`, `DELETE` (tetap tunduk pada trigger seperti `protect_bucket_control_insert` yang sudah diverifikasi aman bila kolom lifecycle `NULL`). |

> **Mengapa RLS tidak boleh dianggap otomatis menggantikan ACL:** Jika di kemudian hari ada perubahan skema/policy yang keliru (mis. membuat policy `TO anon` / `TO public`, atau membuka `FOR UPDATE`/`FOR DELETE` untuk `authenticated`), table-level ACL (`anon=arwd`, `authenticated=arwd`) tidak lagi menjadi lapisan penolak pertama sebelum evaluasi RLS.

---

## 3. Simulasi Kondisi Setelah Migrasi (`0015` & `0023`)

Berdasarkan pemeriksaan kode aktual [20261114001500_storage_and_atomic_rpcs.sql](file:///Users/iqbalsahrizal/Documents/CODING/Personal%20Project/smart-rt/supabase/migrations/20261114001500_storage_and_atomic_rpcs.sql#L469-L754), [20261116002300_activities_security_gap_closure.sql](file:///Users/iqbalsahrizal/Documents/CODING/Personal%20Project/smart-rt/supabase/migrations/20261116002300_activities_security_gap_closure.sql#L428-L469), serta helper RLS di [20261113001000_harden_privileges_and_rls_helpers.sql](file:///Users/iqbalsahrizal/Documents/CODING/Personal%20Project/smart-rt/supabase/migrations/20261113001000_harden_privileges_and_rls_helpers.sql#L187-L308) dan kondisi `supautils.policy_grants` remote:

### 3.1 Perbandingan ACL Sebelum vs Sesudah Migrasi

| Aspek | Kondisi Saat Ini (Pre-Migration) | Kondisi Diperkirakan Pasca-Migrasi (`0015` + `0023`) |
|---|---|---|
| **ACL `storage.buckets`** | `anon=arwd`, `authenticated=arwd`, `service_role=arwdDxtm`, `postgres=a*r*w*d*D*x*t*m*` (grantor `supabase_storage_admin`) | **Tetap sama** (`REVOKE ALL ON storage.buckets FROM anon` menjadi no-op `WARNING`). |
| **ACL `storage.objects`** | `anon=arwd`, `authenticated=arwd`, `service_role=arwdDxtm`, `postgres=a*r*w*d*D*x*t*m*` (grantor `supabase_storage_admin`) | **Tetap sama** (`REVOKE ALL ON storage.objects FROM anon` & `REVOKE UPDATE, DELETE ON storage.objects FROM authenticated` menjadi no-op `WARNING`). |
| **Buckets (`storage.buckets`)** | `0` bucket | **6 bucket privat** (`public = false`, `versioning_status = 'DISABLED'`): `resident-documents`, `payment-proofs`, `complaints`, `letter-requests`, `issued-letters`, `activity-docs`. |
| **Policies `storage.buckets`** | `0` policy | **`0` policy** (tetap tertutup total bagi `anon` & `authenticated`). |
| **Policies `storage.objects`** | `0` policy | **12 policy** (6 `INSERT` + 6 `SELECT`), seluruhnya **`TO authenticated`** (berkat `supautils.policy_grants` yang memberi hak `CREATE/DROP POLICY` kepada `postgres`). **`0` policy `anon`/`PUBLIC`, `0` policy `UPDATE`, `0` policy `DELETE`.** |

### 3.2 Verifikasi Matriks Akses & Isolasi Tiap Policy Baru (`storage.objects`)

| Bucket | Role Target & Command | Pembatasan Tenant, Role & Ownership (Expression `USING` / `WITH CHECK`) | Isolasi Lintas Tenant & Warga Lain |
|---|---|---|---|
| `resident-documents` | `authenticated` ONLY (`INSERT`, `SELECT`) | Path wajib `<tenant_uuid>/<resident_uuid>/<file_uuid>.(jpg\|jpeg\|png\|webp\|pdf)`. `INSERT`: tidak retired, resident aktif & tidak deleted, hanya `ketua_rt`/`sekretaris` tenant tsb atau warga dengan `r.id = get_my_resident_id(r.tenant_id)`. `SELECT`: `archived_at IS NULL AND is_delete_marker = false`, tidak pending deletion, hanya `ketua_rt`/`sekretaris` atau warga pemilik. | Lintas tenant ditolak (`has_tenant_role` & `is_tenant_member` memvalidasi keanggotaan aktif + tenant aktif). Warga lain diblokir oleh `r.id = get_my_resident_id(r.tenant_id)`. |
| `payment-proofs` | `authenticated` ONLY (`INSERT`, `SELECT`) | Path `<tenant_uuid>/<payment_uuid>/<file_uuid>.(jpg\|jpeg\|png\|pdf)`. `INSERT`: hanya `payment_type = 'payment' AND status = 'pending'`, member aktif, dan `paid_by_user_id = auth.uid()` atau tagihan household/resident milik caller. `SELECT`: `bendahara`/`ketua_rt` tenant tsb atau pembayar/pemilik tagihan household/resident terkait. | Lintas tenant diblokir; warga lain di RT yang sama diblokir (hanya household/resident/pembayar terkait & bendahara/ketua RT). |
| `complaints` | `authenticated` ONLY (`INSERT`, `SELECT`) | Path `<tenant_uuid>/<complaint_uuid>/<file_uuid>.(jpg\|jpeg\|png\|webp)`. `INSERT`: `status = 'open'`, `deleted_at IS NULL`, `reporter_member_id = get_my_member_id(c.tenant_id)`. `SELECT`: `ketua_rt`/`sekretaris`/`pengurus` atau pelapor itu sendiri (`deleted_at IS NULL`). | Lintas tenant & warga selain pelapor diblokir total. |
| `letter-requests` | `authenticated` ONLY (`INSERT`, `SELECT`) | Path `<tenant_uuid>/<letter_uuid>/<file_uuid>.(jpg\|jpeg\|png\|pdf)`. `INSERT`: `status = 'submitted'`, `requested_by_member_id = get_my_member_id(lr.tenant_id)`. `SELECT`: `ketua_rt`/`sekretaris` atau pemohon/warga pemilik surat (`requested_by_member_id` / `resident_id`). | Lintas tenant & warga lain diblokir. |
| `issued-letters` | `authenticated` ONLY (`INSERT`, `SELECT`) | Path hanya `.pdf`. `INSERT`: `status = 'approved'`, hanya `ketua_rt`/`sekretaris` tenant tsb. `SELECT`: `ketua_rt`/`sekretaris` atau pemohon/warga pemilik surat terkait. | Lintas tenant & warga lain diblokir; warga tidak bisa upload ke `issued-letters`. |
| `activity-docs` (`0023`) | `authenticated` ONLY (`INSERT`, `SELECT`) | `INSERT`: hanya `ketua_rt`/`sekretaris`/`pengurus` tenant tsb (`a.deleted_at IS NULL AND a.status <> 'cancelled'`), mengecualikan `bendahara`-only & `super_admin` non-member. `SELECT`: hanya `ketua_rt`/`sekretaris`/`pengurus`/`warga` pada tenant terkait (`a.deleted_at IS NULL`). | Lintas tenant & non-member (termasuk `anon` dan `super_admin` yang bukan member tenant) diblokir. |

**Kesimpulan Simulasi:**
- **Akses publik (`anon` / `PUBLIC`):** Tertutup total — `0` bucket publik, `0` policy `anon`/`PUBLIC`, `rolbypassrls = false`.
- **`UPDATE` / `DELETE` oleh `authenticated`:** Tertutup total di RLS (`0` policy `UPDATE`, `0` policy `DELETE`).
- **Lintas tenant & antar-warga:** Seluruh helper (`is_tenant_member`, `has_tenant_role`, `get_my_member_id`, `get_my_resident_id`, `get_my_household_id`) adalah `SECURITY DEFINER SET search_path = public, pg_temp` terikat pada `auth.uid()`, status member `active`, serta status tenant `active AND deleted_at IS NULL` tanpa bypass `is_super_admin()`.

---

## 4. Evaluasi Solusi & Rekomendasi

### A. Apakah migration dapat tetap digunakan tanpa perubahan?
**Ya.** Migration [20261114001500_storage_and_atomic_rpcs.sql](file:///Users/iqbalsahrizal/Documents/CODING/Personal%20Project/smart-rt/supabase/migrations/20261114001500_storage_and_atomic_rpcs.sql) dan [20261116002300_activities_security_gap_closure.sql](file:///Users/iqbalsahrizal/Documents/CODING/Personal%20Project/smart-rt/supabase/migrations/20261116002300_activities_security_gap_closure.sql) dapat langsung dipakai tanpa mengubah migration lama:
- Perintah `REVOKE` di baris 42–44 bersifat non-fatal (`WARNING`) sehingga transaksi `BEGIN; ... COMMIT;` tidak rollback.
- Pembuatan 6 bucket privat dan 12 policy RLS `storage.objects` berjalan sukses dengan privilege `postgres` + `supautils.policy_grants`.

### B. Apakah perlu migration tambahan untuk memperbaiki privilege?
**Tidak perlu dan tidak akan efektif.** Seluruh migrasi SQL melalui Supabase CLI/Dashboard tetap dijalankan oleh role `postgres`, sementara `supabase_storage_admin` termasuk dalam `supautils.reserved_roles` dan `supautils.reserved_memberships` (`postgres_is_storage_admin = false`). Oleh karena itu, migration SQL tambahan apa pun tetap tidak dapat mencabut ACL `anon=arwd` dan `authenticated=arwd` yang di-grant oleh `supabase_storage_admin`.

### C. Apakah diperlukan tindakan melalui mekanisme resmi Supabase Storage Admin?
**Tidak ada mekanisme user-facing untuk login sebagai `supabase_storage_admin` pada Managed Supabase Cloud** karena `supabase_storage_admin` adalah role internal terkelola (`supautils.reserved_roles`), dan grant `anon=arwd` / `authenticated=arwd` pada `storage.buckets` / `storage.objects` merupakan konfigurasi default standar Supabase Storage agar RLS policy di `storage.objects` / `storage.buckets` menjadi kontrol akses utamanya.

### Konsekuensi Eksplisit yang Harus Dikelola

1. **Ketergantungan Penuh pada RLS & Bucket Privacy:** Karena ACL tabel-level `anon=arwd` & `authenticated=arwd` (grantor `supabase_storage_admin`) tetap tersisa pada `storage.buckets` dan `storage.objects`, pembatasan akses `anon` serta pemblokiran `UPDATE`/`DELETE` bagi `authenticated` **sepenuhnya ditopang oleh `relrowsecurity = true` (RLS) + 12 policy yang ketat + 6 bucket `public = false`**, bukan oleh penolakan ACL tabel.
2. **Disiplin Pencegahan Policy Permisif di Masa Depan:** Jika migrasi masa depan tanpa sengaja membuat policy `TO anon` / `TO public` atau `FOR UPDATE`/`FOR DELETE TO authenticated` pada `storage.*`, table ACL tidak akan memblokirnya.
3. **Verifikasi Wajib Pasca-`db push` (saat nanti disetujui):** Setelah 23 migrasi diterapkan nanti, jalankan audit verifikasi read-only pada `smart-rt-staging` untuk memastikan:
   - Semua 6 bucket memiliki `public = false`.
   - `pg_policies` pada `storage.buckets` tetap berjumlah `0`.
   - `pg_policies` pada `storage.objects` hanya berjumlah 12 (`6 INSERT` + `6 SELECT`) dengan `roles = '{authenticated}'`, tanpa satu pun policy untuk `anon`, `public`, `UPDATE`, atau `DELETE`.
   - `relrowsecurity = true` aktif pada `storage.buckets` dan `storage.objects`.

---

## 5. Status Akhir

- **Status:** **`PASS WITH WARNINGS`**
- **Ringkasan Keputusan:** Temuan `STG-01` **bukan blocker** untuk deployment staging dan tidak membuka akses publik atau akses lintas tenant setelah 23 migrasi diterapkan, namun meninggalkan ACL bawaan platform (`anon=arwd`, `authenticated=arwd` dari `supabase_storage_admin`) sehingga kontrol akses sepenuhnya bertumpu pada RLS (`relrowsecurity = true`) dan larangan penambahan policy permisif pada `storage.*`. Tidak ada perubahan apa pun yang dilakukan terhadap database remote `szghujzhiyndeuhepsax`.

