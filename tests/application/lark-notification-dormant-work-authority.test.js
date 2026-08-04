import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertLarkNotificationDormantWorkStable,
  validateLarkNotificationDormantWorkPreflightRow,
  validateLarkNotificationDormantWorkSchemaReadbackRow,
} from '../../scripts/lib/lark-notification-dormant-work-authority.js';

function createPreflightRow(overrides = {}) {
  return {
    notification_table_count: 0,
    notification_index_count: 0,
    active_work: 2,
    active_locks: 0,
    sync_runs: 120,
    sync_jobs: 80,
    coverage_runs: 40,
    coverage_entities: 3396,
    organic_content_state: 2021,
    organic_content_observations: 2021,
    ...overrides,
  };
}

test('preflight admits retained active Work only when no active lock exists', () => {
  const row = createPreflightRow();
  assert.deepEqual(validateLarkNotificationDormantWorkPreflightRow(row), row);
  assert.throws(
    () => validateLarkNotificationDormantWorkPreflightRow({ ...row, active_locks: 1 }),
    (error) => error.code === 'LARK_NOTIFICATION_REMOTE_ROLLOUT_PREFLIGHT_FAILED'
      && error.details.invalid.includes('active_locks'),
  );
  assert.throws(
    () => validateLarkNotificationDormantWorkPreflightRow({
      ...row,
      notification_table_count: 1,
    }),
    (error) => error.code === 'LARK_NOTIFICATION_REMOTE_ROLLOUT_PREFLIGHT_FAILED'
      && error.details.invalid.includes('notification_table_count'),
  );
});

test('backup and migration gates require exact retained Work and Business fact stability', () => {
  const baseline = createPreflightRow();
  assert.deepEqual(assertLarkNotificationDormantWorkStable({ ...baseline }, baseline), baseline);
  assert.throws(
    () => assertLarkNotificationDormantWorkStable({ ...baseline, active_work: 1 }, baseline),
    (error) => error.code === 'LARK_NOTIFICATION_REMOTE_ROLLOUT_REMOTE_STATE_CHANGED'
      && error.details.invalid.includes('active_work'),
  );
  assert.throws(
    () => assertLarkNotificationDormantWorkStable({ ...baseline, sync_jobs: 81 }, baseline),
    (error) => error.code === 'LARK_NOTIFICATION_REMOTE_ROLLOUT_REMOTE_STATE_CHANGED'
      && error.details.invalid.includes('sync_jobs'),
  );
});

test('schema readback preserves retained Work count and all existing Business facts', () => {
  const baseline = createPreflightRow();
  const after = {
    ...baseline,
    notification_table_count: 1,
    notification_index_count: 3,
    notification_delivery_rows: 0,
  };
  assert.deepEqual(
    validateLarkNotificationDormantWorkSchemaReadbackRow(after, baseline, 3),
    after,
  );
  assert.throws(
    () => validateLarkNotificationDormantWorkSchemaReadbackRow({
      ...after,
      active_work: 1,
    }, baseline, 3),
    (error) => error.code === 'LARK_NOTIFICATION_REMOTE_ROLLOUT_SCHEMA_READBACK_FAILED'
      && error.details.invalid.includes('active_work'),
  );
  assert.throws(
    () => validateLarkNotificationDormantWorkSchemaReadbackRow({
      ...after,
      coverage_entities: baseline.coverage_entities + 1,
    }, baseline, 3),
    (error) => error.code === 'LARK_NOTIFICATION_REMOTE_ROLLOUT_SCHEMA_READBACK_FAILED'
      && error.details.invalid.includes('coverage_entities'),
  );
});
