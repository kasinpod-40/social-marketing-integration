import {
  closeoutFailure,
  compactSql,
  sha256,
  sqlText,
  stableJson,
} from './report-runtime-closeout-reviewed-process.js';

export const WOOCOMMERCE_REPORT_LARK_INCOMPLETE_RECOVERY_CONTRACT =
  'woocommerce_report_lark_incomplete_recovery_v1';

export const WOOCOMMERCE_REPORT_LARK_INCOMPLETE_RECOVERY_CONFIRMATION =
  'RECOVER_EXACT_WOOCOMMERCE_1D_LARK_INCOMPLETE_REPORT';

export const WOOCOMMERCE_REPORT_LARK_INCOMPLETE_INCIDENT = Object.freeze({
  originalRepositoryHead: '31b492a87135f90bd84bf9ab9a460f4f0c66cbb1',
  originalOutputRoot:
    'outputs/final-three-channel-report-closeout-authority-resume-31b492a87135/closeout/woocommerce',
  originalAttemptFile: 'woocommerce-1d-send-first.attempt.json',
  originalReplayFile: 'woocommerce-1d-send-replay.attempt.json',
  originalSummaryFile: 'report-runtime-closeout-summary.json',
  reportId:
    'integration_workspace:woocommerce:rolling:1d:chemistry_k:rolling_days:2026-07-31:2026-07-31:woocommerce-commerce-v1',
  reportSettingKey: 'integration_workspace:woocommerce:rolling:1d',
  platformScope: 'woocommerce',
  capability: 'commerce',
  accountKey: 'chemistry_k',
  windowDays: 1,
  periodEnd: '2026-07-31',
  requestedAt: 1785961183475,
  action: 'create_materialization',
  jobType: 'report.materialization.generate',
  jobSha256: '6c9a767d2de0e39adef234dfed0ffddabb12bbc6c37eea49699b2381dc2ee1ba',
  errorCode: 'LARK_PREFLIGHT_FAILED',
  failedField: 'dimension_type',
  rejectedValue: 'product',
  expectedDataStatus: 'revisable',
  expectedSnapshotCount: 1,
  expectedMetricCount: 58,
  expectedDimensionTypes: Object.freeze([
    'summary',
    'product',
    'payment_method',
    'shipping_method',
    'inbox',
    'agent',
  ]),
});

export function assertWooCommerceReportRetainedAttempt(
  value = {},
  incident = WOOCOMMERCE_REPORT_LARK_INCOMPLETE_INCIDENT,
) {
  if (value.reportId !== incident.reportId
    || value.action !== incident.action
    || Number(value.requestedAt) !== incident.requestedAt
    || value.jobSha256 !== incident.jobSha256) {
    throw recoveryFailure(
      'Retained WooCommerce first-send attempt differs from the exact Lark-incomplete incident',
      'WOOCOMMERCE_REPORT_LARK_RECOVERY_ATTEMPT_MISMATCH',
      {
        reportIdMatched: value.reportId === incident.reportId,
        action: value.action ?? null,
        requestedAt: Number(value.requestedAt ?? 0),
        jobSha256Matched: value.jobSha256 === incident.jobSha256,
      },
    );
  }
  return true;
}

export function assertWooCommerceReportFinalizerEvidence(value = {}) {
  if (value.ok !== true
    || value.contractVersion !== 'report_runtime_finalize_v1'
    || value.repository?.branch !== 'main'
    || value.repository?.clean !== true
    || Number(value.schema?.readbackActions ?? -1) !== 0
    || Number(value.schema?.conflicts ?? -1) !== 0
    || value.runtime?.notificationAdmissionEnabled !== false
    || value.runtime?.schedulesEnabled !== false
    || value.runtime?.workerDeployed !== false
    || value.runtime?.queueMessageSent !== false
    || value.runtime?.remoteD1Mutated !== false) {
    throw recoveryFailure(
      'WooCommerce Lark recovery requires safe exact-main Finalizer zero-drift evidence',
      'WOOCOMMERCE_REPORT_LARK_RECOVERY_FINALIZER_INVALID',
    );
  }
  return true;
}

export function assertWooCommerceReportDimensionOptions(
  fields = [],
  incident = WOOCOMMERCE_REPORT_LARK_INCOMPLETE_INCIDENT,
) {
  const field = fields.find((item) => (
    item?.field_name ?? item?.fieldName ?? item?.name
  ) === incident.failedField);
  const options = (field?.property?.options ?? [])
    .map((option) => String(option?.name ?? option?.value ?? '').trim())
    .filter(Boolean);
  if (Number(field?.type ?? 0) !== 3
    || stableJson(options) !== stableJson(incident.expectedDimensionTypes)) {
    throw recoveryFailure(
      'MKT_Report_Metric_Values.dimension_type options are not the reviewed Shared Report contract',
      'WOOCOMMERCE_REPORT_LARK_RECOVERY_DIMENSION_OPTIONS_INVALID',
      {
        fieldPresent: Boolean(field),
        fieldType: Number(field?.type ?? 0),
        options,
      },
    );
  }
  return Object.freeze({ fieldType: 3, options: Object.freeze(options) });
}

export function buildWooCommerceReportFailedSyncSql(
  incident = WOOCOMMERCE_REPORT_LARK_INCOMPLETE_INCIDENT,
) {
  return compactSql(`
    SELECT
      sync_run_id, status, started_at, finished_at, updated_at,
      records_written, records_skipped, error_code, error_message
    FROM sync_runs
    WHERE platform = '${sqlText(incident.platformScope)}'
      AND account_key = '${sqlText(incident.accountKey)}'
      AND sync_type = 'dashboard_performance_report'
      AND started_at >= ${incident.requestedAt}
    ORDER BY started_at ASC, sync_run_id ASC;
  `);
}

export function assertWooCommerceReportFailedSync(
  rows = [],
  incident = WOOCOMMERCE_REPORT_LARK_INCOMPLETE_INCIDENT,
) {
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw recoveryFailure(
      'WooCommerce Lark recovery requires exactly one retained failed Sync Run',
      'WOOCOMMERCE_REPORT_LARK_RECOVERY_SYNC_SHAPE_INVALID',
      { syncRunCount: Array.isArray(rows) ? rows.length : -1 },
    );
  }
  const row = rows[0];
  if (row.status !== 'failed'
    || row.error_code !== incident.errorCode
    || Number(row.started_at) < incident.requestedAt
    || Number(row.records_written ?? 0) !== 0
    || !isExpectedLarkOptionFailure(row.error_message, incident)) {
    throw recoveryFailure(
      'Retained WooCommerce failed Sync Run is not the exact dimension_type option incident',
      'WOOCOMMERCE_REPORT_LARK_RECOVERY_SYNC_MISMATCH',
      {
        status: row.status ?? null,
        errorCode: row.error_code ?? null,
        recordsWritten: Number(row.records_written ?? 0),
        expectedDiagnosticMatched: isExpectedLarkOptionFailure(row.error_message, incident),
      },
    );
  }
  return Object.freeze({
    syncRunIdFingerprint: sha256(String(row.sync_run_id ?? '')),
    startedAt: Number(row.started_at),
    finishedAt: Number(row.finished_at ?? 0),
    errorCode: row.error_code,
  });
}

export function buildWooCommerceReportOpenDlqSql(
  incident = WOOCOMMERCE_REPORT_LARK_INCOMPLETE_INCIDENT,
) {
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
    WHERE d.job_type = '${sqlText(incident.jobType)}'
      AND d.status = 'open'
      AND d.error_code = '${sqlText(incident.errorCode)}'
      AND d.created_at >= ${incident.requestedAt}
    ORDER BY d.created_at ASC, d.dlq_id ASC;
  `);
}

export function assertWooCommerceReportOpenDlq(
  rows = [],
  incident = WOOCOMMERCE_REPORT_LARK_INCOMPLETE_INCIDENT,
) {
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw recoveryFailure(
      'WooCommerce Lark recovery requires exactly one exact open Report DLQ',
      'WOOCOMMERCE_REPORT_LARK_RECOVERY_DLQ_SHAPE_INVALID',
      { openDlqCount: Array.isArray(rows) ? rows.length : -1 },
    );
  }
  const row = rows[0];
  let payload = null;
  try {
    payload = JSON.parse(String(row.replay_payload_json ?? ''));
  } catch {
    // Invalid below.
  }
  const payloadHash = sha256(String(row.replay_payload_json ?? ''));
  if (!row.dlq_id
    || !row.message_id
    || row.job_type !== incident.jobType
    || row.status !== 'open'
    || row.error_code !== incident.errorCode
    || !isExpectedLarkOptionFailure(row.error_message, incident)
    || payloadHash !== incident.jobSha256
    || payload?.type !== incident.jobType
    || payload?.platformScope !== incident.platformScope
    || payload?.trigger !== 'dashboard_preset'
    || payload?.periodKind !== 'rolling_days'
    || Number(payload?.windowDays) !== incident.windowDays
    || payload?.periodEnd !== incident.periodEnd
    || payload?.reportSettingKey !== incident.reportSettingKey
    || Date.parse(payload?.requestedAt) !== incident.requestedAt
    || row.metadata_dlq_id !== row.dlq_id
    || Number(row.original_requested_at) !== incident.requestedAt
    || !String(row.original_work_key ?? '').trim()
    || Number(row.main_queue_attempts ?? 0) < 1
    || Number(row.dlq_delivery_attempts ?? 0) !== 0
    || !['not_started', 'completed'].includes(String(row.recovery_status ?? ''))) {
    throw recoveryFailure(
      'Open Report DLQ differs from the exact WooCommerce Lark-incomplete incident',
      'WOOCOMMERCE_REPORT_LARK_RECOVERY_DLQ_MISMATCH',
      {
        dlqIdPresent: Boolean(row.dlq_id),
        messageIdPresent: Boolean(row.message_id),
        status: row.status ?? null,
        errorCode: row.error_code ?? null,
        expectedDiagnosticMatched: isExpectedLarkOptionFailure(row.error_message, incident),
        payloadSha256Matched: payloadHash === incident.jobSha256,
        metadataPresent: row.metadata_dlq_id === row.dlq_id,
        originalRequestedAt: Number(row.original_requested_at ?? 0),
      },
    );
  }
  const closureReference = [
    WOOCOMMERCE_REPORT_LARK_INCOMPLETE_RECOVERY_CONTRACT,
    sha256(String(row.dlq_id)).slice(0, 32),
  ].join(':');
  return Object.freeze({
    ...row,
    replayPayload: Object.freeze(payload),
    dlqIdFingerprint: sha256(String(row.dlq_id)),
    messageIdFingerprint: sha256(String(row.message_id)),
    closureReference,
  });
}

export function assertWooCommerceReportD1Prestate(
  d1 = {},
  incident = WOOCOMMERCE_REPORT_LARK_INCOMPLETE_INCIDENT,
) {
  if (d1.report_id !== incident.reportId
    || Number(d1.materialization_count ?? 0) !== 1
    || d1.data_status !== incident.expectedDataStatus
    || typeof d1.payload_checksum !== 'string'
    || d1.payload_checksum.trim() === ''
    || d1.sync_status !== 'failed'
    || Number(d1.successful_sync_count ?? 0) !== 0
    || Number(d1.active_lock_count ?? 0) !== 0
    || Number(d1.new_dlq_count ?? 0) !== 1) {
    throw recoveryFailure(
      'Current WooCommerce D1 state differs from the retained Lark-incomplete incident',
      'WOOCOMMERCE_REPORT_LARK_RECOVERY_D1_PRESTATE_INVALID',
      {
        reportIdMatched: d1.report_id === incident.reportId,
        materializationCount: Number(d1.materialization_count ?? 0),
        dataStatus: d1.data_status ?? null,
        syncStatus: d1.sync_status ?? null,
        successfulSyncCount: Number(d1.successful_sync_count ?? 0),
        activeLockCount: Number(d1.active_lock_count ?? 0),
        newDlqCount: Number(d1.new_dlq_count ?? 0),
      },
    );
  }
  return true;
}

export function classifyWooCommerceReportLarkState(
  lark = {},
  incident = WOOCOMMERCE_REPORT_LARK_INCOMPLETE_INCIDENT,
) {
  const state = {
    snapshots: Number(lark.snapshots ?? 0),
    metrics: Number(lark.metrics ?? 0),
    topContent: Number(lark.topContent ?? 0),
    topAds: Number(lark.topAds ?? 0),
    duplicateMetricKeys: Number(lark.duplicateMetricKeys ?? 0),
  };
  if (state.snapshots === 0
    && state.metrics === 0
    && state.topContent === 0
    && state.topAds === 0
    && state.duplicateMetricKeys === 0) return 'empty';
  if (state.snapshots === incident.expectedSnapshotCount
    && state.metrics === incident.expectedMetricCount
    && state.topContent === 0
    && state.topAds === 0
    && state.duplicateMetricKeys === 0) return 'complete';
  throw recoveryFailure(
    'WooCommerce Lark target is partially written or structurally invalid',
    'WOOCOMMERCE_REPORT_LARK_RECOVERY_PARTIAL_LARK_BLOCKED',
    state,
  );
}

export function assertWooCommerceReportWindowParity(
  records = [],
  incident = WOOCOMMERCE_REPORT_LARK_INCOMPLETE_INCIDENT,
) {
  if (!Array.isArray(records) || records.length !== incident.expectedMetricCount) {
    throw recoveryFailure(
      'WooCommerce Lark Metric row count is not the reviewed 58-row contract',
      'WOOCOMMERCE_REPORT_LARK_RECOVERY_METRIC_COUNT_INVALID',
      { metricCount: Array.isArray(records) ? records.length : -1 },
    );
  }
  let mismatchCount = 0;
  for (const record of records) {
    const fields = record?.fields ?? {};
    const numberWindow = normalizeNumber(fields.window_days);
    const selectWindow = normalizeText(
      fields.__mkt_legacy_window_days_single_select_v1,
    );
    if (numberWindow !== incident.windowDays
      || selectWindow !== String(incident.windowDays)) mismatchCount += 1;
  }
  if (mismatchCount !== 0) {
    throw recoveryFailure(
      'WooCommerce Lark Metric Number/ Dashboard Select window parity is incomplete',
      'WOOCOMMERCE_REPORT_LARK_RECOVERY_WINDOW_PARITY_INVALID',
      { metricCount: records.length, mismatchCount },
    );
  }
  return Object.freeze({ metricCount: records.length, mismatchCount: 0 });
}

export function buildWooCommerceReportDlqClosureStatements(
  dlq,
  now = Date.now(),
) {
  const repairedAt = Number(now);
  if (!Number.isSafeInteger(repairedAt) || repairedAt <= 0) {
    throw recoveryFailure(
      'WooCommerce Report DLQ closure timestamp must be positive epoch milliseconds',
      'WOOCOMMERCE_REPORT_LARK_RECOVERY_VALUE_INVALID',
    );
  }
  const reference = sqlText(requireText(dlq.closureReference, 'closureReference'));
  const operationPredicate = dlq.operation_id === null || dlq.operation_id === undefined
    ? 'operation_id IS NULL'
    : `operation_id = '${sqlText(dlq.operation_id)}'`;
  return Object.freeze([
    compactSql(`
      UPDATE dead_letter_jobs
      SET status = 'redriven',
          redrive_requested_at = COALESCE(redrive_requested_at, ${repairedAt}),
          redrive_reference = COALESCE(redrive_reference, '${reference}'),
          redriven_at = COALESCE(redriven_at, ${repairedAt}),
          updated_at = ${repairedAt}
      WHERE dlq_id = '${sqlText(dlq.dlq_id)}'
        AND message_id = '${sqlText(dlq.message_id)}'
        AND job_type = '${sqlText(dlq.job_type)}'
        AND error_code = '${sqlText(dlq.error_code)}'
        AND retry_count = ${Number(dlq.retry_count)}
        AND status IN ('open', 'redriven')
        AND (redrive_reference IS NULL OR redrive_reference = '${reference}');
    `),
    compactSql(`
      UPDATE dead_letter_operation_metadata
      SET recovery_status = 'completed',
          recovery_reference = COALESCE(recovery_reference, '${reference}'),
          recovery_completed_at = COALESCE(recovery_completed_at, ${repairedAt}),
          audit_reference = COALESCE(audit_reference, '${reference}')
      WHERE dlq_id = '${sqlText(dlq.dlq_id)}'
        AND ${operationPredicate}
        AND original_work_key = '${sqlText(dlq.original_work_key)}'
        AND original_requested_at = ${Number(dlq.original_requested_at)}
        AND main_queue_attempts = ${Number(dlq.main_queue_attempts)}
        AND dlq_delivery_attempts = ${Number(dlq.dlq_delivery_attempts)}
        AND recovery_status IN ('not_started', 'completed')
        AND (recovery_reference IS NULL OR recovery_reference = '${reference}')
        AND (audit_reference IS NULL OR audit_reference = '${reference}');
    `),
  ]);
}

export function buildWooCommerceReportDlqReadbackSql(dlq) {
  return compactSql(`
    SELECT
      d.dlq_id, d.status, d.redrive_reference,
      m.recovery_status, m.recovery_reference, m.audit_reference
    FROM dead_letter_jobs d
    LEFT JOIN dead_letter_operation_metadata m ON m.dlq_id = d.dlq_id
    WHERE d.dlq_id = '${sqlText(dlq.dlq_id)}';
  `);
}

export function assertWooCommerceReportDlqClosed(row = {}, dlq) {
  if (row.dlq_id !== dlq.dlq_id
    || row.status !== 'redriven'
    || row.redrive_reference !== dlq.closureReference
    || row.recovery_status !== 'completed'
    || row.recovery_reference !== dlq.closureReference
    || row.audit_reference !== dlq.closureReference) {
    throw recoveryFailure(
      'Exact WooCommerce Report DLQ closure readback is incomplete',
      'WOOCOMMERCE_REPORT_LARK_RECOVERY_DLQ_CLOSURE_INCOMPLETE',
      {
        status: row.status ?? null,
        redriveReferenceMatched: row.redrive_reference === dlq.closureReference,
        recoveryStatus: row.recovery_status ?? null,
        recoveryReferenceMatched: row.recovery_reference === dlq.closureReference,
        auditReferenceMatched: row.audit_reference === dlq.closureReference,
      },
    );
  }
  return true;
}

function isExpectedLarkOptionFailure(value, incident) {
  const text = String(value ?? '');
  return text.includes(`field=${incident.failedField}`)
    && text.includes(`value "${incident.rejectedValue}" is not configured in destination select options`)
    && text.includes(incident.reportId);
}

function normalizeText(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean).join('') || null;
  if (value && typeof value === 'object') {
    return normalizeText(value.text ?? value.name ?? value.value ?? value.label);
  }
  return value === null || value === undefined ? null : String(value).trim() || null;
}

function normalizeNumber(value) {
  const scalar = Array.isArray(value) && value.length === 1 ? value[0] : value;
  const candidate = scalar && typeof scalar === 'object'
    ? scalar.value ?? scalar.text
    : scalar;
  if (candidate === null || candidate === undefined || candidate === '') return null;
  const number = Number(candidate);
  return Number.isFinite(number) ? number : null;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw recoveryFailure(
      `${fieldName} is required`,
      'WOOCOMMERCE_REPORT_LARK_RECOVERY_VALUE_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function recoveryFailure(message, code, details = {}) {
  return closeoutFailure(message, code, details);
}
