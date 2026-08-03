#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  META_K2_PREVIEW_ALIAS_READINESS,
} from './lib/meta-k2-preview-alias-readiness.js';
import {
  META_K2_PREVIEW_RECOVERY_CONFIRMATION,
} from './lib/meta-k2-preview-recovery.js';

const repositoryRoot = realpathSync.native(process.cwd());
const retryLauncher = join(
  repositoryRoot,
  'scripts',
  'meta-k2-partial-staging-preview-retry.mjs',
);
const readinessHook = join(
  repositoryRoot,
  'scripts',
  'meta-k2-preview-alias-readiness-hook.mjs',
);

const execute = parseArgs(process.argv.slice(2));
if (!execute) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    stage: 'meta-k2-preview-attested-retry',
    delegatesTo: relative(repositoryRoot, retryLauncher),
    preloadHook: relative(repositoryRoot, readinessHook),
    readiness: META_K2_PREVIEW_ALIAS_READINESS,
    previewConfirmation: META_K2_PREVIEW_RECOVERY_CONFIRMATION,
    readinessProbe: 'invalid bearer token / exact 401 plus version and attestation headers',
    directUseCaseInvocationCount: 0,
    remoteMutationCount: 0,
    workerDeploymentCount: 0,
    productionTrafficChange: false,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exit(0);
}

try {
  requireExact(
    process.env[META_K2_PREVIEW_RECOVERY_CONFIRMATION.envName],
    META_K2_PREVIEW_RECOVERY_CONFIRMATION.value,
    META_K2_PREVIEW_RECOVERY_CONFIRMATION.envName,
  );
  const importOption = `--import=${pathToFileURL(readinessHook).href}`;
  const currentOptions = String(process.env.NODE_OPTIONS ?? '').trim();
  const nodeOptions = currentOptions.includes(importOption)
    ? currentOptions
    : [currentOptions, importOption].filter(Boolean).join(' ');
  const child = spawnSync(process.execPath, [retryLauncher, '--execute'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptions,
      [META_K2_PREVIEW_ALIAS_READINESS.envName]:
        META_K2_PREVIEW_ALIAS_READINESS.value,
    },
    stdio: 'inherit',
  });
  if (child.error) throw child.error;
  if (child.status !== 0) process.exitCode = child.status ?? 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: 'meta-k2-preview-attested-retry',
    code: error?.code ?? 'META_K2_PREVIEW_ATTESTED_RETRY_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: error?.details ?? {},
    directUseCaseInvocationCount: 0,
    remoteMutationCount: 0,
    workerDeploymentCount: 0,
    productionTrafficChange: false,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    const error = new Error(`${fieldName} must equal the reviewed confirmation`);
    error.code = 'META_K2_PREVIEW_RECOVERY_CONFIRMATION_REQUIRED';
    error.details = { fieldName };
    throw error;
  }
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    const error = new Error('Unsupported Meta K2 attested Preview retry argument');
    error.code = 'META_K2_PREVIEW_ATTESTED_RETRY_ARGUMENT_INVALID';
    error.details = { unknown };
    throw error;
  }
  return args.includes('--execute');
}
