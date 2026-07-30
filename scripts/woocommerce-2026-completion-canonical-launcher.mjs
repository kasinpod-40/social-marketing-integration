#!/usr/bin/env node

import { canonicalizeTemporaryDirectoryEnvironment } from './lib/canonical-temporary-directory.js';
import { readDevVars } from './lib/dev-vars.js';
import { bootstrapWooCommerceFinalQueueId } from './lib/woocommerce-final-queue-bootstrap.js';

canonicalizeTemporaryDirectoryEnvironment(process.env);

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
