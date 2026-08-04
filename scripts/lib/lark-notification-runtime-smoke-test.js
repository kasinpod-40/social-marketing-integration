import { createHash } from 'node:crypto';

import {
  JOB_SCHEMA_VERSIONS,
  JOB_TRIGGERS,
  JOB_TYPES,
} from '../../packages/application/src/jobs/job-catalog.js';
import {
  createStableQueueOperationBody,
} from '../../packages/application/src/jobs/queue-operation.js';
import {
  parseSourceReportIds,
} from './lark-notification-controlled-uat.js';

export const LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_CONTRACT_VERSION =
  'lark_notification_runtime_smoke_test_v1';
export const LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_LARK_NOTIFICATION_RUNTIME_SMOKE_TEST',
  value: 'SEND_ONE_RUNTIME_EXECUTIVE_NOTIFICATION',
});
export const LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_EXPECTED_ACTIVE_VERSION =
  '958e183e-fb0d-4795-a547-d805111ca6fc';

const TEMPLATE_VERSION = 'executive_notification_runtime_smoke_v1';
const HASH = /^[a-f0-9]{64}$/u;
const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const WORKER_VERSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function assertLarkNotificationRuntimeSmokeTestConfirmation(env = {}) {
  const confirmation = LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_CONFIRMATION;
  if (env?.[confirmation.envName] !== confirmation.value) {
    throw smokeError(
      `Runtime smoke test requires ${confirmation.envName}=${confirmation.value}`,
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_CONFIRMATION_REQUIRED',
      { envName: confirmation.envName },
    );
  }
  return true;
}

export function buildLarkNotificationRuntimeSmokeTestRow(sourceRecord, repositoryHead) {
  const source = normalizeRecord(sourceRecord);
  const head = requireCommitSha(repositoryHead, 'repositoryHead');
  validatePreview(source.fields);
  const sourceAiRunKey = requireText(scalar(source.fields.ai_run_key), 'source.ai_run_key');
  const sourceDedupeKey = requireHash(scalar(source.fields.dedupe_key), 'source.dedupe_key');
  const sourceReportIds = parseSourceReportIds(source.fields.source_report_ids_json);
  const identity = sha256(JSON.stringify({
    contractVersion: LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_CONTRACT_VERSION,
    templateVersion: TEMPLATE_VERSION,
    repositoryHead: head,
    sourceAiRunKey,
    sourceDedupeKey,
    sourceReportIds,
  }));
  const fields = structuredClone(source.fields);
  Object.assign(fields, {
    ai_run_key: `notification-runtime-smoke:${identity}`,
    report_id: `notification-runtime-smoke:${identity}`,
    scope_type: 'executive',
    channel_key: 'executive',
    capability: 'cross_channel',
    notification_eligible: true,
    notification_reason: 'runtime_smoke_test',
    preview_mode: false,
    generation_status: 'generated',
    sent_to_group: false,
    sent_at: null,
    cooldown_until: null,
    failure_code: null,
    dedupe_key: sha256(`${sourceDedupeKey}:${TEMPLATE_VERSION}:${head}`),
    source_report_ids_json: JSON.stringify(sourceReportIds),
  });
  return Object.freeze({
    sourceRecordId: source.recordId,
    sourceAiRunKey,
    aiRunKey: fields.ai_run_key,
    reportId: fields.report_id,
    sourceReportIds,
    templateVersion: TEMPLATE_VERSION,
    fields: deepFreeze(fields),
  });
}

export function buildLarkNotificationRuntimeSmokeTestJob(input = {}) {
  const aiRunKey = requireText(input.aiRunKey, 'aiRunKey');
  if (!aiRunKey.startsWith('notification-runtime-smoke:')) {
    throw smokeError(
      'Runtime smoke test Job requires a dedicated runtime-smoke AI identity',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_IDENTITY_INVALID',
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

export function buildLarkNotificationRuntimeSmokeTestReadbackSql(aiRunKey) {
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
        WHERE ai_run_key LIKE 'notification-uat:%') AS controlled_uat_rows,
      (SELECT COUNT(*) FROM lark_notification_deliveries
        WHERE ai_run_key LIKE 'notification-uat:%'
          AND status = 'sent' AND mirror_status = 'mirrored')
        AS controlled_uat_sent_mirrored_rows,
      (SELECT COUNT(*) FROM lark_notification_deliveries
        WHERE ai_run_key = '${key}') AS smoke_delivery_rows,
      (SELECT status FROM lark_notification_deliveries
        WHERE ai_run_key = '${key}' LIMIT 1) AS smoke_delivery_status,
      (SELECT mirror_status FROM lark_notification_deliveries
        WHERE ai_run_key = '${key}' LIMIT 1) AS smoke_mirror_status,
      (SELECT claim_count FROM lark_notification_deliveries
        WHERE ai_run_key = '${key}' LIMIT 1) AS smoke_claim_count,
      (SELECT sent_at FROM lark_notification_deliveries
        WHERE ai_run_key = '${key}' LIMIT 1) AS smoke_sent_at,
      (SELECT lark_message_id_hash FROM lark_notification_deliveries
        WHERE ai_run_key = '${key}' LIMIT 1) AS smoke_message_id_hash;
  `);
}

export function normalizeLarkNotificationRuntimeSmokeTestReadback(row = {}) {
  const value = Object.freeze({
    notificationTableCount: count(row.notification_table_count),
    notificationIndexCount: count(row.notification_index_count),
    activeLocks: count(row.active_locks),
    totalDeliveryRows: count(row.total_delivery_rows),
    sentMirroredRows: count(row.sent_mirrored_rows),
    unsafeDeliveryRows: count(row.unsafe_delivery_rows),
    controlledUatRows: count(row.controlled_uat_rows),
    controlledUatSentMirroredRows: count(row.controlled_uat_sent_mirrored_rows),
    smokeDeliveryRows: count(row.smoke_delivery_rows),
    smokeDeliveryStatus: optionalText(row.smoke_delivery_status),
    smokeMirrorStatus: optionalText(row.smoke_mirror_status),
    smokeClaimCount: row.smoke_claim_count === null || row.smoke_claim_count === undefined
      ? 0
      : count(row.smoke_claim_count),
    smokeSentAt: row.smoke_sent_at === null || row.smoke_sent_at === undefined
      ? null
      : Number(row.smoke_sent_at),
    smokeMessageIdHash: optionalText(row.smoke_message_id_hash),
  });
  const invalid = [];
  if (value.notificationTableCount !== 1) invalid.push('notificationTableCount');
  if (value.notificationIndexCount !== 3) invalid.push('notificationIndexCount');
  if (value.activeLocks !== 0) invalid.push('activeLocks');
  if (value.unsafeDeliveryRows !== 0) invalid.push('unsafeDeliveryRows');
  if (value.totalDeliveryRows !== value.sentMirroredRows) invalid.push('terminalParity');
  if (value.controlledUatRows !== 1
      || value.controlledUatSentMirroredRows !== 1) invalid.push('controlledUat');
  if (invalid.length > 0) {
    throw smokeError(
      'Runtime smoke test requires the applied terminal notification baseline and no active lock',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_REMOTE_STATE_INVALID',
      { invalid },
    );
  }
  return value;
}

export function assertLarkNotificationRuntimeSmokeTestBaseline(readback = {}) {
  const value = normalizeReadbackShape(readback);
  if (value.smokeDeliveryRows !== 0
      || value.smokeDeliveryStatus !== null
      || value.smokeMirrorStatus !== null
      || value.smokeClaimCount !== 0
      || value.smokeSentAt !== null
      || value.smokeMessageIdHash !== null) {
    throw smokeError(
      'Runtime smoke test identity already has delivery evidence; blind rerun is forbidden',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_ALREADY_ATTEMPTED',
      { smokeDeliveryRows: value.smokeDeliveryRows },
    );
  }
  return value;
}

export function assertLarkNotificationRuntimeSmokeTestDelivered(before, after) {
  const baseline = assertLarkNotificationRuntimeSmokeTestBaseline(before);
  const delivered = normalizeReadbackShape(after);
  const invalid = [];
  if (delivered.totalDeliveryRows !== baseline.totalDeliveryRows + 1) {
    invalid.push('totalDeliveryRows');
  }
  if (delivered.sentMirroredRows !== baseline.sentMirroredRows + 1) {
    invalid.push('sentMirroredRows');
  }
  if (delivered.controlledUatRows !== baseline.controlledUatRows
      || delivered.controlledUatSentMirroredRows
        !== baseline.controlledUatSentMirroredRows) invalid.push('controlledUat');
  if (delivered.smokeDeliveryRows !== 1) invalid.push('smokeDeliveryRows');
  if (delivered.smokeDeliveryStatus !== 'sent') invalid.push('smokeDeliveryStatus');
  if (delivered.smokeMirrorStatus !== 'mirrored') invalid.push('smokeMirrorStatus');
  if (delivered.smokeClaimCount < 1) invalid.push('smokeClaimCount');
  if (!Number.isFinite(delivered.smokeSentAt)) invalid.push('smokeSentAt');
  if (!HASH.test(delivered.smokeMessageIdHash ?? '')) invalid.push('smokeMessageIdHash');
  if (invalid.length > 0) {
    throw smokeError(
      'Runtime smoke test did not produce exactly one sent and mirrored delivery',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_DELIVERY_NOT_CONFIRMED',
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

export function assertLarkNotificationRuntimeSmokeTestStable(delivered, observed) {
  const first = normalizeReadbackShape(delivered);
  const after = normalizeReadbackShape(observed);
  const stableFields = [
    'totalDeliveryRows',
    'sentMirroredRows',
    'controlledUatRows',
    'controlledUatSentMirroredRows',
    'smokeDeliveryRows',
    'smokeDeliveryStatus',
    'smokeMirrorStatus',
    'smokeClaimCount',
    'smokeSentAt',
    'smokeMessageIdHash',
  ];
  const drift = stableFields.filter((field) => first[field] !== after[field]);
  if (drift.length > 0) {
    throw smokeError(
      'Runtime smoke test delivery changed during the no-admission observation window',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_STABILITY_FAILED',
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

export function parseLarkNotificationRuntimeSmokeTestDeploymentStatus(
  output,
  expectedVersionId = LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_EXPECTED_ACTIVE_VERSION,
) {
  const expected = requireWorkerVersion(expectedVersionId, 'expectedVersionId');
  let parsed;
  try {
    parsed = JSON.parse(requireText(output, 'deploymentStatusOutput'));
  } catch {
    throw smokeError(
      'Wrangler deployment status output is not valid JSON',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_DEPLOYMENT_INVALID',
    );
  }
  const allocations = collectAllocations(parsed);
  const nonZero = allocations.filter((item) => item.percentage > 0);
  const exact = nonZero.filter((item) => item.versionId === expected);
  const total = nonZero.reduce((sum, item) => sum + item.percentage, 0);
  if (nonZero.length !== 1 || exact.length !== 1 || total !== 100
      || exact[0].percentage !== 100) {
    throw smokeError(
      'The reviewed Runtime Worker version is not serving 100 percent of traffic',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_DEPLOYMENT_INVALID',
      {
        expectedVersionId: expected,
        observedVersionIds: nonZero.map((item) => item.versionId),
        observedPercentages: nonZero.map((item) => item.percentage),
      },
    );
  }
  return Object.freeze({
    activeVersionId: expected,
    trafficPercentage: 100,
    allocationCount: 1,
  });
}

function normalizeReadbackShape(value) {
  return normalizeLarkNotificationRuntimeSmokeTestReadback({
    notification_table_count: value.notificationTableCount,
    notification_index_count: value.notificationIndexCount,
    active_locks: value.activeLocks,
    total_delivery_rows: value.totalDeliveryRows,
    sent_mirrored_rows: value.sentMirroredRows,
    unsafe_delivery_rows: value.unsafeDeliveryRows,
    controlled_uat_rows: value.controlledUatRows,
    controlled_uat_sent_mirrored_rows: value.controlledUatSentMirroredRows,
    smoke_delivery_rows: value.smokeDeliveryRows,
    smoke_delivery_status: value.smokeDeliveryStatus,
    smoke_mirror_status: value.smokeMirrorStatus,
    smoke_claim_count: value.smokeClaimCount,
    smoke_sent_at: value.smokeSentAt,
    smoke_message_id_hash: value.smokeMessageIdHash,
  });
}

function validatePreview(fields) {
  for (const fieldName of [
    'ai_run_key',
    'report_id',
    'dedupe_key',
    'source_report_ids_json',
    'insight_summary',
    'strengths',
    'weaknesses',
    'recommendations',
  ]) requireText(scalar(fields[fieldName]), fieldName);
  requireHash(scalar(fields.dedupe_key), 'dedupe_key');
  parseSourceReportIds(fields.source_report_ids_json);
  if (Number(scalar(fields.window_days)) !== 1) {
    throw smokeError(
      'Runtime smoke test uses the reviewed 1D Executive Preview only',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_SOURCE_INVALID',
    );
  }
}

function collectAllocations(root) {
  const values = [];
  const seen = new Set();
  walk(root);
  return values;

  function walk(value) {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const versionId = readVersionId(value);
    const percentage = readPercentage(value);
    if (versionId !== null && percentage !== null) {
      const key = `${versionId}:${percentage}`;
      if (!seen.has(key)) {
        seen.add(key);
        values.push(Object.freeze({ versionId, percentage }));
      }
    }
    for (const nested of Object.values(value)) walk(nested);
  }
}

function readVersionId(value) {
  for (const key of ['version_id', 'versionId', 'worker_version_id', 'workerVersionId']) {
    if (WORKER_VERSION_ID.test(value?.[key] ?? '')) return value[key];
  }
  return null;
}

function readPercentage(value) {
  for (const key of [
    'percentage',
    'percent',
    'traffic_percentage',
    'trafficPercentage',
  ]) {
    const number = Number(value?.[key]);
    if (Number.isFinite(number) && number >= 0 && number <= 100) return number;
  }
  return null;
}

function normalizeRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !value.fields || typeof value.fields !== 'object' || Array.isArray(value.fields)) {
    throw smokeError(
      'Runtime smoke test source must be one Lark record',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_SOURCE_INVALID',
    );
  }
  return Object.freeze({
    recordId: requireText(value.recordId ?? value.record_id, 'recordId'),
    fields: deepFreeze(structuredClone(value.fields)),
  });
}

function normalizeTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw smokeError(
      `${fieldName} must be a positive integer timestamp`,
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return number;
}

function count(value) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw smokeError(
      'Runtime smoke test count is invalid',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_REMOTE_STATE_INVALID',
    );
  }
  return number;
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

function optionalText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw smokeError(
      `${fieldName} is required`,
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return value.trim();
}

function requireHash(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!HASH.test(text)) {
    throw smokeError(
      `${fieldName} must be SHA-256`,
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_SOURCE_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireCommitSha(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!COMMIT_SHA.test(text)) {
    throw smokeError(
      `${fieldName} must be a Git commit SHA`,
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return text;
}

function requireWorkerVersion(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!WORKER_VERSION_ID.test(text)) {
    throw smokeError(
      `${fieldName} must be a Worker version UUID`,
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_DEPLOYMENT_INVALID',
      { fieldName },
    );
  }
  return text;
}

function sqlText(value) {
  return value.replaceAll("'", "''");
}

function compactSql(value) {
  return value.replace(/\s+/gu, ' ').trim();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function smokeError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkNotificationRuntimeSmokeTestError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
