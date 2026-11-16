
SELECT jsonb_build_object(
  'auth_users', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id,
      'email', email
    )), '[]'::jsonb)
    FROM auth.users
  ),
  'profiles', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id,
      'is_super_admin', is_super_admin,
      'active_tenant_id', active_tenant_id
    )), '[]'::jsonb)
    FROM public.profiles
  ),
  'roles', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id,
      'code', code,
      'name', name
    )), '[]'::jsonb)
    FROM public.roles
  ),
  'demo_memberships', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', tm.id,
      'user_id', tm.user_id,
      'status', tm.status,
      'resident_id', tm.resident_id
    )), '[]'::jsonb)
    FROM public.tenant_members tm
    WHERE tm.tenant_id = '4ccd2245-c6f2-4436-a44f-3b34046bad8f'
  )
) AS setup_check;
