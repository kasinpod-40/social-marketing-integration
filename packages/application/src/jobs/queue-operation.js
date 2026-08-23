import { JOB_TRIGGERS, JOB_TYPES } from './job-catalog.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const SAFE_OPERATION_ID = /^[a-z0-9][a-z0-9_-]{0,95}$/u;

const STABLE_OPERATION_CONTRACTS = new Map([
  [JOB_TYPES.TIKTOK_CREATOR_NATIVE_HISTORY_BOOTSTRAP, Object.freeze({ prefix: 'tiktok' })],
  [JOB_TYPES.TIKTOK_CREATOR_NATIVE_HISTORY_RECOVER, Object.freeze({ prefix: 'tiktok' })],
  [JOB_TYPES.GOOGLE_ADS_MANAGER_SIGNED_DELIVERY_PROCESS, Object.freeze({ prefix: 'google_ads' })],
  [JOB_TYPES.FACEBOOK_ORGANIC_SYNC, Object.freeze({ prefix: 'facebook' })],
  [JOB_TYPES.INSTAGRAM_ORGANIC_SYNC, Object.freeze({ prefix: 'instagram' })],
  [JOB_TYPES.META_ADS_SYNC, Object.freeze({
    prefix: 'meta_ads',
    scopeField: 'sourceAccountKey',
  })],
  [JOB_TYPES.WOOCOMMERCE_COMMERCE_SYNC, Object.freeze({ prefix: 'woocommerce' })],
  [JOB_TYPES.CHATWOOT_CONVERSATIONS_SYNC, Object.freeze({
    prefix: 'chatwoot',
    scopeField: 'accountKey',
  })],
  [JOB_TYPES.LARK_NOTIFICATION_SEND, Object.freeze({
    prefix: 'lark_notification',
    operationIdPattern: SAFE_OPERATION_ID,
  })],
  [JOB_TYPES.MKT_CONTENT_DAILY_RETENTION, Object.freeze({ prefix: 'mkt_content_daily' })],
]);

function resolveStableOperationContract(type, body) {
  if (type === JOB_TYPES.TIKTOK_CREATOR_NATIVE_SYNC
    && body?.trigger === JOB_TRIGGERS.PRODUCTION_CONNECTOR_UAT) {
    return Object.freeze({ prefix: 'tiktok' });
  }
  if (type === JOB_TYPES.REPORT_MATERIALIZATION_GENERATE
    && body?.trigger === JOB_TRIGGERS.DASHBOARD_SCHEDULED) {
    return Object.freeze({ prefix: 'report' });
  }
  if (type === JOB_TYPES.TIKTOK_CREATOR_NATIVE_SYNC
    && body?.trigger === JOB_TRIGGERS.TIKTOK_POST_LARK_WATERMARK) {
    return Object.freeze({ prefix: 'tiktok' });
  }
  if (type === JOB_TYPES.YOUTUBE_ORGANIC_SYNC
    && body?.trigger === JOB_TRIGGERS.YOUTUBE_WORKER_DRY_RUN
    && body?.dryRun === true) {
    return Object.freeze({
      prefix: 'youtube',
      operationIdPattern: SAFE_OPERATION_ID,
    });
  }
  if (type === JOB_TYPES.YOUTUBE_ORGANIC_SYNC
    && body?.trigger === JOB_TRIGGERS.YOUTUBE_LARK_FULL_SYNC_UAT
    && body?.dryRun === false
    && body?.syncMode === 'full'
    && body?.analyticsEnabled === false) {
    return Object.freeze({
      prefix: 'youtube',
      operationIdPattern: SAFE_OPERATION_ID,
    });
  }
  return STABLE_OPERATION_CONTRACTS.get(type) ?? null;
}

/**
 * Resolve durable Queue identity independently from Cloudflare delivery message.id.
 * Every stable-operation job fails closed unless operationId/workKey/generation/requestedAt agree.
 */
export function resolveQueueOperation(input = {}) {
  const body = input.job?.body ?? {};
  const type = optionalText(body.type);
  const contract = resolveStableOperationContract(type, body);
  const requestedAt = normalizeTimestamp(
    body.originalRequestedAt ?? body.requestedAt ?? input.job?.requestedAt,
    'originalRequestedAt',
    Boolean(contract),
  );
  const generation = normalizeTimestamp(
    body.generation ?? requestedAt,
    'generation',
    Boolean(contract),
  );
  const operationId = optionalText(body.operationId);
  const explicitWorkKey = optionalText(body.workKey);

  if (contract) {
    const stableOperationId = normalizeOperationId(operationId, contract);
    const derivedWorkKey = buildStableWorkKey(contract, body, stableOperationId);
    if (explicitWorkKey && explicitWorkKey !== derivedWorkKey) {
      throw permanentError('Queue workKey does not match stable operationId', {
        code: 'QUEUE_OPERATION_IDENTITY_MISMATCH',
        details: { type, workKey: explicitWorkKey },
      });
    }
    if (generation !== requestedAt) {
      throw permanentError('Stable Queue generation must equal original requestedAt', {
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

/**
 * สร้าง Stable fields จาก Intent กลางครั้งเดียวสำหรับ Producer/Operator
 * เพื่อไม่ให้ Caller ประกอบ workKey/generation/requestedAt ซ้ำหรือผูกกับ delivery message.id.
 */
export function createStableQueueOperationBody(body = {}, input = {}) {
  const type = requireText(body.type, 'body.type');
  const contract = resolveStableOperationContract(type, body);
  if (!contract) {
    throw permanentError('Cannot create an unsupported stable Queue operation', {
      code: 'QUEUE_OPERATION_IDENTITY_INVALID',
      details: { type },
    });
  }
  const operationId = normalizeOperationId(input.operationId, contract);
  const originalRequestedAt = normalizeTimestamp(
    input.originalRequestedAt ?? input.requestedAt,
    'originalRequestedAt',
    true,
  );
  return withQueueOperation(body, {
    operationId,
    workKey: buildStableWorkKey(contract, body, operationId),
    generation: originalRequestedAt,
    originalRequestedAt,
  });
}

/** Preserve the exact durable identity in continuation, redrive and manual recovery payloads. */
export function withQueueOperation(body = {}, operation = {}) {
  const type = requireText(body.type, 'body.type');
  const contract = resolveStableOperationContract(type, body);
  if (!contract) {
    throw permanentError('Cannot serialize an unsupported stable Queue operation', {
      code: 'QUEUE_OPERATION_IDENTITY_INVALID',
      details: { type },
    });
  }
  const operationId = normalizeOperationId(operation.operationId, contract);
  const workKey = requireText(operation.workKey, 'operation.workKey');
  const generation = normalizeTimestamp(operation.generation, 'operation.generation', true);
  const originalRequestedAt = normalizeTimestamp(
    operation.originalRequestedAt,
    'operation.originalRequestedAt',
    true,
  );
  if (workKey !== buildStableWorkKey(contract, body, operationId)
    || generation !== originalRequestedAt) {
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

export function isStableOperationJobType(type, body = {}) {
  return Boolean(resolveStableOperationContract(type, body));
}

function buildStableWorkKey(contract, body, operationId) {
  const scope = contract.scopeField
    ? normalizeOperationScope(body?.[contract.scopeField], contract.scopeField)
    : null;
  return [contract.prefix, scope, operationId].filter(Boolean).join(':');
}

function normalizeOperationId(value, contract) {
  const source = requireText(value, 'operationId');
  if (!contract.operationIdPattern) return source;
  const operationId = source.toLowerCase();
  if (!contract.operationIdPattern.test(operationId)) {
    throw permanentError('Queue operationId has an unsafe format', {
      code: 'QUEUE_OPERATION_IDENTITY_INVALID',
      details: { fieldName: 'operationId' },
    });
  }
  return operationId;
}

function normalizeOperationScope(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(text)) {
    throw permanentError(`Queue operation requires valid ${fieldName}`, {
      code: 'QUEUE_OPERATION_SCOPE_INVALID',
      details: { fieldName },
    });
  }
  return text;
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
  if (type.startsWith('google.ads.')) return 'google_ads';
  if (type.startsWith('meta.ads.')) return 'meta_ads';
  const prefix = type.split('.')[0];
  return new Set(['facebook', 'instagram', 'tiktok', 'youtube', 'woocommerce', 'chatwoot']).has(prefix)
    ? prefix
    : 'system';
}
