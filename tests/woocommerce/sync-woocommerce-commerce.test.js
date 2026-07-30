import test from 'node:test';
import assert from 'node:assert/strict';
import { TableSyncEngine } from '../../packages/sync-engine/src/table-sync-engine.js';
import { syncWooCommerceCommerce } from '../../packages/application/src/use-cases/sync-woocommerce-commerce.js';

const NOW = Date.parse('2026-07-26T03:00:00Z');

function orderFixture() {
  return {
    id: 42, number: '1042', status: 'processing', currency: 'THB',
    date_created_gmt: '2026-07-25T18:30:00', date_modified_gmt: '2026-07-26T01:00:00',
    customer_id: 55, payment_method: 'bacs', payment_method_title: 'Bank transfer',
    discount_total: '0.000000', discount_tax: '0.000000', shipping_total: '0.000000',
    shipping_tax: '0.000000', total_tax: '7.000000', total: '107.000000',
    total_refunded: '0.000000', shipping_lines: [], refunds: [],
    line_items: [{
      id: 7, product_id: 100, variation_id: 0, sku: 'COURSE', name: 'Course', quantity: 1,
      subtotal: '100.000000', subtotal_tax: '7.000000', total: '100.000000',
      total_tax: '7.000000', taxes: [],
    }],
  };
}

function productFixture() {
  return {
    id: 100, type: 'simple', sku: 'COURSE', name: 'Course', status: 'publish',
    catalog_visibility: 'visible', price: '107.000000', regular_price: '107.000000',
    sale_price: '', stock_status: 'instock', stock_quantity: 5, manage_stock: true,
    categories: [{ id: 4 }], attributes: [],
    date_created_gmt: '2026-07-01T00:00:00', date_modified_gmt: '2026-07-25T00:00:00',
  };
}

function customerFixture() {
  return {
    id: 55, email: 'private@example.test', first_name: 'Private', role: 'customer',
    orders_count: 1, total_spent: '107.000000',
    date_created_gmt: '2026-07-01T00:00:00', date_modified_gmt: '2026-07-25T00:00:00',
  };
}

function createDependencies(options = {}) {
  const events = [];
  const sourceRequests = [];
  const resources = new Map([
    ['orders', options.orders ?? [orderFixture()]],
    ['products', [productFixture()]],
    ['products/categories', []],
    ['customers', [options.customer ?? customerFixture()]],
    ['coupons', options.coupons ?? []],
  ]);
  const client = {
    async getStoreIdentity() {
      events.push('source:store');
      return {
        homeUrl: 'https://shop.example.test', wcVersion: '10.0.0', wpVersion: '6.8.0',
        timezone: 'Asia/Bangkok', currency: 'THB', numberOfDecimals: 2,
      };
    },
    async listPage(resource, input) {
      events.push(`source:${resource}:${input.page}`);
      sourceRequests.push(structuredClone({ resource, ...input }));
      const records = resources.get(resource) ?? [];
      return {
        resource, page: input.page, perPage: input.perPage,
        totalRows: records.length, totalPages: 1, nextPage: null,
        records, sourceWatermark: NOW,
      };
    },
    async listOrderRefunds() {
      throw new Error('refund source must not be called for an unrefunded order');
    },
    async listProductVariations() {
      throw new Error('variation source must not be called for a simple product');
    },
  };
  const phaseState = { value: null, completed: null };
  const resumableWorkStore = {
    async beginWork() { return { resumed: false, superseded: false, completed: false }; },
    async loadPhase() { return phaseState.value; },
    async assertCurrentGeneration() { return true; },
    async savePhase(input) {
      phaseState.value = { state: structuredClone(input.state), complete: input.complete };
      return phaseState.value;
    },
    async completeWork(input) { phaseState.completed = input.completion; return true; },
  };
  const customerRows = new Map();
  const commerceStore = {
    async assertSchemaReady() { events.push('d1:schema'); return { ready: true }; },
    async upsertRowsByTable(rows) {
      events.push('d1:upsert');
      for (const row of rows.commerce_customer_aggregates ?? []) {
        customerRows.set(row.customer_aggregate_key, structuredClone(row));
      }
      return { totalRows: Object.values(rows).reduce((sum, list) => sum + list.length, 0), tables: {} };
    },
    async rebuildDerivedFacts() {
      events.push('d1:derive');
      return { salesRows: 0, productRows: 0, customerRows: 0 };
    },
    async readDerivedRows(input) {
      events.push('d1:read-derived');
      return {
        sales: [],
        products: [],
        customers: (input.customerAggregateKeys ?? [])
          .map((key) => customerRows.get(key))
          .filter(Boolean),
      };
    },
  };
  const coverageRuns = [];
  const coverageEntities = [];
  const coverageStore = {
    async saveCoverageRun(row) { coverageRuns.push(row); return { status: 'written' }; },
    async saveCoverageEntities(rows) { coverageEntities.push(...rows); return []; },
  };
  const repository = {
    async prepareRows(_tableId, rows) { return rows.map((row) => ({ ...row })); },
    async listByFieldValues() { return []; },
    async createMany(tableId, rows) {
      events.push(`lark:create:${tableId}`);
      return { created: rows.length };
    },
    async updateMany(tableId, rows) {
      events.push(`lark:update:${tableId}`);
      return { updated: rows.length };
    },
  };
  const queued = [];
  const continuationQueue = {
    async send(message) { queued.push(message); },
  };
  return {
    events,
    sourceRequests,
    phaseState,
    coverageRuns,
    coverageEntities,
    queued,
    input: {
      client,
      commerceStore,
      coverageStore,
      resumableWorkStore,
      repository,
      syncEngine: new TableSyncEngine(),
      continuationQueue,
      tables: {
        rawCommerceStores: 'tbl_raw_store',
        rawCommerceOrders: 'tbl_raw_orders',
        rawCommerceOrderItems: 'tbl_raw_lines',
        rawCommerceProducts: 'tbl_raw_products',
        rawCommerceProductVariations: 'tbl_raw_variations',
        rawCommerceCategories: 'tbl_raw_categories',
        rawCommerceCustomers: 'tbl_raw_customers',
        rawCommerceCoupons: 'tbl_raw_coupons',
        rawCommerceRefunds: 'tbl_raw_refunds',
        mktCommerceOrders: 'tbl_orders',
        mktCommerceProducts: 'tbl_products',
        mktCommerceCustomers: 'tbl_customers',
        mktCommerceDaily: 'tbl_daily',
        mktCommerceProductDaily: 'tbl_product_daily',
      },
      type: 'woocommerce.commerce.sync',
      workKey: 'woocommerce:work-1',
      cursorKey: 'woocommerce:chemistry_k',
      syncRunId: 'sync-woo-1',
      generation: NOW,
      originalRequestedAt: NOW,
      customerKey: 'chemistry_k',
      accountKey: 'chemistry_k',
      reportingTimezone: 'Asia/Bangkok',
      defaultCurrency: 'THB',
      connectorEnabled: true,
      d1WriteEnabled: true,
      larkWriteEnabled: true,
      fullReconciliation: true,
      maxPagesPerInvocation: options.maxPagesPerInvocation ?? 20,
      now: () => NOW,
      assertLockActive: async () => events.push('lock'),
    },
  };
}

test('WooCommerce sync reuses TableSyncEngine and writes D1 before every Lark mutation', async () => {
  const fixture = createDependencies();
  const result = await syncWooCommerceCommerce(fixture.input);
  assert.equal(result.status, 'completed');
  assert.equal(result.reconciliation.scopeMode, 'full_inventory');
  assert.equal(result.reconciliation.failed, 0);
  assert.equal(fixture.coverageRuns.length, 6);
  assert.equal(fixture.coverageRuns.every((run) => ['complete', 'no_data_confirmed'].includes(run.status)), true);
  assert.equal(fixture.queued.length, 0);
  assert.ok(fixture.phaseState.completed);
  assert.equal(fixture.events.includes('lark:create:tbl_customers'), true);

  const writes = fixture.events.filter((event) => event === 'd1:upsert' || event.startsWith('lark:create:'));
  for (let index = 0; index < writes.length; index += 1) {
    if (writes[index].startsWith('lark:create:')) {
      assert.equal(writes.slice(0, index).includes('d1:upsert'), true);
    }
  }
});

test('bounded invocation queues a reference-only continuation without Source payload or credentials', async () => {
  const fixture = createDependencies({ maxPagesPerInvocation: 1 });
  const result = await syncWooCommerceCommerce(fixture.input);
  assert.equal(result.status, 'continuation_queued');
  assert.equal(fixture.queued.length, 1);
  const serialized = JSON.stringify(fixture.queued[0]);
  assert.equal(serialized.includes('consumer'), false);
  assert.equal(serialized.includes('shop.example.test'), false);
  assert.equal(serialized.includes('private@example.test'), false);
  assert.deepEqual(Object.keys(fixture.queued[0]).sort(), [
    'cursorKey', 'generation', 'originalRequestedAt', 'schemaVersion', 'syncRunId', 'type', 'workKey',
  ]);
});

test('bounded Order history persists a closed 2026 Provider window and report-range Coverage', async () => {
  const fixture = createDependencies();
  const result = await syncWooCommerceCommerce({
    ...fixture.input,
    orderCreatedAfter: '2026-01-01T00:00:00.000Z',
    orderCreatedBefore: '2026-07-26T03:00:00.000Z',
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.reconciliation.scopeMode, 'report_range');
  assert.deepEqual(result.reconciliation.sourceScope, {
    modifiedAfter: null,
    incrementalBoundary: null,
    orderCreatedAfter: Date.parse('2026-01-01T00:00:00.000Z'),
    orderCreatedBefore: Date.parse('2026-07-26T03:00:00.000Z'),
    reportingTimezone: 'Asia/Bangkok',
    defaultCurrency: 'THB',
  });

  const orders = fixture.sourceRequests.find((request) => request.resource === 'orders');
  assert.equal(orders.params.after, '2025-12-31T23:59:59.999Z');
  assert.equal(orders.params.before, '2026-07-26T03:00:00.000Z');
  assert.equal(orders.params.dates_are_gmt, true);
  const products = fixture.sourceRequests.find((request) => request.resource === 'products');
  assert.equal(products.params.after, undefined);
  assert.equal(products.params.before, undefined);

  const orderCoverage = fixture.coverageRuns.find(
    (run) => run.dataset_key === 'woocommerce_orders',
  );
  assert.equal(orderCoverage.scope_mode, 'report_range');
  assert.equal(orderCoverage.period_start, '2026-01-01');
  assert.equal(orderCoverage.period_end, '2026-07-26');
  assert.equal(fixture.coverageRuns
    .filter((run) => ['woocommerce_orders', 'woocommerce_customers', 'woocommerce_coupons']
      .includes(run.dataset_key))
    .every((run) => run.scope_mode === 'report_range'), true);
  assert.equal(fixture.coverageRuns
    .filter((run) => ['woocommerce_store', 'woocommerce_products', 'woocommerce_categories']
      .includes(run.dataset_key))
    .every((run) => run.scope_mode === 'full_inventory'), true);
});

test('bounded history excludes pre-2026 Customer and Coupon rows from storage', async () => {
  const oldCustomer = {
    ...customerFixture(),
    date_created_gmt: '2025-12-31T23:59:59',
  };
  const oldCoupon = {
    id: 9,
    code: 'OLD',
    discount_type: 'fixed_cart',
    amount: '100.000000',
    usage_count: 1,
    individual_use: false,
    free_shipping: false,
    date_created_gmt: '2025-01-01T00:00:00',
    date_modified_gmt: '2025-01-02T00:00:00',
  };
  const fixture = createDependencies({
    customer: oldCustomer,
    coupons: [oldCoupon],
  });
  const result = await syncWooCommerceCommerce({
    ...fixture.input,
    orderCreatedAfter: '2026-01-01T00:00:00.000Z',
    orderCreatedBefore: '2026-07-26T03:00:00.000Z',
  });
  assert.equal(result.status, 'completed');
  for (const dataset of ['woocommerce_customers', 'woocommerce_coupons']) {
    const coverage = fixture.coverageRuns.find((run) => run.dataset_key === dataset);
    assert.equal(coverage.status, 'no_data_confirmed');
    assert.equal(coverage.expected_entities, 0);
    assert.equal(coverage.observed_entities, 0);
    assert.equal(coverage.scope_mode, 'report_range');
  }
});

test('bounded history applies the exact 2026 floor to Order rows locally', async () => {
  const oldOrder = {
    ...orderFixture(),
    date_created_gmt: '2025-12-31T23:59:59.999Z',
  };
  const boundaryOrder = {
    ...orderFixture(),
    id: 43,
    number: '1043',
    date_created_gmt: '2026-01-01T00:00:00.000Z',
  };
  const fixture = createDependencies({ orders: [oldOrder, boundaryOrder] });
  const result = await syncWooCommerceCommerce({
    ...fixture.input,
    orderCreatedAfter: '2026-01-01T00:00:00.000Z',
    orderCreatedBefore: '2026-07-26T03:00:00.000Z',
  });
  assert.equal(result.status, 'completed');
  const coverage = fixture.coverageRuns.find(
    (run) => run.dataset_key === 'woocommerce_orders',
  );
  assert.equal(coverage.expected_entities, 1);
  assert.equal(coverage.observed_entities, 1);
  assert.equal(coverage.status, 'complete');
});

test('invalid bounded Order history fails before Source, D1 or Lark activity', async () => {
  const fixture = createDependencies();
  await assert.rejects(
    syncWooCommerceCommerce({
      ...fixture.input,
      orderCreatedAfter: '2026-01-02T00:00:00.000Z',
      orderCreatedBefore: '2026-01-01T00:00:00.000Z',
    }),
    /orderCreatedAfter must be earlier/u,
  );
  assert.deepEqual(fixture.events, []);
});

test('disabled runtime flags fail before schema, Source, D1 or Lark activity', async () => {
  const fixture = createDependencies();
  await assert.rejects(
    syncWooCommerceCommerce({ ...fixture.input, larkWriteEnabled: false }),
    (error) => error?.code === 'WOOCOMMERCE_PROCESSING_GATES_DISABLED',
  );
  assert.deepEqual(fixture.events, []);
});
