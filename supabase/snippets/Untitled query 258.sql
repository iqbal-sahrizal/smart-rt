
SELECT
  c.conname AS constraint_name,
  pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
WHERE c.conrelid = 'public.tenant_members'::regclass
ORDER BY c.contype, c.conname;

SELECT
  t.tgname AS trigger_name,
  pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
WHERE t.tgrelid = 'public.tenant_members'::regclass
  AND NOT t.tgisinternal;
