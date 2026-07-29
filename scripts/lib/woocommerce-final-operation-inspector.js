import {
  classifyWooCommerceFinalCompletion,
  normalizeWooCommerceFinalSnapshot,
} from './woocommerce-final-rollout-operator.js';

const TERMINAL_FAILED_SYNC_STATUSES = new Set([
  'cancelled',
  'error',
  'failed',
]);

const TERMINAL_FAILED_WORK_STATUSES = new Set([
  'abandoned',
  'cancelled',
  'dead_lettered',
  'failed',
]);

/**
 * Classify one already-admitted WooCommerce operation using read-only durable facts.
 * This helper never decides to send a Queue message automatically.
 */
export function classifyWooCommerceFinalOperationInspection(
  snapshotInput,
  options = {},
) {
  const fullReconciliation = options.fullReconciliation !== false;
  const completion = classifyWooCommerceFinalCompletion(snapshotInput, {
    fullReconciliation,
  });
  const snapshot = normalizeWooCommerceFinalSnapshot(completion.snapshot);

  let decision = 'INDETERMINATE';
  let nextAction = 'do_not_rerun_investigate_missing_terminal_evidence';

  if (completion.complete) {
    decision = 'COMPLETE';
    nextAction = 'do_not_send_new_full_operation_continue_closeout_from_existing_operation';
  } else if (
    snapshot.activeLockCount > 0
    || snapshot.workLifecycleStatus === 'active'
    || snapshot.syncRunStatus === 'running'
  ) {
    decision = 'ACTIVE';
    nextAction = 'do_not_rerun_wait_then_reinspect_same_operation';
  } else if (
    TERMINAL_FAILED_SYNC_STATUSES.has(snapshot.syncRunStatus)
    || TERMINAL_FAILED_WORK_STATUSES.has(snapshot.workLifecycleStatus)
    || snapshot.syncRunErrorCode !== null
  ) {
    decision = 'TERMINAL_FAILED';
    nextAction = 'do_not_resend_automatically_inspect_failure_and_recovery_contract';
  }

  return Object.freeze({
    decision,
    nextAction,
    complete: completion.complete,
    fullReconciliation,
    snapshot,
  });
}
