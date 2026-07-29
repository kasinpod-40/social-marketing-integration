import {
  buildWooCommerceFinalSnapshotSql,
  classifyWooCommerceFinalCompletion,
} from './woocommerce-final-rollout-operator.js';

const OPERATION_ID = /^woo-final-(?:full|incremental)-[0-9a-f]{12}$/u;
const DIAGNOSTIC_TEXT_LIMIT = 500;
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
  'terminal',
]);

/** Build one read-only row containing the existing rollout snapshot and sanitized-source details. */
export function buildWooCommerceFinalOperationInspectionSql(input = {}) {
  const operationId = requireOperationId(input.operationId);
  const snapshotSql = buildWooCommerceFinalSnapshotSql({
    accountKey: input.accountKey,
    operationId,
  }).replace(/;\s*$/u, '');
  const syncRunId = sqlText(`woocommerce:${operationId}`);
  return compactSql(`
    SELECT
      snapshot.*,
      (
        SELECT details_json
        FROM sync_runs
        WHERE sync_run_id = '${syncRunId}'
      ) AS sync_run_details_json
    FROM (${snapshotSql}) AS snapshot;
  `);
}

/**
 * Classify one already-admitted WooCommerce operation using read-only durable facts.
 * A failed Sync Run with no active lock is terminal even when stale durable work remains active.
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
  const snapshot = completion.snapshot;
  const terminalFailure = TERMINAL_FAILED_SYNC_STATUSES.has(snapshot.syncRunStatus)
    || TERMINAL_FAILED_WORK_STATUSES.has(snapshot.workLifecycleStatus)
    || snapshot.syncRunErrorCode !== null;
  const staleActiveFailure = terminalFailure
    && snapshot.workLifecycleStatus === 'active'
    && snapshot.activeLockCount === 0;

  let decision = 'INDETERMINATE';
  let nextAction = 'do_not_rerun_investigate_missing_terminal_evidence';

  if (completion.complete) {
    decision = 'COMPLETE';
    nextAction = 'do_not_send_new_full_operation_continue_closeout_from_existing_operation';
  } else if (terminalFailure && snapshot.activeLockCount === 0) {
    decision = 'TERMINAL_FAILED';
    nextAction = staleActiveFailure
      ? 'do_not_resend_inspect_network_cause_then_recover_stale_active_work'
      : 'do_not_resend_automatically_inspect_failure_and_recovery_contract';
  } else if (
    snapshot.activeLockCount > 0
    || snapshot.workLifecycleStatus === 'active'
    || snapshot.syncRunStatus === 'running'
  ) {
    decision = 'ACTIVE';
    nextAction = 'do_not_rerun_wait_then_reinspect_same_operation';
  } else if (terminalFailure) {
    decision = 'TERMINAL_FAILED';
    nextAction = 'do_not_resend_while_failure_has_active_lock';
  }

  return Object.freeze({
    decision,
    nextAction,
    complete: completion.complete,
    fullReconciliation,
    staleActiveFailure,
    snapshot,
  });
}

/** Return only the allowlisted Worker network diagnostics persisted by the runtime hotfix. */
export function extractWooCommerceFinalNetworkDiagnostics(detailsJson) {
  const details = parseObject(detailsJson);
  const errorDetails = objectOrNull(details?.errorDetails)
    ?? objectOrNull(details?.error_details);
  if (!errorDetails) return null;
  const networkCause = objectOrNull(errorDetails.networkCause)
    ?? objectOrNull(errorDetails.network_cause);
  const output = {
    resource: diagnosticText(errorDetails.resource),
    timeoutMs: diagnosticNumber(errorDetails.timeoutMs ?? errorDetails.timeout_ms),
    elapsedMs: diagnosticNumber(errorDetails.elapsedMs ?? errorDetails.elapsed_ms),
    networkCause: networkCause ? {
      name: diagnosticText(networkCause.name),
      message: diagnosticText(networkCause.message),
      code: diagnosticText(networkCause.code),
      nestedName: diagnosticText(networkCause.nestedName ?? networkCause.nested_name),
      nestedMessage: diagnosticText(networkCause.nestedMessage ?? networkCause.nested_message),
      nestedCode: diagnosticText(networkCause.nestedCode ?? networkCause.nested_code),
    } : null,
  };
  if (output.resource === null
    && output.timeoutMs === null
    && output.elapsedMs === null
    && output.networkCause === null) {
    return null;
  }
  return deepFreeze(output);
}

function requireOperationId(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!OPERATION_ID.test(text)) {
    throw new TypeError('A valid WooCommerce final operation ID is required');
  }
  return text;
}

function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    return objectOrNull(JSON.parse(value));
  } catch {
    return null;
  }
}

function objectOrNull(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function diagnosticText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text.slice(0, DIAGNOSTIC_TEXT_LIMIT);
}

function diagnosticNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function sqlText(value) {
  return String(value).replaceAll("'", "''");
}

function compactSql(value) {
  return String(value).replace(/\s+/gu, ' ').trim();
}
