import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateTikTokOrganicPeriodMetrics,
  compareTikTokOrganicMetrics,
} from '../../packages/application/src/reports/calculate-tiktok-organic-report.js';

const content = (id, publishedDate = '2026-07-01') => ({
  contentKey: `tiktok:ft_pumkin:${id}`,
  externalContentId: id,
  accountId: 'ft_pumkin',
  platform: 'tiktok',
  caption: `clip ${id}`,
  contentUrl: `https://tiktok.com/v/${id}`,
  thumbnailUrl: null,
  publishedAt: Date.parse(`${publishedDate}T01:00:00Z`),
  publishedDate,
});

const snapshot = (id, date, metrics = {}) => ({
  recordId: `${id}:${date}`,
  contentDailyKey: `tiktok:ft_pumkin:${id}:${date}`,
  externalContentId: id,
  accountId: 'ft_pumkin',
  platform: 'tiktok',
  metricDate: date,
  views: metrics.views ?? 0,
  likes: metrics.likes ?? 0,
  comments: metrics.comments ?? 0,
  shares: metrics.shares ?? 0,
  uniqueViewers: metrics.uniqueViewers ?? null,
  avgWatchTimeSeconds: metrics.avgWatchTimeSeconds ?? null,
  totalWatchTimeSeconds: metrics.totalWatchTimeSeconds ?? null,
  completionRate: metrics.completionRate ?? null,
});

test('calculates cumulative deltas, engagement rate, and weighted latest metrics', () => {
  const report = calculateTikTokOrganicPeriodMetrics({
    contents: [content('a'), content('b')],
    dailySnapshots: [
      snapshot('a', '2026-07-05', { views: 100, likes: 10, comments: 2, shares: 1 }),
      snapshot('a', '2026-07-12', { views: 160, likes: 16, comments: 4, shares: 2, avgWatchTimeSeconds: 4, completionRate: 0.4 }),
      snapshot('b', '2026-07-05', { views: 200, likes: 20, comments: 5, shares: 2 }),
      snapshot('b', '2026-07-12', { views: 240, likes: 24, comments: 7, shares: 3, avgWatchTimeSeconds: 2, completionRate: 0.2 }),
    ],
    periodStart: '2026-07-06',
    periodEnd: '2026-07-12',
  });

  assert.equal(report.metrics.period_views, 100);
  assert.equal(report.metrics.period_engagement, 16);
  assert.equal(report.metrics.period_engagement_rate, 0.16);
  assert.equal(report.metrics.latest_total_views, 400);
  assert.equal(report.metrics.latest_weighted_avg_watch_time_seconds, 2.8);
  assert.equal(report.metrics.latest_weighted_completion_rate, 0.28);
  assert.equal(report.dataStatus, 'complete');
  assert.equal(report.baselineCoverageRate, 1);
  assert.deepEqual(report.contentRows.map((row) => row.content.externalContentId), ['a', 'b']);
});

test('uses zero baseline for content published in the period and marks it new', () => {
  const report = calculateTikTokOrganicPeriodMetrics({
    contents: [content('new', '2026-07-10')],
    dailySnapshots: [snapshot('new', '2026-07-12', { views: 500, likes: 40, comments: 5, shares: 5 })],
    periodStart: '2026-07-06',
    periodEnd: '2026-07-12',
  });

  assert.equal(report.metrics.period_views, 500);
  assert.equal(report.metrics.new_content_count, 1);
  assert.equal(report.contentRows[0].baselineMode, 'new_content');
  assert.equal(report.contentRows[0].performanceStatus, 'new');
  assert.equal(report.dataStatus, 'complete');
});

test('marks old content without a pre-period baseline as partial', () => {
  const report = calculateTikTokOrganicPeriodMetrics({
    contents: [content('old', '2026-06-01')],
    dailySnapshots: [
      snapshot('old', '2026-07-08', { views: 100 }),
      snapshot('old', '2026-07-12', { views: 130 }),
    ],
    periodStart: '2026-07-06',
    periodEnd: '2026-07-12',
  });

  assert.equal(report.metrics.period_views, 30);
  assert.equal(report.dataStatus, 'partial');
  assert.equal(report.baselineCoverageRate, 0);
  assert.equal(report.contentRows[0].baselineMode, 'partial_first_snapshot');
});

test('preserves negative platform corrections instead of forcing them to zero', () => {
  const report = calculateTikTokOrganicPeriodMetrics({
    contents: [content('corrected')],
    dailySnapshots: [
      snapshot('corrected', '2026-07-05', { views: 100, likes: 10 }),
      snapshot('corrected', '2026-07-12', { views: 95, likes: 8 }),
    ],
    periodStart: '2026-07-06',
    periodEnd: '2026-07-12',
  });

  assert.equal(report.metrics.period_views, -5);
  assert.equal(report.metrics.period_likes, -2);
  assert.equal(report.contentRows[0].performanceStatus, 'corrected_down');
});

test('rejects duplicate content and duplicate same-day snapshots', () => {
  assert.throws(() => calculateTikTokOrganicPeriodMetrics({
    contents: [content('a'), content('a')],
    dailySnapshots: [],
    periodStart: '2026-07-06', periodEnd: '2026-07-12',
  }), /Duplicate TikTok content identity/);

  assert.throws(() => calculateTikTokOrganicPeriodMetrics({
    contents: [content('a')],
    dailySnapshots: [snapshot('a', '2026-07-12'), snapshot('a', '2026-07-12')],
    periodStart: '2026-07-06', periodEnd: '2026-07-12',
  }), /Duplicate TikTok daily snapshot/);
});

test('builds current/compare/change metrics from seeded definitions', () => {
  const payload = compareTikTokOrganicMetrics({
    current: { metrics: { period_views: 120 } },
    compare: { metrics: { period_views: 100 } },
    metricDefinitions: [{
      metric_key: 'tiktok:period_views', display_name: 'Views', unit: 'count',
      client_visible: true, sort_order: 10, formula_version: 'tiktok-organic-v1',
    }],
  });

  assert.deepEqual(payload['tiktok:period_views'], {
    metricKey: 'tiktok:period_views', displayName: 'Views', unit: 'count',
    current: 120, compare: 100, change: 20, changePercent: 0.2,
    clientVisible: true, sortOrder: 10, formulaVersion: 'tiktok-organic-v1',
  });
});
