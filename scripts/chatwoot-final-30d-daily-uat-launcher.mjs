#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import {
  CHATWOOT_FINAL_UAT_CONFIRMATION,
  CHATWOOT_FINAL_UAT_SUCCESS_MARKER,
  sha256,
} from './lib/chatwoot-final-30d-daily-uat.js';

const ROOT = resolve(process.cwd());
const EXECUTE_ARGUMENT = '--execute';
const LOCK_SCOPE = 'integration_workspace:chatwoot:chemistry_k:%';

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'CHATWOOT_FINAL_UAT_LAUNCHER_FAILED',
    message: error?.message ?? String(error),
    details: error?.details ?? {},
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== EXECUTE_ARGUMENT)) {
    throw launcherError('Unknown Chatwoot final UAT launcher argument', 'CHATWOOT_FINAL_UAT_ARGUMENT_INVALID');
  }
  if (!args.includes(EXECUTE_ARGUMENT)) {
    runCore([], { stdio: 'inherit' });
    process.stdout.write(`${JSON.stringify({
      authoritativeCommand: `${CHATWOOT_FINAL_UAT_CONFIRMATION.envName}=${CHATWOOT_FINAL_UAT_CONFIRMATION.value} node scripts/chatwoot-final-30d-daily-uat-launcher.mjs --execute`,
      exactLockScope: LOCK_SCOPE,
      remoteActionsPerformed: false,
    }, null, 2)}\n`);
    return;
  }

  const env = Object.freeze({
    ...await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars'),
    ...process.env,
  });
  if (env[CHATWOOT_FINAL_UAT_CONFIRMATION.envName] !== CHATWOOT_FINAL_UAT_CONFIRMATION.value) {
    throw launcherError(
      `Chatwoot final UAT requires ${CHATWOOT_FINAL_UAT_CONFIRMATION.envName}=${CHATWOOT_FINAL_UAT_CONFIRMATION.value}`,
      'CHATWOOT_FINAL_UAT_CONFIRMATION_REQUIRED',
    );
  }

  const before = readExactActiveLockCount(env);
  if (before !== 0) {
    throw launcherError(
      'Exact Chatwoot Shared Reliability lock scope is active before UAT',
      'CHATWOOT_FINAL_UAT_ACTIVE_LOCK_BLOCKED',
      { activeLockCount: before },
    );
  }

  runCore([EXECUTE_ARGUMENT], { env, stdio: 'inherit' });

  const after = readExactActiveLockCount(env);
  if (after !== 0) {
    throw launcherError(
      'Exact Chatwoot Shared Reliability lock remains active after Safe closeout',
      'CHATWOOT_FINAL_UAT_POST_CLOSEOUT_LOCK_ACTIVE',
      { activeLockCount: after },
    );
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    marker: CHATWOOT_FINAL_UAT_SUCCESS_MARKER,
    exactLockScopeVerified: true,
    activeLockCount: 0,
    scheduleEnabled: false,
    webhookEnabled: false,
    production: false,
  }, null, 2)}\n`);
}

function readExactActiveLockCount(env) {
  const configPath = env.MKT_CHATWOOT_FINAL_UAT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc';
  const databaseName = env.MKT_CHATWOOT_FINAL_UAT_DATABASE_NAME ?? 'social-mkt-state-dev';
  const sql = [
    'SELECT COUNT(*) AS active_chatwoot_locks',
    'FROM sync_locks',
    `WHERE lock_key LIKE '${LOCK_SCOPE}'`,
    "AND expires_at > unixepoch('now') * 1000;",
  ].join(' ');
  const output = run('npx', [
    'wrangler', 'd1', 'execute', databaseName,
    '--remote', '--json', '--config', configPath,
    '--command', sql,
  ], { env });
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch (cause) {
    throw launcherError(
      'Exact Chatwoot lock read returned invalid JSON',
      'CHATWOOT_FINAL_UAT_LOCK_READ_INVALID',
      { outputFingerprint: sha256(output), cause: cause?.message ?? 'JSON_PARSE_FAILED' },
    );
  }
  const row = Array.isArray(parsed)
    ? parsed.flatMap((item) => item?.results ?? [])[0]
    : parsed?.results?.[0];
  const count = Number(row?.active_chatwoot_locks);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw launcherError(
      'Exact Chatwoot lock count is invalid',
      'CHATWOOT_FINAL_UAT_LOCK_READ_INVALID',
    );
  }
  return count;
}

function runCore(args, options = {}) {
  return run('node', ['scripts/chatwoot-final-30d-daily-uat.mjs', ...args], options);
}

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: ROOT,
      env: { ...process.env, ...(options.env ?? {}) },
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    });
  } catch (cause) {
    throw launcherError(
      `Command failed: ${command} ${args.join(' ')}`,
      'CHATWOOT_FINAL_UAT_COMMAND_FAILED',
      {
        command,
        exitCode: cause?.status ?? null,
        stderrFingerprint: cause?.stderr ? sha256(String(cause.stderr)) : null,
      },
    );
  }
}

function launcherError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootFinalUatLauncherError';
  error.code = code;
  error.details = details;
  return error;
}
