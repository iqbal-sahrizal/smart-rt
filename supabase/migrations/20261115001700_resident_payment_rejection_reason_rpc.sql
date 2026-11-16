-- Step 11.5 Migration 0017: Resident Read-Only Payment Rejection Reason RPC
-- Allows an authenticated resident who owns a bill or payment to view the
-- rejection reason recorded in audit_logs for their own rejected payments
-- without loosening audit_logs RLS or using service_role in application code.

CREATE OR REPLACE FUNCTION public.get_my_payment_rejection_reasons(
    p_bill_id uuid
)
RETURNS TABLE (
    payment_id uuid,
    reason text,
    rejected_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_bill record;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated' USING ERRCODE = '42501';
    END IF;

    SELECT b.id, b.tenant_id, b.household_id, b.resident_id
    INTO v_bill
    FROM public.bills b
    WHERE b.id = p_bill_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF NOT public.is_tenant_member(v_bill.tenant_id)
       OR NOT (
           (v_bill.household_id IS NOT NULL AND v_bill.household_id = public.get_my_household_id(v_bill.tenant_id))
           OR (v_bill.resident_id IS NOT NULL AND v_bill.resident_id = public.get_my_resident_id(v_bill.tenant_id))
           OR EXISTS (
               SELECT 1
               FROM public.payments p0
               WHERE p0.bill_id = v_bill.id
                 AND p0.tenant_id = v_bill.tenant_id
                 AND p0.paid_by_user_id = v_actor
           )
       ) THEN
        RAISE EXCEPTION 'Forbidden: caller does not own bill %', p_bill_id
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT DISTINCT ON (p.id)
        p.id AS payment_id,
        NULLIF(btrim(al.metadata ->> 'reason'), '') AS reason,
        al.created_at AS rejected_at
    FROM public.payments p
    JOIN public.audit_logs al
      ON al.tenant_id = p.tenant_id
     AND al.entity_type = 'payments'
     AND al.entity_id = p.id
     AND al.action = 'payment.rejected'
    WHERE p.bill_id = v_bill.id
      AND p.tenant_id = v_bill.tenant_id
      AND p.status = 'rejected'
      AND (
          p.paid_by_user_id = v_actor
          OR (v_bill.household_id IS NOT NULL AND v_bill.household_id = public.get_my_household_id(v_bill.tenant_id))
          OR (v_bill.resident_id IS NOT NULL AND v_bill.resident_id = public.get_my_resident_id(v_bill.tenant_id))
      )
    ORDER BY p.id, al.created_at DESC;
END;
$$;

ALTER FUNCTION public.get_my_payment_rejection_reasons(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_my_payment_rejection_reasons(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_payment_rejection_reasons(uuid) TO authenticated;

