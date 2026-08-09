import { createHash } from 'node:crypto';

import {
  JOB_SCHEMA_VERSIONS,
  JOB_TRIGGERS,
  JOB_TYPES,
} from '../../packages/application/src/jobs/job-catalog.js';
import { normalizeQueueJobMessage } from '../../packages/application/src/jobs/queue-job.js';
import { resolveQueueOperation } from '../../packages/application/src/jobs/queue-operation.js';

export const LARK_WEEKLY_7D_FULL_CHANNEL_REPAIR_ALLOWED_ERRORS = Object.freeze([
  'LARK_NOTIFICATION_RUNTIME_DISABLED',
  'LARK_NOTIFICATION_TRIGGER_FORBIDDEN',
  'LARK_NOTIFICATION_RUNTIME_CONFIG_INVALID',
  'UNSUPPORTED_SYNC_JOB',
]);

const ALLOWED_ERRORS = new Set(LARK_WEEKLY_7D_FULL_CHANNEL_REPAIR_ALLOWED_ERRORS);

export function buildLarkWeekly7dFullChannelRepairDeadLetterSql() {
  return compactSql(`
    SELECT
      dlq_id, message_id, queue_name, job_type, schema_version,
      replay_payload_json, error_code, retry_count, status,
      redrive_requested_at, redrive_reference, redriven_at,
      created_at, updated_at,
      (SELECT COUNT(*) FROM system_alerts
        WHERE alert_id = 'alert:' || dead_letter_jobs.dlq_id
          AND status = 'open') AS open_alert_count
    FROM dead_letter_jobs
    WHERE job_type = '${JOB_TYPES.LARK_NOTIFICATION_SEND}'
      AND status IN ('open', 'redrive_pending', 'redriven')
    ORDER BY created_at DESC
    LIMIT 20;
  `);
}

export function selectLarkWeekly7dFullChannelRepairCandidate(rows = [], expected = {}) {
  const aiRunKey = requireText(expected.aiRunKey, 'expected.aiRunKey');
  const operationId = requireText(expected.operationId, 'expected.operationId');
  const jobSha256 = requireHash(expected.jobSha256, 'expected.jobSha256');
  const allowedStatuses = new Set(expected.allowedStatuses ?? ['open']);
  const candidates = rows
    .map(normalizeRow)
    .filter((row) => row.jobType === JOB_TYPES.LARK_NOTIFICATION_SEND)
    .filter((row) => row.replayPayload?.aiRunKey === aiRunKey);
  if (candidates.length !== 1) {
    throw repairError(
      'Full-channel repair requires exactly one retained Notification dead letter',
      'LARK_WEEKLY_7D_FULL_CHANNEL_REPAIR_DLQ_INVALID',
      { matchCount: candidates.length },
    );
  }
  const candidate = candidates[0];
  if (!allowedStatuses.has(candidate.status)) {
    throw repairError(
      'Retained Notification dead letter is outside the allowed repair state',
      'LARK_WEEKLY_7D_FULL_CHANNEL_REPAIR_DLQ_STATE_INVALID',
      { status: candidate.status },
    );
  }
  if (!ALLOWED_ERRORS.has(candidate.errorCode)) {
    throw repairError(
      'Retained Notification failure is not a reviewed runtime/deployment rejection',
      'LARK_WEEKLY_7D_FULL_CHANNEL_REPAIR_ERROR_UNSUPPORTED',
      { observedErrorCode: candidate.errorCode },
    );
  }
  if (candidate.schemaVersion !== JOB_SCHEMA_VERSIONS.LARK_NOTIFICATION_RUNTIME
      || candidate.replayPayload?.schemaVersion !== JOB_SCHEMA_VERSIONS.LARK_NOTIFICATION_RUNTIME
      || candidate.replayPayload?.type !== JOB_TYPES.LARK_NOTIFICATION_SEND
      || candidate.replayPayload?.trigger !== JOB_TRIGGERS.LARK_NOTIFICATION_RUNTIME) {
    throw repairError(
      'Retained Notification replay payload is outside the reviewed runtime contract',
      'LARK_WEEKLY_7D_FULL_CHANNEL_REPAIR_PAYLOAD_INVALID',
    );
  }
  const normalizedJob = normalizeQueueJobMessage({
    id: candidate.messageId,
    body: candidate.replayPayload,
  });
  const operation = resolveQueueOperation({
    job: normalizedJob,
    message: { id: candidate.messageId },
  });
  if (!operation.stable
      || operation.operationId !== operationId
      || candidate.replayPayload.operationId !== operationId
      || sha256(JSON.stringify(candidate.replayPayload)) !== jobSha256) {
    throw repairError(
      'Retained Notification replay payload differs from immutable Queue-attempt evidence',
      'LARK_WEEKLY_7D_FULL_CHANNEL_REPAIR_IDENTITY_MISMATCH',
      {
        stable: operation.stable,
        operationIdMatches: operation.operationId === operationId,
        jobHashMatches: sha256(JSON.stringify(candidate.replayPayload)) === jobSha256,
      },
    );
  }
  if (candidate.status === 'open' && candidate.openAlertCount !== 1) {
    throw repairError(
      'Retained Notification terminal failure requires one exact open System Alert',
      'LARK_WEEKLY_7D_FULL_CHANNEL_REPAIR_ALERT_INVALID',
      { openAlertCount: candidate.openAlertCount },
    );
  }
  return deepFreeze({ ...candidate, operation });
}

export function buildLarkWeekly7dFullChannelRepairPrepareSql(candidate = {}, input = {}) {
  const now = requireTimestamp(input.now, 'now');
  const reference = requireText(input.redriveReference, 'redriveReference');
  return compactSql(`
    UPDATE dead_letter_jobs
    SET status = 'redrive_pending',
        redrive_requested_at = COALESCE(redrive_requested_at, ${now}),
        redrive_reference = COALESCE(redrive_reference, '${sqlText(reference)}'),
        updated_at = ${now}
    WHERE dlq_id = '${sqlText(requireText(candidate.dlqId, 'candidate.dlqId'))}'
      AND status = 'open'
      AND error_code = '${sqlText(requireText(candidate.errorCode, 'candidate.errorCode'))}';
  `);
}

export function buildLarkWeekly7dFullChannelRepairCompleteSql(candidate = {}, input = {}) {
  const now = requireTimestamp(input.now, 'now');
  const reference = requireText(input.redriveReference, 'redriveReference');
  const dlqId = requireText(candidate.dlqId, 'candidate.dlqId');
  return compactSql(`
    UPDATE dead_letter_jobs
    SET status = 'redriven',
        redriven_at = COALESCE(redriven_at, ${now}),
        updated_at = ${now}
    WHERE dlq_id = '${sqlText(dlqId)}'
      AND status = 'redrive_pending'
      AND redrive_reference = '${sqlText(reference)}';
  `);
}

export function buildLarkWeekly7dFullChannelRepairResolveAlertSql(candidate = {}, input = {}) {
  const now = requireTimestamp(input.now, 'now');
  const dlqId = requireText(candidate.dlqId, 'candidate.dlqId');
  return compactSql(`
    UPDATE system_alerts
    SET status = 'resolved', updated_at = ${now}
    WHERE alert_id = 'alert:${sqlText(dlqId)}' AND status = 'open';
  `);
}

function normalizeRow(row = {}) {
  const replayPayload = parseReplayPayload(row.replay_payload_json);
  return deepFreeze({
    dlqId: requireText(row.dlq_id, 'dlq_id'),
    messageId: requireText(row.message_id, 'message_id'),
    queueName: optionalText(row.queue_name),
    jobType: optionalText(row.job_type),
    schemaVersion: number(row.schema_version),
    replayPayload,
    errorCode: optionalText(row.error_code),
    retryCount: nonNegativeInteger(row.retry_count),
    status: requireText(row.status, 'status'),
    redriveRequestedAt: nullableNumber(row.redrive_requested_at),
    redriveReference: optionalText(row.redrive_reference),
    redrivenAt: nullableNumber(row.redriven_at),
    openAlertCount: nonNegativeInteger(row.open_alert_count),
  });
}

function parseReplayPayload(value) {
  try {
    const parsed = JSON.parse(requireText(value, 'replay_payload_json'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    return parsed;
  } catch {
    throw repairError(
      'Retained Notification dead letter has no valid replay payload',
      'LARK_WEEKLY_7D_FULL_CHANNEL_REPAIR_REPLAY_MISSING',
    );
  }
}
function number(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  return number(value);
}
function nonNegativeInteger(value) {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw repairError('Retained Notification count is invalid', 'LARK_WEEKLY_7D_FULL_CHANNEL_REPAIR_DLQ_INVALID');
  }
  return parsed;
}
function requireTimestamp(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < Date.UTC(2000, 0, 1)) {
    throw new TypeError(`${label} must be epoch milliseconds`);
  }
  return parsed;
}
function optionalText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}
function requireText(value, label) {
  const text = optionalText(value);
  if (!text) throw new TypeError(`${label} is required`);
  return text;
}
function requireHash(value, label) {
  const text = requireText(value, label);
  if (!/^[a-f0-9]{64}$/u.test(text)) throw new TypeError(`${label} must be SHA-256`);
  return text;
}
function compactSql(value) { return String(value).replace(/\s+/gu, ' ').trim(); }
function sqlText(value) { return String(value).replace(/'/gu, "''"); }
function sha256(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function repairError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkWeekly7dFullChannelDeliveryRepairError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}
