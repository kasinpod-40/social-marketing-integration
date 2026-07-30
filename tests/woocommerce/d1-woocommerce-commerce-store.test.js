import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';
import { D1WooCommerceCommerceStore } from '../../packages/connectors/src/woocommerce/d1-woocommerce-commerce-store.js';
import { D1WooCommerceReportSource } from '../../packages/connectors/src/woocommerce/d1-woocommerce-report-source.js';
import { generateWooCommerceCommerceReport } from '../../packages/application/src/commerce/generate-woocommerce-commerce-report.js';
import {
  WOOCOMMERCE_D1_TABLE_CONTRACTS,
  WOOCOMMERCE_DATASETS,
  normalizeWooCommerceDataset,
} from '../../packages/application/src/commerce/woocommerce-commerce-model.js';

const MIGRATION_URL = new URL(
  '../../docs/tasks/patches/woocommerce-commerce-migration.sql',
  import.meta.url,
);
const TABLE_COUNT = Object.keys(WOOCOMMERCE_D1_TABLE_CONTRACTS).length;
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
  d1.exec(`
    CREATE TABLE data_coverage_runs (
      coverage_run_id TEXT PRIMARY KEY,
      account_key TEXT NOT NULL,
      platform TEXT NOT NULL,
      dataset_key TEXT NOT NULL,
      status TEXT NOT NULL,
      scope_mode TEXT NOT NULL,
      period_start TEXT,
      period_end TEXT,
      source_watermark TEXT,
      revisable_until INTEGER,
      completed_at INTEGER,
      updated_at INTEGER NOT NULL
    );
  `);
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

async function normalizeOrders(records, overrides = {}) {
  return normalizeWooCommerceDataset({
    ...CONTEXT,
    ...overrides,
    dataset: WOOCOMMERCE_DATASETS.ORDERS,
    records,
    refundsByOrderId: new Map(),
  });
}

async function rebuild(store, normalized, overrides = {}) {
  return store.rebuildDerivedFacts({
    accountKey: 'chemistry_k',
    metricDates: normalized.impactedDates,
    customerAggregateKeys: normalized.impactedCustomers,
    syncRunId: overrides.syncRunId ?? CONTEXT.syncRunId,
    coverageRunId: overrides.coverageRunId ?? CONTEXT.coverageRunId,
    dataStatus: overrides.dataStatus ?? 'complete',
    now: overrides.now ?? NOW,
  });
}

function insertCoverage(d1, overrides = {}) {
  d1.database.prepare(`
    INSERT INTO data_coverage_runs (
      coverage_run_id, account_key, platform, dataset_key, status, scope_mode,
      source_watermark, revisable_until, completed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    overrides.coverageRunId ?? CONTEXT.coverageRunId,
    'chemistry_k',
    'woocommerce',
    'woocommerce_orders',
    overrides.status ?? 'complete',
    overrides.scopeMode ?? 'full_inventory',
    overrides.sourceWatermark ?? String(NOW),
    overrides.revisableUntil ?? NOW - 1,
    overrides.completedAt ?? NOW - 1,
    overrides.updatedAt ?? NOW - 1,
  );
}

test('Commerce Store validates schema, upserts idempotently and rebuilds exact daily facts', async () => {
  const { d1, store } = await fixture();
  try {
    assert.deepEqual(await store.assertSchemaReady(), { ready: true, tableCount: TABLE_COUNT });
    const normalized = await normalizeOrders([orderFixture()]);
    const first = await store.upsertRowsByTable(normalized.d1RowsByTable);
    const replay = await store.upsertRowsByTable(normalized.d1RowsByTable);
    assert.equal(first.totalRows, replay.totalRows);
    assert.equal(replay.tables.commerce_order_state.skipped, 1);
    await rebuild(store, normalized);

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
    assert.equal(daily.data_status, 'complete');
    const product = d1.database.prepare('SELECT * FROM commerce_product_daily_facts').get();
    assert.equal(product.product_key, 'woocommerce:chemistry_k:100:101');
    assert.equal(product.quantity_ordered, 2);
    assert.equal(product.net_sales_micros, 96_300_000);
    const customer = d1.database.prepare('SELECT * FROM commerce_customer_aggregates').get();
    assert.equal(customer.customer_aggregate_key, 'woocommerce:chemistry_k:registered:55:THB');
    assert.equal(customer.orders_count, 1);
    assert.equal(customer.currency, 'THB');
  } finally {
    d1.close();
  }
});

test('derived reads reserve the account bind and stay within D1 100-parameter queries', async () => {
  const observedBindCounts = [];
  const db = {
    prepare() {
      return {
        bind(...values) {
          observedBindCounts.push(values.length);
          if (values.length > 100) throw new Error('D1 bound parameter limit exceeded');
          return {
            async all() {
              return {
                results: values.slice(1).map((customerAggregateKey) => ({
                  customer_aggregate_key: customerAggregateKey,
                })),
              };
            },
          };
        },
      };
    },
    async batch() {
      return [];
    },
  };
  const store = new D1WooCommerceCommerceStore({ db });
  const customerAggregateKeys = Array.from(
    { length: 100 },
    (_, index) => `woocommerce:chemistry_k:registered:${String(index).padStart(3, '0')}:THB`,
  ).reverse();

  const result = await store.readDerivedRows({
    accountKey: 'chemistry_k',
    customerAggregateKeys,
  });

  assert.deepEqual(observedBindCounts, [100, 2]);
  assert.equal(result.customers.length, 100);
  assert.equal(result.customers[0].customer_aggregate_key, customerAggregateKeys.at(-1));
  assert.equal(result.customers.at(-1).customer_aggregate_key, customerAggregateKeys[0]);
});

test('newer Order revision wins, stale replay cannot roll back state or status history', async () => {
  const { d1, store } = await fixture();
  try {
    const first = await normalizeOrders([orderFixture()]);
    await store.upsertRowsByTable(first.d1RowsByTable);
    await rebuild(store, first);

    const changed = await normalizeOrders([orderFixture({
      status: 'cancelled',
      date_modified_gmt: '2026-07-26T03:01:00',
    })], {
      syncRunId: 'sync-woo-d1-late',
      coverageRunId: 'coverage-woo-orders-late',
      fetchedAt: NOW + 60_000,
      now: NOW + 60_000,
    });
    await store.upsertRowsByTable(changed.d1RowsByTable);
    await rebuild(store, changed, {
      syncRunId: 'sync-woo-d1-late',
      coverageRunId: 'coverage-woo-orders-late',
      now: NOW + 60_000,
    });

    const stale = await normalizeOrders([orderFixture({
      status: 'processing',
      date_modified_gmt: '2026-07-26T02:00:00',
    })], {
      syncRunId: 'sync-woo-d1-stale',
      coverageRunId: 'coverage-woo-orders-stale',
      fetchedAt: NOW + 120_000,
      now: NOW + 120_000,
    });
    const staleResult = await store.upsertRowsByTable(stale.d1RowsByTable);
    assert.equal(staleResult.tables.commerce_order_state.skipped, 1);
    await rebuild(store, stale, {
      syncRunId: 'sync-woo-d1-stale',
      coverageRunId: 'coverage-woo-orders-stale',
      now: NOW + 120_000,
    });

    const order = d1.database.prepare('SELECT * FROM commerce_order_state').get();
    assert.equal(order.status, 'cancelled');
    assert.equal(order.source_modified_at, Date.parse('2026-07-26T03:01:00Z'));
    const daily = d1.database.prepare('SELECT * FROM commerce_daily_sales_facts').get();
    assert.equal(daily.recognized_orders, 0);
    assert.equal(daily.recognized_revenue_micros, 0);
    assert.equal(daily.cancelled_orders, 1);
    assert.equal(d1.database.prepare('SELECT COUNT(*) AS count FROM commerce_order_status_observations').get().count, 2);
  } finally {
    d1.close();
  }
});

test('newer Order snapshot atomically replaces removed lines and removes stale Product daily rows', async () => {
  const { d1, store } = await fixture();
  try {
    const secondLine = {
      id: 8,
      product_id: 200,
      variation_id: 0,
      sku: 'COURSE-B',
      name: 'Course B',
      quantity: 1,
      subtotal: '50.000000',
      subtotal_tax: '3.500000',
      total: '50.000000',
      total_tax: '3.500000',
      taxes: [],
    };
    const first = await normalizeOrders([orderFixture({
      date_modified_gmt: '2026-07-26T01:00:00',
      line_items: [...orderFixture().line_items, secondLine],
    })]);
    await store.upsertRowsByTable(first.d1RowsByTable);
    await rebuild(store, first);
    assert.equal(d1.database.prepare('SELECT COUNT(*) AS count FROM commerce_order_line_facts').get().count, 2);
    assert.equal(d1.database.prepare('SELECT COUNT(*) AS count FROM commerce_product_daily_facts').get().count, 2);

    const changed = await normalizeOrders([orderFixture({
      date_modified_gmt: '2026-07-26T04:00:00',
      line_items: orderFixture().line_items,
    })], {
      syncRunId: 'sync-lines-replaced',
      coverageRunId: 'coverage-lines-replaced',
      fetchedAt: NOW + 180_000,
      now: NOW + 180_000,
    });
    await store.upsertRowsByTable(changed.d1RowsByTable);
    await rebuild(store, changed, {
      syncRunId: 'sync-lines-replaced',
      coverageRunId: 'coverage-lines-replaced',
      now: NOW + 180_000,
    });

    assert.equal(d1.database.prepare('SELECT COUNT(*) AS count FROM raw_commerce_order_items').get().count, 1);
    assert.equal(d1.database.prepare('SELECT COUNT(*) AS count FROM commerce_order_line_facts').get().count, 1);
    assert.equal(d1.database.prepare('SELECT COUNT(*) AS count FROM commerce_product_daily_facts').get().count, 1);
    assert.equal(
      d1.database.prepare('SELECT product_key FROM commerce_product_daily_facts').get().product_key,
      'woocommerce:chemistry_k:100:101',
    );
  } finally {
    d1.close();
  }
});

test('D1 report requires completed full Coverage before it can claim complete', async () => {
  const { d1, store, reportSource } = await fixture();
  try {
    const normalized = await normalizeOrders([orderFixture()]);
    await store.upsertRowsByTable(normalized.d1RowsByTable);
    await rebuild(store, normalized);

    const withoutCoverage = await generateWooCommerceCommerceReport({
      source: reportSource,
      accountKey: 'chemistry_k',
      periodStart: '2026-07-26',
      periodEnd: '2026-07-26',
      currency: 'THB',
      now: NOW,
    });
    assert.equal(withoutCoverage.data_status, 'partial');

    insertCoverage(d1);
    const report = await generateWooCommerceCommerceReport({
      source: reportSource,
      accountKey: 'chemistry_k',
      periodStart: '2026-07-26',
      periodEnd: '2026-07-26',
      currency: 'THB',
      now: NOW,
    });
    assert.equal(report.currency, 'THB');
    assert.equal(report.data_status, 'complete');
    assert.equal(report.totals.recognized_orders, 1);
    assert.equal(report.products[0].product_key, 'woocommerce:chemistry_k:100:101');
    assert.equal(report.payment_methods[0].payment_method_id, 'bacs');
    assert.equal(report.shipping_methods[0].shipping_method_id, 'flat_rate');
    assert.equal(report.coverage.scope_mode, 'full_inventory');
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
        && error.details.missingTableCount === TABLE_COUNT,
    );
  } finally {
    d1.close();
  }
});
