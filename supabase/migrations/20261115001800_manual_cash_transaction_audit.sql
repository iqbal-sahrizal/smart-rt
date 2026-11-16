-- Step 11.6.1 Migration 0018: Manual Cash Expenditure Audit Trail
-- Adds database-side immutability/actor guards and an AFTER INSERT OR UPDATE
-- trigger on public.cash_transactions to record manual expense operations
-- in public.audit_logs without granting clients direct INSERT access.

BEGIN;

-- 1. Enforce trusted actor & immutable payment-linked cash rows before write
CREATE OR REPLACE FUNCTION public.guard_manual_cash_transaction_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_actor uuid := auth.uid();
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Authenticated clients creating manual rows cannot spoof created_by
        IF v_actor IS NOT NULL AND NEW.payment_id IS NULL THEN
            IF NEW.created_by IS DISTINCT FROM v_actor THEN
                RAISE EXCEPTION 'Forbidden: created_by must match authenticated actor'
                    USING ERRCODE = '42501';
            END IF;
        END IF;
        RETURN NEW;
    END IF;

    -- TG_OP = 'UPDATE'
    IF v_actor IS NOT NULL THEN
        IF OLD.payment_id IS NOT NULL OR NEW.payment_id IS NOT NULL THEN
            RAISE EXCEPTION 'Forbidden: payment-linked cash transactions are immutable'
                USING ERRCODE = '42501';
        END IF;

        IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
           OR OLD.type IS DISTINCT FROM NEW.type
           OR OLD.created_by IS DISTINCT FROM NEW.created_by
           OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
            RAISE EXCEPTION 'Forbidden: immutable cash transaction attributes cannot be changed'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.guard_manual_cash_transaction_write() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_manual_cash_transaction_write() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_cash_tx_guard_manual_write ON public.cash_transactions;
CREATE TRIGGER trg_cash_tx_guard_manual_write
    BEFORE INSERT OR UPDATE ON public.cash_transactions
    FOR EACH ROW EXECUTE FUNCTION public.guard_manual_cash_transaction_write();

-- 2. Record audit_logs entry for manual cash expense INSERT and UPDATE
CREATE OR REPLACE FUNCTION public.audit_manual_cash_expense()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_action text;
    v_metadata jsonb;
BEGIN
    -- Skip payment/refund-linked transactions (already audited by verify_payment / refund_payment)
    IF NEW.payment_id IS NOT NULL OR NEW.type <> 'expense' THEN
        RETURN NULL;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.payment_id IS NOT NULL THEN
        RETURN NULL;
    END IF;

    -- Fallback only for non-JWT DB/migration operations on INSERT
    IF v_actor IS NULL AND TG_OP = 'INSERT' THEN
        v_actor := NEW.created_by;
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_action := 'cash_transaction.manual_expense_created';
        v_metadata := jsonb_build_object(
            'operation', 'INSERT',
            'transaction_id', NEW.id,
            'type', NEW.type,
            'after', jsonb_build_object(
                'category_id', NEW.category_id,
                'amount', NEW.amount,
                'transaction_date', NEW.transaction_date,
                'description', NEW.description
            )
        );
    ELSE
        v_action := 'cash_transaction.manual_expense_updated';
        v_metadata := jsonb_build_object(
            'operation', 'UPDATE',
            'transaction_id', NEW.id,
            'type', NEW.type,
            'before', jsonb_build_object(
                'category_id', OLD.category_id,
                'amount', OLD.amount,
                'transaction_date', OLD.transaction_date,
                'description', OLD.description
            ),
            'after', jsonb_build_object(
                'category_id', NEW.category_id,
                'amount', NEW.amount,
                'transaction_date', NEW.transaction_date,
                'description', NEW.description
            )
        );
    END IF;

    INSERT INTO public.audit_logs (
        tenant_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
    )
    VALUES (
        NEW.tenant_id,
        v_actor,
        v_action,
        'cash_transactions',
        NEW.id,
        v_metadata
    );

    RETURN NULL;
END;
$$;

ALTER FUNCTION public.audit_manual_cash_expense() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.audit_manual_cash_expense() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_cash_tx_audit_manual_expense ON public.cash_transactions;
CREATE TRIGGER trg_cash_tx_audit_manual_expense
    AFTER INSERT OR UPDATE ON public.cash_transactions
    FOR EACH ROW EXECUTE FUNCTION public.audit_manual_cash_expense();

COMMIT;

