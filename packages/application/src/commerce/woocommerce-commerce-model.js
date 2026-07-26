import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

export const WOOCOMMERCE_DATASETS = Object.freeze({
  STORE: 'store',
  ORDERS: 'orders',
  PRODUCTS: 'products',
  VARIATIONS: 'variations',
  CATEGORIES: 'categories',
  CUSTOMERS: 'customers',
  COUPONS: 'coupons',
});

export const WOOCOMMERCE_D1_TABLE_CONTRACTS = Object.freeze({
  raw_commerce_stores: tableContract('store_key', [
    'store_key', 'customer_key', 'account_key', 'base_url_hash', 'wc_version', 'wp_version',
    'timezone', 'currency', 'number_of_decimals', 'source_payload_hash', 'fetched_at',
    'sync_run_id', 'coverage_run_id', 'created_at', 'updated_at',
  ]),
  raw_commerce_orders: tableContract('raw_order_key', [
    'raw_order_key', 'customer_key', 'account_key', 'external_order_id', 'order_number',
    'status', 'currency', 'source_created_at', 'source_modified_at', 'customer_type',
    'external_customer_id', 'payment_method_id', 'payment_method_title',
    'shipping_method_ids_json', 'shipping_method_titles_json', 'gross_sales_micros',
    'discount_micros', 'shipping_micros', 'tax_micros', 'refund_micros', 'total_micros',
    'source_payload_hash', 'payload_json', 'fetched_at', 'sync_run_id', 'coverage_run_id',
    'created_at', 'updated_at',
  ]),
  raw_commerce_order_items: tableContract('raw_order_item_key', [
    'raw_order_item_key', 'raw_order_key', 'customer_key', 'account_key', 'external_order_id',
    'external_line_item_id', 'external_product_id', 'external_variation_id', 'sku', 'product_name',
    'quantity', 'subtotal_micros', 'subtotal_tax_micros', 'total_micros', 'total_tax_micros',
    'taxes_json', 'source_payload_hash', 'fetched_at', 'sync_run_id', 'coverage_run_id',
    'created_at', 'updated_at',
  ]),
  raw_commerce_products: tableContract('raw_product_key', [
    'raw_product_key', 'customer_key', 'account_key', 'external_product_id', 'product_type',
    'sku', 'product_name', 'status', 'catalog_visibility', 'currency', 'price_micros',
    'regular_price_micros', 'sale_price_micros', 'stock_status', 'stock_quantity',
    'manage_stock', 'category_ids_json', 'source_created_at', 'source_modified_at',
    'source_payload_hash', 'payload_json', 'fetched_at', 'sync_run_id', 'coverage_run_id',
    'created_at', 'updated_at',
  ]),
  raw_commerce_product_variations: tableContract('raw_variation_key', [
    'raw_variation_key', 'raw_product_key', 'customer_key', 'account_key', 'external_product_id',
    'external_variation_id', 'sku', 'status', 'currency', 'price_micros', 'regular_price_micros',
    'sale_price_micros', 'stock_status', 'stock_quantity', 'manage_stock', 'attributes_json',
    'source_created_at', 'source_modified_at', 'source_payload_hash', 'payload_json', 'fetched_at',
    'sync_run_id', 'coverage_run_id', 'created_at', 'updated_at',
  ]),
  raw_commerce_categories: tableContract('raw_category_key', [
    'raw_category_key', 'customer_key', 'account_key', 'external_category_id',
    'external_parent_id', 'category_name', 'slug', 'display', 'menu_order', 'product_count',
    'source_payload_hash', 'payload_json', 'fetched_at', 'sync_run_id', 'coverage_run_id',
    'created_at', 'updated_at',
  ]),
  raw_commerce_customers: tableContract('raw_customer_key', [
    'raw_customer_key', 'customer_key', 'account_key', 'external_customer_id', 'customer_type',
    'orders_count', 'total_spent_micros', 'currency', 'source_created_at', 'source_modified_at',
    'source_payload_hash', 'payload_json', 'fetched_at', 'sync_run_id', 'coverage_run_id',
    'created_at', 'updated_at',
  ]),
  raw_commerce_coupons: tableContract('raw_coupon_key', [
    'raw_coupon_key', 'customer_key', 'account_key', 'external_coupon_id', 'coupon_code_hash',
    'discount_type', 'amount_micros', 'currency', 'usage_count', 'individual_use',
    'free_shipping', 'date_expires_at', 'source_created_at', 'source_modified_at',
    'source_payload_hash', 'payload_json', 'fetched_at', 'sync_run_id', 'coverage_run_id',
    'created_at', 'updated_at',
  ]),
  raw_commerce_refunds: tableContract('raw_refund_key', [
    'raw_refund_key', 'raw_order_key', 'customer_key', 'account_key', 'external_order_id',
    'external_refund_id', 'refund_micros', 'currency', 'reason_present', 'refunded_by_user_id',
    'source_created_at', 'line_items_json', 'source_payload_hash', 'payload_json', 'fetched_at',
    'sync_run_id', 'coverage_run_id', 'created_at', 'updated_at',
  ]),
  commerce_store_state: tableContract('store_key', [
    'store_key', 'customer_key', 'account_key', 'platform', 'wc_version', 'wp_version',
    'reporting_timezone', 'default_currency', 'number_of_decimals', 'last_observed_at',
    'source_payload_hash', 'last_coverage_run_id', 'last_sync_run_id', 'created_at', 'updated_at',
  ]),
  commerce_order_state: tableContract('order_key', [
    'order_key', 'customer_key', 'account_key', 'platform', 'external_order_id', 'order_number',
    'status', 'status_class', 'currency', 'metric_date', 'source_created_at', 'source_modified_at',
    'customer_type', 'external_customer_id', 'payment_method_id', 'payment_method_title',
    'shipping_method_ids_json', 'shipping_method_titles_json', 'gross_sales_micros',
    'discount_micros', 'refund_micros', 'net_sales_micros', 'shipping_micros', 'tax_micros',
    'order_total_micros', 'recognized_revenue_micros', 'recognized_order_count',
    'provisional_order_count', 'line_item_count', 'quantity_total', 'source_payload_hash',
    'last_coverage_run_id', 'last_sync_run_id', 'created_at', 'updated_at',
  ]),
  commerce_order_status_observations: tableContract('status_observation_key', [
    'status_observation_key', 'order_key', 'customer_key', 'account_key', 'external_order_id',
    'status', 'status_class', 'source_modified_at', 'observed_at', 'coverage_run_id',
    'sync_run_id', 'created_at',
  ]),
  commerce_order_line_facts: tableContract('order_line_key', [
    'order_line_key', 'order_key', 'customer_key', 'account_key', 'external_order_id',
    'external_line_item_id', 'product_key', 'external_product_id', 'external_variation_id',
    'sku', 'product_name', 'metric_date', 'currency', 'quantity', 'gross_sales_micros',
    'discount_micros', 'net_sales_micros', 'tax_micros', 'refunded_quantity',
    'refund_micros', 'last_coverage_run_id', 'last_sync_run_id', 'created_at', 'updated_at',
  ]),
  commerce_product_state: tableContract('product_key', [
    'product_key', 'customer_key', 'account_key', 'platform', 'external_product_id',
    'external_variation_id', 'parent_product_key', 'product_type', 'sku', 'product_name',
    'status', 'catalog_visibility', 'currency', 'price_micros', 'regular_price_micros',
    'sale_price_micros', 'stock_status', 'stock_quantity', 'manage_stock',
    'category_ids_json', 'attributes_json', 'source_created_at', 'source_modified_at',
    'source_payload_hash', 'last_coverage_run_id', 'last_sync_run_id', 'created_at', 'updated_at',
  ]),
  commerce_customer_aggregates: tableContract('customer_aggregate_key', [
    'customer_aggregate_key', 'customer_key', 'account_key', 'platform', 'external_customer_id',
    'customer_type', 'orders_count', 'total_spent_micros', 'currency', 'first_order_at',
    'last_order_at', 'source_created_at', 'source_modified_at', 'last_coverage_run_id',
    'last_sync_run_id', 'created_at', 'updated_at',
  ]),
  commerce_daily_sales_facts: tableContract('commerce_daily_key', [
    'commerce_daily_key', 'customer_key', 'account_key', 'platform', 'metric_date', 'currency',
    'gross_sales_micros', 'discount_micros', 'refund_micros', 'net_sales_micros',
    'shipping_micros', 'tax_micros', 'recognized_revenue_micros', 'recognized_orders',
    'provisional_orders', 'cancelled_orders', 'failed_orders', 'refunded_orders',
    'quantity_total', 'data_status', 'coverage_run_id', 'source_revision', 'sync_run_id',
    'created_at', 'updated_at',
  ]),
  commerce_product_daily_facts: tableContract('product_daily_key', [
    'product_daily_key', 'product_key', 'customer_key', 'account_key', 'platform', 'metric_date',
    'currency', 'quantity_ordered', 'gross_sales_micros', 'discount_micros', 'refund_micros',
    'net_sales_micros', 'recognized_orders', 'data_status', 'coverage_run_id',
    'source_revision', 'sync_run_id', 'created_at', 'updated_at',
  ]),
});

export const WOOCOMMERCE_LARK_TABLES = Object.freeze([
  larkContract('raw.stores', 'rawCommerceStores', 'store_key'),
  larkContract('raw.orders', 'rawCommerceOrders', 'raw_order_key'),
  larkContract('raw.orderItems', 'rawCommerceOrderItems', 'raw_order_item_key'),
  larkContract('raw.products', 'rawCommerceProducts', 'raw_product_key'),
  larkContract('raw.variations', 'rawCommerceProductVariations', 'raw_variation_key'),
  larkContract('raw.categories', 'rawCommerceCategories', 'raw_category_key'),
  larkContract('raw.customers', 'rawCommerceCustomers', 'raw_customer_key'),
  larkContract('raw.coupons', 'rawCommerceCoupons', 'raw_coupon_key'),
  larkContract('raw.refunds', 'rawCommerceRefunds', 'raw_refund_key'),
  larkContract('canonical.orders', 'mktCommerceOrders', 'order_key'),
  larkContract('canonical.products', 'mktCommerceProducts', 'product_key'),
  larkContract('canonical.customers', 'mktCommerceCustomers', 'customer_aggregate_key'),
  larkContract('daily.sales', 'mktCommerceDaily', 'commerce_daily_key'),
  larkContract('daily.products', 'mktCommerceProductDaily', 'product_daily_key'),
]);

/** Normalize one source page into privacy-minimized RAW and Canonical rows. */
export async function normalizeWooCommerceDataset(input = {}) {
  const dataset = requireDataset(input.dataset);
  const records = Array.isArray(input.records) ? input.records : [];
  const context = normalizeContext(input);
  const output = createEmptyOutput();

  if (dataset === WOOCOMMERCE_DATASETS.STORE) {
    const rowSet = await normalizeStore(records[0] ?? {}, context);
    appendRows(output, rowSet);
  } else if (dataset === WOOCOMMERCE_DATASETS.ORDERS) {
    for (const record of records) appendRows(output, await normalizeOrder(record, context));
  } else if (dataset === WOOCOMMERCE_DATASETS.PRODUCTS) {
    for (const record of records) appendRows(output, await normalizeProduct(record, context));
  } else if (dataset === WOOCOMMERCE_DATASETS.VARIATIONS) {
    for (const record of records) appendRows(output, await normalizeVariation(record, context));
  } else if (dataset === WOOCOMMERCE_DATASETS.CATEGORIES) {
    for (const record of records) appendRows(output, await normalizeCategory(record, context));
  } else if (dataset === WOOCOMMERCE_DATASETS.CUSTOMERS) {
    for (const record of records) appendRows(output, await normalizeCustomer(record, context));
  } else if (dataset === WOOCOMMERCE_DATASETS.COUPONS) {
    for (const record of records) appendRows(output, await normalizeCoupon(record, context));
  }

  return freezeOutput(output);
}

export function parseWooCommerceMoneyMicros(value, fieldName = 'money') {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,12}))?$/u.exec(text);
  if (!match) throw contractError(`${fieldName} must be a decimal string`, fieldName);
  const fraction = (match[3] ?? '').padEnd(6, '0').slice(0, 6);
  const whole = BigInt(match[2]);
  const micros = (whole * 1_000_000n) + BigInt(fraction || '0');
  const signed = match[1] === '-' ? -micros : micros;
  const number = Number(signed);
  if (!Number.isSafeInteger(number)) throw contractError(`${fieldName} exceeds safe integer micros`, fieldName);
  return number;
}

export function classifyWooCommerceOrderStatus(value) {
  const status = nullableText(value)?.toLowerCase() ?? 'unknown';
  if (['processing', 'completed', 'refunded'].includes(status)) return 'recognized';
  if (['pending', 'on-hold'].includes(status)) return 'provisional';
  if (status === 'cancelled' || status === 'trash') return 'cancelled';
  if (status === 'failed') return 'failed';
  return 'unknown';
}

export function createWooCommerceIncrementalBoundary(input = {}) {
  const sourceWatermark = nullableTimestamp(input.sourceWatermark);
  if (sourceWatermark === null) return null;
  const overlapSeconds = boundedInteger(input.overlapSeconds ?? 300, 'overlapSeconds', 0, 86_400);
  return new Date(Math.max(0, sourceWatermark - (overlapSeconds * 1000))).toISOString();
}

export function calculateWooCommerceReport(input = {}) {
  const orders = Array.isArray(input.orders) ? input.orders : [];
  const lines = Array.isArray(input.lines) ? input.lines : [];
  const currency = nullableText(input.currency);
  const selectedOrders = currency ? orders.filter((row) => row.currency === currency) : orders;
  const currencies = new Set(selectedOrders.map((row) => row.currency).filter(Boolean));
  if (!currency && currencies.size > 1) {
    throw permanentError('WooCommerce report cannot sum multiple currencies', {
      code: 'WOOCOMMERCE_REPORT_CURRENCY_REQUIRED',
      details: { currencyCount: currencies.size },
    });
  }
  const totals = sumOrderMetrics(selectedOrders);
  const productMap = new Map();
  for (const line of lines) {
    if (currency && line.currency !== currency) continue;
    const key = requireText(line.product_key, 'product_key');
    const current = productMap.get(key) ?? {
      product_key: key,
      sku: nullableText(line.sku),
      product_name: nullableText(line.product_name),
      quantity_ordered: 0,
      gross_sales_micros: 0,
      discount_micros: 0,
      refund_micros: 0,
      net_sales_micros: 0,
      order_keys: new Set(),
    };
    current.quantity_ordered += integerOrZero(line.quantity);
    current.gross_sales_micros += integerOrZero(line.gross_sales_micros);
    current.discount_micros += integerOrZero(line.discount_micros);
    current.refund_micros += integerOrZero(line.refund_micros);
    current.net_sales_micros += integerOrZero(line.net_sales_micros);
    if (line.order_key) current.order_keys.add(line.order_key);
    productMap.set(key, current);
  }
  const products = [...productMap.values()].map((row) => Object.freeze({
    ...row,
    recognized_orders: row.order_keys.size,
    order_keys: undefined,
  })).sort((a, b) => b.net_sales_micros - a.net_sales_micros || a.product_key.localeCompare(b.product_key));
  return Object.freeze({
    currency: currency ?? [...currencies][0] ?? null,
    totals: Object.freeze(totals),
    products: Object.freeze(products),
  });
}

async function normalizeStore(store, context) {
  const sanitized = {
    wc_version: nullableText(store.wcVersion ?? store.wc_version),
    wp_version: nullableText(store.wpVersion ?? store.wp_version),
    timezone: nullableText(store.timezone) ?? context.reportingTimezone,
    currency: nullableText(store.currency),
    number_of_decimals: nullableInteger(store.numberOfDecimals ?? store.number_of_decimals),
  };
  const baseUrlHash = await createStableFingerprint(nullableText(store.homeUrl ?? store.siteUrl) ?? context.accountKey);
  const payloadHash = await createStableFingerprint(sanitized);
  const base = auditFields(context);
  const storeKey = `woocommerce:${context.accountKey}`;
  return {
    raw_commerce_stores: [{
      store_key: storeKey, customer_key: context.customerKey, account_key: context.accountKey,
      base_url_hash: baseUrlHash, wc_version: sanitized.wc_version, wp_version: sanitized.wp_version,
      timezone: sanitized.timezone, currency: sanitized.currency,
      number_of_decimals: sanitized.number_of_decimals, source_payload_hash: payloadHash, ...base,
    }],
    commerce_store_state: [{
      store_key: storeKey, customer_key: context.customerKey, account_key: context.accountKey,
      platform: 'woocommerce', wc_version: sanitized.wc_version, wp_version: sanitized.wp_version,
      reporting_timezone: sanitized.timezone, default_currency: sanitized.currency,
      number_of_decimals: sanitized.number_of_decimals, last_observed_at: context.fetchedAt,
      source_payload_hash: payloadHash, last_coverage_run_id: context.coverageRunId,
      last_sync_run_id: context.syncRunId, created_at: context.now, updated_at: context.now,
    }],
  };
}

async function normalizeOrder(order, context) {
  const orderId = positiveInteger(order?.id, 'order.id');
  const orderKey = `woocommerce:${context.accountKey}:${orderId}`;
  const rawOrderKey = orderKey;
  const currency = requireText(order.currency, 'order.currency').toUpperCase();
  const sourceCreatedAt = sourceTimestamp(order.date_created_gmt ?? order.date_created, 'order.date_created');
  const sourceModifiedAt = sourceTimestamp(order.date_modified_gmt ?? order.date_modified, 'order.date_modified');
  const metricDate = localDate(sourceCreatedAt, context.reportingTimezone);
  const customerId = nullablePositiveInteger(order.customer_id);
  const customerType = customerId ? 'registered' : 'guest';
  const lines = Array.isArray(order.line_items) ? order.line_items : [];
  const refunds = readRefundDetails(orderId, context.refundsByOrderId, order.refunds);
  const grossSalesMicros = sum(lines, (line) => money(line.subtotal) + money(line.subtotal_tax));
  const discountMicros = money(order.discount_total) + money(order.discount_tax);
  const shippingMicros = money(order.shipping_total) + money(order.shipping_tax);
  const taxMicros = money(order.total_tax);
  const refundMicros = sum(refunds, (refund) => Math.abs(money(refund.total)));
  const totalMicros = money(order.total);
  const netSalesMicros = grossSalesMicros - discountMicros - refundMicros;
  const status = nullableText(order.status)?.toLowerCase() ?? 'unknown';
  const statusClass = classifyWooCommerceOrderStatus(status);
  const recognizedOrderCount = statusClass === 'recognized' ? 1 : 0;
  const provisionalOrderCount = statusClass === 'provisional' ? 1 : 0;
  const recognizedRevenueMicros = recognizedOrderCount ? totalMicros - refundMicros : 0;
  const shipping = normalizeShippingLines(order.shipping_lines);
  const sanitized = sanitizeOrderPayload(order, {
    grossSalesMicros, discountMicros, shippingMicros, taxMicros, refundMicros, totalMicros,
    customerType, customerId, shipping,
  });
  const payloadHash = await createStableFingerprint(sanitized);
  const base = auditFields(context);
  const output = {
    raw_commerce_orders: [{
      raw_order_key: rawOrderKey, customer_key: context.customerKey, account_key: context.accountKey,
      external_order_id: String(orderId), order_number: nullableText(order.number), status, currency,
      source_created_at: sourceCreatedAt, source_modified_at: sourceModifiedAt, customer_type: customerType,
      external_customer_id: customerId === null ? null : String(customerId),
      payment_method_id: nullableText(order.payment_method), payment_method_title: nullableText(order.payment_method_title),
      shipping_method_ids_json: JSON.stringify(shipping.ids), shipping_method_titles_json: JSON.stringify(shipping.titles),
      gross_sales_micros: grossSalesMicros, discount_micros: discountMicros,
      shipping_micros: shippingMicros, tax_micros: taxMicros, refund_micros: refundMicros,
      total_micros: totalMicros, source_payload_hash: payloadHash, payload_json: JSON.stringify(sanitized), ...base,
    }],
    commerce_order_state: [{
      order_key: orderKey, customer_key: context.customerKey, account_key: context.accountKey,
      platform: 'woocommerce', external_order_id: String(orderId), order_number: nullableText(order.number),
      status, status_class: statusClass, currency, metric_date: metricDate,
      source_created_at: sourceCreatedAt, source_modified_at: sourceModifiedAt,
      customer_type: customerType, external_customer_id: customerId === null ? null : String(customerId),
      payment_method_id: nullableText(order.payment_method), payment_method_title: nullableText(order.payment_method_title),
      shipping_method_ids_json: JSON.stringify(shipping.ids), shipping_method_titles_json: JSON.stringify(shipping.titles),
      gross_sales_micros: grossSalesMicros, discount_micros: discountMicros, refund_micros: refundMicros,
      net_sales_micros: netSalesMicros, shipping_micros: shippingMicros, tax_micros: taxMicros,
      order_total_micros: totalMicros, recognized_revenue_micros: recognizedRevenueMicros,
      recognized_order_count: recognizedOrderCount, provisional_order_count: provisionalOrderCount,
      line_item_count: lines.length, quantity_total: sum(lines, (line) => integerOrZero(line.quantity)),
      source_payload_hash: payloadHash, last_coverage_run_id: context.coverageRunId,
      last_sync_run_id: context.syncRunId, created_at: context.now, updated_at: context.now,
    }],
    commerce_order_status_observations: [{
      status_observation_key: `${orderKey}:status:${sourceModifiedAt}`,
      order_key: orderKey, customer_key: context.customerKey, account_key: context.accountKey,
      external_order_id: String(orderId), status, status_class: statusClass,
      source_modified_at: sourceModifiedAt, observed_at: context.fetchedAt,
      coverage_run_id: context.coverageRunId, sync_run_id: context.syncRunId, created_at: context.now,
    }],
    impactedDates: [metricDate],
    impactedCustomers: customerId ? [`woocommerce:${context.accountKey}:registered:${customerId}`] : [],
  };

  const refundByLine = buildRefundByLine(refunds);
  for (const line of lines) appendRows(output, await normalizeOrderLine(line, {
    ...context, orderKey, rawOrderKey, orderId, metricDate, currency, refundByLine,
  }));
  for (const refund of refunds) appendRows(output, await normalizeRefund(refund, {
    ...context, orderKey, rawOrderKey, orderId, currency,
  }));
  return output;
}

async function normalizeOrderLine(line, context) {
  const lineId = positiveInteger(line?.id, 'line_item.id');
  const productId = nullablePositiveInteger(line.product_id);
  const variationId = nullablePositiveInteger(line.variation_id);
  const productKey = productId
    ? `woocommerce:${context.accountKey}:${productId}${variationId ? `:${variationId}` : ''}`
    : `woocommerce:${context.accountKey}:unmapped-line:${lineId}`;
  const subtotal = money(line.subtotal);
  const subtotalTax = money(line.subtotal_tax);
  const total = money(line.total);
  const totalTax = money(line.total_tax);
  const refund = context.refundByLine.get(lineId) ?? { quantity: 0, micros: 0 };
  const rawKey = `${context.rawOrderKey}:${lineId}`;
  const lineKey = `${context.orderKey}:${lineId}`;
  const sanitized = sanitizeLinePayload(line);
  const payloadHash = await createStableFingerprint(sanitized);
  const base = auditFields(context);
  return {
    raw_commerce_order_items: [{
      raw_order_item_key: rawKey, raw_order_key: context.rawOrderKey,
      customer_key: context.customerKey, account_key: context.accountKey,
      external_order_id: String(context.orderId), external_line_item_id: String(lineId),
      external_product_id: productId === null ? null : String(productId),
      external_variation_id: variationId === null ? null : String(variationId),
      sku: nullableText(line.sku), product_name: nullableText(line.name), quantity: integerOrZero(line.quantity),
      subtotal_micros: subtotal, subtotal_tax_micros: subtotalTax, total_micros: total,
      total_tax_micros: totalTax, taxes_json: JSON.stringify(sanitizeTaxes(line.taxes)),
      source_payload_hash: payloadHash, ...base,
    }],
    commerce_order_line_facts: [{
      order_line_key: lineKey, order_key: context.orderKey, customer_key: context.customerKey,
      account_key: context.accountKey, external_order_id: String(context.orderId),
      external_line_item_id: String(lineId), product_key: productKey,
      external_product_id: productId === null ? null : String(productId),
      external_variation_id: variationId === null ? null : String(variationId),
      sku: nullableText(line.sku), product_name: nullableText(line.name), metric_date: context.metricDate,
      currency: context.currency, quantity: integerOrZero(line.quantity),
      gross_sales_micros: subtotal + subtotalTax,
      discount_micros: Math.max(0, (subtotal + subtotalTax) - (total + totalTax)),
      net_sales_micros: (total + totalTax) - refund.micros,
      tax_micros: totalTax, refunded_quantity: refund.quantity, refund_micros: refund.micros,
      last_coverage_run_id: context.coverageRunId, last_sync_run_id: context.syncRunId,
      created_at: context.now, updated_at: context.now,
    }],
    impactedProducts: [productKey],
  };
}

async function normalizeRefund(refund, context) {
  const refundId = positiveInteger(refund?.id, 'refund.id');
  const refundKey = `${context.rawOrderKey}:${refundId}`;
  const sanitized = sanitizeRefundPayload(refund);
  const payloadHash = await createStableFingerprint(sanitized);
  return {
    raw_commerce_refunds: [{
      raw_refund_key: refundKey, raw_order_key: context.rawOrderKey,
      customer_key: context.customerKey, account_key: context.accountKey,
      external_order_id: String(context.orderId), external_refund_id: String(refundId),
      refund_micros: Math.abs(money(refund.total)), currency: context.currency,
      reason_present: nullableText(refund.reason) ? 1 : 0,
      refunded_by_user_id: nullablePositiveInteger(refund.refunded_by)?.toString() ?? null,
      source_created_at: nullableTimestamp(refund.date_created_gmt ?? refund.date_created),
      line_items_json: JSON.stringify(sanitizeRefundLineItems(refund.line_items)),
      source_payload_hash: payloadHash, payload_json: JSON.stringify(sanitized),
      ...auditFields(context),
    }],
  };
}

async function normalizeProduct(product, context) {
  const id = positiveInteger(product?.id, 'product.id');
  const key = `woocommerce:${context.accountKey}:${id}`;
  const currency = nullableText(product.currency ?? context.defaultCurrency)?.toUpperCase() ?? null;
  const sanitized = sanitizeProductPayload(product);
  const hash = await createStableFingerprint(sanitized);
  const base = auditFields(context);
  const common = {
    customer_key: context.customerKey, account_key: context.accountKey,
    external_product_id: String(id), product_type: nullableText(product.type), sku: nullableText(product.sku),
    product_name: nullableText(product.name), status: nullableText(product.status),
    catalog_visibility: nullableText(product.catalog_visibility), currency,
    price_micros: nullableMoney(product.price), regular_price_micros: nullableMoney(product.regular_price),
    sale_price_micros: nullableMoney(product.sale_price), stock_status: nullableText(product.stock_status),
    stock_quantity: nullableInteger(product.stock_quantity), manage_stock: booleanInteger(product.manage_stock),
    category_ids_json: JSON.stringify(readIds(product.categories)),
    source_created_at: nullableTimestamp(product.date_created_gmt ?? product.date_created),
    source_modified_at: nullableTimestamp(product.date_modified_gmt ?? product.date_modified),
    source_payload_hash: hash,
  };
  return {
    raw_commerce_products: [{
      raw_product_key: key, ...common, payload_json: JSON.stringify(sanitized), ...base,
    }],
    commerce_product_state: [{
      product_key: key, customer_key: context.customerKey, account_key: context.accountKey,
      platform: 'woocommerce', external_product_id: String(id), external_variation_id: null,
      parent_product_key: null, product_type: common.product_type, sku: common.sku,
      product_name: common.product_name, status: common.status,
      catalog_visibility: common.catalog_visibility, currency, price_micros: common.price_micros,
      regular_price_micros: common.regular_price_micros, sale_price_micros: common.sale_price_micros,
      stock_status: common.stock_status, stock_quantity: common.stock_quantity,
      manage_stock: common.manage_stock, category_ids_json: common.category_ids_json,
      attributes_json: JSON.stringify(sanitizeAttributes(product.attributes)),
      source_created_at: common.source_created_at, source_modified_at: common.source_modified_at,
      source_payload_hash: hash, last_coverage_run_id: context.coverageRunId,
      last_sync_run_id: context.syncRunId, created_at: context.now, updated_at: context.now,
    }],
  };
}

async function normalizeVariation(variation, context) {
  const parentId = positiveInteger(context.parentProductId ?? variation.parent_id, 'variation.parent_id');
  const id = positiveInteger(variation?.id, 'variation.id');
  const parentKey = `woocommerce:${context.accountKey}:${parentId}`;
  const key = `${parentKey}:${id}`;
  const currency = nullableText(variation.currency ?? context.defaultCurrency)?.toUpperCase() ?? null;
  const sanitized = sanitizeVariationPayload(variation);
  const hash = await createStableFingerprint(sanitized);
  const base = auditFields(context);
  const common = {
    customer_key: context.customerKey, account_key: context.accountKey,
    external_product_id: String(parentId), external_variation_id: String(id), sku: nullableText(variation.sku),
    status: nullableText(variation.status), currency, price_micros: nullableMoney(variation.price),
    regular_price_micros: nullableMoney(variation.regular_price), sale_price_micros: nullableMoney(variation.sale_price),
    stock_status: nullableText(variation.stock_status), stock_quantity: nullableInteger(variation.stock_quantity),
    manage_stock: booleanInteger(variation.manage_stock), attributes_json: JSON.stringify(sanitizeAttributes(variation.attributes)),
    source_created_at: nullableTimestamp(variation.date_created_gmt ?? variation.date_created),
    source_modified_at: nullableTimestamp(variation.date_modified_gmt ?? variation.date_modified),
    source_payload_hash: hash,
  };
  return {
    raw_commerce_product_variations: [{
      raw_variation_key: key, raw_product_key: parentKey, ...common,
      payload_json: JSON.stringify(sanitized), ...base,
    }],
    commerce_product_state: [{
      product_key: key, customer_key: context.customerKey, account_key: context.accountKey,
      platform: 'woocommerce', external_product_id: String(parentId), external_variation_id: String(id),
      parent_product_key: parentKey, product_type: 'variation', sku: common.sku, product_name: null,
      status: common.status, catalog_visibility: null, currency, price_micros: common.price_micros,
      regular_price_micros: common.regular_price_micros, sale_price_micros: common.sale_price_micros,
      stock_status: common.stock_status, stock_quantity: common.stock_quantity,
      manage_stock: common.manage_stock, category_ids_json: '[]', attributes_json: common.attributes_json,
      source_created_at: common.source_created_at, source_modified_at: common.source_modified_at,
      source_payload_hash: hash, last_coverage_run_id: context.coverageRunId,
      last_sync_run_id: context.syncRunId, created_at: context.now, updated_at: context.now,
    }],
  };
}

async function normalizeCategory(category, context) {
  const id = positiveInteger(category?.id, 'category.id');
  const sanitized = {
    id, parent: nullablePositiveInteger(category.parent) ?? 0, name: nullableText(category.name),
    slug: nullableText(category.slug), display: nullableText(category.display),
    menu_order: nullableInteger(category.menu_order), count: nullableInteger(category.count),
  };
  const hash = await createStableFingerprint(sanitized);
  return {
    raw_commerce_categories: [{
      raw_category_key: `woocommerce:${context.accountKey}:${id}`,
      customer_key: context.customerKey, account_key: context.accountKey,
      external_category_id: String(id), external_parent_id: sanitized.parent ? String(sanitized.parent) : null,
      category_name: sanitized.name, slug: sanitized.slug, display: sanitized.display,
      menu_order: sanitized.menu_order, product_count: sanitized.count,
      source_payload_hash: hash, payload_json: JSON.stringify(sanitized), ...auditFields(context),
    }],
  };
}

async function normalizeCustomer(customer, context) {
  const id = positiveInteger(customer?.id, 'customer.id');
  const sanitized = {
    id, role: nullableText(customer.role), orders_count: nullableInteger(customer.orders_count),
    total_spent: nullableText(customer.total_spent),
    date_created_gmt: nullableText(customer.date_created_gmt),
    date_modified_gmt: nullableText(customer.date_modified_gmt),
  };
  const hash = await createStableFingerprint(sanitized);
  const key = `woocommerce:${context.accountKey}:registered:${id}`;
  const currency = nullableText(context.defaultCurrency)?.toUpperCase() ?? null;
  const base = auditFields(context);
  return {
    raw_commerce_customers: [{
      raw_customer_key: key, customer_key: context.customerKey, account_key: context.accountKey,
      external_customer_id: String(id), customer_type: 'registered', orders_count: sanitized.orders_count,
      total_spent_micros: nullableMoney(sanitized.total_spent), currency,
      source_created_at: nullableTimestamp(customer.date_created_gmt ?? customer.date_created),
      source_modified_at: nullableTimestamp(customer.date_modified_gmt ?? customer.date_modified),
      source_payload_hash: hash, payload_json: JSON.stringify(sanitized), ...base,
    }],
    commerce_customer_aggregates: [{
      customer_aggregate_key: key, customer_key: context.customerKey, account_key: context.accountKey,
      platform: 'woocommerce', external_customer_id: String(id), customer_type: 'registered',
      orders_count: sanitized.orders_count, total_spent_micros: nullableMoney(sanitized.total_spent),
      currency, first_order_at: null, last_order_at: null,
      source_created_at: nullableTimestamp(customer.date_created_gmt ?? customer.date_created),
      source_modified_at: nullableTimestamp(customer.date_modified_gmt ?? customer.date_modified),
      last_coverage_run_id: context.coverageRunId, last_sync_run_id: context.syncRunId,
      created_at: context.now, updated_at: context.now,
    }],
  };
}

async function normalizeCoupon(coupon, context) {
  const id = positiveInteger(coupon?.id, 'coupon.id');
  const codeHash = await createStableFingerprint(nullableText(coupon.code) ?? `coupon:${id}`);
  const sanitized = {
    id, code_hash: codeHash, discount_type: nullableText(coupon.discount_type),
    amount: nullableText(coupon.amount), usage_count: nullableInteger(coupon.usage_count),
    individual_use: coupon.individual_use === true, free_shipping: coupon.free_shipping === true,
    date_expires_gmt: nullableText(coupon.date_expires_gmt),
    date_created_gmt: nullableText(coupon.date_created_gmt),
    date_modified_gmt: nullableText(coupon.date_modified_gmt),
  };
  const payloadHash = await createStableFingerprint(sanitized);
  return {
    raw_commerce_coupons: [{
      raw_coupon_key: `woocommerce:${context.accountKey}:${id}`,
      customer_key: context.customerKey, account_key: context.accountKey,
      external_coupon_id: String(id), coupon_code_hash: codeHash,
      discount_type: sanitized.discount_type, amount_micros: nullableMoney(sanitized.amount),
      currency: nullableText(context.defaultCurrency)?.toUpperCase() ?? null,
      usage_count: sanitized.usage_count, individual_use: booleanInteger(sanitized.individual_use),
      free_shipping: booleanInteger(sanitized.free_shipping),
      date_expires_at: nullableTimestamp(coupon.date_expires_gmt ?? coupon.date_expires),
      source_created_at: nullableTimestamp(coupon.date_created_gmt ?? coupon.date_created),
      source_modified_at: nullableTimestamp(coupon.date_modified_gmt ?? coupon.date_modified),
      source_payload_hash: payloadHash, payload_json: JSON.stringify(sanitized), ...auditFields(context),
    }],
  };
}

function normalizeContext(input) {
  const fetchedAt = nullableTimestamp(input.fetchedAt ?? Date.now());
  const now = nullableTimestamp(input.now ?? fetchedAt);
  return Object.freeze({
    customerKey: requireText(input.customerKey, 'customerKey'),
    accountKey: requireText(input.accountKey, 'accountKey'),
    reportingTimezone: requireText(input.reportingTimezone ?? 'Asia/Bangkok', 'reportingTimezone'),
    defaultCurrency: nullableText(input.defaultCurrency)?.toUpperCase() ?? null,
    syncRunId: requireText(input.syncRunId, 'syncRunId'),
    coverageRunId: requireText(input.coverageRunId, 'coverageRunId'),
    fetchedAt,
    now,
    refundsByOrderId: input.refundsByOrderId ?? new Map(),
    parentProductId: input.parentProductId ?? null,
  });
}

function createEmptyOutput() {
  return {
    raw: { stores: [], orders: [], orderItems: [], products: [], variations: [], categories: [], customers: [], coupons: [], refunds: [] },
    canonical: { orders: [], orderStatusObservations: [], orderLines: [], products: [], customers: [] },
    daily: { sales: [], products: [] },
    d1RowsByTable: {},
    impactedDates: new Set(),
    impactedProducts: new Set(),
    impactedCustomers: new Set(),
  };
}

function appendRows(output, rowSet = {}) {
  const mapping = {
    raw_commerce_stores: ['raw', 'stores'], raw_commerce_orders: ['raw', 'orders'],
    raw_commerce_order_items: ['raw', 'orderItems'], raw_commerce_products: ['raw', 'products'],
    raw_commerce_product_variations: ['raw', 'variations'], raw_commerce_categories: ['raw', 'categories'],
    raw_commerce_customers: ['raw', 'customers'], raw_commerce_coupons: ['raw', 'coupons'],
    raw_commerce_refunds: ['raw', 'refunds'], commerce_order_state: ['canonical', 'orders'],
    commerce_order_status_observations: ['canonical', 'orderStatusObservations'],
    commerce_order_line_facts: ['canonical', 'orderLines'], commerce_product_state: ['canonical', 'products'],
    commerce_customer_aggregates: ['canonical', 'customers'], commerce_daily_sales_facts: ['daily', 'sales'],
    commerce_product_daily_facts: ['daily', 'products'],
  };
  for (const [table, rows] of Object.entries(rowSet)) {
    if (!Array.isArray(rows)) continue;
    output.d1RowsByTable[table] ??= [];
    output.d1RowsByTable[table].push(...rows);
    const path = mapping[table];
    if (path) output[path[0]][path[1]].push(...rows);
  }
  for (const value of rowSet.impactedDates ?? []) output.impactedDates.add(value);
  for (const value of rowSet.impactedProducts ?? []) output.impactedProducts.add(value);
  for (const value of rowSet.impactedCustomers ?? []) output.impactedCustomers.add(value);
}

function freezeOutput(output) {
  return Object.freeze({
    raw: freezeGroups(output.raw), canonical: freezeGroups(output.canonical), daily: freezeGroups(output.daily),
    d1RowsByTable: Object.freeze(Object.fromEntries(Object.entries(output.d1RowsByTable)
      .map(([key, rows]) => [key, Object.freeze(rows.map((row) => Object.freeze({ ...row })))]))),
    impactedDates: Object.freeze([...output.impactedDates].sort()),
    impactedProducts: Object.freeze([...output.impactedProducts].sort()),
    impactedCustomers: Object.freeze([...output.impactedCustomers].sort()),
  });
}

function freezeGroups(groups) {
  return Object.freeze(Object.fromEntries(Object.entries(groups)
    .map(([key, rows]) => [key, Object.freeze(rows.map((row) => Object.freeze({ ...row })))])));
}

function auditFields(context) {
  return {
    fetched_at: context.fetchedAt, sync_run_id: context.syncRunId,
    coverage_run_id: context.coverageRunId, created_at: context.now, updated_at: context.now,
  };
}

function sanitizeOrderPayload(order, derived) {
  return {
    id: order.id, number: nullableText(order.number), status: nullableText(order.status),
    currency: nullableText(order.currency), date_created_gmt: nullableText(order.date_created_gmt),
    date_modified_gmt: nullableText(order.date_modified_gmt), date_paid_gmt: nullableText(order.date_paid_gmt),
    date_completed_gmt: nullableText(order.date_completed_gmt), customer_type: derived.customerType,
    customer_id: derived.customerId, payment_method: nullableText(order.payment_method),
    payment_method_title: nullableText(order.payment_method_title), shipping_method_ids: derived.shipping.ids,
    shipping_method_titles: derived.shipping.titles, gross_sales_micros: derived.grossSalesMicros,
    discount_micros: derived.discountMicros, shipping_micros: derived.shippingMicros,
    tax_micros: derived.taxMicros, refund_micros: derived.refundMicros, total_micros: derived.totalMicros,
    line_items: (order.line_items ?? []).map(sanitizeLinePayload),
    coupon_ids: (order.coupon_lines ?? []).map((line) => nullablePositiveInteger(line.id)).filter(Boolean),
    refund_ids: (order.refunds ?? []).map((refund) => nullablePositiveInteger(refund.id)).filter(Boolean),
  };
}

function sanitizeLinePayload(line) {
  return {
    id: line?.id, product_id: nullablePositiveInteger(line?.product_id),
    variation_id: nullablePositiveInteger(line?.variation_id), sku: nullableText(line?.sku),
    name: nullableText(line?.name), quantity: nullableInteger(line?.quantity),
    subtotal: nullableText(line?.subtotal), subtotal_tax: nullableText(line?.subtotal_tax),
    total: nullableText(line?.total), total_tax: nullableText(line?.total_tax),
    taxes: sanitizeTaxes(line?.taxes),
  };
}

function sanitizeProductPayload(product) {
  return {
    id: product.id, type: nullableText(product.type), sku: nullableText(product.sku),
    name: nullableText(product.name), status: nullableText(product.status),
    catalog_visibility: nullableText(product.catalog_visibility), price: nullableText(product.price),
    regular_price: nullableText(product.regular_price), sale_price: nullableText(product.sale_price),
    stock_status: nullableText(product.stock_status), stock_quantity: nullableInteger(product.stock_quantity),
    manage_stock: product.manage_stock === true, category_ids: readIds(product.categories),
    attributes: sanitizeAttributes(product.attributes), date_created_gmt: nullableText(product.date_created_gmt),
    date_modified_gmt: nullableText(product.date_modified_gmt),
  };
}

function sanitizeVariationPayload(variation) {
  return {
    id: variation.id, parent_id: nullablePositiveInteger(variation.parent_id), sku: nullableText(variation.sku),
    status: nullableText(variation.status), price: nullableText(variation.price),
    regular_price: nullableText(variation.regular_price), sale_price: nullableText(variation.sale_price),
    stock_status: nullableText(variation.stock_status), stock_quantity: nullableInteger(variation.stock_quantity),
    manage_stock: variation.manage_stock === true, attributes: sanitizeAttributes(variation.attributes),
    date_created_gmt: nullableText(variation.date_created_gmt), date_modified_gmt: nullableText(variation.date_modified_gmt),
  };
}

function sanitizeRefundPayload(refund) {
  return {
    id: refund.id, date_created_gmt: nullableText(refund.date_created_gmt),
    amount_micros: Math.abs(money(refund.total)), reason_present: Boolean(nullableText(refund.reason)),
    refunded_by: nullablePositiveInteger(refund.refunded_by), line_items: sanitizeRefundLineItems(refund.line_items),
  };
}

function sanitizeTaxes(taxes) {
  return (Array.isArray(taxes) ? taxes : []).map((tax) => ({
    id: nullablePositiveInteger(tax?.id), total: nullableText(tax?.total), subtotal: nullableText(tax?.subtotal),
  }));
}

function sanitizeAttributes(attributes) {
  return (Array.isArray(attributes) ? attributes : []).map((attribute) => ({
    id: nullablePositiveInteger(attribute?.id), name: nullableText(attribute?.name),
    option: nullableText(attribute?.option), position: nullableInteger(attribute?.position),
    visible: attribute?.visible === true, variation: attribute?.variation === true,
  }));
}

function sanitizeRefundLineItems(lines) {
  return (Array.isArray(lines) ? lines : []).map((line) => ({
    id: nullablePositiveInteger(line?.id), quantity: nullableInteger(line?.quantity),
    refund_total: nullableText(line?.refund_total), refund_tax: nullableText(line?.refund_tax),
  }));
}

function normalizeShippingLines(lines) {
  const source = Array.isArray(lines) ? lines : [];
  return {
    ids: source.map((line) => nullableText(line.method_id)).filter(Boolean),
    titles: source.map((line) => nullableText(line.method_title)).filter(Boolean),
  };
}

function readRefundDetails(orderId, refundsByOrderId, fallback) {
  if (refundsByOrderId instanceof Map && refundsByOrderId.has(orderId)) return refundsByOrderId.get(orderId) ?? [];
  if (isPlainObject(refundsByOrderId) && Array.isArray(refundsByOrderId[orderId])) return refundsByOrderId[orderId];
  return Array.isArray(fallback) ? fallback : [];
}

function buildRefundByLine(refunds) {
  const map = new Map();
  for (const refund of refunds) {
    for (const line of Array.isArray(refund?.line_items) ? refund.line_items : []) {
      const id = nullablePositiveInteger(line.id);
      if (!id) continue;
      const current = map.get(id) ?? { quantity: 0, micros: 0 };
      current.quantity += Math.abs(integerOrZero(line.quantity));
      current.micros += Math.abs(money(line.refund_total)) + Math.abs(money(line.refund_tax));
      map.set(id, current);
    }
  }
  return map;
}

function sumOrderMetrics(orders) {
  const fields = [
    'gross_sales_micros', 'discount_micros', 'refund_micros', 'net_sales_micros',
    'shipping_micros', 'tax_micros', 'recognized_revenue_micros', 'recognized_order_count',
    'provisional_order_count', 'quantity_total',
  ];
  const result = Object.fromEntries(fields.map((field) => [field, 0]));
  result.cancelled_orders = 0;
  result.failed_orders = 0;
  result.refunded_orders = 0;
  for (const order of orders) {
    for (const field of fields) result[field] += integerOrZero(order[field]);
    if (order.status_class === 'cancelled') result.cancelled_orders += 1;
    if (order.status_class === 'failed') result.failed_orders += 1;
    if (order.status === 'refunded' || integerOrZero(order.refund_micros) > 0) result.refunded_orders += 1;
  }
  return result;
}

function localDate(timestamp, timeZone) {
  const date = new Date(timestamp);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function sourceTimestamp(value, fieldName) {
  const timestamp = nullableTimestamp(value);
  if (timestamp === null) throw contractError(`${fieldName} is required`, fieldName);
  return timestamp;
}

function nullableTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  const text = String(value);
  const timestamp = Date.parse(/(?:Z|[+-]\d\d:\d\d)$/u.test(text) ? text : `${text}Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function money(value) {
  return parseWooCommerceMoneyMicros(value ?? '0');
}

function nullableMoney(value) {
  return value === null || value === undefined || value === '' ? null : parseWooCommerceMoneyMicros(value);
}

function sum(values, mapper) {
  let total = 0;
  for (const value of values ?? []) total += mapper(value);
  return total;
}

function readIds(values) {
  return (Array.isArray(values) ? values : []).map((value) => nullablePositiveInteger(value?.id ?? value)).filter(Boolean);
}

function tableContract(keyField, columns) {
  return Object.freeze({ keyField, columns: Object.freeze([...columns]) });
}

function larkContract(path, tableKey, keyField) {
  return Object.freeze({ path, tableKey, keyField });
}

function requireDataset(value) {
  const dataset = requireText(value, 'dataset');
  if (!Object.values(WOOCOMMERCE_DATASETS).includes(dataset)) throw contractError('Unsupported WooCommerce dataset', 'dataset');
  return dataset;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw contractError(`${fieldName} is required`, fieldName);
  return value.trim();
}

function nullableText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw contractError(`${fieldName} must be a positive integer`, fieldName);
  return number;
}

function nullablePositiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function nullableInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function integerOrZero(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : 0;
}

function boundedInteger(value, fieldName, min, max) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw contractError(`${fieldName} is out of range`, fieldName);
  return number;
}

function booleanInteger(value) {
  return value === true ? 1 : value === false ? 0 : null;
}

function contractError(message, fieldName) {
  return permanentError(message, {
    code: 'WOOCOMMERCE_SOURCE_CONTRACT_INVALID', details: { fieldName },
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
