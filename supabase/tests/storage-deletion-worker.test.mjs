import {
  DEFAULT_WORKER_CONFIG,
  MIN_WORKER_SECRET_BYTES,
  WorkerRpcError,
  createSupabaseWorkerGateway,
  handleWorkerRequest,
  loadWorkerConfig,
  redactSensitiveString,
  runWorkerInvocation,
  timingSafeSecretMatch,
} from '../functions/storage-deletion-worker/index.ts';

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
const FILE_1 = '33333333-3333-4333-8333-333333333301';
const FILE_2 = '33333333-3333-4333-8333-333333333302';

function makeJob(overrides = {}) {
  const dbNow = '2026-11-14T01:00:00.000Z';
  const leaseExp = '2026-11-14T01:05:00.000Z';
  return {
    job_id: 'job-0001',
    tenant_id: TENANT_A,
    bucket_id: 'resident-documents',
    object_path: `${TENANT_A}/${ENTITY_A}/${FILE_1}.pdf`,
    entity_type: 'resident_document',
    entity_id: ENTITY_A,
    attempt_count: 1,
    claim_token: 'tok-valid-0001',
    claimed_at: dbNow,
    lease_expires_at: leaseExp,
    db_now: dbNow,
    ...overrides,
  };
}

/**
 * In-memory stateful queue + Storage simulator obeying Migration 0015 fencing rules.
 */
function createStatefulSimulator(initialJobs = [], initialObjects = []) {
  const jobs = new Map(initialJobs.map((j) => [j.job_id, { ...j }]));
  const objects = new Map(initialObjects.map((o) => [`${o.bucket_id}/${o.name}`, { ...o }]));
  const orphanQueue = [];
  const invalidQuarantine = [];
  let tokenCounter = 1;
  let nowOffsetMs = 0;

  function dbNowDate() {
    return new Date(Date.parse('2026-11-14T01:00:00.000Z') + nowOffsetMs);
  }

  function advanceMs(ms) {
    nowOffsetMs += ms;
  }

  function assertValidClaim(jobId, claimToken) {
    const j = jobs.get(jobId);
    if (!j) throw new Error('stale_claim: job_not_found');
    if (j.status !== 'processing') throw new Error('stale_claim: not_processing');
    if (j.claim_token !== claimToken) throw new Error('stale_claim: token_mismatch');
    if (Date.parse(j.lease_expires_at) <= dbNowDate().getTime()) {
      throw new Error('stale_claim: lease_expired');
    }
    return j;
  }

  const gateway = {
    async claimStorageDeletionJobs(batchSize) {
      const now = dbNowDate();
      const claimed = [];
      for (const j of jobs.values()) {
        if (claimed.length >= batchSize) break;
        const canClaim =
          j.status === 'pending' ||
          j.status === 'failed' ||
          (j.status === 'processing' && Date.parse(j.lease_expires_at) <= now.getTime());
        if (!canClaim) continue;
        tokenCounter += 1;
        j.status = 'processing';
        j.attempt_count += 1;
        j.claim_token = `tok-claim-${tokenCounter}`;
        j.claimed_at = now.toISOString();
        j.lease_expires_at = new Date(now.getTime() + 300_000).toISOString();
        j.decision = null;
        claimed.push({
          job_id: j.job_id,
          tenant_id: j.tenant_id,
          bucket_id: j.bucket_id,
          object_path: j.object_path,
          entity_type: j.entity_type,
          entity_id: j.entity_id,
          attempt_count: j.attempt_count,
          claim_token: j.claim_token,
          claimed_at: j.claimed_at,
          lease_expires_at: j.lease_expires_at,
          db_now: now.toISOString(),
        });
      }
      return claimed;
    },

    async beginStorageDeletion(jobId, claimToken) {
      const j = assertValidClaim(jobId, claimToken);
      j.decision = j.sharedRef ? 'detach_only' : 'delete_physical';
      return j.decision;
    },

    async renewStorageDeletionLease(jobId, claimToken) {
      const now = dbNowDate();
      const j = jobs.get(jobId);
      if (
        !j ||
        j.status !== 'processing' ||
        j.claim_token !== claimToken ||
        Date.parse(j.lease_expires_at) <= now.getTime()
      ) {
        return { renewed: false, lease_expires_at: null, db_now: now.toISOString() };
      }
      j.lease_expires_at = new Date(now.getTime() + 300_000).toISOString();
      return { renewed: true, lease_expires_at: j.lease_expires_at, db_now: now.toISOString() };
    },

    async completeStorageDeletion(jobId, claimToken, storageResult) {
      const j = assertValidClaim(jobId, claimToken);
      const key = `${j.bucket_id}/${j.object_path}`;
      if (j.decision === 'delete_physical' && objects.has(key)) {
        j.status = j.attempt_count >= 10 ? 'exhausted' : 'failed';
        j.claim_token = null;
        j.last_error = 'object_still_present';
        return 'object_still_present';
      }
      j.status = 'completed';
      j.claim_token = null;
      j.lease_expires_at = null;
      j.storage_result = storageResult;
      return 'completed';
    },

    async failStorageDeletion(jobId, claimToken, errorMessage) {
      const j = assertValidClaim(jobId, claimToken);
      j.status = j.attempt_count >= 10 ? 'exhausted' : 'failed';
      j.claim_token = null;
      j.lease_expires_at = null;
      j.last_error = errorMessage;
      return j.status;
    },

    async enqueueOrphanStorageDeletion(bucketId, objectPath) {
      const key = `${bucketId}/${objectPath}`;
      const obj = objects.get(key);
      if (!obj || obj.tooYoungByDb) return 'skipped_too_young';
      if (obj.referenced) return 'skipped_referenced';
      if (obj.activeJob) return 'skipped_active_job';
      orphanQueue.push({ bucket_id: bucketId, object_path: objectPath });
      return 'created';
    },

    async recordInvalidStoragePath(bucketId, objectPath, reason) {
      invalidQuarantine.push({ bucket_id: bucketId, object_path: objectPath, reason });
      return 'audit-1';
    },

    async removeStorageObject(bucketId, objectPath) {
      const key = `${bucketId}/${objectPath}`;
      if (!objects.has(key)) return { kind: 'not_found' };
      objects.delete(key);
      return { kind: 'deleted' };
    },

    async listStorageObjects(bucketId, prefix, limit = 100, offset = 0) {
      const entries = [];
      for (const obj of objects.values()) {
        if (obj.bucket_id !== bucketId) continue;
        if (!prefix && obj.name.includes('/')) {
          const seg = obj.name.split('/')[0];
          if (!entries.some((e) => e.name === seg && e.id === null)) {
            entries.push({ name: seg, id: null, created_at: null });
          }
        } else if (prefix && obj.name.startsWith(`${prefix}/`)) {
          const rest = obj.name.slice(prefix.length + 1);
          if (rest.includes('/')) {
            const seg = rest.split('/')[0];
            if (!entries.some((e) => e.name === seg && e.id === null)) {
              entries.push({ name: seg, id: null, created_at: null });
            }
          } else {
            entries.push({
              name: rest,
              id: obj.id ?? 'obj-id',
              created_at: obj.created_at,
              archived_at: obj.archived_at ?? null,
              is_delete_marker: obj.is_delete_marker ?? false,
            });
          }
        } else if (!prefix && !obj.name.includes('/')) {
          entries.push({
            name: obj.name,
            id: obj.id ?? 'obj-id',
            created_at: obj.created_at,
            archived_at: obj.archived_at ?? null,
            is_delete_marker: obj.is_delete_marker ?? false,
          });
        }
      }
      entries.sort((a, b) => {
        const an = a.name.toLowerCase();
        const bn = b.name.toLowerCase();
        if (an !== bn) return an < bn ? -1 : 1;
        return (a.id === null ? 1 : 0) - (b.id === null ? 1 : 0);
      });
      return { entries: entries.slice(offset, offset + limit) };
    },
  };

  return { gateway, jobs, objects, orphanQueue, invalidQuarantine, advanceMs, dbNowDate };
}

Deno.test('1 & 2. Pending job claimed and object deleted physically', async () => {
  const path = `${TENANT_A}/${ENTITY_A}/${FILE_1}.pdf`;
  const sim = createStatefulSimulator(
    [
      {
        job_id: 'job-1',
        tenant_id: TENANT_A,
        bucket_id: 'resident-documents',
        object_path: path,
        entity_type: 'resident_document',
        entity_id: ENTITY_A,
        status: 'pending',
        attempt_count: 0,
      },
    ],
    [
      {
        bucket_id: 'resident-documents',
        name: path,
        created_at: '2026-11-12T00:00:00.000Z',
      },
    ]
  );

  const summary = await runWorkerInvocation(sim.gateway, DEFAULT_WORKER_CONFIG, {
    mode: 'process',
    logger: () => {},
  });

  assertEqual(summary.claimed, 1, 'claimed');
  assertEqual(summary.completed, 1, 'completed');
  assertEqual(sim.jobs.get('job-1').status, 'completed', 'job status');
  assertEqual(sim.objects.size, 0, 'storage object deleted');
});

Deno.test('3. Missing Storage object (not_found) treated idempotently as success', async () => {
  const path = `${TENANT_A}/${ENTITY_A}/${FILE_1}.pdf`;
  const sim = createStatefulSimulator(
    [
      {
        job_id: 'job-nf',
        tenant_id: TENANT_A,
        bucket_id: 'complaints',
        object_path: path,
        entity_type: 'complaint',
        entity_id: ENTITY_A,
        status: 'pending',
        attempt_count: 0,
      },
    ],
    []
  );

  const summary = await runWorkerInvocation(sim.gateway, DEFAULT_WORKER_CONFIG, {
    mode: 'process',
    logger: () => {},
  });

  assertEqual(summary.completed, 1, 'completed');
  assertEqual(summary.notFoundIdempotent, 1, 'notFoundIdempotent');
  assertEqual(sim.jobs.get('job-nf').storage_result, 'not_found', 'storage_result');
});

Deno.test('4. Storage API timeout triggers fail_storage_deletion retry', async () => {
  const path = `${TENANT_A}/${ENTITY_A}/${FILE_1}.pdf`;
  const sim = createStatefulSimulator([
    {
      job_id: 'job-to',
      tenant_id: TENANT_A,
      bucket_id: 'payment-proofs',
      object_path: path,
      entity_type: 'payment',
      entity_id: ENTITY_A,
      status: 'pending',
      attempt_count: 0,
    },
  ]);

  sim.gateway.removeStorageObject = async () => ({
    kind: 'retryable_error',
    errorCode: 'storage_timeout',
  });

  const summary = await runWorkerInvocation(sim.gateway, DEFAULT_WORKER_CONFIG, {
    mode: 'process',
    logger: () => {},
  });

  assertEqual(summary.retried, 1, 'retried');
  assertEqual(summary.completed, 0, 'completed');
  assertEqual(sim.jobs.get('job-to').status, 'failed', 'job failed for retry');
  assertEqual(sim.jobs.get('job-to').last_error, 'storage_timeout', 'timeout reason recorded');
});

Deno.test('5. Expired lease cannot renew or finalize before Storage call', async () => {
  const job = makeJob({
    db_now: '2026-11-14T01:00:00.000Z',
    lease_expires_at: '2026-11-14T01:00:30.000Z', // 30s left < 2m RENEW_MARGIN
  });

  let removeCalled = false;
  let completeCalled = false;
  const gateway = {
    async claimStorageDeletionJobs() {
      return [job];
    },
    async beginStorageDeletion() {
      return 'delete_physical';
    },
    async renewStorageDeletionLease() {
      // Simulate lease expired before renew executed
      return { renewed: false, lease_expires_at: null, db_now: '2026-11-14T01:01:00.000Z' };
    },
    async completeStorageDeletion() {
      completeCalled = true;
      return 'completed';
    },
    async failStorageDeletion() {
      return 'failed';
    },
    async enqueueOrphanStorageDeletion() {
      return 'created';
    },
    async recordInvalidStoragePath() {
      return 'audit';
    },
    async removeStorageObject() {
      removeCalled = true;
      return { kind: 'deleted' };
    },
    async listStorageObjects() {
      return { entries: [] };
    },
  };

  const summary = await runWorkerInvocation(gateway, DEFAULT_WORKER_CONFIG, {
    mode: 'process',
    logger: () => {},
  });

  assertEqual(removeCalled, false, 'must abandon before calling Storage');
  assertEqual(completeCalled, false, 'must not finalize expired lease');
  assertEqual(summary.staleAbandoned, 1, 'staleAbandoned');
});

Deno.test('6. Stale claim token cannot complete job (rejected by DB fencing)', async () => {
  const path = `${TENANT_A}/${ENTITY_A}/${FILE_1}.pdf`;
  const sim = createStatefulSimulator(
    [
      {
        job_id: 'job-stale',
        tenant_id: TENANT_A,
        bucket_id: 'complaints',
        object_path: path,
        entity_type: 'complaint',
        entity_id: ENTITY_A,
        status: 'pending',
        attempt_count: 0,
      },
    ],
    [{ bucket_id: 'complaints', name: path, created_at: '2026-11-10T00:00:00.000Z' }]
  );

  // Override completeStorageDeletion to simulate token having been reclaimed while Storage ran
  const origComplete = sim.gateway.completeStorageDeletion;
  let hijackedOnce = false;
  sim.gateway.completeStorageDeletion = async (id, tok, res) => {
    if (!hijackedOnce) {
      hijackedOnce = true;
      sim.jobs.get(id).claim_token = 'tok-reclaimed-by-worker-2';
    }
    return origComplete(id, tok, res);
  };

  const summary = await runWorkerInvocation(sim.gateway, DEFAULT_WORKER_CONFIG, {
    mode: 'process',
    maxJobsPerInvocation: 1,
    logger: () => {},
  });

  assertEqual(summary.completed, 0, 'stale worker did not mark completed');
  assertEqual(summary.staleAbandoned, 1, 'staleAbandoned recorded');
  assertEqual(sim.jobs.get('job-stale').status, 'processing', 'still processing under new claim');
});

Deno.test('7. Finalization failure recovers via transient retry & via reclaim idempotency', async () => {
  const path = `${TENANT_A}/${ENTITY_A}/${FILE_1}.pdf`;
  const sim = createStatefulSimulator(
    [
      {
        job_id: 'job-fin',
        tenant_id: TENANT_A,
        bucket_id: 'activity-docs',
        object_path: path,
        entity_type: 'activity',
        entity_id: ENTITY_A,
        status: 'pending',
        attempt_count: 0,
      },
    ],
    [{ bucket_id: 'activity-docs', name: path, created_at: '2026-11-10T00:00:00.000Z' }]
  );

  // Case A: transient retryable WorkerRpcError once -> recovers inside same invocation
  const origComplete = sim.gateway.completeStorageDeletion;
  let failCount = 0;
  const configFast = { ...DEFAULT_WORKER_CONFIG, finalizationRetryDelayMs: 1, maxFinalizationAttempts: 2 };
  const sRetry = await runWorkerInvocation(
    {
      ...sim.gateway,
      async completeStorageDeletion(id, tok, res) {
        if (failCount === 0) {
          failCount += 1;
          throw new WorkerRpcError('DB lock timeout', 503, '55P03', true);
        }
        return origComplete(id, tok, res);
      },
    },
    configFast,
    { mode: 'process', sleep: async () => {}, logger: () => {} }
  );
  assertEqual(sRetry.completed, 1, 'transient finalization error recovered on retry');
  assertEqual(sim.jobs.get('job-fin').status, 'completed', 'job completed in Case A');

  // Case B: exhausted finalization retries on job-fin2 -> second invocation recovers via 'not_found'
  const path2 = `${TENANT_A}/${ENTITY_A}/${FILE_2}.pdf`;
  const simB = createStatefulSimulator(
    [
      {
        job_id: 'job-fin2',
        tenant_id: TENANT_A,
        bucket_id: 'activity-docs',
        object_path: path2,
        entity_type: 'activity',
        entity_id: ENTITY_A,
        status: 'pending',
        attempt_count: 0,
      },
    ],
    [{ bucket_id: 'activity-docs', name: path2, created_at: '2026-11-10T00:00:00.000Z' }]
  );
  const origCompleteB = simB.gateway.completeStorageDeletion;
  const s1 = await runWorkerInvocation(
    {
      ...simB.gateway,
      async completeStorageDeletion() {
        throw new WorkerRpcError('DB unavailable', 503, 'rpc_network_error', true);
      },
    },
    configFast,
    { mode: 'process', sleep: async () => {}, logger: () => {} }
  );
  assertEqual(s1.finalizationFailed, 1, 'recorded finalizationFailed');
  assertEqual(simB.objects.size, 0, 'Storage object already removed cleanly');
  assertEqual(simB.jobs.get('job-fin2').status, 'failed', 'scheduled for recovery retry');

  simB.gateway.completeStorageDeletion = origCompleteB;
  const s2 = await runWorkerInvocation(simB.gateway, configFast, {
    mode: 'process',
    logger: () => {},
  });
  assertEqual(s2.completed, 1, 're-claimed recovery completes');
  assertEqual(s2.notFoundIdempotent, 1, 'second invocation sees not_found and succeeds');
  assertEqual(simB.jobs.get('job-fin2').status, 'completed', 'job completed after recovery');
});

Deno.test('8. Two concurrent worker invocations cannot process the same job unsafely', async () => {
  const path = `${TENANT_A}/${ENTITY_A}/${FILE_1}.pdf`;
  const sim = createStatefulSimulator(
    [
      {
        job_id: 'job-race',
        tenant_id: TENANT_A,
        bucket_id: 'resident-documents',
        object_path: path,
        entity_type: 'resident_document',
        entity_id: ENTITY_A,
        status: 'pending',
        attempt_count: 0,
      },
    ],
    [{ bucket_id: 'resident-documents', name: path, created_at: '2026-11-10T00:00:00.000Z' }]
  );

  // Wrap removeStorageObject to yield microtasks so both invocations overlap in wall time
  const origRemove = sim.gateway.removeStorageObject;
  let removeCalls = 0;
  sim.gateway.removeStorageObject = async (b, p, t) => {
    removeCalls += 1;
    await new Promise((r) => setTimeout(r, 10));
    return origRemove(b, p, t);
  };

  const [s1, s2] = await Promise.all([
    runWorkerInvocation(sim.gateway, DEFAULT_WORKER_CONFIG, { mode: 'process', logger: () => {} }),
    runWorkerInvocation(sim.gateway, DEFAULT_WORKER_CONFIG, { mode: 'process', logger: () => {} }),
  ]);

  assertEqual(s1.claimed + s2.claimed, 1, 'only one worker claimed the job');
  assertEqual(s1.completed + s2.completed, 1, 'exactly one completion');
  assertEqual(removeCalls, 1, 'only one Storage remove call');
});

Deno.test('9. Orphan scan enqueues aged unreferenced objects without deleting directly, quarantines invalid paths', async () => {
  const validOldOrphan = `${TENANT_A}/${ENTITY_A}/${FILE_1}.pdf`;
  const tooYoungObject = `${TENANT_A}/${ENTITY_A}/${FILE_2}.pdf`;
  const invalidPath = `not-a-uuid/bad.pdf`;

  const sim = createStatefulSimulator([], [
    {
      bucket_id: 'resident-documents',
      name: validOldOrphan,
      created_at: '2026-11-10T00:00:00.000Z',
    },
    {
      bucket_id: 'resident-documents',
      name: tooYoungObject,
      created_at: '2026-11-14T00:30:00.000Z',
    },
    {
      bucket_id: 'resident-documents',
      name: invalidPath,
      created_at: '2026-11-10T00:00:00.000Z',
    },
  ]);

  let removeCalled = false;
  sim.gateway.removeStorageObject = async () => {
    removeCalled = true;
    return { kind: 'deleted' };
  };

  const summary = await runWorkerInvocation(sim.gateway, DEFAULT_WORKER_CONFIG, {
    mode: 'orphan_scan',
    buckets: ['resident-documents'],
    wallClockMs: () => Date.parse('2026-11-14T01:00:00.000Z'),
    logger: () => {},
  });

  assertEqual(removeCalled, false, 'orphan_scan must NEVER call removeStorageObject directly');
  assertEqual(summary.orphanScan.enqueued, 1, 'enqueued valid orphan');
  assertEqual(summary.orphanScan.skippedTooYoung, 1, 'skipped too-young object');
  assertEqual(summary.orphanScan.quarantined, 1, 'invalid path quarantined');
  assertEqual(sim.orphanQueue.length, 1, 'orphan queue received entry');
  assertEqual(sim.orphanQueue[0].object_path, validOldOrphan, 'correct orphan queued');
  assertEqual(sim.invalidQuarantine.length, 1, 'invalid path recorded');
  assertEqual(sim.objects.size, 3, 'all 3 physical objects remain untouched until queue worker processes valid job');
});

Deno.test('10. Error logs and HTTP auth never leak service_role key, worker secret, JWTs, or claim tokens', async () => {
  const SECRET_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.supersecretvalue123';
  const WORKER_SECRET = '0123456789abcdef0123456789abcdef-strong-32b';
  const CLAIM_TOKEN = 'secret-claim-uuid-9999';
  const logs = [];

  const redacted = redactSensitiveString(`Failed header Bearer ${SECRET_KEY} and sb_secret_abcd1234`);
  assert(!redacted.includes(SECRET_KEY), 'JWT redacted');
  assert(!redacted.includes('sb_secret_abcd1234'), 'sb_secret redacted');

  const sim = createStatefulSimulator([
    {
      job_id: 'job-log',
      tenant_id: TENANT_A,
      bucket_id: 'resident-documents',
      object_path: `${TENANT_A}/${ENTITY_A}/${FILE_1}.pdf`,
      entity_type: 'resident_document',
      entity_id: ENTITY_A,
      status: 'pending',
      attempt_count: 9,
      claim_token: CLAIM_TOKEN,
    },
  ]);

  sim.gateway.removeStorageObject = async () => ({
    kind: 'retryable_error',
    errorCode: `storage_http_500_Bearer ${SECRET_KEY}`,
  });

  await runWorkerInvocation(sim.gateway, DEFAULT_WORKER_CONFIG, {
    mode: 'process',
    logger: (entry) => logs.push(JSON.stringify(entry)),
  });

  const joined = logs.join('\n');
  assert(joined.includes('storage_deletion.exhausted'), 'exhausted alert logged');
  assert(!joined.includes(SECRET_KEY), 'logs must not contain service_role JWT');
  assert(!joined.includes(WORKER_SECRET), 'logs must not contain worker secret');
  assert(!joined.includes(CLAIM_TOKEN), 'logs must not contain claim_token');
  assert(!joined.includes('tok-claim-'), 'logs must not contain rotated claim tokens');

  // Verify HTTP endpoint auth gates fail closed
  const env = {
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: SECRET_KEY,
    STORAGE_DELETION_WORKER_SECRET: WORKER_SECRET,
  };

  const resGet = await handleWorkerRequest(new Request('http://local/worker', { method: 'GET' }), {
    envGet: (k) => env[k],
  });
  assertEqual(resGet.status, 405, 'GET rejected');

  const resUnauth = await handleWorkerRequest(
    new Request('http://local/worker', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-secret' },
    }),
    { envGet: (k) => env[k] }
  );
  assertEqual(resUnauth.status, 401, 'wrong bearer rejected');

  const resMissingEnv = await handleWorkerRequest(new Request('http://local/worker', { method: 'POST' }), {
    envGet: () => undefined,
  });
  assertEqual(resMissingEnv.status, 500, 'missing secret fails closed with 500');

  // Verify config defaults and clamping bounds
  const cfg = loadWorkerConfig(() => undefined);
  assertEqual(cfg.batchSize, 10, 'default batchSize');
  assertEqual(cfg.leaseSeconds, 300, 'default lease 5m');
  assertEqual(cfg.storageHttpTimeoutMs, 60_000, 'default storage timeout 60s');
  assertEqual(cfg.renewMarginMs, 120_000, 'default renew margin 2m');

  // Verify createSupabaseWorkerGateway converts abort/timeout cleanly without leaking URL secret headers
  const gw = createSupabaseWorkerGateway('http://127.0.0.1:1', SECRET_KEY, { dbRpcTimeoutMs: 50 });
  const rm = await gw.removeStorageObject('resident-documents', `${TENANT_A}/${ENTITY_A}/${FILE_1}.pdf`, 20);
  assertEqual(rm.kind, 'retryable_error', 'unreachable/timeout mapped cleanly');
});

Deno.test('11. Worker auth requires >=32-byte Bearer secret, removes x-worker-secret, and matches constant-time', async () => {
  const VALID_SECRET = 'f4e3d2c1b0a9876543210fedcba9876543210abcdef0123456789abcdef01234';
  const SHORT_SECRET = 'too-short-secret-25-bytes';
  assertEqual(MIN_WORKER_SECRET_BYTES, 32, 'minimum secret requirement is 32 bytes');

  assertEqual(await timingSafeSecretMatch(VALID_SECRET, VALID_SECRET), true, 'exact >=32B secret matches');
  assertEqual(
    await timingSafeSecretMatch(VALID_SECRET, 'X' + VALID_SECRET.slice(1)),
    false,
    'first-byte difference rejected'
  );
  assertEqual(
    await timingSafeSecretMatch(VALID_SECRET, VALID_SECRET.slice(0, 16) + 'Z' + VALID_SECRET.slice(17)),
    false,
    'middle-byte difference rejected'
  );
  assertEqual(
    await timingSafeSecretMatch(VALID_SECRET, VALID_SECRET.slice(0, -1) + 'Z'),
    false,
    'last-byte difference rejected'
  );
  assertEqual(await timingSafeSecretMatch(VALID_SECRET, ''), false, 'empty presented secret rejected');
  assertEqual(await timingSafeSecretMatch(SHORT_SECRET, SHORT_SECRET), false, '<32B expected secret fails closed');

  const sim = createStatefulSimulator([], []);
  const envStrong = {
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key-placeholder-for-unit-test',
    STORAGE_DELETION_WORKER_SECRET: VALID_SECRET,
  };

  const resValid = await handleWorkerRequest(
    new Request('http://local/worker', {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_SECRET}` },
      body: JSON.stringify({ mode: 'process' }),
    }),
    {
      envGet: (k) => envStrong[k],
      gatewayFactory: () => sim.gateway,
      runOptions: { logger: () => {} },
    }
  );
  assertEqual(resValid.status, 200, 'valid Authorization Bearer >=32B returns 200');

  const resLegacyHeader = await handleWorkerRequest(
    new Request('http://local/worker', {
      method: 'POST',
      headers: { 'x-worker-secret': VALID_SECRET },
      body: JSON.stringify({ mode: 'process' }),
    }),
    {
      envGet: (k) => envStrong[k],
      gatewayFactory: () => sim.gateway,
    }
  );
  assertEqual(resLegacyHeader.status, 401, 'x-worker-secret is no longer accepted');

  const capturedConsole = [];
  const origLog = console.log;
  console.log = (...args) => capturedConsole.push(args.join(' '));
  try {
    const resWeakEnv = await handleWorkerRequest(
      new Request('http://local/worker', {
        method: 'POST',
        headers: { Authorization: `Bearer ${SHORT_SECRET}` },
      }),
      {
        envGet: (k) =>
          k === 'STORAGE_DELETION_WORKER_SECRET'
            ? SHORT_SECRET
            : envStrong[k],
      }
    );
    assertEqual(resWeakEnv.status, 500, '<32B configured secret fails closed with 500');
  } finally {
    console.log = origLog;
  }
  assert(!capturedConsole.join('\n').includes(SHORT_SECRET), 'weak secret never logged');
});

Deno.test('12. Multi-page orphan scan cursor traverses all pages and buckets without restarting or starving', async () => {
  const makePath = (idx) => {
    const suffix = String(idx).padStart(12, '0');
    return `${TENANT_A}/${ENTITY_A}/33333333-3333-4333-8333-${suffix}.pdf`;
  };

  // Bucket 1 (`resident-documents`) has invalid + young + referenced items BEFORE valid orphans across multiple pages;
  // Bucket 2 (`payment-proofs`) has additional valid orphans.
  const objects = [
    { bucket_id: 'resident-documents', name: 'bad-001.pdf', created_at: '2026-11-10T00:00:00.000Z' },
    { bucket_id: 'resident-documents', name: 'bad-002.pdf', created_at: '2026-11-10T00:00:00.000Z' },
    { bucket_id: 'resident-documents', name: makePath(1), created_at: '2026-11-14T00:45:00.000Z' }, // too young
    { bucket_id: 'resident-documents', name: makePath(2), created_at: '2026-11-14T00:50:00.000Z' }, // too young
    { bucket_id: 'resident-documents', name: makePath(3), created_at: '2026-11-10T00:00:00.000Z', referenced: true },
    { bucket_id: 'resident-documents', name: makePath(4), created_at: '2026-11-10T00:00:00.000Z', referenced: true },
    { bucket_id: 'resident-documents', name: makePath(5), created_at: '2026-11-10T00:00:00.000Z' }, // valid orphan 1
    { bucket_id: 'resident-documents', name: makePath(6), created_at: '2026-11-10T00:00:00.000Z' }, // valid orphan 2
    { bucket_id: 'resident-documents', name: makePath(7), created_at: '2026-11-10T00:00:00.000Z' }, // valid orphan 3
    { bucket_id: 'payment-proofs', name: makePath(8), created_at: '2026-11-10T00:00:00.000Z' }, // valid orphan 4
    { bucket_id: 'payment-proofs', name: makePath(9), created_at: '2026-11-10T00:00:00.000Z' }, // valid orphan 5
  ];

  const sim = createStatefulSimulator([], objects);
  let removeCalled = false;
  sim.gateway.removeStorageObject = async () => {
    removeCalled = true;
    return { kind: 'deleted' };
  };

  const configPaged = {
    ...DEFAULT_WORKER_CONFIG,
    orphanListPageSize: 2,
    maxOrphanScansPerInvocation: 3,
  };

  let cursor = null;
  let totalEnqueued = 0;
  let totalQuarantined = 0;
  let totalTooYoung = 0;
  let totalReferenced = 0;
  let invocations = 0;

  while (invocations < 10) {
    invocations += 1;
    const summary = await runWorkerInvocation(sim.gateway, configPaged, {
      mode: 'orphan_scan',
      buckets: ['resident-documents', 'payment-proofs'],
      orphanCursor: cursor,
      wallClockMs: () => Date.parse('2026-11-14T01:00:00.000Z'),
      logger: () => {},
    });

    assert(summary.orphanScan.objectsInspected <= 3, 'strictly obeys maxOrphanScansPerInvocation=3 cap');
    totalEnqueued += summary.orphanScan.enqueued;
    totalQuarantined += summary.orphanScan.quarantined;
    totalTooYoung += summary.orphanScan.skippedTooYoung;
    totalReferenced += summary.orphanScan.skippedReferenced;
    cursor = summary.orphanScan.nextCursor;

    if (summary.orphanScan.cycleCompleted) {
      assertEqual(cursor, null, 'completed cycle clears nextCursor');
      break;
    }
    assert(typeof cursor === 'string' && cursor.length > 0, 'incomplete cycle returns nextCursor');
  }

  assert(invocations >= 4, 'required multiple cursor-resumed invocations due to budget=3');
  assertEqual(removeCalled, false, 'orphan_scan never calls removeStorageObject directly');
  assertEqual(totalQuarantined, 2, 'all 2 invalid objects quarantined');
  assertEqual(totalTooYoung, 2, 'all 2 too-young objects skipped cleanly without stalling');
  assertEqual(totalReferenced, 2, 'all 2 referenced objects skipped cleanly without stalling');
  assertEqual(totalEnqueued, 5, 'all 5 valid old orphans across both buckets enqueued without starvation');
  assertEqual(sim.orphanQueue.length, 5, 'exact deduplicated orphan queue length');
});

Deno.test('13. Orphan cursor handles prior deletions cleanly via keyset alignment and validates HTTP cursor input', async () => {
  const makePath = (idx) => {
    const suffix = String(idx).padStart(12, '0');
    return `${TENANT_A}/${ENTITY_A}/44444444-4444-4444-8444-${suffix}.pdf`;
  };

  const sim = createStatefulSimulator(
    [],
    [1, 2, 3, 4, 5, 6].map((i) => ({
      bucket_id: 'complaints',
      name: makePath(i),
      created_at: '2026-11-10T00:00:00.000Z',
    }))
  );

  const config = {
    ...DEFAULT_WORKER_CONFIG,
    orphanListPageSize: 2,
    maxOrphanScansPerInvocation: 3,
  };

  const s1 = await runWorkerInvocation(sim.gateway, config, {
    mode: 'orphan_scan',
    buckets: ['complaints'],
    wallClockMs: () => Date.parse('2026-11-14T01:00:00.000Z'),
    logger: () => {},
  });
  assertEqual(s1.orphanScan.enqueued, 3, 'first run enqueues 1..3');
  assert(Boolean(s1.orphanScan.nextCursor), 'returns cursor after item 3');

  // Delete items 1 and 2 before invocation 2 runs (shifts raw offsets left!)
  sim.objects.delete(`complaints/${makePath(1)}`);
  sim.objects.delete(`complaints/${makePath(2)}`);

  const s2 = await runWorkerInvocation(
    sim.gateway,
    { ...config, maxOrphanScansPerInvocation: 4 },
    {
      mode: 'orphan_scan',
      buckets: ['complaints'],
      orphanCursor: s1.orphanScan.nextCursor,
      wallClockMs: () => Date.parse('2026-11-14T01:00:00.000Z'),
      logger: () => {},
    }
  );
  assertEqual(s2.orphanScan.enqueued, 3, 'keyset realignment avoids skipping item 4 and enqueues 4..6');
  assertEqual(s2.orphanScan.cycleCompleted, true, 'finishes scan cleanly');
  assertEqual(sim.orphanQueue.length, 6, 'all 6 distinct items covered once');

  // HTTP POST rejects malformed orphanCursor with 400 and propagates valid cursor cleanly
  const env = {
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key-placeholder-for-unit-test',
    STORAGE_DELETION_WORKER_SECRET: '0123456789abcdef0123456789abcdef-strong-32b',
  };
  const badCursorRes = await handleWorkerRequest(
    new Request('http://local/worker', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.STORAGE_DELETION_WORKER_SECRET}` },
      body: JSON.stringify({ mode: 'orphan_scan', orphanCursor: 'not-valid-cursor' }),
    }),
    { envGet: (k) => env[k], gatewayFactory: () => sim.gateway }
  );
  assertEqual(badCursorRes.status, 400, 'invalid orphanCursor returns 400');

  const okCursorRes = await handleWorkerRequest(
    new Request('http://local/worker', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.STORAGE_DELETION_WORKER_SECRET}` },
      body: JSON.stringify({
        mode: 'orphan_scan',
        buckets: ['complaints'],
        orphanCursor: s1.orphanScan.nextCursor,
        maxOrphanScansPerInvocation: 10,
      }),
    }),
    { envGet: (k) => env[k], gatewayFactory: () => sim.gateway, runOptions: { logger: () => {} } }
  );
  assertEqual(okCursorRes.status, 200, 'valid HTTP orphanCursor returns 200');
  const body = await okCursorRes.json();
  assertEqual(body.summary.orphanScan.cycleCompleted, true, 'HTTP response includes cycleCompleted');
});
