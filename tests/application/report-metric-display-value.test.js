import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportMetricValueRows } from '../../packages/application/src/reports/build-report-output-rows.js';
import {
  isReportMetricMicrosCurrency,
  resolveReportMetricDisplayValue,
} from '../../packages/application/src/reports/report-metric-display-value.js';
import {
  LARK_REPORT_SCHEMA_V2,
  LARK_REPORT_SCHEMA_V2_VERSION,
} from '../../packages/config/src/lark-report-schema-v2.js';

test('scales micros currency into display units without changing other metrics', () => {
  assert.equal(resolveReportMetricDisplayValue({
    metricKey: 'meta_ads:spend_micros',
    unit: 'currency',
    currentValue: 25_373_376_028,
  }), 25_373.376);
  assert.equal(resolveReportMetricDisplayValue({
    metricKey: 'woocommerce:net_sales_micros',
    unit: 'currency',
    currentValue: 168_010_000_000,
  }), 168_010);
  assert.equal(resolveReportMetricDisplayValue({
    metricKey: 'woocommerce:recognized_orders',
    unit: 'count',
    currentValue: 45,
  }), 45);
  assert.equal(resolveReportMetricDisplayValue({
    metricKey: 'facebook:period_views',
    unit: 'count',
    currentValue: null,
  }), null);
  assert.equal(isReportMetricMicrosCurrency({
    metricKey: 'google_ads:cpc_micros',
    unit: 'currency',
  }), true);
  assert.equal(isReportMetricMicrosCurrency({
    metricKey: 'google_ads:clicks',
    unit: 'count',
  }), false);
});

test('materialized Lark metric row carries canonical current_value and derived display_value', () => {
  const [row] = buildReportMetricValueRows({
    reportId: 'report-1',
    reportSettingKey: 'setting-1',
    customerProfile: 'integration_workspace',
    reportType: 'dashboard_performance_report',
    platform: 'meta_ads',
    accountId: 'chemistry_k',
    dataStatus: 'complete',
    sourceSnapshotCount: 1,
    period: {
      periodStart: '2026-07-29',
      periodEnd: '2026-07-31',
      compareStart: '2026-07-26',
      compareEnd: '2026-07-28',
    },
    generatedAt: Date.parse('2026-08-01T00:00:00Z'),
    utcOffset: '+07:00',
    sharedDimensions: {
      customer_key: 'chemistry_k',
      customer_profile: 'integration_workspace',
      capability: 'paid_ads',
      account_id: 'chemistry_k',
      report_setting_key: 'setting-1',
      report_type: 'dashboard_performance_report',
      period_kind: 'rolling_days',
      window_days: 3,
      period_start: Date.parse('2026-07-29T00:00:00Z'),
      period_end: Date.parse('2026-07-31T00:00:00Z'),
      data_status: 'complete',
      coverage_rate: 1,
      generated_at: Date.parse('2026-08-01T00:00:00Z'),
    },
    metrics: {
      spend: {
        metricKey: 'meta_ads:spend_micros',
        displayName: 'Spend',
        unit: 'currency',
        current: 25_373_376_028,
        compare: null,
        change: null,
        changePercent: null,
        metricScope: 'period_delta',
        availabilityStatus: 'available',
        clientVisible: true,
        sortOrder: 1,
        formulaVersion: 'meta-ads-v1',
      },
    },
  });

  assert.equal(row.current_value, 25_373_376_028);
  assert.equal(row.display_value, 25_373.376);
  assert.equal(row.unit, 'currency');
});

test('report schema v6 adds display_value as an additive Number field', () => {
  assert.equal(LARK_REPORT_SCHEMA_V2_VERSION, 'report-materialization-schema-v6');
  const table = LARK_REPORT_SCHEMA_V2.find((entry) => entry.key === 'mktReportMetricValues');
  const displayField = table.fields.find((field) => field.fieldName === 'display_value');
  assert.equal(displayField.type, 2);
  assert.equal(displayField.uiType, 'Number');
  assert.equal(displayField.property?.formatter, '0.0000');
  assert.notEqual(displayField.property?.formatter, '1,000.0000');
});
