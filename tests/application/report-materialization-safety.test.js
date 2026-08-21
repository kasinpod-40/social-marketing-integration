import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAdsPeriodMetrics } from '../../packages/application/src/reports/calculate-ads-period-metrics.js';
import { calculateOrganicPeriodMetrics } from '../../packages/application/src/reports/calculate-organic-period-metrics.js';
import { createReportPlatformAdapterRegistry } from '../../packages/application/src/reports/report-platform-adapter-registry.js';
import { generateDashboardReportMaterialization } from '../../packages/application/src/use-cases/generate-dashboard-report-materialization.js';

const GENERATED_AT = Date.parse('2026-07-28T00:00:00Z');

test('active materialization fails closed when admitted watermark is absent from D1 source', async () => {
  const registry = createReportPlatformAdapterRegistry({
    adapters: {
      youtube: {
        async load() {
          return {
            contents: [],
            observations: [],
            readSummary: { coverageStatus: 'complete', sourceWatermark: null },
          };
        },
      },
    },
  });
  await assert.rejects(
    () => generateDashboardReportMaterialization({
      registry,
      materializationStore: { async saveReportMaterialization() { throw new Error('must not write'); } },
      customerKey: 'chemistry_k',
      accountKey: 'chemistry_k',
      platformScope: 'youtube',
      reportSettingKey: 'integration_workspace:youtube:rolling:3d',
      periodKind: 'rolling_days',
      windowDays: 3,
      periodEnd: '2026-07-27',
      comparisonMode: 'previous_period',
      sourceWatermark: 'admitted-watermark',
      generatedAt: GENERATED_AT,
    }),
    (error) => error.code === 'DASHBOARD_REPORT_SOURCE_WATERMARK_CHANGED'
      && error.details.observed === null,
  );
});

test('Organic complete source coverage aggregates observed subtotal without fabricating unknown members', () => {
  const result = calculateOrganicPeriodMetrics({
    platform: 'facebook',
    contents: [content('known'), content('unknown')],
    observations: [
      observation('known', '2026-07-09', 10),
      observation('known', '2026-07-12', 20),
      observation('unknown', '2026-07-09', null),
      observation('unknown', '2026-07-12', null),
    ],
    periodStart: '2026-07-10',
    periodEnd: '2026-07-12',
    coverageStatus: 'complete',
  });
  assert.equal(result.metrics.period_views, 10);
  assert.equal(result.contentRows.find((row) => row.content.externalContentId === 'known').periodViews, 10);
  assert.equal(result.contentRows.find((row) => row.content.externalContentId === 'unknown').periodViews, null);
});

test('Organic complete baselines do not override incomplete source Coverage', () => {
  const result = calculateOrganicPeriodMetrics({
    platform: 'instagram',
    contents: [content('one')],
    observations: [
      observation('one', '2026-07-09', 10),
      observation('one', '2026-07-12', 20),
    ],
    periodStart: '2026-07-10',
    periodEnd: '2026-07-12',
    coverageStatus: 'partial',
  });
  assert.equal(result.baselineCoverageRate, 1);
  assert.equal(result.dataStatus, 'partial');
  assert.equal(result.metrics.period_views, 10);
});

test('Ads aggregate remains null for mixed known/unknown facts and confirms covered empty periods', () => {
  const partial = calculateAdsPeriodMetrics({
    reportLevel: 'account',
    coverageStatus: 'complete',
    rows: [
      adsFact(100, 10),
      { ...adsFact(null, 20), spend_micros: null },
    ],
  });
  assert.equal(partial.spend_micros, null);
  assert.equal(partial.impressions, 30);
  assert.equal(partial.cpm_micros, null);

  const empty = calculateAdsPeriodMetrics({
    reportLevel: 'account',
    coverageStatus: 'complete',
    rows: [],
  });
  assert.equal(empty.data_status, 'no_data_confirmed');
  assert.equal(empty.spend_micros, null);
});

function content(id) {
  return Object.freeze({
    contentKey: `platform:chemistry_k:${id}`,
    externalContentId: id,
    accountId: 'chemistry_k',
    platform: 'facebook',
    publishedDate: '2026-01-01',
    publishedAt: Date.parse('2026-01-01T00:00:00Z'),
  });
}
function observation(id, metricDate, views) {
  return Object.freeze({
    recordId: `${id}:${metricDate}`,
    externalContentId: id,
    accountId: 'chemistry_k',
    metricDate,
    views,
    likes: 0,
    comments: 0,
    shares: 0,
    uniqueViewers: null,
    avgWatchTimeSeconds: null,
    totalWatchTimeSeconds: null,
    completionRate: null,
  });
}
function adsFact(spend, impressions) {
  return Object.freeze({
    report_level: 'account',
    spend_micros: spend,
    impressions,
    reach: null,
    clicks: 1,
    conversions: 0,
    conversion_value_micros: 0,
    video_views: null,
    data_status: 'complete',
  });
}
