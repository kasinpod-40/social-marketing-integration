#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repositoryRoot = resolve(process.cwd());
const loaderUrl = pathToFileURL(resolve(
  repositoryRoot,
  'scripts/lib/meta-k3-exact-recovery-loader.mjs',
)).href;
const reviewedFinalizer = resolve(
  repositoryRoot,
  'scripts/meta-k2-partial-staging-preview-finalizer.mjs',
);

const child = spawn(
  process.execPath,
  [
    '--no-warnings',
    '--experimental-loader',
    loaderUrl,
    reviewedFinalizer,
    ...process.argv.slice(2),
  ],
  {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      MKT_META_K3_EXACT_RECOVERY_ADAPTER: 'true',
    },
    stdio: 'inherit',
  },
);

child.once('error', (error) => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: 'META_K3_FINALIZER_LAUNCH_FAILED',
    message: error instanceof Error ? error.message : String(error),
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
});

child.once('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
