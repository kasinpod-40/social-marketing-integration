#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { buildWranglerOAuthEnvironment } from './lib/cloudflare-auth-environment.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  D1_CAPACITY_AUDIT_VERSION,
  buildD1GrowthSql,
  buildD1TableCountSql,
  buildD1WritesByPlatformSql,
  summarizeD1Capacity,
} from './lib/d1-capacity-audit.js';

const CONFIRMATION = 'INSPECT_REMOTE_D1_CAPACITY_READ_ONLY';
const execute = process.argv.slice(2).includes('--execute');

try {
  if (process.argv.slice(2).some((value) => value !== '--execute')) throw auditError('Unsupported argument', 'D1_CAPACITY_ARGUMENT_INVALID');
  if (!execute) {
    process.stdout.write(`${JSON.stringify({
      ok: true, mode: 'plan', contractVersion: D1_CAPACITY_AUDIT_VERSION,
      remoteMutations: 0, nextCommand: `CONFIRM_D1_CAPACITY_AUDIT=${CONFIRMATION} node scripts/d1-capacity-audit.mjs --execute`,
    }, null, 2)}\n`);
    process.exit(0);
  }
  if (process.env.CONFIRM_D1_CAPACITY_AUDIT !== CONFIRMATION) throw auditError('Confirmation is missing', 'D1_CAPACITY_CONFIRMATION_REQUIRED');

  const root = resolve(process.cwd());
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? resolve(root, '.dev.vars'));
  const env = buildWranglerOAuthEnvironment(Object.freeze({ ...fileEnv, ...process.env }));
  const configPath = resolve(process.env.WRANGLER_CONFIG ?? resolve(root, 'wrangler.sync.jsonc'));
  const countsResult = runD1(env, configPath, buildD1TableCountSql());
  const growthResult = runD1(env, configPath, buildD1GrowthSql());
  const writesResult = runD1(env, configPath, buildD1WritesByPlatformSql());
  const migrationText = await readMigrations(resolve(root, 'migrations'));
  const indexCount = [...migrationText.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+[A-Za-z0-9_]+/giu)].length;
  const summary = summarizeD1Capacity({
    databaseBytes: Math.max(countsResult.databaseBytes, growthResult.databaseBytes, writesResult.databaseBytes),
    indexCount,
    counts: countsResult.rows,
    growth: growthResult.rows,
    writesByPlatform: writesResult.rows,
  });
  const evidencePath = resolve(process.env.MKT_D1_CAPACITY_EVIDENCE_PATH
    ?? '/private/tmp/social-mkt-d1-capacity-audit-20260815.json');
  await writePrivateJson(evidencePath, {
    ...summary,
    generatedAt: new Date().toISOString(),
    queryDurationMs: Object.freeze({
      counts: countsResult.queryDurationMs,
      growth: growthResult.queryDurationMs,
      writes: writesResult.queryDurationMs,
    }),
    remoteMutations: 0,
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    ...summary,
    counts: undefined,
    projections: summary.projections,
    evidencePath,
    remoteMutations: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false, code: error?.code ?? 'D1_CAPACITY_AUDIT_FAILED', message: error?.message ?? String(error),
    details: error?.details ?? {}, remoteMutations: 0, production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function runD1(env, configPath, sql) {
  const result = spawnSync('npx', ['wrangler', 'd1', 'execute', 'social-mkt-state-dev', '--remote', '--json', '--config', configPath, '--command', sql], {
    cwd: process.cwd(), env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw auditError('Wrangler D1 command failed', 'D1_CAPACITY_D1_FAILED', { exitCode: result.status ?? null });
  let value;
  try { value = JSON.parse(result.stdout); }
  catch { throw auditError('Wrangler D1 output is not JSON', 'D1_CAPACITY_D1_OUTPUT_INVALID'); }
  if (value?.error) throw auditError('Wrangler D1 response reported an error', 'D1_CAPACITY_D1_RESPONSE_FAILED');
  const envelopes = Array.isArray(value) ? value : [value];
  if (envelopes.some((item) => item?.success === false)) throw auditError('D1 query failed', 'D1_CAPACITY_D1_RESPONSE_FAILED');
  return Object.freeze({
    rows: Object.freeze(envelopes.flatMap((item) => item?.results ?? [])),
    databaseBytes: Math.max(0, ...envelopes.map((item) => Number(item?.meta?.size_after ?? 0))),
    queryDurationMs: envelopes.reduce((sum, item) => sum + Number(item?.meta?.timings?.sql_duration_ms ?? 0), 0),
  });
}

async function readMigrations(directory) {
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  return (await Promise.all(files.map((name) => readFile(join(directory, name), 'utf8')))).join('\n');
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

function auditError(message, code, details = {}) {
  const error = new Error(message); error.code = code; error.details = Object.freeze(details); return error;
}
