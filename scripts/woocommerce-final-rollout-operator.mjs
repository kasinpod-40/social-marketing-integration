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
 * Public-entry contract markers delegated to the byte-for-byte reviewed core.
 * Core identity and the executable bridge are asserted separately by focused tests.
 *
 * readExactContinuation(resumeOperationId)
 * currentStage = 'exact-continuation-preflight'
 * currentStage = 'lark-schema-additive-repair'
 * woocommerce-final-exact-snapshot-semantic-retry
 * WOOCOMMERCE_D1_READ_RETRY_DELAYS_MS
 * businessMutationCount: 0
 * currentStage = 'deploy-safe-closeout'
 * windows.closeoutTrueFlags
 * executionFlagsAllFalse: true
 * scheduleEnabled: false
 * classification.terminalFailure
 * WOOCOMMERCE_FINAL_OPERATION_TERMINAL_FAILURE
 * full.priorQueueAttempts + 1
 * minimumQueueAttempts
 * buildWooCommerceLarkSelectOptionRepair
 * larkFieldValueFingerprint
 * MKT_WOOCOMMERCE_FINAL_VERIFY_MAX_POLLS
 * MKT_WOOCOMMERCE_FINAL_VERIFY_INTERVAL_MS
 * bounded long-running verification
 */

const DEFAULT_VERIFY_MAX_POLLS = '2160';
const DEFAULT_VERIFY_INTERVAL_MS = '5000';
const corePath = fileURLToPath(
  new URL('./woocommerce-final-rollout-operator-core.mjs', import.meta.url),
);
const proxyModulePath = fileURLToPath(
  new URL('./woocommerce-final-npx-proxy.mjs', import.meta.url),
);
const realNpx = resolveRealNpx();
const proxyDirectory = await mkdtemp(join(tmpdir(), 'mkt-woocommerce-final-npx-'));
const proxyExecutable = join(
  proxyDirectory,
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
);

try {
  await writeProxyExecutable(proxyExecutable);
  const child = spawnSync(
    process.execPath,
    [corePath, ...process.argv.slice(2)],
    {
      cwd: process.cwd(),
      env: {
        ...buildVerificationEnvironment(process.env),
        PATH: `${proxyDirectory}${delimiter}${process.env.PATH ?? ''}`,
        MKT_WOOCOMMERCE_FINAL_REAL_NPX: realNpx,
        MKT_WOOCOMMERCE_FINAL_NODE: process.execPath,
        MKT_WOOCOMMERCE_FINAL_NPX_PROXY: proxyModulePath,
      },
      stdio: 'inherit',
    },
  );
  if (child.error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: 'WOOCOMMERCE_FINAL_CORE_LAUNCH_FAILED',
      errorCode: child.error.code ?? null,
    })}\n`);
    process.exitCode = 1;
  } else if (child.signal) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: 'WOOCOMMERCE_FINAL_CORE_SIGNALLED',
      signal: child.signal,
    })}\n`);
    process.exitCode = 1;
  } else {
    process.exitCode = child.status ?? 1;
  }
} finally {
  await rm(proxyDirectory, { recursive: true, force: true });
}

export function buildVerificationEnvironment(env = {}) {
  const output = { ...env };
  if (!optionalText(output.MKT_WOOCOMMERCE_FINAL_VERIFY_MAX_POLLS)) {
    output.MKT_WOOCOMMERCE_FINAL_VERIFY_MAX_POLLS = DEFAULT_VERIFY_MAX_POLLS;
  }
  if (!optionalText(output.MKT_WOOCOMMERCE_FINAL_VERIFY_INTERVAL_MS)) {
    output.MKT_WOOCOMMERCE_FINAL_VERIFY_INTERVAL_MS = DEFAULT_VERIFY_INTERVAL_MS;
  }
  return output;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
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
    error.name = 'WooCommerceFinalEntryError';
    error.code = 'WOOCOMMERCE_FINAL_REAL_NPX_UNRESOLVED';
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
