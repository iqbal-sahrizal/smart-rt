#!/usr/bin/env bash
set -euo pipefail

# Smart RT Step 10.2.2.25 — Migration 0016 True Two-Session Concurrency Tests
# Tests:
#   A. Concurrent acquire_orphan_scan_lease() mutual exclusion across 2 sessions
#   B. Concurrent multi-file complete_storage_deletion() on same letter_request without lost update
#
# Cleans up all temporary fixtures and resets storage_orphan_scan_state via EXIT trap.

run_psql() {
  if command -v psql >/dev/null 2>&1 && [ -n "${DATABASE_URL:-}" ]; then
    psql "$DATABASE_URL" "$@"
  else
    docker exec -i supabase_db_smart-rt psql -U postgres -d postgres "$@"
  fi
}

TENANT_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
USER_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
HH_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
RES_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
MEMBER_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
LT_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
LR_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"

FILE_1="$TENANT_ID/$LR_ID/$(uuidgen | tr '[:upper:]' '[:lower:]').pdf"
FILE_2="$TENANT_ID/$LR_ID/$(uuidgen | tr '[:upper:]' '[:lower:]').pdf"
FILE_3="$TENANT_ID/$LR_ID/$(uuidgen | tr '[:upper:]' '[:lower:]').pdf"

cleanup() {
  run_psql -v ON_ERROR_STOP=0 -q >/dev/null 2>&1 <<SQL || true
UPDATE public.storage_orphan_scan_state
   SET cursor = NULL, scan_token = NULL, lease_expires_at = NULL,
       cycle_started_at = NULL, cycle_completed_at = NULL, updated_at = now()
 WHERE id = 1;
DELETE FROM public.audit_logs WHERE tenant_id = '$TENANT_ID' OR entity_id = '$LR_ID';
DELETE FROM public.storage_deletion_queue WHERE tenant_id = '$TENANT_ID';
DELETE FROM public.letter_requests WHERE id = '$LR_ID';
DELETE FROM public.letter_types WHERE id = '$LT_ID';
DELETE FROM public.tenant_members WHERE id = '$MEMBER_ID';
DELETE FROM public.residents WHERE id = '$RES_ID';
DELETE FROM public.households WHERE id = '$HH_ID';
DELETE FROM auth.users WHERE id = '$USER_ID';
DELETE FROM public.tenants WHERE id = '$TENANT_ID';
SQL
}
trap cleanup EXIT

echo "=== Concurrency Test A: acquire_orphan_scan_lease() Two-Session Race ==="
run_psql -v ON_ERROR_STOP=1 -q <<SQL
UPDATE public.storage_orphan_scan_state
   SET cursor = NULL, scan_token = NULL, lease_expires_at = NULL,
       cycle_started_at = NULL, cycle_completed_at = NULL, updated_at = now()
 WHERE id = 1;
SQL

OUT_A1="$(mktemp)"
OUT_A2="$(mktemp)"

(
  run_psql -t -A -v ON_ERROR_STOP=1 <<SQL >"$OUT_A1" 2>&1
BEGIN;
SET LOCAL ROLE service_role;
SELECT acquired::text || '|' || COALESCE(scan_token::text, 'NULL')
FROM public.acquire_orphan_scan_lease(interval '5 minutes');
SELECT pg_sleep(0.35);
COMMIT;
SQL
) &
PID_A1=$!

(
  run_psql -t -A -v ON_ERROR_STOP=1 <<SQL >"$OUT_A2" 2>&1
BEGIN;
SET LOCAL ROLE service_role;
SELECT acquired::text || '|' || COALESCE(scan_token::text, 'NULL')
FROM public.acquire_orphan_scan_lease(interval '5 minutes');
COMMIT;
SQL
) &
PID_A2=$!

wait "$PID_A1"
wait "$PID_A2"

RES_A1="$(grep -E '^(true|false)\|' "$OUT_A1" | head -n1 || true)"
RES_A2="$(grep -E '^(true|false)\|' "$OUT_A2" | head -n1 || true)"
if [ -z "$RES_A1" ] || [ -z "$RES_A2" ]; then
  echo "DEBUG OUT_A1:"; cat "$OUT_A1"
  echo "DEBUG OUT_A2:"; cat "$OUT_A2"
fi
rm -f "$OUT_A1" "$OUT_A2"

echo "Session 1: $RES_A1 | Session 2: $RES_A2"

TRUE_COUNT=0
FALSE_COUNT=0
for r in "$RES_A1" "$RES_A2"; do
  case "$r" in
    true\|*) TRUE_COUNT=$((TRUE_COUNT + 1)) ;;
    false\|NULL) FALSE_COUNT=$((FALSE_COUNT + 1)) ;;
    *) echo "FAIL A: Unexpected result format: $r"; exit 1 ;;
  esac
done

if [ "$TRUE_COUNT" -ne 1 ] || [ "$FALSE_COUNT" -ne 1 ]; then
  echo "FAIL A: Expected exactly 1 acquired=true and 1 acquired=false (got true=$TRUE_COUNT, false=$FALSE_COUNT)"
  exit 1
fi
echo "PASS A: Singleton orphan lease mutual exclusion serialized concurrent sessions."

echo "=== Concurrency Test B: Parallel Multi-File Deletion & Retention Sweep ==="
run_psql -v ON_ERROR_STOP=1 -q <<SQL
INSERT INTO public.tenants (id, code, name, rt_number, rw_number, kelurahan, kecamatan, city, province)
VALUES ('$TENANT_ID', 'conc-m16-$TENANT_ID', 'Conc M16 RT', '98', '99', 'Kel', 'Kec', 'Kota', 'Prov');

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES ('$USER_ID', 'conc_m16_${USER_ID}@test.local', '{"full_name":"Conc M16"}'::jsonb);

INSERT INTO public.households (id, tenant_id, kk_number, address)
VALUES ('$HH_ID', '$TENANT_ID', '3171888800000001', 'Jl. Conc M16');

INSERT INTO public.residents (id, tenant_id, household_id, full_name, gender, family_role)
VALUES ('$RES_ID', '$TENANT_ID', '$HH_ID', 'Resident Conc', 'L', 'kepala_keluarga');

INSERT INTO public.tenant_members (id, tenant_id, user_id, resident_id, status)
VALUES ('$MEMBER_ID', '$TENANT_ID', '$USER_ID', '$RES_ID', 'active');

INSERT INTO public.letter_types (id, tenant_id, code, name)
VALUES ('$LT_ID', '$TENANT_ID', 'CONC', 'Surat Conc');

BEGIN;
SELECT set_config('app.storage_ref_ctx', 'rpc_authorized', true);
INSERT INTO public.letter_requests (
    id, tenant_id, letter_type_id, resident_id, requested_by_member_id,
    purpose, supporting_doc_paths, status, updated_at
)
VALUES (
    '$LR_ID', '$TENANT_ID', '$LT_ID', '$RES_ID', '$MEMBER_ID',
    'Concurrency multi-doc test',
    jsonb_build_array('$FILE_1', '$FILE_2', '$FILE_3'),
    'cancelled',
    clock_timestamp() - interval '10 days'
);
SELECT set_config('app.storage_ref_ctx', '', true);
COMMIT;
SQL

# Enqueue all 3 files via retention sweep
ENQ_OUT="$(run_psql -t -A -v ON_ERROR_STOP=1 <<SQL | grep -E '^[0-9]+\|[0-9]+$' | head -n1
BEGIN;
SET LOCAL ROLE service_role;
SELECT enqueued_count || '|' || skipped_count FROM public.enqueue_soft_deleted_domain_storage_deletions(interval '7 days', 100);
COMMIT;
SQL
)"
echo "Retention enqueue: $ENQ_OUT"

JOB_1="$(run_psql -t -A -v ON_ERROR_STOP=1 -c "SELECT id FROM public.storage_deletion_queue WHERE bucket_id = 'letter-requests' AND object_path = '$FILE_1';")"
JOB_2="$(run_psql -t -A -v ON_ERROR_STOP=1 -c "SELECT id FROM public.storage_deletion_queue WHERE bucket_id = 'letter-requests' AND object_path = '$FILE_2';")"
TOK_1="$(uuidgen | tr '[:upper:]' '[:lower:]')"
TOK_2="$(uuidgen | tr '[:upper:]' '[:lower:]')"

run_psql -v ON_ERROR_STOP=1 -q <<SQL
UPDATE public.storage_deletion_queue
   SET status = 'processing', claim_token = '$TOK_1', claimed_at = clock_timestamp(),
       lease_expires_at = clock_timestamp() + interval '5 minutes', attempt_count = 1
 WHERE id = '$JOB_1';
UPDATE public.storage_deletion_queue
   SET status = 'processing', claim_token = '$TOK_2', claimed_at = clock_timestamp(),
       lease_expires_at = clock_timestamp() + interval '5 minutes', attempt_count = 1
 WHERE id = '$JOB_2';

BEGIN;
SET LOCAL ROLE service_role;
SELECT public.begin_storage_deletion('$JOB_1', '$TOK_1');
SELECT public.begin_storage_deletion('$JOB_2', '$TOK_2');
COMMIT;
SQL

OUT_B1="$(mktemp)"
OUT_B2="$(mktemp)"
OUT_B3="$(mktemp)"

(
  run_psql -t -A -v ON_ERROR_STOP=1 <<SQL >"$OUT_B1" 2>&1
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.complete_storage_deletion('$JOB_1', '$TOK_1', 'deleted');
SELECT pg_sleep(0.35);
COMMIT;
SQL
) &
PID_B1=$!

(
  run_psql -t -A -v ON_ERROR_STOP=1 <<SQL >"$OUT_B2" 2>&1
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.complete_storage_deletion('$JOB_2', '$TOK_2', 'deleted');
COMMIT;
SQL
) &
PID_B2=$!

(
  run_psql -t -A -v ON_ERROR_STOP=1 <<SQL >"$OUT_B3" 2>&1
BEGIN;
SET LOCAL ROLE service_role;
SELECT enqueued_count || '|' || skipped_count FROM public.enqueue_soft_deleted_domain_storage_deletions(interval '7 days', 100);
COMMIT;
SQL
) &
PID_B3=$!

wait "$PID_B1"
wait "$PID_B2"
wait "$PID_B3"

rm -f "$OUT_B1" "$OUT_B2" "$OUT_B3"

REM_CHECK="$(run_psql -t -A -v ON_ERROR_STOP=1 -c "
SELECT jsonb_array_length(supporting_doc_paths) || '|' ||
       (supporting_doc_paths ? '$FILE_1')::text || '|' ||
       (supporting_doc_paths ? '$FILE_2')::text || '|' ||
       (supporting_doc_paths ? '$FILE_3')::text
FROM public.letter_requests WHERE id = '$LR_ID';
")"
DONE_JOBS="$(run_psql -t -A -v ON_ERROR_STOP=1 -c "
SELECT count(*) FILTER (WHERE status = 'completed') || '|' || count(*) FILTER (WHERE status = 'pending')
FROM public.storage_deletion_queue WHERE entity_id = '$LR_ID';
")"

echo "Remaining supporting_doc_paths state: $REM_CHECK | Queue jobs (completed|pending): $DONE_JOBS"

if [ "$REM_CHECK" != "1|false|false|true" ] || [ "$DONE_JOBS" != "2|1" ]; then
  echo "FAIL B: Lost update or unexpected queue state detected! (REM_CHECK=$REM_CHECK, DONE_JOBS=$DONE_JOBS)"
  exit 1
fi

echo "PASS B: Concurrent multi-file completion & retention sweep succeeded with zero lost updates or deadlocks."
