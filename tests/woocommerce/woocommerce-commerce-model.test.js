import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WOOCOMMERCE_DATASETS,
  calculateWooCommerceReport,
  classifyWooCommerceOrderStatus,
  createWooCommerceIncrementalBoundary,
  normalizeWooCommerceDataset,
  parseWooCommerceMoneyMicros,
} from '../../packages/application/src/commerce/woocommerce-commerce-model.js';

const CONTEXT = Object.freeze({
  customerKey: 'chemistry_k',
  accountKey: 'chemistry_k',
  reportingTimezone: 'Asia/Bangkok',
  defaultCurrency: 'THB',
  syncRunId: 'sync-woo-1',
  coverageRunId: 'coverage-woo-orders',
  fetchedAt: Date.parse('2026-07-26T03:00:00Z'),
  now: Date.parse('2026-07-26T03:00:00Z'),
});

function orderFixture(overrides = {}) {
  return {
    id: 42,
    number: '1042',
    status: 'processing',
    currency: 'THB',
    date_created_gmt: '2026-07-25T18:30:00',
    date_modified_gmt: '2026-07-26T01:00:00',
    customer_id: 0,
    payment_method: 'bacs',
    payment_method_title: 'Bank transfer',
    discount_total: '10.000000',
    discount_tax: '0.700000',
    shipping_total: '5.000000',
    shipping_tax: '0.350000',
    total_tax: '6.650000',
    total: '101.650000',
    total_refunded: '21.400000',
    billing: {
      first_name: 'Private', last_name: 'Person', email: 'private@example.test',
      phone: '0800000000', address_1: 'secret street', postcode: '10000',
    },
    shipping: { first_name: 'Private', address_1: 'secret shipping' },
    customer_ip_address: '127.0.0.1',
    customer_user_agent: 'private-agent',
    customer_note: 'private note',
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
      taxes: [{ id: 1, total: '6.300000', subtotal: '7.000000' }],
      meta_data: [{ key: 'private', value: 'secret' }],
    }],
    refunds: [{ id: 900 }],
    ...overrides,
  };
}

const REFUND = Object.freeze({
  id: 900,
  date_created_gmt: '2026-07-26T01:15:00',
  total: '-21.400000',
  reason: 'private reason must not be stored',
  refunded_by: 5,
  line_items: [{ id: 7, quantity: -1, refund_total: '-20.000000', refund_tax: '-1.400000' }],
});

test('money micros parsing is exact and status classes preserve failed/cancelled/provisional', () => {
  assert.equal(parseWooCommerceMoneyMicros('123.456789'), 123_456_789);
  assert.equal(parseWooCommerceMoneyMicros('-0.000001'), -1);
  assert.equal(classifyWooCommerceOrderStatus('completed'), 'recognized');
  assert.equal(classifyWooCommerceOrderStatus('on-hold'), 'provisional');
  assert.equal(classifyWooCommerceOrderStatus('cancelled'), 'cancelled');
  assert.equal(classifyWooCommerceOrderStatus('failed'), 'failed');
});

test('Order normalization minimizes PII, keeps stable keys and applies partial refunds exactly', async () => {
  const refundsByOrderId = new Map([[42, [REFUND]]]);
  const output = await normalizeWooCommerceDataset({
    ...CONTEXT,
    dataset: WOOCOMMERCE_DATASETS.ORDERS,
    records: [orderFixture()],
    refundsByOrderId,
  });
  const raw = output.raw.orders[0];
  const order = output.canonical.orders[0];
  const line = output.canonical.orderLines[0];
  const refund = output.raw.refunds[0];

  assert.equal(raw.raw_order_key, 'woocommerce:chemistry_k:42');
  assert.equal(order.order_key, 'woocommerce:chemistry_k:42');
  assert.equal(order.metric_date, '2026-07-26');
  assert.equal(order.customer_type, 'guest');
  assert.equal(order.external_customer_id, null);
  assert.equal(order.gross_sales_micros, 107_000_000);
  assert.equal(order.discount_micros, 10_700_000);
  assert.equal(order.refund_micros, 21_400_000);
  assert.equal(order.net_sales_micros, 74_900_000);
  assert.equal(order.recognized_revenue_micros, 80_250_000);
  assert.equal(line.product_key, 'woocommerce:chemistry_k:100:101');
  assert.equal(line.refunded_quantity, 1);
  assert.equal(line.refund_micros, 21_400_000);
  assert.equal(refund.reason_present, 1);
  assert.deepEqual(output.impactedCustomers, []);
  assert.deepEqual(output.impactedDates, ['2026-07-26']);

  const serialized = JSON.stringify(output);
  for (const forbidden of [
    'private@example.test', '0800000000', 'secret street', 'secret shipping',
    '127.0.0.1', 'private-agent', 'private note', 'private reason must not be stored',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('registered customer aggregates are isolated by currency and never derive identity from email', async () => {
  const output = await normalizeWooCommerceDataset({
    ...CONTEXT,
    dataset: WOOCOMMERCE_DATASETS.ORDERS,
    records: [orderFixture({ customer_id: 55, refunds: [], total_refunded: '0.000000' })],
    refundsByOrderId: new Map(),
  });
  assert.deepEqual(output.impactedCustomers, [
    'woocommerce:chemistry_k:registered:55:THB',
  ]);
  assert.equal(JSON.stringify(output).includes('private@example.test'), false);
});

test('Products, variations, customers and coupons use stable PII-minimized rows', async () => {
  const product = await normalizeWooCommerceDataset({
    ...CONTEXT,
    dataset: WOOCOMMERCE_DATASETS.PRODUCTS,
    records: [{
      id: 100, type: 'variable', sku: 'COURSE', name: 'Course', status: 'publish',
      catalog_visibility: 'visible', price: '999.000000', regular_price: '1299.000000',
      sale_price: '999.000000', stock_status: 'instock', stock_quantity: 10,
      manage_stock: true, categories: [{ id: 4, name: 'Private category metadata' }],
      attributes: [{ id: 1, name: 'Level', options: ['A'], visible: true, variation: true }],
      date_created_gmt: '2026-07-01T00:00:00', date_modified_gmt: '2026-07-25T00:00:00',
      meta_data: [{ key: 'secret', value: 'do-not-store' }],
    }],
  });
  const variation = await normalizeWooCommerceDataset({
    ...CONTEXT,
    dataset: WOOCOMMERCE_DATASETS.VARIATIONS,
    parentProductId: 100,
    records: [{
      id: 101, sku: 'COURSE-A', status: 'publish', price: '999.000000',
      regular_price: '1299.000000', sale_price: '999.000000', stock_status: 'instock',
      stock_quantity: 5, manage_stock: true,
      attributes: [{ id: 1, name: 'Level', option: 'A' }],
      date_created_gmt: '2026-07-01T00:00:00', date_modified_gmt: '2026-07-25T00:00:00',
    }],
  });
  const customer = await normalizeWooCommerceDataset({
    ...CONTEXT,
    dataset: WOOCOMMERCE_DATASETS.CUSTOMERS,
    records: [{
      id: 55, email: 'private@example.test', first_name: 'Private', last_name: 'Person',
      username: 'private-user', role: 'customer', orders_count: 3, total_spent: '2997.000000',
      date_created_gmt: '2026-01-01T00:00:00', date_modified_gmt: '2026-07-25T00:00:00',
    }],
  });
  const coupon = await normalizeWooCommerceDataset({
    ...CONTEXT,
    dataset: WOOCOMMERCE_DATASETS.COUPONS,
    records: [{
      id: 7, code: 'SECRET-CODE', discount_type: 'fixed_cart', amount: '100.000000',
      usage_count: 2, individual_use: false, free_shipping: false,
      date_created_gmt: '2026-01-01T00:00:00', date_modified_gmt: '2026-07-25T00:00:00',
      email_restrictions: ['private@example.test'],
    }],
  });

  assert.equal(product.canonical.products[0].product_key, 'woocommerce:chemistry_k:100');
  assert.equal(variation.canonical.products[0].product_key, 'woocommerce:chemistry_k:100:101');
  assert.equal(customer.canonical.customers[0].customer_aggregate_key,
    'woocommerce:chemistry_k:registered:55:THB');
  assert.equal(coupon.raw.coupons[0].coupon_code_hash.length, 64);
  const serialized = JSON.stringify({ product, variation, customer, coupon });
  assert.equal(serialized.includes('private@example.test'), false);
  assert.equal(serialized.includes('private-user'), false);
  assert.equal(serialized.includes('SECRET-CODE'), false);
  assert.equal(serialized.includes('do-not-store'), false);
});

test('incremental overlap re-reads late modifications and reports reject mixed currency', () => {
  assert.equal(
    createWooCommerceIncrementalBoundary({
      sourceWatermark: Date.parse('2026-07-26T00:05:00Z'),
      overlapSeconds: 300,
    }),
    '2026-07-26T00:00:00.000Z',
  );
  assert.throws(
    () => calculateWooCommerceReport({
      orders: [{ currency: 'THB' }, { currency: 'USD' }],
      lines: [],
    }),
    (error) => error?.code === 'WOOCOMMERCE_REPORT_CURRENCY_REQUIRED',
  );
});
