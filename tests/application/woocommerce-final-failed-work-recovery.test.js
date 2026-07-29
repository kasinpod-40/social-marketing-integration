import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  WOOCOMMERCE_FINAL_FAILED_WORK_REASON,
  buildWooCommerceActiveWorkVerificationSql,
  buildWooCommerceFailedWorkDiscoverySql,
  buildWooCommerceFailedWorkRecoverySql,
  normalizeWooCommerceFailedWorkRows,
  parseWranglerD1Rows,
  verifyWooCommerceActiveWorkCleared,
  verifyWooCommerceFailedWorkRecovery,
} from '../../scripts/lib/woocommerce-final-failed-work-recovery.js';

const WORK_KEY = 'woocommerce:woo-final-full-e6cd0e1b227f';
const AUDIT = `woocommerce-final-recovery:${'a'.repeat(40)}`;

function recoverableRow(overrides = {}) {
  return {
    work_key: WORK_KEY,
    lifecycle_status: 'active',
    work_type: 'woocommerce.commerce.sync',
    generation: 1785187002486,
    requested_at: 1785187002486,
    sync_run_status: 'failed',
    sync_run_error_code: 'WOOCOMMERCE_NETWORK_ERROR',
    active_lock_count: 0,
    coverage_run_count: 0,
    business_row_count: 0,
    ...overrides,
  };
}

test('discovery is read-only and selects only failed unlocked WooCommerce final work', () => {
  const sql = buildWooCommerceFailedWorkDiscoverySql();
  assert.match(sql, /^SELECT /u);
  assert.match(sql, /wr\.lifecycle_status = 'active'/u);
  assert.match(sql, /wr\.work_key LIKE 'woocommerce:woo-final-%'/u);
  assert.match(sql, /sr\.status = 'failed'/u);
  assert.match(sql, /NOT EXISTS \( SELECT 1 FROM sync_locks/u);
  assert.match(sql, /NOT EXISTS \( SELECT 1 FROM data_coverage_runs/u);
  assert.match(sql, /raw_commerce_orders/u);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|INSERT|DROP|ALTER|CREATE)\b/iu);
});

test('normalizes exact recoverable rows and rejects unsafe lifecycle or locks', () => {
  const rows = normalizeWooCommerceFailedWorkRows([recoverableRow()]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].workKey, WORK_KEY);
  assert.equal(rows[0].syncRunErrorCode, 'WOOCOMMERCE_NETWORK_ERROR');
  assert.equal(rows[0].workKeyFingerprint.length, 64);

  assert.throws(
    () => normalizeWooCommerceFailedWorkRows([recoverableRow({ sync_run_status: 'running' })]),
    (error) => error.code === 'WOOCOMMERCE_FINAL_FAILED_WORK_ROW_INVALID',
  );
  assert.throws(
    () => normalizeWooCommerceFailedWorkRows([recoverableRow({ active_lock_count: 1 })]),
    (error) => error.code === 'WOOCOMMERCE_FINAL_FAILED_WORK_LOCKED',
  );
  assert.throws(
    () => normalizeWooCommerceFailedWorkRows([
      recoverableRow({ coverage_run_count: 1, business_row_count: 200 }),
    ]),
    (error) => (
      error.code === 'WOOCOMMERCE_FINAL_FAILED_WORK_PARTIAL_WRITES_PRESENT'
    ),
  );
  assert.throws(
    () => normalizeWooCommerceFailedWorkRows([recoverableRow({ work_key: 'youtube:wrong' })]),
    (error) => error.code === 'WOOCOMMERCE_FINAL_FAILED_WORK_KEY_INVALID',
  );
});

test('recovery SQL matches shared abandonWork lifecycle and mutates no business tables', () => {
  const sql = buildWooCommerceFailedWorkRecoverySql({
    workKey: WORK_KEY,
    auditReference: AUDIT,
  });
  assert.match(sql, /^UPDATE sync_work_runs SET lifecycle_status = 'terminal'/u);
  assert.match(sql, new RegExp(`terminal_reason = COALESCE\\(terminal_reason, '${WOOCOMMERCE_FINAL_FAILED_WORK_REASON}'\\)`, 'u'));
  assert.match(sql, /abandoned_at = COALESCE/u);
  assert.match(sql, /expires_at = COALESCE/u);
  assert.match(sql, /audit_reference = COALESCE/u);
  assert.match(sql, /WHERE work_key = 'woocommerce:woo-final-full-e6cd0e1b227f'/u);
  assert.match(sql, /sr\.status = 'failed'/u);
  assert.match(sql, /NOT EXISTS \( SELECT 1 FROM sync_locks/u);
  assert.match(sql, /SELECT COUNT\(\*\) FROM raw_commerce_orders/u);
  assert.doesNotMatch(
    sql,
    /UPDATE (?:raw_commerce_|commerce_order_state|commerce_product_state|commerce_customer_aggregates|commerce_daily_sales_facts)/u,
  );
  assert.doesNotMatch(sql, /(?:DELETE FROM sync_work_phases|DELETE FROM sync_work_units|sync_generation_fences)/u);
});

test('recovery verification requires exactly one terminal row', () => {
  const result = verifyWooCommerceFailedWorkRecovery({
    expectedWorkKey: WORK_KEY,
    row: {
      recovered_rows: 1,
      work_key: WORK_KEY,
      lifecycle_status: 'terminal',
      terminal_reason: WOOCOMMERCE_FINAL_FAILED_WORK_REASON,
      audit_reference: AUDIT,
    },
  });
  assert.equal(result.recovered, true);
  assert.equal(result.workKeyFingerprint.length, 64);

  assert.throws(
    () => verifyWooCommerceFailedWorkRecovery({
      expectedWorkKey: WORK_KEY,
      row: {
        recovered_rows: 0,
        work_key: WORK_KEY,
        lifecycle_status: 'active',
        terminal_reason: null,
        audit_reference: null,
      },
    }),
    (error) => error.code === 'WOOCOMMERCE_FINAL_FAILED_WORK_RECOVERY_VERIFY_FAILED',
  );
});

test('global active work verification remains fail-closed', () => {
  const sql = buildWooCommerceActiveWorkVerificationSql();
  assert.match(sql, /^SELECT /u);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|INSERT|DROP|ALTER|CREATE)\b/iu);
  assert.deepEqual(verifyWooCommerceActiveWorkCleared({
    active_work_count: 0,
    active_lock_count: 0,
  }), {
    activeWorkCount: 0,
    activeLockCount: 0,
  });
  assert.throws(
    () => verifyWooCommerceActiveWorkCleared({ active_work_count: 1, active_lock_count: 0 }),
    (error) => error.code === 'WOOCOMMERCE_FINAL_ACTIVE_WORK_BLOCKED',
  );
});

test('Wrangler D1 JSON parser flattens statement results and fails closed', () => {
  const rows = parseWranglerD1Rows(JSON.stringify([
    { success: true, results: [] },
    { success: true, results: [{ recovered_rows: 1, work_key: WORK_KEY }] },
  ]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].work_key, WORK_KEY);
  assert.throws(
    () => parseWranglerD1Rows('{invalid'),
    (error) => error.code === 'WOOCOMMERCE_FINAL_FAILED_WORK_D1_OUTPUT_INVALID',
  );
  assert.throws(
    () => parseWranglerD1Rows(JSON.stringify([{ success: false, results: [] }])),
    (error) => error.code === 'WOOCOMMERCE_FINAL_FAILED_WORK_D1_COMMAND_FAILED',
  );
});

test('source-safe launcher wires recovery before propagation-safe delegation', async () => {
  const source = await readFile('scripts/woocommerce-final-one-command-source-safe.mjs', 'utf8');
  const recoveryIndex = source.indexOf('recoverFailedWooCommerceWork()');
  const delegateIndex = source.indexOf("scripts/woocommerce-final-one-command-propagation-safe.mjs");
  assert.ok(recoveryIndex > 0);
  assert.ok(delegateIndex > recoveryIndex);
  assert.match(source, /assertWooCommerceFinalConfirmation\(process\.env\)/u);
  assert.match(source, /businessRowMutationCount: 0/u);
  assert.match(source, /phaseDeletionCount: 0/u);
  assert.match(source, /generationFenceMutationCount: 0/u);
  assert.match(source, /exact_continuation_pinned/u);
  assert.match(
    source,
    /MKT_WOOCOMMERCE_FINAL_RESUME_OPERATION_ID/u,
  );
});
