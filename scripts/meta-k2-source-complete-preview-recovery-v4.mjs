#!/usr/bin/env node

import { register } from 'node:module';

import {
  META_K2_SOURCE_COMPLETE_PREVIEW_MODE,
  META_K2_SOURCE_COMPLETE_PREVIEW_MODE_ENV,
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
import {
  META_K2_SOURCE_COMPLETE_PREVIEW_V4_CONFIRMATION,
  META_K2_SOURCE_COMPLETE_PREVIEW_V4_MODE,
  META_K2_SOURCE_COMPLETE_PREVIEW_V4_MODE_ENV,
  META_K2_SOURCE_COMPLETE_RECOVERY_V4_BACKUP_ROOT,
  META_K2_SOURCE_COMPLETE_RECOVERY_V4_CONTRACT_VERSION,
  META_K2_SOURCE_COMPLETE_RECOVERY_V4_ROOT,
  assertMetaK2SourceCompletePreviewV4Confirmation,
} from './lib/meta-k2-source-complete-preview-recovery-v4.js';

try {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      planOnly: true,
      stage: 'meta-k2-source-complete-preview-recovery-v4',
      contractVersion: META_K2_SOURCE_COMPLETE_RECOVERY_V4_CONTRACT_VERSION,
      confirmation: META_K2_SOURCE_COMPLETE_PREVIEW_V4_CONFIRMATION,
      boundary: 'source_complete_pre_d1_failed',
      retainedSourceUnits: 43,
      retainedSourceRows: 4104,
      retainedV3Failure: true,
      recoveryRoot: META_K2_SOURCE_COMPLETE_RECOVERY_V4_ROOT,
      backupRoot: META_K2_SOURCE_COMPLETE_RECOVERY_V4_BACKUP_ROOT,
      backupBeforePreviewWindow: true,
      backupAutomaticRetry: false,
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
    assertMetaK2SourceCompletePreviewV4Confirmation(process.env);
    bindExactEnvironment(
      META_K2_SOURCE_COMPLETE_PREVIEW_MODE_ENV,
      META_K2_SOURCE_COMPLETE_PREVIEW_MODE,
    );
    bindExactEnvironment(
      META_K2_SOURCE_COMPLETE_PREVIEW_V4_MODE_ENV,
      META_K2_SOURCE_COMPLETE_PREVIEW_V4_MODE,
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
      './lib/meta-k2-source-complete-preview-loader-v4.mjs',
      import.meta.url,
    );
    await import('./meta-k2-partial-staging-preview-recovery.mjs');
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: 'meta-k2-source-complete-preview-bootstrap-v4',
    code: error?.code ?? 'META_K2_SOURCE_COMPLETE_PREVIEW_BOOTSTRAP_V4_FAILED',
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
    const error = new Error('Unsupported Meta K2 source-complete Preview v4 argument');
    error.code = 'META_K2_SOURCE_COMPLETE_PREVIEW_V4_ARGUMENT_INVALID';
    error.details = { unknown };
    throw error;
  }
  return args.includes('--execute');
}

function bindExactEnvironment(name, expected) {
  const current = process.env[name];
  if (current !== undefined && current !== '' && current !== expected) {
    const error = new Error(`${name} conflicts with the source-complete Preview v4 contract`);
    error.code = 'META_K2_SOURCE_COMPLETE_PREVIEW_V4_ENV_CONFLICT';
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
