import {
  DEFAULT_LEASE_RENEW_THRESHOLD_MS,
  DEFAULT_ORPHAN_SCAN_CONFIG,
  createOrphanScanGateway,
  handleOrphanScanRequest,
  loadOrphanScanConfig,
  runOrphanScanOrchestration,
} from './index.ts';
import { WorkerRpcError } from '../storage-deletion-worker/index.ts';

function assert(cond, msg) {
  if (!cond) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`Assertion failed (${msg}): expected=${String(expected)}, actual=${String(actual)}`);
  }
}

const TENANT_A = '11111111-1111-4111-8111-111111111101';
const ENTITY_A = '22222222-2222-4222-8222-222222222202';
const STRONG_SECRET = '0123456789abcdef0123456789abcdef-strong-secret-32b';
const FAKE_SERVICE_KEY = 'sb_secret_unit_test_service_role_key_never_leak';

function makePath(index) {
  const suffix = String(index).padStart(12, '0');
  return `${TENANT_A}/${ENTITY_A}/33333333-3333-4333-8333-${suffix}.jpg`;
}

/**
 * Stateful in-memory simulator matching Migration 0016 singleton lease/cursor RPCs,
 * retention sweep RPC, and Storage object listing without direct deletion.
 */
function createOrphanScanSimulator({
  initialObjects = [],
  initialCursor = null,
  retentionQueueBatch = [],
  pageSize = 2,
} = {}) {
  const state = {
    cursor: initialCursor ? JSON.parse(JSON.stringify(initialCursor)) : null,
    scan_token: null,
    lease_expires_at: null,
    cycle_started_at: null,
    cycle_completed_at: null,
  };
  let nowOffsetMs = 0;
  let tokenCounter = 0;
  const baseEpochMs = Date.parse('2026-11-14T03:00:00.000Z');
  const objects = new Map(initialObjects.map((o) => [`${o.bucket_id}/${o.name}`, { ...o }]));
  const orphanQueue = [];
  const retentionQueue = [];
  const quarantined = [];
  const callHistory = [];
  const retentionPending = [...retentionQueueBatch];

  function currentDbDate() {
    return new Date(baseEpochMs + nowOffsetMs);
  }

  function advanceMs(ms) {
    nowOffsetMs += ms;
  }

  function parseLeaseMs(leaseInterval) {
    const match = /(\d+)\s+second/i.exec(leaseInterval);
    if (match) return Math.min(Math.max(Number(match[1]) * 1000, 60_000), 900_000);
    return 300_000;
  }

  const hooks = {
    onAcquire: null,
    onRenew: null,
    onRetention: null,
    onSave: null,
    onRelease: null,
    onList: null,
    onEnqueueOrphan: null,
  };

  const gateway = {
    claimStorageDeletionJobs() {
      throw new Error('claimStorageDeletionJobs must not be called');
    },
    beginStorageDeletion() {
      throw new Error('beginStorageDeletion must not be called');
    },
    renewStorageDeletionLease() {
      throw new Error('renewStorageDeletionLease must not be called');
    },
    completeStorageDeletion() {
      throw new Error('completeStorageDeletion must not be called');
    },
    failStorageDeletion() {
      throw new Error('failStorageDeletion must not be called');
    },
    removeStorageObject() {
      throw new Error('removeStorageObject must not be called');
    },

    async acquireOrphanScanLease(leaseInterval) {
      callHistory.push('acquireOrphanScanLease');
      if (hooks.onAcquire) return await hooks.onAcquire(leaseInterval);
      const now = currentDbDate();
      if (state.lease_expires_at && Date.parse(state.lease_expires_at) > now.getTime()) {
        return {
          acquired: false,
          scan_token: null,
          cursor: null,
          lease_expires_at: state.lease_expires_at,
          db_now: now.toISOString(),
        };
      }
      tokenCounter += 1;
      const leaseMs = parseLeaseMs(leaseInterval);
      const exp = new Date(now.getTime() + leaseMs).toISOString();
      state.scan_token = `tok-scan-secret-${String(tokenCounter).padStart(4, '0')}`;
      state.lease_expires_at = exp;
      state.cycle_started_at = state.cycle_started_at ?? now.toISOString();
      return {
        acquired: true,
        scan_token: state.scan_token,
        cursor: state.cursor ? JSON.parse(JSON.stringify(state.cursor)) : null,
        lease_expires_at: exp,
        db_now: now.toISOString(),
      };
    },

    async renewOrphanScanLease(scanToken, leaseInterval) {
      callHistory.push('renewOrphanScanLease');
      if (hooks.onRenew) return await hooks.onRenew(scanToken, leaseInterval);
      const now = currentDbDate();
      if (
        !scanToken ||
        state.scan_token !== scanToken ||
        !state.lease_expires_at ||
        Date.parse(state.lease_expires_at) <= now.getTime()
      ) {
        return { renewed: false, lease_expires_at: null, db_now: now.toISOString() };
      }
      const leaseMs = parseLeaseMs(leaseInterval);
      const exp = new Date(now.getTime() + leaseMs).toISOString();
      state.lease_expires_at = exp;
      return { renewed: true, lease_expires_at: exp, db_now: now.toISOString() };
    },

    async enqueueSoftDeletedDomainStorageDeletions(retentionInterval, limit) {
      callHistory.push('enqueueSoftDeletedDomainStorageDeletions');
      if (hooks.onRetention) return await hooks.onRetention(retentionInterval, limit);
      const batch = retentionPending.splice(0, limit);
      for (const item of batch) {
        if (!retentionQueue.some((q) => q.bucket_id === item.bucket_id && q.object_path === item.object_path)) {
          retentionQueue.push(item);
        }
      }
      return { enqueued_count: batch.length, skipped_count: 0 };
    },

    async saveOrphanScanCursor(cursor, cycleCompleted, scanToken) {
      callHistory.push('saveOrphanScanCursor');
      if (hooks.onSave) return await hooks.onSave(cursor, cycleCompleted, scanToken);
      const now = currentDbDate();
      if (
        !scanToken ||
        state.scan_token !== scanToken ||
        !state.lease_expires_at ||
        Date.parse(state.lease_expires_at) <= now.getTime()
      ) {
        throw new WorkerRpcError('stale_orphan_scan_lease', 400, 'P0001', false);
      }
      if (cycleCompleted) {
        state.cursor = null;
        state.cycle_started_at = null;
        state.cycle_completed_at = now.toISOString();
      } else {
        state.cursor = JSON.parse(JSON.stringify(cursor));
      }
    },

    async releaseOrphanScanLease(scanToken) {
      callHistory.push('releaseOrphanScanLease');
      if (hooks.onRelease) return await hooks.onRelease(scanToken);
      if (scanToken && state.scan_token === scanToken) {
        state.scan_token = null;
        state.lease_expires_at = null;
      }
    },

    async listStorageObjects(bucketId, prefix, limit, offset, timeoutMs) {
      callHistory.push(`listStorageObjects:${bucketId}:${offset}`);
      if (hooks.onList) return await hooks.onList(bucketId, prefix, limit, offset, timeoutMs);
      const entries = [];
      for (const obj of objects.values()) {
        if (obj.bucket_id !== bucketId) continue;
        if (prefix === '') {
          entries.push({
            name: obj.name,
            id: obj.id ?? 'obj-id',
            created_at: obj.created_at,
            archived_at: obj.archived_at ?? null,
            is_delete_marker: obj.is_delete_marker ?? false,
          });
        }
      }
      entries.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      return { entries: entries.slice(offset, offset + (limit ?? pageSize)) };
    },

    async enqueueOrphanStorageDeletion(bucketId, objectPath, retentionInterval) {
      callHistory.push(`enqueueOrphanStorageDeletion:${bucketId}`);
      if (hooks.onEnqueueOrphan) return await hooks.onEnqueueOrphan(bucketId, objectPath, retentionInterval);
      const key = `${bucketId}/${objectPath}`;
      const obj = objects.get(key);
      if (!obj) return 'skipped_too_young';
      if (Date.parse(obj.created_at) > currentDbDate().getTime() - 24 * 3600_000) {
        return 'skipped_too_young';
      }
      if (!orphanQueue.some((q) => q.bucket_id === bucketId && q.object_path === objectPath)) {
        orphanQueue.push({ bucket_id: bucketId, object_path: objectPath });
      }
      return 'created';
    },

    recordInvalidStoragePath(bucketId, objectPath, reason) {
      callHistory.push(`recordInvalidStoragePath:${bucketId}`);
      quarantined.push({ bucket_id: bucketId, object_path: objectPath, reason });
      return Promise.resolve('audit-invalid-1');
    },
  };

  return {
    gateway,
    hooks,
    objects,
    orphanQueue,
    retentionQueue,
    quarantined,
    callHistory,
    getState: () => JSON.parse(JSON.stringify(state)),
    advanceMs,
    nowMs: () => nowOffsetMs,
    wallClockMs: () => baseEpochMs + nowOffsetMs,
  };
}

function defaultEnv(overrides = {}) {
  const env = {
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: FAKE_SERVICE_KEY,
    STORAGE_DELETION_WORKER_SECRET: STRONG_SECRET,
    ...overrides,
  };
  return (k) => env[k];
}

// =============================================================================
// 1-4. HTTP Method, Auth, Weak/Missing Secret & Direct Delete Guard
// =============================================================================

Deno.test('1-4. Rejects non-POST (405), missing/invalid Bearer (401), x-worker-secret (401), and weak/missing env (500)', async () => {
  const getRes = await handleOrphanScanRequest(new Request('http://local/orphan-scan', { method: 'GET' }), {
    envGet: defaultEnv(),
  });
  assertEqual(getRes.status, 405, '1. Reject GET');

  const noAuthRes = await handleOrphanScanRequest(new Request('http://local/orphan-scan', { method: 'POST' }), {
    envGet: defaultEnv(),
  });
  assertEqual(noAuthRes.status, 401, '2. Reject missing Bearer');

  const xHeaderRes = await handleOrphanScanRequest(
    new Request('http://local/orphan-scan', {
      method: 'POST',
      headers: { 'x-worker-secret': STRONG_SECRET },
    }),
    { envGet: defaultEnv() }
  );
  assertEqual(xHeaderRes.status, 401, '2b. Reject x-worker-secret header');

  const badBearerRes = await handleOrphanScanRequest(
    new Request('http://local/orphan-scan', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-secret-0123456789abcdef0123456' },
    }),
    { envGet: defaultEnv() }
  );
  assertEqual(badBearerRes.status, 401, '3. Reject invalid Bearer');

  const weakEnvRes = await handleOrphanScanRequest(
    new Request('http://local/orphan-scan', {
      method: 'POST',
      headers: { Authorization: 'Bearer short-secret' },
    }),
    { envGet: defaultEnv({ STORAGE_DELETION_WORKER_SECRET: 'short-secret' }) }
  );
  assertEqual(weakEnvRes.status, 500, '4. Reject weak configured secret (<32 UTF-8 bytes)');

  const missingKeyRes = await handleOrphanScanRequest(
    new Request('http://local/orphan-scan', {
      method: 'POST',
      headers: { Authorization: `Bearer ${STRONG_SECRET}` },
    }),
    { envGet: defaultEnv({ SUPABASE_SERVICE_ROLE_KEY: '' }) }
  );
  assertEqual(missingKeyRes.status, 500, '4b. Reject missing SUPABASE_SERVICE_ROLE_KEY');

  // Verify real gateway disables direct physical delete & worker queue RPCs
  const realGw = createOrphanScanGateway('http://127.0.0.1:54321', FAKE_SERVICE_KEY, DEFAULT_ORPHAN_SCAN_CONFIG);
  let threw = false;
  try {
    realGw.removeStorageObject('complaints', makePath(1), 5000);
  } catch {
    threw = true;
  }
  assert(threw, 'createOrphanScanGateway disables removeStorageObject');
});

// =============================================================================
// 5-9. Lease Acquire, Safe Skip, Order Guarantees & Authoritative DB Cursor
// =============================================================================

Deno.test('5-9. Acquire lease, safe skip when busy, retention only post-lease, DB cursor overrides request body', async () => {
  const sim = createOrphanScanSimulator({
    initialObjects: [
      { bucket_id: 'complaints', name: makePath(1), created_at: '2026-11-10T00:00:00.000Z' },
      { bucket_id: 'complaints', name: makePath(2), created_at: '2026-11-14T02:30:00.000Z' }, // < 24h young
      { bucket_id: 'complaints', name: 'bad-invalid-path.txt', created_at: '2026-11-10T00:00:00.000Z' },
    ],
    initialCursor: {
      v: 1,
      bucketIndex: 2, // complaints
      queue: [{ prefix: '', depth: 0, afterName: null, afterIsFolder: false, offset: 0 }],
    },
    retentionQueueBatch: [{ bucket_id: 'activity-docs', object_path: makePath(99) }],
  });

  // 8 & 9. Caller sends bogus cursor, scan_token, buckets; must be ignored cleanly
  const res = await handleOrphanScanRequest(
    new Request('http://local/orphan-scan', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRONG_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        scan_token: 'caller-spoofed-token',
        cursor: { v: 1, bucketIndex: 0, queue: [] },
        orphanCursor: { v: 1, bucketIndex: 0, queue: [] },
        buckets: ['resident-documents'],
        maxOrphanScansPerInvocation: 50,
      }),
    }),
    {
      envGet: defaultEnv(),
      gatewayFactory: () => sim.gateway,
      runOptions: {
        nowMs: sim.nowMs,
        wallClockMs: sim.wallClockMs,
        logger: () => {},
      },
    }
  );
  assertEqual(res.status, 200, '5. Orchestration HTTP 200');
  const body = await res.json();
  assertEqual(body.ok, true, '5. ok=true');
  assertEqual(body.leaseAcquired, true, '5. leaseAcquired=true');
  assertEqual(body.skipped, false, '5. skipped=false');
  assertEqual(body.retention.enqueued, 1, '7. retention enqueued');
  assertEqual(body.enqueuedCount, 1, '9. valid aged orphan enqueued');
  assertEqual(body.quarantinedCount, 1, '9. invalid path quarantined');
  assertEqual(body.cycleCompleted, true, '11. reached EOF across remaining buckets');
  assertEqual(body.cursorSaved, true, 'cursorSaved');

  // Verify call sequence: acquire happens strictly BEFORE retention & listing, save strictly BEFORE release
  const acqIdx = sim.callHistory.indexOf('acquireOrphanScanLease');
  const retIdx = sim.callHistory.indexOf('enqueueSoftDeletedDomainStorageDeletions');
  const saveIdx = sim.callHistory.indexOf('saveOrphanScanCursor');
  const relIdx = sim.callHistory.indexOf('releaseOrphanScanLease');
  assert(acqIdx === 0, '7. acquire is first RPC');
  assert(retIdx > acqIdx, '7. retention runs after acquire');
  assert(saveIdx > retIdx && relIdx > saveIdx, '17. save then release in order');
  assert(sim.getState().cursor === null, '11. DB cursor cleared on cycle completion');

  // 6. Lease busy produces safe 200 skip without calling retention/scan/save/release
  const busySim = createOrphanScanSimulator();
  await busySim.gateway.acquireOrphanScanLease('5 minutes'); // hold lock
  busySim.callHistory.length = 0;

  const busyRes = await handleOrphanScanRequest(
    new Request('http://local/orphan-scan', {
      method: 'POST',
      headers: { Authorization: `Bearer ${STRONG_SECRET}` },
    }),
    {
      envGet: defaultEnv(),
      gatewayFactory: () => busySim.gateway,
      runOptions: { logger: () => {} },
    }
  );
  assertEqual(busyRes.status, 200, '6. Busy skip HTTP 200');
  const busyBody = await busyRes.json();
  assertEqual(busyBody.status, 'skipped_lease_busy', '6. skipped_lease_busy');
  assertEqual(busyBody.leaseAcquired, false, '6. leaseAcquired=false');
  assertEqual(busyBody.skipped, true, '6. skipped=true');
  assertEqual(busySim.callHistory.length, 1, '6 & 7. Only acquire called when busy');
  assertEqual(busySim.callHistory[0], 'acquireOrphanScanLease', '6. Exact single call');
});

// =============================================================================
// 10-13. Partial Page Cursor Save, Cycle Completion, Scanner & Retention Failures
// =============================================================================

Deno.test('10-13. Saves partial cursor, clears on cycle completion, and preserves prior cursor on scan/retention failures', async () => {
  const initialCursor = {
    v: 1,
    bucketIndex: 0,
    queue: [{ prefix: '', depth: 0, afterName: null, afterIsFolder: false, offset: 0 }],
  };

  // 10. Partial page (maxOrphanScansPerInvocation=2 on 4 objects) saves non-null cursor & cycleCompleted=false
  const partialSim = createOrphanScanSimulator({
    initialObjects: [1, 2, 3, 4].map((i) => ({
      bucket_id: 'resident-documents',
      name: makePath(i),
      created_at: '2026-11-10T00:00:00.000Z',
    })),
    pageSize: 2,
  });
  const cfg = { ...DEFAULT_ORPHAN_SCAN_CONFIG, orphanListPageSize: 2 };
  const s1 = await runOrphanScanOrchestration(partialSim.gateway, cfg, {
    maxOrphanScansPerInvocation: 2,
    nowMs: partialSim.nowMs,
    wallClockMs: partialSim.wallClockMs,
    logger: () => {},
  });
  assertEqual(s1.ok, true, '10. partial scan ok');
  assertEqual(s1.cursorSaved, true, '10. cursorSaved=true');
  assertEqual(s1.cycleCompleted, false, '10. cycleCompleted=false');
  const savedAfter1 = partialSim.getState().cursor;
  assert(savedAfter1 !== null && savedAfter1.v === 1, '10. non-null v1 cursor persisted in DB');
  assertEqual(partialSim.getState().scan_token, null, '17. lease released after success');

  // 12a. Scanner list failure does NOT overwrite previously saved cursor & releases lease
  partialSim.hooks.onList = () => Promise.reject(new Error('storage_http_500'));
  const sFailList = await runOrphanScanOrchestration(partialSim.gateway, cfg, {
    maxOrphanScansPerInvocation: 10,
    nowMs: partialSim.nowMs,
    wallClockMs: partialSim.wallClockMs,
    logger: () => {},
  });
  assertEqual(sFailList.ok, false, '12a. list failure marks invocation failed');
  assertEqual(sFailList.cursorSaved, false, '12a. cursorSaved=false');
  assertEqual(JSON.stringify(partialSim.getState().cursor), JSON.stringify(savedAfter1), '12a. prior cursor intact');
  assertEqual(partialSim.getState().scan_token, null, '18. lease released after failure');

  // 12b. Scanner enqueue failure does NOT swallow error or move cursor
  partialSim.hooks.onList = null;
  partialSim.hooks.onEnqueueOrphan = () => Promise.reject(new WorkerRpcError('db_down', 503, '503', true));
  const sFailEnq = await runOrphanScanOrchestration(partialSim.gateway, cfg, {
    maxOrphanScansPerInvocation: 10,
    nowMs: partialSim.nowMs,
    wallClockMs: partialSim.wallClockMs,
    logger: () => {},
  });
  assertEqual(sFailEnq.ok, false, '12b. enqueue failure marks invocation failed');
  assertEqual(sFailEnq.cursorSaved, false, '12b. cursorSaved=false');
  assertEqual(JSON.stringify(partialSim.getState().cursor), JSON.stringify(savedAfter1), '12b. prior cursor intact');
  assertEqual(partialSim.getState().scan_token, null, '18b. lease released after enqueue failure');

  // 13. Retention sweep failure skips scan, does not save cursor, releases lease
  partialSim.hooks.onEnqueueOrphan = null;
  partialSim.hooks.onRetention = () =>
    Promise.reject(new WorkerRpcError('retention_lock_timeout', 500, '55P03', true));
  partialSim.callHistory.length = 0;
  const sFailRet = await runOrphanScanOrchestration(partialSim.gateway, cfg, {
    maxOrphanScansPerInvocation: 10,
    nowMs: partialSim.nowMs,
    wallClockMs: partialSim.wallClockMs,
    logger: () => {},
  });
  assertEqual(sFailRet.ok, false, '13. retention failure fails invocation');
  assertEqual(sFailRet.errorCategory, 'retention_sweep_failed', '13. errorCategory=retention_sweep_failed');
  assertEqual(sFailRet.cursorSaved, false, '13. cursorSaved=false');
  assert(
    !partialSim.callHistory.some((c) => c.startsWith('listStorageObjects') || c === 'saveOrphanScanCursor'),
    '13. neither scan nor save executed on retention failure'
  );
  assertEqual(JSON.stringify(partialSim.getState().cursor), JSON.stringify(savedAfter1), '13. prior cursor untouched');
  assertEqual(partialSim.getState().scan_token, null, '18c. lease released');

  // 11. Resume cleanly from savedAfter1 and complete full cycle -> clears cursor=null
  partialSim.hooks.onRetention = null;
  assert(initialCursor.v === 1, 'sanity');
  const sComplete = await runOrphanScanOrchestration(partialSim.gateway, cfg, {
    maxOrphanScansPerInvocation: 10,
    nowMs: partialSim.nowMs,
    wallClockMs: partialSim.wallClockMs,
    logger: () => {},
  });
  assertEqual(sComplete.ok, true, '11. completion run ok');
  assertEqual(sComplete.cycleCompleted, true, '11. cycleCompleted=true');
  assertEqual(sComplete.cursorSaved, true, '11. cursorSaved=true');
  assertEqual(partialSim.getState().cursor, null, '11. cursor cleared in DB');
  assertEqual(partialSim.orphanQueue.length, 4, '11. all 4 objects processed once across resume');
});

// =============================================================================
// 14-19. Lease Renewal, Renewal Failure Abort, Stale Token Save, Release Failure
// =============================================================================

Deno.test('14-19. Renews near threshold, halts on renew failure, handles stale token save & release failure safely', async () => {
  // 14. Trigger lease renewal when elapsed crosses 185s (remaining 115s < 120s threshold)
  const sim = createOrphanScanSimulator({
    initialObjects: [1, 2, 3].map((i) => ({
      bucket_id: 'complaints',
      name: makePath(i),
      created_at: '2026-11-10T00:00:00.000Z',
    })),
    initialCursor: {
      v: 1,
      bucketIndex: 2,
      queue: [{ prefix: '', depth: 0, afterName: null, afterIsFolder: false, offset: 0 }],
    },
    pageSize: 1,
  });

  const cfg = {
    ...DEFAULT_ORPHAN_SCAN_CONFIG,
    invocationTimeoutMs: 240_000, // allow 235s soft stop so renewal at 185s runs cleanly
    orphanListPageSize: 1,
    leaseRenewThresholdMs: DEFAULT_LEASE_RENEW_THRESHOLD_MS,
  };

  let listCalls = 0;
  const origList = sim.gateway.listStorageObjects.bind(sim.gateway);
  sim.gateway.listStorageObjects = async (b, p, l, o, t) => {
    listCalls += 1;
    if (listCalls === 2) {
      // Simulate 190 seconds passing -> remaining lease = 110s < 120s threshold before page 3
      sim.advanceMs(190_000);
    }
    return await origList(b, p, l, o, t);
  };

  const renewSummary = await runOrphanScanOrchestration(sim.gateway, cfg, {
    nowMs: sim.nowMs,
    wallClockMs: sim.wallClockMs,
    logger: () => {},
  });
  assertEqual(renewSummary.ok, true, '14. completes after lease renewal');
  assert(renewSummary.leaseRenewed >= 1, '14. lease renewal triggered once past threshold');

  // 15. Renewal failure halts scan immediately and skips cursor save
  const failRenewSim = createOrphanScanSimulator({
    initialObjects: [1, 2, 3].map((i) => ({
      bucket_id: 'complaints',
      name: makePath(i),
      created_at: '2026-11-10T00:00:00.000Z',
    })),
    initialCursor: {
      v: 1,
      bucketIndex: 2,
      queue: [{ prefix: '', depth: 0, afterName: null, afterIsFolder: false, offset: 0 }],
    },
  });
  failRenewSim.hooks.onRenew = () =>
    Promise.resolve({ renewed: false, lease_expires_at: null, db_now: new Date().toISOString() });
  const savedBeforeRenewFail = failRenewSim.getState().cursor;
  const failRenewCfg = { ...DEFAULT_ORPHAN_SCAN_CONFIG, invocationTimeoutMs: 240_000 };
  const origFailRet = failRenewSim.gateway.enqueueSoftDeletedDomainStorageDeletions.bind(failRenewSim.gateway);
  failRenewSim.hooks.onRetention = async (retInt, lim) => {
    failRenewSim.hooks.onRetention = null;
    const res = await origFailRet(retInt, lim);
    // Advance elapsed clock past 120s threshold right before storage listing starts
    failRenewSim.advanceMs(185_000);
    return res;
  };
  const failRenewRes = await runOrphanScanOrchestration(failRenewSim.gateway, failRenewCfg, {
    nowMs: failRenewSim.nowMs,
    wallClockMs: failRenewSim.wallClockMs,
    logger: () => {},
  });
  assertEqual(failRenewRes.ok, false, '15. renewal failure stops invocation');
  assertEqual(failRenewRes.errorCategory, 'lease_renewal_failed', '15. lease_renewal_failed');
  assertEqual(failRenewRes.processedCount, 0, '15. zero items scanned after renewal failure');
  assertEqual(failRenewRes.cursorSaved, false, '15. cursorSaved=false');
  assertEqual(JSON.stringify(failRenewSim.getState().cursor), JSON.stringify(savedBeforeRenewFail), '15. cursor unchanged');

  // 16. Stale token on save handled as failure
  const staleSaveSim = createOrphanScanSimulator({
    initialObjects: [{ bucket_id: 'complaints', name: makePath(1), created_at: '2026-11-10T00:00:00.000Z' }],
  });
  staleSaveSim.hooks.onSave = () =>
    Promise.reject(new WorkerRpcError('stale_orphan_scan_lease', 400, 'P0001', false));
  const staleRes = await runOrphanScanOrchestration(staleSaveSim.gateway, DEFAULT_ORPHAN_SCAN_CONFIG, {
    nowMs: staleSaveSim.nowMs,
    wallClockMs: staleSaveSim.wallClockMs,
    logger: () => {},
  });
  assertEqual(staleRes.ok, false, '16. stale save fails');
  assertEqual(staleRes.errorCategory, 'cursor_save_failed', '16. cursor_save_failed');
  assertEqual(staleRes.cursorSaved, false, '16. cursorSaved=false');
  assertEqual(staleSaveSim.getState().scan_token, null, '18. release attempted in finally');

  // 19. Release failure after successful save keeps cursor persisted and returns ok
  const relFailSim = createOrphanScanSimulator({
    initialObjects: [{ bucket_id: 'complaints', name: makePath(1), created_at: '2026-11-10T00:00:00.000Z' }],
    initialCursor: {
      v: 1,
      bucketIndex: 0,
      queue: [{ prefix: '', depth: 0, afterName: null, afterIsFolder: false, offset: 0 }],
    },
  });
  relFailSim.hooks.onRelease = () => Promise.reject(new Error('release_network_timeout_tok-scan-secret-leak-check'));
  const relLogs = [];
  const relFailRes = await runOrphanScanOrchestration(relFailSim.gateway, DEFAULT_ORPHAN_SCAN_CONFIG, {
    nowMs: relFailSim.nowMs,
    wallClockMs: relFailSim.wallClockMs,
    logger: (entry) => relLogs.push(entry),
  });
  assertEqual(relFailRes.ok, true, '19. release failure does not abort already-saved completion');
  assertEqual(relFailRes.cursorSaved, true, '19. cursorSaved preserved');
  assertEqual(relFailRes.leaseReleaseFailed, true, '19. leaseReleaseFailed flagged cleanly');
  assertEqual(relFailSim.getState().cursor, null, '19. DB save remained committed');
  const serializedLogs = JSON.stringify(relLogs);
  assert(!serializedLogs.includes('tok-scan-secret'), '19 & 20. scan token absent from release failure log');
});

// =============================================================================
// 20-22. Zero Secret/Token Leakage, Soft Execution Budget Stop, Concurrency Race
// =============================================================================

Deno.test('20-22. Never leaks keys/tokens in response or logs, stops at execution budget, serializes concurrent runs', async () => {
  // 20. Secret/key/token leakage audit across logs & HTTP response
  const leakSim = createOrphanScanSimulator({
    initialObjects: [{ bucket_id: 'complaints', name: makePath(1), created_at: '2026-11-10T00:00:00.000Z' }],
  });
  const capturedLogs = [];
  const okHttpRes = await handleOrphanScanRequest(
    new Request('http://local/orphan-scan', {
      method: 'POST',
      headers: { Authorization: `Bearer ${STRONG_SECRET}` },
    }),
    {
      envGet: defaultEnv(),
      gatewayFactory: () => leakSim.gateway,
      runOptions: {
        nowMs: leakSim.nowMs,
        wallClockMs: leakSim.wallClockMs,
        logger: (e) => capturedLogs.push(e),
      },
    }
  );
  const okText = await okHttpRes.text();
  const okParsed = JSON.parse(okText);
  assertEqual(okHttpRes.status, 200, '20. HTTP 200');
  assert(!('cursor' in okParsed) && !('scan_token' in okParsed), '20. HTTP JSON excludes cursor and scan_token');

  const combined = `${okText}\n${JSON.stringify(capturedLogs)}`;
  assert(!combined.includes(STRONG_SECRET), '20. worker secret not leaked');
  assert(!combined.includes(FAKE_SERVICE_KEY), '20. service_role key not leaked');
  assert(!combined.includes('tok-scan-secret'), '20. scan_token not leaked');

  // 21. Execution budget soft stop (105s on 110s default invocationTimeoutMs) pauses scan and saves partial cursor
  const budgetSim = createOrphanScanSimulator({
    initialObjects: [1, 2, 3, 4].map((i) => ({
      bucket_id: 'resident-documents',
      name: makePath(i),
      created_at: '2026-11-10T00:00:00.000Z',
    })),
    pageSize: 1,
  });
  const origBudgetEnq = budgetSim.gateway.enqueueOrphanStorageDeletion.bind(budgetSim.gateway);
  let enqCalls = 0;
  budgetSim.gateway.enqueueOrphanStorageDeletion = async (b, p, r) => {
    enqCalls += 1;
    const out = await origBudgetEnq(b, p, r);
    if (enqCalls === 2) {
      // Cross 105s soft execution stop cleanly during scan
      budgetSim.advanceMs(106_000);
    }
    return out;
  };
  const cfgBudget = loadOrphanScanConfig(defaultEnv());
  assertEqual(cfgBudget.invocationTimeoutMs, 110_000, '21. default invocation budget is 110s');
  const budgetSummary = await runOrphanScanOrchestration(budgetSim.gateway, cfgBudget, {
    nowMs: budgetSim.nowMs,
    wallClockMs: budgetSim.wallClockMs,
    logger: () => {},
  });
  assertEqual(budgetSummary.ok, true, '21. soft execution stop completes safely');
  assertEqual(budgetSummary.processedCount, 2, '21. stopped after crossing 105s soft budget');
  assertEqual(budgetSummary.cycleCompleted, false, '21. partial pause marked cycleCompleted=false');
  assertEqual(budgetSummary.cursorSaved, true, '21. continuation cursor persisted cleanly');
  assert(budgetSim.getState().cursor !== null, '21. DB cursor saved for next run');
  assertEqual(budgetSim.getState().scan_token, null, '21. lease released cleanly');

  // 22. Concurrent invocations: exactly one acquires lease & scans, second safely skips
  const concSim = createOrphanScanSimulator({
    initialObjects: [{ bucket_id: 'complaints', name: makePath(1), created_at: '2026-11-10T00:00:00.000Z' }],
  });
  let releaseGate;
  const gatePromise = new Promise((resolve) => {
    releaseGate = resolve;
  });
  const origConcRet = concSim.gateway.enqueueSoftDeletedDomainStorageDeletions.bind(concSim.gateway);
  concSim.hooks.onRetention = async (ret, lim) => {
    concSim.hooks.onRetention = null;
    await gatePromise;
    return await origConcRet(ret, lim);
  };

  const p1 = handleOrphanScanRequest(
    new Request('http://local/orphan-scan', {
      method: 'POST',
      headers: { Authorization: `Bearer ${STRONG_SECRET}` },
    }),
    { envGet: defaultEnv(), gatewayFactory: () => concSim.gateway, runOptions: { logger: () => {} } }
  );

  // Yield microtask so p1 holds the active DB lease inside onRetention before p2 arrives
  await Promise.resolve();
  await Promise.resolve();

  const p2 = handleOrphanScanRequest(
    new Request('http://local/orphan-scan', {
      method: 'POST',
      headers: { Authorization: `Bearer ${STRONG_SECRET}` },
    }),
    { envGet: defaultEnv(), gatewayFactory: () => concSim.gateway, runOptions: { logger: () => {} } }
  );

  const res2 = await p2;
  const body2 = await res2.json();
  assertEqual(res2.status, 200, '22. concurrent second worker returns 200');
  assertEqual(body2.status, 'skipped_lease_busy', '22. second worker safely skipped');
  assertEqual(body2.leaseAcquired, false, '22. second worker did not acquire lease');

  releaseGate();
  const res1 = await p1;
  const body1 = await res1.json();
  assertEqual(res1.status, 200, '22. first worker completes 200');
  assertEqual(body1.status, 'completed', '22. first worker completed cycle');
  assertEqual(body1.leaseAcquired, true, '22. first worker held lease');
  assertEqual(concSim.orphanQueue.length, 1, '22. orphan object queued only once');
});
