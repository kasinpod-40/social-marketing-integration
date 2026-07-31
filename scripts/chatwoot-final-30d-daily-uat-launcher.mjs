#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { readDevVars } from './lib/dev-vars.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { resolveChatwootFinalLarkAutoMappings } from './lib/chatwoot-final-lark-auto-mapping.js';
import { rebaseGeneratedWranglerConfigPaths } from './lib/rebase-generated-wrangler-config-paths.js';
import {
  CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS,
  CHATWOOT_FINAL_UAT_CONFIRMATION,
  CHATWOOT_FINAL_UAT_LOCKED_VARS,
  CHATWOOT_FINAL_UAT_SUCCESS_MARKER,
  sha256,
} from './lib/chatwoot-final-30d-daily-uat.js';

const ROOT = resolve(process.cwd());
const EXECUTE_ARGUMENT = '--execute';
const LOCK_SCOPE = 'integration_workspace:chatwoot:chemistry_k:%';
const DATABASE_NAME = 'social-mkt-state-dev';
const UNSAFE_TARGET_OVERRIDES = new Set([
  'MKT_CHATWOOT_FINAL_UAT_DATABASE_NAME',
  'MKT_CHATWOOT_FINAL_UAT_QUEUE_ID',
]);
const SAFE_COMPATIBILITY_LIMITS = Object.freeze({
  CHATWOOT_API_MAX_PAGES: '1000',
  CHATWOOT_MAX_REPORTING_EVENTS: '100000',
});
let normalizedConfigPath = null;

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
} finally {
  if (normalizedConfigPath) await rm(normalizedConfigPath, { force: true }).catch(() => undefined);
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
      exactDatabaseName: DATABASE_NAME,
      ignoredConfigNormalization: true,
      autoResolveChatwootLarkMappings: true,
      remoteActionsPerformed: false,
    }, null, 2)}\n`);
    return;
  }

  const sourceEnv = Object.freeze({
    ...await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars'),
    ...process.env,
  });
  if (sourceEnv[CHATWOOT_FINAL_UAT_CONFIRMATION.envName] !== CHATWOOT_FINAL_UAT_CONFIRMATION.value) {
    throw launcherError(
      `Chatwoot final UAT requires ${CHATWOOT_FINAL_UAT_CONFIRMATION.envName}=${CHATWOOT_FINAL_UAT_CONFIRMATION.value}`,
      'CHATWOOT_FINAL_UAT_CONFIRMATION_REQUIRED',
    );
  }

  const larkMappings = await resolveLarkTableMappings(sourceEnv);
  normalizedConfigPath = await createNormalizedRuntimeConfig(sourceEnv, larkMappings);
  const safeSourceEnv = Object.fromEntries(
    Object.entries(sourceEnv).filter(([name]) => !UNSAFE_TARGET_OVERRIDES.has(name)),
  );
  const env = Object.freeze({
    ...safeSourceEnv,
    MKT_CHATWOOT_FINAL_UAT_WRANGLER_CONFIG: normalizedConfigPath,
  });

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
    exactDatabaseVerified: true,
    exactQueueResolvedByName: true,
    larkTableMappingsResolved: larkMappings.tableCount,
    larkStaleMappingRepairs: larkMappings.staleMappingRepairCount,
    activeLockCount: 0,
    ignoredConfigNormalized: true,
    scheduleEnabled: false,
    webhookEnabled: false,
    production: false,
  }, null, 2)}\n`);
}

async function resolveLarkTableMappings(env) {
  const sourcePath = inside(env.MKT_CHATWOOT_FINAL_UAT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc');
  const sourceText = await readFile(sourcePath, 'utf8');
  const sourceConfig = parseJsoncObject(sourceText);
  const discoveryEnv = Object.freeze({
    ...(sourceConfig.vars ?? {}),
    ...env,
  });
  const client = createLarkBitableClientFromEnv(discoveryEnv);
  const remoteTables = await client.listTables();
  return resolveChatwootFinalLarkAutoMappings({
    env: discoveryEnv,
    remoteTables,
  });
}

async function createNormalizedRuntimeConfig(env, larkMappings) {
  const sourcePath = inside(env.MKT_CHATWOOT_FINAL_UAT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc');
  const sourceText = await readFile(sourcePath, 'utf8');
  const config = parseJsoncObject(sourceText);
  config.vars ??= {};

  // Table IDs are resolved from exact reviewed Blueprint names/aliases and written only into this
  // private ignored config. The user's .dev.vars and wrangler.sync.jsonc are never edited.
  Object.assign(config.vars, larkMappings.values);

  // The ignored local config may predate the merged Runtime wiring. Populate the reviewed Safe
  // names in the private generated config only; the inner operator later opens exactly these four.
  for (const name of CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS) config.vars[name] = 'false';

  for (const [name, expected] of Object.entries(CHATWOOT_FINAL_UAT_LOCKED_VARS)) {
    const existing = config.vars[name];
    if (existing !== null && existing !== undefined && existing !== '' && String(existing) !== expected) {
      throw launcherError(
        `${name} conflicts with the locked Chatwoot runtime contract`,
        'CHATWOOT_FINAL_UAT_LOCAL_CONFIG_CONFLICT',
        { fieldName: name },
      );
    }
    config.vars[name] = expected;
  }

  // Replace retired local pagination limits in the private generated config only. These exact
  // bounds are already reviewed in the merged Runtime examples and are required by the verified
  // 304 Conversation / 1,125 Reporting page inventories.
  Object.assign(config.vars, SAFE_COMPATIBILITY_LIMITS);

  for (const [name, expected] of [
    ['MKT_SCHEDULE_CHATWOOT_ENABLED', 'false'],
    ['MKT_CHATWOOT_WEBHOOK_ENABLED', 'false'],
  ]) {
    const existing = config.vars[name];
    if (existing !== null && existing !== undefined && existing !== ''
        && String(existing).toLowerCase() !== expected) {
      throw launcherError(
        `${name} must remain false`,
        'CHATWOOT_FINAL_UAT_LOCAL_CONFIG_CONFLICT',
        { fieldName: name },
      );
    }
    config.vars[name] = expected;
  }

  delete config.vars.CHATWOOT_INCREMENTAL_OVERLAP_HOURS;

  const directory = inside(join('outputs', 'chatwoot-final-30d-daily-uat', '.launcher'));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `wrangler-normalized-${Date.now()}-${process.pid}.json`);
  const normalizedText = `${JSON.stringify(config, null, 2)}\n`;
  const rebased = rebaseGeneratedWranglerConfigPaths(normalizedText, {
    sourceDirectory: dirname(sourcePath),
    outputDirectory: directory,
  });
  await writeFile(path, rebased.text, { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

function readExactActiveLockCount(env) {
  const configPath = env.MKT_CHATWOOT_FINAL_UAT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc';
  const sql = [
    'SELECT COUNT(*) AS active_chatwoot_locks',
    'FROM sync_locks',
    `WHERE lock_key LIKE '${LOCK_SCOPE}'`,
    "AND expires_at > unixepoch('now') * 1000;",
  ].join(' ');
  const output = run('npx', [
    'wrangler', 'd1', 'execute', DATABASE_NAME,
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

function inside(value) {
  const path = resolve(ROOT, value);
  if (relative(ROOT, path).startsWith('..')) {
    throw launcherError('Path leaves Repository', 'CHATWOOT_FINAL_UAT_PATH_INVALID');
  }
  return path;
}

function launcherError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootFinalUatLauncherError';
  error.code = code;
  error.details = details;
  return error;
}
