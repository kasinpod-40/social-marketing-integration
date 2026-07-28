import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_SOURCE_STATUS,
  createReportPlatformAdapterRegistry,
  listReportPlatformContracts,
} from '../../packages/application/src/reports/report-platform-adapter-registry.js';
import {
  calculateOrganicPeriodMetrics,
} from '../../packages/application/src/reports/calculate-organic-period-metrics.js';
import {
  buildReportTopAdsRows,
} from '../../packages/application/src/reports/build-report-output-rows.js';
import { generateDashboardReportMaterialization } from '../../packages/application/src/use-cases/generate-dashboard-report-materialization.js';
import { generateReportAiSummary } from '../../packages/application/src/use-cases/generate-report-ai-summary.js';

const GENERATED_AT = Date.parse('2026-07-28T00:00:00Z');

test('registry covers every Organic and Paid Ads platform without pretending planned sources are active', () => {
  const contracts = listReportPlatformContracts();
  assert.deepEqual(contracts.map((item) => item.platformScope), [
    'facebook', 'instagram', 'tiktok', 'youtube', 'meta_ads', 'google_ads', 'tiktok_ads',
  ]);
  assert.equal(contracts.find((item) => item.platformScope === 'tiktok_ads').sourceStatus, REPORT_SOURCE_STATUS.PLANNED);
  assert.equal(contracts.find((item) => item.platformScope === 'tiktok').sourceStatus, REPORT_SOURCE_STATUS.ACTIVE);
});

test('Organic cumulative calculation preserves new-content zero baseline, partial old content and negative correction', () => {
  const contents = [
    content('old', '2026-06-01'),
    content('new', '2026-07-11'),
    content('missing', '2026-06-01'),
  ];
  const result = calculateOrganicPeriodMetrics({
    platform: 'youtube',
    contents,
    observations: [
      observation('old', '2026-07-09', 100),
      observation('old', '2026-07-12', 90),
      observation('new', '2026-07-12', 12),
      observation('missing', '2026-07-11', 5),
      observation('missing', '2026-07-12', 8),
    ],
    periodStart: '2026-07-10',
    periodEnd: '2026-07-12',
    coverageStatus: 'complete',
  });
  const byId = new Map(result.contentRows.map((row) => [row.content.externalContentId, row]));
  assert.equal(byId.get('old').periodViews, -10);
  assert.equal(byId.get('old').performanceStatus, 'corrected_down');
  assert.equal(byId.get('new').periodViews, 12);
  assert.equal(byId.get('new').baselineMode, 'new_content');
  assert.equal(byId.get('missing').periodViews, 3);
  assert.equal(byId.get('missing').dataStatus, 'partial');
  assert.equal(result.dataStatus, 'partial');
});

test('source-unavailable platform materializes honestly without calling its adapter', async () => {
  let called = 0;
  const writes = [];
  const registry = createReportPlatformAdapterRegistry({
    adapters: { facebook: { async load() { called += 1; return {}; } } },
  });
  const result = await generateDashboardReportMaterialization({
    registry,
    materializationStore: { async saveReportMaterialization(row) { writes.push(row); return { status: 'written' }; } },
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    platformScope: 'facebook',
    reportSettingKey: 'integration_workspace:facebook:rolling:3d',
    periodKind: 'rolling_days',
    windowDays: 3,
    periodEnd: '2026-07-27',
    comparisonMode: 'previous_period',
    generatedAt: GENERATED_AT,
  });
  assert.equal(called, 0);
  assert.equal(result.dataStatus, 'source_unavailable');
  assert.equal(result.warnings[0].code, 'REPORT_SOURCE_UAT_PENDING');
  assert.equal(writes.length, 1);
  assert.equal(JSON.parse(writes[0].payload_json).dataStatus, 'source_unavailable');
});

test('active Organic adapter produces current and previous equal-length values from D1-shaped facts', async () => {
  const writes = [];
  const registry = createReportPlatformAdapterRegistry({
    adapters: {
      youtube: {
        async load() {
          return {
            contents: [content('video-1', '2026-01-01')],
            observations: [
              observation('video-1', '2026-07-06', 10),
              observation('video-1', '2026-07-09', 20),
              observation('video-1', '2026-07-12', 50),
            ],
            readSummary: { coverageStatus: 'complete', sourceWatermark: 'wm-1' },
          };
        },
      },
    },
  });
  const result = await generateDashboardReportMaterialization({
    registry,
    materializationStore: { async saveReportMaterialization(row) { writes.push(row); return { status: 'written' }; } },
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    platformScope: 'youtube',
    reportSettingKey: 'integration_workspace:youtube:custom_range',
    periodKind: 'custom_range',
    periodStart: '2026-07-10',
    periodEnd: '2026-07-12',
    comparisonMode: 'previous_period',
    sourceWatermark: 'wm-1',
    generatedAt: GENERATED_AT,
  });
  const metric = result.metricPayload['youtube:period_views'];
  assert.equal(metric.current, 30);
  assert.equal(metric.compare, 10);
  assert.equal(result.topContent[0].period_views, 30);
  assert.equal(writes[0].window_days, null);
});

test('AI provider receives validated materialization only and preserves null versus zero', async () => {
  let providerInput;
  const materializationPayload = {
    schemaVersion: 'dashboard-materialization-v2',
    sourceReportId: null,
    platformScope: 'google_ads',
    capability: 'paid_ads',
    reportType: 'dashboard_performance_report',
    period: {
      periodKind: 'rolling_days', windowDays: 3,
      periodStart: '2026-07-25', periodEnd: '2026-07-27',
      comparisonMode: 'previous_period', compareStart: '2026-07-22', compareEnd: '2026-07-24',
    },
    dataStatus: 'partial',
    coverageRate: 0.5,
    metricPayload: {
      'google_ads:clicks': { current: 0, compare: null },
    },
    topContent: [],
    topAds: [],
    source: 'd1_historical_facts',
    sourceWatermark: 'wm',
    generatedAt: GENERATED_AT,
    sourceUnavailableReason: null,
    aiSummary: null,
  };
  const result = await generateReportAiSummary({
    enabled: true,
    materializationPayload,
    provider: {
      async generate(value) {
        providerInput = value;
        return {
          narrative: 'ยอดคลิกเป็นศูนย์ แต่ค่าช่วงเปรียบเทียบไม่ทราบ',
          recommendations: ['ตรวจ coverage ก่อนตัดสินใจ'],
          coverageQualified: true,
          generatedAt: GENERATED_AT,
        };
      },
    },
  });
  assert.equal(providerInput.report.metricPayload['google_ads:clicks'].current, 0);
  assert.equal(providerInput.report.metricPayload['google_ads:clicks'].compare, null);
  assert.equal(Object.hasOwn(providerInput, 'db'), false);
  assert.equal(result.status, 'completed');
  assert.equal(result.summary.coverageQualified, true);
});

test('Top Ads rows preserve null and overwrite old deterministic ranks', () => {
  const rows = buildReportTopAdsRows({
    reportId: 'report',
    reportSettingKey: 'setting',
    customerProfile: 'integration_workspace',
    reportType: 'dashboard_performance_report',
    platform: 'meta_ads',
    accountId: 'chemistry_k',
    adRows: [{
      external_ad_id: 'ad-1', ad_name: 'Ad 1', spend_micros: 100,
      impressions: 0, clicks: 0, conversions: null, ctr: 0, cpc_micros: null,
      data_status: 'complete',
    }],
    limit: 2,
    period: { periodStart: '2026-07-25', periodEnd: '2026-07-27' },
    generatedAt: GENERATED_AT,
    utcOffset: '+07:00',
  });
  assert.equal(rows[0].impressions, 0);
  assert.equal(rows[0].conversions, null);
  assert.equal(rows[1].report_ad_key, 'report::rank:2');
  assert.equal(rows[1].data_status, 'no_data');
});

function content(id, publishedDate) {
  return Object.freeze({
    contentKey: `youtube:chemistry_k:${id}`,
    externalContentId: id,
    accountId: 'chemistry_k',
    platform: 'youtube',
    publishedDate,
    publishedAt: Date.parse(`${publishedDate}T00:00:00Z`),
    caption: id,
    contentUrl: null,
    thumbnailUrl: null,
  });
}
function observation(id, metricDate, views) {
  return Object.freeze({
    recordId: `${id}:${metricDate}`,
    externalContentId: id,
    accountId: 'chemistry_k',
    platform: 'youtube',
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
