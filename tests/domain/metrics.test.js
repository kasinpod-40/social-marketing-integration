import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCpa, calculateRate, calculateRoas, nullableNumber } from '../../packages/domain/src/value-objects/metric-value.js';
import { createDailySnapshotKey } from '../../packages/application/src/use-cases/create-daily-snapshot.js';

test('nullableNumber keeps 0 as a valid metric value', () => {
  assert.equal(nullableNumber(0), 0);
  assert.equal(nullableNumber('0'), 0);
  assert.equal(nullableNumber(null), null);
});

test('calculateRoas returns null when spend is missing or zero', () => {
  assert.equal(calculateRoas({ spend: null, conversionValue: 100 }), null);
  assert.equal(calculateRoas({ spend: 0, conversionValue: 100 }), null);
});

test('calculateRoas uses actual conversion value divided by spend', () => {
  assert.equal(calculateRoas({ spend: 250, conversionValue: 1000 }), 4);
});

test('calculateRate and CPA return null for invalid denominators', () => {
  assert.equal(calculateRate(10, 0), null);
  assert.equal(calculateCpa({ spend: 100, conversions: 0 }), null);
});

test('daily snapshot key requires all identity fields', () => {
  assert.equal(
    createDailySnapshotKey({
      platform: 'tiktok',
      accountId: 'acc_1',
      entityId: 'video_1',
      metricDate: '2026-07-05',
    }),
    'tiktok::acc_1::video_1::2026-07-05',
  );

  assert.throws(() => createDailySnapshotKey({ platform: 'tiktok', accountId: '', entityId: 'x', metricDate: '2026-07-05' }));
});
