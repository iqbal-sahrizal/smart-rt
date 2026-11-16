
BEGIN;

DO $$
DECLARE
  v_user_id UUID;
  v_tenant_id UUID;
  v_member_id UUID;
  v_role_id UUID;
BEGIN
  -- Cari akun berdasarkan email
  SELECT id INTO STRICT v_user_id
  FROM auth.users
  WHERE email = 'iqbal.srizal29@gmail.com';

  -- Pastikan bukan super admin
  IF EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = v_user_id
      AND is_super_admin = TRUE
  ) THEN
    RAISE EXCEPTION 'Akun ini adalah super admin. Proses dibatalkan.';
  END IF;

  -- Cari tenant demo
  SELECT id INTO STRICT v_tenant_id
  FROM public.tenants
  WHERE code = 'rt-04-rw-02-demo';

  -- Cari role ketua RT
  SELECT id INTO STRICT v_role_id
  FROM public.roles
  WHERE code = 'ketua_rt';

  -- Buat atau aktifkan membership
  INSERT INTO public.tenant_members (
    tenant_id,
    user_id,
    status,
    joined_at
  )
  VALUES (
    v_tenant_id,
    v_user_id,
    'active',
    NOW()
  )
  ON CONFLICT (tenant_id, user_id)
  DO UPDATE SET
    status = 'active',
    joined_at = COALESCE(
      public.tenant_members.joined_at,
      NOW()
    ),
    updated_at = NOW()
  RETURNING id INTO v_member_id;

  -- Berikan role Ketua RT
  INSERT INTO public.member_roles (
    tenant_id,
    member_id,
    role_id,
    assigned_by
  )
  VALUES (
    v_tenant_id,
    v_member_id,
    v_role_id,
    NULL
  )
  ON CONFLICT (member_id, role_id)
  DO NOTHING;

  -- Atur tenant aktif sebagai preferensi
  UPDATE public.profiles
  SET active_tenant_id = v_tenant_id
  WHERE id = v_user_id;

  RAISE NOTICE 'Bootstrap Ketua RT berhasil untuk %',
    'iqbal.srizal29@gmail.com';
END $$;

COMMIT;
