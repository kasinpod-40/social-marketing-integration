import { createHash } from 'node:crypto';
import { normalizeWooCommerceQueueConsumer } from './woocommerce-queue-consumer-topology.js';

export function adaptWooCommerceQueueConsumerCliOutput(output) {
  const source = requireText(output, 'output');
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (cause) {
    throw cliOutputError(
      'Wrangler Queue consumer output is not valid JSON',
      'WOOCOMMERCE_FINAL_QUEUE_CONSUMER_JSON_INVALID',
      {
        stdoutSha256: sha256(source),
        errorName: cause?.name ?? 'SyntaxError',
      },
    );
  }

  const adapted = adaptContainer(parsed);
  return `${JSON.stringify(adapted)}\n`;
}

function adaptContainer(value) {
  if (Array.isArray(value)) {
    return value.map(adaptConsumer);
  }
  if (!value || typeof value !== 'object') {
    throw cliOutputError(
      'Wrangler Queue consumer output has no consumer collection',
      'WOOCOMMERCE_FINAL_QUEUE_CONSUMER_SHAPE_INVALID',
    );
  }
  if (Array.isArray(value.result)) {
    return { ...value, result: value.result.map(adaptConsumer) };
  }
  if (Array.isArray(value.consumers)) {
    return { ...value, consumers: value.consumers.map(adaptConsumer) };
  }
  throw cliOutputError(
    'Wrangler Queue consumer output has no supported consumer collection',
    'WOOCOMMERCE_FINAL_QUEUE_CONSUMER_SHAPE_INVALID',
  );
}

function adaptConsumer(entry) {
  const normalized = normalizeWooCommerceQueueConsumer(entry);
  const settings = entry?.settings && typeof entry.settings === 'object'
    && !Array.isArray(entry.settings)
    ? entry.settings
    : {};
  return {
    ...entry,
    settings: {
      ...settings,
      max_batch_size: normalized.maxBatchSize,
      max_batch_timeout: normalized.maxBatchTimeout,
    },
  };
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw cliOutputError(
      `Wrangler Queue consumer ${fieldName} is required`,
      'WOOCOMMERCE_FINAL_QUEUE_CONSUMER_OUTPUT_REQUIRED',
      { fieldName },
    );
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

function cliOutputError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommerceQueueConsumerCliOutputError';
  error.code = code;
  error.details = details;
  return error;
}
