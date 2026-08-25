import { JOB_TYPES } from '../../../packages/application/src/jobs/job-catalog.js';
import { loadCustomerRuntimeConfig } from '../../../packages/config/src/customer-profiles.js';
import { permanentError } from '../../../packages/shared/src/errors/runtime-error.js';
import { readBoolean } from './worker-runtime-support.js';

export const DEFAULT_QUEUE_AUTO_RECOVERY_MAX_ATTEMPTS = 5;
export const DEFAULT_QUEUE_AUTO_RECOVERY_COOLDOWN_SECONDS = 120;

const MAX_QUEUE_AUTO_RECOVERY_ATTEMPTS = 10;
const MAX_QUEUE_AUTO_RECOVERY_COOLDOWN_SECONDS = 43_200;
const PROTECTED_DLQ_IDS = new Set([
  'terminal:eafd8e43f1ae5113d12905301496fd4e',
]);
const AUTO_RECOVERY_JOB_TYPES = new Set([
  JOB_TYPES.TIKTOK_CREATOR_NATIVE_SYNC,
  JOB_TYPES.FACEBOOK_ORGANIC_SYNC,
  JOB_TYPES.INSTAGRAM_ORGANIC_SYNC,
  JOB_TYPES.META_ADS_SYNC,
  JOB_TYPES.GOOGLE_ADS_MANAGER_SIGNED_DELIVERY_PROCESS,
  JOB_TYPES.YOUTUBE_ORGANIC_SYNC,
  JOB_TYPES.WOOCOMMERCE_COMMERCE_SYNC,
  JOB_TYPES.CHATWOOT_CONVERSATIONS_SYNC,
]);

/**
 * Customer Production self-heal is deliberately narrower than generic DLQ redrive. It reuses the
 * exact stable operation identity and same-generation checkpoint only for retry exhaustion.
 */
export function resolveQueueAutoRecoveryPolicy(input = {}) {
  if (!readBoolean(input.env?.MKT_QUEUE_AUTO_RECOVERY_ENABLED, false)) {
    return Object.freeze({ eligible: false, reason: 'disabled' });
  }
  const runtime = loadCustomerRuntimeConfig(input.env);
  const exactCustomerProduction = runtime.environment === 'production'
    && runtime.profileKey === 'chemistry_k'
    && runtime.customerKey === 'chemistry_k'
    && runtime.infrastructureOwner === 'customer';
  if (!exactCustomerProduction) {
    return Object.freeze({ eligible: false, reason: 'runtime_not_allowed' });
  }
  if (PROTECTED_DLQ_IDS.has(input.dlqId)) {
    return Object.freeze({ eligible: false, reason: 'protected_incident' });
  }
  if (!AUTO_RECOVERY_JOB_TYPES.has(input.job?.body?.type)) {
    return Object.freeze({ eligible: false, reason: 'job_type_not_allowed' });
  }
  if (input.operation?.stable !== true
    || !input.operation.operationId
    || !input.operation.workKey
    || !Number.isSafeInteger(input.operation.generation)
    || input.operation.generation !== input.operation.originalRequestedAt) {
    return Object.freeze({ eligible: false, reason: 'unstable_identity' });
  }
  const maxRecoveries = readBoundedPositiveInteger(
    input.env?.MKT_QUEUE_AUTO_RECOVERY_MAX_ATTEMPTS,
    DEFAULT_QUEUE_AUTO_RECOVERY_MAX_ATTEMPTS,
    MAX_QUEUE_AUTO_RECOVERY_ATTEMPTS,
    'MKT_QUEUE_AUTO_RECOVERY_MAX_ATTEMPTS',
  );
  const cooldownSeconds = readBoundedPositiveInteger(
    input.env?.MKT_QUEUE_AUTO_RECOVERY_COOLDOWN_SECONDS,
    DEFAULT_QUEUE_AUTO_RECOVERY_COOLDOWN_SECONDS,
    MAX_QUEUE_AUTO_RECOVERY_COOLDOWN_SECONDS,
    'MKT_QUEUE_AUTO_RECOVERY_COOLDOWN_SECONDS',
  );
  return Object.freeze({
    eligible: true,
    maxRecoveries,
    cooldownSeconds,
    recoveryReference: `auto-recovery:${input.dlqId}`,
  });
}

export async function attemptQueueAutoRecovery(input = {}) {
  const policy = resolveQueueAutoRecoveryPolicy(input);
  if (!policy.eligible) return policy;
  const store = requireAutoRecoveryStore(input.queueOperationStore);
  const queue = requireQueue(input.env?.MKT_SYNC_QUEUE);
  const authorization = await store.authorizeSafeAutoRecovery({
    dlqId: input.dlqId,
    operationId: input.operation.operationId,
    workKey: input.operation.workKey,
    generation: input.operation.generation,
    originalRequestedAt: input.operation.originalRequestedAt,
    jobType: input.job.body.type,
    recoveryReference: policy.recoveryReference,
    maxRecoveries: policy.maxRecoveries,
    cooldownSeconds: policy.cooldownSeconds,
  });
  if (!authorization.sendRequired) return Object.freeze({ ...policy, ...authorization });

  await queue.send(input.job.body, { delaySeconds: authorization.delaySeconds });
  await store.markSafeAutoRecoveryQueued({
    dlqId: input.dlqId,
    operationId: input.operation.operationId,
    workKey: input.operation.workKey,
    recoveryReference: policy.recoveryReference,
  });
  return Object.freeze({ ...policy, ...authorization, queued: true });
}

function readBoundedPositiveInteger(value, fallback, maximum, fieldName) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) {
    throw permanentError(`${fieldName} must be an integer between 1 and ${maximum}`, {
      code: 'MKT_QUEUE_AUTO_RECOVERY_CONFIG_INVALID',
      details: { fieldName },
    });
  }
  return number;
}

function requireAutoRecoveryStore(value) {
  if (typeof value?.authorizeSafeAutoRecovery !== 'function'
    || typeof value?.markSafeAutoRecoveryQueued !== 'function') {
    throw new TypeError('Queue auto-recovery requires a durable Queue operation store');
  }
  return value;
}

function requireQueue(value) {
  if (typeof value?.send !== 'function') {
    throw permanentError('Queue auto-recovery binding is unavailable', {
      code: 'MKT_QUEUE_AUTO_RECOVERY_BINDING_MISSING',
    });
  }
  return value;
}
