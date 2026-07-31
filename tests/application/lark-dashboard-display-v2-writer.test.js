import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportMetricValueRows } from '../../packages/application/src/reports/build-report-output-rows.js';
import {
  LARK_DASHBOARD_DISPLAY_V2_FIELD,
  TIKTOK_ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_KEY,
} from '../../packages/config/src/lark-dashboard-display-v2-compatibility.js';

const GENERATED_AT = Date.parse('2026-07-31T17:00:00Z');

test('Metric writer persists the exact 17 display v2 labels without changing metric values', () => {
  const metrics = Object.fromEntries(
    Object.entries(TIKTOK_ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_KEY)
      .map(([metricKey, displayV2], index) => [metricKey, {
        metricKey,
        displayName: `Canonical ${metricKey}`,
        current: index < 6 ? null : index,
        compare: index < 6 ? null : index - 1,
        change: index < 6 ? null : 1,
        changePercent: index < 6 || index === 6 ? null : 1 / (index - 1),
        unit: metricKey.endsWith('_rate') ? 'ratio' : 'count',
        metricScope: metricKey.startsWith('tiktok:period_') ? 'period_delta' : 'data_quality',
        availabilityStatus: index < 6 ? 'baseline_incomplete' : 'available',
        clientVisible: true,
        sortOrder: index + 1,
        formulaVersion: 'organic-test-v1',
        expectedDisplayV2: displayV2,
      }]),
  );
  const rows = buildReportMetricValueRows(metricInput({ metrics }));
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
  assert.equal(
    rows.find((row) => row.metric_key === 'tiktok:baseline_covered_content_count')
      [LARK_DASHBOARD_DISPLAY_V2_FIELD.fieldName],
    'Baseline coverage',
  );
  assert.equal(
    rows.find((row) => row.metric_key === 'tiktok:baseline_coverage_rate')
      [LARK_DASHBOARD_DISPLAY_V2_FIELD.fieldName],
    'Baseline Coverage Rate',
  );
});

test('Metric writer omits Integration Workspace legacy field outside the exact compatibility scope', () => {
  const metrics = {
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
    metricInput({ metrics, customerProfile: 'chemistry_k' }),
    metricInput({ metrics, accountId: 'other_account' }),
    metricInput({ metrics, platform: 'youtube' }),
    metricInput({ metrics, reportType: 'daily_organic_report' }),
    metricInput({ metrics, capability: 'paid_ads' }),
  ]) {
    const [row] = buildReportMetricValueRows(input);
    assert.equal(
      Object.hasOwn(row, LARK_DASHBOARD_DISPLAY_V2_FIELD.fieldName),
      false,
    );
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
    reportSettingKey: 'integration_workspace:tiktok:rolling:7d',
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
      report_setting_key: 'integration_workspace:tiktok:rolling:7d',
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
