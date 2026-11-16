# Business Flow & Data Lifecycle — Smart RT (Refined v2)

Dokumen ini menjelaskan alur data end-to-end antar tabel pada proses bisnis utama **Smart RT**.

---

## 1. Pendaftaran Tenant (RT Baru)

1. Platform `super_admin` membuat baris baru di `tenants` (`code`, `name`, `rt_number`, `rw_number`, wilayah administratif, `status = 'active'`).
2. Sistem menginisialisasi data default tenant: `cash_categories` awal dan `letter_types` standar.
3. User Ketua RT pertama terdaftar di `auth.users` -> `profiles`.
4. Dibuat baris di `tenant_members` (`tenant_id`, `user_id`, `status = 'active'`, `joined_at = now()`) serta penugasan role `ketua_rt` di `member_roles`.
5. `profiles.active_tenant_id` dapat diarahkan ke `tenants.id` baru, dan aksi dicatat di `audit_logs`.

---

## 2. Pendataan Warga & Data Sensitif

1. Pengurus (`ketua_rt` / `sekretaris`) membuat baris `households` (`tenant_id`, `kk_number`, `address`, `block_unit`, `residence_status`).
2. Pengurus membuat baris `residents` (kolom non-sensitif: `full_name`, `gender`, `phone`, `family_role`, `stay_status`, `residency_status = 'aktif'`).
3. Secara bersamaan (dalam transaksi yang sama), data sensitif dimasukkan ke `resident_private_data` (`tenant_id`, `resident_id`, `nik`, `birth_place`, `birth_date`).
4. Jika `family_role = 'kepala_keluarga'`, `households.head_resident_id` diperbarui ke `residents.id`.
5. Scan KTP/KK diunggah ke bucket private `resident-documents/{tenant_id}/{resident_id}/{file_id}.{ext}`, lalu metadata-nya disimpan di `resident_documents`.
6. Kendaraan dicatat di `vehicles`. Jika warga memiliki akun aplikasi, `tenant_members.resident_id` ditautkan (unik per `(tenant_id, resident_id)`).

---

## 3. Pembuatan Tagihan Iuran

1. Pengurus (`bendahara` / `ketua_rt`) mendefinisikan master iuran di `dues` (`amount numeric(14,2)`, `billing_cycle`, `target_scope`).
2. Pada awal periode (`period_year`, `period_month`), dibuat tagihan di `bills`:
   - `target_scope = 'household'` -> mengisi `household_id` dan `resident_id = NULL`.
   - `target_scope = 'resident'` -> mengisi `resident_id` dan `household_id = NULL`.
   - `paid_amount = 0`, `status = 'unpaid'`.
   - Partial unique index mencegah tagihan ganda untuk penerima & periode yang sama.
3. `notifications` dikirim ke `tenant_members` terkait (`type = 'bill'`, `reference_type = 'bills'`, `reference_id = bills.id`).

---

## 4. Pembayaran Iuran (Penuh, Parsial, Ulang, Gateway, & Refund)

1. **Pembayaran Manual (Transfer / QRIS / Tunai)**:
   - Warga mengunggah bukti ke `payment-proofs/{tenant_id}/{bill_id}/{file_id}.{ext}` dan membuat baris `payments` (`payment_type = 'payment'`, `status = 'pending'`, `amount`).
   - Status `bills` berubah ke `'pending_verification'` (jika sebelumnya `unpaid`/`overdue`).
   - Jika bendahara menolak (`payments.status = 'rejected'`), warga dapat melakukan **pembayaran ulang** dengan membuat baris `payments` baru.
2. **Pembayaran Gateway & Webhook Idempotency**:
   - Request pembayaran menyertakan `idempotency_key` (`uq_payments_idempotency`).
   - Saat webhook masuk dari provider (`midtrans`/`xendit`), server memverifikasi signature lalu mencatat event di `payment_webhook_events (provider, event_id)`. Jika `event_id` sudah pernah diproses (`uq_webhook_provider_event`), webhook langsung diabaikan dengan aman.
3. **Verifikasi Atomik & Pembayaran Parsial**:
   - Dalam satu transaksi database:
     - `payments.status` diubah menjadi `'verified'`.
     - `bills.paid_amount` dihitung ulang: `SUM(verified payment) - SUM(verified refund)`.
     - Jika `bills.paid_amount >= bills.amount` -> `bills.status = 'paid'`, `paid_at = now()`.
     - Jika `0 < bills.paid_amount < bills.amount` -> `bills.status = 'partial'` (tidak dianggap lunas).
     - Dicatat 1 baris di `cash_transactions` (`type = 'income'`, `payment_id = payments.id`) yang dilindungi `UNIQUE (payment_id)`.
4. **Refund**:
   - Refund dibuat sebagai baris baru di `payments` (`payment_type = 'refund'`, `parent_payment_id = <payment_asal>`, `status = 'verified'`). Histori pembayaran asal **tidak dihapus**.
   - `bills.paid_amount` dan `bills.status` (`refunded` / `partial`) dihitung ulang secara atomik, dan dicatat transaksi `expense` di `cash_transactions` dengan `payment_id` milik baris refund.

---

## 5. Pengajuan & Penerbitan Surat Pengantar

1. Warga memilih jenis surat dari `letter_types` dan mengunggah syarat ke `letter-requests/{tenant_id}/{request_id}/{file_id}.{ext}`.
2. Dibuat baris `letter_requests` (`status = 'submitted'`). Pengurus (`sekretaris`/`ketua_rt`) menerima notifikasi.
3. Saat surat disetujui (`approved` -> `completed`), penomoran surat memanggil fungsi atomik yang melakukan `INSERT ... ON CONFLICT DO UPDATE` pada `letter_sequences (tenant_id, period_year)` sehingga nomor urut aman dari *concurrent requests*.
4. PDF surat terbit disimpan ke bucket private `issued-letters/{tenant_id}/{request_id}/{file_id}.pdf` dan path-nya disimpan di `letter_requests.issued_file_path`.
5. Warga mengunduh PDF melalui Signed URL berdurasi terbatas.

---

## 6. Pengaduan Warga

1. Warga membuat `complaints` (`status = 'open'`) dan mengunggah foto ke `complaints/{tenant_id}/{complaint_id}/{file_id}.{ext}`.
2. Diskusi lanjutan dicatat di `complaint_replies` (dapat diisi oleh pelapor maupun pengurus).
3. Setiap perubahan status (`open` -> `in_progress` -> `resolved`/`rejected`) **hanya dapat dilakukan pengurus** dan wajib mencatat baris baru di `complaint_status_history` (append-only, tidak dapat diubah atau dihapus oleh warga).

---

## 7. Pengumuman & Notifikasi

1. Pengurus membuat draf `announcements` (`status = 'draft'`, `target_type = 'all' | 'role' | 'household'`).
2. Jika target spesifik, penerima ditambahkan ke `announcement_recipients`.
3. Saat dipublikasikan (`status = 'published'`, `published_at = now()`), sistem membuat `notifications` untuk seluruh `recipient_user_id` yang sesuai di dalam `tenant_id` yang sama.
