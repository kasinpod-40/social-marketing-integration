export const REPORT_RUNTIME_FRESH_CONFIG_DLQ_RECOVERY_CONTRACT_VERSION =
  'report_runtime_fresh_config_dlq_recovery_v1';

export const REPORT_RUNTIME_FRESH_CONFIG_DLQ_INCIDENT = Object.freeze({
  dlqId: 'terminal:9073b534c14d227408bb8be1921bc0ad',
  messageId: '9073b534c14d227408bb8be1921bc0ad',
  jobType: 'report.materialization.generate',
  errorCode: 'DASHBOARD_REPORT_CONFIGURATION_INVALID',
  retryCount: 1,
  originalWorkKey: 'tiktok:9073b534c14d227408bb8be1921bc0ad',
  generation: 1785410844381,
  originalRequestedAt: 1785410844381,
  mainQueueAttempts: 1,
  dlqDeliveryAttempts: 0,
  reportId:
    'integration_workspace:tiktok:rolling:1d:chemistry_k:rolling_days:2026-07-28:2026-07-28:tiktok-organic-v1',
  reportSettingKey: 'integration_workspace:tiktok:rolling:1d',
  windowDays: 1,
  operation: 'fresh',
  closureReference:
    'report-fresh-config-dlq-recovery-v1:terminal:9073b534c14d227408bb8be1921bc0ad',
});

const TERMINAL_DLQ_STATUSES = new Set(['open', 'redriven']);

export function assertReportRuntimeFreshConfigDlqPreflight(row = {}) {
  if (row.coverage_status !== 'complete'
    || !optionalText(row.source_watermark)
    || !optionalText(row.period_end)
    || Number(row.content_state_count) <= 0
    || Number(row.observation_count) <= 0
    || Number(row.active_report_locks) !== 0
    || Number(row.open_report_dlq) !== 1) {
    throw recoveryError(
      'Current D1 preflight differs from the exact fresh Report configuration-DLQ incident',
      'REPORT_RUNTIME_FRESH_CONFIG_DLQ_PREFLIGHT_INVALID',
      {
        coverageStatus: row.coverage_status ?? null,
        contentStateCount: finiteOrNull(row.content_state_count),
        observationCount: finiteOrNull(row.observation_count),
        activeReportLocks: finiteOrNull(row.active_report_locks),
        openReportDlq: finiteOrNull(row.open_report_dlq),
      },
    );
  }
  return true;
}

export function assertReportRuntimeFreshConfigDlqIncident(row = {}) {
  const incident = REPORT_RUNTIME_FRESH_CONFIG_DLQ_INCIDENT;
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
    'Fresh Report configuration-DLQ evidence differs from the exact 1D incident',
    'REPORT_RUNTIME_FRESH_CONFIG_DLQ_INCIDENT_MISMATCH',
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

export function assertReportRuntimeFreshConfigDlqEvidence(input = {}) {
  const incident = REPORT_RUNTIME_FRESH_CONFIG_DLQ_INCIDENT;
  const deploy = requireObject(input.deployAttempt, 'deployAttempt');
  const first = requireObject(input.sendFirstAttempt, 'sendFirstAttempt');
  const restore = requireObject(input.restoreAttempt, 'restoreAttempt');
  const candidate = requireObject(input.candidate, 'candidate');
  const activeConfigSha256 = requireSha256(input.activeConfigSha256, 'activeConfigSha256');
  const safeConfigSha256 = requireSha256(input.safeConfigSha256, 'safeConfigSha256');
  const jobSha256 = requireSha256(input.jobSha256, 'jobSha256');
  const originalRepositoryHead = requireGitHead(deploy.repositoryHead, 'deployAttempt.repositoryHead');

  if (input.summaryExists === true
    || input.replayAttempt !== null
    || first.operation !== incident.operation
    || Number(first.requestedAt) !== incident.originalRequestedAt
    || first.reportId !== incident.reportId
    || requireSha256(first.jobSha256, 'sendFirstAttempt.jobSha256') !== jobSha256
    || deploy.operation !== incident.operation
    || Number(deploy.windowDays) !== incident.windowDays
    || deploy.selectedReportId !== incident.reportId
    || requireSha256(deploy.configSha256, 'deployAttempt.configSha256') !== activeConfigSha256
    || requireGitHead(restore.repositoryHead, 'restoreAttempt.repositoryHead') !== originalRepositoryHead
    || requireSha256(restore.configSha256, 'restoreAttempt.configSha256') !== safeConfigSha256
    || candidate.operation !== incident.operation
    || Number(candidate.windowDays) !== incident.windowDays
    || candidate.reportId !== incident.reportId
    || candidate.reportSettingKey !== incident.reportSettingKey
    || candidate.job?.type !== incident.jobType
    || candidate.job?.trigger !== 'dashboard_preset'
    || candidate.job?.periodKind !== 'rolling_days'
    || candidate.job?.reportRequestId !== undefined
    || Date.parse(candidate.job?.requestedAt) !== incident.originalRequestedAt) {
    throw recoveryError(
      'Original 1D Report evidence does not authorize exact fresh configuration-DLQ recovery',
      'REPORT_RUNTIME_FRESH_CONFIG_DLQ_EVIDENCE_MISMATCH',
      {
        reportIdMatched: first.reportId === incident.reportId,
        operation: first.operation ?? null,
        windowDays: finiteOrNull(deploy.windowDays),
      },
    );
  }

  return Object.freeze({
    reportId: incident.reportId,
    requestedAt: incident.originalRequestedAt,
    jobSha256,
    originalRepositoryHead,
  });
}

export function assertReportRuntimeFreshConfigDlqInitialState(row = {}) {
  if (row.report_id !== null
    || row.payload_checksum !== null
    || Number(row.materialization_count) !== 0
    || Number(row.successful_sync_count) !== 0
    || Number(row.active_lock_count) !== 0
    || Number(row.exact_incident_count) !== 1
    || Number(row.other_open_report_dlq) !== 0) {
    throw recoveryError(
      'Current D1 state differs from the exact unmaterialized 1D Report incident',
      'REPORT_RUNTIME_FRESH_CONFIG_DLQ_INITIAL_STATE_INVALID',
      {
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

export function assertReportRuntimeFreshConfigDlqCompletion(row = {}, minimumSuccessfulRuns = 1) {
  const incident = REPORT_RUNTIME_FRESH_CONFIG_DLQ_INCIDENT;
  const minimum = positiveInteger(minimumSuccessfulRuns, 'minimumSuccessfulRuns');
  if (row.report_id !== incident.reportId
    || !optionalText(row.payload_checksum)
    || !optionalText(row.payload_json)
    || Number(row.materialization_count) !== 1
    || Number(row.successful_sync_count) < minimum
    || String(row.latest_sync_status ?? '') !== 'success'
    || Number(row.active_lock_count) !== 0
    || Number(row.new_dlq_count) !== 0) {
    throw recoveryError(
      'Exact 1D Report recovery did not reach the required completed state',
      'REPORT_RUNTIME_FRESH_CONFIG_DLQ_COMPLETION_INCOMPLETE',
      {
        reportIdMatched: row.report_id === incident.reportId,
        materializationCount: finiteOrNull(row.materialization_count),
        successfulSyncCount: finiteOrNull(row.successful_sync_count),
        requiredSuccessfulRuns: minimum,
        latestSyncStatus: row.latest_sync_status ?? null,
        activeLockCount: finiteOrNull(row.active_lock_count),
        newDlqCount: finiteOrNull(row.new_dlq_count),
      },
    );
  }
  return true;
}

export function assertReportRuntimeStableActiveDeployment(samples = [], expected = {}) {
  if (!Array.isArray(samples) || samples.length < 3) throw recoveryError(
    'Report Queue send requires at least three stable Active deployment samples',
    'REPORT_RUNTIME_ACTIVE_DEPLOYMENT_NOT_STABLE',
    { sampleCount: Array.isArray(samples) ? samples.length : 0 },
  );
  const expectedVersionId = requireText(expected.versionId, 'expected.versionId');
  const expectedTrueFlags = normalizeTexts(expected.trueFlags);
  for (const sample of samples) {
    if (sample?.versionId !== expectedVersionId
      || stableJson(normalizeTexts(sample?.trueFlags)) !== stableJson(expectedTrueFlags)
      || sample?.mode !== 'active') {
      throw recoveryError(
        'Active Worker deployment changed before the Report Queue send',
        'REPORT_RUNTIME_ACTIVE_DEPLOYMENT_NOT_STABLE',
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

export function buildReportRuntimeFreshConfigDlqEvidenceSql() {
  const incident = REPORT_RUNTIME_FRESH_CONFIG_DLQ_INCIDENT;
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

export function buildReportRuntimeFreshConfigDlqInitialStateSql() {
  const incident = REPORT_RUNTIME_FRESH_CONFIG_DLQ_INCIDENT;
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

export function buildReportRuntimeFreshConfigDlqCompletionSql(retryRequestedAt) {
  const incident = REPORT_RUNTIME_FRESH_CONFIG_DLQ_INCIDENT;
  const retryAt = positiveInteger(retryRequestedAt, 'retryRequestedAt');
  return compactSql(`
    SELECT
      (SELECT report_id FROM report_materializations WHERE report_id = ${sqlText(incident.reportId)}) AS report_id,
      (SELECT payload_checksum FROM report_materializations WHERE report_id = ${sqlText(incident.reportId)}) AS payload_checksum,
      (SELECT payload_json FROM report_materializations WHERE report_id = ${sqlText(incident.reportId)}) AS payload_json,
      (SELECT data_status FROM report_materializations WHERE report_id = ${sqlText(incident.reportId)}) AS data_status,
      (SELECT generated_at FROM report_materializations WHERE report_id = ${sqlText(incident.reportId)}) AS generated_at,
      (SELECT COUNT(*) FROM report_materializations WHERE report_id = ${sqlText(incident.reportId)}) AS materialization_count,
      (SELECT COUNT(*) FROM sync_runs
        WHERE platform = 'tiktok' AND account_key = 'chemistry_k'
          AND sync_type = 'dashboard_performance_report' AND status = 'success'
          AND started_at >= ${retryAt}) AS successful_sync_count,
      (SELECT status FROM sync_runs
        WHERE platform = 'tiktok' AND account_key = 'chemistry_k'
          AND sync_type = 'dashboard_performance_report' AND started_at >= ${retryAt}
        ORDER BY started_at DESC, sync_run_id DESC LIMIT 1) AS latest_sync_status,
      (SELECT COUNT(*) FROM sync_locks l JOIN sync_runs r ON r.sync_run_id = l.owner_id
        WHERE r.platform = 'tiktok' AND r.account_key = 'chemistry_k'
          AND r.sync_type = 'dashboard_performance_report'
          AND r.started_at >= ${retryAt}
          AND l.expires_at > (unixepoch() * 1000)) AS active_lock_count,
      (SELECT COUNT(*) FROM dead_letter_jobs
        WHERE job_type = ${sqlText(incident.jobType)} AND created_at >= ${retryAt}) AS new_dlq_count;
  `);
}

export function buildReportRuntimeFreshConfigDlqClosureStatements(now = Date.now()) {
  const incident = REPORT_RUNTIME_FRESH_CONFIG_DLQ_INCIDENT;
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

export function assertReportRuntimeFreshConfigDlqClosed(row = {}) {
  const incident = REPORT_RUNTIME_FRESH_CONFIG_DLQ_INCIDENT;
  assertReportRuntimeFreshConfigDlqIncident(row);
  if (row.status !== 'redriven'
    || row.redrive_reference !== incident.closureReference
    || !Number.isSafeInteger(Number(row.redriven_at))
    || row.recovery_status !== 'completed'
    || row.recovery_reference !== incident.closureReference
    || !Number.isSafeInteger(Number(row.recovery_completed_at))
    || row.audit_reference !== incident.closureReference) {
    throw recoveryError(
      'Exact retained 1D Report DLQ metadata was not closed idempotently',
      'REPORT_RUNTIME_FRESH_CONFIG_DLQ_CLOSURE_INVALID',
    );
  }
  return true;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw recoveryError(
    `Fresh Report configuration-DLQ recovery requires ${fieldName}`,
    'REPORT_RUNTIME_FRESH_CONFIG_DLQ_VALUE_INVALID',
    { fieldName },
  );
  return value;
}

function requireText(value, fieldName) {
  const text = optionalText(value);
  if (!text) throw recoveryError(
    `Fresh Report configuration-DLQ recovery requires ${fieldName}`,
    'REPORT_RUNTIME_FRESH_CONFIG_DLQ_VALUE_INVALID',
    { fieldName },
  );
  return text;
}

function requireGitHead(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(text)) throw recoveryError(
    `Fresh Report configuration-DLQ recovery requires a Git SHA for ${fieldName}`,
    'REPORT_RUNTIME_FRESH_CONFIG_DLQ_VALUE_INVALID',
    { fieldName },
  );
  return text;
}

function requireSha256(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(text)) throw recoveryError(
    `Fresh Report configuration-DLQ recovery requires SHA-256 ${fieldName}`,
    'REPORT_RUNTIME_FRESH_CONFIG_DLQ_VALUE_INVALID',
    { fieldName },
  );
  return text;
}

function normalizeTexts(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => optionalText(item)).filter(Boolean))].sort();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw recoveryError(
    `${fieldName} must be a positive integer`,
    'REPORT_RUNTIME_FRESH_CONFIG_DLQ_VALUE_INVALID',
    { fieldName },
  );
  return number;
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
  error.name = 'ReportRuntimeFreshConfigDlqRecoveryError';
  error.code = code;
  error.details = details;
  return error;
}
