import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOrganicMetricPayload,
  calculateOrganicPeriodMetrics,
} from '../../packages/application/src/reports/calculate-organic-period-metrics.js';

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const metric = (object, key, fallback = 0) => (hasOwn(object, key) ? object[key] : fallback);

const content = (id, publishedDate = '2026-05-01') => ({
  contentKey: `facebook:page:${id}`,
  externalContentId: id,
  accountId: 'page',
  platform: 'facebook',
  caption: null,
  contentUrl: null,
  thumbnailUrl: null,
  publishedAt: Date.parse(`${publishedDate}T00:00:00Z`),
  publishedDate,
});

const observation = (id, date, metrics = {}) => ({
  recordId: `${id}:${date}`,
  contentDailyKey: `facebook:page:${id}:${date}`,
  externalContentId: id,
  accountId: 'page',
  platform: 'facebook',
  metricDate: date,
  views: metric(metrics, 'views'),
  likes: metric(metrics, 'likes'),
  comments: metric(metrics, 'comments'),
  shares: metric(metrics, 'shares'),
  uniqueViewers: metric(metrics, 'uniqueViewers', null),
  avgWatchTimeSeconds: metric(metrics, 'avgWatchTimeSeconds', null),
  totalWatchTimeSeconds: metric(metrics, 'totalWatchTimeSeconds', null),
  completionRate: metric(metrics, 'completionRate', null),
});

function reportFor(contents, observations) {
  return calculateOrganicPeriodMetrics({
    platform: 'facebook',
    contents,
    observations,
    periodStart: '2026-08-14',
    periodEnd: '2026-08-20',
    coverageStatus: 'complete',
  });
}

test('aggregates observed values under complete coverage without converting source nulls to zero', () => {
  const report = reportFor(
    [content('legacy-a'), content('observed-b')],
    [
      observation('legacy-a', '2026-08-13', {
        views: 100,
        likes: null,
        comments: null,
        shares: 2,
      }),
      observation('legacy-a', '2026-08-20', {
        views: 140,
        likes: null,
        comments: null,
        shares: 5,
      }),
      observation('observed-b', '2026-08-13', {
        views: 200,
        likes: 10,
        comments: 1,
        shares: 3,
      }),
      observation('observed-b', '2026-08-20', {
        views: 260,
        likes: 16,
        comments: 4,
        shares: 7,
      }),
    ],
  );

  assert.equal(report.metrics.period_views, 100);
  assert.equal(report.metrics.period_likes, 6);
  assert.equal(report.metrics.period_comments, 3);
  assert.equal(report.metrics.period_shares, 7);
  assert.equal(report.metrics.period_engagement, 16);
  assert.equal(report.metrics.latest_total_views, 400);
  assert.equal(report.metrics.latest_total_likes, 16);
  assert.equal(report.metrics.latest_total_comments, 4);
  assert.equal(report.metrics.latest_total_shares, 12);
  assert.equal(report.metrics.latest_total_engagement, 32);

  const legacy = report.contentRows.find((row) => row.content.externalContentId === 'legacy-a');
  assert.equal(legacy.current.likes, null);
  assert.equal(legacy.current.comments, null);
  assert.equal(legacy.periodLikes, null);
  assert.equal(legacy.periodComments, null);
  assert.equal(legacy.periodEngagement, null);
  assert.equal(legacy.latestEngagement, null);
});

test('keeps an entirely unobserved metric null and marks it not observed', () => {
  const report = reportFor(
    [content('a'), content('b')],
    [
      observation('a', '2026-08-13', { views: 10, likes: null }),
      observation('a', '2026-08-20', { views: 20, likes: null }),
      observation('b', '2026-08-13', { views: 30, likes: null }),
      observation('b', '2026-08-20', { views: 40, likes: null }),
    ],
  );

  assert.equal(report.metrics.period_likes, null);
  assert.equal(report.metrics.latest_total_likes, null);

  const payload = buildOrganicMetricPayload({
    platform: 'facebook',
    formulaVersion: 'facebook-organic-v1',
    current: report,
    compare: null,
  });
  assert.equal(payload['facebook:period_likes'].availabilityStatus, 'not_observed');
  assert.equal(payload['facebook:latest_total_likes'].availabilityStatus, 'not_observed');
});

test('preserves strict null aggregate evidence when source coverage is not complete', () => {
  const report = calculateOrganicPeriodMetrics({
    platform: 'facebook',
    contents: [content('observed'), content('missing')],
    observations: [
      observation('observed', '2026-08-13', { views: 10, likes: 2 }),
      observation('observed', '2026-08-20', { views: 20, likes: 5 }),
      observation('missing', '2026-08-13', { views: 30, likes: null }),
      observation('missing', '2026-08-20', { views: 40, likes: null }),
    ],
    periodStart: '2026-08-14',
    periodEnd: '2026-08-20',
    coverageStatus: 'partial',
  });

  assert.equal(report.metrics.period_likes, null);
  assert.equal(report.metrics.latest_total_likes, null);
});

test('preserves observed zero and negative corrections', () => {
  const report = reportFor(
    [content('zero'), content('corrected')],
    [
      observation('zero', '2026-08-13', { views: 0, likes: 0, comments: 0, shares: 0 }),
      observation('zero', '2026-08-20', { views: 0, likes: 0, comments: 0, shares: 0 }),
      observation('corrected', '2026-08-13', { views: 100, likes: 10, comments: 2, shares: 1 }),
      observation('corrected', '2026-08-20', { views: 95, likes: 8, comments: 1, shares: 0 }),
    ],
  );

  assert.equal(report.metrics.period_views, -5);
  assert.equal(report.metrics.period_likes, -2);
  assert.equal(report.metrics.period_comments, -1);
  assert.equal(report.metrics.period_shares, -1);
  assert.equal(report.metrics.period_engagement, -4);
  assert.equal(report.metrics.latest_total_likes, 8);
  assert.equal(report.metrics.latest_total_comments, 1);
  assert.equal(report.metrics.latest_total_shares, 0);
});
