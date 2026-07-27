#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { normalizeCloudflareQueueConsumerPayload } from './lib/cloudflare-queue-consumer-contract.js';

const realNpx = requireText(
  process.env.MKT_WOOCOMMERCE_REAL_NPX,
  'MKT_WOOCOMMERCE_REAL_NPX',
);
const args = process.argv.slice(2);
const result = spawnSync(realNpx, args, {
  cwd: process.cwd(),
  env: process.env,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  stdio: ['inherit', 'pipe', 'pipe'],
});

if (result.stderr) process.stderr.write(result.stderr);
if (result.error || result.status !== 0) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.error) process.stderr.write(`${result.error.message}\n`);
  process.exit(result.status ?? 1);
}

if (!isQueueConsumerListJson(args)) {
  if (result.stdout) process.stdout.write(result.stdout);
  process.exit(0);
}

try {
  const parsed = JSON.parse(result.stdout ?? '');
  const normalized = normalizeCloudflareQueueConsumerPayload(parsed);
  process.stdout.write(`${JSON.stringify(normalized)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'WOOCOMMERCE_QUEUE_CONSUMER_COMPAT_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: error?.details ?? {},
  }, null, 2)}\n`);
  process.exit(1);
}

function isQueueConsumerListJson(values) {
  return values[0] === 'wrangler'
    && values[1] === 'queues'
    && values[2] === 'consumer'
    && values[3] === 'list'
    && values.includes('--json');
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fieldName} is required`);
  }
  return value.trim();
}
