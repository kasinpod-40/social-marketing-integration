import {
  closeoutFailure,
  compactSql,
  sha256,
  sqlText,
  stableJson,
} from './report-runtime-closeout-reviewed-process.js';

export const CHATWOOT_1D_EXACT_INCIDENT_CONTINUATION_CONTRACT =
  'report_runtime_chatwoot_1d_exact_incident_continuation_v1';

export const CHATWOOT_1D_EXACT_INCIDENT = Object.freeze({
  key: 'chatwoot_1d_period_end_scope_20260801',
  label: 'Chatwoot 1D exact Report incident continuation',
  decision: 'CHATWOOT_REPORT_1D_EXACT_INCIDENT_CONTINUATION_COMPLETED',
  confirmation: 'CONTINUE_EXACT_CHATWOOT_1D_REPORT_INCIDENT',
  evidenceDirectory: 'outputs/chatwoot-1d-exact-incident-continuation-50d32078f767',
  requiredRepositoryHead:
    process.env.MKT_REPORT_RUNTIME_CHATWOOT_1D_EXPECTED_HEAD
      ?? '50d32078f767b2acf779425e91efa9b2d606f322',
  finalizerDefault:
    'outputs/report-runtime-finalize/report-runtime-finalize-summary.json',
  platformScope: 'chatwoot',
  capability: 'customer_service',
  accountKey: 'chemistry_k',
  customerKey: 'chemistry_k',
  formulaVersion: 'chatwoot-customer-service-v1',
  windowDays: 1,
  periodStart: '2026-08-01',
  periodEnd: '2026-08-01',
  sourceWatermark: '1785558008068',
  requestedAt: 1786016588074,
  reportSettingKey: 'integration_workspace:chatwoot:rolling:1d',
  reportId:
    'integration_workspace:chatwoot:rolling:1d:chemistry_k:rolling_days:2026-08-01:2026-08-01:chatwoot-customer-service-v1',
  jobType: 'report.materialization.generate',
  expectedMetricCount: 139,
  expectedConversationFactCount: 200,
  expectedAccountFactCount: 42,
  expectedHistoricalConnectorAlertCount: 19,
  failedSync: Object.freeze({
    syncRunId: '1c7a20b3-5bb7-45a3-b591-b71e392a02b6',
    startedAt: 1786016824335,
    finishedAt: 1786016827136,
    status: 'failed',
    errorCode: 'UNHANDLED_SYNC_ERROR',
    errorMessage: 'Unsupported Dashboard metric scope: period_end_snapshot',
  }),
  alert: Object.freeze({
    alertType: 'sync_failed',
    severity: 'critical',
    status: 'open',
    errorCode: 'UNHANDLED_SYNC_ERROR',
    createdAt: 1786016827136,
    updatedAt: 1786016827581,
  }),
  closureReference:
    'report-runtime-chatwoot-1d-exact-incident-continuation-v1:1c7a20b3-5bb7-45a3-b591-b71e392a02b6',
});

export function assertChatwoot1dContinuationCandidate(
  candidate = {},
  incident = CHATWOOT_1D_EXACT_INCIDENT,
) {
  const job = candidate.job ?? {};
  const jobSha256 = sha256(stableJson(job));
  if (candidate.reportId !== incident.reportId
    || candidate.reportSettingKey !== incident.reportSettingKey
    || Number(candidate.windowDays) !== incident.windowDays
    || candidate.period?.periodStart !== incident.periodStart
    || candidate.period?.periodEnd !== incident.periodEnd
    || job.type !== incident.jobType
    || job.trigger !== 'dashboard_preset'
    || job.periodKind !== 'rolling_days'
    || Number(job.windowDays) !== incident.windowDays
    || job.periodEnd !== incident.periodEnd
    || job.platformScope !== incident.platformScope
    || job.reportSettingKey !== incident.reportSettingKey
    || job.sourceWatermark !== incident.sourceWatermark
    || Date.parse(job.requestedAt) !== incident.requestedAt) throw incidentFailure(
    'Regenerated Chatwoot 1D job differs from the exact retained incident',
    'REPORT_RUNTIME_CHATWOOT_1D_CONTINUATION_CANDIDATE_MISMATCH',
    {
      reportIdMatched: candidate.reportId === incident.reportId,
      reportSettingKeyMatched: candidate.reportSettingKey === incident.reportSettingKey,
      windowDays: Number(candidate.windowDays ?? 0),
      requestedAt: Date.parse(job.requestedAt),
      sourceWatermark: job.sourceWatermark ?? null,
    },
  );
  return Object.freeze({ jobSha256 });
}

export function assertChatwoot1dIncidentPreflight(
  row = {},
  incident = CHATWOOT_1D_EXACT_INCIDENT,
) {
  if (String(row.coverage_status ?? '').toLowerCase() !== 'complete'
    || row.coverage_dataset_key !== 'chatwoot.conversation_daily'
    || row.coverage_scope_mode !== null
    || row.source_watermark !== incident.sourceWatermark
    || row.period_end !== incident.periodEnd
    || row.source_scope !== 'customer_service_daily'
    || Number(row.coverage_required_count ?? 0) !== 2
    || Number(row.coverage_watermark_count ?? 0) !== 2
    || Number(row.conversation_fact_count ?? 0) !== incident.expectedConversationFactCount
    || Number(row.account_fact_count ?? 0) !== incident.expectedAccountFactCount
    || Number(row.active_report_work_count ?? 0) !== 0
    || Number(row.active_report_locks ?? 0) !== 0
    || Number(row.open_report_dlq ?? 0) !== 1
    || Number(row.open_report_critical_alerts ?? 0) !== 1
    || Number(row.historical_connector_critical_alerts ?? 0)
      !== incident.expectedHistoricalConnectorAlertCount) throw incidentFailure(
    'Current Chatwoot source/runtime state differs from the exact 1D incident boundary',
    'REPORT_RUNTIME_CHATWOOT_1D_CONTINUATION_PREFLIGHT_MISMATCH',
    {
      coverageStatus: row.coverage_status ?? null,
      coverageDatasetKey: row.coverage_dataset_key ?? null,
      sourceWatermarkMatched: row.source_watermark === incident.sourceWatermark,
      periodEnd: row.period_end ?? null,
      coverageRequiredCount: Number(row.coverage_required_count ?? 0),
      coverageWatermarkCount: Number(row.coverage_watermark_count ?? 0),
      conversationFactCount: Number(row.conversation_fact_count ?? 0),
      accountFactCount: Number(row.account_fact_count ?? 0),
      activeReportWorkCount: Number(row.active_report_work_count ?? 0),
      activeReportLocks: Number(row.active_report_locks ?? 0),
      openReportDlq: Number(row.open_report_dlq ?? 0),
      openReportCriticalAlerts: Number(row.open_report_critical_alerts ?? 0),
      historicalConnectorCriticalAlerts:
        Number(row.historical_connector_critical_alerts ?? 0),
    },
  );
  return true;
}

export function buildChatwoot1dExactIncidentSql(
  incident = CHATWOOT_1D_EXACT_INCIDENT,
) {
  const requestedAtIso = new Date(incident.requestedAt).toISOString();
  return compactSql(`
    WITH exact_sync AS (
      SELECT *
      FROM sync_runs
      WHERE sync_run_id = '${sqlText(incident.failedSync.syncRunId)}'
        AND platform = '${sqlText(incident.platformScope)}'
        AND account_key = '${sqlText(incident.accountKey)}'
        AND sync_type = 'dashboard_performance_report'
        AND status = '${sqlText(incident.failedSync.status)}'
        AND started_at = ${incident.failedSync.startedAt}
        AND finished_at = ${incident.failedSync.finishedAt}
        AND error_code = '${sqlText(incident.failedSync.errorCode)}'
        AND error_message = '${sqlText(incident.failedSync.errorMessage)}'
    ),
    exact_alert AS (
      SELECT a.*
      FROM system_alerts a
      JOIN exact_sync r ON r.sync_run_id = a.sync_run_id
      WHERE a.alert_type = '${sqlText(incident.alert.alertType)}'
        AND a.severity = '${sqlText(incident.alert.severity)}'
        AND a.status = '${sqlText(incident.alert.status)}'
        AND a.error_code = '${sqlText(incident.alert.errorCode)}'
        AND a.created_at = ${incident.alert.createdAt}
        AND a.updated_at = ${incident.alert.updatedAt}
    ),
    exact_dlq AS (
      SELECT
        d.*,
        m.operation_id,
        m.original_work_key,
        m.generation,
        m.original_requested_at,
        m.main_queue_attempts,
        m.dlq_delivery_attempts,
        m.recovery_status,
        m.recovery_reference,
        m.recovery_completed_at,
        m.audit_reference
      FROM dead_letter_jobs d
      LEFT JOIN dead_letter_operation_metadata m ON m.dlq_id = d.dlq_id
      WHERE d.job_type = '${sqlText(incident.jobType)}'
        AND d.status IN ('open', 'redrive_pending')
        AND d.created_at >= ${incident.failedSync.finishedAt}
        AND json_extract(d.replay_payload_json, '$.platformScope')
          = '${sqlText(incident.platformScope)}'
        AND json_extract(d.replay_payload_json, '$.reportSettingKey')
          = '${sqlText(incident.reportSettingKey)}'
        AND json_extract(d.replay_payload_json, '$.periodEnd')
          = '${sqlText(incident.periodEnd)}'
        AND json_extract(d.replay_payload_json, '$.requestedAt')
          = '${sqlText(requestedAtIso)}'
    )
    SELECT
      (SELECT COUNT(*) FROM exact_sync) AS exact_sync_count,
      (SELECT sync_run_id FROM exact_sync LIMIT 1) AS sync_run_id,
      (SELECT status FROM exact_sync LIMIT 1) AS sync_status,
      (SELECT error_code FROM exact_sync LIMIT 1) AS sync_error_code,
      (SELECT error_message FROM exact_sync LIMIT 1) AS sync_error_message,
      (SELECT COUNT(*) FROM exact_alert) AS exact_alert_count,
      (SELECT alert_id FROM exact_alert LIMIT 1) AS alert_id,
      (SELECT sync_run_id FROM exact_alert LIMIT 1) AS alert_sync_run_id,
      (SELECT status FROM exact_alert LIMIT 1) AS alert_status,
      (SELECT error_code FROM exact_alert LIMIT 1) AS alert_error_code,
      (SELECT message FROM exact_alert LIMIT 1) AS alert_message,
      (SELECT created_at FROM exact_alert LIMIT 1) AS alert_created_at,
      (SELECT updated_at FROM exact_alert LIMIT 1) AS alert_updated_at,
      (SELECT COUNT(*) FROM exact_dlq) AS exact_dlq_count,
      (SELECT dlq_id FROM exact_dlq LIMIT 1) AS dlq_id,
      (SELECT message_id FROM exact_dlq LIMIT 1) AS message_id,
      (SELECT queue_name FROM exact_dlq LIMIT 1) AS queue_name,
      (SELECT schema_version FROM exact_dlq LIMIT 1) AS schema_version,
      (SELECT replay_payload_json FROM exact_dlq LIMIT 1) AS replay_payload_json,
      (SELECT error_code FROM exact_dlq LIMIT 1) AS dlq_error_code,
      (SELECT error_message FROM exact_dlq LIMIT 1) AS dlq_error_message,
      (SELECT retry_count FROM exact_dlq LIMIT 1) AS retry_count,
      (SELECT status FROM exact_dlq LIMIT 1) AS dlq_status,
      (SELECT created_at FROM exact_dlq LIMIT 1) AS dlq_created_at,
      (SELECT operation_id FROM exact_dlq LIMIT 1) AS operation_id,
      (SELECT original_work_key FROM exact_dlq LIMIT 1) AS original_work_key,
      (SELECT generation FROM exact_dlq LIMIT 1) AS generation,
      (SELECT original_requested_at FROM exact_dlq LIMIT 1) AS original_requested_at,
      (SELECT main_queue_attempts FROM exact_dlq LIMIT 1) AS main_queue_attempts,
      (SELECT dlq_delivery_attempts FROM exact_dlq LIMIT 1) AS dlq_delivery_attempts,
      (SELECT recovery_status FROM exact_dlq LIMIT 1) AS recovery_status,
      (SELECT recovery_reference FROM exact_dlq LIMIT 1) AS recovery_reference,
      (SELECT audit_reference FROM exact_dlq LIMIT 1) AS audit_reference;
  `);
}

export function assertChatwoot1dExactIncident(
  row = {},
  candidate = {},
  incident = CHATWOOT_1D_EXACT_INCIDENT,
) {
  let replayPayload = null;
  try { replayPayload = JSON.parse(String(row.replay_payload_json ?? '')); } catch {
    // Invalid below.
  }
  const candidateJob = candidate.job ?? {};
  const jobSha256 = sha256(stableJson(candidateJob));
  const replaySha256 = sha256(stableJson(replayPayload ?? {}));
  const alertMessage = String(row.alert_message ?? '');
  if (Number(row.exact_sync_count ?? 0) !== 1
    || row.sync_run_id !== incident.failedSync.syncRunId
    || row.sync_status !== incident.failedSync.status
    || row.sync_error_code !== incident.failedSync.errorCode
    || row.sync_error_message !== incident.failedSync.errorMessage
    || Number(row.exact_alert_count ?? 0) !== 1
    || !hasText(row.alert_id)
    || row.alert_sync_run_id !== incident.failedSync.syncRunId
    || row.alert_status !== incident.alert.status
    || row.alert_error_code !== incident.alert.errorCode
    || Number(row.alert_created_at ?? 0) !== incident.alert.createdAt
    || Number(row.alert_updated_at ?? 0) !== incident.alert.updatedAt
    || !alertMessage.includes(incident.failedSync.errorMessage)
    || Number(row.exact_dlq_count ?? 0) !== 1
    || !hasText(row.dlq_id)
    || !hasText(row.message_id)
    || !hasText(row.queue_name)
    || Number(row.schema_version ?? 0) !== 1
    || row.dlq_status !== 'open'
    || !hasText(row.dlq_error_code)
    || !hasText(row.dlq_error_message)
    || replaySha256 !== jobSha256
    || replayPayload?.type !== incident.jobType
    || replayPayload?.platformScope !== incident.platformScope
    || replayPayload?.reportSettingKey !== incident.reportSettingKey
    || Number(replayPayload?.windowDays) !== incident.windowDays
    || replayPayload?.periodEnd !== incident.periodEnd
    || replayPayload?.sourceWatermark !== incident.sourceWatermark
    || Date.parse(replayPayload?.requestedAt) !== incident.requestedAt
    || row.operation_id !== null
    || !hasText(row.original_work_key)
    || Number(row.generation ?? 0) !== incident.requestedAt
    || Number(row.original_requested_at ?? 0) !== incident.requestedAt
    || Number(row.main_queue_attempts ?? -1) < 0
    || Number(row.dlq_delivery_attempts ?? -1) < 0
    || row.recovery_status !== 'not_started'
    || row.recovery_reference !== null
    || row.audit_reference !== null) throw incidentFailure(
    'Remote Chatwoot Sync Run, DLQ or Alert differs from the exact retained incident',
    'REPORT_RUNTIME_CHATWOOT_1D_CONTINUATION_INCIDENT_MISMATCH',
    {
      exactSyncCount: Number(row.exact_sync_count ?? 0),
      syncRunIdMatched: row.sync_run_id === incident.failedSync.syncRunId,
      exactAlertCount: Number(row.exact_alert_count ?? 0),
      alertStatus: row.alert_status ?? null,
      exactDlqCount: Number(row.exact_dlq_count ?? 0),
      dlqStatus: row.dlq_status ?? null,
      dlqErrorCode: row.dlq_error_code ?? null,
      dlqErrorMessagePresent: hasText(row.dlq_error_message),
      replaySha256Matched: replaySha256 === jobSha256,
      generation: Number(row.generation ?? 0),
      originalRequestedAt: Number(row.original_requested_at ?? 0),
      recoveryStatus: row.recovery_status ?? null,
    },
  );
  return Object.freeze({
    syncRunId: row.sync_run_id,
    alertId: row.alert_id,
    dlqId: row.dlq_id,
    messageId: row.message_id,
    queueName: row.queue_name,
    originalWorkKey: row.original_work_key,
    errorCode: row.dlq_error_code,
    errorMessageFingerprint: sha256(row.dlq_error_message),
    mainQueueAttempts: Number(row.main_queue_attempts),
    dlqDeliveryAttempts: Number(row.dlq_delivery_attempts),
    jobSha256,
    replayPayload: Object.freeze(replayPayload),
    closureReference: incident.closureReference,
  });
}

export function assertChatwoot1dInitialState(
  input = {},
  incident = CHATWOOT_1D_EXACT_INCIDENT,
) {
  const d1 = input.d1 ?? {};
  const lark = input.lark ?? {};
  if (d1.report_id !== null
    || Number(d1.materialization_count ?? 0) !== 0
    || d1.sync_status !== incident.failedSync.status
    || Number(d1.successful_sync_count ?? 0) !== 0
    || Number(d1.active_lock_count ?? 0) !== 0
    || Number(d1.new_dlq_count ?? 0) !== 1
    || Number(lark.snapshots ?? 0) !== 0
    || Number(lark.metrics ?? 0) !== 0
    || Number(lark.topContent ?? 0) !== 0
    || Number(lark.topAds ?? 0) !== 0
    || Number(lark.duplicateMetricKeys ?? 0) !== 0) throw incidentFailure(
    'Chatwoot 1D target is no longer the exact failed-before-write incident state',
    'REPORT_RUNTIME_CHATWOOT_1D_CONTINUATION_INITIAL_STATE_MISMATCH',
    {
      reportId: d1.report_id ?? null,
      materializationCount: Number(d1.materialization_count ?? 0),
      syncStatus: d1.sync_status ?? null,
      successfulSyncCount: Number(d1.successful_sync_count ?? 0),
      activeLockCount: Number(d1.active_lock_count ?? 0),
      newDlqCount: Number(d1.new_dlq_count ?? 0),
      larkSnapshots: Number(lark.snapshots ?? 0),
      larkMetrics: Number(lark.metrics ?? 0),
    },
  );
  return true;
}

export function buildChatwoot1dContinuationPollSql(
  continuationRequestedAt,
  incident = CHATWOOT_1D_EXACT_INCIDENT,
) {
  const startedAt = positiveEpoch(continuationRequestedAt);
  const requestedAtIso = new Date(incident.requestedAt).toISOString();
  return compactSql(`
    SELECT
      (SELECT COUNT(*) FROM sync_runs
        WHERE platform = '${sqlText(incident.platformScope)}'
          AND account_key = '${sqlText(incident.accountKey)}'
          AND sync_type = 'dashboard_performance_report'
          AND started_at >= ${startedAt}
          AND status = 'failed') AS failed_sync_count,
      (SELECT error_code FROM sync_runs
        WHERE platform = '${sqlText(incident.platformScope)}'
          AND account_key = '${sqlText(incident.accountKey)}'
          AND sync_type = 'dashboard_performance_report'
          AND started_at >= ${startedAt}
          AND status = 'failed'
        ORDER BY started_at DESC, sync_run_id DESC LIMIT 1) AS latest_error_code,
      (SELECT error_message FROM sync_runs
        WHERE platform = '${sqlText(incident.platformScope)}'
          AND account_key = '${sqlText(incident.accountKey)}'
          AND sync_type = 'dashboard_performance_report'
          AND started_at >= ${startedAt}
          AND status = 'failed'
        ORDER BY started_at DESC, sync_run_id DESC LIMIT 1) AS latest_error_message,
      (SELECT COUNT(*) FROM dead_letter_jobs
        WHERE job_type = '${sqlText(incident.jobType)}'
          AND created_at >= ${startedAt}
          AND json_extract(replay_payload_json, '$.platformScope')
            = '${sqlText(incident.platformScope)}'
          AND json_extract(replay_payload_json, '$.reportSettingKey')
            = '${sqlText(incident.reportSettingKey)}'
          AND json_extract(replay_payload_json, '$.periodEnd')
            = '${sqlText(incident.periodEnd)}'
          AND json_extract(replay_payload_json, '$.requestedAt')
            = '${sqlText(requestedAtIso)}')
        AS exact_new_dlq_count;
  `);
}

export function assertChatwoot1dMaterialization(
  input = {},
  incident = CHATWOOT_1D_EXACT_INCIDENT,
) {
  const d1 = input.d1 ?? {};
  const lark = input.lark ?? {};
  if (d1.report_id !== incident.reportId
    || Number(d1.materialization_count ?? 0) !== 1
    || d1.sync_status !== 'success'
    || Number(d1.successful_sync_count ?? 0) < 1
    || Number(d1.active_lock_count ?? 0) !== 0
    || Number(lark.snapshots ?? 0) !== 1
    || Number(lark.metrics ?? 0) !== incident.expectedMetricCount
    || Number(lark.topContent ?? 0) !== 0
    || Number(lark.topAds ?? 0) !== 0
    || Number(lark.duplicateMetricKeys ?? 0) !== 0) throw incidentFailure(
    'Chatwoot 1D continuation did not produce the exact D1/Lark materialization',
    'REPORT_RUNTIME_CHATWOOT_1D_CONTINUATION_MATERIALIZATION_MISMATCH',
    {
      reportIdMatched: d1.report_id === incident.reportId,
      materializationCount: Number(d1.materialization_count ?? 0),
      syncStatus: d1.sync_status ?? null,
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

export function buildChatwoot1dClosureStatements(
  binding,
  now = Date.now(),
  incident = CHATWOOT_1D_EXACT_INCIDENT,
) {
  const closedAt = positiveEpoch(now);
  const reference = sqlText(binding.closureReference);
  return Object.freeze([
    compactSql(`
      UPDATE dead_letter_jobs
      SET status = 'redriven',
          redrive_requested_at = COALESCE(redrive_requested_at, ${closedAt}),
          redrive_reference = COALESCE(redrive_reference, '${reference}'),
          redriven_at = COALESCE(redriven_at, ${closedAt}),
          updated_at = ${closedAt}
      WHERE dlq_id = '${sqlText(binding.dlqId)}'
        AND message_id = '${sqlText(binding.messageId)}'
        AND queue_name = '${sqlText(binding.queueName)}'
        AND job_type = '${sqlText(incident.jobType)}'
        AND error_code = '${sqlText(binding.errorCode)}'
        AND status IN ('open', 'redriven')
        AND (redrive_reference IS NULL OR redrive_reference = '${reference}');
    `),
    compactSql(`
      UPDATE dead_letter_operation_metadata
      SET recovery_status = 'completed',
          recovery_reference = COALESCE(recovery_reference, '${reference}'),
          recovery_completed_at = COALESCE(recovery_completed_at, ${closedAt}),
          audit_reference = COALESCE(audit_reference, '${reference}')
      WHERE dlq_id = '${sqlText(binding.dlqId)}'
        AND operation_id IS NULL
        AND original_work_key = '${sqlText(binding.originalWorkKey)}'
        AND original_requested_at = ${incident.requestedAt}
        AND main_queue_attempts = ${binding.mainQueueAttempts}
        AND dlq_delivery_attempts = ${binding.dlqDeliveryAttempts}
        AND recovery_status IN ('not_started', 'completed')
        AND (recovery_reference IS NULL OR recovery_reference = '${reference}')
        AND (audit_reference IS NULL OR audit_reference = '${reference}');
    `),
    compactSql(`
      UPDATE system_alerts
      SET status = 'resolved',
          updated_at = ${closedAt}
      WHERE alert_id = '${sqlText(binding.alertId)}'
        AND sync_run_id = '${sqlText(binding.syncRunId)}'
        AND platform = '${sqlText(incident.platformScope)}'
        AND severity = '${sqlText(incident.alert.severity)}'
        AND status IN ('open', 'resolved')
        AND alert_type = '${sqlText(incident.alert.alertType)}'
        AND error_code = '${sqlText(incident.alert.errorCode)}'
        AND created_at = ${incident.alert.createdAt};
    `),
  ]);
}

export function buildChatwoot1dClosureReadbackSql(
  binding,
  incident = CHATWOOT_1D_EXACT_INCIDENT,
) {
  return compactSql(`
    SELECT
      (SELECT status FROM dead_letter_jobs
        WHERE dlq_id = '${sqlText(binding.dlqId)}') AS dlq_status,
      (SELECT redrive_reference FROM dead_letter_jobs
        WHERE dlq_id = '${sqlText(binding.dlqId)}') AS redrive_reference,
      (SELECT recovery_status FROM dead_letter_operation_metadata
        WHERE dlq_id = '${sqlText(binding.dlqId)}') AS recovery_status,
      (SELECT recovery_reference FROM dead_letter_operation_metadata
        WHERE dlq_id = '${sqlText(binding.dlqId)}') AS recovery_reference,
      (SELECT audit_reference FROM dead_letter_operation_metadata
        WHERE dlq_id = '${sqlText(binding.dlqId)}') AS audit_reference,
      (SELECT status FROM system_alerts
        WHERE alert_id = '${sqlText(binding.alertId)}'
          AND sync_run_id = '${sqlText(binding.syncRunId)}') AS alert_status,
      (SELECT COUNT(*) FROM dead_letter_jobs
        WHERE job_type = '${sqlText(incident.jobType)}'
          AND status IN ('open', 'redrive_pending')) AS open_report_dlq_count,
      (SELECT COUNT(*) FROM system_alerts a
        WHERE a.platform = '${sqlText(incident.platformScope)}'
          AND a.severity = 'critical'
          AND a.status = 'open'
          AND EXISTS (
            SELECT 1 FROM sync_runs r
            WHERE r.sync_run_id = a.sync_run_id
              AND r.platform = '${sqlText(incident.platformScope)}'
              AND r.account_key = '${sqlText(incident.accountKey)}'
              AND r.sync_type = 'dashboard_performance_report'
          )) AS open_report_critical_alert_count;
  `);
}

export function assertChatwoot1dIncidentClosed(
  row = {},
  binding,
) {
  if (row.dlq_status !== 'redriven'
    || row.redrive_reference !== binding.closureReference
    || row.recovery_status !== 'completed'
    || row.recovery_reference !== binding.closureReference
    || row.audit_reference !== binding.closureReference
    || row.alert_status !== 'resolved'
    || Number(row.open_report_dlq_count ?? 0) !== 0
    || Number(row.open_report_critical_alert_count ?? 0) !== 0) throw incidentFailure(
    'Exact Chatwoot 1D DLQ/Alert closure readback is incomplete',
    'REPORT_RUNTIME_CHATWOOT_1D_CONTINUATION_CLOSURE_INCOMPLETE',
    {
      dlqStatus: row.dlq_status ?? null,
      redriveReference: row.redrive_reference ?? null,
      recoveryStatus: row.recovery_status ?? null,
      recoveryReference: row.recovery_reference ?? null,
      auditReference: row.audit_reference ?? null,
      alertStatus: row.alert_status ?? null,
      openReportDlqCount: Number(row.open_report_dlq_count ?? 0),
      openReportCriticalAlertCount:
        Number(row.open_report_critical_alert_count ?? 0),
    },
  );
  return true;
}

function positiveEpoch(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw incidentFailure(
    'Chatwoot continuation timestamp must be a positive epoch millisecond',
    'REPORT_RUNTIME_CHATWOOT_1D_CONTINUATION_VALUE_INVALID',
  );
  return number;
}

function hasText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function incidentFailure(message, code, details = {}) {
  return closeoutFailure(message, code, details);
}
