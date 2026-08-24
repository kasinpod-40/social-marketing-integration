import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportMetricValueRows } from '../../packages/application/src/reports/build-report-output-rows.js';
import {
  LARK_DASHBOARD_DISPLAY_V2_FIELD,
  ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_SUFFIX,
  ORGANIC_DASHBOARD_METRIC_SUFFIXES,
  ORGANIC_DASHBOARD_PLATFORMS,
} from '../../packages/config/src/lark-dashboard-display-v2-compatibility.js';

const GENERATED_AT = Date.parse('2026-07-31T17:00:00Z');

test('Metric writer persists the exact 17 display v2 labels for every reviewed Organic platform and runtime', () => {
  for (const customerProfile of ['integration_workspace', 'chemistry_k']) {
    for (const platform of ORGANIC_DASHBOARD_PLATFORMS) {
      const metrics = Object.fromEntries(
        ORGANIC_DASHBOARD_METRIC_SUFFIXES.map((suffix, index) => {
          const metricKey = `${platform}:${suffix}`;
          return [metricKey, {
            metricKey,
            displayName: `Canonical ${metricKey}`,
            current: index < 6 ? null : index,
            compare: index < 6 ? null : index - 1,
            change: index < 6 ? null : 1,
            changePercent: index < 6 || index === 6 ? null : 1 / (index - 1),
            unit: suffix.endsWith('_rate') ? 'ratio' : 'count',
            metricScope: suffix.startsWith('period_') ? 'period_delta' : 'data_quality',
            availabilityStatus: index < 6 ? 'baseline_incomplete' : 'available',
            clientVisible: true,
            sortOrder: index + 1,
            formulaVersion: 'organic-test-v1',
            expectedDisplayV2: ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_SUFFIX[suffix],
          }];
        }),
      );
      const rows = buildReportMetricValueRows(metricInput({ metrics, platform, customerProfile }));
      assert.equal(rows.length, 17);

      for (const row of rows) {
        const source = metrics[row.metric_key];
        assert.equal(
          row[LARK_DASHBOARD_DISPLAY_V2_FIELD.fieldName],
          source.expectedDisplayV2,
          row.metric_key,
        );
        assert.equal(row.current_value, source.current, `${row.metric_key}.current_value`);
        assert.equal(row.compare_value, source.compare, `${row.metric_key}.compare_value`);
        assert.equal(row.display_name, source.displayName, `${row.metric_key}.display_name`);
      }
    }
  }
});

test('Metric writer keeps display v2 when Organic connector exposes a provider-native account id', () => {
  const metrics = {
    'facebook:latest_total_views': {
      metricKey: 'facebook:latest_total_views',
      displayName: 'Latest total views',
      current: 12345,
      compare: null,
      change: null,
      changePercent: null,
      unit: 'count',
      metricScope: 'current_total',
      availabilityStatus: 'available',
      clientVisible: true,
      sortOrder: 1,
      formulaVersion: 'facebook-organic-v1',
    },
  };
  const [row] = buildReportMetricValueRows(metricInput({
    metrics,
    platform: 'facebook',
    accountId: '1144655862068079',
  }));
  assert.equal(row.account_id, '1144655862068079');
  assert.equal(row[LARK_DASHBOARD_DISPLAY_V2_FIELD.fieldName], 'Latest total views');
  assert.equal(row.current_value, 12345);
});

test('Metric writer omits compatibility output for non-dashboard Organic metrics and outside exact scope', () => {
  const metrics = {
    'facebook:account_followers': {
      metricKey: 'facebook:account_followers',
      displayName: 'Followers',
      current: 100,
      compare: 90,
      change: 10,
      changePercent: 10 / 90,
      unit: 'count',
      metricScope: 'current_total',
      availabilityStatus: 'available',
      clientVisible: true,
      sortOrder: 1,
      formulaVersion: 'organic-test-v1',
    },
  };
  const [nonDashboardMetric] = buildReportMetricValueRows(metricInput({ metrics, platform: 'facebook' }));
  assert.equal(Object.hasOwn(nonDashboardMetric, LARK_DASHBOARD_DISPLAY_V2_FIELD.fieldName), false);

  const periodMetrics = {
    'tiktok:period_views': {
      metricKey: 'tiktok:period_views',
      displayName: 'Views gained',
      current: 100,
      compare: 90,
      change: 10,
      changePercent: 10 / 90,
      unit: 'count',
      metricScope: 'period_delta',
      availabilityStatus: 'available',
      clientVisible: true,
      sortOrder: 1,
      formulaVersion: 'organic-test-v1',
    },
  };
  for (const input of [
    metricInput({ metrics: periodMetrics, customerProfile: 'foreign_profile' }),
    metricInput({ metrics: periodMetrics, platform: 'meta_ads', capability: 'paid_ads' }),
    metricInput({ metrics: periodMetrics, reportType: 'daily_organic_report' }),
    metricInput({ metrics: periodMetrics, capability: 'paid_ads' }),
  ]) {
    const [row] = buildReportMetricValueRows(input);
    assert.equal(Object.hasOwn(row, LARK_DASHBOARD_DISPLAY_V2_FIELD.fieldName), false);
  }
});

function metricInput(overrides = {}) {
  const customerProfile = overrides.customerProfile ?? 'integration_workspace';
  const accountId = overrides.accountId ?? 'chemistry_k';
  const platform = overrides.platform ?? 'tiktok';
  const reportType = overrides.reportType ?? 'dashboard_performance_report';
  const capability = overrides.capability ?? 'organic';
  return {
    reportId: 'report-display-v2-test',
    reportSettingKey: `${customerProfile}:${platform}:rolling:7d`,
    customerProfile,
    reportType,
    platform,
    accountId,
    metrics: overrides.metrics,
    dataStatus: 'partial',
    sourceSnapshotCount: 10,
    period: {
      periodStart: '2026-07-25',
      periodEnd: '2026-07-31',
      compareStart: '2026-07-18',
      compareEnd: '2026-07-24',
    },
    generatedAt: GENERATED_AT,
    utcOffset: '+07:00',
    sharedDimensions: {
      customer_key: 'chemistry_k',
      customer_profile: customerProfile,
      capability,
      account_id: accountId,
      report_setting_key: `${customerProfile}:${platform}:rolling:7d`,
      report_type: reportType,
      period_kind: 'rolling_days',
      window_days: '7',
      period_start: Date.parse('2026-07-24T17:00:00Z'),
      period_end: Date.parse('2026-07-31T16:59:59Z'),
      data_status: 'partial',
      coverage_rate: 0.5,
      generated_at: GENERATED_AT,
    },
  };
}
