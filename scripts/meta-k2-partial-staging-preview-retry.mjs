#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  META_K2_EXACT_RECOVERY_IDENTITY,
} from '../packages/config/src/meta-k2-exact-recovery-contract.js';
import {
  META_K2_PREVIEW_RECOVERY_CONFIRMATION,
} from './lib/meta-k2-preview-recovery.js';
import {
  retainMetaK2WranglerTransientDirectory,
} from './lib/meta-k2-preview-retry-root.js';

const repositoryRoot = realpathSync.native(process.cwd());
const recoveryRoot = join(
  repositoryRoot,
  'outputs',
  'meta-d1-only-rollout',
  META_K2_EXACT_RECOVERY_IDENTITY.targetKey,
  META_K2_EXACT_RECOVERY_IDENTITY.operationId,
  'exact-partial-staging-recovery-v1',
);
const reviewedLauncher = join(
  repositoryRoot,
  'scripts',
  'meta-k2-partial-staging-preview-recovery.mjs',
);

const execute = parseArgs(process.argv.slice(2));
if (!execute) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    stage: 'retain-reviewed-wrangler-transient-before-preview-retry',
    retainedEntry: '.wrangler directory only',
    retainedWithoutDeletion: true,
    delegatesTo: relative(repositoryRoot, reviewedLauncher),
    confirmation: META_K2_PREVIEW_RECOVERY_CONFIRMATION,
    remoteMutationCount: 0,
    workerVersionUploadCount: 0,
    workerDeploymentCount: 0,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exit(0);
}

try {
  requirePreviewConfirmation(process.env);
  const retained = await retainMetaK2WranglerTransientDirectory({ recoveryRoot });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    stage: 'retain-reviewed-wrangler-transient-before-preview-retry',
    retained: retained.retained,
    retryFootprint: retained.retryFootprint,
    evidenceFileCount: retained.fileNames.length,
    transientToolingDirectoryCount: retained.transientToolingDirectoryCount,
    retainedPath: retained.retainedPath
      ? relative(repositoryRoot, retained.retainedPath)
      : null,
    retainedWithoutDeletion: true,
    remoteMutationCount: 0,
    workerVersionUploadCount: 0,
    workerDeploymentCount: 0,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);

  const child = spawnSync(process.execPath, [reviewedLauncher, '--execute'], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (child.error) throw child.error;
  if (child.status !== 0) process.exitCode = child.status ?? 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: 'retain-reviewed-wrangler-transient-before-preview-retry',
    code: error?.code ?? 'META_K2_PREVIEW_RETRY_WRAPPER_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: error?.details ?? {},
    retainedWithoutDeletion: true,
    remoteMutationCount: 0,
    workerVersionUploadCount: 0,
    workerDeploymentCount: 0,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function requirePreviewConfirmation(env) {
  const expected = META_K2_PREVIEW_RECOVERY_CONFIRMATION;
  if (env[expected.envName] !== expected.value) {
    const error = new Error(
      `Meta K2 Preview retry requires ${expected.envName}=${expected.value}`,
    );
    error.code = 'META_K2_PREVIEW_RECOVERY_CONFIRMATION_REQUIRED';
    error.details = { fieldName: expected.envName };
    throw error;
  }
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    const error = new Error('Unsupported Meta K2 Preview retry argument');
    error.code = 'META_K2_PREVIEW_RETRY_ARGUMENT_INVALID';
    error.details = { unknown };
    throw error;
  }
  return args.includes('--execute');
}
