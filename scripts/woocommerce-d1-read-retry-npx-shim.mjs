#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  classifyWooCommerceD1ReadCommand,
  wooCommerceD1ReadMaxAttempts,
  wooCommerceD1ReadRetryDelay,
} from './lib/woocommerce-d1-read-retry.js';

const realNpx = String(process.env.MKT_WOOCOMMERCE_D1_RETRY_REAL_NPX_PATH ?? '').trim();
if (!realNpx) {
  process.stderr.write('MKT_WOOCOMMERCE_D1_RETRY_REAL_NPX_PATH is required\n');
  process.exit(1);
}

const args = process.argv.slice(2);
const classification = classifyWooCommerceD1ReadCommand(args);
if (!classification.eligible) {
  exitWith(runOnce());
}

const maxAttempts = wooCommerceD1ReadMaxAttempts();
let result = null;
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  result = runOnce();
  if (result.status === 0 && !result.error) break;
  const delayMs = wooCommerceD1ReadRetryDelay(attempt);
  if (delayMs === null) break;
  process.stderr.write(`${JSON.stringify({
    ok: true,
    stage: 'woocommerce-d1-read-retry',
    attempt,
    maxAttempts,
    delayMs,
    exitStatus: result.status ?? null,
    businessMutationCount: 0,
  })}\n`);
  wait(delayMs);
}
exitWith(result);

function runOnce() {
  return spawnSync(realNpx, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
}

function exitWith(result) {
  if (result?.stdout) process.stdout.write(result.stdout);
  if (result?.stderr) process.stderr.write(result.stderr);
  if (result?.error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: result.error.code ?? 'WOOCOMMERCE_D1_READ_RETRY_EXEC_FAILED',
      message: result.error.message,
    })}\n`);
  }
  process.exit(result?.status ?? 1);
}

function wait(milliseconds) {
  const view = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(view, 0, 0, milliseconds);
}
