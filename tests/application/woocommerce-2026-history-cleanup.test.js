import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  WOOCOMMERCE_2026_CLEANUP_CONFIRMATION,
  WOOCOMMERCE_2026_CLEANUP_TABLES,
  assertWooCommerce2026CleanupConfirmation,
  buildWooCommerce2026CleanupDeleteSql,
  buildWooCommerce2026CleanupKeysSql,
  buildWooCommerce2026CleanupVerifySql,
  selectWooCommerce2026CleanupLarkRecords,
  validateWooCommerce2026CleanupFinal,
  validateWooCommerce2026CleanupKeys,
} from '../../scripts/lib/woocommerce-2026-history-cleanup.js';

test('2026 cleanup requires exact confirmation and pins seven Lark tables', () => {
  assert.equal(WOOCOMMERCE_2026_CLEANUP_TABLES.length, 7);
  assert.equal(assertWooCommerce2026CleanupConfirmation({
    CONFIRM_WOOCOMMERCE_2026_HISTORY_CLEANUP:
      WOOCOMMERCE_2026_CLEANUP_CONFIRMATION,
  }), true);
  assert.throws(
    () => assertWooCommerce2026CleanupConfirmation({}),
    (error) => error?.code === 'WOOCOMMERCE_2026_CLEANUP_CONFIRMATION_REQUIRED',
  );
  assert.deepEqual(
    WOOCOMMERCE_2026_CLEANUP_TABLES.map((item) => item.tableKey),
    [
      'rawCommerceOrderItems',
      'rawCommerceRefunds',
      'rawCommerceOrders',
      'mktCommerceOrders',
      'mktCommerceCustomers',
      'mktCommerceDaily',
      'mktCommerceProductDaily',
    ],
  );
});

test('cleanup key reads are SELECT-only and validate unique Stable keys', () => {
  for (const contract of WOOCOMMERCE_2026_CLEANUP_TABLES) {
    const sql = buildWooCommerce2026CleanupKeysSql(contract);
    assert.match(sql, /^SELECT /u);
    assert.match(sql, /account_key = 'chemistry_k'/u);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE)\b/iu);
  }
  assert.deepEqual(
    validateWooCommerce2026CleanupKeys([
      { stable_key: 'key-1' },
      { stable_key: 'key-2' },
    ], WOOCOMMERCE_2026_CLEANUP_TABLES[0]),
    ['key-1', 'key-2'],
  );
  assert.throws(
    () => validateWooCommerce2026CleanupKeys([
      { stable_key: 'duplicate' },
      { stable_key: 'duplicate' },
    ], WOOCOMMERCE_2026_CLEANUP_TABLES[0]),
    (error) => error?.code === 'WOOCOMMERCE_2026_CLEANUP_KEYS_INVALID',
  );
});

test('cleanup selects every pre-2026 Lark target and excludes current or foreign rows', () => {
  const contract = (tableKey) => WOOCOMMERCE_2026_CLEANUP_TABLES
    .find((item) => item.tableKey === tableKey);
  const records = (items) => items.map((fields, index) => ({
    recordId: `rec-${index}`,
    fields,
  }));
  assert.deepEqual(
    selectWooCommerce2026CleanupLarkRecords(records([
      { account_key: 'chemistry_k', raw_order_key: 'order-old' },
      { account_key: 'chemistry_k', raw_order_key: 'order-current' },
      { account_key: 'another_account', raw_order_key: 'order-old' },
    ]), contract('rawCommerceOrderItems'), { oldOrderKeys: new Set(['order-old']) })
      .map((record) => record.recordId),
    ['rec-0'],
  );
  assert.deepEqual(
    selectWooCommerce2026CleanupLarkRecords(records([
      { account_key: 'chemistry_k', source_created_at: 1_735_689_600_000 },
      { account_key: 'chemistry_k', source_created_at: 1_767_225_600_000 },
      { account_key: 'another_account', source_created_at: 1_735_689_600_000 },
    ]), contract('rawCommerceOrders')).map((record) => record.recordId),
    ['rec-0'],
  );
  assert.deepEqual(
    selectWooCommerce2026CleanupLarkRecords(records([
      { account_key: 'chemistry_k', metric_date: '2025-12-31' },
      { account_key: 'chemistry_k', metric_date: '2026-01-01' },
    ]), contract('mktCommerceDaily')).map((record) => record.recordId),
    ['rec-0'],
  );
});

test('cleanup delete SQL is transaction-bound and cannot delete current master tables', () => {
  const sql = buildWooCommerce2026CleanupDeleteSql();
  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /COMMIT;$/u);
  assert.equal((sql.match(/\bDELETE FROM\b/gu) ?? []).length, 9);
  assert.equal((sql.match(/\bUPDATE\b/gu) ?? []).length, 2);
  for (const preserved of [
    'raw_commerce_stores',
    'raw_commerce_products',
    'raw_commerce_product_variations',
    'raw_commerce_categories',
    'raw_commerce_customers',
    'raw_commerce_coupons',
    'commerce_store_state',
    'commerce_product_state',
  ]) {
    assert.doesNotMatch(sql, new RegExp(`DELETE FROM ${preserved}\\b`, 'u'));
  }
  assert.match(sql, /source_created_at < 1767225600000/u);
  assert.match(sql, /metric_date < '2026-01-01'/u);
  assert.match(sql, /sync_run_id='woocommerce:woo-final-full-e2372e56d52d'/u);
  assert.match(sql, /work_key='woocommerce:woo-final-full-e2372e56d52d'/u);
  assert.match(sql, /generation=1785358748292/u);
  assert.match(sql, /requested_at=1785358748292/u);
  assert.match(sql, /NOT EXISTS \( SELECT 1 FROM sync_locks/u);
});

test('cleanup final verification requires zero old rows and exact replaced-operation closure', () => {
  const sql = buildWooCommerce2026CleanupVerifySql();
  assert.match(sql, /^SELECT /u);
  assert.equal(validateWooCommerce2026CleanupFinal({
    old_raw_orders: 0,
    old_order_state: 0,
    old_daily: 0,
    old_product_daily: 0,
    active_woocommerce_locks: 0,
    replaced_work_status: 'terminal',
    replaced_sync_status: 'failed',
    replaced_sync_error_code: 'WOOCOMMERCE_HISTORY_SCOPE_REPLACED',
  }), true);
  assert.throws(
    () => validateWooCommerce2026CleanupFinal({
      old_raw_orders: 1,
      old_order_state: 0,
      old_daily: 0,
      old_product_daily: 0,
      active_woocommerce_locks: 0,
      replaced_work_status: 'terminal',
      replaced_sync_status: 'failed',
      replaced_sync_error_code: 'WOOCOMMERCE_HISTORY_SCOPE_REPLACED',
    }),
    (error) => error?.code === 'WOOCOMMERCE_2026_CLEANUP_VERIFY_FAILED',
  );
  assert.throws(
    () => validateWooCommerce2026CleanupFinal({
      old_raw_orders: 0,
      old_order_state: 0,
      old_daily: 0,
      old_product_daily: 0,
      active_woocommerce_locks: 0,
      replaced_work_status: 'active',
      replaced_sync_status: 'running',
      replaced_sync_error_code: null,
    }),
    (error) => error?.code === 'WOOCOMMERCE_2026_CLEANUP_OPERATION_CLOSE_FAILED',
  );
});

test('cleanup operator is backup-first and has no Worker deploy or Queue path', async () => {
  const source = await readFile(
    new URL('../../scripts/woocommerce-2026-history-cleanup.mjs', import.meta.url),
    'utf8',
  );
  const backup = source.indexOf("'d1', 'export'");
  const attempt = source.indexOf("'cleanup-attempt.json'");
  const deleteCall = source.indexOf('await batchDelete(');
  assert.ok(backup >= 0 && attempt > backup && deleteCall > attempt);
  assert.doesNotMatch(source, /wrangler',\s*'deploy|queues.*send|MKT_SYNC_QUEUE/u);
  assert.match(source, /production:\s*false/u);
});
