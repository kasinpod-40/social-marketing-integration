import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  WOOCOMMERCE_2026_COMPLETION_CONFIRMATION,
  WOOCOMMERCE_2026_HISTORY_START,
  assertWooCommerce2026CompletionConfirmation,
  assertWooCommerce2026RemoteSafeFlags,
  collectEnabledMktFlags,
  parseWooCommerce2026CompletionArgs,
  selectExactlyOneActiveWorkerVersion,
  validateWooCommerce2026CleanupPostState,
  validateWooCommerce2026CleanupPreflight,
  validateWooCommerce2026CompletionFinalRemote,
  validateWooCommerce2026FinalSummary,
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
});

const HEAD = 'a'.repeat(40);

test('completion command requires exact confirmation and arguments', () => {
  assert.deepEqual(parseWooCommerce2026CompletionArgs(['--execute']), { execute: true });
  assert.deepEqual(parseWooCommerce2026CompletionArgs([]), { execute: false });
  assert.throws(
    () => parseWooCommerce2026CompletionArgs(['--force']),
    (error) => error?.code === 'WOOCOMMERCE_2026_COMPLETION_ARGUMENT_INVALID',
  );
  assert.equal(assertWooCommerce2026CompletionConfirmation({
    CONFIRM_WOOCOMMERCE_2026_COMPLETION:
      WOOCOMMERCE_2026_COMPLETION_CONFIRMATION,
  }), true);
  assert.throws(
    () => assertWooCommerce2026CompletionConfirmation({}),
    (error) => error?.code === 'WOOCOMMERCE_2026_COMPLETION_CONFIRMATION_REQUIRED',
  );
});

test('remote Worker safety requires one active version and zero enabled MKT flags', () => {
  assert.equal(selectExactlyOneActiveWorkerVersion({
    versions: [{ version_id: 'worker-version', percentage: 100 }],
  }), 'worker-version');
  assert.deepEqual(collectEnabledMktFlags({
    vars: {
      MKT_CONNECTOR_WOOCOMMERCE_ENABLED: 'false',
      MKT_SCHEDULE_WOOCOMMERCE_ENABLED: false,
    },
  }), []);
  assert.equal(assertWooCommerce2026RemoteSafeFlags({
    bindings: [
      { name: 'MKT_CONNECTOR_WOOCOMMERCE_ENABLED', value: 'false' },
      { name: 'MKT_SCHEDULE_WOOCOMMERCE_ENABLED', text: 'false' },
    ],
  }).allFalse, true);
  assert.throws(
    () => assertWooCommerce2026RemoteSafeFlags({
      vars: { MKT_CONNECTOR_WOOCOMMERCE_ENABLED: 'true' },
    }),
    (error) => error?.code === 'WOOCOMMERCE_2026_COMPLETION_REMOTE_FLAGS_ACTIVE',
  );
  assert.throws(
    () => selectExactlyOneActiveWorkerVersion({ versions: [] }),
    (error) => error?.code === 'WOOCOMMERCE_2026_COMPLETION_ACTIVE_VERSION_INVALID',
  );
});

test('cleanup preflight accepts only exact pending cleanup or completed cleanup', () => {
  const pending = validateWooCommerce2026CleanupPreflight({
    ...CLEANUP_ZERO,
    old_raw_orders: 7_800,
    old_raw_order_items: 7_809,
    active_work: 1,
    replaced_active_work: 1,
    other_active_work: 0,
    active_locks: 0,
    replaced_work_status: 'active',
    replaced_sync_status: 'running',
    replaced_sync_error_code: null,
  });
  assert.equal(pending.pendingExactCleanup, true);
  assert.equal(pending.alreadyClean, false);

  const clean = validateWooCommerce2026CleanupPreflight({
    ...CLEANUP_ZERO,
    active_work: 0,
    replaced_active_work: 0,
    other_active_work: 0,
    active_locks: 0,
    replaced_work_status: 'terminal',
    replaced_sync_status: 'failed',
    replaced_sync_error_code: 'WOOCOMMERCE_HISTORY_SCOPE_REPLACED',
  });
  assert.equal(clean.alreadyClean, true);

  const cleanWithExactResume = validateWooCommerce2026CleanupPreflight({
    ...CLEANUP_ZERO,
    active_work: 1,
    replaced_active_work: 0,
    other_active_work: 1,
    active_locks: 0,
    replaced_work_status: 'terminal',
    replaced_sync_status: 'failed',
    replaced_sync_error_code: 'WOOCOMMERCE_HISTORY_SCOPE_REPLACED',
  });
  assert.equal(cleanWithExactResume.alreadyClean, true);
  assert.equal(cleanWithExactResume.otherActiveWork, 1);

  assert.throws(
    () => validateWooCommerce2026CleanupPreflight({
      ...CLEANUP_ZERO,
      active_work: 2,
      replaced_active_work: 0,
      other_active_work: 2,
      active_locks: 0,
      replaced_work_status: 'terminal',
      replaced_sync_status: 'failed',
      replaced_sync_error_code: 'WOOCOMMERCE_HISTORY_SCOPE_REPLACED',
    }),
    (error) => error?.code === 'WOOCOMMERCE_2026_COMPLETION_CLEANUP_BLOCKED',
  );
});

test('cleanup post-state requires zero old rows, work, locks and exact old-operation closure', () => {
  assert.equal(validateWooCommerce2026CleanupPostState({
    ...CLEANUP_ZERO,
    active_work: 0,
    replaced_active_work: 0,
    other_active_work: 0,
    active_locks: 0,
    replaced_work_status: 'terminal',
    replaced_sync_status: 'failed',
    replaced_sync_error_code: 'WOOCOMMERCE_HISTORY_SCOPE_REPLACED',
  }).exactReplacedOperationClosed, true);
  assert.throws(
    () => validateWooCommerce2026CleanupPostState({
      ...CLEANUP_ZERO,
      old_order_state: 1,
      active_work: 0,
      replaced_active_work: 0,
      other_active_work: 0,
      active_locks: 0,
      replaced_work_status: 'terminal',
      replaced_sync_status: 'failed',
      replaced_sync_error_code: 'WOOCOMMERCE_HISTORY_SCOPE_REPLACED',
    }),
    (error) => error?.code
      === 'WOOCOMMERCE_2026_COMPLETION_CLEANUP_POSTSTATE_INVALID',
  );
});

test('Final summary is pinned to 2026 history, exact head and Safe closeout', () => {
  const accepted = validateWooCommerce2026FinalSummary({
    accepted: true,
    repositoryHead: HEAD,
    parityVerified: true,
    idempotentRerunVerified: true,
    incrementalVerified: true,
    executionFlagsAllFalse: true,
    scheduleEnabled: false,
    production: false,
    nextStep: 'none_for_integration_workspace_woocommerce',
    orderHistoryWindow: {
      start: WOOCOMMERCE_2026_HISTORY_START,
      end: '2026-07-30T03:00:00.000Z',
      scopeMode: 'report_range',
    },
    fullReconciliation: {
      operationId: 'woo-final-full-abcdef123456',
      totalRows: 100,
    },
  }, HEAD);
  assert.equal(accepted.operationId, 'woo-final-full-abcdef123456');
  assert.throws(
    () => validateWooCommerce2026FinalSummary({
      accepted: true,
      repositoryHead: HEAD,
      parityVerified: true,
      idempotentRerunVerified: true,
      incrementalVerified: true,
      executionFlagsAllFalse: true,
      scheduleEnabled: false,
      production: false,
      nextStep: 'none_for_integration_workspace_woocommerce',
      orderHistoryWindow: {
        start: '2025-01-01T00:00:00.000Z',
        scopeMode: 'report_range',
      },
      fullReconciliation: { operationId: 'woo-final-full-abcdef123456' },
    }, HEAD),
    (error) => error?.code === 'WOOCOMMERCE_2026_COMPLETION_FINAL_SUMMARY_INVALID',
  );
});

test('final Remote state requires zero active Work, Lock and Queue operation', () => {
  assert.deepEqual(validateWooCommerce2026CompletionFinalRemote({
    active_work: 0,
    active_locks: 0,
    active_queue_operations: 0,
  }), {
    activeWork: 0,
    activeLocks: 0,
    activeQueueOperations: 0,
  });
  assert.throws(
    () => validateWooCommerce2026CompletionFinalRemote({
      active_work: 1,
      active_locks: 0,
      active_queue_operations: 1,
    }),
    (error) => error?.code === 'WOOCOMMERCE_2026_COMPLETION_FINAL_REMOTE_ACTIVE',
  );
});

test('one command seals main and orders cleanup before Final rollout', async () => {
  const source = await readFile(
    new URL('../../scripts/woocommerce-2026-completion-one-command.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /buildReportRuntimeSealedCloneArgs/u);
  assert.match(source, /remote', 'set-url', 'origin', '\.'/u);
  assert.match(source, /snapshotPrivateFile\(devVars\.resolvedPath/u);
  assert.match(source, /\['npm-ci', 'npm', \['ci'\]\]/u);
  assert.match(source, /\['full-tests', 'npm', \['test'\]\]/u);
  assert.match(source, /\['dependency-audit', 'npm', \['audit', '--audit-level=high'\]\]/u);
  const cleanup = source.indexOf("'woocommerce-2026-history-cleanup'");
  const final = source.indexOf("'woocommerce-final-one-command'");
  assert.ok(cleanup >= 0 && final > cleanup);
  assert.match(source, /discoverExactResumeOperation/u);
  assert.match(source, /validateWooCommerce2026CompletionFinalRemote/u);
  assert.doesNotMatch(source, /queues\/.+\/messages|method:\s*'POST'/u);
  assert.match(source, /nextStep:\s*'resume_pinned_meta_finalizer'/u);
});
