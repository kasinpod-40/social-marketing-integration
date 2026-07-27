import { WOOCOMMERCE_D1_TABLE_CONTRACTS } from '../../../application/src/commerce/woocommerce-commerce-model.js';
import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';

const REQUIRED_TABLES = Object.freeze(Object.keys(WOOCOMMERCE_D1_TABLE_CONTRACTS));
const APPEND_ONLY_TABLES = new Set(['commerce_order_status_observations']);
const REVISION_GATED_TABLES = Object.freeze({
  raw_commerce_orders: 'source_modified_at',
  raw_commerce_products: 'source_modified_at',
  raw_commerce_product_variations: 'source_modified_at',
  raw_commerce_customers: 'source_modified_at',
  raw_commerce_coupons: 'source_modified_at',
  commerce_order_state: 'source_modified_at',
  commerce_product_state: 'source_modified_at',
  commerce_customer_aggregates: 'source_modified_at',
});
const ORDER_BUNDLE_TABLES = new Set([
  'raw_commerce_orders',
  'commerce_order_state',
  'raw_commerce_order_items',
  'commerce_order_line_facts',
  'commerce_order_status_observations',
  'raw_commerce_refunds',
]);
const MAX_WRITE_ROWS = 5_000;
const DERIVED_STATUSES = new Set(['partial', 'revisable', 'complete']);

/**
 * Additive WooCommerce Commerce repository.
 * Shared runtime supplies D1 and owns Reliability, locks, Queue and DLQ.
 */
export class D1WooCommerceCommerceStore {
  constructor(input = {}) {
    this.db = requireD1(input.db);
  }

  async assertSchemaReady() {
    const placeholders = REQUIRED_TABLES.map(() => '?').join(', ');
    const result = await this.#all(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name IN (${placeholders})
    `, REQUIRED_TABLES, 'WOOCOMMERCE_D1_SCHEMA_CHECK_FAILED');
    const found = new Set(result.map((row) => row?.name).filter(Boolean));
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
    if (!isPlainObject(rowsByTable)) throw contractError('rowsByTable must be an object');
    const totalRows = Object.values(rowsByTable).reduce((total, rows) => {
      if (rows === undefined) return total;
      if (!Array.isArray(rows)) throw contractError('every rowsByTable value must be an array');
      return total + rows.length;
    }, 0);
    if (totalRows > MAX_WRITE_ROWS) {
      throw permanentError('WooCommerce D1 write batch exceeds the bounded row limit', {
        code: 'WOOCOMMERCE_D1_BATCH_TOO_LARGE',
        details: { totalRows, maxRows: MAX_WRITE_ROWS },
      });
    }

    const tables = {};
    const orderResult = await this.#upsertOrderBundles(rowsByTable);
    for (const [table, result] of Object.entries(orderResult)) tables[table] = result;

    for (const [table, rows] of Object.entries(rowsByTable)) {
      if (ORDER_BUNDLE_TABLES.has(table) || rows.length === 0) continue;
      tables[table] = await this.#upsertTable(table, rows);
    }
    return Object.freeze({ totalRows, tables: Object.freeze(tables) });
  }

  async rebuildDerivedFacts(input = {}) {
    const context = derivedContext(input);
    let salesRows = 0;
    let productRows = 0;
    let customerRows = 0;
    for (const metricDate of context.metricDates) {
      salesRows += await this.#rebuildDailySales({ ...context, metricDate });
      productRows += await this.#rebuildProductDaily({ ...context, metricDate });
    }
    for (const customerAggregateKey of context.customerAggregateKeys) {
      customerRows += await this.#rebuildCustomerAggregate({
        ...context,
        customerAggregateKey,
      });
    }
    return Object.freeze({ salesRows, productRows, customerRows });
  }

  async finalizeOrderDerivedFacts(input = {}) {
    const accountKey = requireText(input.accountKey, 'accountKey');
    const coverageRunId = requireText(input.coverageRunId, 'coverageRunId');
    const dataStatus = requireDerivedStatus(input.dataStatus);
    const now = nonNegativeInteger(input.now ?? Date.now(), 'now');
    const statements = [
      this.db.prepare(`
        UPDATE commerce_daily_sales_facts
        SET data_status = ?, updated_at = ?
        WHERE account_key = ? AND coverage_run_id = ?
      `).bind(dataStatus, now, accountKey, coverageRunId),
      this.db.prepare(`
        UPDATE commerce_product_daily_facts
        SET data_status = ?, updated_at = ?
        WHERE account_key = ? AND coverage_run_id = ?
      `).bind(dataStatus, now, accountKey, coverageRunId),
    ];
    const results = await this.#batch(
      statements,
      'WOOCOMMERCE_D1_DERIVED_FINALIZE_FAILED',
    );
    return Object.freeze({
      salesRows: readChanges(results[0]),
      productRows: readChanges(results[1]),
      dataStatus,
    });
  }

  async readDerivedRows(input = {}) {
    const accountKey = requireText(input.accountKey, 'accountKey');
    const metricDates = uniqueDates(input.metricDates ?? []);
    const customerAggregateKeys = uniqueTexts(input.customerAggregateKeys ?? []);
    const sales = metricDates.length === 0 ? [] : await this.#selectByValues(
      'commerce_daily_sales_facts', 'metric_date', metricDates, accountKey,
    );
    const products = metricDates.length === 0 ? [] : await this.#selectByValues(
      'commerce_product_daily_facts', 'metric_date', metricDates, accountKey,
    );
    const customers = customerAggregateKeys.length === 0 ? [] : await this.#selectByValues(
      'commerce_customer_aggregates', 'customer_aggregate_key', customerAggregateKeys, accountKey,
    );
    return Object.freeze({
      sales: Object.freeze(sales.map(freezeRow)),
      products: Object.freeze(products.map(freezeRow)),
      customers: Object.freeze(customers.map(freezeRow)),
    });
  }

  async #upsertOrderBundles(rowsByTable) {
    const rawOrders = rowsByTable.raw_commerce_orders ?? [];
    const orderStates = rowsByTable.commerce_order_state ?? [];
    const rawItems = rowsByTable.raw_commerce_order_items ?? [];
    const orderLines = rowsByTable.commerce_order_line_facts ?? [];
    const observations = rowsByTable.commerce_order_status_observations ?? [];
    const refunds = rowsByTable.raw_commerce_refunds ?? [];
    const hasOrderRows = [rawOrders, orderStates, rawItems, orderLines, observations, refunds]
      .some((rows) => rows.length > 0);
    if (!hasOrderRows) return Object.freeze({});
    if (rawOrders.length !== orderStates.length || (orderStates.length === 0 && hasOrderRows)) {
      throw permanentError('WooCommerce Order bundle requires matching RAW and Canonical parents', {
        code: 'WOOCOMMERCE_D1_ORDER_BUNDLE_INVALID',
        details: { rawOrders: rawOrders.length, orderStates: orderStates.length },
      });
    }

    const rawByKey = new Map(rawOrders.map((row) => [row.raw_order_key, row]));
    const itemsByOrder = groupBy(rawItems, 'raw_order_key');
    const linesByOrder = groupBy(orderLines, 'order_key');
    const observationsByOrder = groupBy(observations, 'order_key');
    const refundsByOrder = groupBy(refunds, 'raw_order_key');
    const counts = new Map();

    for (const orderState of orderStates) {
      const orderKey = requireText(orderState?.order_key, 'order_key');
      const rawOrder = rawByKey.get(orderKey);
      if (!rawOrder) {
        throw permanentError('WooCommerce Order bundle is missing its RAW parent', {
          code: 'WOOCOMMERCE_D1_ORDER_BUNDLE_INVALID',
          details: { orderKey },
        });
      }
      const bundle = Object.freeze({
        rawOrder,
        orderState,
        rawItems: itemsByOrder.get(orderKey) ?? [],
        orderLines: linesByOrder.get(orderKey) ?? [],
        observations: observationsByOrder.get(orderKey) ?? [],
        refunds: refundsByOrder.get(orderKey) ?? [],
      });
      validateBundle(bundle);
      const currentVersion = await this.#currentOrderVersion(orderKey);
      const incomingRevision = nonNegativeInteger(orderState.source_modified_at, 'source_modified_at');
      const incomingHash = requireText(orderState.source_payload_hash, 'source_payload_hash');
      if (currentVersion !== null && (currentVersion.revision > incomingRevision
        || (currentVersion.revision === incomingRevision && currentVersion.hash === incomingHash))) {
        recordBundleCounts(counts, bundle, false);
        continue;
      }

      const statements = [
        this.#upsertStatement('raw_commerce_orders', rawOrder),
        this.#upsertStatement('commerce_order_state', orderState),
        this.db.prepare('DELETE FROM raw_commerce_order_items WHERE raw_order_key = ?').bind(orderKey),
        this.db.prepare('DELETE FROM commerce_order_line_facts WHERE order_key = ?').bind(orderKey),
        ...bundle.rawItems.map((row) => this.#upsertStatement('raw_commerce_order_items', row)),
        ...bundle.orderLines.map((row) => this.#upsertStatement('commerce_order_line_facts', row)),
        ...bundle.observations.map((row) => this.#upsertStatement(
          'commerce_order_status_observations', row,
        )),
        ...bundle.refunds.map((row) => this.#upsertStatement('raw_commerce_refunds', row)),
      ];
      await this.#batch(statements, 'WOOCOMMERCE_D1_ORDER_BUNDLE_WRITE_FAILED', { orderKey });
      recordBundleCounts(counts, bundle, true);
    }

    const result = {};
    for (const [table, value] of counts.entries()) result[table] = Object.freeze(value);
    return Object.freeze(result);
  }

  async #currentOrderVersion(orderKey) {
    const rows = await this.#all(`
      SELECT source_modified_at, source_payload_hash
      FROM commerce_order_state
      WHERE order_key = ?
      LIMIT 1
    `, [orderKey], 'WOOCOMMERCE_D1_ORDER_REVISION_READ_FAILED', { orderKey });
    if (rows.length === 0) return null;
    const revision = Number(rows[0]?.source_modified_at);
    if (!Number.isSafeInteger(revision) || revision < 0) return null;
    return Object.freeze({
      revision,
      hash: requireText(rows[0]?.source_payload_hash, 'source_payload_hash'),
    });
  }

  async #upsertTable(table, rows) {
    const contract = tableContract(table);
    let written = 0;
    let skipped = 0;
    for (const row of rows) {
      validateRow(table, row, contract);
      const result = await this.#run(
        this.#upsertSql(table),
        contract.columns.map((column) => bindValue(row[column])),
        'WOOCOMMERCE_D1_WRITE_FAILED',
        { table },
      );
      if (result > 0) written += 1;
      else skipped += 1;
    }
    return Object.freeze({ expected: rows.length, written, skipped });
  }

  #upsertStatement(table, row) {
    const contract = tableContract(table);
    validateRow(table, row, contract);
    return this.db.prepare(this.#upsertSql(table)).bind(
      ...contract.columns.map((column) => bindValue(row[column])),
    );
  }

  #upsertSql(table) {
    const contract = tableContract(table);
    const { keyField, columns } = contract;
    const updates = columns
      .filter((column) => column !== keyField && column !== 'created_at')
      .map((column) => `${quote(column)} = excluded.${quote(column)}`)
      .join(', ');
    let conflict = APPEND_ONLY_TABLES.has(table)
      ? 'DO NOTHING'
      : `DO UPDATE SET ${updates}`;
    const revisionColumn = REVISION_GATED_TABLES[table];
    if (!APPEND_ONLY_TABLES.has(table) && revisionColumn) {
      const sameRevisionGuard = contract.columns.includes('source_payload_hash')
        ? ` AND excluded.${quote('source_payload_hash')} <> ${quote(table)}.${quote('source_payload_hash')}`
        : '';
      conflict += ` WHERE excluded.${quote(revisionColumn)} IS NOT NULL
        AND (${quote(table)}.${quote(revisionColumn)} IS NULL
          OR excluded.${quote(revisionColumn)} > ${quote(table)}.${quote(revisionColumn)}
          OR (excluded.${quote(revisionColumn)} = ${quote(table)}.${quote(revisionColumn)}${sameRevisionGuard}))`;
    }
    return `
      INSERT INTO ${quote(table)} (${columns.map(quote).join(', ')})
      VALUES (${columns.map(() => '?').join(', ')})
      ON CONFLICT(${quote(keyField)}) ${conflict}
    `;
  }

  async #rebuildDailySales(input) {
    const deleteStatement = this.db.prepare(`
      DELETE FROM commerce_daily_sales_facts
      WHERE account_key = ? AND metric_date = ?
    `).bind(input.accountKey, input.metricDate);
    const insertStatement = this.db.prepare(`
      INSERT INTO commerce_daily_sales_facts (
        commerce_daily_key, customer_key, account_key, platform, metric_date, currency,
        gross_sales_micros, discount_micros, refund_micros, net_sales_micros,
        shipping_micros, tax_micros, recognized_revenue_micros, recognized_orders,
        provisional_orders, cancelled_orders, failed_orders, refunded_orders,
        quantity_total, data_status, coverage_run_id, source_revision, sync_run_id,
        created_at, updated_at
      )
      SELECT
        'woocommerce:' || account_key || ':' || metric_date || ':' || currency,
        MIN(customer_key), account_key, 'woocommerce', metric_date, currency,
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
        ?, ?, CAST(MAX(source_modified_at) AS TEXT), ?, ?, ?
      FROM commerce_order_state
      WHERE account_key = ? AND metric_date = ?
      GROUP BY account_key, metric_date, currency
    `).bind(
      input.dataStatus,
      input.coverageRunId,
      input.syncRunId,
      input.now,
      input.now,
      input.accountKey,
      input.metricDate,
    );
    const results = await this.#batch(
      [deleteStatement, insertStatement],
      'WOOCOMMERCE_D1_DAILY_REBUILD_FAILED',
    );
    return readChanges(results[1]);
  }

  async #rebuildProductDaily(input) {
    const deleteStatement = this.db.prepare(`
      DELETE FROM commerce_product_daily_facts
      WHERE account_key = ? AND metric_date = ?
    `).bind(input.accountKey, input.metricDate);
    const insertStatement = this.db.prepare(`
      INSERT INTO commerce_product_daily_facts (
        product_daily_key, product_key, customer_key, account_key, platform, metric_date,
        currency, quantity_ordered, gross_sales_micros, discount_micros, refund_micros,
        net_sales_micros, recognized_orders, data_status, coverage_run_id,
        source_revision, sync_run_id, created_at, updated_at
      )
      SELECT
        line.product_key || ':' || line.metric_date || ':' || line.currency,
        line.product_key, MIN(line.customer_key), line.account_key, 'woocommerce',
        line.metric_date, line.currency,
        SUM(CASE WHEN orders.status_class = 'recognized' THEN line.quantity ELSE 0 END),
        SUM(CASE WHEN orders.status_class = 'recognized' THEN line.gross_sales_micros ELSE 0 END),
        SUM(CASE WHEN orders.status_class = 'recognized' THEN line.discount_micros ELSE 0 END),
        SUM(line.refund_micros),
        SUM(CASE WHEN orders.status_class = 'recognized' THEN line.net_sales_micros ELSE -line.refund_micros END),
        COUNT(DISTINCT CASE WHEN orders.status_class = 'recognized' THEN line.order_key END),
        ?, ?, CAST(MAX(orders.source_modified_at) AS TEXT), ?, ?, ?
      FROM commerce_order_line_facts AS line
      INNER JOIN commerce_order_state AS orders ON orders.order_key = line.order_key
      WHERE line.account_key = ? AND line.metric_date = ?
      GROUP BY line.product_key, line.account_key, line.metric_date, line.currency
    `).bind(
      input.dataStatus,
      input.coverageRunId,
      input.syncRunId,
      input.now,
      input.now,
      input.accountKey,
      input.metricDate,
    );
    const results = await this.#batch(
      [deleteStatement, insertStatement],
      'WOOCOMMERCE_D1_PRODUCT_DAILY_REBUILD_FAILED',
    );
    return readChanges(results[1]);
  }

  async #rebuildCustomerAggregate(input) {
    return this.#run(`
      INSERT INTO commerce_customer_aggregates (
        customer_aggregate_key, customer_key, account_key, platform, external_customer_id,
        customer_type, orders_count, total_spent_micros, currency, first_order_at,
        last_order_at, source_created_at, source_modified_at, last_coverage_run_id,
        last_sync_run_id, created_at, updated_at
      )
      SELECT
        ?, MIN(customer_key), account_key, 'woocommerce', external_customer_id,
        'registered', SUM(recognized_order_count), SUM(recognized_revenue_micros), currency,
        MIN(CASE WHEN status_class = 'recognized' THEN source_created_at END),
        MAX(CASE WHEN status_class = 'recognized' THEN source_created_at END),
        MIN(source_created_at), MAX(source_modified_at), ?, ?, ?, ?
      FROM commerce_order_state
      WHERE account_key = ?
        AND customer_type = 'registered'
        AND ('woocommerce:' || account_key || ':registered:' || external_customer_id || ':' || currency) = ?
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
      input.customerAggregateKey,
      input.coverageRunId,
      input.syncRunId,
      input.now,
      input.now,
      input.accountKey,
      input.customerAggregateKey,
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
    return this.#all(`
      SELECT ${contract.columns.map(quote).join(', ')}
      FROM ${quote(table)}
      WHERE account_key = ? AND ${quote(field)} IN (${values.map(() => '?').join(', ')})
      ORDER BY ${quote(field)} ASC
    `, [accountKey, ...values], 'WOOCOMMERCE_D1_READ_FAILED', { table });
  }

  async #run(sql, bindings, code, details = undefined) {
    try {
      const result = await this.db.prepare(sql).bind(...bindings).run();
      return readChanges(result);
    } catch (cause) {
      throw transientError('WooCommerce D1 mutation failed', { code, cause, details });
    }
  }

  async #batch(statements, code, details = undefined) {
    try {
      return await this.db.batch(statements);
    } catch (cause) {
      throw transientError('WooCommerce D1 transactional mutation failed', {
        code,
        cause,
        details,
      });
    }
  }

  async #all(sql, bindings, code, details = undefined) {
    try {
      const result = await this.db.prepare(sql).bind(...bindings).all();
      return readRows(result);
    } catch (cause) {
      throw transientError('WooCommerce D1 read failed', { code, cause, details });
    }
  }
}

function derivedContext(input) {
  return Object.freeze({
    accountKey: requireText(input.accountKey, 'accountKey'),
    metricDates: uniqueDates(input.metricDates ?? []),
    customerAggregateKeys: uniqueTexts(input.customerAggregateKeys ?? []),
    syncRunId: requireText(input.syncRunId, 'syncRunId'),
    coverageRunId: requireText(input.coverageRunId, 'coverageRunId'),
    dataStatus: requireDerivedStatus(input.dataStatus ?? 'partial'),
    now: nonNegativeInteger(input.now ?? Date.now(), 'now'),
  });
}

function requireDerivedStatus(value) {
  const status = requireText(value, 'dataStatus');
  if (!DERIVED_STATUSES.has(status)) throw contractError('dataStatus is invalid');
  return status;
}

function validateBundle(bundle) {
  validateRow('raw_commerce_orders', bundle.rawOrder, tableContract('raw_commerce_orders'));
  validateRow('commerce_order_state', bundle.orderState, tableContract('commerce_order_state'));
  for (const row of bundle.rawItems) {
    validateRow('raw_commerce_order_items', row, tableContract('raw_commerce_order_items'));
  }
  for (const row of bundle.orderLines) {
    validateRow('commerce_order_line_facts', row, tableContract('commerce_order_line_facts'));
  }
  for (const row of bundle.observations) {
    validateRow(
      'commerce_order_status_observations',
      row,
      tableContract('commerce_order_status_observations'),
    );
  }
  for (const row of bundle.refunds) {
    validateRow('raw_commerce_refunds', row, tableContract('raw_commerce_refunds'));
  }
}

function recordBundleCounts(counts, bundle, written) {
  const entries = [
    ['raw_commerce_orders', 1],
    ['commerce_order_state', 1],
    ['raw_commerce_order_items', bundle.rawItems.length],
    ['commerce_order_line_facts', bundle.orderLines.length],
    ['commerce_order_status_observations', bundle.observations.length],
    ['raw_commerce_refunds', bundle.refunds.length],
  ];
  for (const [table, expected] of entries) {
    if (expected === 0) continue;
    const current = counts.get(table) ?? { expected: 0, written: 0, skipped: 0 };
    current.expected += expected;
    if (written) current.written += expected;
    else current.skipped += expected;
    counts.set(table, current);
  }
}

function groupBy(rows, field) {
  const result = new Map();
  for (const row of rows) {
    const key = requireText(row?.[field], field);
    const values = result.get(key) ?? [];
    values.push(row);
    result.set(key, values);
  }
  return result;
}

function tableContract(table) {
  const contract = WOOCOMMERCE_D1_TABLE_CONTRACTS[table];
  if (!contract) {
    throw permanentError('WooCommerce D1 table is not allowlisted', {
      code: 'WOOCOMMERCE_D1_TABLE_NOT_ALLOWED',
      details: { table },
    });
  }
  return contract;
}

function validateRow(table, row, contract) {
  if (!isPlainObject(row)) throw contractError(`${table} row must be an object`);
  const unexpected = Object.keys(row).filter((field) => !contract.columns.includes(field));
  const missing = contract.columns.filter((field) => !(field in row));
  if (unexpected.length > 0 || missing.length > 0) {
    throw permanentError('WooCommerce D1 row does not match its allowlisted contract', {
      code: 'WOOCOMMERCE_D1_ROW_INVALID',
      details: { table, unexpectedFieldCount: unexpected.length, missingFieldCount: missing.length },
    });
  }
  if (typeof row[contract.keyField] !== 'string' || row[contract.keyField].trim() === '') {
    throw permanentError('WooCommerce D1 row is missing its Stable key', {
      code: 'WOOCOMMERCE_D1_ROW_INVALID',
      details: { table, keyField: contract.keyField },
    });
  }
}

function uniqueDates(values) {
  const dates = uniqueTexts(values);
  for (const date of dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw contractError('metricDate must be YYYY-MM-DD');
  }
  return dates;
}

function uniqueTexts(values) {
  if (!Array.isArray(values)) throw contractError('value list must be an array');
  return [...new Set(values.map((value) => requireText(value, 'value')))].sort();
}

function quote(value) {
  const identifier = requireText(value, 'identifier');
  if (!/^[a-z][a-z0-9_]*$/u.test(identifier)) throw contractError('SQL identifier is invalid');
  return `"${identifier}"`;
}

function bindValue(value) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'bigint') {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw contractError('bigint exceeds D1 integer range');
    return number;
  }
  if (value !== null && typeof value === 'object') throw contractError('D1 values must be scalar');
  return value;
}

function readChanges(result) {
  const changes = result?.meta?.changes ?? result?.changes ?? 0;
  return Number.isSafeInteger(changes) && changes >= 0 ? changes : 0;
}

function readRows(result) {
  const rows = result?.results ?? result?.rows ?? [];
  return Array.isArray(rows) ? rows : [];
}

function freezeRow(row) {
  return Object.freeze({ ...row });
}

function requireD1(value) {
  if (!value || typeof value.prepare !== 'function' || typeof value.batch !== 'function') {
    throw permanentError('WooCommerce D1 binding is unavailable', {
      code: 'WOOCOMMERCE_D1_BINDING_MISSING',
    });
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw contractError(`${fieldName} is required`);
  return value.trim();
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw contractError(`${fieldName} must be non-negative`);
  return number;
}

function contractError(message) {
  return permanentError(`WooCommerce ${message}`, { code: 'WOOCOMMERCE_D1_CONTRACT_INVALID' });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
