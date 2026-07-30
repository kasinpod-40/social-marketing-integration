import { createHash } from 'node:crypto';
import {
  adaptWooCommerceQueueConsumerCliOutput,
} from './woocommerce-queue-consumer-cli-output.js';

export function adaptWooCommerceCompletedStateQueueConsumerCliOutput(output) {
  const sharedAdapted = parseJson(
    adaptWooCommerceQueueConsumerCliOutput(output),
  );
  return `${JSON.stringify(addCloseoutSettingsDlqAlias(sharedAdapted))}\n`;
}

export function addCloseoutSettingsDlqAlias(value) {
  if (Array.isArray(value)) return value.map(adaptConsumer);
  if (!value || typeof value !== 'object') {
    throw adapterError('WooCommerce completed-state Queue output has no container');
  }
  if (Array.isArray(value.result)) {
    return { ...value, result: value.result.map(adaptConsumer) };
  }
  if (Array.isArray(value.consumers)) {
    return { ...value, consumers: value.consumers.map(adaptConsumer) };
  }
  throw adapterError('WooCommerce completed-state Queue output has no consumer collection');
}

function adaptConsumer(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw adapterError('WooCommerce completed-state Queue consumer is invalid');
  }
  const settings = entry.settings && typeof entry.settings === 'object'
    && !Array.isArray(entry.settings)
    ? entry.settings
    : {};
  const deadLetterQueue = optionalText(
    entry.dead_letter_queue ?? settings.dead_letter_queue,
  );
  return Object.freeze({
    ...entry,
    settings: Object.freeze({
      ...settings,
      dead_letter_queue: deadLetterQueue,
    }),
  });
}

function parseJson(value) {
  try {
    return JSON.parse(String(value ?? ''));
  } catch (cause) {
    throw adapterError(
      'WooCommerce completed-state adapted Queue output is invalid JSON',
      {
        outputSha256: createHash('sha256').update(String(value ?? '')).digest('hex'),
        errorName: cause?.name ?? 'SyntaxError',
      },
    );
  }
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function adapterError(message, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommerceCompletedStateQueueCliOutputError';
  error.code = 'WOOCOMMERCE_COMPLETED_STATE_QUEUE_SHAPE_INVALID';
  error.details = details;
  return error;
}
