import { isRetryableError, permanentError } from '../../../shared/src/errors/runtime-error.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/** ส่ง Durable reliability outbox ไป Lark แบบ bounded และ idempotent */
export async function deliverReliabilityMirror(input = {}) {
  const outbox = requireOutbox(input.outbox);
  const mirror = requireMirror(input.mirror);
  const limit = boundedLimit(input.limit ?? DEFAULT_LIMIT);
  const pending = await outbox.listPending({ limit });
  let delivered = 0;
  let superseded = 0;

  for (const item of pending) {
    if (item?.invalid === true) {
      const code = item.validationCode ?? 'RELIABILITY_MIRROR_OUTBOX_INVALID';
      const quarantine = await outbox.markPermanentFailed({
        outboxId: item.outboxId,
        revision: item.revision,
        errorCode: code,
        errorMessage: 'Reliability mirror outbox failed validation',
      });
      if (quarantine?.failedPermanent !== true) {
        superseded += 1;
        continue;
      }
      throw permanentError('Reliability mirror outbox failed validation', {
        code,
        details: { delivered, superseded, pending: pending.length },
      });
    }
    const method = requireMethod(item?.method);
    try {
      await mirror[method](item.payload);
      const completion = await outbox.markDelivered({
        outboxId: item.outboxId,
        revision: item.revision,
      });
      if (completion?.delivered === true) delivered += 1;
      else superseded += 1;
    } catch (cause) {
      const retryable = isRetryableError(cause);
      const failure = retryable
        ? await outbox.markDeliveryFailed({
          outboxId: item.outboxId,
          revision: item.revision,
          errorCode: cause?.code ?? 'RELIABILITY_MIRROR_DELIVERY_FAILED',
          errorMessage: cause instanceof Error ? cause.message : String(cause),
        })
        : await outbox.markPermanentFailed({
          outboxId: item.outboxId,
          revision: item.revision,
          errorCode: cause?.code ?? 'RELIABILITY_MIRROR_DELIVERY_PERMANENT_FAILURE',
          errorMessage: cause instanceof Error ? cause.message : String(cause),
        });
      const recorded = retryable ? failure?.pending === true : failure?.failedPermanent === true;
      if (!recorded) {
        superseded += 1;
        continue;
      }
      if (retryable) throw cause;
      throw permanentError('Reliability mirror delivery failed permanently', {
        code: cause?.code ?? 'RELIABILITY_MIRROR_DELIVERY_PERMANENT_FAILURE',
        cause,
        details: { delivered, superseded, pending: pending.length },
      });
    }
  }

  return Object.freeze({
    status: pending.length === limit ? 'bounded_batch_complete' : 'drained',
    pendingRead: pending.length,
    delivered,
    superseded,
    remainingUnknown: pending.length === limit,
  });
}

function requireOutbox(value) {
  for (const method of ['listPending', 'markDelivered', 'markDeliveryFailed', 'markPermanentFailed']) {
    if (typeof value?.[method] !== 'function') {
      throw new TypeError(`Reliability mirror delivery requires outbox.${method}`);
    }
  }
  return value;
}

function requireMirror(value) {
  for (const method of ['saveSyncRun', 'saveSystemAlert']) {
    if (typeof value?.[method] !== 'function') {
      throw new TypeError(`Reliability mirror delivery requires mirror.${method}`);
    }
  }
  return value;
}

function requireMethod(value) {
  if (value !== 'saveSyncRun' && value !== 'saveSystemAlert') {
    throw permanentError('Reliability mirror outbox method is unsupported', {
      code: 'RELIABILITY_MIRROR_METHOD_UNSUPPORTED',
    });
  }
  return value;
}

function boundedLimit(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > MAX_LIMIT) {
    throw permanentError(`Reliability mirror limit must be between 1 and ${MAX_LIMIT}`, {
      code: 'RELIABILITY_MIRROR_LIMIT_INVALID',
      details: { max: MAX_LIMIT },
    });
  }
  return number;
}
