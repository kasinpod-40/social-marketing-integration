import { validateGoogleAdsQueueReference } from '../google-ads/google-ads-queue-reference.js';
import { JOB_TYPES } from '../jobs/job-catalog.js';
import { normalizeQueueJobMessage } from '../jobs/queue-job.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const SUPPORTED_REDRIVE_JOB_TYPES = new Set([
  JOB_TYPES.YOUTUBE_ORGANIC_SYNC,
  JOB_TYPES.GOOGLE_ADS_MANAGER_SIGNED_DELIVERY_PROCESS,
]);
const FORBIDDEN_REDRIVE_JOB_TYPES = Object.freeze(
  Object.values(JOB_TYPES).filter((type) => !SUPPORTED_REDRIVE_JOB_TYPES.has(type)),
);

/**
 * Redrive Dead-letter แบบ Idempotent:
 * - D1 จอง requestedAt/redriveReference ก่อน Queue send
 * - YouTube ใช้ generation ใหม่ตาม Contract เดิม
 * - Google Ads ส่ง exact original reference และ revive same-generation durable Work แบบควบคุม
 * - Retry หลัง send/mark ล้มส่ง duplicate ที่ consumer fence ด้วย stable operation identity
 */
export async function redriveDeadLetterJob(input = {}) {
  const store = requireStore(input.store);
  const queue = requireQueue(input.queue);
  const dlqId = requireText(input.dlqId, 'dlqId');
  const now = typeof input.now === 'function' ? input.now : () => Date.now();
  const candidate = await store.readDeadLetterRedriveCandidate({ dlqId });
  if (candidate.status === 'redriven') {
    return alreadyRedrivenResult({ dlqId, candidate });
  }

  // ตรวจ Payload แบบ Read-only ก่อนจองสถานะ เพื่อไม่ทิ้ง Poison/unsupported command เป็น redrive_pending.
  const candidateOriginal = requireObject(candidate.payload, 'deadLetter.payload');
  assertSupportedRedriveTarget(candidateOriginal, dlqId);
  const candidateRequestedAt = candidate.redriveRequestedAt
    ?? safeTimestamp(now(), 'requestedAt');
  const candidateReference = requireText(
    candidate.redriveReference
      ?? input.redriveReference
      ?? `redrive:${dlqId}:${candidateRequestedAt}`,
    'redriveReference',
  );
  const candidateBody = createRedriveBody({
    original: candidateOriginal,
    schemaVersion: candidate.schemaVersion,
    requestedAt: candidateRequestedAt,
    dlqId,
    redriveReference: candidateReference,
  });
  validateRedriveBody(candidateBody, candidateOriginal.type, candidateRequestedAt, candidateReference);

  const prepared = await store.prepareDeadLetterRedrive({
    dlqId,
    requestedAt: candidateRequestedAt,
    redriveReference: candidateReference,
    forbiddenJobTypes: FORBIDDEN_REDRIVE_JOB_TYPES,
  });
  if (prepared.status === 'redriven') {
    return alreadyRedrivenResult({ dlqId, candidate: prepared });
  }

  const original = requireObject(prepared.payload, 'deadLetter.payload');
  assertSupportedRedriveTarget(original, dlqId);
  const redriveRequestedAt = safeTimestamp(prepared.redriveRequestedAt, 'redriveRequestedAt');
  const body = createRedriveBody({
    original,
    schemaVersion: prepared.schemaVersion,
    requestedAt: redriveRequestedAt,
    dlqId,
    redriveReference: prepared.redriveReference,
  });
  validateRedriveBody(body, original.type, redriveRequestedAt, prepared.redriveReference);

  let sent = false;
  if (original.type === JOB_TYPES.GOOGLE_ADS_MANAGER_SIGNED_DELIVERY_PROCESS) {
    const reference = validateGoogleAdsQueueReference(body);
    const googleAdsRedriveStore = requireGoogleAdsRedriveStore(input.googleAdsRedriveStore);
    const redriveState = await googleAdsRedriveStore.prepare({
      operationId: reference.operationId,
      workKey: reference.workKey,
      generation: reference.generation,
      originalRequestedAt: reference.originalRequestedAt,
      auditReference: prepared.redriveReference,
      now: safeTimestamp(now(), 'googleAdsRedriveAt'),
    });
    if (!['completed', 'already_queued'].includes(redriveState.disposition)) {
      await queue.send(body);
      sent = true;
      await googleAdsRedriveStore.markQueued({
        operationId: reference.operationId,
        now: safeTimestamp(now(), 'googleAdsQueuedAt'),
      });
    }
  } else {
    await queue.send(body);
    sent = true;
  }

  await store.markDeadLetterRedriven({
    dlqId,
    redrivenAt: safeTimestamp(now(), 'redrivenAt'),
  });

  return Object.freeze({
    status: 'redriven',
    dlqId,
    requestedAt: body.requestedAt,
    redriveReference: prepared.redriveReference,
    jobType: body.type,
    queueSend: sent ? 'sent' : 'already_admitted',
  });
}

function assertSupportedRedriveTarget(payload, dlqId) {
  if (payload.type === JOB_TYPES.DEAD_LETTER_REDRIVE) {
    throw permanentError('A dead-letter redrive command cannot redrive itself', {
      code: 'DEAD_LETTER_REDRIVE_RECURSION_BLOCKED',
      details: { dlqId },
    });
  }
  if (!SUPPORTED_REDRIVE_JOB_TYPES.has(payload.type)) {
    throw permanentError('Dead-letter redrive is not supported for this job type', {
      code: 'DEAD_LETTER_REDRIVE_JOB_TYPE_UNSUPPORTED',
      details: { dlqId, jobType: payload.type ?? null },
    });
  }
}

function createRedriveBody(input) {
  if (input.original.type === JOB_TYPES.GOOGLE_ADS_MANAGER_SIGNED_DELIVERY_PROCESS) {
    // Exact-schema Queue reference ห้ามเติม redrive metadata หรือเปลี่ยน requestedAt/generation.
    return Object.freeze({ ...input.original });
  }
  return Object.freeze({
    ...input.original,
    schemaVersion: input.schemaVersion ?? input.original.schemaVersion ?? 1,
    requestedAt: new Date(input.requestedAt).toISOString(),
    redriveOfDlqId: input.dlqId,
    redriveReference: input.redriveReference,
  });
}

function validateRedriveBody(body, jobType, requestedAt, messageId) {
  if (jobType === JOB_TYPES.GOOGLE_ADS_MANAGER_SIGNED_DELIVERY_PROCESS) {
    validateGoogleAdsQueueReference(body);
  }
  normalizeQueueJobMessage(
    { id: messageId, body },
    new Date(requestedAt),
  );
}

function alreadyRedrivenResult({ dlqId, candidate }) {
  return Object.freeze({
    status: 'already_redriven',
    dlqId,
    requestedAt: new Date(safeTimestamp(candidate.redriveRequestedAt, 'redriveRequestedAt')).toISOString(),
    redriveReference: requireText(candidate.redriveReference, 'redriveReference'),
  });
}

function requireStore(value) {
  if (typeof value?.readDeadLetterRedriveCandidate !== 'function'
    || typeof value?.prepareDeadLetterRedrive !== 'function'
    || typeof value?.markDeadLetterRedriven !== 'function') {
    throw new TypeError('redriveDeadLetterJob requires a durable redrive store');
  }
  return value;
}

function requireGoogleAdsRedriveStore(value) {
  if (typeof value?.prepare !== 'function' || typeof value?.markQueued !== 'function') {
    throw new TypeError('Google Ads redrive requires googleAdsRedriveStore prepare/markQueued');
  }
  return value;
}

function requireQueue(value) {
  if (typeof value?.send !== 'function') {
    throw new TypeError('redriveDeadLetterJob requires queue.send');
  }
  return value;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return { ...value };
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${fieldName} is required`);
  }
  return value.trim();
}

function safeTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${fieldName} must be a non-negative safe integer`);
  }
  return number;
}
