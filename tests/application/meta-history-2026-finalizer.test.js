import assert from 'node:assert/strict';
import test from 'node:test';

import {
  META_HISTORY_2026_DECISION,
  createMetaHistory2026Plan,
  injectMetaHistoryConfig,
  shouldExpandMetaAdsHistory,
  validateMetaHistory2026Summary,
} from '../../scripts/lib/meta-history-2026-finalizer.js';

const HEAD = 'a'.repeat(40);

test('Meta history plan locks Instagram month and adaptive Ads windows', () => {
  const plan = createMetaHistory2026Plan(HEAD);
  assert.equal(plan.facebook.providerReplay, false);
  assert.deepEqual(plan.operations.map((item) => [item.target, item.periodStart, item.periodEnd, item.mode]), [
    ['instagram', '2026-07-01', '2026-07-31', 'required'],
    ['chemistry_k2', '2026-05-01', '2026-07-31', 'required'],
    ['chemistry_k3', '2026-05-01', '2026-07-31', 'required'],
    ['chemistry_k2', '2026-01-01', '2026-04-30', 'conditional'],
    ['chemistry_k3', '2026-01-01', '2026-04-30', 'conditional'],
  ]);
  assert.equal(new Set(plan.operations.map((item) => item.operationId)).size, 5);
});

test('Meta history config injects exact Instagram inventory bounds idempotently', () => {
  const initial = '{\n  "vars": {\n    "MKT_ENV": "development"\n  }\n}\n';
  const once = injectMetaHistoryConfig(initial);
  const twice = injectMetaHistoryConfig(once);
  assert.equal(once, twice);
  assert.match(once, /"MKT_META_INSTAGRAM_CONTENT_SINCE": "2026-07-01"/u);
  assert.match(once, /"MKT_META_INSTAGRAM_CONTENT_UNTIL": "2026-07-31"/u);
});

test('Meta Ads expands to start of year only under bounded completed volume', () => {
  const safe = [summary(4000, 1000, 6000), summary(5000, 1000, 7000)];
  assert.equal(shouldExpandMetaAdsHistory(safe).allowed, true);
  const large = [summary(9000, 3000, 12000), summary(9000, 3000, 12000)];
  assert.equal(shouldExpandMetaAdsHistory(large).allowed, false);
});

test('Meta Ads expansion rejects incomplete or invalid Coverage summaries', () => {
  const invalid = summary(0, 0, 0);
  invalid.data.snapshotAfter.invalidCoverageCount = 1;
  assert.throws(
    () => shouldExpandMetaAdsHistory([invalid, summary(0, 0, 0)]),
    (error) => error?.code === 'META_HISTORY_2026_ADS_BASELINE_INVALID',
  );
});

test('Meta history final summary requires parity idempotency and safe restore', () => {
  const value = {
    ok: true,
    decision: META_HISTORY_2026_DECISION,
    facebook: { verified: true },
    instagram: { completed: true },
    metaAds: { baselineCompleted: true },
    parityVerified: true,
    idempotentRerunsVerified: true,
    executionFlagsAllFalse: true,
    remote: { activeWork: 0, activeLocks: 0, activeQueueOperations: 0 },
    scheduleEnabled: false,
    production: false,
  };
  assert.equal(validateMetaHistory2026Summary(value), true);
  assert.throws(
    () => validateMetaHistory2026Summary({ ...value, parityVerified: false }),
    (error) => error?.code === 'META_HISTORY_2026_SUMMARY_INVALID',
  );
});

function summary(adsDaily, adsEntities, coverageEntities) {
  return {
    data: {
      snapshotAfter: {
        syncRunStatus: 'success',
        activeLockCount: 0,
        invalidCoverageCount: 0,
        coverageEntityCount: coverageEntities,
        operationCounts: { adsDaily, adsEntities },
      },
    },
  };
}
