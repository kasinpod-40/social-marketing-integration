import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudflareReliabilityRuntime } from '../../packages/reliability/src/runtime-factory.js';

test('Cloudflare reliability runtime requires the MKT_STATE_DB binding', () => {
  assert.throws(
    () => createCloudflareReliabilityRuntime({ env: {} }),
    (error) => error.code === 'MKT_STATE_DB_REQUIRED' && error.retryable === false,
  );
});

test('Cloudflare reliability runtime composes D1 lock/store with the Lark mirror', () => {
  const db = { prepare() { throw new Error('not executed during construction'); } };
  const runtime = createCloudflareReliabilityRuntime({
    env: { MKT_STATE_DB: db },
    repository: {},
    syncEngine: { async syncByKey() { return {}; } },
    tables: { mktSyncLog: 'tbl-sync', mktSystemAlerts: 'tbl-alert' },
  });

  assert.equal(runtime.lockManager, runtime.d1Store);
  assert.equal(runtime.d1Store.db, db);
  assert.equal(runtime.larkStore.tables.syncLog, 'tbl-sync');
  assert.equal(typeof runtime.store.saveSyncRun, 'function');
});
