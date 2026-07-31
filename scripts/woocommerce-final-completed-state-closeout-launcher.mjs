#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Public entry for WooCommerce completed-state closeout.
 *
 * This launcher binds every private checkpoint and Queue-attempt artifact to the exact Repository
 * Head, then invokes the guarded operator with an explicit public-entry marker. Remote execution,
 * Queue normalization and closeout logic remain owned by the operator and shared libraries.
 */

const operatorPath = fileURLToPath(
  new URL('./woocommerce-final-completed-state-closeout.mjs', import.meta.url),
);
const repositoryHead = resolveRepositoryHead();
const evidenceBase = resolve(
  process.env.MKT_WOOCOMMERCE_COMPLETED_STATE_EVIDENCE_DIR
    ?? join(process.cwd(), 'outputs', 'woocommerce-completed-state-closeout-v1'),
);
const evidenceDirectory = join(evidenceBase, repositoryHead);

const child = spawnSync(
  process.execPath,
  [operatorPath, ...process.argv.slice(2)],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MKT_WOOCOMMERCE_COMPLETED_STATE_PUBLIC_LAUNCHER: '1',
      MKT_WOOCOMMERCE_COMPLETED_STATE_EVIDENCE_DIR: evidenceDirectory,
    },
    stdio: 'inherit',
  },
);

if (child.error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: 'WOOCOMMERCE_COMPLETED_STATE_LAUNCH_FAILED',
    errorCode: child.error.code ?? null,
    production: 'BLOCKED',
  })}\n`);
  process.exitCode = 1;
} else if (child.signal) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: 'WOOCOMMERCE_COMPLETED_STATE_LAUNCH_SIGNALLED',
    signal: child.signal,
    production: 'BLOCKED',
  })}\n`);
  process.exitCode = 1;
} else {
  process.exitCode = child.status ?? 1;
}

function resolveRepositoryHead() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const value = String(result.stdout ?? '').trim().toLowerCase();
  if (result.error || result.status !== 0 || !/^[0-9a-f]{40}$/u.test(value)) {
    const error = new Error('Unable to resolve the exact Repository Head');
    error.name = 'WooCommerceCompletedStateLauncherError';
    error.code = 'WOOCOMMERCE_COMPLETED_STATE_HEAD_UNRESOLVED';
    throw error;
  }
  return value;
}
