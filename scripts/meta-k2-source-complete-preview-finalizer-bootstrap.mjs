#!/usr/bin/env node

import { register } from 'node:module';

import {
  META_K2_SOURCE_COMPLETE_PREVIEW_MODE,
  META_K2_SOURCE_COMPLETE_PREVIEW_MODE_ENV,
} from './lib/meta-k2-source-complete-preview-recovery.js';

try {
  if (process.env[META_K2_SOURCE_COMPLETE_PREVIEW_MODE_ENV]
      !== META_K2_SOURCE_COMPLETE_PREVIEW_MODE) {
    const error = new Error('Meta K2 source-complete finalizer mode is not authorized');
    error.code = 'META_K2_SOURCE_COMPLETE_FINALIZER_MODE_REQUIRED';
    throw error;
  }
  register(
    './lib/meta-k2-source-complete-preview-loader.mjs',
    import.meta.url,
  );
  await import('./meta-k2-partial-staging-preview-finalizer.mjs');
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: 'meta-k2-source-complete-finalizer-bootstrap',
    code: error?.code ?? 'META_K2_SOURCE_COMPLETE_FINALIZER_BOOTSTRAP_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    providerRequestCount: 0,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    workerDeploymentCount: 0,
    productionTrafficChange: false,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function sanitize(value, key = '') {
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry, key));
  if (typeof value !== 'object') {
    return /token|authorization|secret|password|origin|url|account|entity/iu.test(key)
      ? '[REDACTED]'
      : value;
  }
  return Object.fromEntries(Object.entries(value).map(([nestedKey, nestedValue]) => [
    nestedKey,
    sanitize(nestedValue, nestedKey),
  ]));
}
