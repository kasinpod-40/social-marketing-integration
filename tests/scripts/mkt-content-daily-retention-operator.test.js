import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDeferredPlatformDeleteScope,
  reconcileLatestLarkWithD1,
  summarizePlatforms,
} from '../../scripts/lib/mkt-content-daily-retention-operator.js';

const day = (value) => Date.parse(`${value}T00:00:00+07:00`);
const record = (recordId, platform, externalContentId, metricDate, views) => ({
  recordId,
  fields: {
    platform,
    account_id: 'chemistry_k',
    external_content_id: externalContentId,
    metric_date: day(metricDate),
    views,
    likes: null,
    comments: 0,
    shares: null,
    unique_viewers: null,
    avg_watch_time_seconds: null,
    total_watch_time_seconds: null,
    completion_rate: null,
  },
});

test('asserts the deferred platform is present and absent from deletes', () => {
  assert.deepEqual(assertDeferredPlatformDeleteScope({
    deferredPlatforms: ['facebook'],
    deferredPlatformPreservedCount: 2,
    deletes: [{ platform: 'tiktok' }],
  }), { platform: 'facebook', protectedRows: 2 });
  assert.throws(
    () => assertDeferredPlatformDeleteScope({
      deferredPlatforms: ['facebook'], deferredPlatformPreservedCount: 1, deletes: [{ platform: 'facebook' }],
    }),
    (error) => error?.code === 'MKT_CONTENT_DAILY_PROTECTED_DELETE_DETECTED',
  );
});

test('reconciles the latest non-deferred Lark metrics with D1', () => {
  const result = reconcileLatestLarkWithD1({
    records: [
      record('old', 'tiktok', 'one', '2026-08-14', 10),
      record('latest', 'tiktok', 'one', '2026-08-15', 12),
      record('facebook', 'facebook', 'fb', '2026-08-15', 99),
    ],
    deferredPlatforms: ['facebook'],
    d1Rows: [{
      platform: 'tiktok', account_key: 'chemistry_k', external_content_id: 'one',
      metric_date: '2026-08-15', views: 12, likes: null, comments: 0, shares: null,
      unique_viewers: null, avg_watch_time_seconds: null,
      total_watch_time_seconds: null, completion_rate: null,
    }],
  });
  assert.equal(result.larkLatestCount, 1);
  assert.equal(result.mismatchCount, 0);
});

test('uses the latest sparse D1 observation at or before the Lark metric date', () => {
  const result = reconcileLatestLarkWithD1({
    records: [record('latest', 'tiktok', 'one', '2026-08-15', 12)],
    d1Rows: [
      {
        platform: 'tiktok', account_key: 'different_mapping', external_content_id: 'one',
        metric_date: '2026-08-14', observed_at: 1, views: 12, likes: null, comments: 0,
        shares: null, unique_viewers: null, avg_watch_time_seconds: null,
        total_watch_time_seconds: null, completion_rate: null,
      },
      {
        platform: 'tiktok', account_key: 'different_mapping', external_content_id: 'one',
        metric_date: '2026-08-16', observed_at: 2, views: 99, likes: null, comments: 0,
        shares: null, unique_viewers: null, avg_watch_time_seconds: null,
        total_watch_time_seconds: null, completion_rate: null,
      },
    ],
  });
  assert.equal(result.mismatchCount, 0);
  assert.equal(result.policy, 'latest_sparse_observation_at_or_before_lark_metric_date');
});

test('fails closed on a latest metric mismatch', () => {
  assert.throws(
    () => reconcileLatestLarkWithD1({
      records: [record('latest', 'youtube', 'one', '2026-08-15', 12)],
      d1Rows: [{
        platform: 'youtube', account_key: 'chemistry_k', external_content_id: 'one',
        metric_date: '2026-08-15', views: 13, likes: null, comments: 0, shares: null,
        unique_viewers: null, avg_watch_time_seconds: null,
        total_watch_time_seconds: null, completion_rate: null,
      }],
    }),
    (error) => error?.code === 'MKT_CONTENT_DAILY_D1_LARK_PARITY_FAILED'
      && error?.details?.mismatchCount === 1,
  );
});

test('accepts observed metric drift only when explicitly requested', () => {
  const result = reconcileLatestLarkWithD1({
    records: [record('latest', 'youtube', 'one', '2026-08-15', 12)],
    d1Rows: [{
      platform: 'youtube', account_key: 'chemistry_k', external_content_id: 'one',
      metric_date: '2026-08-15', views: 13, likes: null, comments: 0, shares: null,
      unique_viewers: null, avg_watch_time_seconds: null,
      total_watch_time_seconds: null, completion_rate: null,
    }],
    requireMetricParity: false,
  });
  assert.equal(result.requireMetricParity, false);
  assert.equal(result.observedMetricDriftCount, 1);
});

test('accepts an identity absent from D1 only when an explicit protected source backs it', () => {
  const result = reconcileLatestLarkWithD1({
    records: [record('latest', 'tiktok', 'one', '2026-08-15', 12)],
    d1Rows: [],
    sourceBackedExternalIdsByPlatform: { tiktok: new Set(['one']) },
  });
  assert.equal(result.missingInD1Count, 0);
});

test('requires D1 coverage only for identities affected by deletion when explicitly scoped', () => {
  const result = reconcileLatestLarkWithD1({
    records: [
      record('retained-only', 'tiktok', 'retained-only', '2026-08-15', 12),
      record('delete-affected', 'tiktok', 'delete-affected', '2026-08-15', 13),
    ],
    d1Rows: [{
      platform: 'tiktok', external_content_id: 'delete-affected', metric_date: '2026-08-15',
      views: 13, likes: null, comments: 0, shares: null, unique_viewers: null,
      avg_watch_time_seconds: null, total_watch_time_seconds: null, completion_rate: null,
    }],
    requiredExternalIdsByPlatform: { tiktok: ['delete-affected'] },
  });
  assert.equal(result.requiredIdentityPolicy, 'delete_affected_only');
  assert.equal(result.missingInD1Count, 0);
});

test('summarizes exact platform counts', () => {
  assert.deepEqual(summarizePlatforms([{ platform: 'youtube' }, { platform: 'tiktok' }, { platform: 'youtube' }]), {
    tiktok: 1,
    youtube: 2,
  });
});
