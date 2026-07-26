import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { transientError } from '../../../shared/src/errors/runtime-error.js';

/** Claim one stable watermark and enqueue exactly one logical TikTok sync operation. */
export async function admitTikTokPostLarkSource(input = {}) {
  const settled = requireSettledProbe(input.settledProbe);
  if (!settled.settled) {
    return Object.freeze({
      status: 'skipped',
      reason: settled.reason,
      sourceWatermark: settled.second.sourceWatermark,
    });
  }
  const store = requireStore(input.store);
  const queue = requireQueue(input.queue);
  const fingerprint = typeof input.fingerprint === 'function'
    ? input.fingerprint
    : createStableFingerprint;
  const requestedAt = safeTimestamp(input.requestedAt ?? Date.now(), 'requestedAt');
  const identityDigest = await fingerprint({
    contract: 'tiktok-post-lark-admission-v1',
    customerProfile: requireText(input.customerProfile, 'customerProfile'),
    customerKey: requireText(input.customerKey, 'customerKey'),
    accountKey: requireText(input.accountKey, 'accountKey'),
    sourceWatermark: settled.second.sourceWatermark,
    metricDate: requireDate(input.metricDate, 'metricDate'),
  });
  const admissionKey = `tiktok-admission:${identityDigest}`;
  const operationId = `watermark:${identityDigest}`;
  const workKey = `tiktok:${operationId}`;
  const existing = await store.readAdmission(admissionKey);
  const claim = existing
    ? Object.freeze({ created: false, admission: existing })
    : await store.claimAdmission({
      admissionKey,
      customerProfile: input.customerProfile,
      customerKey: input.customerKey,
      accountKey: input.accountKey,
      sourceHandle: settled.second.sourceHandle,
      sourceWatermark: settled.second.sourceWatermark,
      metricDate: input.metricDate,
      sourceRecordCount: settled.second.recordCount,
      sourceMaxModifiedAt: settled.second.maxModifiedAt,
      generation: requestedAt,
      workKey,
      requestedAt,
    });
  const admission = claim.admission;
  if (['queued', 'processing', 'completed', 'failed_permanent'].includes(admission.status)) {
    return Object.freeze({
      status: 'skipped',
      reason: `admission_${admission.status}`,
      admission,
    });
  }

  const body = Object.freeze({
    schemaVersion: 1,
    type: requireText(input.syncJobType, 'syncJobType'),
    trigger: 'post_lark_watermark',
    syncMode: 'auto',
    metricDate: admission.metricDate,
    admissionKey: admission.admissionKey,
    sourceWatermark: admission.sourceWatermark,
    sourceRecordCount: admission.sourceRecordCount,
    sourceMaxModifiedAt: admission.sourceMaxModifiedAt,
    operationId,
    workKey: admission.workKey,
    generation: admission.generation,
    originalRequestedAt: admission.requestedAt,
    requestedAt: new Date(admission.requestedAt).toISOString(),
  });
  try {
    await queue.send(body);
    const queued = await store.markQueued({
      admissionKey: admission.admissionKey,
      queuedAt: requestedAt,
    });
    return Object.freeze({
      status: 'queued',
      reason: claim.created ? 'new_source_watermark' : 'retry_pending_admission',
      admission: queued,
      job: body,
    });
  } catch (cause) {
    await store.markFailed({
      admissionKey: admission.admissionKey,
      retryable: true,
      errorCode: cause?.code ?? 'TIKTOK_POST_LARK_QUEUE_SEND_FAILED',
    });
    throw transientError('Failed to enqueue TikTok post-Lark processing', {
      code: 'TIKTOK_POST_LARK_QUEUE_SEND_FAILED',
      cause,
      details: { admissionKey: admission.admissionKey },
    });
  }
}

function requireSettledProbe(value) {
  if (!value || typeof value !== 'object' || !value.second) {
    throw new TypeError('TikTok post-Lark admission requires settledProbe');
  }
  return value;
}

function requireStore(value) {
  for (const method of ['readAdmission', 'claimAdmission', 'markQueued', 'markFailed']) {
    if (typeof value?.[method] !== 'function') {
      throw new TypeError(`TikTok post-Lark admission requires store.${method}`);
    }
  }
  return value;
}

function requireQueue(value) {
  if (typeof value?.send !== 'function') {
    throw new TypeError('TikTok post-Lark admission requires queue.send');
  }
  return value;
}

function requireDate(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new TypeError(`${fieldName} must be YYYY-MM-DD`);
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function safeTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < Date.UTC(2000, 0, 1)) {
    throw new TypeError(`${fieldName} must be a safe timestamp`);
  }
  return number;
}
