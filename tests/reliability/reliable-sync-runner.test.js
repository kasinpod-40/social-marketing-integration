import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLeaseHeartbeat,
  drainPendingSyncWarnings,
  runReliableSync,
} from '../../packages/reliability/src/reliable-sync-runner.js';
import { InMemoryLeaseLockManager } from '../../packages/reliability/src/in-memory-lease-lock-manager.js';
import { partialSyncError, transientError } from '../../packages/shared/src/errors/runtime-error.js';

test('reliable runner writes running and success logs, returns syncRunId, and releases the lock', async () => {
  const store = createStore();
  const lockManager = new InMemoryLeaseLockManager();

  const result = await runReliableSync({
    store,
    lockManager,
    syncRunId: 'run-1',
    customerProfile: 'integration_workspace',
    accountKey: 'ft_pumkin',
    platform: 'tiktok',
    source: 'lark_native_tiktok_for_creator',
    syncType: 'native_import',
    leaseMs: 60_000,
    execute: async ({ syncRunId }) => ({
      syncRunId,
      rawRecords: 20,
      content: { created: 1, updated: 2, skipped: 17 },
      dailySnapshots: { created: 3, updated: 4, skipped: 13 },
      reconciliation: { required: false },
      sourceSummary: {
        analyticsTrackedVideoIds: 837,
        analyticsSelectedVideos: 837,
        analyticsSuccessfullyQueriedVideos: 837,
        analyticsFailedVideos: 0,
        analyticsChunksProcessed: 17,
        analyticsCompletenessStatus: 'complete',
      },
    }),
  });

  assert.equal(result.syncRunId, 'run-1');
  assert.deepEqual(store.syncRuns.map((entry) => entry.status), ['running', 'success']);
  assert.equal(store.syncRuns[1].recordsPulled, 20);
  assert.equal(store.syncRuns[1].recordsWritten, 10);
  assert.equal(store.syncRuns[1].details.sourceSummary.analyticsTrackedVideoIds, 837);
  assert.equal(store.syncRuns[1].details.sourceSummary.analyticsSuccessfullyQueriedVideos, 837);
  assert.equal(store.syncRuns[1].details.sourceSummary.analyticsCompletenessStatus, 'complete');
  assert.equal(store.alerts.length, 0);

  const reacquired = await lockManager.acquire({
    lockKey: 'integration_workspace:tiktok:ft_pumkin:native_import',
    ownerId: 'run-2',
    leaseMs: 1_000,
  });
  assert.equal(reacquired.acquired, true);
});

test('reliable runner skips execution when the lease lock is busy', async () => {
  const store = createStore();
  const lockManager = new InMemoryLeaseLockManager({ now: () => 1000 });
  await lockManager.acquire({
    lockKey: 'integration_workspace:tiktok:ft_pumkin:native_import',
    ownerId: 'other-run',
    leaseMs: 60_000,
  });
  let executed = false;

  await assert.rejects(
    () => runReliableSync({
      store,
      lockManager,
      syncRunId: 'run-busy',
      customerProfile: 'integration_workspace',
      accountKey: 'ft_pumkin',
      platform: 'tiktok',
      source: 'source',
      syncType: 'native_import',
      leaseMs: 60_000,
      execute: async () => { executed = true; },
    }),
    (error) => error.code === 'SYNC_LOCK_BUSY' && error.retryable === true,
  );

  assert.equal(executed, false);
  assert.equal(store.syncRuns.at(-1).status, 'skipped');
  assert.equal(store.syncRuns.at(-1).errorCode, 'SYNC_LOCK_BUSY');
});

test('partial write is persisted as partial_success and creates a critical alert', async () => {
  const store = createStore();
  const lockManager = new InMemoryLeaseLockManager();

  await assert.rejects(
    () => runReliableSync({
      store,
      lockManager,
      syncRunId: 'run-partial',
      customerProfile: 'integration_workspace',
      accountKey: 'ft_pumkin',
      platform: 'tiktok',
      source: 'source',
      syncType: 'native_import',
      leaseMs: 60_000,
      execute: async () => {
        throw partialSyncError('daily failed', {
          partialResult: {
            rawRecords: 20,
            content: { created: 20, updated: 0, skipped: 0 },
            dailySnapshots: { created: 0, updated: 0, skipped: 0 },
            reconciliation: { status: 'partial_write_detected' },
          },
        });
      },
    }),
    (error) => error.code === 'SYNC_PARTIAL_WRITE' && error.reliabilityHandled === true,
  );

  assert.equal(store.syncRuns.at(-1).status, 'partial_success');
  assert.equal(store.syncRuns.at(-1).recordsWritten, 20);
  assert.equal(store.alerts.length, 1);
  assert.equal(store.alerts[0].severity, 'critical');
  assert.equal(store.alerts[0].alertType, 'sync_partial_write');
});

test('retryable failure can be logged without creating noisy alerts before retry exhaustion', async () => {
  const store = createStore();
  const lockManager = new InMemoryLeaseLockManager();

  await assert.rejects(
    () => runReliableSync({
      store,
      lockManager,
      syncRunId: 'run-transient',
      customerProfile: 'integration_workspace',
      accountKey: 'ft_pumkin',
      platform: 'tiktok',
      source: 'source',
      syncType: 'native_import',
      leaseMs: 60_000,
      alertOnRetryableFailure: false,
      execute: async () => {
        throw transientError('temporary network failure', { code: 'TEMPORARY_NETWORK' });
      },
    }),
    /temporary network failure/,
  );

  assert.equal(store.syncRuns.at(-1).status, 'failed');
  assert.equal(store.alerts.length, 0);
});

function createStore() {
  return {
    syncRuns: [],
    alerts: [],
    async saveSyncRun(entry) { this.syncRuns.push(entry); },
    async saveSystemAlert(alert) { this.alerts.push(alert); },
  };
}

function sequenceNow(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

test('reliable runner exposes lease renewal and completes while ownership remains valid', async () => {
  const store = createStore();
  let renewCalls = 0;
  const lockManager = {
    async acquire({ lockKey, ownerId, leaseMs }) {
      return { acquired: true, lockKey, ownerId, expiresAt: Date.now() + leaseMs };
    },
    async renew({ lockKey, ownerId, leaseMs }) {
      renewCalls += 1;
      return { renewed: true, lockKey, ownerId, expiresAt: Date.now() + leaseMs };
    },
    async release() { return true; },
  };

  const result = await runReliableSync({
    store,
    lockManager,
    syncRunId: 'run-renew',
    customerProfile: 'integration_workspace',
    accountKey: 'ft_pumkin',
    platform: 'tiktok',
    source: 'source',
    syncType: 'native_import',
    leaseMs: 60_000,
    renewIntervalMs: 10_000,
    execute: async ({ renewLease, assertLockActive }) => {
      await renewLease();
      await assertLockActive();
      return {
        rawRecords: 0,
        content: { created: 0, updated: 0, skipped: 0 },
        dailySnapshots: { created: 0, updated: 0, skipped: 0 },
      };
    },
  });

  assert.equal(result.syncRunId, 'run-renew');
  assert.equal(renewCalls, 1);
  assert.equal(store.syncRuns.at(-1).status, 'success');
});

test('lost lease ownership fails the sync and creates an alert', async () => {
  const store = createStore();
  const lockManager = {
    async acquire({ lockKey, ownerId, leaseMs }) {
      return { acquired: true, lockKey, ownerId, expiresAt: Date.now() + leaseMs };
    },
    async renew() { return { renewed: false, expiresAt: null }; },
    async release() { return true; },
  };

  await assert.rejects(
    () => runReliableSync({
      store,
      lockManager,
      syncRunId: 'run-lost-lock',
      customerProfile: 'integration_workspace',
      accountKey: 'ft_pumkin',
      platform: 'tiktok',
      source: 'source',
      syncType: 'native_import',
      leaseMs: 60_000,
      renewIntervalMs: 10_000,
      alertOnRetryableFailure: true,
      execute: async ({ renewLease }) => {
        await renewLease();
      },
    }),
    (error) => error.code === 'SYNC_LOCK_LOST' && error.reliabilityHandled === true,
  );

  assert.equal(store.syncRuns.at(-1).status, 'failed');
  assert.equal(store.syncRuns.at(-1).errorCode, 'SYNC_LOCK_LOST');
  assert.equal(store.alerts.at(-1).alertType, 'sync_failed');
});


test('reliable runner summarizes report output rows without relying on content sync fields', async () => {
  const store = createStore();
  const lockManager = new InMemoryLeaseLockManager();

  await runReliableSync({
    store,
    lockManager,
    syncRunId: 'run-report',
    customerProfile: 'integration_workspace',
    accountKey: 'ft_pumkin',
    platform: 'tiktok',
    source: 'mkt_content_daily',
    syncType: 'daily_organic_report',
    leaseMs: 60_000,
    execute: async () => ({
      rawRecords: 60,
      reportSnapshot: { created: 1, updated: 0, skipped: 0, writeOutcome: 'confirmed' },
      reportMetricValues: { created: 13, updated: 0, skipped: 0, writeOutcome: 'confirmed' },
      reportTopContent: { created: 5, updated: 0, skipped: 0, writeOutcome: 'confirmed' },
    }),
  });

  const completed = store.syncRuns.at(-1);
  assert.equal(completed.recordsPulled, 60);
  assert.equal(completed.recordsCreated, 19);
  assert.equal(completed.recordsWritten, 19);
  assert.equal(completed.details.writeOutcomes.reportMetricValues, 'confirmed');
});


test('lease heartbeat assertActive fails closed after the local lease expiry', async () => {
  let now = 1_000;
  const heartbeat = createLeaseHeartbeat({
    lockManager: {
      async acquire() { return { acquired: true }; },
      async renew() { return { renewed: true, expiresAt: 4_000 }; },
      async release() { return true; },
    },
    lockKey: 'dev:tiktok:ft:native',
    ownerId: 'run-expired',
    leaseMs: 3_000,
    renewIntervalMs: 1_000,
    initialExpiresAt: 1_500,
    now: () => now,
  });

  try {
    assert.equal(await heartbeat.assertActive(), true);
    now = 1_500;
    await assert.rejects(
      () => heartbeat.assertActive(),
      (error) => error.code === 'SYNC_LOCK_LEASE_EXPIRED'
        && error.details.expiresAt === 1_500
        && error.details.checkedAt === 1_500,
    );
    await assert.rejects(
      () => heartbeat.assertActive(),
      (error) => error.code === 'SYNC_LOCK_LEASE_EXPIRED',
    );
  } finally {
    await heartbeat.stop();
  }
});

test('successful sync can persist one warning alert for reconciliation without failing the run', async () => {
  const store = createStore();
  const lockManager = new InMemoryLeaseLockManager();

  await runReliableSync({
    store,
    lockManager,
    syncRunId: 'run-warning',
    customerProfile: 'integration_workspace',
    accountKey: 'youtube_dev',
    platform: 'youtube',
    source: 'youtube_data_api',
    syncType: 'organic_manual_uat',
    leaseMs: 60_000,
    alertOnResultWarnings: true,
    execute: async () => ({
      rawRecords: 1,
      rawVideos: { created: 0, updated: 1, skipped: 0 },
      warnings: [{ code: 'YOUTUBE_VIDEO_RECONCILIATION_REQUIRED', videoId: 'video_gone' }],
      reconciliation: { required: true, missingVideoIds: ['video_gone'] },
    }),
  });

  assert.equal(store.syncRuns.at(-1).status, 'success');
  assert.equal(store.syncRuns.at(-1).details.warningCount, 1);
  assert.equal(store.alerts.length, 1);
  assert.equal(store.alerts[0].alertType, 'sync_completed_with_warnings');
  assert.equal(store.alerts[0].severity, 'warning');
});

test('warning alert primary persistence failure is retryable and prevents a successful acknowledgement', async () => {
  const syncRuns = [];
  const reliabilityEvents = [];
  const store = {
    async saveSyncRun(entry) { syncRuns.push(entry); },
    async saveSystemAlert() {
      throw transientError('D1 unavailable', { code: 'D1_SYSTEM_ALERT_WRITE_FAILED' });
    },
  };

  await assert.rejects(
    () => runReliableSync({
      store,
      lockManager: new InMemoryLeaseLockManager(),
      syncRunId: 'run-warning-alert-failed',
      customerProfile: 'integration_workspace',
      accountKey: 'youtube_dev',
      platform: 'youtube',
      source: 'youtube_data_api',
      syncType: 'organic_manual_uat',
      leaseMs: 60_000,
      alertOnResultWarnings: true,
      onReliabilityError: (event) => reliabilityEvents.push(event),
      execute: async () => ({
        rawRecords: 1,
        rawAnalytics: { created: 0, updated: 0, skipped: 1 },
        warnings: [{
          code: 'YOUTUBE_ANALYTICS_RECONCILIATION_REQUIRED',
          missingStableKeys: ['youtube:channel_A:video_A:2026-07-14'],
        }],
        reconciliation: {
          required: true,
          missingAnalyticsStableKeys: ['youtube:channel_A:video_A:2026-07-14'],
        },
      }),
    }),
    (error) => error.code === 'D1_SYSTEM_ALERT_WRITE_FAILED'
      && error.retryable === true
      && error.reliabilityHandled === true,
  );

  assert.deepEqual(syncRuns.map((entry) => entry.status), ['running', 'success', 'failed']);
  assert.equal(syncRuns.at(-1).errorCode, 'D1_SYSTEM_ALERT_WRITE_FAILED');
  assert.equal(reliabilityEvents[0].stage, 'result_warning_alert_failed');
});


test('superseded generation is logged as skipped instead of success', async () => {
  const store = createStore();
  await runReliableSync({
    store,
    lockManager: new InMemoryLeaseLockManager(),
    syncRunId: 'run-superseded',
    customerProfile: 'integration_workspace',
    accountKey: 'youtube_dev',
    platform: 'youtube',
    source: 'youtube_data_api',
    syncType: 'organic_sync',
    leaseMs: 60_000,
    execute: async () => ({
      mode: 'superseded',
      rawRecords: 0,
      warnings: [],
    }),
  });

  const final = store.syncRuns.at(-1);
  assert.equal(final.status, 'skipped');
  assert.equal(final.errorCode, 'SYNC_WORK_SUPERSEDED');
  assert.equal(final.details.completionMode, 'superseded');
});

test('dry-run reconciliation warnings are returned without creating business alerts', async () => {
  const store = createStore();
  const result = await runReliableSync({
    store,
    lockManager: new InMemoryLeaseLockManager(),
    syncRunId: 'run-dry-warning',
    customerProfile: 'integration_workspace',
    accountKey: 'youtube_dev',
    platform: 'youtube',
    source: 'youtube_data_api',
    syncType: 'organic_sync',
    leaseMs: 60_000,
    alertOnResultWarnings: true,
    execute: async () => ({
      dryRun: true,
      mode: 'dry_run',
      rawRecords: 1,
      warnings: [{ code: 'YOUTUBE_VIDEO_RECONCILIATION_REQUIRED' }],
    }),
  });

  assert.equal(result.warnings.length, 1);
  assert.equal(store.syncRuns.at(-1).status, 'success');
  assert.equal(store.alerts.length, 0);
});

test('pending warning drain delivers old completed warnings independently of the current generation', async () => {
  const store = createStore();
  const events = [{
    outboxId: 'sync-warning:old',
    workKey: 'youtube:old-message',
    syncRunId: 'run-old',
    warningType: 'sync_completed_with_warnings',
    sourceKey: 'cursor-youtube',
    payload: {
      context: {
        customerProfile: 'integration_workspace',
        accountKey: 'youtube_dev',
        platform: 'youtube',
      },
      warnings: [{ code: 'YOUTUBE_VIDEO_RECONCILIATION_REQUIRED' }],
      reconciliation: { required: true },
    },
  }];
  const delivered = [];
  const failed = [];
  const outbox = {
    async listPendingWarnings({ limit }) {
      assert.equal(limit, 25);
      return events;
    },
    async markWarningDelivered(value) { delivered.push(value); },
    async markWarningDeliveryFailed(value) { failed.push(value); },
  };

  const result = await drainPendingSyncWarnings({
    store,
    warningOutboxStore: outbox,
    limit: 25,
    now: () => Date.parse('2026-07-19T00:00:00.000Z'),
  });

  assert.deepEqual(result, { scanned: 1, delivered: 1 });
  assert.equal(store.alerts.length, 1);
  assert.equal(store.alerts[0].alertId, 'sync-warning:old');
  assert.equal(store.alerts[0].syncRunId, 'run-old');
  assert.equal(delivered.length, 1);
  assert.equal(failed.length, 0);
});

test('pending warning drain records delivery failure and remains retryable', async () => {
  const failures = [];
  const outbox = {
    async listPendingWarnings() {
      return [{
        outboxId: 'sync-warning:failed',
        workKey: 'youtube:old-message',
        syncRunId: 'run-old',
        warningType: 'sync_completed_with_warnings',
        sourceKey: 'cursor-youtube',
        payload: { context: { platform: 'youtube' }, warnings: [] },
      }];
    },
    async markWarningDelivered() { throw new Error('should not deliver'); },
    async markWarningDeliveryFailed(value) { failures.push(value); },
  };
  const store = {
    async saveSystemAlert() {
      throw transientError('D1 unavailable', { code: 'D1_SYSTEM_ALERT_WRITE_FAILED' });
    },
    async saveSyncRun() {},
  };

  await assert.rejects(
    drainPendingSyncWarnings({ store, warningOutboxStore: outbox, now: () => Date.parse('2026-07-19T01:00:00.000Z') }),
    (error) => error?.code === 'D1_SYSTEM_ALERT_WRITE_FAILED' && error.retryable === true,
  );
  assert.deepEqual(failures, [{
    outboxId: 'sync-warning:failed',
    errorCode: 'D1_SYSTEM_ALERT_WRITE_FAILED',
    updatedAt: Date.parse('2026-07-19T01:00:00.000Z'),
  }]);
});
