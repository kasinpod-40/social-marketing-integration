import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommerceDimensionMetricPayload } from '../../packages/application/src/reports/build-commerce-dimension-metric-payload.js';
import { createReportPlatformAdapterRegistry } from '../../packages/application/src/reports/report-platform-adapter-registry.js';
import { generateDashboardReportMaterialization } from '../../packages/application/src/use-cases/generate-dashboard-report-materialization.js';
import { writeDashboardMaterializationToLark } from '../../packages/application/src/use-cases/write-dashboard-materialization-to-lark.js';

const GENERATED_AT = Date.parse('2026-07-28T00:00:00Z');
const FORMULA_VERSION = 'woocommerce-commerce-v1';

test('Commerce dimensions use bounded fixed ranks and null placeholders to clear stale rows', () => {
  const rows = buildCommerceDimensionMetricPayload({
    platform: 'woocommerce',
    formulaVersion: FORMULA_VERSION,
    collections: {
      top_products: [{
        product_key: 'product-1',
        net_sales_micros: 0,
      }],
      payment_methods: [{
        payment_method_id: 'cod',
        payment_method_title: 'Cash on delivery',
        recognized_revenue_micros: 4_000_000,
      }],
      shipping_methods: [],
    },
  });

  assert.equal(rows.length, 45);
  assert.equal(Object.isFrozen(rows), true);

  const productOne = rows.find((row) => row.dimensionType === 'product' && row.rank === 1);
  assert.equal(productOne.dimensionValue, 'rank:1');
  assert.equal(productOne.current, 0);
  assert.equal(productOne.clientVisible, true);
  assert.equal(productOne.availabilityStatus, 'available');
  assert.equal(productOne.sourceDimensionValue, 'product-1');

  const productTwo = rows.find((row) => row.dimensionType === 'product' && row.rank === 2);
  assert.equal(productTwo.dimensionValue, 'rank:2');
  assert.equal(productTwo.current, null);
  assert.equal(productTwo.clientVisible, false);
  assert.equal(productTwo.availabilityStatus, 'not_observed');
  assert.equal(productTwo.sourceDimensionValue, null);

  const paymentOne = rows.find((row) => row.dimensionType === 'payment_method' && row.rank === 1);
  assert.match(paymentOne.displayName, /Cash on delivery/u);
  assert.equal(paymentOne.current, 4_000_000);

  assert.equal(rows.filter((row) => row.dimensionType === 'product').length, 5);
  assert.equal(rows.filter((row) => row.dimensionType === 'payment_method').length, 20);
  assert.equal(rows.filter((row) => row.dimensionType === 'shipping_method').length, 20);
});

test('Commerce materialization retains raw collections and adds generic dimension metrics', async () => {
  const writes = [];
  const registry = createReportPlatformAdapterRegistry({
    adapters: {
      woocommerce: {
        async load({ periodStart }) {
          const current = periodStart === '2026-07-25';
          return commerceSource({
            netSales: current ? 9_000_000 : 4_000_000,
            productRows: current ? [{
              product_key: 'product-1',
              net_sales_micros: 9_000_000,
            }] : [],
          });
        },
      },
    },
  });

  const result = await generateDashboardReportMaterialization({
    registry,
    materializationStore: {
      async saveReportMaterialization(row) {
        writes.push(row);
        return { status: 'written' };
      },
    },
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    platformScope: 'woocommerce',
    reportSettingKey: 'integration_workspace:woocommerce:rolling:3d',
    periodKind: 'rolling_days',
    windowDays: 3,
    periodEnd: '2026-07-27',
    comparisonMode: 'previous_period',
    generatedAt: GENERATED_AT,
  });

  const payload = result.materialization.payload;
  assert.equal(payload.collections.top_products[0].product_key, 'product-1');
  assert.equal(payload.collections.dimension_metrics.length, 45);
  assert.equal(
    payload.collections.dimension_metrics.find(
      (row) => row.dimensionType === 'product' && row.rank === 1,
    ).current,
    9_000_000,
  );
  assert.equal(JSON.parse(writes[0].payload_json).collections.dimension_metrics.length, 45);
});

test('Lark writer upserts 13 summary plus 45 dimension rows without ranking tables', async () => {
  const dimensionMetrics = buildCommerceDimensionMetricPayload({
    platform: 'woocommerce',
    formulaVersion: FORMULA_VERSION,
    collections: {
      top_products: [{
        product_key: 'product-1',
        net_sales_micros: 0,
      }],
      payment_methods: [],
      shipping_methods: [],
    },
  });
  const planned = [];
  const executed = [];
  const syncEngine = {
    async planByKey(input) {
      const plan = Object.freeze({ ...input });
      planned.push(plan);
      return plan;
    },
    async executePlan(plan) {
      executed.push(plan);
      return Object.freeze({ created: plan.rows.length, updated: 0, skipped: 0 });
    },
  };
  const result = await writeDashboardMaterializationToLark({
    reportId: 'report-1',
    customerProfile: 'integration_workspace',
    reader: {
      async readById() {
        return {
          row: {
            report_id: 'report-1',
            report_setting_key: 'integration_workspace:woocommerce:rolling:3d',
            customer_key: 'chemistry_k',
            account_key: 'chemistry_k',
            report_type: 'dashboard_performance_report',
            period_kind: 'rolling_days',
            window_days: 3,
            period_start: '2026-07-25',
            period_end: '2026-07-27',
            compare_start: '2026-07-22',
            compare_end: '2026-07-24',
            data_status: 'complete',
            coverage_rate: 1,
            formula_version: FORMULA_VERSION,
            generated_at: GENERATED_AT,
          },
          payload: {
            platformScope: 'woocommerce',
            capability: 'commerce',
            period: {
              periodKind: 'rolling_days',
              windowDays: 3,
              periodStart: '2026-07-25',
              periodEnd: '2026-07-27',
              comparisonMode: 'previous_period',
              compareStart: '2026-07-22',
              compareEnd: '2026-07-24',
            },
            dataStatus: 'complete',
            coverageRate: 1,
            metricPayload: summaryMetrics(),
            collections: { dimension_metrics: dimensionMetrics },
            topContent: [],
            topAds: [],
          },
        };
      },
    },
    repository: {},
    syncEngine,
    tables: {
      mktReportSnapshots: 'snapshots',
      mktReportMetricValues: 'metrics',
    },
  });

  assert.equal(result.rows.metrics, 58);
  assert.equal(result.rows.topContent, 0);
  assert.equal(result.rows.topAds, 0);
  assert.equal(planned.length, 2);
  assert.equal(executed.length, 2);

  const metricPlan = planned.find((plan) => plan.tableId === 'metrics');
  assert.equal(metricPlan.rows.length, 58);
  const dimensionRows = metricPlan.rows.filter((row) => row.dimension_type !== 'summary');
  assert.equal(dimensionRows.length, 45);

  const firstProduct = dimensionRows.find(
    (row) => row.dimension_type === 'product' && row.rank === 1,
  );
  assert.equal(
    firstProduct.report_metric_key,
    'report-1::woocommerce%3Adimension%3Aproduct%3Anet_sales_micros::product::rank%3A1',
  );
  assert.equal(firstProduct.dimension_value, 'rank:1');
  assert.equal(firstProduct.current_value, 0);
  assert.equal(firstProduct.client_visible, true);
  assert.equal(firstProduct.window_days, '3');

  const clearedProduct = dimensionRows.find(
    (row) => row.dimension_type === 'product' && row.rank === 2,
  );
  assert.equal(clearedProduct.current_value, null);
  assert.equal(clearedProduct.compare_value, null);
  assert.equal(clearedProduct.client_visible, false);
  assert.equal(clearedProduct.availability_status, 'not_observed');
});

function commerceSource(input = {}) {
  return Object.freeze({
    currency: 'THB',
    data_status: 'complete',
    source_watermark: 'wm-commerce',
    coverage: { status: 'complete' },
    totals: {
      net_sales_micros: input.netSales ?? 0,
      gross_sales_micros: input.netSales ?? 0,
      recognized_revenue_micros: input.netSales ?? 0,
      refund_micros: 0,
      discount_micros: 0,
      shipping_micros: 0,
      tax_micros: 0,
      recognized_orders: 1,
      provisional_orders: 0,
      cancelled_orders: 0,
      failed_orders: 0,
      refunded_orders: 0,
      quantity_total: 1,
    },
    products: input.productRows ?? [],
    payment_methods: [],
    shipping_methods: [],
  });
}

function summaryMetrics() {
  const fields = [
    ['net_sales_micros', 'Net sales', 'currency'],
    ['gross_sales_micros', 'Gross sales', 'currency'],
    ['recognized_revenue_micros', 'Recognized revenue', 'currency'],
    ['refund_micros', 'Refunds', 'currency'],
    ['discount_micros', 'Discounts', 'currency'],
    ['shipping_micros', 'Shipping', 'currency'],
    ['tax_micros', 'Tax', 'currency'],
    ['recognized_orders', 'Recognized orders', 'count'],
    ['provisional_orders', 'Provisional orders', 'count'],
    ['cancelled_orders', 'Cancelled orders', 'count'],
    ['failed_orders', 'Failed orders', 'count'],
    ['refunded_orders', 'Refunded orders', 'count'],
    ['quantity_total', 'Quantity', 'count'],
  ];
  return Object.fromEntries(fields.map(([key, displayName, unit], index) => {
    const metricKey = `woocommerce:${key}`;
    return [metricKey, {
      metricKey,
      displayName,
      unit,
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
