#!/usr/bin/env node

import { register } from 'node:module';

import {
  META_K2_SOURCE_COMPLETE_PREVIEW_CONFIRMATION,
  META_K2_SOURCE_COMPLETE_PREVIEW_MODE,
  META_K2_SOURCE_COMPLETE_PREVIEW_MODE_ENV,
  assertMetaK2SourceCompletePreviewConfirmation,
} from './lib/meta-k2-source-complete-preview-recovery.js';
import {
  META_K2_PREVIEW_RECOVERY_CONFIRMATION,
} from './lib/meta-k2-preview-recovery.js';
import {
  META_K2_PARTIAL_STAGING_FINALIZER_CONFIRMATION,
} from './lib/meta-k2-partial-staging-finalizer.js';
import {
  META_K2_EXACT_RECOVERY_MODE,
  META_K2_EXACT_RECOVERY_MODE_ENV,
} from '../packages/config/src/meta-k2-exact-recovery-contract.js';

try {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      planOnly: true,
      stage: 'meta-k2-source-complete-preview-recovery',
      confirmation: META_K2_SOURCE_COMPLETE_PREVIEW_CONFIRMATION,
      boundary: 'source_complete_pre_d1_failed',
      retainedSourceUnits: 43,
      retainedSourceRows: 4104,
      providerReplay: false,
      replacementOperation: false,
      queueMessageCount: 0,
      lifecycleSqlRepairCount: 0,
      executionTransport: 'preview_version_upload',
      productionWorkerDeployment: false,
      productionTrafficChange: false,
      previewSafeCloseRequired: true,
      scheduleEnabled: false,
      production: 'BLOCKED',
    }, null, 2)}\n`);
  } else {
    assertMetaK2SourceCompletePreviewConfirmation(process.env);
    bindExactEnvironment(
      META_K2_SOURCE_COMPLETE_PREVIEW_MODE_ENV,
      META_K2_SOURCE_COMPLETE_PREVIEW_MODE,
    );
    bindExactEnvironment(
      META_K2_PREVIEW_RECOVERY_CONFIRMATION.envName,
      META_K2_PREVIEW_RECOVERY_CONFIRMATION.value,
    );
    bindExactEnvironment(
      META_K2_PARTIAL_STAGING_FINALIZER_CONFIRMATION.envName,
      META_K2_PARTIAL_STAGING_FINALIZER_CONFIRMATION.value,
    );
    bindExactEnvironment(META_K2_EXACT_RECOVERY_MODE_ENV, META_K2_EXACT_RECOVERY_MODE);

    register(
      './lib/meta-k2-source-complete-preview-loader.mjs',
      import.meta.url,
    );
    await import('./meta-k2-partial-staging-preview-recovery.mjs');
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: 'meta-k2-source-complete-preview-bootstrap',
    code: error?.code ?? 'META_K2_SOURCE_COMPLETE_PREVIEW_BOOTSTRAP_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    providerRequestCount: 0,
    queueMessageCount: 0,
    d1WriteCount: 0,
    larkWriteCount: 0,
    workerVersionUploadCount: 0,
    workerDeploymentCount: 0,
    productionTrafficChange: false,
    lifecycleSqlRepairCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    const error = new Error('Unsupported Meta K2 source-complete Preview argument');
    error.code = 'META_K2_SOURCE_COMPLETE_PREVIEW_ARGUMENT_INVALID';
    error.details = { unknown };
    throw error;
  }
  return args.includes('--execute');
}

function bindExactEnvironment(name, expected) {
  const current = process.env[name];
  if (current !== undefined && current !== '' && current !== expected) {
    const error = new Error(`${name} conflicts with the source-complete Preview contract`);
    error.code = 'META_K2_SOURCE_COMPLETE_PREVIEW_ENV_CONFLICT';
    error.details = { fieldName: name };
    throw error;
  }
  process.env[name] = expected;
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
