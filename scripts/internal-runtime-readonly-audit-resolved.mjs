#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { chmod, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildWranglerOAuthEnvironment } from './lib/cloudflare-auth-environment.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';

const CONFIRMATION = 'AUDIT_INTERNAL_RUNTIME_WITH_EXACT_D1_RESOLUTION';
const TARGET_DATABASE = 'social-mkt-state-dev';
const TARGET_BINDING = 'MKT_STATE_DB';
const DEFAULT_CONFIG = 'wrangler.sync.jsonc';
const EXPECTED_FINGERPRINT_TABLES = Object.freeze([
  'd1_migrations',
  'sync_generation_fences',
  'sync_locks',
  'sync_runs',
  'sync_work_phases',
  'sync_work_runs',
]);

const execute = process.argv.slice(2).includes('--execute');

try {
  if (process.argv.slice(2).some((value) => value !== '--execute')) {
    throw auditError('Unsupported argument', 'INTERNAL_RESOLVED_AUDIT_ARGUMENT_INVALID');
  }
  if (!execute) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      mode: 'plan',
      status: 'INTERNAL_RUNTIME_RESOLVED_READONLY_AUDIT_PLAN',
      targetDatabase: TARGET_DATABASE,
      resolutionMode: 'exact-name-or-sole-schema-fingerprint',
      schemaFingerprintTableCount: EXPECTED_FINGERPRINT_TABLES.length,
      localConfigWrites: 0,
      providerReads: 0,
      d1Writes: 0,
      larkReads: 0,
      larkWrites: 0,
      queueSends: 0,
      customerBaseReads: 0,
      customerBaseWrites: 0,
    }, null, 2)}\n`);
    process.exit(0);
  }
  if (process.env.CONFIRM_INTERNAL_RUNTIME_RESOLVED_AUDIT !== CONFIRMATION) {
    throw auditError('Confirmation is missing', 'INTERNAL_RESOLVED_AUDIT_CONFIRMATION_REQUIRED');
  }

  assertReviewedMain();
  const root = resolve(process.cwd());
  const configPath = resolve(process.env.WRANGLER_CONFIG ?? resolve(root, DEFAULT_CONFIG));
  const configText = await readFile(configPath, 'utf8');
  const config = parseJsoncObject(configText);
  const bindingIndex = (config.d1_databases ?? []).findIndex((entry) => entry.binding === TARGET_BINDING);
  const binding = bindingIndex >= 0 ? config.d1_databases[bindingIndex] : null;
  if (!binding || binding.database_name !== TARGET_DATABASE) {
    throw auditError('Wrangler config is not the internal DEV target', 'INTERNAL_RESOLVED_AUDIT_TARGET_INVALID', {
      bindingFound: Boolean(binding),
      databaseName: binding?.database_name ?? null,
    });
  }

  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? resolve(root, '.dev.vars'));
  const env = buildWranglerOAuthEnvironment(Object.freeze({ ...fileEnv, ...process.env }));
  const databases = listDatabases(env, configPath);
  const exact = databases.filter((item) => item?.name === TARGET_DATABASE);
  const candidate = resolveCandidate(databases, exact);
  const resolvedId = String(candidate.database?.uuid ?? candidate.database?.id ?? '').trim();
  if (!isUuid(resolvedId)) {
    throw auditError('Resolved internal D1 has no valid database id', 'INTERNAL_RESOLVED_AUDIT_D1_ID_INVALID');
  }

  const configuredId = String(binding.database_id ?? '').trim();
  const resolvedName = String(candidate.database?.name ?? '').trim();
  const tempConfigPath = resolve(root, `.tmp-internal-runtime-audit-${process.pid}.jsonc`);
  const tempConfig = structuredClone(config);
  tempConfig.d1_databases[bindingIndex] = {
    ...tempConfig.d1_databases[bindingIndex],
    database_id: resolvedId,
  };

  try {
    await writeFile(tempConfigPath, `${JSON.stringify(tempConfig, null, 2)}\n`, { mode: 0o600 });
    await chmod(tempConfigPath, 0o600);

    const fingerprint = readSchemaFingerprint(env, tempConfigPath);
    const matched = EXPECTED_FINGERPRINT_TABLES.filter((name) => fingerprint.has(name));
    const missing = EXPECTED_FINGERPRINT_TABLES.filter((name) => !fingerprint.has(name));
    if (missing.length > 0) {
      throw auditError('Resolved D1 does not match the internal runtime schema fingerprint', 'INTERNAL_RESOLVED_AUDIT_SCHEMA_MISMATCH', {
        candidateDatabaseName: resolvedName || null,
        resolutionMode: candidate.mode,
        requiredTableCount: EXPECTED_FINGERPRINT_TABLES.length,
        matchedTableCount: matched.length,
        missingTables: missing,
      });
    }

    const child = spawnSync(process.execPath, ['scripts/internal-runtime-readonly-audit.mjs', '--execute'], {
      cwd: root,
      env: {
        ...env,
        WRANGLER_CONFIG: tempConfigPath,
        CONFIRM_INTERNAL_RUNTIME_READONLY_AUDIT: 'AUDIT_INTERNAL_RUNTIME_READONLY',
      },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });

    if (child.error || child.status !== 0) {
      throw auditError('Resolved internal audit failed', 'INTERNAL_RESOLVED_AUDIT_CHILD_FAILED', {
        exitCode: child.status ?? null,
        signal: child.signal ?? null,
        spawnError: child.error?.message ?? null,
        stdout: sanitizeText(child.stdout),
        stderr: sanitizeText(child.stderr),
      });
    }

    const payload = JSON.parse(String(child.stdout ?? '').trim());
    process.stdout.write(`${JSON.stringify({
      ...payload,
      resolution: {
        mode: candidate.mode,
        exactNameMatchCount: exact.length,
        listedDatabaseCount: databases.length,
        resolvedDatabaseName: resolvedName || null,
        databaseNameRenamed: resolvedName !== TARGET_DATABASE,
        configuredDatabaseIdStale: configuredId !== resolvedId,
        schemaFingerprintMatched: true,
        schemaFingerprintTableCount: matched.length,
        temporaryConfigUsed: true,
        persistentConfigChanged: false,
      },
      localConfigWrites: 0,
    }, null, 2)}\n`);
  } finally {
    await rm(tempConfigPath, { force: true });
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'INTERNAL_RESOLVED_AUDIT_FAILED',
    message: error?.message ?? String(error),
    details: sanitize(error?.details ?? {}),
    localConfigWrites: 0,
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

function resolveCandidate(databases, exact) {
  if (exact.length === 1) {
    return Object.freeze({ database: exact[0], mode: 'wrangler-d1-list-exact-name' });
  }
  if (exact.length === 0 && databases.length === 1) {
    return Object.freeze({ database: databases[0], mode: 'wrangler-d1-list-sole-schema-fingerprint' });
  }
  throw auditError('Internal D1 cannot be resolved uniquely from the Cloudflare account', 'INTERNAL_RESOLVED_AUDIT_D1_NOT_UNIQUE', {
    exactNameMatchCount: exact.length,
    listedDatabaseCount: databases.length,
  });
}

function listDatabases(env, configPath) {
  const result = spawnSync('npx', ['wrangler', 'd1', 'list', '--json', '--config', configPath], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw auditError('Wrangler D1 list failed', 'INTERNAL_RESOLVED_AUDIT_D1_LIST_FAILED', {
      exitCode: result.status ?? null,
      signal: result.signal ?? null,
      spawnError: result.error?.message ?? null,
      stdout: sanitizeText(result.stdout),
      stderr: sanitizeText(result.stderr),
    });
  }
  const value = parseJsonSuffix(result.stdout);
  if (!Array.isArray(value)) {
    throw auditError('Wrangler D1 list output is not an array', 'INTERNAL_RESOLVED_AUDIT_D1_LIST_INVALID');
  }
  return value;
}

function readSchemaFingerprint(env, configPath) {
  const quoted = EXPECTED_FINGERPRINT_TABLES.map((name) => `'${name}'`).join(', ');
  const sql = `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${quoted}) ORDER BY name`;
  const result = spawnSync('npx', [
    'wrangler', 'd1', 'execute', TARGET_DATABASE,
    '--remote', '--json', '--config', configPath, '--command', sql,
  ], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw auditError('Wrangler D1 schema fingerprint read failed', 'INTERNAL_RESOLVED_AUDIT_SCHEMA_READ_FAILED', {
      exitCode: result.status ?? null,
      signal: result.signal ?? null,
      spawnError: result.error?.message ?? null,
      stdout: sanitizeText(result.stdout),
      stderr: sanitizeText(result.stderr),
    });
  }
  const value = parseJsonSuffix(result.stdout);
  const envelopes = Array.isArray(value) ? value : [value];
  if (envelopes.length === 0 || envelopes.some((item) => item?.success === false)) {
    throw auditError('D1 schema fingerprint query reported failure', 'INTERNAL_RESOLVED_AUDIT_SCHEMA_RESPONSE_FAILED');
  }
  return new Set(envelopes.flatMap((item) => item?.results ?? []).map((row) => row?.name).filter(Boolean));
}

function parseJsonSuffix(output) {
  const text = String(output ?? '').trim();
  const starts = [text.lastIndexOf('\n['), text.lastIndexOf('\n{')]
    .map((index) => (index < 0 ? index : index + 1))
    .filter((index) => index >= 0);
  const start = starts.length > 0
    ? Math.max(...starts)
    : (text.startsWith('[') || text.startsWith('{') ? 0 : -1);
  if (start < 0) throw auditError('Wrangler output has no JSON result', 'INTERNAL_RESOLVED_AUDIT_JSON_INVALID');
  try {
    return JSON.parse(text.slice(start));
  } catch {
    throw auditError('Wrangler output JSON is invalid', 'INTERNAL_RESOLVED_AUDIT_JSON_INVALID');
  }
}

function assertReviewedMain() {
  const branch = git(['branch', '--show-current']);
  const head = git(['rev-parse', 'HEAD']);
  const origin = git(['rev-parse', 'origin/main']);
  const dirty = git(['status', '--porcelain', '--untracked-files=no'], false);
  if (branch !== 'main' || head !== origin || dirty.trim() !== '') {
    throw auditError('Exact reviewed clean main is required', 'INTERNAL_RESOLVED_AUDIT_REPOSITORY_INVALID', {
      branch,
      clean: dirty.trim() === '',
    });
  }
}

function git(args, required = true) {
  const result = spawnSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw auditError('git preflight failed', 'INTERNAL_RESOLVED_AUDIT_GIT_FAILED');
  const value = String(result.stdout ?? '').trim();
  if (required && !value) throw auditError('git preflight returned empty output', 'INTERNAL_RESOLVED_AUDIT_GIT_FAILED');
  return value;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function sanitizeText(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [REDACTED]')
    .replace(/(?:token|secret|authorization)\s*[:=]\s*[^\s,}\]]+/giu, '$1=[REDACTED]')
    .slice(0, 6000);
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/token|secret|authorization|payload|databaseId|uuid/iu.test(key))
    .map(([key, nested]) => [key, sanitize(nested)]));
}

function auditError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = Object.freeze(details);
  return error;
}
