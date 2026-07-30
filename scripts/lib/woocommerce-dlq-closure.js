import {
  classifyWooCommerceFinalCompletion,
  normalizeWooCommerceFinalSnapshot,
} from './woocommerce-final-rollout-operator.js';

export const WOOCOMMERCE_DLQ_CLOSURE_CONTRACT_VERSION = 'woocommerce_dlq_closure_v1';
export const WOOCOMMERCE_DLQ_CLOSURE_CONFIRMATION = 'CLOSE_WOO_FINAL_E2372E56D52D_DLQ_ONLY';
export const WOOCOMMERCE_DLQ_CLOSURE_INCIDENT = Object.freeze({
  operationId: 'woo-final-full-e2372e56d52d',
  workKey: 'woocommerce:woo-final-full-e2372e56d52d',
  generation: 1785358748292,
  requestedAt: 1785358748292,
  minimumQueueAttempts: 14,
  rows: Object.freeze([
    freezeIncidentRow({
      dlqId: 'dlq:aec6e7845d40189925924c5990b5ef01',
      messageId: 'aec6e7845d40189925924c5990b5ef01',
      errorCode: 'QUEUE_RETRY_EXHAUSTED',
      retryCount: 7,
      mainQueueAttempts: 7,
      dlqDeliveryAttempts: 1,
    }),
    freezeIncidentRow({
      dlqId: 'terminal:6d19237d02e9bc5c91833a37c64b52d1',
      messageId: '6d19237d02e9bc5c91833a37c64b52d1',
      errorCode: 'LARK_PREFLIGHT_FAILED',
      retryCount: 12,
      mainQueueAttempts: 12,
      dlqDeliveryAttempts: 0,
    }),
    freezeIncidentRow({
      dlqId: 'terminal:49bf97edbdd395fca99759ecb2cfb762',
      messageId: '49bf97edbdd395fca99759ecb2cfb762',
      errorCode: 'WOOCOMMERCE_CONNECTOR_INVALID',
      retryCount: 13,
      mainQueueAttempts: 13,
      dlqDeliveryAttempts: 0,
    }),
  ]),
});

export function assertWooCommerceDlqClosureConfirmation(env = {}) {
  if (env.CONFIRM_WOOCOMMERCE_DLQ_CLOSURE !== WOOCOMMERCE_DLQ_CLOSURE_CONFIRMATION) {
    throw closureError(
      `Execution requires CONFIRM_WOOCOMMERCE_DLQ_CLOSURE=${WOOCOMMERCE_DLQ_CLOSURE_CONFIRMATION}`,
      'WOOCOMMERCE_DLQ_CLOSURE_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function assertWooCommerceDlqClosureSummary(summary = {}) {
  const incident = WOOCOMMERCE_DLQ_CLOSURE_INCIDENT;
  if (summary.accepted !== true
    || summary.contractVersion !== 'woocommerce_final_rollout_v1'
    || summary.fullReconciliation?.operationId !== incident.operationId
    || summary.resumedExactOperation !== true
    || summary.parityVerified !== true
    || summary.idempotentRerunVerified !== true
    || summary.incrementalVerified !== true
    || summary.executionFlagsAllFalse !== true
    || summary.scheduleEnabled !== false
    || summary.production !== false) {
    throw closureError(
      'WooCommerce Final summary does not authorize exact DLQ closure',
      'WOOCOMMERCE_DLQ_CLOSURE_SUMMARY_INVALID',
    );
  }
  return true;
}

export function assertWooCommerceDlqClosureSnapshot(snapshotInput = {}) {
  const incident = WOOCOMMERCE_DLQ_CLOSURE_INCIDENT;
  const classified = classifyWooCommerceFinalCompletion(snapshotInput, {
    fullReconciliation: true,
    minimumQueueAttempts: incident.minimumQueueAttempts,
  });
  const snapshot = classified.snapshot;
  if (classified.complete !== true
    || snapshot.workGeneration !== incident.generation
    || snapshot.workRequestedAt !== incident.requestedAt
    || snapshot.queueGeneration !== incident.generation
    || snapshot.queueOriginalRequestedAt !== incident.requestedAt
    || snapshot.queueOperationAttempts < incident.minimumQueueAttempts) {
    throw closureError(
      'WooCommerce exact operation is not complete enough for DLQ closure',
      'WOOCOMMERCE_DLQ_CLOSURE_COMPLETION_INVALID',
      {
        completionReason: classified.reason,
        queueOperationAttempts: snapshot.queueOperationAttempts,
      },
    );
  }
  return snapshot;
}

export function buildWooCommerceDlqClosureEvidenceSql() {
  const incident = WOOCOMMERCE_DLQ_CLOSURE_INCIDENT;
  const ids = incident.rows.map((row) => sqlText(row.dlqId)).join(', ');
  return compactSql(`
    SELECT
      d.dlq_id, d.message_id, d.status, d.job_type, d.error_code, d.retry_count,
      d.redrive_reference, d.redriven_at,
      m.operation_id, m.original_work_key, m.generation, m.original_requested_at,
      m.main_queue_attempts, m.dlq_delivery_attempts, m.recovery_status,
      m.recovery_reference, m.recovery_completed_at, m.audit_reference
    FROM dead_letter_jobs AS d
    JOIN dead_letter_operation_metadata AS m ON m.dlq_id = d.dlq_id
    WHERE d.dlq_id IN (${ids})
    ORDER BY d.dlq_id;
  `);
}

export function validateWooCommerceDlqClosureRows(rows, stage = 'before') {
  if (!Array.isArray(rows)) throw new TypeError('WooCommerce DLQ closure rows must be an array');
  const expectedRows = WOOCOMMERCE_DLQ_CLOSURE_INCIDENT.rows;
  const byId = new Map(rows.map((row) => [row?.dlq_id, row]));
  if (rows.length !== expectedRows.length || byId.size !== expectedRows.length) {
    throw closureError(
      'WooCommerce DLQ closure evidence row count differs from the exact incident',
      'WOOCOMMERCE_DLQ_CLOSURE_EVIDENCE_MISMATCH',
      { rowCount: rows.length },
    );
  }
  for (const expected of expectedRows) {
    const row = byId.get(expected.dlqId);
    const commonMatches = row?.message_id === expected.messageId
      && row?.job_type === 'woocommerce.commerce.sync'
      && row?.error_code === expected.errorCode
      && Number(row?.retry_count) === expected.retryCount
      && row?.operation_id === WOOCOMMERCE_DLQ_CLOSURE_INCIDENT.operationId
      && row?.original_work_key === WOOCOMMERCE_DLQ_CLOSURE_INCIDENT.workKey
      && Number(row?.generation) === WOOCOMMERCE_DLQ_CLOSURE_INCIDENT.generation
      && Number(row?.original_requested_at) === WOOCOMMERCE_DLQ_CLOSURE_INCIDENT.requestedAt
      && Number(row?.main_queue_attempts) === expected.mainQueueAttempts
      && Number(row?.dlq_delivery_attempts) === expected.dlqDeliveryAttempts;
    const finalMatches = row?.status === 'redriven'
      && row?.recovery_status === 'completed'
      && row?.redrive_reference === expected.closureReference
      && row?.recovery_reference === expected.closureReference
      && row?.audit_reference === expected.closureReference
      && Number.isSafeInteger(Number(row?.redriven_at))
      && Number.isSafeInteger(Number(row?.recovery_completed_at));
    const redrivenPendingMetadata = row?.status === 'redriven'
      && row?.recovery_status === 'not_started'
      && row?.redrive_reference === expected.closureReference
      && Number.isSafeInteger(Number(row?.redriven_at));
    const untouchedOpen = row?.status === 'open'
      && row?.recovery_status === 'not_started'
      && row?.redrive_reference === null
      && row?.redriven_at === null
      && row?.recovery_reference === null
      && row?.recovery_completed_at === null
      && row?.audit_reference === null;
    const beforeMatches = untouchedOpen
      || redrivenPendingMetadata
      || finalMatches;
    if (!commonMatches || (stage === 'final' ? !finalMatches : !beforeMatches)) {
      throw closureError(
        'WooCommerce DLQ closure evidence differs from the exact incident',
        'WOOCOMMERCE_DLQ_CLOSURE_EVIDENCE_MISMATCH',
        { dlqId: expected.dlqId, stage },
      );
    }
  }
  return Object.freeze({
    rowCount: rows.length,
    openRows: rows.filter((row) => row.status === 'open').length,
    redrivenRows: rows.filter((row) => row.status === 'redriven').length,
    completedMetadataRows: rows.filter((row) => row.recovery_status === 'completed').length,
  });
}

export function buildWooCommerceDlqClosureRepairSql(now = Date.now()) {
  const repairedAt = timestamp(now, 'now');
  const incident = WOOCOMMERCE_DLQ_CLOSURE_INCIDENT;
  return incident.rows.map((row) => compactSql(`
    UPDATE dead_letter_jobs
    SET status = 'redriven',
        redrive_requested_at = COALESCE(redrive_requested_at, ${repairedAt}),
        redrive_reference = COALESCE(redrive_reference, ${sqlText(row.closureReference)}),
        redriven_at = COALESCE(redriven_at, ${repairedAt}),
        updated_at = ${repairedAt}
    WHERE dlq_id = ${sqlText(row.dlqId)}
      AND message_id = ${sqlText(row.messageId)}
      AND job_type = 'woocommerce.commerce.sync'
      AND error_code = ${sqlText(row.errorCode)}
      AND retry_count = ${row.retryCount}
      AND status IN ('open', 'redriven')
      AND EXISTS (
        SELECT 1 FROM sync_work_runs
        WHERE work_key = ${sqlText(incident.workKey)}
          AND generation = ${incident.generation}
          AND requested_at = ${incident.requestedAt}
          AND lifecycle_status = 'completed'
          AND json_extract(completion_json, '$.schemaVersion') = 'woocommerce_commerce_reconciliation_v1'
          AND json_extract(completion_json, '$.scopeMode') = 'full_inventory'
          AND json_extract(completion_json, '$.failed') = 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM sync_locks
        WHERE owner_id = ${sqlText(`woocommerce:${incident.operationId}`)}
          AND expires_at > unixepoch('now') * 1000
      );
    SELECT changes() AS dead_letter_rows;

    UPDATE dead_letter_operation_metadata
    SET recovery_status = 'completed',
        recovery_reference = COALESCE(recovery_reference, ${sqlText(row.closureReference)}),
        recovery_started_at = COALESCE(recovery_started_at, ${repairedAt}),
        recovery_completed_at = COALESCE(recovery_completed_at, ${repairedAt}),
        audit_reference = COALESCE(audit_reference, ${sqlText(row.closureReference)}),
        updated_at = ${repairedAt}
    WHERE dlq_id = ${sqlText(row.dlqId)}
      AND operation_id = ${sqlText(incident.operationId)}
      AND original_work_key = ${sqlText(incident.workKey)}
      AND generation = ${incident.generation}
      AND original_requested_at = ${incident.requestedAt}
      AND main_queue_attempts = ${row.mainQueueAttempts}
      AND dlq_delivery_attempts = ${row.dlqDeliveryAttempts}
      AND recovery_status IN ('not_started', 'completed')
      AND EXISTS (
        SELECT 1 FROM dead_letter_jobs
        WHERE dlq_id = ${sqlText(row.dlqId)}
          AND status = 'redriven'
          AND redrive_reference = ${sqlText(row.closureReference)}
      )
      AND EXISTS (
        SELECT 1 FROM sync_work_runs
        WHERE work_key = ${sqlText(incident.workKey)}
          AND generation = ${incident.generation}
          AND requested_at = ${incident.requestedAt}
          AND lifecycle_status = 'completed'
          AND json_extract(completion_json, '$.schemaVersion') = 'woocommerce_commerce_reconciliation_v1'
          AND json_extract(completion_json, '$.scopeMode') = 'full_inventory'
          AND json_extract(completion_json, '$.failed') = 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM sync_locks
        WHERE owner_id = ${sqlText(`woocommerce:${incident.operationId}`)}
          AND expires_at > unixepoch('now') * 1000
      );
    SELECT changes() AS metadata_rows;
  `)).join(' ');
}

export function validateWooCommerceDlqClosureRepairResults(rows) {
  if (!Array.isArray(rows) || rows.length !== 6) throw closureError(
    'WooCommerce DLQ closure repair returned an unexpected result count',
    'WOOCOMMERCE_DLQ_CLOSURE_REPAIR_RESULT_INVALID',
    { rowCount: Array.isArray(rows) ? rows.length : null },
  );
  const counts = rows.map((row, index) => Number(
    index % 2 === 0 ? row?.dead_letter_rows : row?.metadata_rows,
  ));
  if (counts.some((count) => count !== 1)) throw closureError(
    'WooCommerce DLQ closure repair did not update every exact metadata row',
    'WOOCOMMERCE_DLQ_CLOSURE_REPAIR_RESULT_INVALID',
    { counts },
  );
  return Object.freeze({ statementCount: counts.length, updatedRows: counts.reduce((a, b) => a + b, 0) });
}

export function assertWooCommerceDlqClosureNoSnapshotDrift(beforeInput, afterInput) {
  const before = normalizeWooCommerceFinalSnapshot(beforeInput);
  const after = normalizeWooCommerceFinalSnapshot(afterInput);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw closureError(
    'WooCommerce DLQ closure changed exact operation snapshot evidence',
    'WOOCOMMERCE_DLQ_CLOSURE_SNAPSHOT_DRIFT',
  );
  return true;
}

function freezeIncidentRow(value) {
  return Object.freeze({
    ...value,
    closureReference: `closure:${value.dlqId}:woocommerce:woo-final-full-e2372e56d52d`,
  });
}

function compactSql(value) { return value.replace(/\s+/gu, ' ').trim(); }
function sqlText(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function timestamp(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${field} must be an epoch millisecond`);
  return number;
}
function closureError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommerceDlqClosureError';
  error.code = code;
  error.details = details;
  return error;
}
