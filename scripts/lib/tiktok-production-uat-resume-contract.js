import {
  TIKTOK_PRODUCTION_RECOVERY,
  buildIdempotencyEnvelope,
  buildRedriveEnvelope,
  validateSuccessfulSyncRun,
} from './tiktok-production-uat-recovery-contract.js';

export const TIKTOK_PRODUCTION_RESUME = Object.freeze({
  rootDlqId: 'terminal:f7081a5a92bced0c5eb9550a259c7bd8',
  rootRedriveRequestedAt: 1787424210138,
  rootRedriveReference: 'redrive:terminal:f7081a5a92bced0c5eb9550a259c7bd8:1787424210138',
  parentDlqId: 'terminal:b86ecb1940084e52caf21c2aa5bc091f',
  resumeDlqId: 'dlq:fef9919e843e33a0ec6d111fc315f662',
  resumeMessageId: 'fef9919e843e33a0ec6d111fc315f662',
  resumeErrorCode: 'QUEUE_RETRY_EXHAUSTED',
  resumeCreatedAt: 1787452321754,
  staleRunId: '9a6dd495-a098-4533-a023-0bf7302012dc',
});

export function validateRootRedrivenRow(row) {
  assertEqual(row?.dlq_id, TIKTOK_PRODUCTION_RESUME.rootDlqId, 'root dlq_id');
  assertEqual(row?.job_type, TIKTOK_PRODUCTION_RECOVERY.jobType, 'root job_type');
  assertEqual(row?.status, 'redriven', 'root status');
  assertEqual(Number(row?.redrive_requested_at), TIKTOK_PRODUCTION_RESUME.rootRedriveRequestedAt, 'root redrive_requested_at');
  assertEqual(row?.redrive_reference, TIKTOK_PRODUCTION_RESUME.rootRedriveReference, 'root redrive_reference');
  if (!Number.isSafeInteger(Number(row?.redriven_at)) || Number(row.redriven_at) <= 0) {
    throw contractError('Root DLQ must have redriven_at', 'TIKTOK_PRODUCTION_RESUME_ROOT_NOT_REDRIVEN', {
      redrivenAt: row?.redriven_at ?? null,
    });
  }
  return Object.freeze({ ...row });
}

export function validateResumeDlqRow(row) {
  assertEqual(row?.dlq_id, TIKTOK_PRODUCTION_RESUME.resumeDlqId, 'resume dlq_id');
  assertEqual(String(row?.message_id ?? ''), TIKTOK_PRODUCTION_RESUME.resumeMessageId, 'resume message_id');
  assertEqual(row?.job_type, TIKTOK_PRODUCTION_RECOVERY.jobType, 'resume job_type');
  assertEqual(row?.status, 'open', 'resume status');
  assertEqual(row?.error_code, TIKTOK_PRODUCTION_RESUME.resumeErrorCode, 'resume error_code');
  assertEqual(Number(row?.created_at), TIKTOK_PRODUCTION_RESUME.resumeCreatedAt, 'resume created_at');

  const payload = parsePayload(row?.payload_json);
  assertEqual(payload?.type, TIKTOK_PRODUCTION_RECOVERY.jobType, 'resume payload type');
  assertEqual(payload?.trigger, TIKTOK_PRODUCTION_RECOVERY.trigger, 'resume payload trigger');
  assertEqual(payload?.metricDate, TIKTOK_PRODUCTION_RECOVERY.metricDate, 'resume payload metricDate');
  assertEqual(payload?.redriveOfDlqId, TIKTOK_PRODUCTION_RESUME.parentDlqId, 'resume payload redriveOfDlqId');
  const redriveReference = requireText(payload?.redriveReference, 'resume payload redriveReference');
  const expectedPrefix = `redrive:${TIKTOK_PRODUCTION_RESUME.parentDlqId}:`;
  if (!redriveReference.startsWith(expectedPrefix)) {
    throw contractError('Resume payload redriveReference does not preserve the b86 parent lineage', 'TIKTOK_PRODUCTION_RESUME_LINEAGE_MISMATCH', {
      expectedPrefix,
      redriveReference,
    });
  }

  if (TIKTOK_PRODUCTION_RESUME.resumeCreatedAt <= TIKTOK_PRODUCTION_RESUME.rootRedriveRequestedAt) {
    throw contractError('Resume DLQ must be newer than the immutable root generation', 'TIKTOK_PRODUCTION_RESUME_LINEAGE_MISMATCH', {
      resumeCreatedAt: TIKTOK_PRODUCTION_RESUME.resumeCreatedAt,
      rootRedriveRequestedAt: TIKTOK_PRODUCTION_RESUME.rootRedriveRequestedAt,
    });
  }

  return Object.freeze({
    row: Object.freeze({ ...row }),
    payload: Object.freeze({ ...payload }),
    dlqId: TIKTOK_PRODUCTION_RESUME.resumeDlqId,
  });
}

export function buildResumeRedriveEnvelope() {
  return buildRedriveEnvelope(TIKTOK_PRODUCTION_RESUME.resumeDlqId);
}

export function buildResumeIdempotencyEnvelope(resumePayload, requestedAt = Date.now()) {
  return buildIdempotencyEnvelope(resumePayload, requestedAt);
}

export function validateResumeSuccessRun(row, options = {}) {
  if (row?.sync_run_id === TIKTOK_PRODUCTION_RESUME.staleRunId) {
    throw contractError('Stale pre-resume running row cannot prove recovery success', 'TIKTOK_PRODUCTION_RESUME_STALE_RUN_REJECTED', {
      syncRunId: row?.sync_run_id ?? null,
    });
  }
  return validateSuccessfulSyncRun(row, options);
}

function parsePayload(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch (cause) {
      throw contractError('Resume dead-letter payload is not valid JSON', 'TIKTOK_PRODUCTION_RESUME_PAYLOAD_INVALID', {
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw contractError('Resume dead-letter payload must be an object', 'TIKTOK_PRODUCTION_RESUME_PAYLOAD_INVALID');
  }
  const payload = parsed.body && typeof parsed.body === 'object' && !Array.isArray(parsed.body)
    ? parsed.body
    : parsed;
  return { ...payload };
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw contractError(`${label} mismatch`, 'TIKTOK_PRODUCTION_RESUME_CONTRACT_MISMATCH', {
      label,
      expected,
      actual,
    });
  }
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw contractError(`${fieldName} is required`, 'TIKTOK_PRODUCTION_RESUME_CONTRACT_MISMATCH', {
      fieldName,
      value,
    });
  }
  return value.trim();
}

function contractError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'TikTokProductionUatResumeContractError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
