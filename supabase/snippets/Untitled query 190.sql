
SELECT
  u.email,
  t.name AS tenant,
  tm.status AS membership_status,
  r.code AS role,
  p.active_tenant_id
FROM public.tenant_members tm
JOIN auth.users u ON u.id = tm.user_id
JOIN public.tenants t ON t.id = tm.tenant_id
JOIN public.profiles p ON p.id = tm.user_id
JOIN public.member_roles mr
  ON mr.member_id = tm.id
 AND mr.tenant_id = tm.tenant_id
JOIN public.roles r ON r.id = mr.role_id
WHERE u.email = 'iqbal.srizal29@gmail.com';
