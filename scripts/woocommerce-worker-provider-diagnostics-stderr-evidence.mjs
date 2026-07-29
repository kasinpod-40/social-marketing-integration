#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const confirmation = Object.freeze({
  envName: 'CONFIRM_WOOCOMMERCE_WRANGLER_STDERR_EVIDENCE',
  value: 'CAPTURE_REDACTED_WRANGLER_STDERR_EVIDENCE',
});

assertConfirmation(process.env);
if (String(process.env.NODE_OPTIONS ?? '').trim() !== '') {
  const error = new Error('NODE_OPTIONS must be empty before WooCommerce stderr evidence launch');
  error.code = 'WOOCOMMERCE_WRANGLER_STDERR_EVIDENCE_NODE_OPTIONS_BLOCKED';
  throw error;
}

const repositoryRoot = resolve(process.cwd());
const preloadUrl = pathToFileURL(resolve(
  repositoryRoot,
  'scripts/lib/woocommerce-wrangler-stderr-preload.mjs',
)).href;
const child = spawn(
  process.execPath,
  ['scripts/woocommerce-worker-provider-diagnostics-command-failed-evidence.mjs'],
  {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      NODE_OPTIONS: `--import=${preloadUrl}`,
    },
    stdio: 'inherit',
  },
);

const exit = await new Promise((resolveExit) => {
  child.once('error', (error) => resolveExit({ status: null, signal: null, error }));
  child.once('close', (status, signal) => resolveExit({ status, signal, error: null }));
});

if (exit.error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: 'woocommerce-worker-provider-diagnostics-stderr-evidence-launcher',
    code: exit.error?.code ?? 'WOOCOMMERCE_WRANGLER_STDERR_EVIDENCE_CHILD_START_FAILED',
    diagnosticExitStatus: null,
    diagnosticSignal: null,
    remoteActionsAddedByLauncher: 0,
  }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.exitCode = exit.status ?? 1;
}

function assertConfirmation(env) {
  if (env[confirmation.envName] !== confirmation.value) {
    const error = new Error(
      `stderr evidence launcher requires ${confirmation.envName}=${confirmation.value}`,
    );
    error.code = 'WOOCOMMERCE_WRANGLER_STDERR_EVIDENCE_CONFIRMATION_REQUIRED';
    throw error;
  }
}
