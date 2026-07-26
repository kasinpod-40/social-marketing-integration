import { permanentError } from '../../../shared/src/errors/runtime-error.js';

/** Build a deterministic, currency-isolated commerce report from the D1 report source. */
export async function generateWooCommerceCommerceReport(input = {}) {
  const source = requireMethods(input.source, ['loadRange'], 'source');
  const range = await source.loadRange({
    accountKey: requireText(input.accountKey, 'accountKey'),
    periodStart: requireText(input.periodStart, 'periodStart'),
    periodEnd: requireText(input.periodEnd, 'periodEnd'),
    currency: requireText(input.currency, 'currency').toUpperCase(),
  });
  const totals = sumDaily(range.daily);
  const products = range.products.map((row) => Object.freeze({
    product_key: row.product_key,
    quantity_ordered: integer(row.quantity_ordered),
    gross_sales_micros: integer(row.gross_sales_micros),
    discount_micros: integer(row.discount_micros),
    refund_micros: integer(row.refund_micros),
    net_sales_micros: integer(row.net_sales_micros),
    recognized_orders: integer(row.recognized_orders),
    data_status: row.data_status ?? 'partial',
  }));
  return Object.freeze({
    schema_version: 'woocommerce_commerce_report_v1',
    platform: 'woocommerce',
    account_key: range.accountKey,
    currency: range.currency,
    period_start: range.periodStart,
    period_end: range.periodEnd,
    data_status: resolveDataStatus(range.daily, products),
    source_watermark: latestText([
      ...range.daily.map((row) => row.source_revision),
      ...range.products.map((row) => row.source_revision),
    ]),
    totals: Object.freeze(totals),
    products: Object.freeze(products),
    payment_methods: Object.freeze(aggregatePaymentMethods(range.orders)),
    shipping_methods: Object.freeze(aggregateShippingMethods(range.orders)),
  });
}

function sumDaily(rows) {
  const totals = {
    gross_sales_micros: 0,
    discount_micros: 0,
    refund_micros: 0,
    net_sales_micros: 0,
    shipping_micros: 0,
    tax_micros: 0,
    recognized_revenue_micros: 0,
    recognized_orders: 0,
    provisional_orders: 0,
    cancelled_orders: 0,
    failed_orders: 0,
    refunded_orders: 0,
    quantity_total: 0,
  };
  for (const row of rows) {
    for (const field of Object.keys(totals)) totals[field] += integer(row[field]);
  }
  return totals;
}

function aggregatePaymentMethods(orders) {
  const byKey = new Map();
  for (const order of orders) {
    const key = textOrUnknown(order.payment_method_id);
    const current = byKey.get(key) ?? {
      payment_method_id: key,
      payment_method_title: nullableText(order.payment_method_title),
      recognized_orders: 0,
      recognized_revenue_micros: 0,
      refund_micros: 0,
    };
    applyOrderMetrics(current, order);
    byKey.set(key, current);
  }
  return sortSummaries(byKey, 'payment_method_id');
}

function aggregateShippingMethods(orders) {
  const byKey = new Map();
  for (const order of orders) {
    const method = shippingMethodCombination(order);
    const current = byKey.get(method.id) ?? {
      shipping_method_id: method.id,
      shipping_method_title: method.title,
      recognized_orders: 0,
      recognized_revenue_micros: 0,
      refund_micros: 0,
    };
    applyOrderMetrics(current, order);
    byKey.set(method.id, current);
  }
  return sortSummaries(byKey, 'shipping_method_id');
}

function shippingMethodCombination(order) {
  const ids = parseTextArray(order.shipping_method_ids_json);
  const titles = parseTextArray(order.shipping_method_titles_json);
  const pairs = ids.map((id, index) => ({
    id: textOrUnknown(id),
    title: nullableText(titles[index]),
  }));
  if (pairs.length === 0) return Object.freeze({ id: 'unknown', title: null });
  const unique = [...new Map(pairs.map((pair) => [pair.id, pair])).values()]
    .sort((left, right) => left.id.localeCompare(right.id));
  return Object.freeze({
    id: unique.map((pair) => pair.id).join('+'),
    title: unique.map((pair) => pair.title ?? pair.id).join(' + '),
  });
}

function applyOrderMetrics(summary, order) {
  if (order.status_class === 'recognized') summary.recognized_orders += 1;
  summary.recognized_revenue_micros += integer(order.recognized_revenue_micros);
  summary.refund_micros += integer(order.refund_micros);
}

function sortSummaries(byKey, keyField) {
  return [...byKey.values()]
    .map((row) => Object.freeze({ ...row }))
    .sort((left, right) => right.recognized_revenue_micros - left.recognized_revenue_micros
      || left[keyField].localeCompare(right[keyField]));
}

function resolveDataStatus(daily, products) {
  if (daily.length === 0) return 'no_data_confirmed';
  const statuses = new Set([
    ...daily.map((row) => row.data_status),
    ...products.map((row) => row.data_status),
  ]);
  if (statuses.has('source_unavailable')) return 'source_unavailable';
  if (statuses.has('partial') || statuses.has('revisable')) return 'partial';
  return 'complete';
}

function parseTextArray(value) {
  if (typeof value !== 'string' || value.trim() === '') return [];
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (cause) {
    throw permanentError('WooCommerce report contains invalid method JSON', {
      code: 'WOOCOMMERCE_REPORT_SOURCE_INVALID',
      cause,
    });
  }
  if (!Array.isArray(parsed)) {
    throw permanentError('WooCommerce report method JSON must be an array', {
      code: 'WOOCOMMERCE_REPORT_SOURCE_INVALID',
    });
  }
  return parsed.map((item) => String(item)).filter((item) => item.trim() !== '');
}

function latestText(values) {
  const filtered = values.filter((value) => typeof value === 'string' && value.trim() !== '');
  return filtered.length === 0 ? null : filtered.sort().at(-1);
}

function integer(value) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number)) {
    throw permanentError('WooCommerce report metric is not a safe integer', {
      code: 'WOOCOMMERCE_REPORT_SOURCE_INVALID',
    });
  }
  return number;
}

function textOrUnknown(value) {
  return nullableText(value) ?? 'unknown';
}

function nullableText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireMethods(value, methods, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${fieldName} is required`);
  for (const method of methods) {
    if (typeof value[method] !== 'function') throw new TypeError(`${fieldName}.${method} is required`);
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
