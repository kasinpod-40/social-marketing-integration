#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isAbsolute } from 'node:path';
import {
  adaptWooCommerceQueueConsumerCliOutput,
  isWooCommerceQueueConsumerJsonCommand,
} from './lib/woocommerce-queue-consumer-cli-output.js';

const args = process.argv.slice(2);
const realNpx = requireAbsolutePath(
  process.env.MKT_WOOCOMMERCE_FINAL_REAL_NPX,
  'MKT_WOOCOMMERCE_FINAL_REAL_NPX',
);
const result = spawnSync(realNpx, args, {
  cwd: process.cwd(),
  env: process.env,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  stdio: ['inherit', 'pipe', 'pipe'],
});

if (result.error || result.status !== 0) {
  write(result.stdout, process.stdout);
  write(result.stderr, process.stderr);
  if (result.error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: 'WOOCOMMERCE_COMPLETED_STATE_NPX_CHILD_FAILED',
      errorCode: result.error.code ?? null,
      stderrSha256: sha256(result.stderr ?? ''),
    })}\n`);
  }
  process.exitCode = result.status ?? 1;
} else if (isWooCommerceQueueConsumerJsonCommand(args)) {
  try {
    const sharedAdapted = JSON.parse(
      adaptWooCommerceQueueConsumerCliOutput(result.stdout ?? ''),
    );
    write(`${JSON.stringify(addCloseoutSettingsDlqAlias(sharedAdapted))}\n`, process.stdout);
    write(result.stderr, process.stderr);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: error?.code ?? 'WOOCOMMERCE_COMPLETED_STATE_QUEUE_ADAPT_FAILED',
      message: error instanceof Error ? error.message : String(error),
      details: sanitize(error?.details ?? {}),
      stdoutSha256: sha256(result.stdout ?? ''),
    })}\n`);
    process.exitCode = 1;
  }
} else {
  write(result.stdout, process.stdout);
  write(result.stderr, process.stderr);
}

export function addCloseoutSettingsDlqAlias(value) {
  if (Array.isArray(value)) return value.map(adaptConsumer);
  if (!value || typeof value !== 'object') {
    throw proxyError('WooCommerce completed-state Queue output has no container');
  }
  if (Array.isArray(value.result)) {
    return { ...value, result: value.result.map(adaptConsumer) };
  }
  if (Array.isArray(value.consumers)) {
    return { ...value, consumers: value.consumers.map(adaptConsumer) };
  }
  throw proxyError('WooCommerce completed-state Queue output has no consumer collection');
}

function adaptConsumer(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw proxyError('WooCommerce completed-state Queue consumer is invalid');
  }
  const settings = entry.settings && typeof entry.settings === 'object'
    && !Array.isArray(entry.settings)
    ? entry.settings
    : {};
  const deadLetterQueue = optionalText(
    entry.dead_letter_queue ?? settings.dead_letter_queue,
  );
  return {
    ...entry,
    settings: {
      ...settings,
      dead_letter_queue: deadLetterQueue,
    },
  };
}

function requireAbsolutePath(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '' || !isAbsolute(value)) {
    throw proxyError(`${fieldName} must be an absolute executable path`);
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function write(value, stream) {
  if (typeof value === 'string' && value !== '') stream.write(value);
}

function sha256(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(?:token|secret|authorization|cookie|password|accountId|queueId)$/iu.test(key))
    .map(([key, nested]) => [key, sanitize(nested)]));
}

function proxyError(message, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommerceCompletedStateNpxProxyError';
  error.code = 'WOOCOMMERCE_COMPLETED_STATE_QUEUE_SHAPE_INVALID';
  error.details = details;
  return error;
}
