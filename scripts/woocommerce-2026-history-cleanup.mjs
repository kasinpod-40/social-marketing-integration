#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readDevVars } from './lib/dev-vars.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { createWooCommerceLarkSchemaContract } from './lib/woocommerce-final-rollout-operator.js';
import {
  WOOCOMMERCE_2026_CLEANUP_TABLES,
  WOOCOMMERCE_2026_CLEANUP_CONFIRMATION,
  assertWooCommerce2026CleanupConfirmation,
  buildWooCommerce2026CleanupDeleteStatements,
  buildWooCommerce2026CleanupKeysSql,
  buildWooCommerce2026CleanupVerifySql,
  selectWooCommerce2026CleanupLarkRecords,
  summarizeWooCommerce2026CleanupParity,
  validateWooCommerce2026CleanupFinal,
  validateWooCommerce2026CleanupKeys,
} from './lib/woocommerce-2026-history-cleanup.js';

const repositoryRoot = resolve(process.cwd());
const outputRoot = resolve(
  process.env.MKT_WOOCOMMERCE_2026_CLEANUP_EVIDENCE_DIR
    ?? 'outputs/woocommerce-2026-history-cleanup',
);
const databaseName = 'social-mkt-state-dev';
const configPath = resolve('wrangler.sync.jsonc');

try {
  if (!process.argv.slice(2).includes('--execute')) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      executed: false,
      confirmation: `CONFIRM_WOOCOMMERCE_2026_HISTORY_CLEANUP=${WOOCOMMERCE_2026_CLEANUP_CONFIRMATION}`,
      cutoff: '2026-01-01T00:00:00.000Z',
      d1Tables: 9,
      larkTables: WOOCOMMERCE_2026_CLEANUP_TABLES.length,
      backupRequired: true,
      production: false,
    }, null, 2)}\n`);
  } else {
    await execute();
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'WOOCOMMERCE_2026_CLEANUP_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    production: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function execute() {
  const env = Object.freeze({
    ...await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars'),
    ...process.env,
  });
  assertWooCommerce2026CleanupConfirmation(env);
  requireExact(env.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  requireExact(env.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');
  const status = git(['status', '--porcelain', '--untracked-files=all']);
  if (status.trim() !== '') throw cleanupError(
    'WooCommerce 2026 cleanup requires a clean Working Tree',
    'WOOCOMMERCE_2026_CLEANUP_REPOSITORY_DIRTY',
  );

  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const before = firstRow(runD1(buildWooCommerce2026CleanupVerifySql(), env));
  if (Number(before.active_woocommerce_locks ?? -1) !== 0) {
    throw cleanupError(
      'Active WooCommerce lock blocks 2026 cleanup',
      'WOOCOMMERCE_2026_CLEANUP_ACTIVE_LOCK',
    );
  }

  const lark = createLarkBitableClientFromEnv(env);
  const liveTables = await lark.listTables();
  const tableIdByName = new Map(liveTables.map((table) => [table.name, table.tableId]));
  const schemaByKey = new Map(createWooCommerceLarkSchemaContract()
    .map((contract) => [contract.tableKey, contract]));
  const d1KeysByTable = new Map(WOOCOMMERCE_2026_CLEANUP_TABLES.map((contract) => [
    contract.tableKey,
    validateWooCommerce2026CleanupKeys(
      rows(runD1(buildWooCommerce2026CleanupKeysSql(contract), env)),
      contract,
    ),
  ]));
  const liveByTable = new Map();
  for (const contract of WOOCOMMERCE_2026_CLEANUP_TABLES) {
    const schema = schemaByKey.get(contract.tableKey);
    const tableId = tableIdByName.get(schema?.tableName);
    if (!schema || !tableId || schema.keyField !== contract.keyField) {
      throw cleanupError(
        'WooCommerce cleanup Lark mapping is incomplete',
        'WOOCOMMERCE_2026_CLEANUP_LARK_MAPPING_INVALID',
        { tableKey: contract.tableKey },
      );
    }
    liveByTable.set(contract.tableKey, Object.freeze({
      schema,
      tableId,
      records: await lark.listRecords({ tableId, pageSize: 500 }),
    }));
  }
  const rawOrderContract = WOOCOMMERCE_2026_CLEANUP_TABLES.find(
    (contract) => contract.tableKey === 'rawCommerceOrders',
  );
  const larkOldOrders = selectWooCommerce2026CleanupLarkRecords(
    liveByTable.get('rawCommerceOrders').records,
    rawOrderContract,
  );
  const oldOrderKeys = new Set([
    ...d1KeysByTable.get('rawCommerceOrders'),
    ...larkOldOrders.map((record) => String(
      record.fields?.[rawOrderContract.keyField] ?? '',
    ).trim()),
  ]);
  const plans = [];
  for (const contract of WOOCOMMERCE_2026_CLEANUP_TABLES) {
    const { tableId, records: liveRecords } = liveByTable.get(contract.tableKey);
    const keys = d1KeysByTable.get(contract.tableKey);
    const records = selectWooCommerce2026CleanupLarkRecords(
      liveRecords,
      contract,
      { oldOrderKeys },
    );
    const larkKeys = records.map((record) => String(
      record.fields?.[contract.keyField] ?? '',
    ).trim());
    const parity = summarizeWooCommerce2026CleanupParity(keys, larkKeys, contract);
    plans.push(Object.freeze({ contract, tableId, keys, records, larkKeys, parity }));
  }

  const attemptId = Date.now();
  const backupPath = join(outputRoot, `d1-before-cleanup-${attemptId}.sql`);
  wrangler([
    'd1', 'export', databaseName, '--remote', '--config', configPath,
    '--output', backupPath, '--skip-confirmation',
  ], env);
  await chmod(backupPath, 0o600);
  const backupBytes = await readFile(backupPath);
  if (backupBytes.length === 0) throw cleanupError(
    'WooCommerce cleanup D1 backup is empty',
    'WOOCOMMERCE_2026_CLEANUP_BACKUP_EMPTY',
  );
  const larkBackupPath = join(outputRoot, `lark-before-cleanup-${attemptId}.json`);
  await writePrivateJson(larkBackupPath, {
    capturedAt: new Date().toISOString(),
    tables: plans.map((plan) => ({
      tableKey: plan.contract.tableKey,
      records: plan.records,
    })),
  });
  const attemptPath = join(outputRoot, `cleanup-attempt-${attemptId}.json`);
  const progressPath = join(outputRoot, `cleanup-progress-${attemptId}.json`);
  await writePrivateJson(attemptPath, {
    attemptedAt: new Date().toISOString(),
    repositoryHead: git(['rev-parse', 'HEAD']).trim(),
    cutoff: '2026-01-01T00:00:00.000Z',
    d1Backup: {
      file: relative(repositoryRoot, backupPath),
      bytes: backupBytes.length,
      sha256: digest(backupBytes),
    },
    larkBackup: {
      file: relative(repositoryRoot, larkBackupPath),
    },
    plannedLarkDeletes: plans.reduce((sum, plan) => sum + plan.records.length, 0),
    parity: plans.map((plan) => ({
      ...plan.parity,
      d1KeySetSha256: digest(JSON.stringify([...plan.keys].sort())),
      larkKeySetSha256: digest(JSON.stringify([...plan.larkKeys].sort())),
    })),
  });

  const larkDeleted = {};
  for (const plan of plans) {
    larkDeleted[plan.contract.tableKey] = await batchDelete(
      lark,
      plan.tableId,
      plan.records.map((record) => record.recordId),
    );
  }
  await writePrivateJson(progressPath, {
    stage: 'lark-delete-complete',
    larkDeleted,
    completedD1Statements: 0,
  });
  const deleteStatements = buildWooCommerce2026CleanupDeleteStatements();
  for (let index = 0; index < deleteStatements.length; index += 1) {
    runD1(`${deleteStatements[index]};`, env, `d1-delete-${index + 1}`);
    await writePrivateJson(progressPath, {
      stage: 'd1-delete-in-progress',
      larkDeleted,
      completedD1Statements: index + 1,
      totalD1Statements: deleteStatements.length,
    });
  }
  const after = firstRow(runD1(buildWooCommerce2026CleanupVerifySql(), env));
  validateWooCommerce2026CleanupFinal(after);

  for (const plan of plans) {
    const remaining = selectWooCommerce2026CleanupLarkRecords(
      await lark.listRecords({ tableId: plan.tableId, pageSize: 500 }),
      plan.contract,
      { oldOrderKeys },
    );
    if (remaining.length !== 0) throw cleanupError(
      'WooCommerce pre-2026 Lark rows remain after cleanup',
      'WOOCOMMERCE_2026_CLEANUP_LARK_VERIFY_FAILED',
      { tableKey: plan.contract.tableKey, remaining: remaining.length },
    );
  }

  const summary = {
    ok: true,
    cutoff: '2026-01-01T00:00:00.000Z',
    d1Verified: true,
    larkVerified: true,
    larkDeleted,
    parityBeforeCleanup: plans.map((plan) => plan.parity),
    d1BackupSha256: digest(backupBytes),
    executionFlagsAllFalse: true,
    schedule: false,
    production: false,
  };
  await writePrivateJson(join(outputRoot, `summary-${attemptId}.json`), summary);
  await writePrivateJson(join(outputRoot, 'summary.json'), summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

async function batchDelete(client, tableId, recordIds) {
  let deleted = 0;
  for (let offset = 0; offset < recordIds.length; offset += 100) {
    const chunk = recordIds.slice(offset, offset + 100);
    const response = await client.requestBitableJson(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(client.appToken)}/tables/${encodeURIComponent(tableId)}/records/batch_delete`,
      {
        method: 'POST',
        retryMode: 'rate_limit_only',
        body: { records: chunk },
      },
    );
    const records = response?.data?.records;
    if (!Array.isArray(records) || records.length !== chunk.length) {
      throw cleanupError(
        'Lark batch delete response count is ambiguous',
        'WOOCOMMERCE_2026_CLEANUP_LARK_DELETE_AMBIGUOUS',
        { expected: chunk.length, observed: Array.isArray(records) ? records.length : null },
      );
    }
    deleted += records.length;
  }
  return deleted;
}

function runD1(sql, env, stage = 'd1-read') {
  return wrangler([
    'd1', 'execute', databaseName, '--remote', '--json', '--config', configPath,
    '--command', sql,
  ], env, stage);
}

function wrangler(args, env, stage = 'wrangler') {
  const result = spawnSync('npx', ['wrangler', ...args], {
    cwd: repositoryRoot,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw cleanupError(
    'Wrangler command failed during WooCommerce 2026 cleanup',
    'WOOCOMMERCE_2026_CLEANUP_WRANGLER_FAILED',
    {
      stage,
      status: result.status,
      stdoutSha256: digest(String(result.stdout ?? '')),
      stderrSha256: digest(String(result.stderr ?? '')),
    },
  );
  return String(result.stdout ?? '');
}

function rows(output) {
  const parsed = JSON.parse(output);
  return Array.isArray(parsed)
    ? parsed.flatMap((entry) => entry?.results ?? [])
    : parsed?.results ?? [];
}

function firstRow(output) {
  return rows(output)[0] ?? {};
}

function git(args) {
  const result = spawnSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' });
  if (result.status !== 0) throw cleanupError(
    'Git command failed during WooCommerce 2026 cleanup',
    'WOOCOMMERCE_2026_CLEANUP_GIT_FAILED',
  );
  return String(result.stdout ?? '');
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

function requireExact(value, expected, name) {
  if (value !== expected) throw cleanupError(
    `${name} must equal ${expected}`,
    'WOOCOMMERCE_2026_CLEANUP_TARGET_INVALID',
  );
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(?:secret|token|authorization|password)/iu.test(key))
    .map(([key, nested]) => [key, sanitize(nested)]));
}

function cleanupError(message, code, details = undefined) {
  const error = new Error(message);
  error.name = 'WooCommerce2026CleanupError';
  error.code = code;
  error.details = details;
  return error;
}
