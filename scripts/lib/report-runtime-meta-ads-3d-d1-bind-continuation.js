import {
  closeoutFailure,
  compactSql,
  sha256,
  sqlText,
  stableJson,
} from './report-runtime-closeout-reviewed-process.js';

export const META_ADS_3D_D1_BIND_CONTINUATION_CONTRACT =
  'report_runtime_meta_ads_3d_d1_bind_continuation_v1';

const ORIGINAL_DLQ = Object.freeze({
  role: 'configuration_incident',
  dlqId: 'terminal:e408707c9c2d383e04a3e213a7be45a0',
  messageId: 'e408707c9c2d383e04a3e213a7be45a0',
  queueName: 'social-mkt-sync-jobs',
  errorCode: 'DASHBOARD_REPORT_CONFIGURATION_INVALID',
  errorMessage: 'Dashboard report requires a reviewed D1-primary job contract',
  retryCount: 4,
  originalWorkKey: 'tiktok:e408707c9c2d383e04a3e213a7be45a0',
  mainQueueAttempts: 4,
  dlqDeliveryAttempts: 0,
  replayPayloadRawSha256: 'cb25578b3e5f6034425ae10772adf1a85efc20634dcdc7470377bf143340102d',
  closureReference:
    'report-runtime-meta-ads-3d-d1-bind-continuation-v1:terminal:e408707c9c2d383e04a3e213a7be45a0',
});

const RETRY_EXHAUSTED_DLQ = Object.freeze({
  role: 'd1_bind_retry_exhausted',
  dlqId: 'dlq:2f292f08f5bdc4f12c91b68ceff71e1b',
  messageId: '2f292f08f5bdc4f12c91b68ceff71e1b',
  queueName: 'social-mkt-sync-dlq',
  errorCode: 'QUEUE_RETRY_EXHAUSTED',
  errorMessage: 'Cloudflare Queue moved this message to the dead-letter queue after retry exhaustion',
  retryCount: 0,
  originalWorkKey: 'tiktok:2f292f08f5bdc4f12c91b68ceff71e1b',
  mainQueueAttempts: 0,
  dlqDeliveryAttempts: 1,
  replayPayloadBytes: 354,
  createdAt: 1785939099176,
  closureReference:
    'report-runtime-meta-ads-3d-d1-bind-continuation-v1:dlq:2f292f08f5bdc4f12c91b68ceff71e1b',
});

export const META_ADS_3D_D1_BIND_CONTINUATION = Object.freeze({
  key: 'meta_ads_3d_d1_bind_20260731',
  label: 'Meta Ads 3D D1-bind continuation',
  decision: 'META_ADS_REPORT_3D_D1_BIND_CONTINUATION_COMPLETED',
  confirmation: 'CONTINUE_EXACT_META_ADS_3D_D1_BIND_RECOVERY',
  evidenceDirectory: 'outputs/meta-ads-3d-d1-bind-continuation',
  requiredRepositoryHead: '2f87f7f342847a5dcd0cf794cd0a74e55ab76068',
  finalizerDefault:
    'outputs/report-runtime-finalize/report-runtime-finalize-summary.json',
  retainedAttemptPath:
    'outputs/meta-ads-3d-exact-recovery-5b35861553d2/recovery/meta_ads-3d-config-dlq-send-first-retry.attempt.json',
  inspectorEntityPath:
    'outputs/meta-ads-3d-root-cause-inspector-2f87f7f34284/entity-bind-count.json',
  inspectorDlqPath:
    'outputs/meta-ads-3d-root-cause-inspector-2f87f7f34284/new-dlq-metadata.json',
  platformScope: 'meta_ads',
  capability: 'paid_ads',
  accountKey: 'chemistry_k',
  formulaVersion: 'meta-ads-v1',
  windowDays: 3,
  periodStart: '2026-07-29',
  periodEnd: '2026-07-31',
  sourceWatermark: '2026-07-31',
  requestedAt: 1785934718928,
  failedRecoveryRequestedAt: 1785938483493,
  reportSettingKey: 'integration_workspace:meta_ads:rolling:3d',
  reportId:
    'integration_workspace:meta_ads:rolling:3d:chemistry_k:rolling_days:2026-07-29:2026-07-31:meta-ads-v1',
  jobType: 'report.materialization.generate',
  jobSha256: 'cb25578b3e5f6034425ae10772adf1a85efc20634dcdc7470377bf143340102d',
  coverageDatasetKey: 'meta_ads.performance.daily',
  sourceScope: 'account_summary',
  sourceFactField: 'ads_summary_fact_count',
  successfulSyncCountBeforeContinuation: 2,
  failedSyncCountBeforeContinuation: 6,
  openReportDlqCountBeforeContinuation: 2,
  rootCause: Object.freeze({
    rankingRows3d: 630,
    rankingRows1d: 210,
    uniqueAds3d: 102,
    uniqueAds1d: 77,
    preFixBindings3d: 105,
    preFixBindings1d: 80,
    classification: 'ENTITY_BIND_LIMIT_CONFIRMED',
  }),
  dlqs: Object.freeze([ORIGINAL_DLQ, RETRY_EXHAUSTED_DLQ]),
});

export function assertMetaAds3dRetainedAttempt(
  value = {},
  incident = META_ADS_3D_D1_BIND_CONTINUATION,
) {
  if (value.incidentKey !== 'meta_ads_3d_20260731'
    || value.reportId !== incident.reportId
    || value.jobSha256 !== incident.jobSha256
    || Number(value.retryRequestedAt) !== incident.failedRecoveryRequestedAt
    || value.originalDlqId !== incident.dlqs[0].dlqId) throw continuationFailure(
    'Retained Meta Ads 3D failed-recovery attempt differs from the exact continuation incident',
    'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_ATTEMPT_MISMATCH',
    {
      incidentKey: value.incidentKey ?? null,
      reportIdMatched: value.reportId === incident.reportId,
      jobSha256Matched: value.jobSha256 === incident.jobSha256,
      retryRequestedAt: Number(value.retryRequestedAt ?? 0),
      originalDlqMatched: value.originalDlqId === incident.dlqs[0].dlqId,
    },
  );
  return true;
}

export function assertMetaAds3dContinuationCandidate(
  candidate = {},
  incident = META_ADS_3D_D1_BIND_CONTINUATION,
) {
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
    || sha256(stableJson(job)) !== incident.jobSha256) throw continuationFailure(
    'Regenerated Meta Ads 3D job differs from the retained exact job',
    'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_CANDIDATE_MISMATCH',
    {
      reportIdMatched: candidate.reportId === incident.reportId,
      reportSettingKeyMatched: candidate.reportSettingKey === incident.reportSettingKey,
      windowDays: Number(candidate.windowDays ?? 0),
      jobSha256Matched: sha256(stableJson(job)) === incident.jobSha256,
    },
  );
  return true;
}

export function assertMetaAds3dRootCauseEvidence(
  input = {},
  incident = META_ADS_3D_D1_BIND_CONTINUATION,
) {
  const entity = input.entity ?? {};
  const dlq = input.dlq ?? {};
  const expected = incident.rootCause;
  const retryDlq = incident.dlqs[1];
  if (Number(entity.ranking_rows_3d) !== expected.rankingRows3d
    || Number(entity.ranking_rows_1d) !== expected.rankingRows1d
    || Number(entity.unique_ads_3d) !== expected.uniqueAds3d
    || Number(entity.unique_ads_1d) !== expected.uniqueAds1d
    || Number(entity.pre_fix_entity_binding_count_3d) !== expected.preFixBindings3d
    || Number(entity.pre_fix_entity_binding_count_1d) !== expected.preFixBindings1d
    || entity.classification !== expected.classification
    || dlq.dlq_id !== retryDlq.dlqId
    || dlq.message_id !== retryDlq.messageId
    || dlq.queue_name !== retryDlq.queueName
    || dlq.job_type !== incident.jobType
    || Number(dlq.schema_version) !== 1
    || dlq.error_code !== retryDlq.errorCode
    || dlq.error_message !== retryDlq.errorMessage
    || Number(dlq.retry_count) !== retryDlq.retryCount
    || dlq.status !== 'open'
    || Number(dlq.replay_payload_bytes) !== retryDlq.replayPayloadBytes
    || dlq.replay_platform_scope !== incident.platformScope
    || Number(dlq.replay_window_days) !== incident.windowDays
    || dlq.replay_report_setting_key !== incident.reportSettingKey
    || dlq.replay_period_end !== incident.periodEnd
    || dlq.replay_source_watermark !== incident.sourceWatermark
    || Date.parse(dlq.replay_requested_at) !== incident.requestedAt
    || dlq.operation_id !== null
    || dlq.original_work_key !== retryDlq.originalWorkKey
    || Number(dlq.generation) !== incident.requestedAt
    || Number(dlq.original_requested_at) !== incident.requestedAt
    || Number(dlq.main_queue_attempts) !== retryDlq.mainQueueAttempts
    || Number(dlq.dlq_delivery_attempts) !== retryDlq.dlqDeliveryAttempts
    || dlq.recovery_status !== 'not_started') throw continuationFailure(
    'Retained Meta Ads 3D root-cause inspector differs from the exact confirmed incident',
    'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_INSPECTOR_MISMATCH',
    {
      classification: entity.classification ?? null,
      uniqueAds3d: Number(entity.unique_ads_3d ?? 0),
      preFixBindings3d: Number(entity.pre_fix_entity_binding_count_3d ?? 0),
      dlqIdMatched: dlq.dlq_id === retryDlq.dlqId,
      replayRequestedAt: Date.parse(dlq.replay_requested_at),
    },
  );
  return true;
}

export function assertMetaAds3dContinuationPreflight(
  row = {},
  incident = META_ADS_3D_D1_BIND_CONTINUATION,
) {
  if (row.coverage_status !== 'complete'
    || row.coverage_dataset_key !== incident.coverageDatasetKey
    || row.source_scope !== incident.sourceScope
    || row.source_watermark !== incident.sourceWatermark
    || row.period_end !== incident.periodEnd
    || Number(row[incident.sourceFactField] ?? 0) <= 0
    || Number(row.active_report_work_count ?? 0) !== 0
    || Number(row.active_report_locks ?? 0) !== 0
    || Number(row.open_report_dlq ?? 0) !== incident.openReportDlqCountBeforeContinuation
    || Number(row.open_report_critical_alerts ?? 0) !== 0) throw continuationFailure(
    'Current Meta Ads 3D preflight differs from the exact continuation boundary',
    'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_PREFLIGHT_MISMATCH',
    {
      coverageStatus: row.coverage_status ?? null,
      coverageDatasetKey: row.coverage_dataset_key ?? null,
      sourceScope: row.source_scope ?? null,
      sourceWatermarkMatched: row.source_watermark === incident.sourceWatermark,
      sourceFactCount: Number(row[incident.sourceFactField] ?? 0),
      activeReportWorkCount: Number(row.active_report_work_count ?? 0),
      activeReportLocks: Number(row.active_report_locks ?? 0),
      openReportDlq: Number(row.open_report_dlq ?? 0),
      openReportCriticalAlerts: Number(row.open_report_critical_alerts ?? 0),
    },
  );
  return true;
}

export function buildMetaAds3dDlqSql(binding) {
  return compactSql(`
    SELECT
      d.dlq_id, d.message_id, d.queue_name, d.job_type, d.schema_version,
      d.replay_payload_json, d.error_code, d.error_message,
      d.retry_count, d.status, d.created_at, d.updated_at,
      d.redrive_requested_at, d.redrive_reference, d.redriven_at,
      m.dlq_id AS metadata_dlq_id, m.operation_id, m.original_work_key,
      m.generation, m.original_requested_at, m.main_queue_attempts,
      m.dlq_delivery_attempts, m.recovery_status, m.recovery_reference,
      m.recovery_completed_at, m.audit_reference
    FROM dead_letter_jobs d
    LEFT JOIN dead_letter_operation_metadata m ON m.dlq_id = d.dlq_id
    WHERE d.dlq_id = '${sqlText(binding.dlqId)}';
  `);
}

export function assertMetaAds3dDlqRow(
  row = {},
  binding,
  incident = META_ADS_3D_D1_BIND_CONTINUATION,
) {
  let replayPayload = null;
  try { replayPayload = JSON.parse(String(row.replay_payload_json ?? '')); } catch { /* invalid below */ }
  const stablePayloadSha = sha256(stableJson(replayPayload ?? {}));
  const rawPayloadSha = sha256(String(row.replay_payload_json ?? ''));
  if (row.dlq_id !== binding.dlqId
    || row.message_id !== binding.messageId
    || row.queue_name !== binding.queueName
    || row.job_type !== incident.jobType
    || Number(row.schema_version) !== 1
    || row.error_code !== binding.errorCode
    || row.error_message !== binding.errorMessage
    || Number(row.retry_count) !== binding.retryCount
    || row.status !== 'open'
    || stablePayloadSha !== incident.jobSha256
    || (binding.replayPayloadRawSha256 && rawPayloadSha !== binding.replayPayloadRawSha256)
    || replayPayload?.type !== incident.jobType
    || replayPayload?.platformScope !== incident.platformScope
    || replayPayload?.trigger !== 'dashboard_preset'
    || replayPayload?.periodKind !== 'rolling_days'
    || Number(replayPayload?.windowDays) !== incident.windowDays
    || replayPayload?.reportSettingKey !== incident.reportSettingKey
    || replayPayload?.periodEnd !== incident.periodEnd
    || replayPayload?.sourceWatermark !== incident.sourceWatermark
    || Date.parse(replayPayload?.requestedAt) !== incident.requestedAt
    || row.metadata_dlq_id !== binding.dlqId
    || row.operation_id !== null
    || String(row.original_work_key ?? '') !== binding.originalWorkKey
    || Number(row.generation) !== incident.requestedAt
    || Number(row.original_requested_at) !== incident.requestedAt
    || Number(row.main_queue_attempts) !== binding.mainQueueAttempts
    || Number(row.dlq_delivery_attempts) !== binding.dlqDeliveryAttempts
    || String(row.recovery_status ?? '') !== 'not_started'
    || (binding.createdAt && Number(row.created_at) !== binding.createdAt)) throw continuationFailure(
    `Remote ${binding.role} DLQ differs from the exact Meta Ads 3D continuation incident`,
    'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_DLQ_MISMATCH',
    {
      role: binding.role,
      dlqIdMatched: row.dlq_id === binding.dlqId,
      messageIdMatched: row.message_id === binding.messageId,
      status: row.status ?? null,
      errorCode: row.error_code ?? null,
      stablePayloadShaMatched: stablePayloadSha === incident.jobSha256,
      originalWorkKeyMatched: String(row.original_work_key ?? '') === binding.originalWorkKey,
      generation: Number(row.generation ?? 0),
      mainQueueAttempts: Number(row.main_queue_attempts ?? 0),
      dlqDeliveryAttempts: Number(row.dlq_delivery_attempts ?? 0),
    },
  );
  return Object.freeze({
    binding,
    replayPayload: Object.freeze(replayPayload),
    stablePayloadSha256: stablePayloadSha,
    rawPayloadSha256: rawPayloadSha,
  });
}

export function buildMetaAds3dFailedRecoveryStateSql(
  incident = META_ADS_3D_D1_BIND_CONTINUATION,
) {
  return compactSql(`
    SELECT
      (SELECT COUNT(*) FROM sync_runs
        WHERE platform = '${sqlText(incident.platformScope)}'
          AND account_key = '${sqlText(incident.accountKey)}'
          AND sync_type = 'dashboard_performance_report'
          AND started_at >= ${incident.failedRecoveryRequestedAt}
          AND status = 'failed') AS failed_sync_count,
      (SELECT COUNT(*) FROM sync_runs
        WHERE platform = '${sqlText(incident.platformScope)}'
          AND account_key = '${sqlText(incident.accountKey)}'
          AND sync_type = 'dashboard_performance_report'
          AND started_at >= ${incident.failedRecoveryRequestedAt}
          AND status IN ('pending', 'running')) AS active_sync_count,
      (SELECT COUNT(*) FROM dead_letter_jobs
        WHERE dlq_id = '${sqlText(incident.dlqs[1].dlqId)}'
          AND status = 'open') AS retry_exhausted_dlq_count;
  `);
}

export function assertMetaAds3dInitialState(
  input = {},
  incident = META_ADS_3D_D1_BIND_CONTINUATION,
) {
  const d1 = input.d1 ?? {};
  const lark = input.lark ?? {};
  const failed = input.failed ?? {};
  if (d1.report_id !== null
    || Number(d1.materialization_count ?? 0) !== 0
    || Number(d1.successful_sync_count ?? 0) !== incident.successfulSyncCountBeforeContinuation
    || Number(d1.active_lock_count ?? 0) !== 0
    || Number(failed.failed_sync_count ?? 0) !== incident.failedSyncCountBeforeContinuation
    || Number(failed.active_sync_count ?? 0) !== 0
    || Number(failed.retry_exhausted_dlq_count ?? 0) !== 1
    || Number(lark.snapshots ?? 0) !== 0
    || Number(lark.metrics ?? 0) !== 0
    || Number(lark.topContent ?? 0) !== 0
    || Number(lark.topAds ?? 0) !== 0
    || Number(lark.duplicateMetricKeys ?? 0) !== 0) throw continuationFailure(
    'Meta Ads 3D target is no longer the exact failed-recovery continuation state',
    'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_INITIAL_STATE_MISMATCH',
    {
      reportId: d1.report_id ?? null,
      materializationCount: Number(d1.materialization_count ?? 0),
      successfulSyncCount: Number(d1.successful_sync_count ?? 0),
      failedSyncCount: Number(failed.failed_sync_count ?? 0),
      activeSyncCount: Number(failed.active_sync_count ?? 0),
      activeLockCount: Number(d1.active_lock_count ?? 0),
      retryExhaustedDlqCount: Number(failed.retry_exhausted_dlq_count ?? 0),
      larkSnapshots: Number(lark.snapshots ?? 0),
      larkMetrics: Number(lark.metrics ?? 0),
      larkTopAds: Number(lark.topAds ?? 0),
    },
  );
  return true;
}

export function buildMetaAds3dContinuationPollSql(
  continuationRequestedAt,
  incident = META_ADS_3D_D1_BIND_CONTINUATION,
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
          AND json_extract(replay_payload_json, '$.platformScope') = '${sqlText(incident.platformScope)}'
          AND json_extract(replay_payload_json, '$.reportSettingKey') = '${sqlText(incident.reportSettingKey)}'
          AND json_extract(replay_payload_json, '$.periodEnd') = '${sqlText(incident.periodEnd)}'
          AND json_extract(replay_payload_json, '$.requestedAt') = '${sqlText(requestedAtIso)}')
        AS exact_new_dlq_count;
  `);
}

export function buildMetaAds3dClosureStatements(binding, now = Date.now()) {
  const repairedAt = positiveEpoch(now);
  const reference = sqlText(binding.closureReference);
  return Object.freeze([
    compactSql(`
      UPDATE dead_letter_jobs
      SET status = 'redriven',
          redrive_requested_at = COALESCE(redrive_requested_at, ${repairedAt}),
          redrive_reference = COALESCE(redrive_reference, '${reference}'),
          redriven_at = COALESCE(redriven_at, ${repairedAt}),
          updated_at = ${repairedAt}
      WHERE dlq_id = '${sqlText(binding.dlqId)}'
        AND message_id = '${sqlText(binding.messageId)}'
        AND queue_name = '${sqlText(binding.queueName)}'
        AND job_type = '${sqlText(META_ADS_3D_D1_BIND_CONTINUATION.jobType)}'
        AND error_code = '${sqlText(binding.errorCode)}'
        AND retry_count = ${binding.retryCount}
        AND status IN ('open', 'redriven')
        AND (redrive_reference IS NULL OR redrive_reference = '${reference}');
    `),
    compactSql(`
      UPDATE dead_letter_operation_metadata
      SET recovery_status = 'completed',
          recovery_reference = COALESCE(recovery_reference, '${reference}'),
          recovery_completed_at = COALESCE(recovery_completed_at, ${repairedAt}),
          audit_reference = COALESCE(audit_reference, '${reference}')
      WHERE dlq_id = '${sqlText(binding.dlqId)}'
        AND operation_id IS NULL
        AND original_work_key = '${sqlText(binding.originalWorkKey)}'
        AND original_requested_at = ${META_ADS_3D_D1_BIND_CONTINUATION.requestedAt}
        AND main_queue_attempts = ${binding.mainQueueAttempts}
        AND dlq_delivery_attempts = ${binding.dlqDeliveryAttempts}
        AND recovery_status IN ('not_started', 'completed')
        AND (recovery_reference IS NULL OR recovery_reference = '${reference}')
        AND (audit_reference IS NULL OR audit_reference = '${reference}');
    `),
  ]);
}

export function assertMetaAds3dDlqClosed(row = {}, binding) {
  if (row.dlq_id !== binding.dlqId
    || row.status !== 'redriven'
    || row.redrive_reference !== binding.closureReference
    || row.recovery_status !== 'completed'
    || row.recovery_reference !== binding.closureReference
    || row.audit_reference !== binding.closureReference) throw continuationFailure(
    `Exact ${binding.role} DLQ closure readback is incomplete`,
    'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_CLOSURE_INCOMPLETE',
    {
      role: binding.role,
      status: row.status ?? null,
      redriveReference: row.redrive_reference ?? null,
      recoveryStatus: row.recovery_status ?? null,
      recoveryReference: row.recovery_reference ?? null,
      auditReference: row.audit_reference ?? null,
    },
  );
  return true;
}

function positiveEpoch(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw continuationFailure(
    'Continuation timestamp must be a positive epoch millisecond',
    'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_VALUE_INVALID',
  );
  return number;
}

function continuationFailure(message, code, details = {}) {
  return closeoutFailure(message, code, details);
}
