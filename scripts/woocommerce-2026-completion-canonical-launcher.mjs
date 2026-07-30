#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { canonicalizeTemporaryDirectoryEnvironment } from './lib/canonical-temporary-directory.js';
import { readDevVars } from './lib/dev-vars.js';
import { bootstrapWooCommerceFinalQueueId } from './lib/woocommerce-final-queue-bootstrap.js';

canonicalizeTemporaryDirectoryEnvironment(process.env);
installLockedDependencies();

const runtimeEnv = {
  ...await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars'),
  ...process.env,
};
const queueBootstrap = await bootstrapWooCommerceFinalQueueId({
  env: runtimeEnv,
  repositoryRoot: process.cwd(),
});
process.env.MKT_WOOCOMMERCE_FINAL_QUEUE_ID = queueBootstrap.queueId;

await import('./woocommerce-2026-completion-safe-launcher.mjs');

function installLockedDependencies() {
  const result = spawnSync(
    'npm',
    ['ci'],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    },
  );
  if (result.error || result.status !== 0) {
    const error = new Error('Locked dependency installation failed before WooCommerce Queue bootstrap');
    error.name = 'WooCommerceCompletionCanonicalLauncherError';
    error.code = 'WOOCOMMERCE_2026_CANONICAL_NPM_CI_FAILED';
    error.details = { status: result.status ?? 1 };
    throw error;
  }
}
