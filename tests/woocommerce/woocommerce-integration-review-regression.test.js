import test from 'node:test';
import assert from 'node:assert/strict';
import { TableSyncEngine } from '../../packages/sync-engine/src/table-sync-engine.js';
import { syncWooCommerceCommerce } from '../../packages/application/src/use-cases/sync-woocommerce-commerce.js';
import { D1WooCommerceReportSource } from '../../packages/connectors/src/woocommerce/d1-woocommerce-report-source.js';
import { generateWooCommerceCommerceReport } from '../../packages/application/src/commerce/generate-woocommerce-commerce-report.js';

const NOW = Date.parse('2026-07-26T03:00:00Z');

function durableFixture() {
  const phaseState = { value: null, completed: null };
  const queued = [];
  const captured = { pages: [], rows: {} };
  const customerRows = new Map();
  const resources = new Map([
    ['orders', [{
      id: 42,
      number: '1042',
      status: 'processing',
      currency: 'THB',
      date_created_gmt: '2026-07-25T18:30:00',
      date_modified_gmt: '2026-07-26T01:00:00',
      customer_id: 55,
      discount_total: '0.000000',
      discount_tax: '0.000000',
      shipping_total: '0.000000',
      shipping_tax: '0.000000',
      total_tax: '7.000000',
      total: '107.000000',
      total_refunded: '0.000000',
      shipping_lines: [],
      refunds: [],
      line_items: [{
        id: 7,
        product_id: 100,
        variation_id: 0,
        sku: 'COURSE',
        name: 'Course',
        quantity: 1,
        subtotal: '100.000000',
        subtotal_tax: '7.000000',
        total: '100.000000',
        total_tax: '7.000000',
        taxes: [],
      }],
    }]],
    ['products', [{
      id: 100,
      type: 'simple',
      sku: 'COURSE',
      name: 'Course',
      status: 'publish',
      catalog_visibility: 'visible',
      price: '107.000000',
      regular_price: '107.000000',
      sale_price: '',
      stock_status: 'instock',
      stock_quantity: 5,
      manage_stock: true,
      categories: [],
      attributes: [],
      date_created_gmt: '2026-07-01T00:00:00',
      date_modified_gmt: '2026-07-25T00:00:00',
    }]],
    ['products/categories', []],
    ['customers', [{
      id: 55,
      role: 'customer',
      orders_count: 1,
      total_spent: '107.000000',
      date_created_gmt: '2026-07-01T00:00:00',
      date_modified_gmt: '2026-07-25T00:00:00',
    }]],
    ['coupons', []],
  ]);
  const client = {
    async getStoreIdentity() {
      return {
        homeUrl: 'https://shop.example.test',
        wcVersion: '10.0.0',
        wpVersion: '6.8.0',
        timezone: 'Asia/Bangkok',
        currency: 'THB',
        numberOfDecimals: 2,
      };
    },
    async listPage(resource, input) {
      captured.pages.push({ resource, input: structuredClone(input) });
      const records = resources.get(resource) ?? [];
      return {
        resource,
        page: input.page,
        perPage: input.perPage,
        totalRows: records.length,
        totalPages: 1,
        nextPage: null,
        records,
        sourceWatermark: NOW,
      };
    },
    async listOrderRefunds() { return { records: [], nextPage: null }; },
    async listProductVariations() { return { records: [], nextPage: null }; },
  };
  const resumableWorkStore = {
    async beginWork() { return { superseded: false, completed: false }; },
    async loadPhase() { return phaseState.value; },
    async assertCurrentGeneration() { return true; },
    async savePhase(input) {
      phaseState.value = { state: structuredClone(input.state), complete: input.complete };
      return phaseState.value;
    },
    async completeWork(input) { phaseState.completed = input.completion; },
  };
  const commerceStore = {
    async assertSchemaReady() { return { ready: true }; },
    async upsertRowsByTable(rows) {
      for (const [table, values] of Object.entries(rows)) {
        captured.rows[table] ??= [];
        captured.rows[table].push(...structuredClone(values));
      }
      for (const row of rows.commerce_customer_aggregates ?? []) {
        customerRows.set(row.customer_aggregate_key, structuredClone(row));
      }
      return { totalRows: Object.values(rows).reduce((total, values) => total + values.length, 0), tables: {} };
    },
    async rebuildDerivedFacts() { return { salesRows: 0, productRows: 0, customerRows: 0 }; },
    async readDerivedRows(input) {
      return {
        sales: [],
        products: [],
        customers: (input.customerAggregateKeys ?? [])
          .map((key) => customerRows.get(key))
          .filter(Boolean),
      };
    },
    async finalizeOrderDerivedFacts() { return { salesRows: 0, productRows: 0 }; },
  };
  const repository = {
    async prepareRows(_tableId, rows) { return rows.map((row) => ({ ...row })); },
    async listByFieldValues() { return []; },
    async createMany(_tableId, rows) { return { created: rows.length }; },
    async updateMany(_tableId, rows) { return { updated: rows.length }; },
  };
  const common = {
    client,
    commerceStore,
    coverageStore: {
      async saveCoverageRun() { return { status: 'written' }; },
      async saveCoverageEntities() { return []; },
    },
    resumableWorkStore,
    repository,
    syncEngine: new TableSyncEngine(),
    continuationQueue: { async send(message) { queued.push(message); } },
    tables: {
      rawCommerceStores: 'raw-store',
      rawCommerceOrders: 'raw-orders',
      rawCommerceOrderItems: 'raw-order-items',
      rawCommerceProducts: 'raw-products',
      rawCommerceProductVariations: 'raw-variations',
      rawCommerceCategories: 'raw-categories',
      rawCommerceCustomers: 'raw-customers',
      rawCommerceCoupons: 'raw-coupons',
      rawCommerceRefunds: 'raw-refunds',
      mktCommerceOrders: 'orders',
      mktCommerceProducts: 'products',
      mktCommerceCustomers: 'customers',
      mktCommerceDaily: 'daily',
      mktCommerceProductDaily: 'product-daily',
    },
    type: 'woocommerce.commerce.sync',
    workKey: 'woocommerce:durable-scope',
    cursorKey: 'woocommerce:chemistry_k',
    syncRunId: 'sync-durable-scope',
    generation: NOW,
    originalRequestedAt: NOW,
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    connectorEnabled: true,
    d1WriteEnabled: true,
    larkWriteEnabled: true,
    fullReconciliation: false,
    modifiedAfter: '2026-07-20T00:00:00Z',
    overlapSeconds: 300,
    reportingTimezone: 'UTC',
    defaultCurrency: null,
    pageSize: 77,
    maxPagesPerInvocation: 1,
    now: () => NOW,
  };
  return { common, phaseState, queued, captured };
}

test('continuation reuses durable Source scope and Store currency/timezone despite changed runtime inputs', async () => {
  const fixture = durableFixture();
  const first = await syncWooCommerceCommerce(fixture.common);
  assert.equal(first.status, 'continuation_queued');
  assert.equal(fixture.phaseState.value.state.scope.pageSize, 77);
  assert.equal(fixture.phaseState.value.state.storeContext.defaultCurrency, 'THB');
  assert.equal(fixture.phaseState.value.state.storeContext.reportingTimezone, 'Asia/Bangkok');

  const second = await syncWooCommerceCommerce({
    ...fixture.common,
    modifiedAfter: '2026-07-26T02:59:00Z',
    overlapSeconds: 0,
    reportingTimezone: 'UTC',
    defaultCurrency: 'USD',
    pageSize: 10,
    maxPagesPerInvocation: 20,
  });
  assert.equal(second.status, 'completed');
  const orderRequest = fixture.captured.pages.find((entry) => entry.resource === 'orders');
  assert.equal(orderRequest.input.perPage, 77);
  assert.equal(orderRequest.input.params.modified_after, '2026-07-19T23:55:00.000Z');
  assert.equal(fixture.captured.rows.commerce_order_state[0].metric_date, '2026-07-26');
  assert.equal(fixture.captured.rows.raw_commerce_products[0].currency, 'THB');
  assert.equal(fixture.captured.rows.raw_commerce_customers[0].currency, 'THB');
  assert.equal(second.reconciliation.sourceScope.defaultCurrency, 'THB');
  assert.equal(second.reconciliation.sourceScope.reportingTimezone, 'Asia/Bangkok');
});

function reportDb({ productCount = 0, orderCount = 0 } = {}) {
  return {
    prepare(sql) {
      return {
        bind() { return this; },
        async all() {
          if (sql.includes('FROM commerce_product_daily_facts')) {
            return { results: Array.from({ length: productCount }, (_, index) => ({
              product_key: `product-${index}`,
              quantity_ordered: 1,
              gross_sales_micros: 1,
              discount_micros: 0,
              refund_micros: 0,
              net_sales_micros: 1,
              recognized_orders: 1,
              data_status: 'complete',
              source_revision: String(NOW),
            })) };
          }
          if (sql.includes('FROM commerce_order_state')) {
            return { results: Array.from({ length: orderCount }, (_, index) => ({
              order_key: `order-${index}`,
              metric_date: '2026-07-26',
              status: 'processing',
              status_class: 'recognized',
              payment_method_id: 'bacs',
              payment_method_title: 'Bank transfer',
              shipping_method_ids_json: '[]',
              shipping_method_titles_json: '[]',
              recognized_revenue_micros: 1,
              refund_micros: 0,
            })) };
          }
          if (sql.includes('FROM sync_coverage_runs')) return { results: [] };
          return { results: [] };
        },
      };
    },
  };
}

test('report source reads limit plus one: exact Order bound passes and Product overflow fails closed', async () => {
  const exact = new D1WooCommerceReportSource({ db: reportDb({ orderCount: 20_000 }) });
  const exactRange = await exact.loadRange({
    accountKey: 'chemistry_k',
    periodStart: '2026-07-26',
    periodEnd: '2026-07-26',
    currency: 'THB',
  });
  assert.equal(exactRange.orders.length, 20_000);

  const overflow = new D1WooCommerceReportSource({ db: reportDb({ productCount: 5_001 }) });
  await assert.rejects(
    overflow.loadRange({
      accountKey: 'chemistry_k',
      periodStart: '2026-07-26',
      periodEnd: '2026-07-26',
      currency: 'THB',
    }),
    (error) => error?.code === 'WOOCOMMERCE_REPORT_SOURCE_TOO_LARGE'
      && error.details.entity === 'product',
  );
});

test('empty report is partial without Coverage and no_data_confirmed only with full Coverage proof', async () => {
  const base = {
    accountKey: 'chemistry_k',
    currency: 'THB',
    periodStart: '2026-07-26',
    periodEnd: '2026-07-26',
    daily: [],
    products: [],
    orders: [],
  };
  const partial = await generateWooCommerceCommerceReport({
    source: { async loadRange() { return { ...base, coverage: null }; } },
    accountKey: 'chemistry_k',
    periodStart: '2026-07-26',
    periodEnd: '2026-07-26',
    currency: 'THB',
    now: NOW,
  });
  assert.equal(partial.data_status, 'partial');

  const confirmed = await generateWooCommerceCommerceReport({
    source: {
      async loadRange() {
        return {
          ...base,
          coverage: {
            coverage_run_id: 'coverage-empty',
            status: 'no_data_confirmed',
            scope_mode: 'full_inventory',
            source_watermark: String(NOW),
            revisable_until: NOW - 1,
            completed_at: NOW - 1,
          },
        };
      },
    },
    accountKey: 'chemistry_k',
    periodStart: '2026-07-26',
    periodEnd: '2026-07-26',
    currency: 'THB',
    now: NOW,
  });
  assert.equal(confirmed.data_status, 'no_data_confirmed');
});
