# Supabase Storage Design — Smart RT

Dokumen ini mendefinisikan struktur bucket, konvensi path, otorisasi akses, batasan file, dan lifecycle untuk seluruh file di **Supabase Storage**.

---

## 1. Prinsip Keamanan Storage

1. **Private by Default**: Seluruh dokumen sensitif dan operasional menggunakan **private bucket** (`public = false`). File tidak dapat diakses hanya dengan menebak URL/path.
2. **Signed URL Berjangka Pendek**: Pengunduhan file menggunakan Signed URL berdurasi terbatas (misal `60`–`300` detik untuk dokumen sensitif, `900` detik untuk lampiran operasional) yang dibuat setelah verifikasi kepemilikan/role.
3. **Identifier UUID**: Jangan menggunakan nama file asli pengguna sebagai satu-satunya identifier; gunakan UUID (`{file_id}.{ext}`) untuk mencegah tabrakan nama dan *path traversal*.
4. **Tenant Prefix Wajib**: Segmen pertama setiap path wajib `{tenant_id}/` agar RLS pada `storage.objects` dapat memvalidasi isolasi tenant secara konsisten.

---

## 2. Struktur Bucket & Konvensi Path

| Bucket ID | Visibilitas | Konvensi Path | Maks. Ukuran | Tipe File (MIME) |
| :--- | :--- | :--- | :--- | :--- |
| `resident-documents` | **Private** | `{tenant_id}/{resident_id}/{file_id}.{ext}` | 5 MB | `image/jpeg`, `image/png`, `image/webp`, `application/pdf` |
| `payment-proofs` | **Private** | `{tenant_id}/{bill_id}/{file_id}.{ext}` | 5 MB | `image/jpeg`, `image/png`, `image/webp`, `application/pdf` |
| `complaints` | **Private** | `{tenant_id}/{complaint_id}/{file_id}.{ext}` | 5 MB | `image/jpeg`, `image/png`, `image/webp` |
| `letter-requests` | **Private** | `{tenant_id}/{request_id}/{file_id}.{ext}` | 5 MB | `image/jpeg`, `image/png`, `application/pdf` |
| `issued-letters` | **Private** | `{tenant_id}/{request_id}/{file_id}.pdf` | 10 MB | `application/pdf` |
| `activity-docs` | **Private** (Tenant) | `{tenant_id}/{activity_id}/{file_id}.{ext}` | 10 MB | `image/jpeg`, `image/png`, `image/webp` |

---

## 3. Aturan Upload, Download, dan Delete

- **`resident-documents`**:
  - *Upload / Delete*: `ketua_rt`, `sekretaris`, atau warga pemilik `resident_id`.
  - *Download (Signed URL)*: `ketua_rt`, `sekretaris`, atau pemilik `resident_id`.
- **`payment-proofs`**:
  - *Upload*: `warga` (untuk `bill_id` milik rumah tangganya) atau `bendahara`/`ketua_rt`.
  - *Download*: `bendahara`, `ketua_rt`, dan anggota `household_id` terkait.
  - *Delete*: Dilarang dihapus setelah payment berstatus `verified` (audit keuangan).
- **`complaints`**:
  - *Upload*: Pelapor (`warga`) atau pengurus penindaklanjut.
  - *Download*: Seluruh pengurus tenant dan pelapor terkait.
- **`letter-requests` & `issued-letters`**:
  - *Upload `letter-requests`*: Pemohon atau `sekretaris`/`ketua_rt`.
  - *Upload `issued-letters`*: Hanya `sekretaris`, `ketua_rt`, atau proses server terpercaya.
  - *Download*: `sekretaris`, `ketua_rt`, dan pemohon/subjek surat.
- **`activity-docs`**:
  - *Upload / Delete*: `ketua_rt`, `sekretaris`, `pengurus`.
  - *Download*: Seluruh anggota aktif tenant (`is_tenant_member`).

---

## 4. Lifecycle & Pembersihan File

- **Orphan File Cleanup**: Jika pengguna mengunggah file lalu membatalkan form sebelum submit, atau saat hard-cleanup data uji, job terjadwal/Edge Function dapat membandingkan objek Storage yang lebih tua dari 24 jam dan tidak tercatat di kolom `*_path` database.
- **Retensi Audit**: Bukti pembayaran terverifikasi (`payment-proofs`) dan surat terbit (`issued-letters`) dipertahankan mengikuti masa retensi arsip keuangan/administrasi RT.

