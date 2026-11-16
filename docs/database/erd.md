# Entity Relationship Diagram (ERD) — Smart RT (Refined v2)

Dokumen ini menampilkan relasi lengkap 28 tabel pada arsitektur database **Smart RT** (termasuk `resident_private_data`, `payment_webhook_events`, `complaint_status_history`, dan `letter_sequences`).

---

## A. Mermaid ER Diagram

```mermaid
erDiagram
    tenants ||--o{ tenant_members : "has members"
    profiles ||--o{ tenant_members : "joins"
    tenants ||--o{ profiles : "active_tenant_id"
    tenant_members ||--o{ member_roles : "assigned"
    roles ||--o{ member_roles : "granted"

    tenants ||--o{ households : "owns"
    households ||--o{ residents : "contains"
    residents ||--o| resident_private_data : "has private data"
    residents ||--o| tenant_members : "linked account"
    residents ||--o{ resident_documents : "has docs"
    households ||--o{ vehicles : "owns"
    residents ||--o{ vehicles : "uses"

    tenants ||--o{ dues : "defines"
    dues ||--o{ bills : "generates"
    households ||--o{ bills : "billed to"
    residents ||--o{ bills : "billed to"
    bills ||--o{ payments : "settled by"
    payments ||--o{ payments : "refunds parent"
    profiles ||--o{ payments : "paid_by"
    tenants ||--o{ payment_webhook_events : "receives"

    tenants ||--o{ cash_categories : "defines"
    cash_categories ||--o{ cash_transactions : "categorizes"
    payments ||--o| cash_transactions : "reconciles"
    profiles ||--o{ cash_transactions : "created_by"

    tenants ||--o{ announcements : "publishes"
    profiles ||--o{ announcements : "authored_by"
    announcements ||--o{ announcement_recipients : "targets"
    roles ||--o{ announcement_recipients : "target role"
    households ||--o{ announcement_recipients : "target household"

    tenants ||--o{ complaints : "receives"
    tenant_members ||--o{ complaints : "reported_by"
    complaints ||--o{ complaint_replies : "has replies"
    tenant_members ||--o{ complaint_replies : "replied_by"
    complaints ||--o{ complaint_status_history : "tracks status"
    tenant_members ||--o{ complaint_status_history : "changed_by"

    tenants ||--o{ letter_types : "configures"
    tenants ||--o{ letter_sequences : "numbers"
    letter_types ||--o{ letter_requests : "template for"
    residents ||--o{ letter_requests : "subject of"
    tenant_members ||--o{ letter_requests : "requested_by"

    tenants ||--o{ activities : "organizes"
    activities ||--o{ activity_participants : "has participants"
    residents ||--o{ activity_participants : "attends"

    tenants ||--o{ notifications : "scopes"
    profiles ||--o{ notifications : "notifies"
    tenants ||--o{ audit_logs : "audits"
    profiles ||--o{ audit_logs : "actor"
```

---

## B. Penjelasan Relasi & Integritas Lintas-Tenant

1. **Composite Foreign Keys**: Seluruh relasi anak di dalam tenant menggunakan `(tenant_id, parent_id)` yang merujuk ke `UNIQUE (tenant_id, id)` pada tabel induk. Hal ini menjamin data dari tenant A tidak pernah dapat ditautkan ke induk milik tenant B.
2. **Pemisahan Identitas Sensitif (`1:1`)**: `residents` **1 : 0..1** `resident_private_data`. Data kependudukan non-sensitif dapat dibaca terpisah dari NIK dan tanggal lahir.
3. **Alur Keuangan (`bills` -> `payments` -> `cash_transactions`)**:
   - Satu `bill` dapat memiliki banyak `payments` (pembayaran parsial, pembayaran ditolak/gagal lalu bayar ulang, hingga refund).
   - `payments` bertipe `refund` mereferensikan `parent_payment_id` ke `payments.id` asal.
   - Setiap `payment` yang terverifikasi (`verified`) atau refund terverifikasi menghasilkan tepat satu baris `cash_transactions` melalui `UNIQUE (payment_id)`.
4. **Pemisahan Percakapan & Status Pengaduan**:
   - `complaint_replies` khusus menyimpan percakapan antara pelapor dan pengurus.
   - `complaint_status_history` khusus menyimpan log perubahan status yang bersifat *append-only* dan hanya dapat ditulis oleh pengurus berwenang.
5. **Penomoran Surat Aman Konkurensi**:
   - `letter_sequences` menyimpan counter nomor surat per `(tenant_id, year)` sehingga penerbitan `letter_requests.letter_number` aman terhadap request bersamaan.
