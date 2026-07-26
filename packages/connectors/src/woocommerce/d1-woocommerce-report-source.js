import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';

const MAX_RANGE_DAYS = 366;
const MAX_PRODUCT_ROWS = 5_000;
const MAX_ORDER_ROWS = 20_000;

/** Read-only D1 source for deterministic WooCommerce commerce reports. */
export class D1WooCommerceReportSource {
  constructor(input = {}) {
    this.db = requireD1(input.db);
  }

  async loadRange(input = {}) {
    const accountKey = requireText(input.accountKey, 'accountKey');
    const periodStart = requireDate(input.periodStart, 'periodStart');
    const periodEnd = requireDate(input.periodEnd, 'periodEnd');
    const currency = requireCurrency(input.currency);
    assertRange(periodStart, periodEnd);

    const [daily, products, orders] = await Promise.all([
      this.#all(`
        SELECT *
        FROM commerce_daily_sales_facts
        WHERE account_key = ? AND currency = ? AND metric_date BETWEEN ? AND ?
        ORDER BY metric_date ASC
      `, [accountKey, currency, periodStart, periodEnd], 'WOOCOMMERCE_REPORT_DAILY_READ_FAILED'),
      this.#all(`
        SELECT
          product_key,
          SUM(quantity_ordered) AS quantity_ordered,
          SUM(gross_sales_micros) AS gross_sales_micros,
          SUM(discount_micros) AS discount_micros,
          SUM(refund_micros) AS refund_micros,
          SUM(net_sales_micros) AS net_sales_micros,
          SUM(recognized_orders) AS recognized_orders,
          MIN(data_status) AS data_status,
          MAX(source_revision) AS source_revision
        FROM commerce_product_daily_facts
        WHERE account_key = ? AND currency = ? AND metric_date BETWEEN ? AND ?
        GROUP BY product_key
        ORDER BY net_sales_micros DESC, product_key ASC
        LIMIT ?
      `, [accountKey, currency, periodStart, periodEnd, MAX_PRODUCT_ROWS], 'WOOCOMMERCE_REPORT_PRODUCT_READ_FAILED'),
      this.#all(`
        SELECT
          order_key, metric_date, status, status_class, payment_method_id,
          payment_method_title, shipping_method_ids_json, shipping_method_titles_json,
          recognized_revenue_micros, refund_micros
        FROM commerce_order_state
        WHERE account_key = ? AND currency = ? AND metric_date BETWEEN ? AND ?
        ORDER BY metric_date ASC, order_key ASC
        LIMIT ?
      `, [accountKey, currency, periodStart, periodEnd, MAX_ORDER_ROWS], 'WOOCOMMERCE_REPORT_ORDER_READ_FAILED'),
    ]);

    if (orders.length >= MAX_ORDER_ROWS) {
      throw permanentError('WooCommerce report Order source exceeds the bounded row limit', {
        code: 'WOOCOMMERCE_REPORT_SOURCE_TOO_LARGE',
        details: { maxRows: MAX_ORDER_ROWS },
      });
    }

    return Object.freeze({
      accountKey,
      currency,
      periodStart,
      periodEnd,
      daily: Object.freeze(daily.map(freezeRow)),
      products: Object.freeze(products.map(freezeRow)),
      orders: Object.freeze(orders.map(freezeRow)),
    });
  }

  async #all(sql, bindings, code) {
    try {
      const result = await this.db.prepare(sql).bind(...bindings).all();
      const rows = result?.results ?? result?.rows ?? [];
      if (!Array.isArray(rows)) {
        throw new TypeError('D1 query result rows must be an array');
      }
      return rows;
    } catch (cause) {
      throw transientError('WooCommerce D1 report source read failed', {
        code,
        cause,
      });
    }
  }
}

function assertRange(start, end) {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (startMs > endMs) {
    throw permanentError('WooCommerce report period_start cannot be after period_end', {
      code: 'WOOCOMMERCE_REPORT_RANGE_INVALID',
    });
  }
  const days = Math.floor((endMs - startMs) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) {
    throw permanentError('WooCommerce report range exceeds the bounded day limit', {
      code: 'WOOCOMMERCE_REPORT_RANGE_TOO_LARGE',
      details: { days, maxDays: MAX_RANGE_DAYS },
    });
  }
}

function requireD1(value) {
  if (!value || typeof value.prepare !== 'function') {
    throw permanentError('WooCommerce report D1 binding is unavailable', {
      code: 'WOOCOMMERCE_REPORT_D1_BINDING_MISSING',
    });
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw permanentError(`WooCommerce report requires ${fieldName}`, {
      code: 'WOOCOMMERCE_REPORT_INPUT_INVALID',
      details: { fieldName },
    });
  }
  return value.trim();
}

function requireDate(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw permanentError(`WooCommerce report ${fieldName} must be YYYY-MM-DD`, {
      code: 'WOOCOMMERCE_REPORT_INPUT_INVALID',
      details: { fieldName },
    });
  }
  return text;
}

function requireCurrency(value) {
  const text = requireText(value, 'currency').toUpperCase();
  if (!/^[A-Z]{3}$/u.test(text)) {
    throw permanentError('WooCommerce report currency must be an ISO 4217 code', {
      code: 'WOOCOMMERCE_REPORT_INPUT_INVALID',
      details: { fieldName: 'currency' },
    });
  }
  return text;
}

function freezeRow(row) {
  return Object.freeze({ ...row });
}
