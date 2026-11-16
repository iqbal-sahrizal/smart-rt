
SELECT jsonb_build_object(
  'columns', (
    SELECT jsonb_agg(jsonb_build_object(
      'column', column_name,
      'type', data_type,
      'nullable', is_nullable,
      'default', column_default
    ) ORDER BY ordinal_position)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tenant_members'
  ),
  'constraints', (
    SELECT jsonb_agg(jsonb_build_object(
      'name', conname,
      'definition', pg_get_constraintdef(oid)
    ))
    FROM pg_constraint
    WHERE conrelid = 'public.tenant_members'::regclass
  ),
  'indexes', (
    SELECT jsonb_agg(indexdef)
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'tenant_members'
  )
) AS membership_schema;
