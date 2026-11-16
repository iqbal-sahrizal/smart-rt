# RLS Implementation Plan — Smart RT (Step 10.2.2.1)

Dokumen ini merupakan hasil audit dependency RLS dan rencana implementasi lengkap untuk **Step 10.2.2.2 (Aktivasi RLS & Pembuatan Policies pada 28 Tabel `public`)** serta **Step 10.2.3 (Atomic RPCs & Storage Policies)**.

> [!IMPORTANT]
> **Tahap Audit & Perencanaan Saja**: Belum ada RLS yang diaktifkan (`relrowsecurity = false` pada 28 tabel) dan belum ada policy (`pg_policies = 0`). Database saat ini **belum siap / belum aman untuk production**.

---

## 1. Final Role Matrix — 28 Tabel (Ringkasan Dependency & Ownership)

| No | Tabel | Tenant Owned | PK & Composite Tenant FK | Owner / Identity Column | Soft Delete / Status | `super_admin` | `ketua_rt` | `sekretaris` | `bendahara` | `pengurus` | `warga` |
| :---: | :--- | :---: | :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| 1 | `roles` | Global | PK `id` | — | — | S | S | S | S | S | S |
| 2 | `profiles` | User | PK `id` -> `auth.users(id)` | `id = auth.uid()` | `is_super_admin` | S (All), U (Own) | S, U (Own) | S, U (Own) | S, U (Own) | S, U (Own) | S, U (Own) |
| 3 | `tenants` | Root | PK `id` | `id` | `status`, `deleted_at` | S, I, U, D | S (Own) | S (Own) | S (Own) | S (Own) | S (Own) |
| 4 | `tenant_members` | Ya | PK `id`; FK `(tenant_id, resident_id)` -> `residents` | `user_id`, `resident_id` | `status` | S, I, U, D | S, I, U, D | S | S | S | S (Own) |
| 5 | `member_roles` | Ya | PK `id`; FK `(tenant_id, member_id)` -> `tenant_members` | `member_id` | — | S, I, U, D | S, I, U, D | S | S | S | S (Own) |
| 6 | `households` | Ya | PK `id`; FK `(tenant_id, head_resident_id)` -> `residents` | `id` (`my_hh_id`) | `status`, `deleted_at` | S | S, I, U, D | S, I, U, D | S | S | S (Own HH) |
| 7 | `residents` | Ya | PK `id`; FK `(tenant_id, household_id)` -> `households` | `id`, `household_id` | `residency_status`, `deleted_at` | S | S, I, U, D | S, I, U, D | S | S | S (Own HH) |
| 8 | `resident_private_data` | Ya (PII) | PK `id`; FK `(tenant_id, resident_id)` -> `residents` | `resident_id` | `deleted_at` | **—** | S, I, U, D | S, I, U, D | **—** | **—** | S (Own) |
| 9 | `resident_documents` | Ya (PII) | PK `id`; FK `(tenant_id, resident_id)` -> `residents` | `resident_id` | `verified_by`, `verified_at` | **—** | S, I, U, D | S, I, U, D | **—** | **—** | S (Own), I\* (Own) |
| 10 | `vehicles` | Ya | PK `id`; FK `(tenant_id, household_id)`, `(tenant_id, resident_id)` | `household_id`, `resident_id` | — | S | S, I, U, D | S, I, U, D | S | S | S, I, U, D (Own HH) |
| 11 | `dues` | Ya | PK `id` | — | `is_active` | S | S, I, U, D | S | S, I, U, D | S | S\* (Active) |
| 12 | `bills` | Ya | PK `id`; FK `(tenant_id, due_id)`, `(tenant_id, household_id)`, `(tenant_id, resident_id)` | `household_id`, `resident_id` | `status` | S | S | S | S, I, U | S | S (Own HH / Own) |
| 13 | `payments` | Ya | PK `id`; FK `(tenant_id, bill_id)`, `(tenant_id, parent_payment_id)` | `bill_id`, `paid_by_user_id` | `status`, `verified_by` | S | S | S | S, I\* (RPC U) | S | S (Own bill), I\* |
| 14 | `payment_webhook_events` | Backend | PK `id`; FK `(tenant_id, payment_id)` -> `payments` | — | `processing_status` | **—** (`service_role`) | **—** | **—** | **—** | **—** | **—** |
| 15 | `cash_categories` | Ya | PK `id` | — | `is_active` | S | S, I, U, D | S | S, I, U, D | S | S |
| 16 | `cash_transactions` | Ya | PK `id`; FK `(tenant_id, category_id)`, `(tenant_id, payment_id)` | `payment_id`, `created_by` | — | S | S | S | S, I, U | S | **—** (via RPC/View) |
| 17 | `announcements` | Ya | PK `id` | `author_id` | `status`, `deleted_at` | S | S, I, U, D | S, I, U, D | S | S, I, U, D | S\* (Published) |
| 18 | `announcement_recipients` | Ya | PK `id`; FK `(tenant_id, announcement_id)`, `(tenant_id, household_id)` | `role_id`, `household_id` | — | S | S, I, U, D | S, I, U, D | S | S, I, U, D | S\* (Target) |
| 19 | `complaints` | Ya | PK `id`; FK `(tenant_id, reporter_member_id)` -> `tenant_members` | `reporter_member_id` | `status`, `deleted_at` | S | S, U\* | S, U\* | S | S, U\* | S, I\*, U\* (Own open) |
| 20 | `complaint_replies` | Ya | PK `id`; FK `(tenant_id, complaint_id)`, `(tenant_id, author_member_id)` | `complaint_id`, `author_member_id` | — | S | S, I | S, I | S | S, I | S, I\* (Own) |
| 21 | `complaint_status_history` | Ya | PK `id`; FK `(tenant_id, complaint_id)`, `(tenant_id, changed_by_member_id)` | `complaint_id` | — | S | S, I | S, I | S | S, I | S (Own) |
| 22 | `letter_types` | Ya | PK `id` | — | `is_active` | S | S, I, U, D | S, I, U, D | S | S | S\* (Active) |
| 23 | `letter_sequences` | Backend | PK `id` | — | — | **—** (`service_role`/RPC) | **—** | **—** | **—** | **—** | **—** |
| 24 | `letter_requests` | Ya | PK `id`; FK `(tenant_id, letter_type_id)`, `(tenant_id, resident_id)`, `(tenant_id, requested_by_member_id)` | `requested_by_member_id`, `resident_id` | `status`, `letter_number` | S | S, U | S, U | S | S | S (Own), I\* (Own) |
| 25 | `activities` | Ya | PK `id` | `created_by` | `status`, `deleted_at` | S | S, I, U, D | S, I, U, D | S | S, I, U, D | S (Non-deleted) |
| 26 | `activity_participants` | Ya | PK `id`; FK `(tenant_id, activity_id)`, `(tenant_id, resident_id)` | `resident_id` | `rsvp_status` | S | S, I, U, D | S, I, U, D | S | S, I, U, D | S, I\*, U\* (Own) |
| 27 | `notifications` | Ya | PK `id`; FK `(tenant_id, recipient_user_id)` -> `tenant_members` | `recipient_user_id` | `is_read`, `read_at` | S | S, U\* (Own) | S, U\* (Own) | S, U\* (Own) | S, U\* (Own) | S, U\* (Own) |
| 28 | `audit_logs` | Backend/Audit | PK `id`; FK `tenant_id` (nullable) | `actor_user_id` | — | S (All) | S (Own tenant) | S (Own tenant) | S (Own tenant) | **—** | **—** |

---

## 2. Desain Policy `SELECT` / `INSERT` / `UPDATE` / `DELETE` per Tabel (Step 10.2.2.2)

Seluruh tabel menggunakan **1 policy per command** (`FOR SELECT`, `FOR INSERT`, `FOR UPDATE`, `FOR DELETE`) guna menghindari duplicate permissive policies dan menjaga kejelasan evaluasi `OR`/`AND`. Untuk seluruh policy `FOR UPDATE`, ekspresi `WITH CHECK` menggunakan kondisi yang sama ketatnya dengan `USING` agar baris tidak dapat dipindahkan keluar dari scope `tenant_id` maupun kepemilikannya.

1. **`roles`**:
   - `SELECT`: `true` (untuk `authenticated`; `anon` sudah di-`REVOKE ALL`).
   - `INSERT/UPDATE/DELETE`: Tidak ada policy (`REVOKE` sudah mencabut hak).
2. **`profiles`**:
   - `SELECT`: `id = auth.uid() OR public.is_super_admin()`.
   - `UPDATE`: `USING (id = auth.uid()) WITH CHECK (id = auth.uid())` (kolom dibatasi ke `full_name, phone, avatar_path, active_tenant_id`).
   - `INSERT/DELETE`: Tidak ada policy (`handle_new_user()` trigger `SECURITY DEFINER`).
3. **`tenants`**:
   - `SELECT`: `public.is_super_admin() OR public.is_tenant_member(id)`.
   - `INSERT/UPDATE/DELETE`: `public.is_super_admin()`.
4. **`tenant_members`**:
   - `SELECT`: `public.is_super_admin() OR user_id = auth.uid() OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris','bendahara','pengurus'])`.
   - `INSERT/UPDATE/DELETE`: `public.is_super_admin() OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt'])`.
5. **`member_roles`**:
   - `SELECT`: `public.is_super_admin() OR member_id = public.get_my_member_id(tenant_id) OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris','bendahara','pengurus'])`.
   - `INSERT/UPDATE/DELETE`: `public.is_super_admin() OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt'])`.
6. **`households`**:
   - `SELECT`: `public.is_super_admin() OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris','bendahara','pengurus']) OR (public.is_tenant_member(tenant_id) AND id = public.get_my_household_id(tenant_id) AND deleted_at IS NULL)`.
   - `INSERT/UPDATE/DELETE`: `public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris'])`.
7. **`residents`**:
   - `SELECT`: `public.is_super_admin() OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris','bendahara','pengurus']) OR (public.is_tenant_member(tenant_id) AND household_id = public.get_my_household_id(tenant_id) AND deleted_at IS NULL)`.
   - `INSERT/UPDATE/DELETE`: `public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris'])`.
8. **`resident_private_data`** *(Sensitif — NIK/TTL)*:
   - `SELECT`: `public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris']) OR (public.is_tenant_member(tenant_id) AND resident_id = public.get_my_resident_id(tenant_id) AND deleted_at IS NULL)`. *(Tertutup bagi `bendahara`, `pengurus`, dan default `super_admin`.)*
   - `INSERT/UPDATE/DELETE`: `public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris'])`.
9. **`resident_documents`** *(Sensitif)*:
   - `SELECT`: `public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris']) OR (public.is_tenant_member(tenant_id) AND resident_id = public.get_my_resident_id(tenant_id))`.
   - `INSERT`: `public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris']) OR (public.is_tenant_member(tenant_id) AND resident_id = public.get_my_resident_id(tenant_id) AND verified_by IS NULL AND verified_at IS NULL)`.
   - `UPDATE/DELETE`: `public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris'])`.

   **Matriks Rinci Data Sensitif (`resident_private_data` & `resident_documents`)**:

   | Tabel | Command | `ketua_rt` | `sekretaris` | `bendahara` | `pengurus` | `warga` | `super_admin` (default Step 09.4) |
   | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
   | `resident_private_data` | `SELECT` | Ya (All tenant) | Ya (All tenant) | **Tidak** | **Tidak** | Ya (Own `resident_id` & `deleted_at IS NULL`) | **Tidak** |
   | `resident_private_data` | `INSERT` | Ya (All tenant) | Ya (All tenant) | **Tidak** | **Tidak** | **Tidak** | **Tidak** |
   | `resident_private_data` | `UPDATE` | Ya (All tenant) | Ya (All tenant) | **Tidak** | **Tidak** | **Tidak** | **Tidak** |
   | `resident_private_data` | `DELETE` | Ya (All tenant) | Ya (All tenant) | **Tidak** | **Tidak** | **Tidak** | **Tidak** |
   | `resident_documents` | `SELECT` | Ya (All tenant) | Ya (All tenant) | **Tidak** | **Tidak** | Ya (Own `resident_id`) | **Tidak** |
   | `resident_documents` | `INSERT` | Ya (All tenant) | Ya (All tenant) | **Tidak** | **Tidak** | Ya (Own `resident_id`, `verified_by/at IS NULL`) | **Tidak** |
   | `resident_documents` | `UPDATE` | Ya (All tenant) | Ya (All tenant) | **Tidak** | **Tidak** | **Tidak** | **Tidak** |
   | `resident_documents` | `DELETE` | Ya (All tenant) | Ya (All tenant) | **Tidak** | **Tidak** | **Tidak** | **Tidak** |
10. **`vehicles`**:
    - `SELECT`: `public.is_super_admin() OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris','bendahara','pengurus']) OR (public.is_tenant_member(tenant_id) AND household_id = public.get_my_household_id(tenant_id))`.
    - `INSERT/UPDATE/DELETE`: `public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris']) OR (public.is_tenant_member(tenant_id) AND household_id = public.get_my_household_id(tenant_id))`.
11. **`dues`**:
    - `SELECT`: `public.is_super_admin() OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris','bendahara','pengurus']) OR (public.is_tenant_member(tenant_id) AND is_active IS TRUE)`.
    - `INSERT/UPDATE/DELETE`: `public.has_tenant_role(tenant_id, ARRAY['ketua_rt','bendahara'])`.
12. **`bills`**:
    - `SELECT`: `public.is_super_admin() OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris','bendahara','pengurus']) OR (public.is_tenant_member(tenant_id) AND (household_id = public.get_my_household_id(tenant_id) OR resident_id = public.get_my_resident_id(tenant_id)))`.
    - `INSERT/UPDATE`: `public.has_tenant_role(tenant_id, ARRAY['bendahara'])`. (`DELETE` dicabut.)
13. **`payments`**:
    - `SELECT`: `public.is_super_admin() OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris','bendahara','pengurus']) OR (public.is_tenant_member(tenant_id) AND EXISTS (SELECT 1 FROM public.bills b WHERE b.id = payments.bill_id AND b.tenant_id = payments.tenant_id AND (b.household_id = public.get_my_household_id(payments.tenant_id) OR b.resident_id = public.get_my_resident_id(payments.tenant_id))))`.
    - `INSERT`: `public.has_tenant_role(tenant_id, ARRAY['bendahara']) OR (public.is_tenant_member(tenant_id) AND payment_type = 'payment' AND status = 'pending' AND parent_payment_id IS NULL AND paid_by_user_id = auth.uid() AND verified_by IS NULL AND verified_at IS NULL AND EXISTS (SELECT 1 FROM public.bills b WHERE b.id = payments.bill_id AND b.tenant_id = payments.tenant_id AND (b.household_id = public.get_my_household_id(payments.tenant_id) OR b.resident_id = public.get_my_resident_id(payments.tenant_id))))`.
    - `UPDATE/DELETE`: Tidak ada policy (`REVOKE` sudah mencabut; verifikasi & refund via RPC atomik).
14. **`payment_webhook_events`**:
    - RLS aktif (`ENABLE ROW LEVEL SECURITY`) dengan **0 policies** (deny-all untuk `authenticated`; hanya `service_role`).
15. **`cash_categories`**:
    - `SELECT`: `public.is_super_admin() OR public.is_tenant_member(tenant_id)`.
    - `INSERT/UPDATE/DELETE`: `public.has_tenant_role(tenant_id, ARRAY['ketua_rt','bendahara'])`.
16. **`cash_transactions`**:
    - `SELECT`: `public.is_super_admin() OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris','bendahara','pengurus'])`. *(Warga ditolak langsung; transparansi melalui RPC/view pada Step 10.2.3.)*
    - `INSERT/UPDATE`: `public.has_tenant_role(tenant_id, ARRAY['bendahara'])`. (`DELETE` dicabut.)
17. **`announcements`**:
    - `SELECT`: `public.is_super_admin() OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris','bendahara','pengurus']) OR (public.is_tenant_member(tenant_id) AND status = 'published' AND deleted_at IS NULL AND (target_type = 'all' OR (target_type = 'household' AND EXISTS (SELECT 1 FROM public.announcement_recipients ar WHERE ar.announcement_id = announcements.id AND ar.tenant_id = announcements.tenant_id AND ar.household_id = public.get_my_household_id(announcements.tenant_id))) OR (target_type = 'role' AND EXISTS (SELECT 1 FROM public.announcement_recipients ar JOIN public.member_roles mr ON mr.role_id = ar.role_id AND mr.tenant_id = ar.tenant_id WHERE ar.announcement_id = announcements.id AND ar.tenant_id = announcements.tenant_id AND mr.member_id = public.get_my_member_id(announcements.tenant_id)))))`.
    - `INSERT/UPDATE/DELETE`: `public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris','pengurus'])`.
18. **`announcement_recipients`**:
    - `SELECT`: `public.is_super_admin() OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris','bendahara','pengurus']) OR (public.is_tenant_member(tenant_id) AND (household_id = public.get_my_household_id(tenant_id) OR EXISTS (SELECT 1 FROM public.member_roles mr WHERE mr.tenant_id = announcement_recipients.tenant_id AND mr.member_id = public.get_my_member_id(announcement_recipients.tenant_id) AND mr.role_id = announcement_recipients.role_id)))`.
    - `INSERT/UPDATE/DELETE`: `public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris','pengurus'])`.
19. **`complaints`**:
    - `SELECT`: `public.is_super_admin() OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris','bendahara','pengurus']) OR (public.is_tenant_member(tenant_id) AND reporter_member_id = public.get_my_member_id(tenant_id) AND deleted_at IS NULL)`.
    - `INSERT`: `public.is_tenant_member(tenant_id) AND reporter_member_id = public.get_my_member_id(tenant_id) AND status = 'open'`.
    - `UPDATE`: `USING (public.is_tenant_member(tenant_id) AND reporter_member_id = public.get_my_member_id(tenant_id) AND status = 'open' AND deleted_at IS NULL) WITH CHECK (public.is_tenant_member(tenant_id) AND reporter_member_id = public.get_my_member_id(tenant_id) AND status = 'open' AND deleted_at IS NULL)`. *(Transisi status pengurus via RPC atomik.)*
20. **`complaint_replies`**:
    - `SELECT`: `public.is_super_admin() OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris','bendahara','pengurus']) OR (public.is_tenant_member(tenant_id) AND EXISTS (SELECT 1 FROM public.complaints c WHERE c.id = complaint_replies.complaint_id AND c.tenant_id = complaint_replies.tenant_id AND c.reporter_member_id = public.get_my_member_id(complaint_replies.tenant_id) AND c.deleted_at IS NULL))`.
    - `INSERT`: `public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris','pengurus']) OR (public.is_tenant_member(tenant_id) AND author_member_id = public.get_my_member_id(tenant_id) AND EXISTS (SELECT 1 FROM public.complaints c WHERE c.id = complaint_replies.complaint_id AND c.tenant_id = complaint_replies.tenant_id AND c.reporter_member_id = public.get_my_member_id(complaint_replies.tenant_id) AND c.deleted_at IS NULL))`.
21. **`complaint_status_history`**:
    - `SELECT`: `public.is_super_admin() OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris','bendahara','pengurus']) OR (public.is_tenant_member(tenant_id) AND EXISTS (SELECT 1 FROM public.complaints c WHERE c.id = complaint_status_history.complaint_id AND c.tenant_id = complaint_status_history.tenant_id AND c.reporter_member_id = public.get_my_member_id(complaint_status_history.tenant_id)))`.
    - `INSERT`: `public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris','pengurus']) AND changed_by_member_id = public.get_my_member_id(tenant_id)`. (`UPDATE/DELETE` dicabut.)
22. **`letter_types`**:
    - `SELECT`: `public.is_super_admin() OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris','bendahara','pengurus']) OR (public.is_tenant_member(tenant_id) AND is_active IS TRUE)`.
    - `INSERT/UPDATE/DELETE`: `public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris'])`.
23. **`letter_sequences`**:
    - RLS aktif dengan **0 policies** (deny-all untuk `authenticated`; dikelola `service_role` / RPC atomik).
24. **`letter_requests`**:
    - `SELECT`: `public.is_super_admin() OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris','bendahara','pengurus']) OR (public.is_tenant_member(tenant_id) AND (requested_by_member_id = public.get_my_member_id(tenant_id) OR resident_id = public.get_my_resident_id(tenant_id)))`.
    - `INSERT`: `public.is_tenant_member(tenant_id) AND requested_by_member_id = public.get_my_member_id(tenant_id) AND status = 'submitted' AND letter_number IS NULL AND reviewed_by IS NULL`.
    - `UPDATE`: `public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris'])`. (`DELETE` dicabut.)
25. **`activities`**:
    - `SELECT`: `public.is_super_admin() OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris','bendahara','pengurus']) OR (public.is_tenant_member(tenant_id) AND deleted_at IS NULL)`.
    - `INSERT/UPDATE/DELETE`: `public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris','pengurus'])`.
26. **`activity_participants`**:
    - `SELECT`: `public.is_super_admin() OR public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris','bendahara','pengurus']) OR (public.is_tenant_member(tenant_id) AND resident_id = public.get_my_resident_id(tenant_id))`. *(Roster penuh tidak dibuka untuk `warga`.)*
    - `INSERT`: `public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris','pengurus']) OR (public.is_tenant_member(tenant_id) AND resident_id = public.get_my_resident_id(tenant_id))`.
    - `UPDATE`: `public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris','pengurus']) OR (public.is_tenant_member(tenant_id) AND resident_id = public.get_my_resident_id(tenant_id))`.
    - `DELETE`: `public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris','pengurus'])`.
27. **`notifications`**:
    - `SELECT`: `public.is_super_admin() OR (public.is_tenant_member(tenant_id) AND recipient_user_id = auth.uid())`.
    - `UPDATE`: `USING (public.is_tenant_member(tenant_id) AND recipient_user_id = auth.uid()) WITH CHECK (public.is_tenant_member(tenant_id) AND recipient_user_id = auth.uid())` (kolom dibatasi ke `is_read, read_at`).
28. **`audit_logs`**:
    - `SELECT`: `public.is_super_admin() OR (tenant_id IS NOT NULL AND public.has_tenant_role(tenant_id, ARRAY['ketua_rt','sekretaris','bendahara']))`.
    - `INSERT/UPDATE/DELETE`: Tidak ada policy (`REVOKE` sudah mencabut).

---

## 3. Strategi Tenant Isolation
- **Dilarang** memakai `profiles.active_tenant_id` sebagai kondisi otorisasi.
- Seluruh pengecekan tenant selalu melalui `public.is_tenant_member(tenant_id)` atau `public.has_tenant_role(tenant_id, ...)` yang memverifikasi `tenant_members.user_id = auth.uid()`, `tenant_members.status = 'active'`, `tenants.status = 'active'`, dan `tenants.deleted_at IS NULL`.

## 4. Strategi Kepemilikan Data (Ownership)
- **User-owned**: `auth.uid()` (`profiles`, `notifications`).
- **Member-owned**: `public.get_my_member_id(tenant_id)` (`member_roles`, `complaints`, `complaint_replies`, `letter_requests`).
- **Resident-owned**: `public.get_my_resident_id(tenant_id)` (`resident_private_data`, `resident_documents`, `activity_participants`, `bills`, `letter_requests`).
- **Household-owned**: `public.get_my_household_id(tenant_id)` (`households`, `residents`, `vehicles`, `bills`, `payments` via `bills`, `announcement_recipients`).

## 5. Column-Level Restrictions
- `profiles`: `UPDATE (full_name, phone, avatar_path, active_tenant_id)` + trigger `protect_super_admin_column()`.
- `complaints`: `UPDATE (category, title, description, photo_path)`.
- `notifications`: `UPDATE (is_read, read_at)`.
- `payments`: `UPDATE`/`DELETE` dicabut dari `authenticated` (hanya `INSERT` `status = 'pending'`).

## 6. Trigger & Function Classification Audit (15 Functions Total)

| Function | Klasifikasi | Security | Akses Tabel Internal | Kompatibilitas RLS |
| :--- | :--- | :---: | :--- | :--- |
| `set_updated_at()` | **Trigger Utility** | `INVOKER` | Tidak membaca tabel lain | Aman |
| `handle_new_user()` | **Trigger Auth Sync** | `DEFINER` | `INSERT` ke `public.profiles` dari `auth.users` | Aman (`postgres`, `rolbypassrls=true`) |
| `protect_super_admin_column()` | **Trigger Security Guard / Validator** | `INVOKER` | Tidak membaca tabel lain (`current_user` & JWT claim) | Aman |
| `validate_bill_target_scope()` | **Trigger Domain Validator** | `INVOKER` | `SELECT` `public.dues` | Aman (diakses `bendahara`/`super_admin`) |
| `validate_payment_and_refund()` | **Trigger Domain Validator** | `INVOKER` | `SELECT` `public.payments` (`FOR UPDATE`) | Aman (diakses `bendahara`/RPC) |
| `validate_cash_transaction_payment()` | **Trigger Domain Validator** | `INVOKER` | `SELECT` `public.payments` | Aman (diakses `bendahara`/RPC) |
| `validate_announcement_recipient()` | **Trigger Domain Validator** | `INVOKER` | `SELECT` `public.announcements` | Aman (diakses pengurus) |
| `validate_announcement_target_change()` | **Trigger Domain Validator** | `INVOKER` | `SELECT` `public.announcement_recipients` | Aman (diakses pengurus) |
| `validate_tenant_actor()` | **Trigger Actor Validator** | `DEFINER` | `SELECT` `public.tenant_members`, `public.profiles` | Aman (`postgres`, `rolbypassrls=true`) |
| `is_super_admin()`, `is_tenant_member()`, `has_tenant_role()`, `get_my_member_id()`, `get_my_resident_id()`, `get_my_household_id()` (6 fungsi) | **RLS Helper** | `DEFINER` | Lookup keanggotaan, role, `resident_id`, `household_id` | Aman (`postgres`, `rolbypassrls=true`, `STABLE`) |

## 7. Helper Function Audit
- Keenam helper (`is_super_admin`, `is_tenant_member`, `has_tenant_role`, `get_my_member_id`, `get_my_resident_id`, `get_my_household_id`) terverifikasi pada Step 10.2.1: `SECURITY DEFINER`, `STABLE`, `owner = postgres` (`rolbypassrls=true`), `search_path = public, pg_temp`, schema-qualified `public.*`, menggunakan `auth.uid()` internal, dan `anon` tidak memiliki `EXECUTE`.

## 8. Storage Policy Design (6 Private Buckets — Step 10.2.3)
- Seluruh 6 bucket (`resident-documents`, `payment-proofs`, `complaints`, `letter-requests`, `issued-letters`, `activity-docs`) wajib `public = false`.
- Policy pada `storage.objects` memvalidasi `bucket_id`, `(storage.foldername(name))[1]::uuid` sebagai `tenant_id` (`is_tenant_member`), dan segmen ke-2 sebagai ID entitas (`resident_id`, `bill_id`, `complaint_id`, `request_id`, `activity_id`).
- Signed URL hanya diterbitkan setelah otorisasi role/kepemilikan lolos (TTL `60–300s` untuk `resident-documents`).

## 9. Policy Recursion Risk
- Keenam helper membaca 6 tabel lookup (`profiles`, `tenants`, `tenant_members`, `member_roles`, `roles`, `residents`) dengan `owner = postgres` (`rolbypassrls=true`) tanpa `FORCE ROW LEVEL SECURITY`, sehingga tidak ada siklus recursion (`42P17`).
- Perhatian khusus pada `announcements` <-> `announcement_recipients`: `announcements` `SELECT` membaca `announcement_recipients`, sedangkan `announcement_recipients` `SELECT` **tidak** membaca `announcements` (hanya memeriksa `has_tenant_role`, `get_my_household_id`, dan `member_roles`) -> bebas siklus!

## 10. Performance Recommendations & Index Review

- Mayoritas query terlindungi indeks `tenant_id` yang sudah ada.
- **Review 2 Indeks Opsional (Belum Dibuat — Untuk Step 10.2.2.2)**:
  1. `idx_bills_tenant_resident` (`ON public.bills (tenant_id, resident_id) WHERE resident_id IS NOT NULL`):
     - *Indeks eksisting*: `uq_bills_resident_period` memiliki `due_id` sebelum `resident_id`, sehingga filter `tenant_id = ... AND resident_id = ...` tanpa `due_id` tidak optimal; `idx_bills_household` hanya mengindeks `household_id`.
     - *FK & Policy*: Mendukung `fk_bills_resident (tenant_id, resident_id)` serta policy `SELECT` `warga` pada `bills` dan subquery `payments` (`b.resident_id = get_my_resident_id(...)`).
     - *Keputusan*: **Diperlukan** sebagai partial index pada Step 10.2.2.2.
  2. `idx_letter_requests_tenant_requester` (`ON public.letter_requests (tenant_id, requested_by_member_id)`):
     - *Indeks eksisting*: `letter_requests` baru memiliki `idx_letter_requests_tenant_status` dan `idx_letter_requests_resident (tenant_id, resident_id)`; belum ada indeks untuk `requested_by_member_id`.
     - *FK & Policy*: Mendukung `fk_letter_requests_requester (tenant_id, requested_by_member_id)` dan policy `SELECT` `warga` (`requested_by_member_id = get_my_member_id(tenant_id)`).
     - *Keputusan*: **Diperlukan** pada Step 10.2.2.2.

## 11. Ordered Migration Implementation Plan
1. **Step 10.2.2.2 (`0011_enable_rls_and_policies.sql`)**:
   - Tambahkan 2 indeks opsional di atas.
   - `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` pada seluruh 28 tabel `public`.
   - Buat policy `SELECT`, `INSERT`, `UPDATE`, `DELETE` untuk 28 tabel sesuai Bagian 2.
2. **Step 10.2.3 (`0012_create_atomic_rpcs_and_storage.sql`)**:
   - Buat RPC atomik (`verify_payment_and_reconcile`, `reject_payment`, `process_refund`, `update_complaint_status`, `get_tenant_cash_ledger`, `issue_letter_number`, `manage_member_role` + proteksi `ketua_rt` terakhir).
   - Konfigurasikan 6 private buckets & policies pada `storage.objects`.

## 12. Testing Checklist (Untuk Step 10.2.2.2)
- [ ] `relrowsecurity = true` pada 28 tabel `public` (`force_rls = false`).
- [ ] Zero `42P17` (infinite recursion) pada seluruh tabel saat di-query sebagai `authenticated`.
- [ ] Isolasi lintas tenant (mengubah `profiles.active_tenant_id` tidak membuka akses Tenant B).
- [ ] `warga` hanya melihat KK/resident/bill/complaint/letter/participation miliknya sendiri.
- [ ] `bendahara`, `pengurus`, `super_admin` ditolak pada `resident_private_data` & `resident_documents`.
- [ ] `warga` ditolak `SELECT` `cash_transactions` & `INSERT payments` dengan `status = 'verified'`.
- [ ] `payment_webhook_events` & `letter_sequences` tertolak total bagi `authenticated` & `anon`.
- [ ] `audit_logs` tidak dapat dimodifikasi oleh client.

