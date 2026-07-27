#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import {
  buildWooCommerceIsolatedMigrationConfig,
  classifyWooCommercePendingMigrations,
  resolveWooCommerceQueueId,
  validateWooCommercePreMigrationState,
} from './lib/woocommerce-final-one-command.js';

const repositoryRoot = resolve(process.cwd());
const outputRoot = resolve(
  process.env.MKT_WOOCOMMERCE_FINAL_EVIDENCE_DIR
    ?? 'outputs/woocommerce-final-rollout',
);
const CONFIRMATION_NAME = 'CONFIRM_WOOCOMMERCE_FINAL_ROLLOUT';
const CONFIRMATION_VALUE = 'EXECUTE_WOOCOMMERCE_FINAL_ROLLOUT';
const MIGRATION_0017 = '0017_woocommerce_commerce.sql';

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'WOOCOMMERCE_FINAL_ONE_COMMAND_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  const execute = process.argv.slice(2).includes('--execute');
  if (!execute) {
    printPlan();
    return;
  }

  const env = await loadEnvironment();
  requireExact(env[CONFIRMATION_NAME], CONFIRMATION_VALUE, CONFIRMATION_NAME);
  requireExact(env.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  requireExact(env.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');

  const repositoryHead = gitText(['rev-parse', 'HEAD']).trim();
  const workingTree = gitText(['status', '--porcelain', '--untracked-files=all'], false);
  if (workingTree.trim() !== '') {
    throw commandError(
      'WooCommerce final one-command requires a clean Working Tree',
      'WOOCOMMERCE_FINAL_REPOSITORY_DIRTY',
    );
  }

  const configPath = resolveRepositoryFile(
    env.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
  );
  const configText = await readFile(configPath, 'utf8');
  const databaseName = env.MKT_WOOCOMMERCE_ROLLOUT_DATABASE_NAME
    ?? 'social-mkt-state-dev';
  const mainQueueName = env.MKT_MAIN_QUEUE_NAME ?? 'social-mkt-sync-jobs';
  const accountId = requireText(env.CLOUDFLARE_ACCOUNT_ID, 'CLOUDFLARE_ACCOUNT_ID');
  const apiToken = requireText(env.CLOUDFLARE_API_TOKEN, 'CLOUDFLARE_API_TOKEN');
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });

  wrangler(['whoami'], { env: { ...env, CLOUDFLARE_ACCOUNT_ID: accountId } });
  const queueId = env.MKT_WOOCOMMERCE_FINAL_QUEUE_ID
    ?? resolveWooCommerceQueueId(
      wranglerText(['queues', 'list', '--json'], {
        env: { ...env, CLOUDFLARE_ACCOUNT_ID: accountId },
      }),
      mainQueueName,
    );

  const migrationState = classifyWooCommercePendingMigrations(
    wranglerText([
      'd1', 'migrations', 'list', databaseName,
      '--remote', '--config', configPath,
    ], { env: { ...env, CLOUDFLARE_ACCOUNT_ID: accountId } }),
  );
  const beforeState = readD1Row({
    databaseName,
    configPath,
    env: { ...env, CLOUDFLARE_ACCOUNT_ID: accountId },
    sql: buildPreMigrationSql(),
  });
  validateWooCommercePreMigrationState(beforeState, migrationState);

  let migrationEvidence = {
    applied: false,
    migration0017Pending: false,
    pendingBefore: migrationState.pending,
    pendingAfter: migrationState.pending,
  };
  if (migrationState.migration0017Pending) {
    migrationEvidence = await applyIsolatedMigration0017({
      accountId,
      configPath,
      configText,
      databaseName,
      env,
      migrationState,
    });
  }

  const preparation = {
    contractVersion: 'woocommerce_final_one_command_v1',
    preparedAt: new Date().toISOString(),
    repositoryHead,
    databaseName,
    mainQueueName,
    queueIdFingerprint: sha256(queueId),
    migration: migrationEvidence,
    remoteMutationCount: migrationEvidence.applied ? 1 : 0,
    production: false,
  };
  await writePrivateJson(
    join(outputRoot, '00-one-command-preparation.json'),
    preparation,
  );

  const childEnv = {
    ...env,
    ...process.env,
    [CONFIRMATION_NAME]: CONFIRMATION_VALUE,
    MKT_WOOCOMMERCE_FINAL_REPOSITORY_HEAD: repositoryHead,
    MKT_WOOCOMMERCE_FINAL_QUEUE_ID: queueId,
    CLOUDFLARE_ACCOUNT_ID: accountId,
    CLOUDFLARE_API_TOKEN: apiToken,
  };
  const result = spawnSync(
    process.execPath,
    ['scripts/woocommerce-final-rollout-operator.mjs', '--execute'],
    {
      cwd: repositoryRoot,
      env: childEnv,
      stdio: 'inherit',
    },
  );
  if (result.error || result.status !== 0) {
    throw commandError(
      'WooCommerce final rollout operator did not complete successfully',
      'WOOCOMMERCE_FINAL_CHILD_OPERATOR_FAILED',
      { status: result.status },
    );
  }
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    executed: false,
    contractVersion: 'woocommerce_final_one_command_v1',
    command: `${CONFIRMATION_NAME}=${CONFIRMATION_VALUE} node scripts/woocommerce-final-one-command.mjs --execute`,
    automaticInputs: [
      'current clean Git HEAD',
      'exact main Queue ID',
      'Migration 0017 pending state',
    ],
    guardedActions: [
      'pre-Migration D1 backup',
      'isolated Migration 0017 apply only when pending',
      'delegate full final rollout and automatic safe restore',
    ],
    neverAppliedByWrapper: ['0018_chatwoot_analytics.sql'],
  }, null, 2)}\n`);
}

async function applyIsolatedMigration0017(input) {
  const migrationRoot = join(outputRoot, 'isolated-migration-0017');
  const backupRoot = join(outputRoot, 'backups');
  await rm(migrationRoot, { recursive: true, force: true });
  await mkdir(migrationRoot, { recursive: true, mode: 0o700 });
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });

  const backupPath = join(
    backupRoot,
    `social-mkt-state-dev-before-0017-${Date.now()}.sql`,
  );
  wrangler([
    'd1', 'export', input.databaseName,
    '--remote', '--config', input.configPath,
    '--output', backupPath, '--skip-confirmation',
  ], { env: { ...input.env, CLOUDFLARE_ACCOUNT_ID: input.accountId } });
  await chmod(backupPath, 0o600);
  const backup = await readFile(backupPath);
  if (backup.length === 0) {
    throw commandError(
      'Pre-Migration 0017 D1 backup is empty',
      'WOOCOMMERCE_FINAL_BACKUP_EMPTY',
    );
  }

  await copyFile(
    resolve(repositoryRoot, 'migrations', MIGRATION_0017),
    join(migrationRoot, MIGRATION_0017),
  );
  const generatedConfig = buildWooCommerceIsolatedMigrationConfig({
    configText: input.configText,
    migrationsDir: relative(repositoryRoot, migrationRoot),
  });
  const generatedConfigPath = join(
    repositoryRoot,
    `.woocommerce-0017-${process.pid}-${Date.now()}.jsonc`,
  );
  try {
    await writeFile(generatedConfigPath, generatedConfig, { mode: 0o600 });
    wrangler([
      'd1', 'migrations', 'apply', input.databaseName,
      '--remote', '--config', generatedConfigPath,
    ], {
      env: {
        ...input.env,
        CI: 'true',
        CLOUDFLARE_ACCOUNT_ID: input.accountId,
      },
    });
  } finally {
    await rm(generatedConfigPath, { force: true });
  }

  const afterMigrations = classifyWooCommercePendingMigrations(
    wranglerText([
      'd1', 'migrations', 'list', input.databaseName,
      '--remote', '--config', input.configPath,
    ], { env: { ...input.env, CLOUDFLARE_ACCOUNT_ID: input.accountId } }),
  );
  if (afterMigrations.migration0017Pending) {
    throw commandError(
      'Migration 0017 remains pending after isolated apply',
      'WOOCOMMERCE_FINAL_MIGRATION_0017_REMAINS_PENDING',
      { pendingAfter: afterMigrations.pending },
    );
  }
  const afterState = readD1Row({
    databaseName: input.databaseName,
    configPath: input.configPath,
    env: { ...input.env, CLOUDFLARE_ACCOUNT_ID: input.accountId },
    sql: buildPreMigrationSql(),
  });
  validateWooCommercePreMigrationState(afterState, afterMigrations);
  return {
    applied: true,
    migration0017Pending: true,
    pendingBefore: input.migrationState.pending,
    pendingAfter: afterMigrations.pending,
    backup: {
      file: relative(repositoryRoot, backupPath),
      bytes: backup.length,
      sha256: createHash('sha256').update(backup).digest('hex'),
    },
  };
}

function buildPreMigrationSql() {
  return `SELECT
    (SELECT COUNT(*) FROM sqlite_master
      WHERE (type='table' AND name LIKE 'raw_commerce_%')
         OR (type='table' AND name LIKE 'commerce_%')) AS commerce_table_count,
    (SELECT COUNT(*) FROM sqlite_master
      WHERE (type='index' AND name LIKE 'idx_raw_commerce_%')
         OR (type='index' AND name LIKE 'idx_commerce_%')) AS commerce_index_count,
    (SELECT COUNT(*) FROM sync_work_runs
      WHERE lifecycle_status='active') AS active_work,
    (SELECT COUNT(*) FROM sync_locks
      WHERE expires_at > unixepoch('now') * 1000) AS active_locks;`
    .replace(/\s+/gu, ' ')
    .trim();
}

function readD1Row(input) {
  const output = wranglerText([
    'd1', 'execute', input.databaseName,
    '--remote', '--json', '--config', input.configPath,
    '--command', input.sql,
  ], { env: input.env });
  const parsed = JSON.parse(output);
  const row = Array.isArray(parsed)
    ? parsed.flatMap((entry) => entry?.results ?? [])[0]
    : parsed?.results?.[0];
  if (!row) {
    throw commandError(
      'Remote D1 pre-Migration query returned no row',
      'WOOCOMMERCE_FINAL_D1_QUERY_EMPTY',
    );
  }
  return row;
}

async function loadEnvironment() {
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  return Object.freeze({ ...fileEnv, ...process.env });
}

function wranglerText(args, options = {}) {
  return wrangler(args, options).stdout;
}

function wrangler(args, options = {}) {
  const result = spawnSync(
    'npx',
    ['wrangler', ...args],
    {
      cwd: repositoryRoot,
      env: { ...process.env, ...(options.env ?? {}) },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (result.error || result.status !== 0) {
    throw commandError(
      `npx wrangler ${args.join(' ')} failed`,
      'WOOCOMMERCE_FINAL_WRANGLER_COMMAND_FAILED',
      {
        status: result.status,
        stderrSha256: sha256(result.stderr ?? ''),
      },
    );
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function gitText(args, trim = true) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    throw commandError(
      `git ${args.join(' ')} failed`,
      'WOOCOMMERCE_FINAL_GIT_COMMAND_FAILED',
      { status: result.status },
    );
  }
  return trim ? (result.stdout ?? '').trim() : (result.stdout ?? '');
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(sanitize(value), null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(path, 0o600);
}

function resolveRepositoryFile(value) {
  const path = resolve(repositoryRoot, requireText(value, 'configPath'));
  if (path !== repositoryRoot && !path.startsWith(`${repositoryRoot}/`)) {
    throw commandError(
      'Wrangler config path must remain inside Repository',
      'WOOCOMMERCE_FINAL_PATH_INVALID',
    );
  }
  return path;
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw commandError(
      `${fieldName} must equal ${expected}`,
      'WOOCOMMERCE_FINAL_TARGET_INVALID',
      { fieldName, expected },
    );
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw commandError(
      `${fieldName} is required`,
      'WOOCOMMERCE_FINAL_ONE_COMMAND_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return value.trim();
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/(?:secret|token|password|authorization|consumer_key|consumer_secret)/iu.test(key)) {
      continue;
    }
    output[key] = sanitize(nested);
  }
  return output;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function commandError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommerceFinalOneCommandError';
  error.code = code;
  error.details = details;
  return error;
}
