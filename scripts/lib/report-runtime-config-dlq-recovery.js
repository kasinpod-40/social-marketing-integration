export const REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_CONTRACT_VERSION = 'report_runtime_config_dlq_recovery_v1';
export const REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_CONFIRMATION = 'RECOVER_EXACT_REPORT_CONFIG_DLQ_AND_CONTINUE';
export const REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT = Object.freeze({
  dlqId: 'terminal:cb455db34ca87cf5f621d748be80d451',
  messageId: 'cb455db34ca87cf5f621d748be80d451',
  jobType: 'report.materialization.generate',
  errorCode: 'DASHBOARD_REPORT_CONFIGURATION_INVALID',
  retryCount: 1,
  originalWorkKey: 'tiktok:cb455db34ca87cf5f621d748be80d451',
  generation: 1785385276557,
  originalRequestedAt: 1785385276557,
  mainQueueAttempts: 1,
  dlqDeliveryAttempts: 0,
  reportId: 'integration_workspace:tiktok:rolling:3d:chemistry_k:rolling_days:2026-07-26:2026-07-28:tiktok-organic-v1',
  payloadChecksum: 'e652fa4dae2558082de363d893698b94365b8b1ea63e9acafe66134d7b4da814',
  windowDays: 3,
  operation: 'refresh',
  closureReference: 'report-config-dlq-recovery-v1:terminal:cb455db34ca87cf5f621d748be80d451',
});

const TERMINAL_DLQ_STATUSES = new Set(['open', 'redriven']);

export function assertReportRuntimeConfigDlqRecoveryConfirmation(env = {}) {
  if (env.CONFIRM_REPORT_RUNTIME_CONFIG_DLQ_RECOVERY !== REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_CONFIRMATION) {
    throw recoveryError(
      `Execution requires CONFIRM_REPORT_RUNTIME_CONFIG_DLQ_RECOVERY=${REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_CONFIRMATION}`,
      'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function assertReportRuntimeConfigDlqIncident(row = {}) {
  const incident = REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT;
  const status = optionalText(row.status);
  const exact = row.dlq_id === incident.dlqId
    && row.message_id === incident.messageId
    && TERMINAL_DLQ_STATUSES.has(status)
    && row.job_type === incident.jobType
    && row.error_code === incident.errorCode
    && Number(row.retry_count) === incident.retryCount
    && row.operation_id === null
    && row.original_work_key === incident.originalWorkKey
    && Number(row.generation) === incident.generation
    && Number(row.original_requested_at) === incident.originalRequestedAt
    && Number(row.main_queue_attempts) === incident.mainQueueAttempts
    && Number(row.dlq_delivery_attempts) === incident.dlqDeliveryAttempts
    && ['not_started', 'completed'].includes(String(row.recovery_status ?? ''));
  if (!exact) throw recoveryError(
    'Report replay DLQ evidence differs from the exact configuration incident',
    'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT_MISMATCH',
    {
      dlqId: row.dlq_id ?? null,
      status,
      errorCode: row.error_code ?? null,
      retryCount: finiteOrNull(row.retry_count),
      mainQueueAttempts: finiteOrNull(row.main_queue_attempts),
    },
  );
  return Object.freeze({
    dlqId: incident.dlqId,
    status,
    recoveryStatus: String(row.recovery_status),
    alreadyClosed: status === 'redriven' && row.recovery_status === 'completed',
  });
}

export function assertReportRuntimeConfigDlqMetricRepairSummary(summary = {}) {
  const incident = REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT;
  if (summary.ok !== true
    || summary.contractVersion !== 'report_runtime_metric_null_repair_v1'
    || summary.decision !== 'EXACT_REPORT_METRIC_NULLS_REPAIRED'
    || summary.target?.platform !== 'tiktok'
    || summary.target?.capability !== 'organic'
    || summary.target?.operation !== incident.operation
    || Number(summary.target?.windowDays) !== incident.windowDays
    || summary.target?.reportId !== incident.reportId
    || summary.materialization?.payloadChecksum !== incident.payloadChecksum
    || Number(summary.repair?.metricCount) !== 10
    || Number(summary.repair?.staleNullableCurrentCount) !== 6
    || Number(summary.repair?.nonRepairableCurrentMismatchCount) !== 0
    || Number(summary.readback?.mismatchCount) !== 0
    || summary.repair?.firstMaterializationRetried !== false
    || summary.repair?.queueMessageSent !== false
    || summary.repair?.workerDeploymentAttempted !== false
    || summary.repair?.remoteD1Mutated !== false
    || summary.production !== false) {
    throw recoveryError(
      'Metric null repair summary does not authorize exact Report replay DLQ recovery',
      'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_METRIC_SUMMARY_INVALID',
    );
  }
  return true;
}

export function assertReportRuntimeConfigDlqInitialState(row = {}) {
  const incident = REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT;
  if (row.report_id !== incident.reportId
    || row.payload_checksum !== incident.payloadChecksum
    || Number(row.materialization_count) !== 1
    || Number(row.successful_sync_count) !== 1
    || Number(row.active_lock_count) !== 0
    || Number(row.exact_incident_count) !== 1
    || Number(row.other_open_report_dlq) !== 0) {
    throw recoveryError(
      'Current D1 state differs from the exact Report replay configuration incident',
      'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_D1_STATE_INVALID',
      {
        reportIdMatched: row.report_id === incident.reportId,
        payloadChecksumMatched: row.payload_checksum === incident.payloadChecksum,
        materializationCount: finiteOrNull(row.materialization_count),
        successfulSyncCount: finiteOrNull(row.successful_sync_count),
        activeLockCount: finiteOrNull(row.active_lock_count),
        exactIncidentCount: finiteOrNull(row.exact_incident_count),
        otherOpenReportDlq: finiteOrNull(row.other_open_report_dlq),
      },
    );
  }
  return true;
}

export function assertReportRuntimeConfigDlqRetryCompletion(row = {}) {
  const incident = REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT;
  if (row.report_id !== incident.reportId
    || row.payload_checksum !== incident.payloadChecksum
    || Number(row.materialization_count) !== 1
    || Number(row.successful_sync_count) < 2
    || String(row.latest_sync_status ?? '') !== 'success'
    || Number(row.active_lock_count) !== 0
    || Number(row.new_dlq_count) !== 0) {
    throw recoveryError(
      'Exact Report replay retry did not reach a completed idempotent state',
      'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_RETRY_INCOMPLETE',
      {
        reportIdMatched: row.report_id === incident.reportId,
        payloadChecksumMatched: row.payload_checksum === incident.payloadChecksum,
        materializationCount: finiteOrNull(row.materialization_count),
        successfulSyncCount: finiteOrNull(row.successful_sync_count),
        latestSyncStatus: row.latest_sync_status ?? null,
        activeLockCount: finiteOrNull(row.active_lock_count),
        newDlqCount: finiteOrNull(row.new_dlq_count),
      },
    );
  }
  return true;
}

export function assertReportRuntimeConfigDlqStableDeployment(samples = [], expected = {}) {
  if (!Array.isArray(samples) || samples.length < 3) throw recoveryError(
    'Report replay recovery requires at least three active deployment samples',
    'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_DEPLOYMENT_NOT_STABLE',
    { sampleCount: Array.isArray(samples) ? samples.length : 0 },
  );
  const expectedVersionId = requireText(expected.versionId, 'expected.versionId');
  const expectedTrueFlags = normalizeTexts(expected.trueFlags);
  for (const sample of samples) {
    if (sample?.versionId !== expectedVersionId
      || stableJson(normalizeTexts(sample?.trueFlags)) !== stableJson(expectedTrueFlags)
      || sample?.mode !== 'active') {
      throw recoveryError(
        'Active Worker deployment did not remain stable before Report replay retry',
        'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_DEPLOYMENT_NOT_STABLE',
        {
          expectedVersionId,
          observedVersionId: sample?.versionId ?? null,
          observedMode: sample?.mode ?? null,
        },
      );
    }
  }
  return Object.freeze({
    sampleCount: samples.length,
    versionId: expectedVersionId,
    trueFlags: Object.freeze(expectedTrueFlags),
  });
}

export function buildReportRuntimeConfigDlqEvidenceSql() {
  const incident = REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT;
  return compactSql(`
    SELECT
      d.dlq_id, d.message_id, d.status, d.job_type, d.error_code, d.retry_count,
      d.redrive_reference, d.redriven_at,
      m.operation_id, m.original_work_key, m.generation, m.original_requested_at,
      m.main_queue_attempts, m.dlq_delivery_attempts, m.recovery_status,
      m.recovery_reference, m.recovery_completed_at, m.audit_reference
    FROM dead_letter_jobs AS d
    JOIN dead_letter_operation_metadata AS m ON m.dlq_id = d.dlq_id
    WHERE d.dlq_id = ${sqlText(incident.dlqId)};
  `);
}

export function buildReportRuntimeConfigDlqInitialStateSql() {
  const incident = REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT;
  return compactSql(`
    SELECT
      (SELECT report_id FROM report_materializations WHERE report_id = ${sqlText(incident.reportId)}) AS report_id,
      (SELECT payload_checksum FROM report_materializations WHERE report_id = ${sqlText(incident.reportId)}) AS payload_checksum,
      (SELECT COUNT(*) FROM report_materializations WHERE report_id = ${sqlText(incident.reportId)}) AS materialization_count,
      (SELECT COUNT(*) FROM sync_runs
        WHERE platform = 'tiktok' AND account_key = 'chemistry_k'
          AND sync_type = 'dashboard_performance_report' AND status = 'success'
          AND started_at >= ${incident.originalRequestedAt}) AS successful_sync_count,
      (SELECT COUNT(*) FROM sync_locks l JOIN sync_runs r ON r.sync_run_id = l.owner_id
        WHERE r.platform = 'tiktok' AND r.account_key = 'chemistry_k'
          AND r.sync_type = 'dashboard_performance_report'
          AND l.expires_at > (unixepoch() * 1000)) AS active_lock_count,
      (SELECT COUNT(*) FROM dead_letter_jobs
        WHERE dlq_id = ${sqlText(incident.dlqId)} AND status IN ('open', 'redriven')) AS exact_incident_count,
      (SELECT COUNT(*) FROM dead_letter_jobs
        WHERE job_type = ${sqlText(incident.jobType)} AND status IN ('open', 'redrive_pending')
          AND dlq_id <> ${sqlText(incident.dlqId)}) AS other_open_report_dlq;
  `);
}

export function buildReportRuntimeConfigDlqRetryStateSql(retryRequestedAt) {
  const incident = REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT;
  const retryAt = positiveInteger(retryRequestedAt, 'retryRequestedAt');
  return compactSql(`
    SELECT
      (SELECT report_id FROM report_materializations WHERE report_id = ${sqlText(incident.reportId)}) AS report_id,
      (SELECT payload_checksum FROM report_materializations WHERE report_id = ${sqlText(incident.reportId)}) AS payload_checksum,
      (SELECT COUNT(*) FROM report_materializations WHERE report_id = ${sqlText(incident.reportId)}) AS materialization_count,
      (SELECT COUNT(*) FROM sync_runs
        WHERE platform = 'tiktok' AND account_key = 'chemistry_k'
          AND sync_type = 'dashboard_performance_report' AND status = 'success'
          AND started_at >= ${incident.originalRequestedAt}) AS successful_sync_count,
      (SELECT status FROM sync_runs
        WHERE platform = 'tiktok' AND account_key = 'chemistry_k'
          AND sync_type = 'dashboard_performance_report' AND started_at >= ${retryAt}
        ORDER BY started_at DESC, sync_run_id DESC LIMIT 1) AS latest_sync_status,
      (SELECT COUNT(*) FROM sync_locks l JOIN sync_runs r ON r.sync_run_id = l.owner_id
        WHERE r.platform = 'tiktok' AND r.account_key = 'chemistry_k'
          AND r.sync_type = 'dashboard_performance_report'
          AND l.expires_at > (unixepoch() * 1000)) AS active_lock_count,
      (SELECT COUNT(*) FROM dead_letter_jobs
        WHERE job_type = ${sqlText(incident.jobType)} AND created_at >= ${retryAt}) AS new_dlq_count;
  `);
}

export function buildReportRuntimeConfigDlqClosureStatements(now = Date.now()) {
  const incident = REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT;
  const repairedAt = positiveInteger(now, 'now');
  const reference = sqlText(incident.closureReference);
  const commonGuard = compactSql(`
    dlq_id = ${sqlText(incident.dlqId)}
      AND message_id = ${sqlText(incident.messageId)}
      AND job_type = ${sqlText(incident.jobType)}
      AND error_code = ${sqlText(incident.errorCode)}
      AND retry_count = ${incident.retryCount}
  `);
  const metadataGuard = compactSql(`
    dlq_id = ${sqlText(incident.dlqId)}
      AND operation_id IS NULL
      AND original_work_key = ${sqlText(incident.originalWorkKey)}
      AND generation = ${incident.generation}
      AND original_requested_at = ${incident.originalRequestedAt}
      AND main_queue_attempts = ${incident.mainQueueAttempts}
      AND dlq_delivery_attempts = ${incident.dlqDeliveryAttempts}
  `);
  return Object.freeze([
    compactSql(`
      UPDATE dead_letter_jobs
      SET status = 'redriven',
          redrive_requested_at = COALESCE(redrive_requested_at, ${repairedAt}),
          redrive_reference = COALESCE(redrive_reference, ${reference}),
          redriven_at = COALESCE(redriven_at, ${repairedAt}),
          updated_at = ${repairedAt}
      WHERE ${commonGuard}
        AND status IN ('open', 'redriven')
        AND (redrive_reference IS NULL OR redrive_reference = ${reference})
        AND EXISTS (
          SELECT 1 FROM dead_letter_operation_metadata
          WHERE ${metadataGuard}
            AND recovery_status IN ('not_started', 'completed')
        );
    `),
    compactSql(`
      UPDATE dead_letter_operation_metadata
      SET recovery_status = 'completed',
          recovery_reference = COALESCE(recovery_reference, ${reference}),
          recovery_completed_at = COALESCE(recovery_completed_at, ${repairedAt}),
          audit_reference = COALESCE(audit_reference, ${reference}),
          updated_at = ${repairedAt}
      WHERE ${metadataGuard}
        AND recovery_status IN ('not_started', 'completed')
        AND (recovery_reference IS NULL OR recovery_reference = ${reference})
        AND EXISTS (
          SELECT 1 FROM dead_letter_jobs
          WHERE ${commonGuard}
            AND status = 'redriven'
            AND redrive_reference = ${reference}
        );
    `),
  ]);
}

export function assertReportRuntimeConfigDlqClosed(row = {}) {
  const incident = REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT;
  assertReportRuntimeConfigDlqIncident(row);
  if (row.status !== 'redriven'
    || row.recovery_status !== 'completed'
    || row.redrive_reference !== incident.closureReference
    || row.recovery_reference !== incident.closureReference
    || row.audit_reference !== incident.closureReference
    || !Number.isSafeInteger(Number(row.redriven_at))
    || !Number.isSafeInteger(Number(row.recovery_completed_at))) {
    throw recoveryError(
      'Exact Report replay DLQ metadata did not reach completed retained closure',
      'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_CLOSURE_INCOMPLETE',
    );
  }
  return true;
}

function normalizeTexts(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].sort();
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be a positive integer`);
  return number;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireText(value, fieldName) {
  const text = optionalText(value);
  if (!text) throw new TypeError(`${fieldName} is required`);
  return text;
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compactSql(value) {
  return String(value).replace(/\s+/gu, ' ').trim();
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function stableJson(value) {
  return JSON.stringify(value);
}

function recoveryError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportRuntimeConfigDlqRecoveryError';
  error.code = code;
  error.details = details;
  return error;
}
