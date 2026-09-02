#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildWranglerOAuthEnvironment } from './lib/cloudflare-auth-environment.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';

const CONFIRMATION = 'DIAGNOSE_INTERNAL_D1_READONLY';
const TARGET_DATABASE = 'social-mkt-state-dev';
const TARGET_BINDING = 'MKT_STATE_DB';
const DEFAULT_CONFIG = 'wrangler.sync.jsonc';
const PROBE_SQL = 'SELECT 1 AS audit_probe';

const execute = process.argv.slice(2).includes('--execute');

try {
  if (process.argv.slice(2).some((value) => value !== '--execute')) {
    throw diagnosticError('Unsupported argument', 'INTERNAL_D1_DIAG_ARGUMENT_INVALID');
  }
  if (!execute) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      mode: 'plan',
      status: 'INTERNAL_D1_READ_DIAGNOSIS_PLAN',
      targetDatabase: TARGET_DATABASE,
      defaultConfig: DEFAULT_CONFIG,
      providerReads: 0,
      d1Writes: 0,
      larkReads: 0,
      larkWrites: 0,
      queueSends: 0,
      customerBaseReads: 0,
      customerBaseWrites: 0,
      nextCommand: `CONFIRM_INTERNAL_D1_READ_DIAGNOSIS=${CONFIRMATION} node scripts/internal-d1-read-diagnosis.mjs --execute`,
    }, null, 2)}\n`);
    process.exit(0);
  }
  if (process.env.CONFIRM_INTERNAL_D1_READ_DIAGNOSIS !== CONFIRMATION) {
    throw diagnosticError('Confirmation is missing', 'INTERNAL_D1_DIAG_CONFIRMATION_REQUIRED');
  }

  assertReviewedMain();
  const root = resolve(process.cwd());
  const configPath = resolve(process.env.WRANGLER_CONFIG ?? resolve(root, DEFAULT_CONFIG));
  const configText = await readFile(configPath, 'utf8');
  const config = parseJsoncObject(configText);
  const binding = (config.d1_databases ?? []).find((entry) => entry.binding === TARGET_BINDING);
  if (!binding || binding.database_name !== TARGET_DATABASE) {
    throw diagnosticError('Wrangler config is not the internal DEV D1 target', 'INTERNAL_D1_DIAG_TARGET_INVALID', {
      bindingFound: Boolean(binding),
      databaseName: binding?.database_name ?? null,
    });
  }

  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? resolve(root, '.dev.vars'));
  const env = buildWranglerOAuthEnvironment(Object.freeze({ ...fileEnv, ...process.env }));
  const result = spawnSync('npx', [
    'wrangler', 'd1', 'execute', TARGET_DATABASE,
    '--remote', '--json', '--config', configPath, '--command', PROBE_SQL,
  ], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });

  const diagnostic = Object.freeze({
    stage: 'remote-read-probe',
    command: 'wrangler d1 execute <internal-dev-db> --remote --json --config <internal-config> --command <read-only-probe>',
    exitCode: result.status ?? null,
    signal: result.signal ?? null,
    spawnError: result.error ? safeText(result.error.message) : null,
    stderr: safeText(result.stderr),
    stdout: safeText(result.stdout),
  });

  if (result.error || result.status !== 0) {
    throw diagnosticError('Wrangler D1 read probe failed', 'INTERNAL_D1_READ_PROBE_FAILED', diagnostic);
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    status: 'INTERNAL_D1_READ_PROBE_OK',
    targetDatabase: TARGET_DATABASE,
    diagnostic,
    providerReads: 0,
    d1Writes: 0,
    larkReads: 0,
    larkWrites: 0,
    queueSends: 0,
    customerBaseReads: 0,
    customerBaseWrites: 0,
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'INTERNAL_D1_DIAG_FAILED',
    message: error?.message ?? String(error),
    details: sanitize(error?.details ?? {}),
    providerReads: 0,
    d1Writes: 0,
    larkReads: 0,
    larkWrites: 0,
    queueSends: 0,
    customerBaseReads: 0,
    customerBaseWrites: 0,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function safeText(value) {
  let text = String(value ?? '').trim();
  if (!text) return null;
  text = text
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/giu, 'Bearer [REDACTED]')
    .replace(/((?:CLOUDFLARE|CF)_[A-Z0-9_]*(?:TOKEN|KEY)|API_TOKEN|AUTHORIZATION)\s*[=:]\s*[^\s,;]+/giu, '$1=[REDACTED]')
    .replace(/([?&](?:token|key|secret|authorization)=)[^&\s]+/giu, '$1[REDACTED]');
  return text.slice(-4000);
}

function assertReviewedMain() {
  const branch = git(['branch', '--show-current']);
  const head = git(['rev-parse', 'HEAD']);
  const origin = git(['rev-parse', 'origin/main']);
  const dirty = git(['status', '--porcelain', '--untracked-files=no'], false);
  if (branch !== 'main' || head !== origin || dirty.trim() !== '') {
    throw diagnosticError('Exact reviewed clean main is required', 'INTERNAL_D1_DIAG_REPOSITORY_INVALID', {
      branch,
      clean: dirty.trim() === '',
    });
  }
}

function git(args, required = true) {
  const result = spawnSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw diagnosticError('git preflight failed', 'INTERNAL_D1_DIAG_GIT_FAILED');
  const value = String(result.stdout ?? '').trim();
  if (required && !value) throw diagnosticError('git preflight returned empty output', 'INTERNAL_D1_DIAG_GIT_FAILED');
  return value;
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return typeof value === 'string' ? safeText(value) : value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/token|secret|authorization|payload/iu.test(key))
    .map(([key, nested]) => [key, sanitize(nested)]));
}

function diagnosticError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = Object.freeze(details);
  return error;
}
