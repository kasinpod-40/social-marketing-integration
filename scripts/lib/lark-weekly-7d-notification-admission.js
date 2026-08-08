import { createHash } from 'node:crypto';

import {
  JOB_SCHEMA_VERSIONS,
  JOB_TRIGGERS,
  JOB_TYPES,
} from '../../packages/application/src/jobs/job-catalog.js';
import { createStableQueueOperationBody } from '../../packages/application/src/jobs/queue-operation.js';
import {
  readLarkNativeAiExecutiveBusinessMetricEvidence,
  validateLarkNativeAiExecutiveWriterOutputs,
} from '../../packages/application/src/reports/lark-native-ai-executive-writer-quality.js';
import {
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION,
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_WINDOW_DAYS,
} from '../../packages/config/src/lark-native-ai-weekly-7d-controlled-uat-contract.js';
import { parseSourceReportIds } from './lark-notification-controlled-uat.js';

export const LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONTRACT_VERSION =
  'lark_weekly_7d_notification_admission_v1';
export const LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_LARK_WEEKLY_7D_NOTIFICATION_ADMISSION',
  value: 'SEND_ONE_ACCEPTED_WEEKLY_7D_EXECUTIVE_NOTIFICATION',
});
export const LARK_WEEKLY_7D_NOTIFICATION_TEMPLATE_VERSION =
  'executive_weekly_7d_notification_v1';
export const LARK_WEEKLY_7D_NOTIFICATION_SOURCE_PROMPT_SHAPE =
  'lark_ai_compact_quality_v6';

const ADMISSION_PREFIX = 'notification-weekly-7d:';
const HASH = /^[a-f0-9]{64}$/u;
const SOURCE_SCOPE = 'executive';
const SOURCE_CHANNEL = 'executive';

export function assertLarkWeekly7dNotificationAdmissionConfirmation(env = {}) {
  const confirmation = LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONFIRMATION;
  if (env?.[confirmation.envName] !== confirmation.value) {
    throw admissionError(
      `Weekly 7D Notification Admission requires ${confirmation.envName}=${confirmation.value}`,
      'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONFIRMATION_REQUIRED',
      { envName: confirmation.envName },
    );
  }
  return true;
}

export function isExactAcceptedWeekly7dSource(fields = {}) {
  try {
    validateAcceptedSourceFields(fields);
    return true;
  } catch {
    return false;
  }
}

export function buildLarkWeekly7dNotificationAdmissionRow(sourceRecord) {
  const source = normalizeRecord(sourceRecord);
  const accepted = validateAcceptedSourceFields(source.fields);
  const sourceAiRunKey = requireText(scalar(source.fields.ai_run_key), 'source.ai_run_key');
  const sourceDedupeKey = requireHash(scalar(source.fields.dedupe_key), 'source.dedupe_key');
  const sourceReportIds = parseSourceReportIds(source.fields.source_report_ids_json);
  const outputs = readOutputs(source.fields);
  const metricSummaryJson = requireText(scalar(source.fields.metric_summary_json), 'metric_summary_json');
  const channelStatusVectorJson = requireText(
    scalar(source.fields.channel_status_vector_json),
    'channel_status_vector_json',
  );
  const identity = sha256(JSON.stringify({
    contractVersion: LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONTRACT_VERSION,
    templateVersion: LARK_WEEKLY_7D_NOTIFICATION_TEMPLATE_VERSION,
    sourceAiRunKey,
    sourceDedupeKey,
    sourceReportIds,
    metricSummarySha256: sha256(metricSummaryJson),
    outputsSha256: sha256(JSON.stringify(outputs)),
  }));
  const aiRunKey = `${ADMISSION_PREFIX}${identity}`;
  const fields = structuredClone(source.fields);
  Object.assign(fields, {
    ai_run_key: aiRunKey,
    report_id: aiRunKey,
    template_version: LARK_WEEKLY_7D_NOTIFICATION_TEMPLATE_VERSION,
    scope_type: SOURCE_SCOPE,
    channel_key: SOURCE_CHANNEL,
    capability: 'cross_channel',
    notification_eligible: true,
    notification_reason: 'weekly_7d_quality_accepted',
    preview_mode: false,
    generation_status: 'generated',
    sent_to_group: false,
    sent_at: null,
    cooldown_until: null,
    failure_code: null,
    dedupe_key: sha256(`${sourceDedupeKey}:${LARK_WEEKLY_7D_NOTIFICATION_TEMPLATE_VERSION}:${identity}`),
    source_report_ids_json: JSON.stringify(sourceReportIds),
  });
  return Object.freeze({
    sourceRecordId: source.recordId,
    sourceAiRunKey,
    sourceDedupeKey,
    aiRunKey,
    reportId: aiRunKey,
    dedupeKey: fields.dedupe_key,
    notificationAttemptKey: `${aiRunKey}::${fields.dedupe_key}`,
    sourceReportIds: Object.freeze(sourceReportIds),
    templateVersion: LARK_WEEKLY_7D_NOTIFICATION_TEMPLATE_VERSION,
    evidence: accepted.evidence,
    qualityGate: accepted.qualityGate,
    fields: deepFreeze(fields),
  });
}

export function buildLarkWeekly7dNotificationAdmissionJob(input = {}) {
  const aiRunKey = requireText(input.aiRunKey, 'aiRunKey');
  if (!aiRunKey.startsWith(ADMISSION_PREFIX)) {
    throw admissionError(
      'Weekly Notification Admission job requires a dedicated weekly 7D identity',
      'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_IDENTITY_INVALID',
    );
  }
  const operationId = requireText(input.operationId, 'operationId');
  const requestedAt = normalizeTimestamp(input.requestedAt, 'requestedAt');
  return createStableQueueOperationBody({
    type: JOB_TYPES.LARK_NOTIFICATION_SEND,
    schemaVersion: JOB_SCHEMA_VERSIONS.LARK_NOTIFICATION_RUNTIME,
    trigger: JOB_TRIGGERS.LARK_NOTIFICATION_RUNTIME,
    aiRunKey,
  }, {
    operationId,
    originalRequestedAt: requestedAt,
  });
}

export function buildLarkWeekly7dNotificationAdmissionReadbackSql(aiRunKey) {
  const key = sqlText(requireText(aiRunKey, 'aiRunKey'));
  return compactSql(`
    SELECT
      (SELECT COUNT(*) FROM sqlite_master
        WHERE type = 'table' AND name = 'lark_notification_deliveries')
        AS notification_table_count,
      (SELECT COUNT(*) FROM sqlite_master
        WHERE type = 'index' AND name LIKE 'idx_lark_notification_delivery_%')
        AS notification_index_count,
      (SELECT COUNT(*) FROM sync_locks WHERE expires_at > unixepoch('now') * 1000)
        AS active_locks,
      (SELECT COUNT(*) FROM lark_notification_deliveries) AS total_delivery_rows,
      (SELECT COUNT(*) FROM lark_notification_deliveries
        WHERE status = 'sent' AND mirror_status = 'mirrored') AS sent_mirrored_rows,
      (SELECT COUNT(*) FROM lark_notification_deliveries
        WHERE status <> 'sent' OR mirror_status <> 'mirrored') AS unsafe_delivery_rows,
      (SELECT COUNT(*) FROM lark_notification_deliveries
        WHERE ai_run_key <> '${key}'
          AND (status <> 'sent' OR mirror_status <> 'mirrored')) AS unrelated_unsafe_delivery_rows,
      (SELECT COUNT(*) FROM lark_notification_deliveries
        WHERE ai_run_key LIKE 'notification-uat:%') AS controlled_uat_rows,
      (SELECT COUNT(*) FROM lark_notification_deliveries
        WHERE ai_run_key LIKE 'notification-uat:%'
          AND status = 'sent' AND mirror_status = 'mirrored')
        AS controlled_uat_sent_mirrored_rows,
      (SELECT COUNT(*) FROM lark_notification_deliveries
        WHERE ai_run_key LIKE 'notification-runtime-smoke:%') AS runtime_smoke_rows,
      (SELECT COUNT(*) FROM lark_notification_deliveries
        WHERE ai_run_key LIKE 'notification-runtime-smoke:%'
          AND status = 'sent' AND mirror_status = 'mirrored')
        AS runtime_smoke_sent_mirrored_rows,
      (SELECT COUNT(*) FROM lark_notification_deliveries
        WHERE ai_run_key = '${key}') AS admission_delivery_rows,
      (SELECT status FROM lark_notification_deliveries
        WHERE ai_run_key = '${key}' LIMIT 1) AS admission_delivery_status,
      (SELECT mirror_status FROM lark_notification_deliveries
        WHERE ai_run_key = '${key}' LIMIT 1) AS admission_mirror_status,
      (SELECT claim_count FROM lark_notification_deliveries
        WHERE ai_run_key = '${key}' LIMIT 1) AS admission_claim_count,
      (SELECT sent_at FROM lark_notification_deliveries
        WHERE ai_run_key = '${key}' LIMIT 1) AS admission_sent_at,
      (SELECT lark_message_id_hash FROM lark_notification_deliveries
        WHERE ai_run_key = '${key}' LIMIT 1) AS admission_message_id_hash;
  `);
}

export function normalizeLarkWeekly7dNotificationAdmissionReadback(row = {}) {
  const value = Object.freeze({
    notificationTableCount: count(row.notification_table_count),
    notificationIndexCount: count(row.notification_index_count),
    activeLocks: count(row.active_locks),
    totalDeliveryRows: count(row.total_delivery_rows),
    sentMirroredRows: count(row.sent_mirrored_rows),
    unsafeDeliveryRows: count(row.unsafe_delivery_rows),
    unrelatedUnsafeDeliveryRows: count(row.unrelated_unsafe_delivery_rows),
    controlledUatRows: count(row.controlled_uat_rows),
    controlledUatSentMirroredRows: count(row.controlled_uat_sent_mirrored_rows),
    runtimeSmokeRows: count(row.runtime_smoke_rows),
    runtimeSmokeSentMirroredRows: count(row.runtime_smoke_sent_mirrored_rows),
    admissionDeliveryRows: count(row.admission_delivery_rows),
    admissionDeliveryStatus: optionalText(row.admission_delivery_status),
    admissionMirrorStatus: optionalText(row.admission_mirror_status),
    admissionClaimCount: nullableCount(row.admission_claim_count),
    admissionSentAt: nullableNumber(row.admission_sent_at),
    admissionMessageIdHash: optionalText(row.admission_message_id_hash),
  });
  const invalid = [];
  if (value.notificationTableCount !== 1) invalid.push('notificationTableCount');
  if (value.notificationIndexCount !== 3) invalid.push('notificationIndexCount');
  if (value.activeLocks !== 0) invalid.push('activeLocks');
  if (value.unrelatedUnsafeDeliveryRows !== 0) invalid.push('unrelatedUnsafeDeliveryRows');
  if (value.controlledUatRows !== 1 || value.controlledUatSentMirroredRows !== 1) {
    invalid.push('controlledUat');
  }
  if (value.runtimeSmokeRows !== 1 || value.runtimeSmokeSentMirroredRows !== 1) {
    invalid.push('runtimeSmoke');
  }
  if (value.admissionDeliveryRows > 1) invalid.push('admissionDeliveryRows');
  if (value.totalDeliveryRows < value.sentMirroredRows) invalid.push('deliveryCounts');
  if (invalid.length > 0) {
    throw admissionError(
      'Weekly Notification Admission requires the reviewed terminal runtime baseline',
      'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_REMOTE_STATE_INVALID',
      { invalid },
    );
  }
  if (['blocked', 'blocked_unknown'].includes(value.admissionDeliveryStatus ?? '')) {
    throw admissionError(
      'Weekly Notification Admission delivery reached a non-resendable blocked state',
      'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_DELIVERY_BLOCKED',
      { deliveryStatus: value.admissionDeliveryStatus },
    );
  }
  return value;
}

export function assertLarkWeekly7dNotificationAdmissionBaseline(readback = {}) {
  const value = normalizeReadbackShape(readback);
  const invalid = [];
  if (value.unsafeDeliveryRows !== 0) invalid.push('unsafeDeliveryRows');
  if (value.totalDeliveryRows !== value.sentMirroredRows) invalid.push('terminalParity');
  if (value.admissionDeliveryRows !== 0
      || value.admissionDeliveryStatus !== null
      || value.admissionMirrorStatus !== null
      || value.admissionClaimCount !== 0
      || value.admissionSentAt !== null
      || value.admissionMessageIdHash !== null) {
    invalid.push('existingAdmissionDelivery');
  }
  if (invalid.length > 0) {
    throw admissionError(
      'Weekly Notification Admission requires a fresh exact delivery identity',
      'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_ALREADY_ATTEMPTED',
      { invalid },
    );
  }
  return value;
}

export function assertLarkWeekly7dNotificationAdmissionDelivered(before, after) {
  const baseline = assertLarkWeekly7dNotificationAdmissionBaseline(before);
  const delivered = normalizeReadbackShape(after);
  const invalid = [];
  if (delivered.totalDeliveryRows !== baseline.totalDeliveryRows + 1) invalid.push('totalDeliveryRows');
  if (delivered.sentMirroredRows !== baseline.sentMirroredRows + 1) invalid.push('sentMirroredRows');
  if (delivered.unsafeDeliveryRows !== 0) invalid.push('unsafeDeliveryRows');
  if (delivered.totalDeliveryRows !== delivered.sentMirroredRows) invalid.push('terminalParity');
  if (delivered.admissionDeliveryRows !== 1) invalid.push('admissionDeliveryRows');
  if (delivered.admissionDeliveryStatus !== 'sent') invalid.push('admissionDeliveryStatus');
  if (delivered.admissionMirrorStatus !== 'mirrored') invalid.push('admissionMirrorStatus');
  if (delivered.admissionClaimCount < 1) invalid.push('admissionClaimCount');
  if (!Number.isFinite(delivered.admissionSentAt)) invalid.push('admissionSentAt');
  if (!HASH.test(delivered.admissionMessageIdHash ?? '')) invalid.push('admissionMessageIdHash');
  if (invalid.length > 0) {
    throw admissionError(
      'Weekly Notification Admission has not reached one sent and mirrored delivery',
      'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_NOT_CONFIRMED',
      { invalid },
    );
  }
  return Object.freeze({
    ...delivered,
    deliveryRowsBefore: baseline.totalDeliveryRows,
    deliveryRowsAfter: delivered.totalDeliveryRows,
    additionalDeliveryRows: 1,
    additionalMessageSendCount: 1,
  });
}

export function assertLarkWeekly7dNotificationAdmissionStable(delivered, observed) {
  const first = normalizeReadbackShape(delivered);
  const after = normalizeReadbackShape(observed);
  const fields = [
    'totalDeliveryRows',
    'sentMirroredRows',
    'unsafeDeliveryRows',
    'controlledUatRows',
    'controlledUatSentMirroredRows',
    'runtimeSmokeRows',
    'runtimeSmokeSentMirroredRows',
    'admissionDeliveryRows',
    'admissionDeliveryStatus',
    'admissionMirrorStatus',
    'admissionClaimCount',
    'admissionSentAt',
    'admissionMessageIdHash',
  ];
  const drift = fields.filter((field) => first[field] !== after[field]);
  if (drift.length > 0) {
    throw admissionError(
      'Weekly Notification Admission changed during the no-admission observation window',
      'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_STABILITY_FAILED',
      { drift },
    );
  }
  return Object.freeze({
    exactDeliveryRows: 1,
    duplicateDeliveryRows: 0,
    additionalMessageSendCountDuringObservation: 0,
    sentAtStable: true,
    messageIdHashStable: true,
  });
}

function validateAcceptedSourceFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw admissionError(
      'Weekly Notification Admission source must be one Lark record field object',
      'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_SOURCE_INVALID',
    );
  }
  const checks = [
    [optionalText(fields.template_version) === LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION, 'templateVersion'],
    [optionalText(fields.scope_type) === SOURCE_SCOPE, 'scopeType'],
    [optionalText(fields.channel_key) === SOURCE_CHANNEL, 'channelKey'],
    [Number(optionalText(fields.window_days)) === LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_WINDOW_DAYS, 'windowDays'],
    [['report_available', 'report_partial'].includes(optionalText(fields.readiness_status)), 'readinessStatus'],
    [optionalText(fields.generation_status) === 'generated', 'generationStatus'],
    [optionalText(fields.failure_code) === null, 'failureCode'],
    [booleanValue(fields.preview_mode) === true, 'previewMode'],
    [booleanValue(fields.notification_eligible) === false, 'notificationEligible'],
    [booleanValue(fields.sent_to_group) === false, 'sentToGroup'],
  ];
  const invalid = checks.filter(([passed]) => !passed).map(([, name]) => name);
  if (invalid.length > 0) {
    throw admissionError(
      'Weekly Notification Admission source is not the finalized accepted V9 7D row',
      'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_SOURCE_INVALID',
      { invalid },
    );
  }
  const metricSummaryJson = requireText(scalar(fields.metric_summary_json), 'metric_summary_json');
  const channelStatusVectorJson = requireText(
    scalar(fields.channel_status_vector_json),
    'channel_status_vector_json',
  );
  const evidence = readLarkNativeAiExecutiveBusinessMetricEvidence({
    metricSummaryJson,
    channelStatusVectorJson,
  });
  if (evidence.promptShape !== LARK_WEEKLY_7D_NOTIFICATION_SOURCE_PROMPT_SHAPE
      || evidence.derivedCtrFacts.length < 1) {
    throw admissionError(
      'Weekly Notification Admission source must retain reviewed quality-v6 business evidence',
      'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_EVIDENCE_INVALID',
      {
        promptShape: evidence.promptShape,
        derivedCtrFactCount: evidence.derivedCtrFacts.length,
      },
    );
  }
  const outputs = readOutputs(fields);
  const qualityGate = validateLarkNativeAiExecutiveWriterOutputs(outputs, evidence);
  if (qualityGate.passed !== true) {
    throw admissionError(
      'Weekly Notification Admission source failed the Executive Writer quality gate',
      'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_QUALITY_FAILED',
      { violations: qualityGate.violations },
    );
  }
  requireHash(scalar(fields.dedupe_key), 'dedupe_key');
  parseSourceReportIds(fields.source_report_ids_json);
  return Object.freeze({ evidence, qualityGate });
}

function readOutputs(fields) {
  const names = ['insight_summary', 'strengths', 'weaknesses', 'recommendations'];
  return Object.freeze(Object.fromEntries(names.map((name) => [
    name,
    requireText(scalar(fields[name]), name),
  ])));
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw admissionError(
      'Weekly Notification Admission source record is invalid',
      'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_SOURCE_INVALID',
    );
  }
  const fields = record.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw admissionError(
      'Weekly Notification Admission source fields are invalid',
      'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_SOURCE_INVALID',
    );
  }
  return Object.freeze({ recordId: record.recordId ?? record.record_id ?? null, fields });
}

function normalizeReadbackShape(value) {
  return normalizeLarkWeekly7dNotificationAdmissionReadback({
    notification_table_count: value.notificationTableCount,
    notification_index_count: value.notificationIndexCount,
    active_locks: value.activeLocks,
    total_delivery_rows: value.totalDeliveryRows,
    sent_mirrored_rows: value.sentMirroredRows,
    unsafe_delivery_rows: value.unsafeDeliveryRows,
    unrelated_unsafe_delivery_rows: value.unrelatedUnsafeDeliveryRows,
    controlled_uat_rows: value.controlledUatRows,
    controlled_uat_sent_mirrored_rows: value.controlledUatSentMirroredRows,
    runtime_smoke_rows: value.runtimeSmokeRows,
    runtime_smoke_sent_mirrored_rows: value.runtimeSmokeSentMirroredRows,
    admission_delivery_rows: value.admissionDeliveryRows,
    admission_delivery_status: value.admissionDeliveryStatus,
    admission_mirror_status: value.admissionMirrorStatus,
    admission_claim_count: value.admissionClaimCount,
    admission_sent_at: value.admissionSentAt,
    admission_message_id_hash: value.admissionMessageIdHash,
  });
}

function booleanValue(value) {
  const item = scalar(value);
  if (item === true || item === false) return item;
  if (item === 1 || item === '1' || String(item).toLowerCase() === 'true') return true;
  if (item === 0 || item === '0' || String(item).toLowerCase() === 'false') return false;
  return null;
}
function scalar(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length === 1) return scalar(value[0]);
    return value.map(scalar).join(',');
  }
  if (typeof value === 'object') {
    for (const key of ['text', 'name', 'value']) {
      if (value[key] !== undefined) return scalar(value[key]);
    }
  }
  return value;
}
function requireText(value, fieldName) {
  const text = optionalText(value);
  if (!text) {
    throw admissionError(
      `${fieldName} is required`,
      'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return text;
}
function optionalText(value) {
  if (value === null || value === undefined) return null;
  const text = String(scalar(value) ?? '').trim();
  return text || null;
}
function requireHash(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!HASH.test(text)) {
    throw admissionError(
      `${fieldName} must be lowercase SHA-256 hex`,
      'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return text;
}
function normalizeTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw admissionError(
      `${fieldName} must be a positive timestamp`,
      'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return number;
}
function count(value) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw admissionError(
      'Notification readback count is invalid',
      'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_REMOTE_STATE_INVALID',
    );
  }
  return number;
}
function nullableCount(value) {
  return value === null || value === undefined ? 0 : count(value);
}
function nullableNumber(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function sqlText(value) {
  return String(value).replace(/'/gu, "''");
}
function compactSql(value) {
  return value.replace(/\s+/gu, ' ').trim();
}
function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
function admissionError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkWeekly7dNotificationAdmissionError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
