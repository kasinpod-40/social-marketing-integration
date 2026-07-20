import { isRetryableError, permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/** ส่ง Durable reliability outbox ไป Lark แบบ bounded และ idempotent */
export async function deliverReliabilityMirror(input = {}) {
  const outbox = requireOutbox(input.outbox);
  const limit = boundedLimit(input.limit ?? DEFAULT_LIMIT);
  const pending = await outbox.listPending({ limit });
  const remainingUnknown = pending.length === limit;
  if (pending.length === 0) {
    return freezeResult({
      status: 'drained',
      pendingRead: 0,
      delivered: 0,
      failedPermanent: 0,
      superseded: 0,
      remainingUnknown: false,
      deferred: false,
      errorCode: null,
    });
  }

  let mirror;
  try {
    mirror = requireMirror(typeof input.getMirror === 'function'
      ? await input.getMirror()
      : input.mirror);
  } catch (cause) {
    // Runtime/Lark config ยังไม่พร้อม: เก็บ Outbox เป็น pending และให้ Scheduled drain ลองใหม่
    // โดยไม่สร้าง Dead-letter/System alert วนกลับเข้ากลไก Mirror เดิม.
    return freezeResult({
      status: 'delivery_deferred',
      pendingRead: pending.length,
      delivered: 0,
      failedPermanent: 0,
      superseded: 0,
      remainingUnknown,
      deferred: true,
      errorCode: cause?.code ?? 'RELIABILITY_MIRROR_RUNTIME_UNAVAILABLE',
    });
  }

  let delivered = 0;
  let failedPermanent = 0;
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
      if (quarantine?.failedPermanent === true) failedPermanent += 1;
      else superseded += 1;
      continue;
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
      // Contract: Lark failure ทุกชนิดต้องคง Outbox เป็น pending/retryable.
      // failed_permanent ใช้เฉพาะ Durable payload/identity ที่เสียเท่านั้น.
      const failure = await outbox.markDeliveryFailed({
        outboxId: item.outboxId,
        revision: item.revision,
        errorCode: cause?.code ?? 'RELIABILITY_MIRROR_DELIVERY_FAILED',
        errorMessage: cause instanceof Error ? cause.message : String(cause),
      });
      if (failure?.pending !== true) {
        superseded += 1;
        continue;
      }
      if (isRetryableError(cause)) throw cause;
      throw transientError('Reliability mirror delivery remains pending after Lark rejection', {
        code: 'RELIABILITY_MIRROR_DELIVERY_RETRYABLE',
        cause,
        details: { causeCode: cause?.code ?? null },
      });
    }
  }

  return freezeResult({
    status: remainingUnknown ? 'bounded_batch_complete' : 'drained',
    pendingRead: pending.length,
    delivered,
    failedPermanent,
    superseded,
    remainingUnknown,
    deferred: false,
    errorCode: null,
  });
}

function freezeResult(value) {
  return Object.freeze(value);
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
