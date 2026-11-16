/**
 * Smart RT Storage Deletion Worker (Supabase Edge Function)
 *
 * Processes pending/retryable rows in `public.storage_deletion_queue` strictly
 * through Migration 0015 worker RPCs and Supabase Storage API using `service_role`.
 *
 * Security boundaries:
 * - Never accesses `storage_deletion_queue` directly.
 * - Uses `SUPABASE_SERVICE_ROLE_KEY` strictly inside Edge Function environment.
 * - Requires internal bearer secret (`STORAGE_DELETION_WORKER_SECRET`).
 * - Never logs keys, `claim_token`, JWTs, or resident PII.
 */

export const ALLOWED_BUCKETS = [
  'resident-documents',
  'payment-proofs',
  'complaints',
  'letter-requests',
  'issued-letters',
  'activity-docs',
] as const;

export type AllowedBucket = (typeof ALLOWED_BUCKETS)[number];
export type DeletionDecision = 'delete_physical' | 'detach_only';
export type StorageDeleteOutcome = 'deleted' | 'not_found';
export type CompleteStorageResult = 'deleted' | 'not_found' | 'skipped';
export type WorkerMode = 'process' | 'orphan_scan' | 'all';

export interface ClaimedDeletionJob {
  job_id: string;
  tenant_id: string;
  bucket_id: string;
  object_path: string;
  entity_type: string;
  entity_id: string | null;
  attempt_count: number;
  claim_token: string;
  claimed_at: string;
  lease_expires_at: string;
  db_now: string;
}

export interface LeaseRenewalResult {
  renewed: boolean;
  lease_expires_at: string | null;
  db_now: string;
}

export interface StorageListEntry {
  name: string;
  id: string | null;
  created_at: string | null;
  archived_at?: string | null;
  is_delete_marker?: boolean | null;
}

export interface StorageRemoveResult {
  kind: 'deleted' | 'not_found' | 'unauthorized' | 'retryable_error';
  errorCode?: string;
}

export interface StorageListResult {
  entries: StorageListEntry[];
}

export interface WorkerGateway {
  claimStorageDeletionJobs(batchSize: number, leaseInterval: string): Promise<ClaimedDeletionJob[]>;
  beginStorageDeletion(jobId: string, claimToken: string): Promise<DeletionDecision>;
  renewStorageDeletionLease(
    jobId: string,
    claimToken: string,
    leaseInterval: string
  ): Promise<LeaseRenewalResult>;
  completeStorageDeletion(
    jobId: string,
    claimToken: string,
    storageResult: CompleteStorageResult
  ): Promise<'completed' | 'object_still_present'>;
  failStorageDeletion(jobId: string, claimToken: string, errorMessage: string): Promise<'failed' | 'exhausted'>;
  enqueueOrphanStorageDeletion(
    bucketId: string,
    objectPath: string,
    orphanRetentionInterval: string
  ): Promise<
    | 'created'
    | 'skipped_too_young'
    | 'skipped_referenced'
    | 'skipped_active_job'
    | 'rejected_invalid_path'
    | 'rejected_unknown_tenant'
  >;
  recordInvalidStoragePath(bucketId: string, objectPath: string, reason: string): Promise<string>;
  removeStorageObject(bucketId: string, objectPath: string, timeoutMs: number): Promise<StorageRemoveResult>;
  listStorageObjects(
    bucketId: string,
    prefix: string,
    limit: number,
    offset: number,
    timeoutMs: number
  ): Promise<StorageListResult>;
}

export interface WorkerConfig {
  batchSize: number;
  leaseSeconds: number;
  storageHttpTimeoutMs: number;
  dbRpcTimeoutMs: number;
  renewMarginMs: number;
  maxJobsPerInvocation: number;
  invocationTimeoutMs: number;
  orphanRetentionHours: number;
  maxOrphanScansPerInvocation: number;
  orphanListPageSize: number;
  finalizationRetryDelayMs: number;
  maxFinalizationAttempts: number;
}

export interface OrphanScanPrefixFrame {
  prefix: string;
  depth: number;
  afterName: string | null;
  afterIsFolder: boolean;
  offset: number;
}

export interface OrphanScanCursor {
  v: 1;
  bucketIndex: number;
  queue: OrphanScanPrefixFrame[];
}

export interface WorkerRunOptions {
  mode?: WorkerMode;
  batchSize?: number;
  maxJobsPerInvocation?: number;
  maxOrphanScansPerInvocation?: number;
  orphanCursor?: string | OrphanScanCursor | null;
  buckets?: readonly string[];
  nowMs?: () => number;
  wallClockMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
  logger?: (entry: StructuredLogEntry) => void;
}

export interface WorkerRunSummary {
  mode: WorkerMode;
  claimed: number;
  completed: number;
  detachedOnly: number;
  notFoundIdempotent: number;
  retried: number;
  exhausted: number;
  objectStillPresent: number;
  staleAbandoned: number;
  finalizationFailed: number;
  orphanScan: {
    bucketsScanned: number;
    objectsInspected: number;
    enqueued: number;
    quarantined: number;
    skippedTooYoung: number;
    skippedReferenced: number;
    skippedActiveJob: number;
    rejectedUnknownTenant: number;
    errors: number;
    nextCursor: string | null;
    cycleCompleted: boolean;
  };
  stoppedReason: 'drained' | 'max_jobs_reached' | 'timeout_budget' | 'claim_error' | 'orphan_only';
  durationMs: number;
}

export interface StructuredLogEntry {
  ts: string;
  level: 'info' | 'warn' | 'error';
  event: string;
  [key: string]: unknown;
}

const CANONICAL_OBJECT_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$/;

const ALLOWED_BUCKET_SET = new Set<string>(ALLOWED_BUCKETS);

export const DEFAULT_WORKER_CONFIG: WorkerConfig = {
  batchSize: 10,
  leaseSeconds: 300, // 5 minutes (bounded [1 min, 15 min] in SQL)
  storageHttpTimeoutMs: 60_000, // 60 seconds
  dbRpcTimeoutMs: 10_000, // covers SQL lock_timeout = '5s' cleanly
  renewMarginMs: 120_000, // 2 minutes (>= 2 * storageHttpTimeoutMs)
  maxJobsPerInvocation: 50,
  invocationTimeoutMs: 110_000,
  orphanRetentionHours: 24,
  maxOrphanScansPerInvocation: 100,
  orphanListPageSize: 50,
  finalizationRetryDelayMs: 300,
  maxFinalizationAttempts: 2,
};

export function isAllowedBucket(bucketId: string): bucketId is AllowedBucket {
  return ALLOWED_BUCKET_SET.has(bucketId);
}

export function isValidCanonicalObjectPath(objectPath: string): boolean {
  return CANONICAL_OBJECT_PATH_RE.test(objectPath);
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function loadWorkerConfig(envGet: (name: string) => string | undefined): WorkerConfig {
  const storageHttpTimeoutMs = clampInt(
    envGet('WORKER_STORAGE_TIMEOUT_MS'),
    DEFAULT_WORKER_CONFIG.storageHttpTimeoutMs,
    1_000,
    120_000
  );
  const leaseSeconds = clampInt(envGet('WORKER_LEASE_SECONDS'), DEFAULT_WORKER_CONFIG.leaseSeconds, 60, 900);
  const minMargin = Math.min(storageHttpTimeoutMs * 2, Math.floor(leaseSeconds * 1000 * 0.8));
  const rawMargin = clampInt(
    envGet('WORKER_RENEW_MARGIN_MS'),
    DEFAULT_WORKER_CONFIG.renewMarginMs,
    minMargin,
    leaseSeconds * 1000 - 5_000
  );

  return {
    batchSize: clampInt(envGet('WORKER_BATCH_SIZE'), DEFAULT_WORKER_CONFIG.batchSize, 1, 100),
    leaseSeconds,
    storageHttpTimeoutMs,
    dbRpcTimeoutMs: clampInt(envGet('WORKER_DB_TIMEOUT_MS'), DEFAULT_WORKER_CONFIG.dbRpcTimeoutMs, 2_000, 30_000),
    renewMarginMs: Math.max(rawMargin, minMargin),
    maxJobsPerInvocation: clampInt(
      envGet('WORKER_MAX_JOBS_PER_INVOCATION'),
      DEFAULT_WORKER_CONFIG.maxJobsPerInvocation,
      1,
      500
    ),
    invocationTimeoutMs: clampInt(
      envGet('WORKER_INVOCATION_TIMEOUT_MS'),
      DEFAULT_WORKER_CONFIG.invocationTimeoutMs,
      5_000,
      240_000
    ),
    orphanRetentionHours: clampInt(
      envGet('WORKER_ORPHAN_RETENTION_HOURS'),
      DEFAULT_WORKER_CONFIG.orphanRetentionHours,
      1,
      24 * 30
    ),
    maxOrphanScansPerInvocation: clampInt(
      envGet('WORKER_ORPHAN_SCAN_LIMIT'),
      DEFAULT_WORKER_CONFIG.maxOrphanScansPerInvocation,
      1,
      1_000
    ),
    orphanListPageSize: DEFAULT_WORKER_CONFIG.orphanListPageSize,
    finalizationRetryDelayMs: DEFAULT_WORKER_CONFIG.finalizationRetryDelayMs,
    maxFinalizationAttempts: DEFAULT_WORKER_CONFIG.maxFinalizationAttempts,
  };
}

const SENSITIVE_KEY_RE = /(secret|token|key|authorization|password|cookie|credential)/i;
const JWT_OR_BEARER_RE = /\b(Bearer\s+[A-Za-z0-9._-]+|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*|sb_(?:secret|publishable)_[A-Za-z0-9_-]+)\b/gi;

export function redactSensitiveString(input: string, maxLen = 240): string {
  const scrubbed = input.replace(JWT_OR_BEARER_RE, '[REDACTED]').replace(/[\r\n\t]+/g, ' ').trim();
  return scrubbed.length > maxLen ? `${scrubbed.slice(0, maxLen)}...` : scrubbed;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactSensitiveString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 4) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = sanitizeValue(v, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

export function defaultLogger(entry: StructuredLogEntry): void {
  const safe = sanitizeValue(entry) as StructuredLogEntry;
  const line = JSON.stringify(safe);
  if (safe.level === 'error') {
    console.error(line);
  } else if (safe.level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export class WorkerRpcError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, status: number, code = 'rpc_error', retryable = false) {
    super(redactSensitiveString(message));
    this.name = 'WorkerRpcError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export function isStaleClaimError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('stale_claim:');
}

function toSafeErrorCode(err: unknown): string {
  if (err instanceof WorkerRpcError) {
    return redactSensitiveString(`${err.code}:${err.status}:${err.message}`, 160);
  }
  if (err instanceof Error) {
    return redactSensitiveString(err.message, 160);
  }
  return 'unexpected_worker_error';
}

interface LeaseTracker {
  remainingAtSnapshotMs: number;
  snapshotMonotonicMs: number;
}

function createLeaseTracker(leaseExpiresAt: string, dbNow: string, snapshotMonotonicMs: number): LeaseTracker {
  const expMs = Date.parse(leaseExpiresAt);
  const dbNowMs = Date.parse(dbNow);
  const diff = Number.isFinite(expMs) && Number.isFinite(dbNowMs) ? Math.max(0, expMs - dbNowMs) : 0;
  return { remainingAtSnapshotMs: diff, snapshotMonotonicMs };
}

function remainingLeaseMs(tracker: LeaseTracker, currentMonotonicMs: number): number {
  const elapsed = Math.max(0, currentMonotonicMs - tracker.snapshotMonotonicMs);
  return Math.max(0, tracker.remainingAtSnapshotMs - elapsed);
}

function normalizeUrlBase(supabaseUrl: string): string {
  return supabaseUrl.replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function createSupabaseWorkerGateway(
  supabaseUrl: string,
  serviceRoleKey: string,
  config: Pick<WorkerConfig, 'dbRpcTimeoutMs'>
): WorkerGateway {
  const baseUrl = normalizeUrlBase(supabaseUrl);
  const baseHeaders = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };

  async function callRpc<T>(fnName: string, args: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await fetchWithTimeout(
        `${baseUrl}/rest/v1/rpc/${fnName}`,
        {
          method: 'POST',
          headers: baseHeaders,
          body: JSON.stringify(args),
        },
        config.dbRpcTimeoutMs
      );
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      throw new WorkerRpcError(
        isTimeout ? `RPC ${fnName} timed out` : `RPC ${fnName} network error`,
        isTimeout ? 504 : 503,
        isTimeout ? 'rpc_timeout' : 'rpc_network_error',
        true
      );
    }

    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      let pgCode = `http_${res.status}`;
      try {
        const parsed = JSON.parse(text) as { message?: string; code?: string };
        if (parsed.message) msg = parsed.message;
        if (parsed.code) pgCode = parsed.code;
      } catch {
        // non-JSON body
      }
      const isStale = msg.includes('stale_claim:');
      const retryable = !isStale && (res.status >= 500 || res.status === 429 || pgCode === '55P03');
      throw new WorkerRpcError(msg || `RPC ${fnName} failed`, res.status, pgCode, retryable);
    }

    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  return {
    async claimStorageDeletionJobs(batchSize: number, leaseInterval: string) {
      const rows = await callRpc<ClaimedDeletionJob[]>('claim_storage_deletion_jobs', {
        p_batch: batchSize,
        p_lease: leaseInterval,
      });
      return Array.isArray(rows) ? rows : [];
    },

    async beginStorageDeletion(jobId: string, claimToken: string) {
      return await callRpc<DeletionDecision>('begin_storage_deletion', {
        p_job_id: jobId,
        p_claim_token: claimToken,
      });
    },

    async renewStorageDeletionLease(jobId: string, claimToken: string, leaseInterval: string) {
      const rows = await callRpc<LeaseRenewalResult[]>('renew_storage_deletion_lease', {
        p_job_id: jobId,
        p_claim_token: claimToken,
        p_lease: leaseInterval,
      });
      return (
        rows?.[0] ?? {
          renewed: false,
          lease_expires_at: null,
          db_now: new Date().toISOString(),
        }
      );
    },

    async completeStorageDeletion(jobId: string, claimToken: string, storageResult: CompleteStorageResult) {
      return await callRpc<'completed' | 'object_still_present'>('complete_storage_deletion', {
        p_job_id: jobId,
        p_claim_token: claimToken,
        p_storage_result: storageResult,
      });
    },

    async failStorageDeletion(jobId: string, claimToken: string, errorMessage: string) {
      return await callRpc<'failed' | 'exhausted'>('fail_storage_deletion', {
        p_job_id: jobId,
        p_claim_token: claimToken,
        p_error: redactSensitiveString(errorMessage, 240),
      });
    },

    async enqueueOrphanStorageDeletion(bucketId: string, objectPath: string, orphanRetentionInterval: string) {
      return await callRpc<
        | 'created'
        | 'skipped_too_young'
        | 'skipped_referenced'
        | 'skipped_active_job'
        | 'rejected_invalid_path'
        | 'rejected_unknown_tenant'
      >('enqueue_orphan_storage_deletion', {
        p_bucket_id: bucketId,
        p_object_path: objectPath,
        p_orphan_retention: orphanRetentionInterval,
      });
    },

    async recordInvalidStoragePath(bucketId: string, objectPath: string, reason: string) {
      return await callRpc<string>('record_invalid_storage_path', {
        p_bucket_id: bucketId,
        p_object_path: objectPath,
        p_reason: redactSensitiveString(reason, 120),
      });
    },

    async removeStorageObject(bucketId: string, objectPath: string, timeoutMs: number): Promise<StorageRemoveResult> {
      let res: Response;
      try {
        res = await fetchWithTimeout(
          `${baseUrl}/storage/v1/object/${encodeURIComponent(bucketId)}`,
          {
            method: 'DELETE',
            headers: baseHeaders,
            body: JSON.stringify({ prefixes: [objectPath] }),
          },
          timeoutMs
        );
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === 'AbortError';
        return {
          kind: 'retryable_error',
          errorCode: isTimeout ? 'storage_timeout' : 'storage_network_error',
        };
      }

      if (res.status === 401 || res.status === 403) {
        await res.arrayBuffer().catch(() => undefined);
        return { kind: 'unauthorized', errorCode: `storage_unauthorized_${res.status}` };
      }

      if (res.status === 404) {
        await res.arrayBuffer().catch(() => undefined);
        return { kind: 'not_found' };
      }

      const bodyText = await res.text();
      if (!res.ok) {
        return { kind: 'retryable_error', errorCode: `storage_http_${res.status}` };
      }

      try {
        const deletedList = JSON.parse(bodyText) as Array<{ name?: string }>;
        if (Array.isArray(deletedList) && deletedList.length === 0) {
          return { kind: 'not_found' };
        }
        return { kind: 'deleted' };
      } catch {
        return { kind: 'retryable_error', errorCode: 'storage_invalid_json' };
      }
    },

    async listStorageObjects(
      bucketId: string,
      prefix: string,
      limit: number,
      offset: number,
      timeoutMs: number
    ): Promise<StorageListResult> {
      const res = await fetchWithTimeout(
        `${baseUrl}/storage/v1/object/list/${encodeURIComponent(bucketId)}`,
        {
          method: 'POST',
          headers: baseHeaders,
          body: JSON.stringify({
            prefix,
            limit,
            offset,
            sortBy: { column: 'name', order: 'asc' },
          }),
        },
        timeoutMs
      );

      if (!res.ok) {
        throw new WorkerRpcError(`Storage list failed for ${bucketId}`, res.status, 'storage_list_error', true);
      }
      const parsed = (await res.json()) as StorageListEntry[];
      return { entries: Array.isArray(parsed) ? parsed : [] };
    },
  };
}

async function safeFailJob(
  gateway: WorkerGateway,
  job: ClaimedDeletionJob,
  reason: string,
  summary: WorkerRunSummary,
  log: (level: 'info' | 'warn' | 'error', event: string, data: Record<string, unknown>) => void
): Promise<void> {
  try {
    const newStatus = await gateway.failStorageDeletion(job.job_id, job.claim_token, reason);
    if (newStatus === 'exhausted') {
      summary.exhausted += 1;
      log('error', 'storage_deletion.exhausted', {
        job_id: job.job_id,
        tenant_id: job.tenant_id,
        bucket_id: job.bucket_id,
        entity_type: job.entity_type,
        attempt_count: job.attempt_count,
        reason,
      });
    } else {
      summary.retried += 1;
      log('warn', 'storage_deletion.retry_scheduled', {
        job_id: job.job_id,
        tenant_id: job.tenant_id,
        bucket_id: job.bucket_id,
        attempt_count: job.attempt_count,
        reason,
      });
    }
  } catch (err) {
    if (isStaleClaimError(err)) {
      summary.staleAbandoned += 1;
      log('warn', 'storage_deletion.stale_claim_on_fail', {
        job_id: job.job_id,
        bucket_id: job.bucket_id,
        error: toSafeErrorCode(err),
      });
    } else {
      log('error', 'storage_deletion.fail_rpc_error', {
        job_id: job.job_id,
        bucket_id: job.bucket_id,
        error: toSafeErrorCode(err),
      });
    }
  }
}

async function finalizeWithRecovery(
  gateway: WorkerGateway,
  job: ClaimedDeletionJob,
  storageResult: CompleteStorageResult,
  leaseTracker: LeaseTracker,
  config: WorkerConfig,
  nowMs: () => number,
  sleep: (ms: number) => Promise<void>,
  summary: WorkerRunSummary,
  log: (level: 'info' | 'warn' | 'error', event: string, data: Record<string, unknown>) => void
): Promise<void> {
  let lastErr: unknown;

  for (let attempt = 1; attempt <= config.maxFinalizationAttempts; attempt += 1) {
    try {
      const outcome = await gateway.completeStorageDeletion(job.job_id, job.claim_token, storageResult);
      if (outcome === 'object_still_present') {
        summary.objectStillPresent += 1;
        log('warn', 'storage_deletion.object_still_present', {
          job_id: job.job_id,
          tenant_id: job.tenant_id,
          bucket_id: job.bucket_id,
          attempt_count: job.attempt_count,
        });
      } else {
        summary.completed += 1;
        log('info', 'storage_deletion.completed', {
          job_id: job.job_id,
          tenant_id: job.tenant_id,
          bucket_id: job.bucket_id,
          entity_type: job.entity_type,
          storage_result: storageResult,
        });
      }
      return;
    } catch (err) {
      lastErr = err;
      if (isStaleClaimError(err)) {
        summary.staleAbandoned += 1;
        log('warn', 'storage_deletion.stale_claim_on_complete', {
          job_id: job.job_id,
          bucket_id: job.bucket_id,
          error: toSafeErrorCode(err),
        });
        return;
      }
      const isRetryable = err instanceof WorkerRpcError ? err.retryable : false;
      if (!isRetryable || attempt >= config.maxFinalizationAttempts || remainingLeaseMs(leaseTracker, nowMs()) < 15_000) {
        break;
      }
      await sleep(config.finalizationRetryDelayMs * attempt);
    }
  }

  summary.finalizationFailed += 1;
  log('error', 'storage_deletion.finalization_failed', {
    job_id: job.job_id,
    tenant_id: job.tenant_id,
    bucket_id: job.bucket_id,
    storage_result: storageResult,
    error: toSafeErrorCode(lastErr),
  });
  await safeFailJob(gateway, job, `finalization_failed: ${toSafeErrorCode(lastErr)}`, summary, log);
}

async function processClaimedJob(
  gateway: WorkerGateway,
  job: ClaimedDeletionJob,
  config: WorkerConfig,
  nowMs: () => number,
  sleep: (ms: number) => Promise<void>,
  summary: WorkerRunSummary,
  log: (level: 'info' | 'warn' | 'error', event: string, data: Record<string, unknown>) => void
): Promise<void> {
  const leaseInterval = `${config.leaseSeconds} seconds`;
  let leaseTracker = createLeaseTracker(job.lease_expires_at, job.db_now, nowMs());

  if (!isAllowedBucket(job.bucket_id) || !isValidCanonicalObjectPath(job.object_path)) {
    log('warn', 'storage_deletion.invalid_path_quarantined', {
      job_id: job.job_id,
      bucket_id: job.bucket_id,
    });
    try {
      await gateway.recordInvalidStoragePath(job.bucket_id, job.object_path, 'worker_invalid_job_path');
    } catch {
      // quarantine audit best-effort
    }
    await safeFailJob(gateway, job, 'invalid_path', summary, log);
    return;
  }

  let decision: DeletionDecision;
  try {
    decision = await gateway.beginStorageDeletion(job.job_id, job.claim_token);
  } catch (err) {
    if (isStaleClaimError(err)) {
      summary.staleAbandoned += 1;
      log('warn', 'storage_deletion.stale_claim_on_begin', {
        job_id: job.job_id,
        bucket_id: job.bucket_id,
        error: toSafeErrorCode(err),
      });
      return;
    }
    await safeFailJob(gateway, job, `begin_failed: ${toSafeErrorCode(err)}`, summary, log);
    return;
  }

  if (decision === 'detach_only') {
    summary.detachedOnly += 1;
    await finalizeWithRecovery(gateway, job, 'skipped', leaseTracker, config, nowMs, sleep, summary, log);
    return;
  }

  // Verify lease margin before opening a network request to Storage API
  if (remainingLeaseMs(leaseTracker, nowMs()) < config.renewMarginMs) {
    const beforeRenewMs = nowMs();
    try {
      const renewal = await gateway.renewStorageDeletionLease(job.job_id, job.claim_token, leaseInterval);
      if (!renewal.renewed || !renewal.lease_expires_at) {
        summary.staleAbandoned += 1;
        log('warn', 'storage_deletion.lease_abandoned', {
          job_id: job.job_id,
          bucket_id: job.bucket_id,
          reason: 'renew_returned_false',
        });
        return;
      }
      leaseTracker = createLeaseTracker(renewal.lease_expires_at, renewal.db_now, beforeRenewMs);
      if (remainingLeaseMs(leaseTracker, nowMs()) < config.renewMarginMs) {
        summary.staleAbandoned += 1;
        log('warn', 'storage_deletion.lease_abandoned', {
          job_id: job.job_id,
          bucket_id: job.bucket_id,
          reason: 'insufficient_lease_after_renew',
        });
        return;
      }
      log('info', 'storage_deletion.lease_renewed', {
        job_id: job.job_id,
        bucket_id: job.bucket_id,
      });
    } catch (err) {
      summary.staleAbandoned += 1;
      log('warn', 'storage_deletion.lease_renew_error', {
        job_id: job.job_id,
        bucket_id: job.bucket_id,
        error: toSafeErrorCode(err),
      });
      return;
    }
  }

  const removeRes = await gateway.removeStorageObject(job.bucket_id, job.object_path, config.storageHttpTimeoutMs);
  if (removeRes.kind === 'unauthorized' || removeRes.kind === 'retryable_error') {
    const safeReason = redactSensitiveString(removeRes.errorCode ?? removeRes.kind, 160);
    log('warn', 'storage_deletion.storage_error', {
      job_id: job.job_id,
      tenant_id: job.tenant_id,
      bucket_id: job.bucket_id,
      error: safeReason,
    });
    await safeFailJob(gateway, job, safeReason, summary, log);
    return;
  }

  if (removeRes.kind === 'not_found') {
    summary.notFoundIdempotent += 1;
  }

  await finalizeWithRecovery(gateway, job, removeRes.kind, leaseTracker, config, nowMs, sleep, summary, log);
}

function createRootPrefixQueue(): OrphanScanPrefixFrame[] {
  return [{ prefix: '', depth: 0, afterName: null, afterIsFolder: false, offset: 0 }];
}

function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(encoded: string): string {
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (normalized.length % 4)) % 4;
  const binary = atob(normalized + '='.repeat(padding));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export function encodeOrphanCursor(cursor: OrphanScanCursor): string {
  return `v1_${toBase64Url(JSON.stringify(cursor))}`;
}

function validateCursorObject(raw: unknown): OrphanScanCursor | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj.v !== 1) return null;
  if (typeof obj.bucketIndex !== 'number' || !Number.isInteger(obj.bucketIndex) || obj.bucketIndex < 0) {
    return null;
  }
  if (!Array.isArray(obj.queue)) return null;

  const queue: OrphanScanPrefixFrame[] = [];
  for (const frameRaw of obj.queue) {
    if (!frameRaw || typeof frameRaw !== 'object') return null;
    const f = frameRaw as Record<string, unknown>;
    if (typeof f.prefix !== 'string') return null;
    if (typeof f.depth !== 'number' || !Number.isInteger(f.depth) || f.depth < 0 || f.depth > 3) return null;
    if (f.afterName !== null && typeof f.afterName !== 'string') return null;
    if (f.afterIsFolder !== undefined && typeof f.afterIsFolder !== 'boolean') return null;
    if (typeof f.offset !== 'number' || !Number.isInteger(f.offset) || f.offset < 0) return null;
    queue.push({
      prefix: f.prefix,
      depth: f.depth,
      afterName: f.afterName,
      afterIsFolder: Boolean(f.afterIsFolder),
      offset: f.offset,
    });
  }

  return {
    v: 1,
    bucketIndex: obj.bucketIndex,
    queue,
  };
}

export function decodeOrphanCursor(raw: string | OrphanScanCursor | null | undefined): OrphanScanCursor | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      const payload = trimmed.startsWith('v1_') ? fromBase64Url(trimmed.slice(3)) : fromBase64Url(trimmed);
      return validateCursorObject(JSON.parse(payload));
    } catch {
      return null;
    }
  }
  return validateCursorObject(raw);
}

/**
 * Compares an entry returned by `sortBy: { column: 'name', order: 'asc' }` against the cursor's
 * last-processed entry. Matches `storage.search`'s `lower(name)` ascending seek order so keyset
 * filtering stays consistent even when objects are inserted or removed earlier in a folder.
 */
function compareEntryAfter(entry: StorageListEntry, afterName: string, afterIsFolder: boolean): number {
  const a = entry.name.toLowerCase();
  const b = afterName.toLowerCase();
  if (a !== b) return a < b ? -1 : 1;
  const entryFolderRank = entry.id === null ? 1 : 0;
  const cursorFolderRank = afterIsFolder ? 1 : 0;
  return entryFolderRank - cursorFolderRank;
}

export async function runOrphanScan(
  gateway: WorkerGateway,
  config: WorkerConfig,
  options: WorkerRunOptions,
  summary: WorkerRunSummary,
  invocationStartedMs: number,
  log: (level: 'info' | 'warn' | 'error', event: string, data: Record<string, unknown>) => void
): Promise<void> {
  const nowMs = options.nowMs ?? (() => performance.now());
  const wallClockMs = options.wallClockMs ?? (() => Date.now());
  const rawMaxScans = options.maxOrphanScansPerInvocation ?? config.maxOrphanScansPerInvocation;
  const maxScans = Number.isFinite(rawMaxScans)
    ? Math.min(Math.max(Math.floor(rawMaxScans), 1), 1_000)
    : config.maxOrphanScansPerInvocation;
  const pageSize = Math.max(config.orphanListPageSize, 1);
  const retentionMs = config.orphanRetentionHours * 3_600_000;
  const retentionInterval = `${config.orphanRetentionHours} hours`;
  const targetBuckets = (options.buckets ?? ALLOWED_BUCKETS).filter(isAllowedBucket);

  if (targetBuckets.length === 0) {
    summary.orphanScan.nextCursor = null;
    summary.orphanScan.cycleCompleted = true;
    return;
  }

  const decoded = decodeOrphanCursor(options.orphanCursor);
  let bucketIndex = decoded && decoded.bucketIndex < targetBuckets.length ? decoded.bucketIndex : 0;
  let prefixQueue: OrphanScanPrefixFrame[] =
    decoded && decoded.bucketIndex < targetBuckets.length && decoded.queue.length > 0
      ? decoded.queue.map((f) => ({ ...f }))
      : createRootPrefixQueue();

  let paused = false;

  while (bucketIndex < targetBuckets.length) {
    if (summary.orphanScan.objectsInspected >= maxScans) {
      paused = true;
      break;
    }
    if (nowMs() - invocationStartedMs >= config.invocationTimeoutMs - 5_000) {
      paused = true;
      break;
    }

    const bucketId = targetBuckets[bucketIndex];
    if (prefixQueue.length === 0) {
      prefixQueue = createRootPrefixQueue();
    }
    summary.orphanScan.bucketsScanned += 1;

    let bucketListFailed = false;
    while (prefixQueue.length > 0) {
      if (summary.orphanScan.objectsInspected >= maxScans) {
        paused = true;
        break;
      }
      if (nowMs() - invocationStartedMs >= config.invocationTimeoutMs - 5_000) {
        paused = true;
        break;
      }

      const current = prefixQueue.shift()!;
      let pageOffset = current.offset;
      let needsResumeAlignment = current.afterName !== null && pageOffset > 0;
      let stopPrefixForPause = false;

      while (true) {
        if (summary.orphanScan.objectsInspected >= maxScans) {
          paused = true;
          stopPrefixForPause = true;
          break;
        }
        if (nowMs() - invocationStartedMs >= config.invocationTimeoutMs - 5_000) {
          paused = true;
          stopPrefixForPause = true;
          break;
        }

        let listRes: StorageListResult;
        try {
          listRes = await gateway.listStorageObjects(
            bucketId,
            current.prefix,
            pageSize,
            pageOffset,
            Math.min(config.dbRpcTimeoutMs, config.storageHttpTimeoutMs)
          );
        } catch (err) {
          summary.orphanScan.errors += 1;
          log('warn', 'storage_deletion.orphan_list_error', {
            bucket_id: bucketId,
            error: toSafeErrorCode(err),
          });
          paused = true;
          bucketListFailed = true;
          stopPrefixForPause = true;
          break;
        }

        // If objects before our saved offset were deleted since the previous invocation, step
        // back until the page aligns with `afterName` (or reaches offset 0) so no objects are skipped.
        if (needsResumeAlignment) {
          const overshot =
            pageOffset > 0 &&
            current.afterName !== null &&
            (listRes.entries.length === 0 ||
              compareEntryAfter(listRes.entries[0], current.afterName, current.afterIsFolder) > 0);
          if (overshot) {
            pageOffset = Math.max(0, pageOffset - pageSize);
            current.offset = pageOffset;
            continue;
          }
          needsResumeAlignment = false;
        }

        if (listRes.entries.length === 0) break;

        let consumedOnPage = 0;
        let hitBudgetMidPage = false;

        for (const entry of listRes.entries) {
          if (summary.orphanScan.objectsInspected >= maxScans) {
            hitBudgetMidPage = true;
            break;
          }
          if (nowMs() - invocationStartedMs >= config.invocationTimeoutMs - 5_000) {
            hitBudgetMidPage = true;
            break;
          }

          if (
            current.afterName !== null &&
            compareEntryAfter(entry, current.afterName, current.afterIsFolder) <= 0
          ) {
            consumedOnPage += 1;
            continue;
          }

          const fullPath = current.prefix ? `${current.prefix}/${entry.name}` : entry.name;

          if (entry.id === null) {
            if (current.depth < 2) {
              prefixQueue.push({
                prefix: fullPath,
                depth: current.depth + 1,
                afterName: null,
                afterIsFolder: false,
                offset: 0,
              });
            } else {
              // Unexpected deeper nesting or folder beyond 3 segments: quarantine without deleting
              summary.orphanScan.objectsInspected += 1;
              summary.orphanScan.quarantined += 1;
              try {
                await gateway.recordInvalidStoragePath(bucketId, fullPath, 'unexpected_folder_depth');
              } catch {
                summary.orphanScan.errors += 1;
              }
            }
            current.afterName = entry.name;
            current.afterIsFolder = true;
            consumedOnPage += 1;
            continue;
          }

          if (entry.archived_at !== null && entry.archived_at !== undefined) {
            current.afterName = entry.name;
            current.afterIsFolder = false;
            consumedOnPage += 1;
            continue;
          }
          if (entry.is_delete_marker === true) {
            current.afterName = entry.name;
            current.afterIsFolder = false;
            consumedOnPage += 1;
            continue;
          }

          summary.orphanScan.objectsInspected += 1;

          if (!isValidCanonicalObjectPath(fullPath)) {
            summary.orphanScan.quarantined += 1;
            try {
              await gateway.recordInvalidStoragePath(bucketId, fullPath, 'invalid_orphan_path');
            } catch {
              summary.orphanScan.errors += 1;
            }
            current.afterName = entry.name;
            current.afterIsFolder = false;
            consumedOnPage += 1;
            continue;
          }

          if (entry.created_at) {
            const createdMs = Date.parse(entry.created_at);
            if (Number.isFinite(createdMs) && createdMs > wallClockMs() - retentionMs) {
              summary.orphanScan.skippedTooYoung += 1;
              current.afterName = entry.name;
              current.afterIsFolder = false;
              consumedOnPage += 1;
              continue;
            }
          }

          try {
            const outcome = await gateway.enqueueOrphanStorageDeletion(bucketId, fullPath, retentionInterval);
            switch (outcome) {
              case 'created':
                summary.orphanScan.enqueued += 1;
                break;
              case 'skipped_too_young':
                summary.orphanScan.skippedTooYoung += 1;
                break;
              case 'skipped_referenced':
                summary.orphanScan.skippedReferenced += 1;
                break;
              case 'skipped_active_job':
                summary.orphanScan.skippedActiveJob += 1;
                break;
              case 'rejected_invalid_path':
                summary.orphanScan.quarantined += 1;
                await gateway.recordInvalidStoragePath(bucketId, fullPath, 'rpc_rejected_invalid_path');
                break;
              case 'rejected_unknown_tenant':
                summary.orphanScan.rejectedUnknownTenant += 1;
                break;
            }
          } catch (err) {
            summary.orphanScan.errors += 1;
            log('warn', 'storage_deletion.orphan_enqueue_error', {
              bucket_id: bucketId,
              error: toSafeErrorCode(err),
            });
          }

          current.afterName = entry.name;
          current.afterIsFolder = false;
          consumedOnPage += 1;
        }

        if (hitBudgetMidPage) {
          // Keep a 1-item overlap at `afterName` so deletions before this point can be detected.
          if (consumedOnPage > 0) {
            current.offset = Math.max(0, pageOffset + consumedOnPage - 1);
          } else if (current.afterName !== null) {
            current.offset = Math.max(0, pageOffset - 1);
          } else {
            current.offset = pageOffset;
          }
          paused = true;
          stopPrefixForPause = true;
          break;
        }

        if (listRes.entries.length < pageSize) {
          break;
        }

        pageOffset += listRes.entries.length;
        // Keep a 1-item overlap cursor if the next boundary pauses before the next page fetch.
        current.offset = Math.max(0, pageOffset - 1);
      }

      if (stopPrefixForPause) {
        prefixQueue.unshift(current);
        break;
      }
    }

    if (paused || bucketListFailed) {
      break;
    }

    bucketIndex += 1;
    prefixQueue = bucketIndex < targetBuckets.length ? createRootPrefixQueue() : [];
  }

  if (bucketIndex < targetBuckets.length && paused) {
    summary.orphanScan.nextCursor = encodeOrphanCursor({
      v: 1,
      bucketIndex,
      queue: prefixQueue.length > 0 ? prefixQueue : createRootPrefixQueue(),
    });
    summary.orphanScan.cycleCompleted = false;
  } else {
    summary.orphanScan.nextCursor = null;
    summary.orphanScan.cycleCompleted = true;
  }
}

export async function runWorkerInvocation(
  gateway: WorkerGateway,
  config: WorkerConfig,
  options: WorkerRunOptions = {}
): Promise<WorkerRunSummary> {
  const mode: WorkerMode = options.mode ?? 'all';
  const batchSize = Math.min(Math.max(options.batchSize ?? config.batchSize, 1), 100);
  const maxJobs = Math.max(options.maxJobsPerInvocation ?? config.maxJobsPerInvocation, 1);
  const leaseInterval = `${config.leaseSeconds} seconds`;
  const nowMs = options.nowMs ?? (() => performance.now());
  const wallClockMs = options.wallClockMs ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const rawLogger = options.logger ?? defaultLogger;

  const invocationStartedMs = nowMs();
  const log = (level: 'info' | 'warn' | 'error', event: string, data: Record<string, unknown>) => {
    const safeEntry = sanitizeValue({
      ts: new Date(wallClockMs()).toISOString(),
      level,
      event,
      ...data,
    }) as StructuredLogEntry;
    rawLogger(safeEntry);
  };

  const summary: WorkerRunSummary = {
    mode,
    claimed: 0,
    completed: 0,
    detachedOnly: 0,
    notFoundIdempotent: 0,
    retried: 0,
    exhausted: 0,
    objectStillPresent: 0,
    staleAbandoned: 0,
    finalizationFailed: 0,
    orphanScan: {
      bucketsScanned: 0,
      objectsInspected: 0,
      enqueued: 0,
      quarantined: 0,
      skippedTooYoung: 0,
      skippedReferenced: 0,
      skippedActiveJob: 0,
      rejectedUnknownTenant: 0,
      errors: 0,
      nextCursor: null,
      cycleCompleted: false,
    },
    stoppedReason: mode === 'orphan_scan' ? 'orphan_only' : 'drained',
    durationMs: 0,
  };

  log('info', 'storage_deletion.invocation_started', {
    mode,
    batch_size: batchSize,
    max_jobs: maxJobs,
    lease_seconds: config.leaseSeconds,
  });

  if (mode === 'process' || mode === 'all') {
    while (summary.claimed < maxJobs) {
      if (nowMs() - invocationStartedMs >= config.invocationTimeoutMs - 10_000) {
        summary.stoppedReason = 'timeout_budget';
        break;
      }

      const remainingBudget = maxJobs - summary.claimed;
      const askBatch = Math.min(batchSize, remainingBudget);

      let jobs: ClaimedDeletionJob[];
      try {
        jobs = await gateway.claimStorageDeletionJobs(askBatch, leaseInterval);
      } catch (err) {
        summary.stoppedReason = 'claim_error';
        log('error', 'storage_deletion.claim_error', { error: toSafeErrorCode(err) });
        break;
      }

      if (jobs.length === 0) {
        summary.stoppedReason = 'drained';
        break;
      }

      summary.claimed += jobs.length;

      for (const job of jobs) {
        if (nowMs() - invocationStartedMs >= config.invocationTimeoutMs - 5_000) {
          summary.stoppedReason = 'timeout_budget';
          break;
        }
        await processClaimedJob(gateway, job, config, nowMs, sleep, summary, log);
      }

      if (summary.stoppedReason === 'timeout_budget') break;
      if (summary.claimed >= maxJobs) {
        summary.stoppedReason = 'max_jobs_reached';
        break;
      }
      if (jobs.length < askBatch) {
        summary.stoppedReason = 'drained';
        break;
      }
    }
  }

  if (mode === 'orphan_scan' || mode === 'all') {
    await runOrphanScan(gateway, config, options, summary, invocationStartedMs, log);
  }

  summary.durationMs = Math.max(0, Math.round(nowMs() - invocationStartedMs));
  log('info', 'storage_deletion.invocation_completed', { ...summary });
  return summary;
}

export const MIN_WORKER_SECRET_BYTES = 32;

export function isStrongWorkerSecret(secret: string): boolean {
  return new TextEncoder().encode(secret).length >= MIN_WORKER_SECRET_BYTES;
}

export async function timingSafeSecretMatch(expectedSecret: string, presentedSecret: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const expectedBytes = encoder.encode(expectedSecret);
  const presentedBytes = encoder.encode(presentedSecret);
  const [expDigest, presDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', expectedBytes),
    crypto.subtle.digest('SHA-256', presentedBytes),
  ]);
  const a = new Uint8Array(expDigest);
  const b = new Uint8Array(presDigest);
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  // Enforce non-empty and minimum secret length after the full digest XOR loop (no early return).
  if (expectedBytes.length < MIN_WORKER_SECRET_BYTES) diff |= 1;
  if (presentedBytes.length === 0) diff |= 1;
  return diff === 0;
}

function extractPresentedSecret(req: Request): string {
  const auth = req.headers.get('authorization')?.trim() ?? '';
  const match = /^Bearer\s+(\S.*)$/i.exec(auth);
  return match ? match[1].trim() : '';
}

export interface HttpHandlerDeps {
  envGet: (name: string) => string | undefined;
  gatewayFactory?: (supabaseUrl: string, serviceRoleKey: string, config: WorkerConfig) => WorkerGateway;
  runOptions?: WorkerRunOptions;
}

export async function handleWorkerRequest(req: Request, deps: HttpHandlerDeps): Promise<Response> {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const workerSecret = deps.envGet('STORAGE_DELETION_WORKER_SECRET')?.trim() ?? '';
  const supabaseUrl = deps.envGet('SUPABASE_URL')?.trim() ?? '';
  const serviceRoleKey = deps.envGet('SUPABASE_SERVICE_ROLE_KEY')?.trim() ?? '';
  const workerSecretStrong = isStrongWorkerSecret(workerSecret);

  if (!workerSecret || !workerSecretStrong || !supabaseUrl || !serviceRoleKey) {
    defaultLogger({
      ts: new Date().toISOString(),
      level: 'error',
      event: 'storage_deletion.misconfigured_env',
      worker_auth_configured: Boolean(workerSecret),
      worker_auth_length_ok: workerSecretStrong,
      supabase_url_configured: Boolean(supabaseUrl),
      service_auth_configured: Boolean(serviceRoleKey),
    });
    return Response.json({ error: 'Worker environment is not configured' }, { status: 500 });
  }

  const presentedSecret = extractPresentedSecret(req);
  const authorized = await timingSafeSecretMatch(workerSecret, presentedSecret);
  if (!authorized) {
    defaultLogger({
      ts: new Date().toISOString(),
      level: 'warn',
      event: 'storage_deletion.unauthorized_request',
    });
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const bodyOptions: WorkerRunOptions = {};
  try {
    const rawText = await req.text();
    if (rawText.trim().length > 0) {
      const parsed = JSON.parse(rawText) as Record<string, unknown>;
      if (parsed.mode === 'process' || parsed.mode === 'orphan_scan' || parsed.mode === 'all') {
        bodyOptions.mode = parsed.mode;
      }
      if (typeof parsed.batchSize === 'number') bodyOptions.batchSize = parsed.batchSize;
      if (typeof parsed.maxJobsPerInvocation === 'number') {
        bodyOptions.maxJobsPerInvocation = parsed.maxJobsPerInvocation;
      }
      if (typeof parsed.maxOrphanScansPerInvocation === 'number') {
        bodyOptions.maxOrphanScansPerInvocation = parsed.maxOrphanScansPerInvocation;
      }
      if (parsed.orphanCursor !== undefined && parsed.orphanCursor !== null) {
        const decodedCursor = decodeOrphanCursor(
          typeof parsed.orphanCursor === 'string'
            ? parsed.orphanCursor
            : (parsed.orphanCursor as OrphanScanCursor)
        );
        if (!decodedCursor) {
          return Response.json({ error: 'Invalid orphanCursor' }, { status: 400 });
        }
        bodyOptions.orphanCursor = decodedCursor;
      }
      if (Array.isArray(parsed.buckets)) {
        bodyOptions.buckets = parsed.buckets.filter((b): b is string => typeof b === 'string');
      }
    }
  } catch {
    return Response.json({ error: 'Invalid JSON request body' }, { status: 400 });
  }

  const config = loadWorkerConfig(deps.envGet);
  const gateway = (deps.gatewayFactory ?? createSupabaseWorkerGateway)(supabaseUrl, serviceRoleKey, config);
  const summary = await runWorkerInvocation(gateway, config, { ...bodyOptions, ...deps.runOptions });
  return Response.json({ ok: true, summary }, { status: 200 });
}

interface DenoLike {
  env: { get(key: string): string | undefined };
  serve: (handler: (req: Request) => Promise<Response>) => void;
}

const denoRuntime = (globalThis as unknown as { Deno?: DenoLike }).Deno;
if (denoRuntime && typeof denoRuntime.serve === 'function' && (import.meta as { main?: boolean }).main) {
  denoRuntime.serve((req: Request) =>
    handleWorkerRequest(req, {
      envGet: (name: string) => denoRuntime.env.get(name),
    })
  );
}
