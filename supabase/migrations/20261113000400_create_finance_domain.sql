-- Step 09 Migration 0004: Finance & Cash Management Domain
-- Tables: dues, bills, payments, payment_webhook_events, cash_categories, cash_transactions

CREATE TABLE public.dues (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    name text NOT NULL,
    description text NULL,
    amount numeric(14, 2) NOT NULL
        CONSTRAINT chk_dues_amount CHECK (amount >= 0),
    billing_cycle text NOT NULL
        CONSTRAINT chk_dues_billing_cycle CHECK (billing_cycle IN ('monthly', 'yearly', 'one_time')),
    target_scope text NOT NULL
        CONSTRAINT chk_dues_target_scope CHECK (target_scope IN ('household', 'resident')),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_dues_tenant_id UNIQUE (tenant_id, id)
);

CREATE INDEX idx_dues_tenant_active
    ON public.dues (tenant_id, is_active);

-- ---------------------------------------------------------------------------

CREATE TABLE public.bills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    due_id uuid NOT NULL,
    household_id uuid NULL,
    resident_id uuid NULL,
    period_year smallint NOT NULL
        CONSTRAINT chk_bills_period_year CHECK (period_year BETWEEN 2000 AND 2100),
    period_month smallint NOT NULL
        CONSTRAINT chk_bills_period_month CHECK (period_month BETWEEN 1 AND 12),
    amount numeric(14, 2) NOT NULL
        CONSTRAINT chk_bills_amount CHECK (amount >= 0),
    paid_amount numeric(14, 2) NOT NULL DEFAULT 0
        CONSTRAINT chk_bills_paid_amount CHECK (paid_amount >= 0),
    due_date date NOT NULL,
    status text NOT NULL DEFAULT 'unpaid'
        CONSTRAINT chk_bills_status CHECK (
            status IN (
                'unpaid',
                'partial',
                'pending_verification',
                'paid',
                'overdue',
                'cancelled',
                'refunded'
            )
        ),
    paid_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_bills_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_bills_due
        FOREIGN KEY (tenant_id, due_id)
        REFERENCES public.dues (tenant_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_bills_household
        FOREIGN KEY (tenant_id, household_id)
        REFERENCES public.households (tenant_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_bills_resident
        FOREIGN KEY (tenant_id, resident_id)
        REFERENCES public.residents (tenant_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT chk_bills_exclusive_target CHECK (
        (household_id IS NOT NULL AND resident_id IS NULL)
        OR (household_id IS NULL AND resident_id IS NOT NULL)
    ),
    CONSTRAINT chk_bills_paid_status CHECK (
        status <> 'paid' OR paid_amount >= amount
    )
);

CREATE UNIQUE INDEX uq_bills_household_period
    ON public.bills (tenant_id, due_id, household_id, period_year, period_month)
    WHERE household_id IS NOT NULL AND status <> 'cancelled';

CREATE UNIQUE INDEX uq_bills_resident_period
    ON public.bills (tenant_id, due_id, resident_id, period_year, period_month)
    WHERE resident_id IS NOT NULL AND status <> 'cancelled';

CREATE INDEX idx_bills_tenant_period_status
    ON public.bills (tenant_id, period_year, period_month, status);

CREATE INDEX idx_bills_household
    ON public.bills (tenant_id, household_id, status);

-- ---------------------------------------------------------------------------

CREATE TABLE public.payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    bill_id uuid NOT NULL,
    payment_type text NOT NULL DEFAULT 'payment'
        CONSTRAINT chk_payments_type CHECK (payment_type IN ('payment', 'refund')),
    parent_payment_id uuid NULL,
    paid_by_user_id uuid NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
    amount numeric(14, 2) NOT NULL
        CONSTRAINT chk_payments_amount CHECK (amount > 0),
    payment_method text NOT NULL
        CONSTRAINT chk_payments_method CHECK (
            payment_method IN ('transfer', 'qris', 'cash', 'gateway')
        ),
    proof_storage_path text NULL,
    gateway_provider text NULL,
    gateway_reference text NULL,
    idempotency_key text NULL,
    status text NOT NULL DEFAULT 'pending'
        CONSTRAINT chk_payments_status CHECK (
            status IN ('pending', 'verified', 'failed', 'rejected', 'refunded')
        ),
    notes text NULL,
    verified_by uuid NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
    verified_at timestamptz NULL,
    paid_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_payments_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_payments_bill
        FOREIGN KEY (tenant_id, bill_id)
        REFERENCES public.bills (tenant_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_payments_parent
        FOREIGN KEY (tenant_id, parent_payment_id)
        REFERENCES public.payments (tenant_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT chk_payments_refund_parent CHECK (
        (payment_type = 'payment' AND parent_payment_id IS NULL)
        OR (payment_type = 'refund' AND parent_payment_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX uq_payments_idempotency
    ON public.payments (tenant_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_payments_tenant_status
    ON public.payments (tenant_id, status, paid_at);

CREATE INDEX idx_payments_bill
    ON public.payments (bill_id);

-- ---------------------------------------------------------------------------

CREATE TABLE public.payment_webhook_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NULL REFERENCES public.tenants (id) ON DELETE SET NULL,
    provider text NOT NULL,
    event_id text NOT NULL,
    payment_id uuid NULL,
    payload jsonb NOT NULL,
    processing_status text NOT NULL DEFAULT 'received'
        CONSTRAINT chk_webhook_processing_status CHECK (
            processing_status IN ('received', 'processed', 'ignored', 'failed')
        ),
    processed_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_webhook_provider_event UNIQUE (provider, event_id),
    CONSTRAINT chk_webhook_payment_tenant CHECK (
        payment_id IS NULL OR tenant_id IS NOT NULL
    ),
    CONSTRAINT fk_webhook_payment
        FOREIGN KEY (tenant_id, payment_id)
        REFERENCES public.payments (tenant_id, id)
        ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------------

CREATE TABLE public.cash_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    name text NOT NULL,
    type text NOT NULL
        CONSTRAINT chk_cash_categories_type CHECK (type IN ('income', 'expense')),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_cash_categories_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_cash_categories_tenant_name_type UNIQUE (tenant_id, name, type)
);

-- ---------------------------------------------------------------------------

CREATE TABLE public.cash_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    category_id uuid NOT NULL,
    payment_id uuid NULL,
    type text NOT NULL
        CONSTRAINT chk_cash_tx_type CHECK (type IN ('income', 'expense')),
    amount numeric(14, 2) NOT NULL
        CONSTRAINT chk_cash_tx_amount CHECK (amount > 0),
    transaction_date date NOT NULL,
    description text NOT NULL,
    attachment_path text NULL,
    created_by uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_cash_tx_category
        FOREIGN KEY (tenant_id, category_id)
        REFERENCES public.cash_categories (tenant_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_cash_tx_payment
        FOREIGN KEY (tenant_id, payment_id)
        REFERENCES public.payments (tenant_id, id)
        ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_cash_tx_payment
    ON public.cash_transactions (payment_id)
    WHERE payment_id IS NOT NULL;

CREATE INDEX idx_cash_tx_tenant_date
    ON public.cash_transactions (tenant_id, transaction_date);

CREATE INDEX idx_cash_tx_tenant_type
    ON public.cash_transactions (tenant_id, type);

