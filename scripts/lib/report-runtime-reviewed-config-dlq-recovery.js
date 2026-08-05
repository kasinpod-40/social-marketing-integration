import { closeoutFailure, compactSql, sha256, sqlText, stableJson } from './report-runtime-closeout-reviewed-process.js';

export const REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_RECOVERY_CONTRACT =
  'report_runtime_reviewed_config_dlq_recovery_v1';

export const REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT = Object.freeze({
  originalRepositoryHead: '158f881a61b3a41bb219b8990c59099777fb68f4',
  platformScope: 'facebook',
  capability: 'organic',
  accountKey: 'chemistry_k',
  formulaVersion: 'facebook-organic-v1',
  windowDays: 1,
  periodEnd: '2026-07-31',
  sourceWatermark: '2026-07-28T10:01:10+0000',
  requestedAt: 1785918760577,
  reportSettingKey: 'integration_workspace:facebook:rolling:1d',
  reportId:
    'integration_workspace:facebook:rolling:1d:chemistry_k:rolling_days:2026-07-31:2026-07-31:facebook-organic-v1',
  jobSha256: 'cee6c82f7732ab99d5f81d8e70c6108a33bed95b1b685d007c50d3f6122bd298',
  dlqId: 'terminal:4c366c2b02ad5162c6e4035899d67abc',
  messageId: '4c366c2b02ad5162c6e4035899d67abc',
  queueName: 'social-mkt-sync-jobs',
  jobType: 'report.materialization.generate',
  errorCode: 'DASHBOARD_REPORT_CONFIGURATION_INVALID',
  errorMessage: 'Dashboard report requires a reviewed D1-primary job contract',
  retryCount: 1,
  replayPayloadSha256: 'cee6c82f7732ab99d5f81d8e70c6108a33bed95b1b685d007c50d3f6122bd298',
  closureReference:
    'report-runtime-reviewed-config-dlq-recovery-v1:terminal:4c366c2b02ad5162c6e4035899d67abc',
});

export function assertReviewedConfigDlqAttempt(value = {}) {
  const incident = REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT;
  if (value.reportId !== incident.reportId
    || value.action !== 'create_materialization'
    || Number(value.requestedAt) !== incident.requestedAt
    || value.jobSha256 !== incident.jobSha256) throw recoveryFailure(
    'Retained Facebook 1D Queue attempt differs from the exact configuration-DLQ incident',
    'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_ATTEMPT_MISMATCH',
    {
      reportIdMatched: value.reportId === incident.reportId,
      action: value.action ?? null,
      requestedAt: Number(value.requestedAt ?? 0),
      jobSha256Matched: value.jobSha256 === incident.jobSha256,
    },
  );
  return true;
}

export function assertReviewedConfigDlqCandidate(candidate = {}) {
  const incident = REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT;
  const job = candidate.job ?? {};
  if (candidate.reportId !== incident.reportId
    || candidate.reportSettingKey !== incident.reportSettingKey
    || Number(candidate.windowDays) !== incident.windowDays
    || job.type !== incident.jobType
    || job.trigger !== 'dashboard_preset'
    || job.periodKind !== 'rolling_days'
    || Number(job.windowDays) !== incident.windowDays
    || job.periodEnd !== incident.periodEnd
    || job.platformScope !== incident.platformScope
    || job.reportSettingKey !== incident.reportSettingKey
    || job.sourceWatermark !== incident.sourceWatermark
    || Date.parse(job.requestedAt) !== incident.requestedAt
    || sha256(stableJson(job)) !== incident.jobSha256) throw recoveryFailure(
    'Regenerated Facebook 1D job differs from the exact retained DLQ payload',
    'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_CANDIDATE_MISMATCH',
    {
      reportIdMatched: candidate.reportId === incident.reportId,
      reportSettingKeyMatched: candidate.reportSettingKey === incident.reportSettingKey,
      windowDays: Number(candidate.windowDays ?? 0),
      jobSha256Matched: sha256(stableJson(job)) === incident.jobSha256,
    },
  );
  return true;
}

export function assertReviewedConfigDlqPreflight(row = {}) {
  const incident = REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT;
  if (row.coverage_status !== 'complete'
    || row.coverage_dataset_key !== 'facebook.account.daily'
    || row.source_scope !== 'account'
    || row.source_watermark !== incident.sourceWatermark
    || row.period_end !== incident.periodEnd
    || Number(row.account_fact_count ?? 0) <= 0
    || Number(row.active_report_work_count ?? 0) !== 0
    || Number(row.active_report_locks ?? 0) !== 0
    || Number(row.open_report_dlq ?? 0) !== 1
    || Number(row.open_report_critical_alerts ?? 0) !== 0) throw recoveryFailure(
    'Current Facebook Report preflight differs from the exact configuration-DLQ incident',
    'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_PREFLIGHT_MISMATCH',
    {
      coverageStatus: row.coverage_status ?? null,
      coverageDatasetKey: row.coverage_dataset_key ?? null,
      sourceScope: row.source_scope ?? null,
      sourceWatermarkMatched: row.source_watermark === incident.sourceWatermark,
      periodEndMatched: row.period_end === incident.periodEnd,
      accountFactCount: Number(row.account_fact_count ?? 0),
      activeReportWorkCount: Number(row.active_report_work_count ?? 0),
      activeReportLocks: Number(row.active_report_locks ?? 0),
      openReportDlq: Number(row.open_report_dlq ?? 0),
      openReportCriticalAlerts: Number(row.open_report_critical_alerts ?? 0),
    },
  );
  return true;
}

export function assertReviewedConfigDlqIncident(row = {}) {
  const incident = REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT;
  let replayPayload = null;
  try { replayPayload = JSON.parse(String(row.replay_payload_json ?? '')); } catch { /* invalid below */ }
  if (row.dlq_id !== incident.dlqId
    || row.message_id !== incident.messageId
    || row.queue_name !== incident.queueName
    || row.job_type !== incident.jobType
    || Number(row.schema_version) !== 1
    || row.error_code !== incident.errorCode
    || row.error_message !== incident.errorMessage
    || Number(row.retry_count) !== incident.retryCount
    || row.status !== 'open'
    || sha256(String(row.replay_payload_json ?? '')) !== incident.replayPayloadSha256
    || replayPayload?.type !== incident.jobType
    || replayPayload?.platformScope !== incident.platformScope
    || replayPayload?.trigger !== 'dashboard_preset'
    || replayPayload?.periodKind !== 'rolling_days'
    || Number(replayPayload?.windowDays) !== incident.windowDays
    || replayPayload?.reportSettingKey !== incident.reportSettingKey
    || replayPayload?.periodEnd !== incident.periodEnd
    || replayPayload?.sourceWatermark !== incident.sourceWatermark
    || Date.parse(replayPayload?.requestedAt) !== incident.requestedAt
    || row.metadata_dlq_id !== incident.dlqId
    || row.operation_id !== null
    || Number(row.original_requested_at) !== incident.requestedAt
    || Number(row.main_queue_attempts) !== 1
    || Number(row.dlq_delivery_attempts) !== 0
    || !['not_started', 'completed'].includes(String(row.recovery_status ?? ''))) throw recoveryFailure(
    'Remote DLQ state differs from the exact Facebook 1D configuration incident',
    'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT_MISMATCH',
    {
      dlqIdMatched: row.dlq_id === incident.dlqId,
      messageIdMatched: row.message_id === incident.messageId,
      status: row.status ?? null,
      errorCode: row.error_code ?? null,
      retryCount: Number(row.retry_count ?? 0),
      replayPayloadSha256Matched:
        sha256(String(row.replay_payload_json ?? '')) === incident.replayPayloadSha256,
      metadataPresent: row.metadata_dlq_id === incident.dlqId,
      originalRequestedAt: Number(row.original_requested_at ?? 0),
    },
  );
  return Object.freeze({
    originalWorkKey: String(row.original_work_key ?? ''),
    generation: Number(row.generation ?? 0),
    replayPayload: Object.freeze(replayPayload),
  });
}

export function assertReviewedConfigDlqInitialState(input = {}) {
  const d1 = input.d1 ?? {};
  const lark = input.lark ?? {};
  if (d1.report_id !== null
    || Number(d1.materialization_count ?? 0) !== 0
    || Number(d1.successful_sync_count ?? 0) !== 0
    || Number(d1.active_lock_count ?? 0) !== 0
    || Number(lark.snapshots ?? 0) !== 0
    || Number(lark.metrics ?? 0) !== 0
    || Number(lark.topContent ?? 0) !== 0
    || Number(lark.topAds ?? 0) !== 0
    || Number(lark.duplicateMetricKeys ?? 0) !== 0) throw recoveryFailure(
    'Facebook 1D target is no longer the exact unmaterialized incident state',
    'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INITIAL_STATE_MISMATCH',
    {
      reportId: d1.report_id ?? null,
      materializationCount: Number(d1.materialization_count ?? 0),
      successfulSyncCount: Number(d1.successful_sync_count ?? 0),
      activeLockCount: Number(d1.active_lock_count ?? 0),
      larkSnapshots: Number(lark.snapshots ?? 0),
      larkMetrics: Number(lark.metrics ?? 0),
      larkTopContent: Number(lark.topContent ?? 0),
      larkTopAds: Number(lark.topAds ?? 0),
      duplicateMetricKeys: Number(lark.duplicateMetricKeys ?? 0),
    },
  );
  return true;
}

export function buildReviewedConfigDlqIncidentSql() {
  const incident = REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT;
  return compactSql(`
    SELECT
      d.dlq_id, d.message_id, d.queue_name, d.job_type, d.schema_version,
      d.payload_json, d.replay_payload_json, d.error_code, d.error_message,
      d.retry_count, d.status, d.created_at, d.updated_at,
      d.redrive_requested_at, d.redrive_reference, d.redriven_at,
      m.dlq_id AS metadata_dlq_id, m.operation_id, m.original_work_key,
      m.generation, m.original_requested_at, m.main_queue_attempts,
      m.dlq_delivery_attempts, m.recovery_status, m.recovery_reference,
      m.recovery_completed_at, m.audit_reference
    FROM dead_letter_jobs d
    LEFT JOIN dead_letter_operation_metadata m ON m.dlq_id = d.dlq_id
    WHERE d.dlq_id = '${sqlText(incident.dlqId)}';
  `);
}

export function buildReviewedConfigDlqClosureStatements(now = Date.now()) {
  const incident = REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT;
  const repairedAt = Number(now);
  if (!Number.isSafeInteger(repairedAt) || repairedAt <= 0) throw recoveryFailure(
    'DLQ closure timestamp must be a positive epoch millisecond',
    'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_VALUE_INVALID',
  );
  const reference = sqlText(incident.closureReference);
  return Object.freeze([
    compactSql(`
      UPDATE dead_letter_jobs
      SET status = 'redriven',
          redrive_requested_at = COALESCE(redrive_requested_at, ${repairedAt}),
          redrive_reference = COALESCE(redrive_reference, '${reference}'),
          redriven_at = COALESCE(redriven_at, ${repairedAt}),
          updated_at = ${repairedAt}
      WHERE dlq_id = '${sqlText(incident.dlqId)}'
        AND message_id = '${sqlText(incident.messageId)}'
        AND queue_name = '${sqlText(incident.queueName)}'
        AND job_type = '${sqlText(incident.jobType)}'
        AND error_code = '${sqlText(incident.errorCode)}'
        AND retry_count = ${incident.retryCount}
        AND status IN ('open', 'redriven')
        AND (redrive_reference IS NULL OR redrive_reference = '${reference}');
    `),
    compactSql(`
      UPDATE dead_letter_operation_metadata
      SET recovery_status = 'completed',
          recovery_reference = COALESCE(recovery_reference, '${reference}'),
          recovery_completed_at = COALESCE(recovery_completed_at, ${repairedAt}),
          audit_reference = COALESCE(audit_reference, '${reference}')
      WHERE dlq_id = '${sqlText(incident.dlqId)}'
        AND operation_id IS NULL
        AND original_requested_at = ${incident.requestedAt}
        AND main_queue_attempts = 1
        AND dlq_delivery_attempts = 0
        AND recovery_status IN ('not_started', 'completed')
        AND (recovery_reference IS NULL OR recovery_reference = '${reference}')
        AND (audit_reference IS NULL OR audit_reference = '${reference}');
    `),
  ]);
}

export function assertReviewedConfigDlqClosed(row = {}) {
  const incident = REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT;
  if (row.dlq_id !== incident.dlqId
    || row.status !== 'redriven'
    || row.redrive_reference !== incident.closureReference
    || row.recovery_status !== 'completed'
    || row.recovery_reference !== incident.closureReference
    || row.audit_reference !== incident.closureReference) throw recoveryFailure(
    'Exact Facebook Report DLQ closure readback is incomplete',
    'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_CLOSURE_INCOMPLETE',
    {
      status: row.status ?? null,
      redriveReference: row.redrive_reference ?? null,
      recoveryStatus: row.recovery_status ?? null,
      recoveryReference: row.recovery_reference ?? null,
      auditReference: row.audit_reference ?? null,
    },
  );
  return true;
}

function recoveryFailure(message, code, details = {}) {
  return closeoutFailure(message, code, details);
}
