import { JOB_TYPES } from './job-catalog.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const STABLE_OPERATION_JOB_TYPES = new Set([
  JOB_TYPES.TIKTOK_CREATOR_NATIVE_HISTORY_BOOTSTRAP,
  JOB_TYPES.TIKTOK_CREATOR_NATIVE_HISTORY_RECOVER,
]);

/**
 * Resolve durable Queue identity independently from Cloudflare delivery message.id.
 * Bootstrap/recovery jobs fail closed unless operationId/workKey/generation/requestedAt are stable.
 */
export function resolveQueueOperation(input = {}) {
  const body = input.job?.body ?? {};
  const type = optionalText(body.type);
  const requestedAt = normalizeTimestamp(
    body.originalRequestedAt ?? body.requestedAt ?? input.job?.requestedAt,
    'originalRequestedAt',
    STABLE_OPERATION_JOB_TYPES.has(type),
  );
  const generation = normalizeTimestamp(
    body.generation ?? requestedAt,
    'generation',
    STABLE_OPERATION_JOB_TYPES.has(type),
  );
  const operationId = optionalText(body.operationId);
  const explicitWorkKey = optionalText(body.workKey);

  if (STABLE_OPERATION_JOB_TYPES.has(type)) {
    const stableOperationId = requireText(operationId, 'operationId');
    const derivedWorkKey = `tiktok:${stableOperationId}`;
    if (explicitWorkKey && explicitWorkKey !== derivedWorkKey) {
      throw permanentError('Queue workKey does not match stable operationId', {
        code: 'QUEUE_OPERATION_IDENTITY_MISMATCH',
        details: { type, workKey: explicitWorkKey },
      });
    }
    if (generation !== requestedAt) {
      throw permanentError('TikTok bootstrap generation must equal original requestedAt', {
        code: 'QUEUE_OPERATION_GENERATION_MISMATCH',
        details: { type, generation, originalRequestedAt: requestedAt },
      });
    }
    return Object.freeze({
      operationId: stableOperationId,
      workKey: derivedWorkKey,
      generation,
      originalRequestedAt: requestedAt,
      stable: true,
    });
  }

  const fallbackMessageId = optionalText(input.message?.id);
  return Object.freeze({
    operationId,
    workKey: explicitWorkKey ?? (fallbackMessageId && type
      ? `${platformFromJobType(type)}:${fallbackMessageId}`
      : null),
    generation,
    originalRequestedAt: requestedAt,
    stable: Boolean(operationId && explicitWorkKey),
  });
}

/** Preserve the exact durable identity in continuation, redrive and manual recovery payloads. */
export function withQueueOperation(body = {}, operation = {}) {
  const operationId = requireText(operation.operationId, 'operation.operationId');
  const workKey = requireText(operation.workKey, 'operation.workKey');
  const generation = normalizeTimestamp(operation.generation, 'operation.generation', true);
  const originalRequestedAt = normalizeTimestamp(
    operation.originalRequestedAt,
    'operation.originalRequestedAt',
    true,
  );
  if (workKey !== `tiktok:${operationId}` || generation !== originalRequestedAt) {
    throw permanentError('Cannot serialize an inconsistent durable Queue operation', {
      code: 'QUEUE_OPERATION_IDENTITY_MISMATCH',
    });
  }
  return Object.freeze({
    ...body,
    operationId,
    workKey,
    generation,
    originalRequestedAt,
    requestedAt: new Date(originalRequestedAt).toISOString(),
  });
}

export function isStableOperationJobType(type) {
  return STABLE_OPERATION_JOB_TYPES.has(type);
}

function normalizeTimestamp(value, fieldName, required) {
  if (value === null || value === undefined || value === '') {
    if (!required) return null;
    throw invalidTimestamp(fieldName, value);
  }
  const number = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isSafeInteger(number) || number < Date.UTC(2000, 0, 1)) {
    throw invalidTimestamp(fieldName, value);
  }
  return number;
}

function invalidTimestamp(fieldName, value) {
  return permanentError(`Queue operation requires valid ${fieldName}`, {
    code: 'QUEUE_OPERATION_IDENTITY_INVALID',
    details: { fieldName, value: value ?? null },
  });
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw permanentError(`Queue operation requires ${fieldName}`, {
      code: 'QUEUE_OPERATION_IDENTITY_INVALID',
      details: { fieldName },
    });
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function platformFromJobType(type) {
  if (typeof type !== 'string') return 'system';
  if (type.startsWith('report.')) return 'tiktok';
  const prefix = type.split('.')[0];
  return new Set(['facebook', 'instagram', 'tiktok', 'youtube']).has(prefix)
    ? prefix
    : 'system';
}
