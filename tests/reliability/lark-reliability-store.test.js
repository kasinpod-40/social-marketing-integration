import test from 'node:test';
import assert from 'node:assert/strict';
import { LarkReliabilityStore } from '../../packages/reliability/src/lark-reliability-store.js';
import { createSyncLogEntry } from '../../packages/domain/src/entities/sync-log.js';
import { createSystemAlert } from '../../packages/domain/src/entities/system-alert.js';

test('Lark reliability store maps sync run to the current MKT_Sync_Log schema', async () => {
  const calls = [];
  const store = new LarkReliabilityStore({
    repository: {},
    syncEngine: { async syncByKey(input) { calls.push(input); return { created: 1 }; } },
    tables: { syncLog: 'tbl_sync', systemAlerts: 'tbl_alerts' },
  });

  await store.saveSyncRun(createSyncLogEntry({
    syncId: 'run-1',
    platform: 'tiktok',
    syncType: 'tiktok.creator.native.sync',
    status: 'failed',
    recordsPulled: 20,
    recordsCreated: 2,
    recordsUpdated: 3,
    errorCode: 'TEST_ERROR',
    errorMessage: 'boom',
  }));

  assert.equal(calls[0].tableId, 'tbl_sync');
  assert.equal(calls[0].keyField, 'sync_id');
  assert.deepEqual(calls[0].rows[0], {
    sync_id: 'run-1',
    platform: 'tiktok',
    sync_type: 'native_import',
    status: 'failed',
    records_pulled: 20,
    records_written: 5,
    error_message: '[TEST_ERROR] | boom | sync_run_id=run-1',
  });
});

test('Lark reliability store maps system alert and embeds syncRunId in the message', async () => {
  const calls = [];
  const store = new LarkReliabilityStore({
    repository: {},
    syncEngine: { async syncByKey(input) { calls.push(input); return { created: 1 }; } },
    tables: { syncLog: 'tbl_sync', systemAlerts: 'tbl_alerts' },
  });

  await store.saveSystemAlert(createSystemAlert({
    alertId: 'alert-1',
    syncRunId: 'run-1',
    alertType: 'sync_failed',
    severity: 'critical',
    platform: 'tiktok',
    status: 'open',
    errorCode: 'TEST_ERROR',
    message: 'เกิดข้อผิดพลาด',
  }));

  assert.equal(calls[0].tableId, 'tbl_alerts');
  assert.equal(calls[0].rows[0].alert_id, 'alert-1');
  assert.match(calls[0].rows[0].alert_message, /sync_run_id=run-1/);
  assert.match(calls[0].rows[0].alert_message, /เกิดข้อผิดพลาด/);
});
