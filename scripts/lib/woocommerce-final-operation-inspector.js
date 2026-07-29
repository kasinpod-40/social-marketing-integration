import {
  buildWooCommerceFinalSnapshotSql,
  classifyWooCommerceFinalCompletion,
} from './woocommerce-final-rollout-operator.js';

const OPERATION_ID = /^woo-final-(?:full|incremental)-[0-9a-f]{12}$/u;
const DIAGNOSTIC_TEXT_LIMIT = 500;
const RESPONSE_BODY_SHAPES = new Set([
  'empty',
  'html_or_xml',
  'json_object_like',
  'json_array_like',
  'other',
]);
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

/** Return only allowlisted bounded Worker failure diagnostics persisted by the runtime. */
export function extractWooCommerceFinalNetworkDiagnostics(detailsJson) {
  const details = parseObject(detailsJson);
  const errorDetails = objectOrNull(details?.errorDetails)
    ?? objectOrNull(details?.error_details);
  if (!errorDetails) return null;
  const networkCause = objectOrNull(errorDetails.networkCause)
    ?? objectOrNull(errorDetails.network_cause);
  const responseDiagnostics = {
    responseStatus: diagnosticNumber(
      errorDetails.responseStatus ?? errorDetails.response_status ?? errorDetails.status,
    ),
    responseRedirected: diagnosticBoolean(
      errorDetails.responseRedirected ?? errorDetails.response_redirected,
    ),
    responseUrlPresent: diagnosticBoolean(
      errorDetails.responseUrlPresent ?? errorDetails.response_url_present,
    ),
    responseOriginMatchesSource: diagnosticBoolean(
      errorDetails.responseOriginMatchesSource
        ?? errorDetails.response_origin_matches_source,
    ),
    responsePathMatchesResource: diagnosticBoolean(
      errorDetails.responsePathMatchesResource
        ?? errorDetails.response_path_matches_resource,
    ),
    contentType: diagnosticText(errorDetails.contentType ?? errorDetails.content_type),
    contentEncoding: diagnosticText(
      errorDetails.contentEncoding ?? errorDetails.content_encoding,
    ),
    contentLengthHeader: diagnosticNumber(
      errorDetails.contentLengthHeader ?? errorDetails.content_length_header,
    ),
    bodyByteLength: diagnosticNumber(
      errorDetails.bodyByteLength ?? errorDetails.body_byte_length,
    ),
    bodySha256: diagnosticSha256(errorDetails.bodySha256 ?? errorDetails.body_sha256),
    bodyShape: diagnosticBodyShape(errorDetails.bodyShape ?? errorDetails.body_shape),
    bomRemoved: diagnosticBoolean(errorDetails.bomRemoved ?? errorDetails.bom_removed),
  };
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
  if (hasDiagnosticValue(responseDiagnostics)) {
    output.responseDiagnostics = responseDiagnostics;
  }
  if (output.resource === null
    && output.timeoutMs === null
    && output.elapsedMs === null
    && output.networkCause === null
    && output.responseDiagnostics === undefined) {
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

function diagnosticSha256(value) {
  const text = diagnosticText(value);
  return text && /^[0-9a-f]{64}$/u.test(text) ? text : null;
}

function diagnosticBodyShape(value) {
  const text = diagnosticText(value);
  return text && RESPONSE_BODY_SHAPES.has(text) ? text : null;
}

function diagnosticBoolean(value) {
  return value === true || value === false ? value : null;
}

function hasDiagnosticValue(value) {
  return Object.values(value).some((item) => item !== null);
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
