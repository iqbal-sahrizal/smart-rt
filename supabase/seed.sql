-- Smart RT Development Seed Data (Idempotent)
-- Safe to re-run via `supabase db reset`.
-- Contains NO real personal data, NO super_admin account, and NO secrets.

-- 1. Default Tenant Roles
INSERT INTO public.roles (code, name, description)
VALUES
    ('ketua_rt', 'Ketua RT', 'Penanggung jawab utama operasional dan persetujuan RT'),
    ('sekretaris', 'Sekretaris', 'Pengelola data kependudukan, pengumuman, dan surat pengantar'),
    ('bendahara', 'Bendahara', 'Pengelola iuran, verifikasi pembayaran, dan buku kas RT'),
    ('pengurus', 'Pengurus', 'Pengurus operasional lingkungan, pengaduan, dan kegiatan'),
    ('warga', 'Warga', 'Warga terdaftar pada lingkungan RT')
ON CONFLICT (code) DO NOTHING;

-- 2. Example Development Tenant + Default Categories & Letter Types
DO $$
DECLARE
    v_tenant_id uuid;
BEGIN
    INSERT INTO public.tenants (
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
    SELECT
        'rt-04-rw-02-demo',
        'RT 04 / RW 02 (Demo)',
        '04',
        '02',
        'Kelurahan Contoh',
        'Kecamatan Contoh',
        'Kota Contoh',
        'Provinsi Contoh',
        'active',
        '{"letter_number_format": "{seq}/RT04-RW02/{month}/{year}"}'::jsonb
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.tenants
        WHERE code = 'rt-04-rw-02-demo'
          AND deleted_at IS NULL
    );

    SELECT id
    INTO v_tenant_id
    FROM public.tenants
    WHERE code = 'rt-04-rw-02-demo'
      AND deleted_at IS NULL
    LIMIT 1;

    IF v_tenant_id IS NOT NULL THEN
        -- Default Cash Categories
        INSERT INTO public.cash_categories (tenant_id, name, type)
        VALUES
            (v_tenant_id, 'Iuran Bulanan Warga', 'income'),
            (v_tenant_id, 'Sumbangan & Donasi', 'income'),
            (v_tenant_id, 'Kebersihan & Pengelolaan Sampah', 'expense'),
            (v_tenant_id, 'Keamanan & Penerangan', 'expense'),
            (v_tenant_id, 'Operasional & Kegiatan RT', 'expense'),
            (v_tenant_id, 'Pengembalian Dana (Refund)', 'expense')
        ON CONFLICT (tenant_id, name, type) DO NOTHING;

        -- Default Letter Types
        INSERT INTO public.letter_types (tenant_id, code, name, description, required_documents)
        VALUES
            (
                v_tenant_id,
                'DOMISILI',
                'Surat Pengantar Domisili',
                'Surat keterangan domisili warga di lingkungan RT',
                '["Fotokopi KTP", "Fotokopi KK"]'::jsonb
            ),
            (
                v_tenant_id,
                'PENGANTAR_KTP',
                'Surat Pengantar Pembuatan / Perpanjangan KTP',
                'Pengantar administrasi kependudukan ke kelurahan',
                '["Fotokopi KK"]'::jsonb
            ),
            (
                v_tenant_id,
                'SKTM',
                'Surat Keterangan Tidak Mampu',
                'Pengantar pengurusan keringanan pendidikan atau kesehatan',
                '["Fotokopi KTP", "Fotokopi KK"]'::jsonb
            )
        ON CONFLICT (tenant_id, code) DO NOTHING;
    END IF;
END $$;

