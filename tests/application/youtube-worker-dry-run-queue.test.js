import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncWorker } from '../../apps/sync-worker/src/sync-worker.js';
import { processYouTubeOrganicEndToEndJob } from '../../apps/sync-worker/src/youtube-organic-job-router.js';
import { buildYouTubeDryRunJob } from '../../scripts/lib/youtube-dry-run-rollout-operator.js';
import { transientError } from '../../packages/shared/src/errors/runtime-error.js';

const REQUESTED_AT = Date.parse('2026-07-27T04:00:00.000Z');

test('Queue routing unit keeps stable YouTube identity and zero-write boundaries', async () => {
  const harness = createHarness();
  const worker = createOperatorWorker(harness);
  const first = message('delivery-a', job('youtube-operation-a'));
  const next = message('delivery-b', job('youtube-operation-b'));

  await worker.queue(batch(first), harness.env);
  await worker.queue(batch(next), harness.env);

  assert.equal(first.acked, true);
  assert.equal(next.acked, true);
  assert.equal(first.retried || next.retried, false);
  assert.equal(harness.providerGets, 2);
  assert.equal(harness.larkPlanningGets, 2);
  assert.deepEqual(harness.syncRunIds, [
    'youtube-dry-run:youtube-operation-a',
    'youtube-dry-run:youtube-operation-b',
  ]);
  assert.deepEqual(harness.workKeys, [
    'youtube:youtube-operation-a',
    'youtube:youtube-operation-b',
  ]);
  assert.equal(harness.oauthRefreshes, 0);
  assert.equal(harness.analyticsRequests, 0);
  assert.equal(harness.larkWrites, 0);
  assert.equal(harness.businessD1Writes, 0);
  assert.equal(harness.coverageWrites, 0);
  assert.equal(harness.checkpointWrites, 0);
  assert.equal(harness.warningDrains, 0);
  assert.equal(harness.expiredWorkCleanups, 0);
  assert.equal(harness.deadLetters, 0);
  assert.deepEqual(harness.queueAttempts.get('youtube-operation-a'), {
    count: 1,
    workKey: 'youtube:youtube-operation-a',
  });
});

test('operator generation or workKey drift is permanent before Provider access', async () => {
  for (const mutation of [
    (body) => ({ ...body, generation: body.generation + 1 }),
    (body) => ({ ...body, workKey: 'youtube:wrong' }),
  ]) {
    const harness = createHarness({ trackQueueAttempts: false });
    const worker = createOperatorWorker(harness);
    const invalid = message('invalid-delivery', mutation(job('invalid-operation')));
    await worker.queue(batch(invalid), harness.env);
    assert.equal(invalid.acked, true);
    assert.equal(invalid.retried, false);
    assert.equal(harness.providerGets, 0);
    assert.equal(harness.deadLetters, 1);
  }
});

test('operator runtime rejects Analytics, Business write, Lark write and Schedule gates before Provider', async () => {
  for (const unsafe of [
    { MKT_YOUTUBE_ANALYTICS_ENABLED: 'true' },
    { MKT_TIME_SERIES_D1_WRITE_ENABLED: 'true' },
    { MKT_YOUTUBE_LARK_WRITE_ENABLED: 'true' },
    { MKT_SCHEDULE_YOUTUBE_ENABLED: 'true' },
    { MKT_ENV: 'production', MKT_CUSTOMER_PROFILE: 'chemistry_k' },
  ]) {
    const harness = createHarness({ trackQueueAttempts: false });
    const worker = createOperatorWorker(harness);
    const queued = message('unsafe-delivery', job(`unsafe-${Object.keys(unsafe)[0].toLowerCase()}`));
    await worker.queue(batch(queued), { ...harness.env, ...unsafe });
    assert.equal(queued.acked, true);
    assert.equal(queued.retried, false);
    assert.equal(harness.providerGets, 0);
  }
});

test('operator payload requesting Analytics fails before Provider access', async () => {
  const harness = createHarness({ trackQueueAttempts: false });
  const worker = createOperatorWorker(harness);
  const queued = message('analytics-delivery', {
    ...job('analytics-operation'),
    analyticsEnabled: true,
  });
  await worker.queue(batch(queued), harness.env);
  assert.equal(queued.acked, true);
  assert.equal(queued.retried, false);
  assert.equal(harness.providerGets, 0);
});

test('retryable Queue failure retries main message without DLQ or automatic resend', async () => {
  const harness = createHarness();
  const worker = createSyncWorker({
    async processJob() {
      throw transientError('synthetic Provider timeout', { code: 'YOUTUBE_API_TIMEOUT' });
    },
    createInfrastructure: () => harness.infrastructure,
    createOperationalStore: () => ({
      async saveDeadLetter() { harness.deadLetters += 1; },
      async saveSystemAlert() {},
    }),
  });
  const queued = message('retry-delivery', job('retry-operation'));
  await worker.queue(batch(queued), harness.env);
  assert.equal(queued.acked, false);
  assert.equal(queued.retried, true);
  assert.deepEqual(queued.retryOptions, { delaySeconds: 30 });
  assert.equal(harness.deadLetters, 0);
});

function createOperatorWorker(harness) {
  return createSyncWorker({
    processJob: (input) => processYouTubeOrganicEndToEndJob({
      ...input,
      dependencies: {
        createYouTubeRuntimeClients(env, options) {
          assert.equal(options.publicApiKeyOnly, true);
          assert.equal(options.analyticsEnabled, false);
          assert.equal(env.YOUTUBE_API_KEY, 'test-public-api-key');
          return {
            publicClient: { mode: 'public_get_only' },
            ownerClient: null,
            oauthConfigured: false,
          };
        },
        async runReliableSync(input) {
          harness.syncRunIds.push(input.syncRunId);
          return input.execute({
            syncRunId: input.syncRunId,
            lockKey: 'youtube:dev_ft_pumkin:organic_end_to_end',
            assertLockActive() {},
          });
        },
        async syncYouTubeOrganicEndToEnd(input) {
          harness.workKeys.push(input.workKey);
          assert.equal(input.dryRun, true);
          assert.equal(input.d1WriteEnabled, false);
          assert.equal(input.larkWriteEnabled, false);
          assert.equal(input.analyticsEnabled, false);
          assert.equal(input.ownerClient, null);
          harness.providerGets += 1;
          await input.repository.listRecords();
          return { status: 'completed', recordsPulled: 1, workKey: input.workKey };
        },
      },
    }),
    createInfrastructure: () => harness.infrastructure,
    createOperationalStore: () => ({
      async saveDeadLetter() { harness.deadLetters += 1; },
      async saveSystemAlert() {},
    }),
  });
}

function createHarness(options = {}) {
  const harness = {
    providerGets: 0,
    larkPlanningGets: 0,
    larkWrites: 0,
    businessD1Writes: 0,
    coverageWrites: 0,
    checkpointWrites: 0,
    analyticsRequests: 0,
    oauthRefreshes: 0,
    warningDrains: 0,
    expiredWorkCleanups: 0,
    deadLetters: 0,
    syncRunIds: [],
    workKeys: [],
    queueAttempts: new Map(),
  };
  const resumableWorkStore = {
    async cleanupExpiredWork() { harness.expiredWorkCleanups += 1; },
  };
  harness.infrastructure = {
    repository: {
      async listRecords() {
        harness.larkPlanningGets += 1;
        return { items: [], hasMore: false, pageToken: null };
      },
      async createRecords() { harness.larkWrites += 1; },
      async updateRecords() { harness.larkWrites += 1; },
    },
    syncEngine: {},
    getReliability() { return { store: {}, lockManager: {} }; },
    getResumableWorkStore() { return resumableWorkStore; },
    getOrganicHistoryGateway() {
      return {
        store: {},
        async assertSchemaReady() { return { ready: true }; },
      };
    },
    getIncrementalStateStore() {
      return {
        async saveCheckpoint() { harness.checkpointWrites += 1; },
      };
    },
  };
  harness.env = {
    MKT_MAIN_QUEUE_NAME: 'sync-main',
    MKT_DLQ_QUEUE_NAME: 'sync-dlq',
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTOR_YOUTUBE_ENABLED: 'true',
    MKT_YOUTUBE_END_TO_END_ENABLED: 'true',
    MKT_TIME_SERIES_D1_WRITE_ENABLED: 'false',
    MKT_YOUTUBE_LARK_WRITE_ENABLED: 'false',
    MKT_YOUTUBE_ANALYTICS_ENABLED: 'false',
    MKT_SCHEDULE_YOUTUBE_ENABLED: 'false',
    DEFAULT_TIMEZONE: 'Asia/Bangkok',
    YOUTUBE_CHANNEL_ID: 'UC_TEST',
    YOUTUBE_API_KEY: 'test-public-api-key',
    LARK_TABLE_MKT_ACCOUNTS: 'tbl_accounts',
    LARK_TABLE_RAW_YOUTUBE_CHANNELS: 'tbl_raw_channels',
    LARK_TABLE_RAW_YOUTUBE_VIDEOS: 'tbl_raw_videos',
    LARK_TABLE_RAW_YOUTUBE_ANALYTICS_DAILY: 'tbl_raw_analytics',
    LARK_TABLE_MKT_CONTENT: 'tbl_content',
    LARK_TABLE_MKT_CONTENT_DAILY: 'tbl_content_daily',
    LARK_TABLE_MKT_SYNC_LOG: 'tbl_sync_log',
    LARK_TABLE_MKT_SYSTEM_ALERTS: 'tbl_system_alerts',
    MKT_QUEUE_RETRY_DELAY_SECONDS: '30',
    ...(options.trackQueueAttempts === false
      ? {}
      : { MKT_STATE_DB: createQueueAttemptD1(harness.queueAttempts) }),
  };
  return harness;
}

function createQueueAttemptD1(attempts) {
  return {
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
    prepare(sql) {
      const statement = {
        sql: String(sql),
        bindings: [],
        bind(...values) { this.bindings = values; return this; },
        async run() {
          if (/INSERT INTO queue_operation_attempts/u.test(this.sql)) {
            const [operationId, workKey] = this.bindings;
            const previous = attempts.get(operationId);
            attempts.set(operationId, {
              count: (previous?.count ?? 0) + 1,
              workKey,
            });
          }
          return { meta: { changes: 1 } };
        },
        async first() {
          if (/FROM queue_operation_attempts/u.test(this.sql)) {
            const row = attempts.get(this.bindings[0]);
            return row ? { main_queue_attempts: row.count, work_key: row.workKey } : null;
          }
          return null;
        },
        async all() { return { results: [] }; },
      };
      return statement;
    },
  };
}

function job(operationId) {
  return buildYouTubeDryRunJob({
    operationId,
    originalRequestedAt: REQUESTED_AT,
  });
}

function message(id, body) {
  return {
    id,
    body,
    attempts: 1,
    acked: false,
    retried: false,
    ack() { this.acked = true; },
    retry(value) { this.retried = true; this.retryOptions = value; },
  };
}

function batch(queued) {
  return { queue: 'sync-main', messages: [queued] };
}
