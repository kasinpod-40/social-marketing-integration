import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMetricDate } from '../../packages/config/src/metric-date-config.js';

test('metric date resolver prioritizes a valid queue override over environment date', () => {
  assert.equal(resolveMetricDate({
    env: { METRIC_DATE: '2026-07-10', DEFAULT_TIMEZONE: 'Asia/Bangkok' },
    override: '2026-07-11',
  }), '2026-07-11');
});

test('invalid runtime timezone becomes a permanent config error instead of an unclassified RangeError', () => {
  assert.throws(
    () => resolveMetricDate({ env: { DEFAULT_TIMEZONE: 'Mars/Olympus' } }),
    (error) => error.code === 'MKT_RUNTIME_CONFIG_INVALID' && error.retryable === false,
  );
});

test('invalid queue metric date becomes a permanent invalid-job error', () => {
  assert.throws(
    () => resolveMetricDate({ env: { DEFAULT_TIMEZONE: 'Asia/Bangkok' }, override: '2026-02-30' }),
    (error) => error.code === 'INVALID_SYNC_JOB' && error.retryable === false,
  );
});
