# Migration Guide — Smart RT

Dokumen ini mencatat struktur dan urutan aktual SQL migration pada `supabase/migrations/` serta rencana lanjutan untuk Step 10.

---

## 1. Migration yang Sudah Diimplementasikan (Step 09)

| Urutan | File Aktual (`supabase/migrations/`) | Cakupan |
| :--- | :--- | :--- |
| `0001` | `20261113000100_create_extensions.sql` | Extension `pgcrypto` |
| `0002` | `20261113000200_create_tenant_access.sql` | `tenants`, `profiles`, `roles`, `tenant_members`, `member_roles`, dan column-level privilege `REVOKE UPDATE` + `GRANT UPDATE (...)` pada `profiles` |
| `0003` | `20261113000300_create_resident_domain.sql` | `households`, `residents`, `resident_private_data`, `resident_documents`, `vehicles`, serta penyelesaian circular composite FK |
| `0004` | `20261113000400_create_finance_domain.sql` | `dues`, `bills`, `payments`, `payment_webhook_events`, `cash_categories`, `cash_transactions` |
| `0005` | `20261113000500_create_communication_domain.sql` | `announcements`, `announcement_recipients`, `complaints`, `complaint_replies`, `complaint_status_history`, `letter_types`, `letter_sequences`, `letter_requests` |
| `0006` | `20261113000600_create_activity_domain.sql` | `activities`, `activity_participants` |
| `0007` | `20261113000700_create_audit_notification_domain.sql` | `notifications`, `audit_logs` |
| `0008` | `20261113000800_create_database_functions.sql` | `set_updated_at()`, `handle_new_user()`, `protect_super_admin_column()`, `validate_bill_target_scope()`, `validate_payment_and_refund()` (`FOR UPDATE`), `validate_cash_transaction_payment()`, `validate_announcement_recipient()`, `validate_announcement_target_change()`, `validate_tenant_actor()` |
| `0009` | `20261113000900_create_database_triggers.sql` | 16 trigger `updated_at`, proteksi `is_super_admin` (INSERT/UPDATE), sinkronisasi `auth.users` -> `profiles`, 5 trigger validasi bisnis, dan 9 trigger `validate_tenant_actor` |
| `seed` | `supabase/seed.sql` | Seed idempoten untuk `roles`, 1 tenant demo, `cash_categories`, dan `letter_types` |

---

## 2. Rencana Migration Tahap Berikutnya (Step 10)

| Urutan | Rencana Cakupan |
| :--- | :--- |
| `0010` | Helper functions RLS (`is_super_admin()`, `is_tenant_member()`, `has_tenant_role()`) & seluruh **Row Level Security (RLS)** policies |
| `0011` | RPC atomik (verifikasi pembayaran/refund & rekonsiliasi `cash_transactions`, penomoran surat `letter_sequences`) |
| `0012` | Konfigurasi 6 private buckets Supabase Storage & policies pada `storage.objects` |

---

## 3. Prasyarat & Validasi Lokal (Saat Supabase CLI & Docker Tersedia)
- **Minimum PostgreSQL**: **PostgreSQL 15+** (wajib untuk sintaks column-list `ON DELETE SET NULL (column)` pada composite foreign key).
- **Extension**: `pgcrypto` pada schema `extensions`.
1. Jalankan `supabase start` dan `supabase db reset`.
2. Jalankan test suite integritas: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/database_integrity.sql` (seluruh test berjalan di dalam `BEGIN ... ROLLBACK`).
2. Periksa `supabase migration list` untuk memastikan 9 migration berstatus applied di lokal.
3. Uji `supabase db reset` ulang untuk memverifikasi `seed.sql` idempoten.
