# Panduan Setup Supabase — Smart RT

Dokumen ini menjelaskan cara menghubungkan project **Smart RT** dengan **Supabase** (PostgreSQL, Auth, dan Storage) menggunakan `@supabase/ssr` pada Next.js App Router.

---

## 1. Membuat Project Supabase

1. Buka [Supabase Dashboard](https://supabase.com/dashboard) dan login ke akun Anda.
2. Klik **New project**.
3. Pilih **Organization**, masukkan nama project (misalnya `smart-rt`), buat **Database Password** yang kuat, dan pilih **Region** terdekat (misalnya `Southeast Asia (Singapore)`).
4. Klik **Create new project** dan tunggu hingga proses provisioning selesai.

---

## 2. Mendapatkan Project URL & Publishable / Anon Key

1. Di dalam dashboard project Supabase Anda, buka **Project Settings** (ikon roda gigi) -> **API** (atau **Data API** / **API Keys** pada tampilan terbaru).
2. Salin nilai berikut:
   - **Project URL** (contoh: `https://xxxxxxxxxxxx.supabase.co`)
   - **Publishable key** atau **anon public key**

> **Catatan Keamanan:** Jangan pernah menggunakan `service_role` key atau secret key pada environment client-side (`NEXT_PUBLIC_*`) atau commit credential asli ke Git.

---

## 3. Mengisi `.env.local`

1. Salin file `.env.example` menjadi `.env.local` di root project:

   ```bash
   cp .env.example .env.local
   ```

2. Isi nilai environment variables pada `.env.local`:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-or-anon-key
   ```

3. File `.env.local` sudah otomatis diabaikan oleh Git melalui `.gitignore` (`.env*`).

---

## 4. Menjalankan Project

Setelah `.env.local` terisi (atau bahkan sebelum diisi saat setup UI awal), jalankan server development:

```bash
npm run dev
```

Aplikasi akan berjalan di `http://localhost:3000` (Admin Dashboard) dan `http://localhost:3000/resident` (Resident App).

---

## 5. Struktur Integrasi Supabase

```text
src/
├── proxy.ts                      # Next.js 16 Proxy entry point untuk session refresh
└── lib/
    └── supabase/
        ├── config.ts             # Validasi environment variables & helper isSupabaseConfigured()
        ├── client.ts             # Browser client (createBrowserClient) untuk Client Components
        ├── server.ts             # Server client (createServerClient) untuk Server Components/Actions
        └── middleware.ts         # Helper updateSession() untuk refresh token sesi Auth
```

- **`config.ts`**: Memvalidasi `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` dengan pesan error yang jelas, serta menyediakan `isSupabaseConfigured()` agar build/dev tetap aman saat `.env.local` belum diisi.
- **`client.ts`**: Membuat Supabase client di browser menggunakan `@supabase/ssr`.
- **`server.ts`**: Membuat Supabase client di server menggunakan `cookies()` dari `next/headers`.
- **`middleware.ts` & `src/proxy.ts`**: Menjalankan `updateSession()` pada setiap request yang cocok dengan `matcher` untuk menjaga sesi Supabase Auth tetap segar tanpa melakukan redirect atau proteksi role di tahap ini.

