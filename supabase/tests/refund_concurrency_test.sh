#!/usr/bin/env bash
set -euo pipefail

# Smart RT Step 09.3 — Two-Connection Refund Concurrency Test
# Requires: PostgreSQL 15+ (local Supabase stack) and psql client.
# Usage:
#   DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
#     bash supabase/tests/refund_concurrency_test.sh

DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql is not installed."
  exit 1
fi

TENANT_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
HH_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
DUE_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
BILL_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
PAY_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"

cleanup() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -q <<SQL >/dev/null 2>&1 || true
DELETE FROM public.payments WHERE parent_payment_id = '$PAY_ID' OR id = '$PAY_ID';
DELETE FROM public.bills WHERE id = '$BILL_ID';
DELETE FROM public.dues WHERE id = '$DUE_ID';
DELETE FROM public.households WHERE id = '$HH_ID';
DELETE FROM public.tenants WHERE id = '$TENANT_ID';
SQL
}
trap cleanup EXIT

echo "Setting up verified payment of 100000 for concurrency test..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q <<SQL
INSERT INTO public.tenants (id, code, name, rt_number, rw_number, kelurahan, kecamatan, city, province)
VALUES ('$TENANT_ID', 'conc-test-$TENANT_ID', 'Concurrency Test RT', '99', '99', 'Kel', 'Kec', 'Kota', 'Prov');

INSERT INTO public.households (id, tenant_id, kk_number, address)
VALUES ('$HH_ID', '$TENANT_ID', '9999999999999999', 'Jl. Concurrency Test');

INSERT INTO public.dues (id, tenant_id, name, amount, billing_cycle, target_scope)
VALUES ('$DUE_ID', '$TENANT_ID', 'Iuran Concurrency', 100000, 'monthly', 'household');

INSERT INTO public.bills (id, tenant_id, due_id, household_id, period_year, period_month, amount, paid_amount, status, due_date)
VALUES ('$BILL_ID', '$TENANT_ID', '$DUE_ID', '$HH_ID', 2026, 11, 100000, 100000, 'paid', '2026-11-30');

INSERT INTO public.payments (id, tenant_id, bill_id, payment_type, amount, payment_method, status)
VALUES ('$PAY_ID', '$TENANT_ID', '$BILL_ID', 'payment', 100000, 'transfer', 'verified');
SQL

echo "Launching two concurrent refund connections (60000 each)..."
OUT_1="$(mktemp)"
OUT_2="$(mktemp)"

(
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
    BEGIN;
    INSERT INTO public.payments (tenant_id, bill_id, payment_type, parent_payment_id, amount, payment_method, status)
    VALUES ('$TENANT_ID', '$BILL_ID', 'refund', '$PAY_ID', 60000, 'transfer', 'verified');
    SELECT pg_sleep(0.3);
    COMMIT;
  " >"$OUT_1" 2>&1
) &
PID_1=$!

(
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
    BEGIN;
    INSERT INTO public.payments (tenant_id, bill_id, payment_type, parent_payment_id, amount, payment_method, status)
    VALUES ('$TENANT_ID', '$BILL_ID', 'refund', '$PAY_ID', 60000, 'transfer', 'verified');
    SELECT pg_sleep(0.3);
    COMMIT;
  " >"$OUT_2" 2>&1
) &
PID_2=$!

STATUS_1=0
STATUS_2=0
wait "$PID_1" || STATUS_1=$?
wait "$PID_2" || STATUS_2=$?

REFUND_COUNT="$(psql "$DATABASE_URL" -t -A -c "SELECT count(*) FROM public.payments WHERE parent_payment_id = '$PAY_ID' AND payment_type = 'refund';")"
REFUND_TOTAL="$(psql "$DATABASE_URL" -t -A -c "SELECT COALESCE(sum(amount), 0) FROM public.payments WHERE parent_payment_id = '$PAY_ID' AND payment_type = 'refund';")"

rm -f "$OUT_1" "$OUT_2"

echo "Connection 1 exit: $STATUS_1 | Connection 2 exit: $STATUS_2"
echo "Final refund count: $REFUND_COUNT | Final refund total: $REFUND_TOTAL"

if [ "$REFUND_COUNT" -eq 1 ] && [ "${REFUND_TOTAL%%.*}" -eq 60000 ] && { [ "$STATUS_1" -eq 0 ] || [ "$STATUS_2" -eq 0 ]; } && { [ "$STATUS_1" -ne 0 ] || [ "$STATUS_2" -ne 0 ]; }; then
  echo "PASS: Parent payment FOR UPDATE lock serialized concurrent refunds."
  exit 0
else
  echo "FAIL: Concurrency invariant violated!"
  exit 1
fi

