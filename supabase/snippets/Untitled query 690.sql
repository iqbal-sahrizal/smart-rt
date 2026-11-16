
SELECT id, name, code
FROM public.tenants
WHERE code ILIKE '%demo%'
   OR name ILIKE '%demo%'
   OR code ILIKE '%rt04%'
ORDER BY created_at DESC;
