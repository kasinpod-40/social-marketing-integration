import { JOB_TYPES } from '../jobs/job-catalog.js';
import { normalizeQueueJobMessage } from '../jobs/queue-job.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

/**
 * Redrive Dead-letter แบบ Idempotent:
 * - D1 จอง requestedAt/redriveReference ก่อน Queue send
 * - Retry หลัง send/mark ล้มใช้ generation เดิม
 * - Queue duplicate ที่ได้ message.id ต่างกันจึงถูก generation fence กันไม่ให้ทำ Business write ซ้ำ
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

  // ตรวจ Payload แบบ Read-only ก่อนจองสถานะ เพื่อไม่ทิ้ง Poison/recursive command เป็น redrive_pending.
  const candidateOriginal = requireObject(candidate.payload, 'deadLetter.payload');
  assertNotRecursiveRedrive(candidateOriginal, dlqId);
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
  normalizeQueueJobMessage(
    { id: candidateReference, body: candidateBody },
    new Date(candidateRequestedAt),
  );

  const prepared = await store.prepareDeadLetterRedrive({
    dlqId,
    requestedAt: candidateRequestedAt,
    redriveReference: candidateReference,
    // Store rechecks this before UPDATE as defense-in-depth against concurrent row changes.
    forbiddenJobTypes: [JOB_TYPES.DEAD_LETTER_REDRIVE],
  });
  if (prepared.status === 'redriven') {
    return alreadyRedrivenResult({ dlqId, candidate: prepared });
  }

  const original = requireObject(prepared.payload, 'deadLetter.payload');
  assertNotRecursiveRedrive(original, dlqId);
  const redriveRequestedAt = safeTimestamp(prepared.redriveRequestedAt, 'redriveRequestedAt');
  const body = createRedriveBody({
    original,
    schemaVersion: prepared.schemaVersion,
    requestedAt: redriveRequestedAt,
    dlqId,
    redriveReference: prepared.redriveReference,
  });

  // Validate ก่อนส่ง Queue เพื่อไม่เปลี่ยน Dead-letter เป็น Poison message รอบใหม่.
  normalizeQueueJobMessage({ id: prepared.redriveReference, body }, new Date(redriveRequestedAt));
  await queue.send(body);
  await store.markDeadLetterRedriven({ dlqId, redrivenAt: safeTimestamp(now(), 'redrivenAt') });

  return Object.freeze({
    status: 'redriven',
    dlqId,
    requestedAt: body.requestedAt,
    redriveReference: prepared.redriveReference,
    jobType: body.type,
  });
}

function assertNotRecursiveRedrive(payload, dlqId) {
  if (payload.type === JOB_TYPES.DEAD_LETTER_REDRIVE) {
    throw permanentError('A dead-letter redrive command cannot redrive itself', {
      code: 'DEAD_LETTER_REDRIVE_RECURSION_BLOCKED',
      details: { dlqId },
    });
  }
}

function createRedriveBody(input) {
  return Object.freeze({
    ...input.original,
    schemaVersion: input.schemaVersion ?? input.original.schemaVersion ?? 1,
    requestedAt: new Date(input.requestedAt).toISOString(),
    redriveOfDlqId: input.dlqId,
    redriveReference: input.redriveReference,
  });
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
