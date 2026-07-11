import test from 'node:test';
import assert from 'node:assert/strict';
import { runReliableSync } from '../../packages/reliability/src/reliable-sync-runner.js';
import { InMemoryLeaseLockManager } from '../../packages/reliability/src/in-memory-lease-lock-manager.js';
import { partialSyncError, transientError } from '../../packages/shared/src/errors/runtime-error.js';

test('reliable runner writes running and success logs, returns syncRunId, and releases the lock', async () => {
  const store = createStore();
  const lockManager = new InMemoryLeaseLockManager({ now: sequenceNow([1000, 1000, 2000]) });

  const result = await runReliableSync({
    store,
    lockManager,
    syncRunId: 'run-1',
    customerProfile: 'dev_ft_pumkin',
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
    }),
  });

  assert.equal(result.syncRunId, 'run-1');
  assert.deepEqual(store.syncRuns.map((entry) => entry.status), ['running', 'success']);
  assert.equal(store.syncRuns[1].recordsPulled, 20);
  assert.equal(store.syncRuns[1].recordsWritten, 10);
  assert.equal(store.alerts.length, 0);

  const reacquired = await lockManager.acquire({
    lockKey: 'dev_ft_pumkin:tiktok:ft_pumkin:native_import',
    ownerId: 'run-2',
    leaseMs: 1_000,
  });
  assert.equal(reacquired.acquired, true);
});

test('reliable runner skips execution when the lease lock is busy', async () => {
  const store = createStore();
  const lockManager = new InMemoryLeaseLockManager({ now: () => 1000 });
  await lockManager.acquire({
    lockKey: 'dev_ft_pumkin:tiktok:ft_pumkin:native_import',
    ownerId: 'other-run',
    leaseMs: 60_000,
  });
  let executed = false;

  await assert.rejects(
    () => runReliableSync({
      store,
      lockManager,
      syncRunId: 'run-busy',
      customerProfile: 'dev_ft_pumkin',
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
  const lockManager = new InMemoryLeaseLockManager({ now: sequenceNow([1000, 1000, 2000]) });

  await assert.rejects(
    () => runReliableSync({
      store,
      lockManager,
      syncRunId: 'run-partial',
      customerProfile: 'dev_ft_pumkin',
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
  const lockManager = new InMemoryLeaseLockManager({ now: sequenceNow([1000, 1000, 2000]) });

  await assert.rejects(
    () => runReliableSync({
      store,
      lockManager,
      syncRunId: 'run-transient',
      customerProfile: 'dev_ft_pumkin',
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
