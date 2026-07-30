#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Public entry for WooCommerce completed-state closeout.
 *
 * The closeout operator reuses the reviewed Final Queue topology contract. Current Wrangler emits
 * `settings.batch_size` and `settings.max_wait_time_ms`, while the immutable Final-compatible
 * verification reads the reviewed legacy aliases. The existing narrowly scoped npx proxy adapts only
 * `wrangler queues consumer list ... --json`; every other npx command passes through byte-for-byte.
 */

const operatorPath = fileURLToPath(
  new URL('./woocommerce-final-completed-state-closeout.mjs', import.meta.url),
);
const proxyModulePath = fileURLToPath(
  new URL('./woocommerce-final-npx-proxy.mjs', import.meta.url),
);
const realNpx = resolveRealNpx();
const proxyDirectory = await mkdtemp(
  join(tmpdir(), 'mkt-woocommerce-completed-state-npx-'),
);
const proxyExecutable = join(
  proxyDirectory,
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
);

try {
  await writeProxyExecutable(proxyExecutable);
  const child = spawnSync(
    process.execPath,
    [operatorPath, ...process.argv.slice(2)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${proxyDirectory}${delimiter}${process.env.PATH ?? ''}`,
        MKT_WOOCOMMERCE_FINAL_REAL_NPX: realNpx,
        MKT_WOOCOMMERCE_FINAL_NODE: process.execPath,
        MKT_WOOCOMMERCE_FINAL_NPX_PROXY: proxyModulePath,
        MKT_WOOCOMMERCE_COMPLETED_STATE_PUBLIC_LAUNCHER: '1',
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
} finally {
  await rm(proxyDirectory, { recursive: true, force: true });
}

function resolveRealNpx() {
  const command = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(command, ['npx'], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const value = String(result.stdout ?? '')
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .find(Boolean);
  if (result.error || result.status !== 0 || !value) {
    const error = new Error('Unable to resolve the real npx executable');
    error.name = 'WooCommerceCompletedStateLauncherError';
    error.code = 'WOOCOMMERCE_COMPLETED_STATE_REAL_NPX_UNRESOLVED';
    throw error;
  }
  return value;
}

async function writeProxyExecutable(path) {
  const content = process.platform === 'win32'
    ? '@echo off\r\n"%MKT_WOOCOMMERCE_FINAL_NODE%" "%MKT_WOOCOMMERCE_FINAL_NPX_PROXY%" %*\r\n'
    : '#!/bin/sh\nexec "$MKT_WOOCOMMERCE_FINAL_NODE" "$MKT_WOOCOMMERCE_FINAL_NPX_PROXY" "$@"\n';
  await writeFile(path, content, { mode: 0o700, flag: 'wx' });
  await chmod(path, 0o700);
}
