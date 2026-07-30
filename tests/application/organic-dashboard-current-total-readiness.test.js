import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOrganicMetricPayload,
  calculateOrganicPeriodMetrics,
} from '../../packages/application/src/reports/calculate-organic-period-metrics.js';
import { buildReportMetricValueRows } from '../../packages/application/src/reports/build-report-output-rows.js';
import { buildUniversalMarketingDashboardModel } from '../../packages/application/src/use-cases/build-universal-marketing-dashboard-model.js';
import {
  DASHBOARD_METRIC_AVAILABILITY_OPTIONS,
  DASHBOARD_METRIC_SCOPE_OPTIONS,
} from '../../packages/config/src/dashboard-metric-readiness.js';
import { LARK_REPORT_MATERIALIZATION_SCHEMA } from '../../packages/config/src/lark-report-materialization-schema.js';

const GENERATED_AT = Date.parse('2026-07-30T00:00:00Z');

function partialOrganicResult() {
  return calculateOrganicPeriodMetrics({
    platform: 'tiktok',
    contents: [
      content('covered', '2026-06-01'),
      content('uncovered', '2026-06-01'),
    ],
    observations: [
      observation('covered', '2026-07-09', 100, 10, 2, 1),
      observation('covered', '2026-07-12', 120, 12, 3, 2),
      observation('uncovered', '2026-07-11', 5, 1, 1, 0),
      observation('uncovered', '2026-07-12', 8, 2, 1, 0),
    ],
    periodStart: '2026-07-10',
    periodEnd: '2026-07-12',
    coverageStatus: 'complete',
  });
}

test('partial Organic window keeps period deltas unavailable while exposing truthful current totals', () => {
  const result = partialOrganicResult();

  assert.equal(result.dataStatus, 'partial');
  assert.equal(result.metrics.period_views, null);
  assert.equal(result.metrics.period_engagement, null);
  assert.equal(result.metrics.latest_total_views, 128);
  assert.equal(result.metrics.latest_total_likes, 14);
  assert.equal(result.metrics.latest_total_comments, 4);
  assert.equal(result.metrics.latest_total_shares, 2);
  assert.equal(result.metrics.latest_total_engagement, 20);
  assert.equal(result.metrics.latest_engagement_rate, 20 / 128);
  assert.equal(result.metrics.baseline_covered_content_count, 1);
  assert.equal(result.metrics.baseline_missing_content_count, 1);
  assert.equal(result.metrics.baseline_coverage_rate, 0.5);
  assert.deepEqual(result.baselineModeCounts, {
    actual: 1,
    new_content: 0,
    partial_first_snapshot: 1,
    missing_baseline: 0,
  });
});

test('Organic metric payload groups 17 client metrics and explains every unavailable value', () => {
  const result = partialOrganicResult();
  const payload = buildOrganicMetricPayload({
    platform: 'tiktok',
    current: result,
    compare: null,
    formulaVersion: 'tiktok-organic-v1',
  });

  assert.equal(Object.keys(payload).length, 17);
  const period = payload['tiktok:period_views'];
  assert.equal(period.current, null);
  assert.equal(period.metricScope, 'period_delta');
  assert.equal(period.availabilityStatus, 'baseline_incomplete');
  assert.equal(period.availabilityMessage, 'N/A — Baseline ยังไม่ครบ');

  const total = payload['tiktok:latest_total_likes'];
  assert.equal(total.current, 14);
  assert.equal(total.metricScope, 'current_total');
  assert.equal(total.availabilityStatus, 'available');
  assert.equal(total.availabilityMessage, 'พร้อมใช้งาน');

  const readiness = payload['tiktok:baseline_missing_content_count'];
  assert.equal(readiness.current, 1);
  assert.equal(readiness.metricScope, 'data_quality');
  assert.equal(readiness.availabilityStatus, 'available');
});

test('Lark metric rows preserve null numeric cells and carry explicit readiness metadata', () => {
  const result = partialOrganicResult();
  const metrics = buildOrganicMetricPayload({
    platform: 'tiktok',
    current: result,
    compare: null,
    formulaVersion: 'tiktok-organic-v1',
  });
  const rows = buildReportMetricValueRows({
    reportId: 'report-1',
    reportSettingKey: 'integration_workspace:tiktok:rolling:3d',
    customerProfile: 'integration_workspace',
    reportType: 'dashboard_performance_report',
    platform: 'tiktok',
    accountId: 'chemistry_k',
    metrics,
    dataStatus: 'partial',
    period: {
      periodStart: '2026-07-10',
      periodEnd: '2026-07-12',
      compareStart: '2026-07-07',
      compareEnd: '2026-07-09',
    },
    generatedAt: GENERATED_AT,
    utcOffset: '+07:00',
    sourceSnapshotCount: result.sourceSnapshotCount,
  });

  assert.equal(rows.length, 17);
  const period = rows.find((row) => row.metric_key === 'tiktok:period_views');
  assert.equal(period.current_value, null);
  assert.equal(period.metric_scope, 'period_delta');
  assert.equal(period.availability_status, 'baseline_incomplete');
  assert.equal(period.availability_message, 'N/A — Baseline ยังไม่ครบ');

  const total = rows.find((row) => row.metric_key === 'tiktok:latest_total_views');
  assert.equal(total.current_value, 128);
  assert.equal(total.metric_scope, 'current_total');
  assert.equal(total.availability_status, 'available');
});

test('Lark schema adds only generic metric readiness fields to Metric Values', () => {
  const metricFields = LARK_REPORT_MATERIALIZATION_SCHEMA.tables.mktReportMetricValues.additiveFields;
  const byName = new Map(metricFields.map((field) => [field.fieldName, field]));

  assert.deepEqual(byName.get('metric_scope').options, DASHBOARD_METRIC_SCOPE_OPTIONS);
  assert.deepEqual(byName.get('availability_status').options, DASHBOARD_METRIC_AVAILABILITY_OPTIONS);
  assert.equal(byName.get('availability_message').type, 1);
  assert.equal(
    LARK_REPORT_MATERIALIZATION_SCHEMA.tables.mktReportTopContent.additiveFields
      .some((field) => field.fieldName === 'metric_scope'),
    false,
  );
});

test('Universal Dashboard groups current totals, period deltas and data quality without hiding N/A reasons', () => {
  const result = partialOrganicResult();
  const metricPayload = buildOrganicMetricPayload({
    platform: 'tiktok',
    current: result,
    compare: null,
    formulaVersion: 'tiktok-organic-v1',
  });
  const materialization = {
    reportId: 'report-1',
    reportSettingKey: 'integration_workspace:tiktok:rolling:3d',
    customerKey: 'chemistry_k',
    customerProfile: 'integration_workspace',
    accountId: 'chemistry_k',
    generatedAt: GENERATED_AT,
    payload: {
      schemaVersion: 'dashboard-materialization-v2',
      sourceReportId: null,
      platformScope: 'tiktok',
      capability: 'organic',
      reportType: 'dashboard_performance_report',
      period: {
        periodKind: 'rolling_days',
        windowDays: 3,
        periodStart: '2026-07-10',
        periodEnd: '2026-07-12',
        comparisonMode: 'previous_period',
        compareStart: '2026-07-07',
        compareEnd: '2026-07-09',
      },
      dataStatus: 'partial',
      coverageRate: 0.5,
      metricPayload,
      collections: {},
      topContent: [],
      topAds: [],
      source: 'd1_historical_facts',
      sourceWatermark: 'wm-1',
      generatedAt: GENERATED_AT,
      sourceUnavailableReason: null,
      aiSummary: null,
    },
  };

  const model = buildUniversalMarketingDashboardModel({ materializations: [materialization] });
  const report = model.reports[0];
  assert.deepEqual(report.cardGroups.map((group) => group.metricScope), [
    'current_total', 'data_quality', 'period_delta',
  ]);
  assert.equal(report.cardGroups.find((group) => group.metricScope === 'current_total').availableCardCount, 6);
  assert.equal(report.cardGroups.find((group) => group.metricScope === 'period_delta').availableCardCount, 0);
  assert.equal(report.dataQuality.unavailableMetricCount, 6);
  assert.equal(report.dataQuality.warnings.some((warning) => warning.code === 'DASHBOARD_METRICS_UNAVAILABLE'), true);
  assert.deepEqual(model.discovery.metricScopes, ['current_total', 'data_quality', 'period_delta']);

  const totalsOnly = buildUniversalMarketingDashboardModel({
    materializations: [materialization],
    selection: { metricScope: 'current_total' },
  });
  assert.equal(totalsOnly.reports[0].cards.length, 6);
  assert.equal(totalsOnly.reports[0].cards.every((card) => card.current !== null), true);
});

function content(id, publishedDate) {
  return Object.freeze({
    contentKey: `tiktok:chemistry_k:${id}`,
    externalContentId: id,
    accountId: 'chemistry_k',
    platform: 'tiktok',
    publishedDate,
    publishedAt: Date.parse(`${publishedDate}T00:00:00Z`),
    caption: id,
    contentUrl: null,
    thumbnailUrl: null,
  });
}

function observation(id, metricDate, views, likes, comments, shares) {
  return Object.freeze({
    recordId: `${id}:${metricDate}`,
    externalContentId: id,
    accountId: 'chemistry_k',
    platform: 'tiktok',
    metricDate,
    views,
    likes,
    comments,
    shares,
    uniqueViewers: null,
    avgWatchTimeSeconds: null,
    totalWatchTimeSeconds: null,
    completionRate: null,
  });
}
