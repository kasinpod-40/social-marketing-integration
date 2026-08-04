#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  META_K2_PREVIEW_RECOVERY_CONFIRMATION,
} from './lib/meta-k2-preview-recovery.js';
import {
  META_K2_RETRY_CONTINUITY_MODE,
} from './lib/meta-k2-preview-retry-continuity.js';

const repositoryRoot = realpathSync.native(process.cwd());
const delegate = join(
  repositoryRoot,
  'scripts',
  'meta-k2-partial-staging-preview-attested-retry.mjs',
);
const hook = join(
  repositoryRoot,
  'scripts',
  'meta-k2-preview-retry-continuity-hook.mjs',
);
const execute = parseArgs(process.argv.slice(2));

if (!execute) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    stage: 'meta-k2-preview-retry-continuity-guard',
    acceptedDrift: 'nondecreasing account-wide target counts only',
    exactOperationDriftAllowed: false,
    targetCountRegressionAllowed: false,
    evidenceFileModified: false,
    delegatesTo: relative(repositoryRoot, delegate),
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
  const importOption = `--import=${pathToFileURL(hook).href}`;
  const inherited = String(process.env.NODE_OPTIONS ?? '').trim();
  const nodeOptions = inherited.includes(importOption)
    ? inherited
    : [inherited, importOption].filter(Boolean).join(' ');
  const child = spawnSync(process.execPath, [delegate, '--execute'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptions,
      [META_K2_RETRY_CONTINUITY_MODE.envName]:
        META_K2_RETRY_CONTINUITY_MODE.value,
    },
    stdio: 'inherit',
  });
  if (child.error) throw child.error;
  if (child.status !== 0) process.exitCode = child.status ?? 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: 'meta-k2-preview-retry-continuity-guard',
    code: error?.code ?? 'META_K2_PREVIEW_RETRY_CONTINUITY_WRAPPER_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: error?.details ?? {},
    evidenceFileModified: false,
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
      `Meta K2 Preview continuity retry requires ${expected.envName}=${expected.value}`,
    );
    error.code = 'META_K2_PREVIEW_RECOVERY_CONFIRMATION_REQUIRED';
    error.details = { fieldName: expected.envName };
    throw error;
  }
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    const error = new Error('Unsupported Meta K2 Preview continuity retry argument');
    error.code = 'META_K2_PREVIEW_RETRY_CONTINUITY_ARGUMENT_INVALID';
    error.details = { unknown };
    throw error;
  }
  return args.includes('--execute');
}
