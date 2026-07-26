import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';
import { D1WooCommerceCommerceStore } from '../../packages/connectors/src/woocommerce/d1-woocommerce-commerce-store.js';
import { D1WooCommerceReportSource } from '../../packages/connectors/src/woocommerce/d1-woocommerce-report-source.js';
import { generateWooCommerceCommerceReport } from '../../packages/application/src/commerce/generate-woocommerce-commerce-report.js';
import {
  WOOCOMMERCE_DATASETS,
  normalizeWooCommerceDataset,
} from '../../packages/application/src/commerce/woocommerce-commerce-model.js';

const MIGRATION_URL = new URL(
  '../../docs/tasks/patches/woocommerce-commerce-migration.sql',
  import.meta.url,
);
const NOW = Date.parse('2026-07-26T03:00:00Z');
const CONTEXT = Object.freeze({
  customerKey: 'chemistry_k',
  accountKey: 'chemistry_k',
  reportingTimezone: 'Asia/Bangkok',
  defaultCurrency: 'THB',
  syncRunId: 'sync-woo-d1',
  coverageRunId: 'coverage-woo-orders',
  fetchedAt: NOW,
  now: NOW,
});

async function fixture() {
  const d1 = createSqliteD1();
  d1.exec(await readFile(MIGRATION_URL, 'utf8'));
  return {
    d1,
    store: new D1WooCommerceCommerceStore({ db: d1 }),
    reportSource: new D1WooCommerceReportSource({ db: d1 }),
  };
}

function orderFixture(overrides = {}) {
  return {
    id: 42,
    number: '1042',
    status: 'processing',
    currency: 'THB',
    date_created_gmt: '2026-07-25T18:30:00',
    date_modified_gmt: '2026-07-26T01:00:00',
    customer_id: 55,
    payment_method: 'bacs',
    payment_method_title: 'Bank transfer',
    discount_total: '10.000000',
    discount_tax: '0.700000',
    shipping_total: '5.000000',
    shipping_tax: '0.350000',
    total_tax: '6.650000',
    total: '101.650000',
    total_refunded: '0.000000',
    shipping_lines: [{ method_id: 'flat_rate', method_title: 'Flat rate' }],
    line_items: [{
      id: 7,
      product_id: 100,
      variation_id: 101,
      sku: 'COURSE-A',
      name: 'Course A',
      quantity: 2,
      subtotal: '100.000000',
      subtotal_tax: '7.000000',
      total: '90.000000',
      total_tax: '6.300000',
      taxes: [],
    }],
    refunds: [],
    ...overrides,
  };
}

test('Commerce Store validates proposed schema, upserts idempotently and rebuilds daily facts', async () => {
  const { d1, store } = await fixture();
  try {
    assert.deepEqual(await store.assertSchemaReady(), { ready: true, tableCount: 15 });
    const normalized = await normalizeWooCommerceDataset({
      ...CONTEXT,
      dataset: WOOCOMMERCE_DATASETS.ORDERS,
      records: [orderFixture()],
      refundsByOrderId: new Map(),
    });
    await store.upsertRowsByTable(normalized.d1RowsByTable);
    await store.upsertRowsByTable(normalized.d1RowsByTable);
    await store.rebuildDerivedFacts({
      accountKey: 'chemistry_k',
      metricDates: normalized.impactedDates,
      customerAggregateKeys: normalized.impactedCustomers,
      syncRunId: CONTEXT.syncRunId,
      coverageRunId: CONTEXT.coverageRunId,
      now: NOW,
    });

    assert.equal(d1.database.prepare('SELECT COUNT(*) AS count FROM commerce_order_state').get().count, 1);
    assert.equal(d1.database.prepare('SELECT COUNT(*) AS count FROM commerce_order_line_facts').get().count, 1);
    assert.equal(d1.database.prepare('SELECT COUNT(*) AS count FROM commerce_order_status_observations').get().count, 1);
    const daily = d1.database.prepare('SELECT * FROM commerce_daily_sales_facts').get();
    assert.equal(daily.metric_date, '2026-07-26');
    assert.equal(daily.currency, 'THB');
    assert.equal(daily.gross_sales_micros, 107_000_000);
    assert.equal(daily.discount_micros, 10_700_000);
    assert.equal(daily.net_sales_micros, 96_300_000);
    assert.equal(daily.recognized_revenue_micros, 101_650_000);
    assert.equal(daily.recognized_orders, 1);
    const product = d1.database.prepare('SELECT * FROM commerce_product_daily_facts').get();
    assert.equal(product.product_key, 'woocommerce:chemistry_k:100:101');
    assert.equal(product.quantity_ordered, 2);
    assert.equal(product.net_sales_micros, 96_300_000);
    const customer = d1.database.prepare('SELECT * FROM commerce_customer_aggregates').get();
    assert.equal(customer.customer_aggregate_key, 'woocommerce:chemistry_k:registered:55:THB');
    assert.equal(customer.orders_count, 1);
  } finally {
    d1.close();
  }
});

test('late status change revises original local date and preserves status history', async () => {
  const { d1, store } = await fixture();
  try {
    const first = await normalizeWooCommerceDataset({
      ...CONTEXT,
      dataset: WOOCOMMERCE_DATASETS.ORDERS,
      records: [orderFixture()],
      refundsByOrderId: new Map(),
    });
    await store.upsertRowsByTable(first.d1RowsByTable);
    await store.rebuildDerivedFacts({
      accountKey: 'chemistry_k', metricDates: first.impactedDates,
      customerAggregateKeys: first.impactedCustomers,
      syncRunId: CONTEXT.syncRunId, coverageRunId: CONTEXT.coverageRunId, now: NOW,
    });

    const changed = await normalizeWooCommerceDataset({
      ...CONTEXT,
      syncRunId: 'sync-woo-d1-late',
      coverageRunId: 'coverage-woo-orders-late',
      fetchedAt: NOW + 60_000,
      now: NOW + 60_000,
      dataset: WOOCOMMERCE_DATASETS.ORDERS,
      records: [orderFixture({
        status: 'cancelled',
        date_modified_gmt: '2026-07-26T03:01:00',
      })],
      refundsByOrderId: new Map(),
    });
    await store.upsertRowsByTable(changed.d1RowsByTable);
    await store.rebuildDerivedFacts({
      accountKey: 'chemistry_k', metricDates: changed.impactedDates,
      customerAggregateKeys: changed.impactedCustomers,
      syncRunId: 'sync-woo-d1-late', coverageRunId: 'coverage-woo-orders-late', now: NOW + 60_000,
    });

    const daily = d1.database.prepare('SELECT * FROM commerce_daily_sales_facts').get();
    assert.equal(daily.metric_date, '2026-07-26');
    assert.equal(daily.recognized_orders, 0);
    assert.equal(daily.recognized_revenue_micros, 0);
    assert.equal(daily.cancelled_orders, 1);
    assert.equal(d1.database.prepare('SELECT COUNT(*) AS count FROM commerce_order_status_observations').get().count, 2);
  } finally {
    d1.close();
  }
});

test('D1 report source and generator preserve currency and summarize products/payment/shipping', async () => {
  const { d1, store, reportSource } = await fixture();
  try {
    const normalized = await normalizeWooCommerceDataset({
      ...CONTEXT,
      dataset: WOOCOMMERCE_DATASETS.ORDERS,
      records: [orderFixture()],
      refundsByOrderId: new Map(),
    });
    await store.upsertRowsByTable(normalized.d1RowsByTable);
    await store.rebuildDerivedFacts({
      accountKey: 'chemistry_k', metricDates: normalized.impactedDates,
      customerAggregateKeys: normalized.impactedCustomers,
      syncRunId: CONTEXT.syncRunId, coverageRunId: CONTEXT.coverageRunId, now: NOW,
    });

    const report = await generateWooCommerceCommerceReport({
      source: reportSource,
      accountKey: 'chemistry_k',
      periodStart: '2026-07-26',
      periodEnd: '2026-07-26',
      currency: 'THB',
    });
    assert.equal(report.currency, 'THB');
    assert.equal(report.data_status, 'complete');
    assert.equal(report.totals.recognized_orders, 1);
    assert.equal(report.products[0].product_key, 'woocommerce:chemistry_k:100:101');
    assert.equal(report.payment_methods[0].payment_method_id, 'bacs');
    assert.equal(report.shipping_methods[0].shipping_method_id, 'flat_rate');
  } finally {
    d1.close();
  }
});

test('Commerce Store fails closed when the additive migration is absent', async () => {
  const d1 = createSqliteD1();
  try {
    const store = new D1WooCommerceCommerceStore({ db: d1 });
    await assert.rejects(
      store.assertSchemaReady(),
      (error) => error?.code === 'WOOCOMMERCE_D1_SCHEMA_NOT_READY'
        && error.details.missingTableCount === 15,
    );
  } finally {
    d1.close();
  }
});
