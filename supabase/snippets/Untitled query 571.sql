
-- Cek akun yang baru dibuat
SELECT id, email
FROM auth.users
ORDER BY created_at DESC;

-- Cek apakah profile otomatis dibuat
SELECT *
FROM public.profiles
ORDER BY created_at DESC
LIMIT 5;

-- Cek struktur membership
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('tenant_members', 'member_roles', 'roles')
ORDER BY table_name, ordinal_position;
