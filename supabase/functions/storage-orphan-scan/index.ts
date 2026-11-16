/**
 * Smart RT Persistent Orphan Scan Orchestrator (Supabase Edge Function)
 *
 * Orchestrates scheduled & manual orphan-scan runs backed by Migration 0016's
 * singleton lease/cursor state (`public.storage_orphan_scan_state`) and
 * domain soft-delete retention sweep (`enqueue_soft_deleted_domain_storage_deletions`),
 * delegating page-by-page Storage bucket traversal & keyset realignment to
 * `runOrphanScan` from `storage-deletion-worker`.
 *
 * Security invariants:
 * - Authenticates via constant-time Bearer `STORAGE_DELETION_WORKER_SECRET` (>= 32 UTF-8 bytes).
 * - Uses `SUPABASE_SERVICE_ROLE_KEY` exclusively via RPC/Storage HTTP calls inside Edge Function.
 * - Never performs physical Storage deletion (deletion happens strictly via queue + worker).
 * - Never trusts caller `scan_token`, `cursor`, `buckets`, or `object_path`.
 * - Never leaks keys, `scan_token`, Bearer headers, or internal stack traces in logs/responses.
 */

import {
  ALLOWED_BUCKETS,
  DEFAULT_WORKER_CONFIG,
  WorkerRpcError,
  createSupabaseWorkerGateway,
  decodeOrphanCursor,
  defaultLogger,
  isStrongWorkerSecret,
  loadWorkerConfig,
  redactSensitiveString,
  runOrphanScan,
  timingSafeSecretMatch,
  type OrphanScanCursor,
  type StructuredLogEntry,
  type WorkerConfig,
  type WorkerGateway,
  type WorkerRunSummary,
} from '../storage-deletion-worker/index.ts';

export const DEFAULT_RETENTION_DAYS = 7;
export const DEFAULT_RETENTION_LIMIT = 100;
export const DEFAULT_LEASE_SECONDS = 300; // 5 minutes
export const MAX_LEASE_SECONDS = 900; // 15 minutes
export const MIN_LEASE_SECONDS = 60; // 1 minute
export const DEFAULT_LEASE_RENEW_THRESHOLD_MS = 120_000; // < 120s remaining
export const DEFAULT_SOFT_STOP_BUFFER_MS = 5_000; // 105s soft stop on 110s default budget
export const MAX_CURSOR_BYTES = 65_536;

export interface AcquireOrphanScanLeaseResult {
  acquired: boolean;
  scan_token: string | null;
  cursor: OrphanScanCursor | null;
  lease_expires_at: string;
  db_now: string;
}

export interface RenewOrphanScanLeaseResult {
  renewed: boolean;
  lease_expires_at: string | null;
  db_now: string;
}

export interface RetentionSweepResult {
  enqueued_count: number;
  skipped_count: number;
}

export interface OrphanScanGateway extends WorkerGateway {
  acquireOrphanScanLease(leaseInterval: string): Promise<AcquireOrphanScanLeaseResult>;
  renewOrphanScanLease(scanToken: string, leaseInterval: string): Promise<RenewOrphanScanLeaseResult>;
  enqueueSoftDeletedDomainStorageDeletions(retentionInterval: string, limit: number): Promise<RetentionSweepResult>;
  saveOrphanScanCursor(
    cursor: OrphanScanCursor | null,
    cycleCompleted: boolean,
    scanToken: string
  ): Promise<void>;
  releaseOrphanScanLease(scanToken: string): Promise<void>;
}

export interface OrphanScanConfig extends WorkerConfig {
  retentionDays: number;
  retentionLimit: number;
  leaseRenewThresholdMs: number;
  softStopBufferMs: number;
}

export type OrchestratorOutcomeStatus = 'completed' | 'skipped_lease_busy' | 'failed';

export type OrchestratorErrorCategory =
  | 'lease_acquire_failed'
  | 'invalid_cursor'
  | 'retention_sweep_failed'
  | 'lease_renewal_failed'
  | 'storage_list_failed'
  | 'orphan_enqueue_failed'
  | 'orphan_scan_failed'
  | 'cursor_save_failed'
  | 'unexpected_error';

export interface OrchestratorRunOptions {
  maxOrphanScansPerInvocation?: number;
  retentionDays?: number;
  retentionLimit?: number;
  nowMs?: () => number;
  wallClockMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
  logger?: (entry: StructuredLogEntry) => void;
}

export interface OrchestratorSummary {
  ok: boolean;
  status: OrchestratorOutcomeStatus;
  leaseAcquired: boolean;
  skipped: boolean;
  processedCount: number;
  enqueuedCount: number;
  quarantinedCount: number;
  skippedTooYoung: number;
  skippedReferenced: number;
  skippedActiveJob: number;
  rejectedUnknownTenant: number;
  retention: {
    enqueued: number;
    skipped: number;
  };
  cycleCompleted: boolean;
  cursorSaved: boolean;
  leaseRenewed: number;
  leaseReleaseFailed: boolean;
  durationMs: number;
  errorCategory?: OrchestratorErrorCategory;
}

export interface OrphanHttpHandlerDeps {
  envGet: (name: string) => string | undefined;
  gatewayFactory?: (supabaseUrl: string, serviceRoleKey: string, config: OrphanScanConfig) => OrphanScanGateway;
  runOptions?: OrchestratorRunOptions;
}

export const DEFAULT_ORPHAN_SCAN_CONFIG: OrphanScanConfig = {
  ...DEFAULT_WORKER_CONFIG,
  leaseSeconds: DEFAULT_LEASE_SECONDS,
  invocationTimeoutMs: 110_000,
  renewMarginMs: DEFAULT_LEASE_RENEW_THRESHOLD_MS,
  retentionDays: DEFAULT_RETENTION_DAYS,
  retentionLimit: DEFAULT_RETENTION_LIMIT,
  leaseRenewThresholdMs: DEFAULT_LEASE_RENEW_THRESHOLD_MS,
  softStopBufferMs: DEFAULT_SOFT_STOP_BUFFER_MS,
};

class OrchestratorError extends Error {
  readonly category: OrchestratorErrorCategory;

  constructor(category: OrchestratorErrorCategory, message: string) {
    super(redactSensitiveString(message, 160));
    this.name = 'OrchestratorError';
    this.category = category;
  }
}

interface LeaseTracker {
  remainingAtSnapshotMs: number;
  snapshotMonotonicMs: number;
}

function createLeaseTracker(leaseExpiresAt: string, dbNow: string, snapshotMonotonicMs: number): LeaseTracker {
  const expMs = Date.parse(leaseExpiresAt);
  const dbNowMs = Date.parse(dbNow);
  const remaining = Number.isFinite(expMs) && Number.isFinite(dbNowMs) ? Math.max(0, expMs - dbNowMs) : 0;
  return { remainingAtSnapshotMs: remaining, snapshotMonotonicMs };
}

function remainingLeaseMs(tracker: LeaseTracker, currentMonotonicMs: number): number {
  const elapsed = Math.max(0, currentMonotonicMs - tracker.snapshotMonotonicMs);
  return Math.max(0, tracker.remainingAtSnapshotMs - elapsed);
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function loadOrphanScanConfig(envGet: (name: string) => string | undefined): OrphanScanConfig {
  const base = loadWorkerConfig(envGet);
  const leaseSeconds = Math.min(Math.max(base.leaseSeconds, MIN_LEASE_SECONDS), MAX_LEASE_SECONDS);
  const invocationTimeoutMs = clampInt(envGet('WORKER_INVOCATION_TIMEOUT_MS'), 110_000, 5_000, 240_000);
  const leaseRenewThresholdMs = clampInt(
    envGet('ORPHAN_LEASE_RENEW_THRESHOLD_MS'),
    DEFAULT_LEASE_RENEW_THRESHOLD_MS,
    15_000,
    Math.max(15_000, leaseSeconds * 1000 - 5_000)
  );

  return {
    ...base,
    leaseSeconds,
    invocationTimeoutMs,
    renewMarginMs: leaseRenewThresholdMs,
    retentionDays: clampInt(envGet('ORPHAN_DOMAIN_RETENTION_DAYS'), DEFAULT_RETENTION_DAYS, 0, 365),
    retentionLimit: clampInt(envGet('ORPHAN_DOMAIN_RETENTION_LIMIT'), DEFAULT_RETENTION_LIMIT, 1, 500),
    leaseRenewThresholdMs,
    softStopBufferMs: DEFAULT_SOFT_STOP_BUFFER_MS,
  };
}

function normalizeUrlBase(supabaseUrl: string): string {
  return supabaseUrl.replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const boundedTimeoutMs = Math.max(250, timeoutMs);
  const timer = setTimeout(() => controller.abort(), boundedTimeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function createOrphanScanGateway(
  supabaseUrl: string,
  serviceRoleKey: string,
  config: Pick<OrphanScanConfig, 'dbRpcTimeoutMs'>
): OrphanScanGateway {
  const baseUrl = normalizeUrlBase(supabaseUrl);
  const baseHeaders = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };
  const workerGateway = createSupabaseWorkerGateway(supabaseUrl, serviceRoleKey, config);

  async function callRpc<T>(fnName: string, args: Record<string, unknown>, timeoutOverrideMs?: number): Promise<T> {
    let res: Response;
    try {
      res = await fetchWithTimeout(
        `${baseUrl}/rest/v1/rpc/${fnName}`,
        {
          method: 'POST',
          headers: baseHeaders,
          body: JSON.stringify(args),
        },
        timeoutOverrideMs ?? config.dbRpcTimeoutMs
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
        // ignore non-JSON body
      }
      const isStale = msg.includes('stale_orphan_scan_lease') || msg.includes('stale_claim:');
      const retryable = !isStale && (res.status >= 500 || res.status === 429 || pgCode === '55P03');
      throw new WorkerRpcError(msg || `RPC ${fnName} failed`, res.status, pgCode, retryable);
    }

    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  return {
    claimStorageDeletionJobs: () => {
      throw new Error('claimStorageDeletionJobs is disabled in storage-orphan-scan');
    },
    beginStorageDeletion: () => {
      throw new Error('beginStorageDeletion is disabled in storage-orphan-scan');
    },
    renewStorageDeletionLease: () => {
      throw new Error('renewStorageDeletionLease is disabled in storage-orphan-scan');
    },
    completeStorageDeletion: () => {
      throw new Error('completeStorageDeletion is disabled in storage-orphan-scan');
    },
    failStorageDeletion: () => {
      throw new Error('failStorageDeletion is disabled in storage-orphan-scan');
    },
    removeStorageObject: () => {
      throw new Error('Direct physical storage deletion is forbidden in storage-orphan-scan');
    },
    enqueueOrphanStorageDeletion: (bucketId, objectPath, retentionInterval) =>
      workerGateway.enqueueOrphanStorageDeletion(bucketId, objectPath, retentionInterval),
    recordInvalidStoragePath: (bucketId, objectPath, reason) =>
      workerGateway.recordInvalidStoragePath(bucketId, objectPath, reason),
    listStorageObjects: (bucketId, prefix, limit, offset, timeoutMs) =>
      workerGateway.listStorageObjects(bucketId, prefix, limit, offset, timeoutMs),

    async acquireOrphanScanLease(leaseInterval: string): Promise<AcquireOrphanScanLeaseResult> {
      const rows = await callRpc<AcquireOrphanScanLeaseResult[]>('acquire_orphan_scan_lease', {
        p_lease: leaseInterval,
      });
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new WorkerRpcError('acquire_orphan_scan_lease returned empty result', 500, 'empty_rpc_result', true);
      }
      return rows[0];
    },

    async renewOrphanScanLease(scanToken: string, leaseInterval: string): Promise<RenewOrphanScanLeaseResult> {
      const rows = await callRpc<RenewOrphanScanLeaseResult[]>('renew_orphan_scan_lease', {
        p_scan_token: scanToken,
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

    async enqueueSoftDeletedDomainStorageDeletions(
      retentionInterval: string,
      limit: number
    ): Promise<RetentionSweepResult> {
      const rows = await callRpc<RetentionSweepResult[]>('enqueue_soft_deleted_domain_storage_deletions', {
        p_retention: retentionInterval,
        p_limit: limit,
      });
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new WorkerRpcError(
          'enqueue_soft_deleted_domain_storage_deletions returned empty result',
          500,
          'empty_rpc_result',
          true
        );
      }
      return rows[0];
    },

    async saveOrphanScanCursor(
      cursor: OrphanScanCursor | null,
      cycleCompleted: boolean,
      scanToken: string
    ): Promise<void> {
      await callRpc<unknown>('save_orphan_scan_cursor', {
        p_cursor: cursor,
        p_cycle_completed: cycleCompleted,
        p_scan_token: scanToken,
      });
    },

    async releaseOrphanScanLease(scanToken: string): Promise<void> {
      await callRpc<unknown>(
        'release_orphan_scan_lease',
        { p_scan_token: scanToken },
        Math.min(config.dbRpcTimeoutMs, 5_000)
      );
    },
  };
}

function classifyErrorCategory(err: unknown, fallback: OrchestratorErrorCategory): OrchestratorErrorCategory {
  if (err instanceof OrchestratorError) {
    return err.category;
  }
  return fallback;
}

function createInitialSummary(config: OrphanScanConfig): OrchestratorSummary {
  return {
    ok: false,
    status: 'failed',
    leaseAcquired: false,
    skipped: false,
    processedCount: 0,
    enqueuedCount: 0,
    quarantinedCount: 0,
    skippedTooYoung: 0,
    skippedReferenced: 0,
    skippedActiveJob: 0,
    rejectedUnknownTenant: 0,
    retention: {
      enqueued: 0,
      skipped: 0,
    },
    cycleCompleted: false,
    cursorSaved: false,
    leaseRenewed: 0,
    leaseReleaseFailed: false,
    durationMs: 0,
    errorCategory: config ? undefined : 'unexpected_error',
  };
}

function serializeLogSummary(summary: OrchestratorSummary): Record<string, unknown> {
  return {
    outcome: summary.status,
    lease_acquired: summary.leaseAcquired,
    skipped: summary.skipped,
    retention_enqueued: summary.retention.enqueued,
    retention_skipped: summary.retention.skipped,
    orphan_processed: summary.processedCount,
    orphan_enqueued: summary.enqueuedCount,
    invalid_path_count: summary.quarantinedCount,
    cursor_saved: summary.cursorSaved,
    cycle_completed: summary.cycleCompleted,
    lease_renewed: summary.leaseRenewed,
    lease_release_failed: summary.leaseReleaseFailed,
    duration_ms: summary.durationMs,
    ...(summary.errorCategory ? { error_category: summary.errorCategory } : {}),
  };
}

/**
 * Executes one persistent orphan-scan orchestration cycle using Migration 0016 RPCs
 * and `runOrphanScan` pagination/keyset realignment.
 */
export async function runOrphanScanOrchestration(
  gateway: OrphanScanGateway,
  config: OrphanScanConfig,
  options: OrchestratorRunOptions = {}
): Promise<OrchestratorSummary> {
  const nowMs = options.nowMs ?? (() => performance.now());
  const wallClockMs = options.wallClockMs ?? (() => Date.now());
  const rawLogger = options.logger ?? defaultLogger;
  const invocationStartedMs = nowMs();

  const log = (level: 'info' | 'warn' | 'error', event: string, data: Record<string, unknown>) => {
    rawLogger({
      ts: new Date(wallClockMs()).toISOString(),
      level,
      event,
      ...data,
    });
  };

  const summary = createInitialSummary(config);
  delete summary.errorCategory;

  const leaseInterval = `${config.leaseSeconds} seconds`;
  const retentionDays = options.retentionDays ?? config.retentionDays;
  const retentionInterval = `${retentionDays} days`;
  const retentionLimit = options.retentionLimit ?? config.retentionLimit;
  const softStopMs = Math.max(1_000, config.invocationTimeoutMs - config.softStopBufferMs);

  log('info', 'storage_orphan_scan.invocation_started', {
    lease_seconds: config.leaseSeconds,
    retention_days: retentionDays,
    retention_limit: retentionLimit,
    max_orphan_scans: options.maxOrphanScansPerInvocation ?? config.maxOrphanScansPerInvocation,
  });

  // Step 2: Acquire singleton DB lease
  let acq: AcquireOrphanScanLeaseResult;
  try {
    acq = await gateway.acquireOrphanScanLease(leaseInterval);
  } catch (err) {
    summary.errorCategory = classifyErrorCategory(err, 'lease_acquire_failed');
    summary.durationMs = Math.max(0, Math.round(nowMs() - invocationStartedMs));
    log('error', 'storage_orphan_scan.invocation_failed', serializeLogSummary(summary));
    return summary;
  }

  // Step 3: Safe skip if another worker holds active lease
  if (!acq.acquired) {
    summary.ok = true;
    summary.status = 'skipped_lease_busy';
    summary.leaseAcquired = false;
    summary.skipped = true;
    summary.durationMs = Math.max(0, Math.round(nowMs() - invocationStartedMs));
    log('info', 'storage_orphan_scan.lease_busy', serializeLogSummary(summary));
    return summary;
  }

  if (!acq.scan_token) {
    summary.errorCategory = 'lease_acquire_failed';
    summary.durationMs = Math.max(0, Math.round(nowMs() - invocationStartedMs));
    log('error', 'storage_orphan_scan.invocation_failed', serializeLogSummary(summary));
    return summary;
  }

  // Keep scan_token strictly inside local function closure; never log or return it.
  const scanToken = acq.scan_token;
  summary.leaseAcquired = true;
  let leaseTracker = createLeaseTracker(acq.lease_expires_at, acq.db_now, nowMs());

  log('info', 'storage_orphan_scan.lease_acquired', {
    lease_acquired: true,
    has_cursor: acq.cursor !== null && acq.cursor !== undefined,
  });

  const ensureLeaseHealthy = async (): Promise<void> => {
    const remaining = remainingLeaseMs(leaseTracker, nowMs());
    if (remaining >= config.leaseRenewThresholdMs) {
      return;
    }

    const beforeRenewMs = nowMs();
    let renewal: RenewOrphanScanLeaseResult;
    try {
      renewal = await gateway.renewOrphanScanLease(scanToken, leaseInterval);
    } catch {
      throw new OrchestratorError('lease_renewal_failed', 'Failed to renew orphan scan lease');
    }

    if (!renewal.renewed || !renewal.lease_expires_at) {
      throw new OrchestratorError('lease_renewal_failed', 'Orphan scan lease renewal rejected');
    }

    leaseTracker = createLeaseTracker(renewal.lease_expires_at, renewal.db_now, beforeRenewMs);
    summary.leaseRenewed += 1;
    log('info', 'storage_orphan_scan.lease_renewed', {
      lease_renewed: true,
      renew_count: summary.leaseRenewed,
    });

    if (remainingLeaseMs(leaseTracker, nowMs()) <= 5_000) {
      throw new OrchestratorError('lease_renewal_failed', 'Insufficient lease remaining after renewal');
    }
  };

  try {
    // Step 4: Validate authoritative DB cursor (never caller cursor)
    let startingCursor: OrphanScanCursor | null = null;
    if (acq.cursor !== null && acq.cursor !== undefined) {
      const decoded = decodeOrphanCursor(acq.cursor);
      if (!decoded || decoded.bucketIndex >= ALLOWED_BUCKETS.length) {
        throw new OrchestratorError('invalid_cursor', 'Persisted orphan scan cursor is malformed or out of range');
      }
      startingCursor = decoded;
    }

    // Step 5: Domain soft-delete retention sweep (strictly under active lease)
    await ensureLeaseHealthy();
    try {
      const retentionRes = await gateway.enqueueSoftDeletedDomainStorageDeletions(retentionInterval, retentionLimit);
      summary.retention.enqueued = Math.max(0, Number(retentionRes.enqueued_count) || 0);
      summary.retention.skipped = Math.max(0, Number(retentionRes.skipped_count) || 0);
    } catch (err) {
      throw new OrchestratorError(
        classifyErrorCategory(err, 'retention_sweep_failed'),
        'Domain retention sweep failed'
      );
    }

    log('info', 'storage_orphan_scan.retention_completed', {
      retention_enqueued: summary.retention.enqueued,
      retention_skipped: summary.retention.skipped,
    });

    // Check remaining execution budget before starting Storage bucket traversal
    if (nowMs() - invocationStartedMs >= softStopMs) {
      throw new OrchestratorError('orphan_scan_failed', 'Execution budget exhausted after retention sweep');
    }

    // Step 6: Wrap gateway so every scan step enforces lease renewal, execution budget,
    // no-physical-delete, and atomic error abort (never swallowing failures into cursor save).
    let scanAbortError: OrchestratorError | null = null;

    const assertScanCanContinue = async () => {
      if (scanAbortError) {
        throw scanAbortError;
      }
      await ensureLeaseHealthy();
    };

    const guardedGateway: WorkerGateway = {
      claimStorageDeletionJobs: () => {
        throw new OrchestratorError('orphan_scan_failed', 'claimStorageDeletionJobs disabled');
      },
      beginStorageDeletion: () => {
        throw new OrchestratorError('orphan_scan_failed', 'beginStorageDeletion disabled');
      },
      renewStorageDeletionLease: () => {
        throw new OrchestratorError('orphan_scan_failed', 'renewStorageDeletionLease disabled');
      },
      completeStorageDeletion: () => {
        throw new OrchestratorError('orphan_scan_failed', 'completeStorageDeletion disabled');
      },
      failStorageDeletion: () => {
        throw new OrchestratorError('orphan_scan_failed', 'failStorageDeletion disabled');
      },
      removeStorageObject: () => {
        throw new OrchestratorError('orphan_scan_failed', 'Direct physical storage deletion forbidden');
      },
      listStorageObjects: async (bucketId, prefix, limit, offset, timeoutMs) => {
        try {
          await assertScanCanContinue();
          const remainingBudgetMs = softStopMs - (nowMs() - invocationStartedMs);
          if (remainingBudgetMs <= 0) {
            throw new OrchestratorError('orphan_scan_failed', 'Execution budget reached before Storage list');
          }
          const boundedTimeoutMs = Math.max(1_000, Math.min(timeoutMs, remainingBudgetMs));
          return await gateway.listStorageObjects(bucketId, prefix, limit, offset, boundedTimeoutMs);
        } catch (err) {
          const wrapped =
            err instanceof OrchestratorError
              ? err
              : new OrchestratorError('storage_list_failed', 'Storage listing failed during orphan scan');
          if (!scanAbortError) scanAbortError = wrapped;
          throw wrapped;
        }
      },
      enqueueOrphanStorageDeletion: async (bucketId, objectPath, retentionInt) => {
        try {
          await assertScanCanContinue();
          return await gateway.enqueueOrphanStorageDeletion(bucketId, objectPath, retentionInt);
        } catch (err) {
          const wrapped =
            err instanceof OrchestratorError
              ? err
              : new OrchestratorError('orphan_enqueue_failed', 'Orphan enqueue RPC failed during scan');
          if (!scanAbortError) scanAbortError = wrapped;
          throw wrapped;
        }
      },
      recordInvalidStoragePath: async (bucketId, objectPath, reason) => {
        try {
          await assertScanCanContinue();
          return await gateway.recordInvalidStoragePath(bucketId, objectPath, reason);
        } catch (err) {
          const wrapped =
            err instanceof OrchestratorError
              ? err
              : new OrchestratorError('orphan_scan_failed', 'Quarantine audit RPC failed during scan');
          if (!scanAbortError) scanAbortError = wrapped;
          throw wrapped;
        }
      },
    };

    const workerConfig: WorkerConfig = {
      ...config,
      invocationTimeoutMs: config.invocationTimeoutMs,
    };

    const workerSummary: WorkerRunSummary = {
      mode: 'orphan_scan',
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
      stoppedReason: 'orphan_only',
      durationMs: 0,
    };

    await runOrphanScan(
      guardedGateway,
      workerConfig,
      {
        mode: 'orphan_scan',
        orphanCursor: startingCursor,
        buckets: ALLOWED_BUCKETS,
        maxOrphanScansPerInvocation: options.maxOrphanScansPerInvocation ?? config.maxOrphanScansPerInvocation,
        nowMs,
        wallClockMs,
        sleep: options.sleep,
        logger: (entry) => {
          rawLogger(entry);
        },
      },
      workerSummary,
      invocationStartedMs,
      (level, event, data) => {
        log(level, event, data);
      }
    );

    summary.processedCount = workerSummary.orphanScan.objectsInspected;
    summary.enqueuedCount = workerSummary.orphanScan.enqueued;
    summary.quarantinedCount = workerSummary.orphanScan.quarantined;
    summary.skippedTooYoung = workerSummary.orphanScan.skippedTooYoung;
    summary.skippedReferenced = workerSummary.orphanScan.skippedReferenced;
    summary.skippedActiveJob = workerSummary.orphanScan.skippedActiveJob;
    summary.rejectedUnknownTenant = workerSummary.orphanScan.rejectedUnknownTenant;

    if (scanAbortError) {
      throw scanAbortError;
    }
    if (workerSummary.orphanScan.errors > 0) {
      throw new OrchestratorError('orphan_scan_failed', 'Orphan scan recorded non-zero processing errors');
    }

    // Step 7: Save progress (only after verified clean scan page / cycle completion)
    await ensureLeaseHealthy();

    let nextCursorObj: OrphanScanCursor | null = null;
    const cycleCompleted = workerSummary.orphanScan.cycleCompleted === true;
    if (!cycleCompleted) {
      nextCursorObj = decodeOrphanCursor(workerSummary.orphanScan.nextCursor);
      if (!nextCursorObj) {
        throw new OrchestratorError('invalid_cursor', 'Orphan scan produced invalid continuation cursor');
      }
      const byteSize = new TextEncoder().encode(JSON.stringify(nextCursorObj)).length;
      if (byteSize > MAX_CURSOR_BYTES) {
        throw new OrchestratorError('invalid_cursor', 'Orphan scan continuation cursor exceeds 65536 bytes');
      }
    }

    try {
      await gateway.saveOrphanScanCursor(cycleCompleted ? null : nextCursorObj, cycleCompleted, scanToken);
      summary.cursorSaved = true;
      summary.cycleCompleted = cycleCompleted;
    } catch (err) {
      throw new OrchestratorError(
        classifyErrorCategory(err, 'cursor_save_failed'),
        'Failed to save orphan scan cursor'
      );
    }

    log('info', 'storage_orphan_scan.cursor_saved', {
      cursor_saved: true,
      cycle_completed: summary.cycleCompleted,
    });

    summary.ok = true;
    summary.status = 'completed';
  } catch (err) {
    summary.ok = false;
    summary.status = 'failed';
    summary.errorCategory = classifyErrorCategory(err, 'unexpected_error');
  } finally {
    // Step 8 & 9: Release lease best-effort without mutating or undoing saved cursor
    try {
      await gateway.releaseOrphanScanLease(scanToken);
      log('info', 'storage_orphan_scan.lease_released', {
        cursor_saved: summary.cursorSaved,
      });
    } catch (releaseErr) {
      summary.leaseReleaseFailed = true;
      log('warn', 'storage_orphan_scan.lease_release_failed', {
        cursor_saved: summary.cursorSaved,
        error_category: classifyErrorCategory(releaseErr, 'unexpected_error'),
      });
    }
  }

  summary.durationMs = Math.max(0, Math.round(nowMs() - invocationStartedMs));
  log(summary.ok ? 'info' : 'error', summary.ok ? 'storage_orphan_scan.invocation_completed' : 'storage_orphan_scan.invocation_failed', serializeLogSummary(summary));
  return summary;
}

function extractBearerSecret(req: Request): string {
  const auth = req.headers.get('authorization')?.trim() ?? '';
  const match = /^Bearer\s+(\S.*)$/i.exec(auth);
  return match ? match[1].trim() : '';
}

function buildHttpResponsePayload(summary: OrchestratorSummary): Record<string, unknown> {
  return {
    ok: summary.ok,
    status: summary.status,
    leaseAcquired: summary.leaseAcquired,
    skipped: summary.skipped,
    processedCount: summary.processedCount,
    enqueuedCount: summary.enqueuedCount,
    quarantinedCount: summary.quarantinedCount,
    retention: summary.retention,
    cycleCompleted: summary.cycleCompleted,
    cursorSaved: summary.cursorSaved,
    leaseRenewed: summary.leaseRenewed,
    durationMs: summary.durationMs,
    ...(summary.errorCategory ? { error: summary.errorCategory } : {}),
  };
}

export async function handleOrphanScanRequest(req: Request, deps: OrphanHttpHandlerDeps): Promise<Response> {
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
      event: 'storage_orphan_scan.misconfigured_env',
      worker_auth_configured: Boolean(workerSecret),
      worker_auth_length_ok: workerSecretStrong,
      supabase_url_configured: Boolean(supabaseUrl),
      service_auth_configured: Boolean(serviceRoleKey),
    });
    return Response.json({ error: 'Orphan scan environment is not configured' }, { status: 500 });
  }

  const presentedSecret = extractBearerSecret(req);
  const authorized = await timingSafeSecretMatch(workerSecret, presentedSecret);
  if (!authorized) {
    defaultLogger({
      ts: new Date().toISOString(),
      level: 'warn',
      event: 'storage_orphan_scan.unauthorized_request',
    });
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Strictly reject invalid JSON syntax; ignore any caller-supplied scan_token, cursor, buckets, or object_path.
  const bodyOptions: OrchestratorRunOptions = {};
  try {
    const rawText = await req.text();
    if (rawText.trim().length > 0) {
      const parsed = JSON.parse(rawText) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return Response.json({ error: 'Invalid JSON request body' }, { status: 400 });
      }
      if (typeof parsed.maxOrphanScansPerInvocation === 'number' && Number.isFinite(parsed.maxOrphanScansPerInvocation)) {
        bodyOptions.maxOrphanScansPerInvocation = Math.min(
          Math.max(Math.floor(parsed.maxOrphanScansPerInvocation), 1),
          1_000
        );
      }
    }
  } catch {
    return Response.json({ error: 'Invalid JSON request body' }, { status: 400 });
  }

  const config = loadOrphanScanConfig(deps.envGet);
  const gateway = (deps.gatewayFactory ?? createOrphanScanGateway)(supabaseUrl, serviceRoleKey, config);
  const summary = await runOrphanScanOrchestration(gateway, config, {
    ...bodyOptions,
    ...deps.runOptions,
  });

  const httpStatus = summary.ok ? 200 : 500;
  return Response.json(buildHttpResponsePayload(summary), { status: httpStatus });
}

interface DenoLike {
  env: { get(key: string): string | undefined };
  serve: (handler: (req: Request) => Promise<Response>) => void;
}

const denoRuntime = (globalThis as unknown as { Deno?: DenoLike }).Deno;
if (denoRuntime && typeof denoRuntime.serve === 'function' && (import.meta as { main?: boolean }).main) {
  denoRuntime.serve((req: Request) =>
    handleOrphanScanRequest(req, {
      envGet: (name: string) => denoRuntime.env.get(name),
    })
  );
}

