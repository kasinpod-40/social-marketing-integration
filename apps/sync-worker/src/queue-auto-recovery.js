import { JOB_TYPES } from '../../../packages/application/src/jobs/job-catalog.js';
import { loadCustomerRuntimeConfig } from '../../../packages/config/src/customer-profiles.js';
import { isMetaAdsDeferredServiceFailure } from '../../../packages/connectors/src/meta/meta-graph.client.js';
import { permanentError } from '../../../packages/shared/src/errors/runtime-error.js';
import { readAttempts, readBoolean } from './worker-runtime-support.js';

export const DEFAULT_QUEUE_AUTO_RECOVERY_MAX_ATTEMPTS = 5;
export const DEFAULT_QUEUE_AUTO_RECOVERY_COOLDOWN_SECONDS = 120;

const MAX_QUEUE_AUTO_RECOVERY_ATTEMPTS = 10;
const MAX_QUEUE_AUTO_RECOVERY_COOLDOWN_SECONDS = 43_200;
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const META_RETRY_AFTER_LOCAL_HOUR = 10;
const META_RETRY_MIN_SECONDS = 60 * 60;
const META_RETRY_BUSY_SECONDS = 30 * 60;
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

/** Keep this separate from generic DLQ recovery: only the observed scheduled Ads provider failure qualifies. */
export function resolveDeferredMetaRetryPolicy(input = {}) {
  if (!readBoolean(input.env?.MKT_META_DEFERRED_RETRY_ENABLED, false)) {
    return Object.freeze({ eligible: false, reason: 'disabled' });
  }
  if (input.job?.body?.type !== JOB_TYPES.META_ADS_SYNC
    || input.job.body.trigger !== 'scheduled'
    || input.operation?.stable !== true
    || !Number.isSafeInteger(input.operation.originalRequestedAt)
    || input.operation.originalRequestedAt !== input.operation.generation) {
    return Object.freeze({ eligible: false, reason: 'job_not_allowed' });
  }
  if (!isExactCustomerProduction(input.env)) {
    return Object.freeze({ eligible: false, reason: 'runtime_not_allowed' });
  }
  if (input.error && (input.error.code !== 'META_TRANSIENT_API_ERROR'
    || !isMetaAdsDeferredServiceFailure(input.error, input.error?.details?.operation))) {
    return Object.freeze({ eligible: false, reason: 'error_not_allowed' });
  }
  const localDayStart = Math.floor(
    (input.operation.originalRequestedAt + BANGKOK_OFFSET_MS) / DAY_MS,
  ) * DAY_MS - BANGKOK_OFFSET_MS;
  return Object.freeze({
    eligible: true,
    localDayStart,
    localDayEnd: localDayStart + DAY_MS,
    notBefore: localDayStart + META_RETRY_AFTER_LOCAL_HOUR * 60 * 60 * 1000,
  });
}

/** A retry delivery waits for the daily schedule cutoff and all other same-day durable Work. */
export async function checkDeferredMetaRetry(input = {}) {
  const policy = resolveDeferredMetaRetryPolicy(input);
  if (!policy.eligible || readAttempts(input.message) < 2) return Object.freeze({ ...policy, delaySeconds: 0 });
  const now = Number(input.now ?? Date.now());
  if (now < policy.notBefore) {
    return Object.freeze({ ...policy, reason: 'schedule_pending', delaySeconds: Math.min(
      43_200,
      Math.ceil((policy.notBefore - now) / 1000),
    ) });
  }
  const db = input.env?.MKT_STATE_DB;
  if (typeof db?.prepare !== 'function') {
    return Object.freeze({ ...policy, reason: 'state_unavailable', delaySeconds: META_RETRY_BUSY_SECONDS });
  }
  let row;
  try {
    row = await db.prepare(`
      SELECT COUNT(*) AS active_count
      FROM sync_work_runs
      WHERE requested_at >= ? AND requested_at < ?
        AND lifecycle_status = 'active'
        AND work_type <> ?
    `).bind(policy.localDayStart, policy.localDayEnd, JOB_TYPES.META_ADS_SYNC).first();
  } catch {
    return Object.freeze({ ...policy, reason: 'state_unavailable', delaySeconds: META_RETRY_BUSY_SECONDS });
  }
  const activeCount = Number(row?.active_count);
  if (!Number.isSafeInteger(activeCount) || activeCount < 0) {
    return Object.freeze({ ...policy, reason: 'state_unavailable', delaySeconds: META_RETRY_BUSY_SECONDS });
  }
  return Object.freeze({
    ...policy,
    reason: activeCount > 0 ? 'other_channel_active' : 'ready',
    activeCount,
    delaySeconds: activeCount > 0 ? META_RETRY_BUSY_SECONDS : 0,
  });
}

export function readDeferredMetaFailureDelaySeconds(input = {}) {
  const policy = resolveDeferredMetaRetryPolicy(input);
  if (!policy.eligible) return null;
  const now = Number(input.now ?? Date.now());
  return Math.min(43_200, Math.max(
    META_RETRY_MIN_SECONDS,
    Math.ceil((policy.notBefore - now) / 1000),
  ));
}

/**
 * Customer Production self-heal is deliberately narrower than generic DLQ redrive. It reuses the
 * exact stable operation identity and same-generation checkpoint only for retry exhaustion.
 */
export function resolveQueueAutoRecoveryPolicy(input = {}) {
  if (!readBoolean(input.env?.MKT_QUEUE_AUTO_RECOVERY_ENABLED, false)) {
    return Object.freeze({ eligible: false, reason: 'disabled' });
  }
  if (!isExactCustomerProduction(input.env)) {
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

function isExactCustomerProduction(env) {
  const runtime = loadCustomerRuntimeConfig(env);
  return runtime.environment === 'production'
    && runtime.profileKey === 'chemistry_k'
    && runtime.customerKey === 'chemistry_k'
    && runtime.infrastructureOwner === 'customer';
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
