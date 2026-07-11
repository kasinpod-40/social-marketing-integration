import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCpa, calculateRate, calculateRoas, nullableNumber } from '../../packages/domain/src/value-objects/metric-value.js';
import { createContentKey, createDailySnapshotKey } from '../../packages/application/src/use-cases/create-daily-snapshot.js';
import { createSyncLogEntry } from '../../packages/domain/src/entities/sync-log.js';

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
    'tiktok:acc_1:video_1:2026-07-05',
  );

  assert.throws(() => createDailySnapshotKey({ platform: 'tiktok', accountId: '', entityId: 'x', metricDate: '2026-07-05' }));
});

test('content and daily keys use the canonical single-colon format and trim identity parts', () => {
  assert.equal(
    createContentKey({ platform: ' tiktok ', accountId: ' chemistry_k ', externalContentId: ' video_1 ' }),
    'tiktok:chemistry_k:video_1',
  );
  assert.equal(
    createDailySnapshotKey({
      platform: ' tiktok ',
      accountId: ' chemistry_k ',
      entityId: ' video_1 ',
      metricDate: ' 2026-07-10 ',
    }),
    'tiktok:chemistry_k:video_1:2026-07-10',
  );
});


test('canonical keys reject delimiter injection and impossible metric dates', () => {
  assert.throws(
    () => createContentKey({ platform: 'tiktok', accountId: 'bad:key', externalContentId: 'v1' }),
    /must not contain/,
  );
  assert.throws(
    () => createDailySnapshotKey({ platform: 'tiktok', accountId: 'acc', entityId: 'v1', metricDate: '2026-02-30' }),
    /not a valid calendar date/,
  );
});

test('sync log validates identity, counters, and timestamp ordering', () => {
  const entry = createSyncLogEntry({
    syncId: 'sync-1',
    platform: ' TikTok ',
    syncType: 'creator_daily',
    status: 'success',
    startedAt: '2026-07-11T00:00:00Z',
    finishedAt: '2026-07-11T00:01:00Z',
    recordsPulled: 20,
    recordsWritten: 20,
  });

  assert.equal(entry.platform, 'tiktok');
  assert.equal(entry.startedAt, Date.parse('2026-07-11T00:00:00Z'));
  assert.throws(
    () => createSyncLogEntry({ platform: 'tiktok', syncType: 'x', recordsPulled: -1 }),
    /recordsPulled must be a non-negative integer/,
  );
  assert.throws(
    () => createSyncLogEntry({
      platform: 'tiktok', syncType: 'x',
      startedAt: '2026-07-11T01:00:00Z', finishedAt: '2026-07-11T00:00:00Z',
    }),
    /finishedAt must not be before startedAt/,
  );
});
