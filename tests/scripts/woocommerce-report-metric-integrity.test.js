import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommerceDimensionMetricPayload } from '../../packages/application/src/reports/build-commerce-dimension-metric-payload.js';
import { buildReportMetricValueRows } from '../../packages/application/src/reports/build-report-output-rows.js';
import { assertReportRuntimeMetricIntegrity } from '../../scripts/lib/report-runtime-window-repair.js';

const FORMULA_VERSION = 'woocommerce-commerce-v1';

function summaryMetrics() {
  return Object.fromEntries(Array.from({ length: 13 }, (_, index) => {
    const metricKey = `woocommerce:summary:${index + 1}`;
    return [metricKey, {
      metricKey,
      displayName: `Summary ${index + 1}`,
      unit: 'count',
      current: index,
      compare: null,
      change: null,
      changePercent: null,
      clientVisible: true,
      sortOrder: index + 1,
      formulaVersion: FORMULA_VERSION,
    }];
  }));
}

function dimensionMetrics() {
  return buildCommerceDimensionMetricPayload({
    platform: 'woocommerce',
    formulaVersion: FORMULA_VERSION,
    collections: {
      top_products: [{ product_key: 'p1', net_sales_micros: 0 }],
      payment_methods: [{
        payment_method_id: 'cod',
        payment_method_title: 'Cash on delivery',
        recognized_revenue_micros: 1_000_000,
      }],
      shipping_methods: [],
    },
  });
}

function metricRows(summary, dimensions) {
  const common = {
    reportId: 'report-1',
    reportSettingKey: 'integration_workspace:woocommerce:rolling:3d',
    customerProfile: 'integration_workspace',
    reportType: 'dashboard_performance_report',
    platform: 'woocommerce',
    accountId: 'chemistry_k',
    dataStatus: 'complete',
    period: {
      periodStart: '2026-07-29',
      periodEnd: '2026-07-31',
      compareStart: '2026-07-26',
      compareEnd: '2026-07-28',
    },
    generatedAt: Date.parse('2026-08-01T00:00:00Z'),
    utcOffset: '+07:00',
  };
  return [
    ...buildReportMetricValueRows({ ...common, metrics: summary }),
    ...buildReportMetricValueRows({ ...common, metrics: dimensions }),
  ];
}

test('WooCommerce dimension metric keys are unique across all 45 fixed ranks', () => {
  const dimensions = dimensionMetrics();
  assert.equal(dimensions.length, 45);
  assert.equal(new Set(dimensions.map((metric) => metric.metricKey)).size, 45);
  assert.equal(new Set(dimensions.map((metric) => metric.stableMetricKey)).size, 3);
});

test('WooCommerce Lark rows retain PR #393 report_metric_key identity while metric_key is rank-lossless', () => {
  const dimensions = dimensionMetrics();
  const rows = metricRows(summaryMetrics(), dimensions);
  const productOne = rows.find((row) => row.dimension_type === 'product' && row.rank === 1);
  const productTwo = rows.find((row) => row.dimension_type === 'product' && row.rank === 2);

  assert.equal(
    productOne.report_metric_key,
    'report-1::woocommerce%3Adimension%3Aproduct%3Anet_sales_micros::product::rank%3A1',
  );
  assert.equal(
    productTwo.report_metric_key,
    'report-1::woocommerce%3Adimension%3Aproduct%3Anet_sales_micros::product::rank%3A2',
  );
  assert.notEqual(productOne.metric_key, productTwo.metric_key);
});

test('WooCommerce closeout integrity verifies all 13 summary plus 45 dimension values', () => {
  const summary = summaryMetrics();
  const dimensions = dimensionMetrics();
  const rows = metricRows(summary, dimensions);
  const larkMetrics = Object.fromEntries(rows.map((row) => [row.metric_key, row.current_value]));
  const result = assertReportRuntimeMetricIntegrity({
    payload: {
      metricPayload: summary,
      collections: { dimension_metrics: dimensions },
    },
    larkMetrics,
  });

  assert.equal(result.metricCount, 58);
  assert.equal(result.summaryMetricCount, 13);
  assert.equal(result.dimensionMetricCount, 45);
  assert.equal(result.mismatchCount, 0);
});

test('WooCommerce closeout integrity fails when one rank is missing or stale', () => {
  const summary = summaryMetrics();
  const dimensions = dimensionMetrics();
  const rows = metricRows(summary, dimensions);
  const larkMetrics = Object.fromEntries(rows.map((row) => [row.metric_key, row.current_value]));
  const rankKey = dimensions[0].metricKey;

  const missing = { ...larkMetrics };
  delete missing[rankKey];
  assert.throws(
    () => assertReportRuntimeMetricIntegrity({
      payload: { metricPayload: summary, collections: { dimension_metrics: dimensions } },
      larkMetrics: missing,
    }),
    (error) => error.code === 'REPORT_RUNTIME_WINDOW_REPAIR_METRIC_KEY_DRIFT',
  );

  const stale = { ...larkMetrics, [rankKey]: 123 };
  assert.throws(
    () => assertReportRuntimeMetricIntegrity({
      payload: { metricPayload: summary, collections: { dimension_metrics: dimensions } },
      larkMetrics: stale,
    }),
    (error) => error.code === 'REPORT_RUNTIME_WINDOW_REPAIR_METRIC_VALUE_DRIFT',
  );
});
