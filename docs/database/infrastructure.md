# Supabase Infrastructure & Local Development — Smart RT

Dokumen ini mengevaluasi kesiapan infrastruktur **Supabase** pada project Smart RT serta panduan penggunaan **Supabase CLI** untuk local development dan deployment ke Supabase hosted.

---

## 1. Struktur Integrasi Saat Ini (Step 07)

| Komponen | Lokasi File | Peran |
| :--- | :--- | :--- |
| Config & Validator | [config.ts](file:///Users/iqbalsahrizal/Documents/CODING/Personal%20Project/smart-rt/src/lib/supabase/config.ts) | Validasi `NEXT_PUBLIC_SUPABASE_URL` & `NEXT_PUBLIC_SUPABASE_ANON_KEY`, menyediakan `isSupabaseConfigured()` agar build tetap aman sebelum env diisi |
| Browser Client | [client.ts](file:///Users/iqbalsahrizal/Documents/CODING/Personal%20Project/smart-rt/src/lib/supabase/client.ts) | `createBrowserClient` (`@supabase/ssr`) untuk Client Components |
| Server Client | [server.ts](file:///Users/iqbalsahrizal/Documents/CODING/Personal%20Project/smart-rt/src/lib/supabase/server.ts) | `createServerClient` (`@supabase/ssr`) dengan `await cookies()` dari `next/headers` |
| Session Helper | [middleware.ts](file:///Users/iqbalsahrizal/Documents/CODING/Personal%20Project/smart-rt/src/lib/supabase/middleware.ts) | `updateSession(request)` untuk refresh token sesi secara aman |
| Next.js 16 Proxy | [proxy.ts](file:///Users/iqbalsahrizal/Documents/CODING/Personal%20Project/smart-rt/src/proxy.ts) | Entry point `proxy()` (Next.js 16) yang memanggil `updateSession` |
| Env Template | [.env.example](file:///Users/iqbalsahrizal/Documents/CODING/Personal%20Project/smart-rt/.env.example) | Template env publik tanpa credential asli (`.env.local` diabaikan oleh `.gitignore`) |

---

## 2. Kebijakan Environment Variables

- **Publik (Aman di Browser)**:
  - `NEXT_PUBLIC_SUPABASE_URL=` (Project URL atau `http://127.0.0.1:54321` saat local).
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY=` (Anon / Publishable Key).
- **Server-Only Trusted Environment (Fase Berikutnya)**:
  - `SUPABASE_SERVICE_ROLE_KEY=` (atau Secret Key) **tidak boleh** memakai prefix `NEXT_PUBLIC_` dan **hanya** boleh dipakai pada server-side trusted routes/webhooks (misal verifikasi webhook payment gateway) setelah diaktifkan nanti.

---

## 3. Kebutuhan Supabase CLI & Struktur `supabase/`

Untuk fase implementasi database (Step 09), direkomendasikan menginisialisasi Supabase CLI di root project:

```text
supabase/
├── config.toml          # Konfigurasi local stack (Auth, Storage, DB port)
├── migrations/          # File SQL migration berurutan berdasarkan timestamp
└── seed.sql             # Data master awal (roles, dsb.) untuk local development
```

### Alur Local Development (Ketika Siap Diterapkan)
1. Install Supabase CLI dan pastikan Docker berjalan.
2. Inisialisasi folder konfigurasi: `supabase init`.
3. Jalankan stack lokal: `supabase start` (menghasilkan local API URL & anon key untuk `.env.local`).
4. Terapkan seluruh migration & seed ulang dari awal: `supabase db reset`.
5. Hasilkan TypeScript types dari schema PostgreSQL: `supabase gen types typescript --local > src/types/database.ts`.

### Menghubungkan ke Supabase Hosted
1. Login CLI: `supabase login`.
2. Hubungkan ke project hosted: `supabase link --project-ref <project-ref>`.
3. Dorong migration yang sudah teruji di lokal: `supabase db push`.

*(Catatan status: Supabase CLI lokal dan koneksi ke instance hosted **belum diinisialisasi maupun diuji** pada tahap ini karena fokus masih pada desain arsitektur dan dokumentasi.)*

