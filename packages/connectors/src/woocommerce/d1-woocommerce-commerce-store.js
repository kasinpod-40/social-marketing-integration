import { WOOCOMMERCE_D1_TABLE_CONTRACTS } from '../../../application/src/commerce/woocommerce-commerce-model.js';
import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';

const OBSERVATION_TABLES = new Set(['commerce_order_status_observations']);
const REQUIRED_TABLES = Object.freeze(Object.keys(WOOCOMMERCE_D1_TABLE_CONTRACTS));
const MAX_WRITE_ROWS = 5_000;

/**
 * Additive WooCommerce Commerce repository.
 * The shared runtime injects D1; this class does not create bindings, migrations or reliability state.
 */
export class D1WooCommerceCommerceStore {
  constructor(input = {}) {
    this.db = requireD1(input.db);
  }

  async assertSchemaReady() {
    const placeholders = REQUIRED_TABLES.map(() => '?').join(', ');
    let result;
    try {
      result = await this.db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name IN (${placeholders})
      `).bind(...REQUIRED_TABLES).all();
    } catch (cause) {
      throw transientError('WooCommerce D1 schema readiness check failed', {
        code: 'WOOCOMMERCE_D1_SCHEMA_CHECK_FAILED',
        cause,
      });
    }
    const found = new Set(readRows(result).map((row) => row?.name).filter(Boolean));
    const missing = REQUIRED_TABLES.filter((table) => !found.has(table));
    if (missing.length > 0) {
      throw permanentError('WooCommerce Commerce migration is not applied', {
        code: 'WOOCOMMERCE_D1_SCHEMA_NOT_READY',
        details: { missingTableCount: missing.length },
      });
    }
    return Object.freeze({ ready: true, tableCount: found.size });
  }

  async upsertRowsByTable(rowsByTable = {}) {
    if (!isPlainObject(rowsByTable)) {
      throw contractError('WooCommerce rowsByTable must be an object');
    }
    const results = {};
    let totalRows = 0;
    for (const [table, rows] of Object.entries(rowsByTable)) {
      if (!Array.isArray(rows) || rows.length === 0) continue;
      totalRows += rows.length;
      if (totalRows > MAX_WRITE_ROWS) {
        throw permanentError('WooCommerce D1 write batch exceeds the bounded row limit', {
          code: 'WOOCOMMERCE_D1_BATCH_TOO_LARGE',
          details: { totalRows, maxRows: MAX_WRITE_ROWS },
        });
      }
      results[table] = await this.#upsertTableRows(table, rows);
    }
    return Object.freeze({
      totalRows,
      tables: Object.freeze(results),
    });
  }

  async rebuildDerivedFacts(input = {}) {
    const accountKey = requireText(input.accountKey, 'accountKey');
    const dates = uniqueDates(input.metricDates ?? []);
    const customerAggregateKeys = uniqueTexts(input.customerAggregateKeys ?? []);
    const syncRunId = requireText(input.syncRunId, 'syncRunId');
    const coverageRunId = requireText(input.coverageRunId, 'coverageRunId');
    const now = nonNegativeInteger(input.now ?? Date.now(), 'now');
    let salesRows = 0;
    let productRows = 0;
    let customerRows = 0;

    for (const metricDate of dates) {
      salesRows += await this.#rebuildDailySales({ accountKey, metricDate, syncRunId, coverageRunId, now });
      productRows += await this.#rebuildProductDaily({ accountKey, metricDate, syncRunId, coverageRunId, now });
    }
    for (const aggregateKey of customerAggregateKeys) {
      customerRows += await this.#rebuildCustomerAggregate({
        accountKey,
        aggregateKey,
        syncRunId,
        coverageRunId,
        now,
      });
    }

    return Object.freeze({ salesRows, productRows, customerRows });
  }

  async readDerivedRows(input = {}) {
    const accountKey = requireText(input.accountKey, 'accountKey');
    const dates = uniqueDates(input.metricDates ?? []);
    const customerAggregateKeys = uniqueTexts(input.customerAggregateKeys ?? []);
    const sales = dates.length === 0
      ? []
      : await this.#selectByValues('commerce_daily_sales_facts', 'metric_date', dates, accountKey);
    const products = dates.length === 0
      ? []
      : await this.#selectByValues('commerce_product_daily_facts', 'metric_date', dates, accountKey);
    const customers = customerAggregateKeys.length === 0
      ? []
      : await this.#selectByValues(
        'commerce_customer_aggregates',
        'customer_aggregate_key',
        customerAggregateKeys,
        accountKey,
      );
    return Object.freeze({
      sales: Object.freeze(sales.map(freezeRow)),
      products: Object.freeze(products.map(freezeRow)),
      customers: Object.freeze(customers.map(freezeRow)),
    });
  }

  async #upsertTableRows(table, rows) {
    const contract = WOOCOMMERCE_D1_TABLE_CONTRACTS[table];
    if (!contract) {
      throw permanentError('WooCommerce D1 table is not allowlisted', {
        code: 'WOOCOMMERCE_D1_TABLE_NOT_ALLOWED',
        details: { table },
      });
    }
    const columns = contract.columns;
    const keyField = contract.keyField;
    const updates = columns
      .filter((column) => column !== keyField && column !== 'created_at')
      .map((column) => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`)
      .join(',\n          ');
    const conflictAction = OBSERVATION_TABLES.has(table)
      ? 'DO NOTHING'
      : `DO UPDATE SET\n          ${updates}`;
    const statement = `
      INSERT INTO ${quoteIdentifier(table)} (
        ${columns.map(quoteIdentifier).join(', ')}
      ) VALUES (${columns.map(() => '?').join(', ')})
      ON CONFLICT(${quoteIdentifier(keyField)}) ${conflictAction}
    `;
    const counts = { written: 0, skipped: 0 };
    for (const row of rows) {
      validateRow(table, row, contract);
      let result;
      try {
        result = await this.db.prepare(statement).bind(...columns.map((column) => normalizeBind(row[column]))).run();
      } catch (cause) {
        throw transientError('WooCommerce D1 row write failed', {
          code: 'WOOCOMMERCE_D1_WRITE_FAILED',
          cause,
          details: { table },
        });
      }
      if (readChanges(result) > 0) counts.written += 1;
      else counts.skipped += 1;
    }
    return Object.freeze({ expected: rows.length, ...counts });
  }

  async #rebuildDailySales(input) {
    const keyPrefix = `woocommerce:${input.accountKey}:${input.metricDate}:`;
    return this.#runMutation(`
      INSERT INTO commerce_daily_sales_facts (
        commerce_daily_key, customer_key, account_key, platform, metric_date, currency,
        gross_sales_micros, discount_micros, refund_micros, net_sales_micros,
        shipping_micros, tax_micros, recognized_revenue_micros, recognized_orders,
        provisional_orders, cancelled_orders, failed_orders, refunded_orders,
        quantity_total, data_status, coverage_run_id, source_revision, sync_run_id,
        created_at, updated_at
      )
      SELECT
        ? || currency,
        MIN(customer_key),
        account_key,
        'woocommerce',
        metric_date,
        currency,
        SUM(CASE WHEN status_class = 'recognized' THEN gross_sales_micros ELSE 0 END),
        SUM(CASE WHEN status_class = 'recognized' THEN discount_micros ELSE 0 END),
        SUM(refund_micros),
        SUM(CASE WHEN status_class = 'recognized' THEN net_sales_micros ELSE -refund_micros END),
        SUM(CASE WHEN status_class = 'recognized' THEN shipping_micros ELSE 0 END),
        SUM(CASE WHEN status_class = 'recognized' THEN tax_micros ELSE 0 END),
        SUM(recognized_revenue_micros),
        SUM(recognized_order_count),
        SUM(provisional_order_count),
        SUM(CASE WHEN status_class = 'cancelled' THEN 1 ELSE 0 END),
        SUM(CASE WHEN status_class = 'failed' THEN 1 ELSE 0 END),
        SUM(CASE WHEN status = 'refunded' OR refund_micros > 0 THEN 1 ELSE 0 END),
        SUM(CASE WHEN status_class = 'recognized' THEN quantity_total ELSE 0 END),
        'complete',
        ?,
        CAST(MAX(source_modified_at) AS TEXT),
        ?,
        ?,
        ?
      FROM commerce_order_state
      WHERE account_key = ? AND metric_date = ?
      GROUP BY account_key, metric_date, currency
      ON CONFLICT(commerce_daily_key) DO UPDATE SET
        customer_key = excluded.customer_key,
        gross_sales_micros = excluded.gross_sales_micros,
        discount_micros = excluded.discount_micros,
        refund_micros = excluded.refund_micros,
        net_sales_micros = excluded.net_sales_micros,
        shipping_micros = excluded.shipping_micros,
        tax_micros = excluded.tax_micros,
        recognized_revenue_micros = excluded.recognized_revenue_micros,
        recognized_orders = excluded.recognized_orders,
        provisional_orders = excluded.provisional_orders,
        cancelled_orders = excluded.cancelled_orders,
        failed_orders = excluded.failed_orders,
        refunded_orders = excluded.refunded_orders,
        quantity_total = excluded.quantity_total,
        data_status = excluded.data_status,
        coverage_run_id = excluded.coverage_run_id,
        source_revision = excluded.source_revision,
        sync_run_id = excluded.sync_run_id,
        updated_at = excluded.updated_at
    `, [
      keyPrefix,
      input.coverageRunId,
      input.syncRunId,
      input.now,
      input.now,
      input.accountKey,
      input.metricDate,
    ], 'WOOCOMMERCE_D1_DAILY_REBUILD_FAILED');
  }

  async #rebuildProductDaily(input) {
    return this.#runMutation(`
      INSERT INTO commerce_product_daily_facts (
        product_daily_key, product_key, customer_key, account_key, platform, metric_date,
        currency, quantity_ordered, gross_sales_micros, discount_micros, refund_micros,
        net_sales_micros, recognized_orders, data_status, coverage_run_id,
        source_revision, sync_run_id, created_at, updated_at
      )
      SELECT
        line.product_key || ':' || line.metric_date || ':' || line.currency,
        line.product_key,
        MIN(line.customer_key),
        line.account_key,
        'woocommerce',
        line.metric_date,
        line.currency,
        SUM(CASE WHEN orders.status_class = 'recognized' THEN line.quantity ELSE 0 END),
        SUM(CASE WHEN orders.status_class = 'recognized' THEN line.gross_sales_micros ELSE 0 END),
        SUM(CASE WHEN orders.status_class = 'recognized' THEN line.discount_micros ELSE 0 END),
        SUM(line.refund_micros),
        SUM(CASE WHEN orders.status_class = 'recognized' THEN line.net_sales_micros ELSE -line.refund_micros END),
        COUNT(DISTINCT CASE WHEN orders.status_class = 'recognized' THEN line.order_key END),
        'complete',
        ?,
        CAST(MAX(orders.source_modified_at) AS TEXT),
        ?,
        ?,
        ?
      FROM commerce_order_line_facts AS line
      INNER JOIN commerce_order_state AS orders ON orders.order_key = line.order_key
      WHERE line.account_key = ? AND line.metric_date = ?
      GROUP BY line.product_key, line.account_key, line.metric_date, line.currency
      ON CONFLICT(product_daily_key) DO UPDATE SET
        customer_key = excluded.customer_key,
        quantity_ordered = excluded.quantity_ordered,
        gross_sales_micros = excluded.gross_sales_micros,
        discount_micros = excluded.discount_micros,
        refund_micros = excluded.refund_micros,
        net_sales_micros = excluded.net_sales_micros,
        recognized_orders = excluded.recognized_orders,
        data_status = excluded.data_status,
        coverage_run_id = excluded.coverage_run_id,
        source_revision = excluded.source_revision,
        sync_run_id = excluded.sync_run_id,
        updated_at = excluded.updated_at
    `, [
      input.coverageRunId,
      input.syncRunId,
      input.now,
      input.now,
      input.accountKey,
      input.metricDate,
    ], 'WOOCOMMERCE_D1_PRODUCT_DAILY_REBUILD_FAILED');
  }

  async #rebuildCustomerAggregate(input) {
    return this.#runMutation(`
      INSERT INTO commerce_customer_aggregates (
        customer_aggregate_key, customer_key, account_key, platform, external_customer_id,
        customer_type, orders_count, total_spent_micros, currency, first_order_at,
        last_order_at, source_created_at, source_modified_at, last_coverage_run_id,
        last_sync_run_id, created_at, updated_at
      )
      SELECT
        ?,
        MIN(customer_key),
        account_key,
        'woocommerce',
        external_customer_id,
        'registered',
        SUM(recognized_order_count),
        SUM(recognized_revenue_micros),
        currency,
        MIN(CASE WHEN status_class = 'recognized' THEN source_created_at END),
        MAX(CASE WHEN status_class = 'recognized' THEN source_created_at END),
        MIN(source_created_at),
        MAX(source_modified_at),
        ?,
        ?,
        ?,
        ?
      FROM commerce_order_state
      WHERE account_key = ?
        AND customer_type = 'registered'
        AND ('woocommerce:' || account_key || ':registered:' || external_customer_id) = ?
      GROUP BY account_key, external_customer_id, currency
      ON CONFLICT(customer_aggregate_key) DO UPDATE SET
        customer_key = excluded.customer_key,
        orders_count = excluded.orders_count,
        total_spent_micros = excluded.total_spent_micros,
        currency = excluded.currency,
        first_order_at = excluded.first_order_at,
        last_order_at = excluded.last_order_at,
        source_created_at = excluded.source_created_at,
        source_modified_at = excluded.source_modified_at,
        last_coverage_run_id = excluded.last_coverage_run_id,
        last_sync_run_id = excluded.last_sync_run_id,
        updated_at = excluded.updated_at
    `, [
      input.aggregateKey,
      input.coverageRunId,
      input.syncRunId,
      input.now,
      input.now,
      input.accountKey,
      input.aggregateKey,
    ], 'WOOCOMMERCE_D1_CUSTOMER_REBUILD_FAILED');
  }

  async #selectByValues(table, field, values, accountKey) {
    const contract = WOOCOMMERCE_D1_TABLE_CONTRACTS[table];
    if (!contract || !contract.columns.includes(field)) {
      throw permanentError('WooCommerce D1 read contract is invalid', {
        code: 'WOOCOMMERCE_D1_READ_CONTRACT_INVALID',
        details: { table, field },
      });
    }
    const placeholders = values.map(() => '?').join(', ');
    let result;
    try {
      result = await this.db.prepare(`
        SELECT ${contract.columns.map(quoteIdentifier).join(', ')}
        FROM ${quoteIdentifier(table)}
        WHERE account_key = ? AND ${quoteIdentifier(field)} IN (${placeholders})
        ORDER BY ${quoteIdentifier(field)} ASC
      `).bind(accountKey, ...values).all();
    } catch (cause) {
      throw transientError('WooCommerce derived D1 read failed', {
        code: 'WOOCOMMERCE_D1_READ_FAILED',
        cause,
        details: { table },
      });
    }
    return readRows(result);
  }

  async #runMutation(sql, bindings, code) {
    try {
      const result = await this.db.prepare(sql).bind(...bindings).run();
      return readChanges(result);
    } catch (cause) {
      throw transientError('WooCommerce D1 derived fact rebuild failed', {
        code,
        cause,
      });
    }
  }
}

function validateRow(table, row, contract) {
  if (!isPlainObject(row)) throw contractError(`WooCommerce ${table} row must be an object`);
  const unexpected = Object.keys(row).filter((field) => !contract.columns.includes(field));
  if (unexpected.length > 0) {
    throw permanentError('WooCommerce D1 row contains non-allowlisted fields', {
      code: 'WOOCOMMERCE_D1_ROW_INVALID',
      details: { table, unexpectedFieldCount: unexpected.length },
    });
  }
  const key = row[contract.keyField];
  if (typeof key !== 'string' || key.trim() === '') {
    throw permanentError('WooCommerce D1 row is missing its Stable key', {
      code: 'WOOCOMMERCE_D1_ROW_INVALID',
      details: { table, keyField: contract.keyField },
    });
  }
  for (const column of contract.columns) {
    if (!(column in row)) {
      throw permanentError('WooCommerce D1 row is missing an allowlisted column', {
        code: 'WOOCOMMERCE_D1_ROW_INVALID',
        details: { table, fieldName: column },
      });
    }
  }
}

function uniqueDates(values) {
  const dates = uniqueTexts(values);
  for (const value of dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw contractError('WooCommerce metric date must be YYYY-MM-DD');
  }
  return dates;
}

function uniqueTexts(values) {
  if (!Array.isArray(values)) throw contractError('WooCommerce value list must be an array');
  return [...new Set(values.map((value) => requireText(value, 'value')))].sort();
}

function quoteIdentifier(value) {
  const text = requireText(value, 'identifier');
  if (!/^[a-z][a-z0-9_]*$/u.test(text)) throw contractError('WooCommerce SQL identifier is invalid');
  return `"${text}"`;
}

function normalizeBind(value) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'bigint') {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw contractError('WooCommerce bigint exceeds D1 integer range');
    return number;
  }
  if (value !== null && typeof value === 'object') {
    throw contractError('WooCommerce D1 row values must be scalar');
  }
  return value;
}

function readChanges(result) {
  const value = result?.meta?.changes ?? result?.changes ?? 0;
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function readRows(result) {
  const rows = result?.results ?? result?.rows ?? [];
  return Array.isArray(rows) ? rows : [];
}

function freezeRow(row) {
  return Object.freeze({ ...row });
}

function requireD1(value) {
  if (!value || typeof value.prepare !== 'function') {
    throw permanentError('WooCommerce D1 binding is unavailable', {
      code: 'WOOCOMMERCE_D1_BINDING_MISSING',
    });
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw contractError(`WooCommerce requires ${fieldName}`);
  return value.trim();
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw contractError(`WooCommerce ${fieldName} must be non-negative`);
  return number;
}

function contractError(message) {
  return permanentError(message, { code: 'WOOCOMMERCE_D1_CONTRACT_INVALID' });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
