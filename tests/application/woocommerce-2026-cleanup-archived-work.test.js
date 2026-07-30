import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateWooCommerce2026CleanupPostState,
  validateWooCommerce2026CleanupPreflight,
} from '../../scripts/lib/woocommerce-2026-completion-one-command.js';

const CLEANUP_ZERO = Object.freeze({
  old_raw_order_items: 0,
  old_raw_refunds: 0,
  old_raw_orders: 0,
  old_order_status_observations: 0,
  old_order_line_facts: 0,
  old_order_state: 0,
  old_customer_aggregates: 0,
  old_daily: 0,
  old_product_daily: 0,
  active_work: 0,
  replaced_active_work: 0,
  other_active_work: 0,
  active_locks: 0,
  replaced_sync_status: 'failed',
  replaced_sync_error_code: 'WOOCOMMERCE_HISTORY_SCOPE_REPLACED',
});

test('cleanup preflight accepts exact archived Work state after completed scope replacement', () => {
  const result = validateWooCommerce2026CleanupPreflight({
    ...CLEANUP_ZERO,
    replaced_work_status: null,
  });

  assert.equal(result.pendingExactCleanup, false);
  assert.equal(result.alreadyClean, true);
  assert.equal(result.replacedWorkRetained, false);
  assert.equal(result.replacedWorkArchived, true);
  assert.equal(result.activeWork, 0);
  assert.equal(result.activeLocks, 0);
  assert.equal(result.oldRows, 0);
  assert.equal(result.aggregateRows, 0);
});

test('cleanup preflight preserves retained terminal Work acceptance', () => {
  const result = validateWooCommerce2026CleanupPreflight({
    ...CLEANUP_ZERO,
    replaced_work_status: 'terminal',
  });

  assert.equal(result.alreadyClean, true);
  assert.equal(result.replacedWorkRetained, true);
  assert.equal(result.replacedWorkArchived, false);
});

test('archived Work state fails closed without exact Sync closure or zero cleanup facts', () => {
  assert.throws(
    () => validateWooCommerce2026CleanupPreflight({
      ...CLEANUP_ZERO,
      replaced_work_status: null,
      replaced_sync_status: 'running',
      replaced_sync_error_code: null,
    }),
    (error) => error?.code === 'WOOCOMMERCE_2026_COMPLETION_CLEANUP_STATE_INVALID',
  );

  assert.throws(
    () => validateWooCommerce2026CleanupPreflight({
      ...CLEANUP_ZERO,
      replaced_work_status: null,
      old_raw_orders: 1,
    }),
    (error) => error?.code === 'WOOCOMMERCE_2026_COMPLETION_CLEANUP_STATE_INVALID',
  );

  assert.throws(
    () => validateWooCommerce2026CleanupPreflight({
      ...CLEANUP_ZERO,
      replaced_work_status: 'completed',
    }),
    (error) => error?.code === 'WOOCOMMERCE_2026_COMPLETION_CLEANUP_STATE_INVALID',
  );
});

test('cleanup post-state accepts exact archived Work state and rejects ambiguous closure', () => {
  const result = validateWooCommerce2026CleanupPostState({
    ...CLEANUP_ZERO,
    replaced_work_status: null,
  });

  assert.equal(result.exactReplacedOperationClosed, true);
  assert.equal(result.replacedWorkRetained, false);
  assert.equal(result.replacedWorkArchived, true);

  assert.throws(
    () => validateWooCommerce2026CleanupPostState({
      ...CLEANUP_ZERO,
      replaced_work_status: null,
      replaced_sync_error_code: 'OTHER_FAILURE',
    }),
    (error) => error?.code
      === 'WOOCOMMERCE_2026_COMPLETION_CLEANUP_POSTSTATE_INVALID',
  );
});
