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
      code: 'WOOCOMMERCE_FINAL_NPX_PROXY_CHILD_FAILED',
      errorCode: result.error.code ?? null,
      stderrSha256: sha256(result.stderr ?? ''),
    })}\n`);
  }
  process.exitCode = result.status ?? 1;
} else if (isWooCommerceQueueConsumerJsonCommand(args)) {
  try {
    write(
      adaptWooCommerceQueueConsumerCliOutput(result.stdout ?? ''),
      process.stdout,
    );
    write(result.stderr, process.stderr);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: error?.code ?? 'WOOCOMMERCE_FINAL_QUEUE_CONSUMER_ADAPT_FAILED',
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

function requireAbsolutePath(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '' || !isAbsolute(value)) {
    throw new Error(`${fieldName} must be an absolute executable path`);
  }
  return value.trim();
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
