const QUEUE_MESSAGE_PATH = /\/accounts\/[^/]+\/queues\/[^/]+\/messages$/u;
const WOOCOMMERCE_JOB_TYPE = 'woocommerce.commerce.sync';
const MANUAL_UAT_TRIGGER = 'manual_uat';

export const DEFAULT_WOOCOMMERCE_INITIAL_DELIVERY_DELAY_SECONDS = 120;

/**
 * เติม delay_seconds เฉพาะ initial full-reconciliation UAT message เพื่อกัน Queue consumer
 * รับข้อความด้วย Worker safe version ก่อน UAT deployment กระจายครบทุก consumer isolate.
 */
export function prepareWooCommercePropagationSafeQueueRequest(input = {}) {
  const url = normalizeUrl(input.url);
  const method = String(input.method ?? 'GET').trim().toUpperCase();
  const bodyText = typeof input.bodyText === 'string' ? input.bodyText : null;
  const delayedOperationIds = input.delayedOperationIds instanceof Set
    ? input.delayedOperationIds
    : new Set();
  const delaySeconds = readDelaySeconds(input.delaySeconds);

  if (method !== 'POST' || !QUEUE_MESSAGE_PATH.test(url.pathname) || bodyText === null) {
    return unchanged(bodyText);
  }

  let envelope;
  try {
    envelope = JSON.parse(bodyText);
  } catch {
    return unchanged(bodyText);
  }

  const job = envelope?.content_type === 'json' ? envelope.body : null;
  const operationId = optionalText(job?.operationId);
  const eligible = job?.type === WOOCOMMERCE_JOB_TYPE
    && job?.trigger === MANUAL_UAT_TRIGGER
    && job?.fullReconciliation === true
    && job?.continuation !== true
    && operationId !== null;

  if (!eligible || delayedOperationIds.has(operationId)) return unchanged(bodyText, operationId);

  const nextEnvelope = {
    ...envelope,
    delay_seconds: Math.max(readExistingDelay(envelope.delay_seconds), delaySeconds),
  };
  return Object.freeze({
    changed: true,
    bodyText: JSON.stringify(nextEnvelope),
    operationId,
    delaySeconds: nextEnvelope.delay_seconds,
  });
}

export function readWooCommerceInitialDeliveryDelaySeconds(value) {
  return readDelaySeconds(value);
}

function readDelaySeconds(value) {
  const source = value ?? DEFAULT_WOOCOMMERCE_INITIAL_DELIVERY_DELAY_SECONDS;
  const number = typeof source === 'number' ? source : Number(String(source).trim());
  if (!Number.isSafeInteger(number) || number < 30 || number > 300) {
    throw new Error('MKT_WOOCOMMERCE_FINAL_INITIAL_DELIVERY_DELAY_SECONDS must be an integer from 30 to 300');
  }
  return number;
}

function readExistingDelay(value) {
  if (value === null || value === undefined || value === '') return 0;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function normalizeUrl(value) {
  if (value instanceof URL) return value;
  if (typeof value === 'string') return new URL(value);
  if (value && typeof value.url === 'string') return new URL(value.url);
  return new URL('https://invalid.local/');
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function unchanged(bodyText, operationId = null) {
  return Object.freeze({ changed: false, bodyText, operationId, delaySeconds: 0 });
}
