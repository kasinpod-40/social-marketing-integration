#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { readDevVars } from './lib/dev-vars.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import {
  WOOCOMMERCE_FINAL_CONFIRMATION,
  WOOCOMMERCE_FINAL_CONTRACT_VERSION,
  assertWooCommerceFinalConfirmation,
  buildWooCommerceConfigWindows,
  buildWooCommerceFinalJob,
  buildWooCommerceFinalSnapshotSql,
  buildWooCommerceWatermarkSql,
  classifyWooCommerceFinalCompletion,
  compareWooCommerceParity,
  compareWooCommerceRerun,
  createWooCommerceLarkSchemaContract,
  listWooCommerceTableBindings,
  normalizeWooCommerceFinalSnapshot,
  parseWooCommerceFinalArgs,
  safeWooCommerceFinalEvidence,
  sha256,
} from './lib/woocommerce-final-rollout-operator.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const outputRoot = resolve(process.env.MKT_WOOCOMMERCE_FINAL_EVIDENCE_DIR
  ?? 'outputs/woocommerce-final-rollout');
const REQUIRED_SECRET_NAMES = Object.freeze([
  'WOOCOMMERCE_CONSUMER_KEY',
  'WOOCOMMERCE_CONSUMER_SECRET',
  'LARK_APP_SECRET',
]);
const EXPECTED_TABLE_COUNT = 17;
const EXPECTED_INDEX_COUNT = 13;
let latestSafeConfig = null;
let target = null;
let currentStage = 'init';

try {
  const options = parseWooCommerceFinalArgs(process.argv.slice(2));
  if (!options.execute) {
    printPlan();
  } else {
    await executeFinalRollout();
  }
} catch (error) {
  let recovery = null;
  if (latestSafeConfig && target) {
    try {
      recovery = await deployAndVerify(latestSafeConfig, [], 'automatic-safe-restore');
    } catch (restoreError) {
      recovery = {
        ok: false,
        code: restoreError?.code ?? 'WOOCOMMERCE_FINAL_RESTORE_FAILED',
        message: restoreError instanceof Error ? restoreError.message : String(restoreError),
      };
    }
  }
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'WOOCOMMERCE_FINAL_ROLLOUT_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: safeWooCommerceFinalEvidence(error?.details ?? {}),
    automaticSafeRestore: recovery,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    executed: false,
    contractVersion: WOOCOMMERCE_FINAL_CONTRACT_VERSION,
    confirmation: WOOCOMMERCE_FINAL_CONFIRMATION,
    command: 'CONFIRM_WOOCOMMERCE_FINAL_ROLLOUT=EXECUTE_WOOCOMMERCE_FINAL_ROLLOUT node scripts/woocommerce-final-rollout-operator.mjs --execute',
    stages: [
      'repository-and-remote-preflight',
      'lark-schema-additive-repair',
      'd1-backup',
      'deploy-safe-and-verify',
      'deploy-manual-uat-window',
      'full-reconciliation',
      'd1-lark-parity',
      'same-operation-rerun',
      'incremental-uat',
      'deploy-scheduled-window',
      'final-summary',
    ],
    safety: {
      defaultMode: 'plan_only',
      production: false,
      deleteExistingBusinessFacts: false,
      applyUnrelatedMigration0018: false,
      automaticSafeRestoreOnFailure: true,
    },
  }, null, 2)}\n`);
}

async function executeFinalRollout() {
  const env = await loadEnvironment();
  assertWooCommerceFinalConfirmation(env);
  target = loadTarget(env);
  await assertRepositoryState(target.repositoryHead);
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });

  currentStage = 'repository-and-remote-preflight';
  const configText = await readFile(target.configPath, 'utf8');
  await runLocalVerification();
  const remote = await remotePreflight(target);
  await writeEvidence('01-remote-preflight', { target: safeTarget(target), remote });

  currentStage = 'lark-schema-additive-repair';
  const lark = createLarkBitableClientFromEnv(env);
  const schema = await ensureLarkSchema(lark, env);
  await writeEvidence('02-lark-schema', schema);

  const windows = buildWooCommerceConfigWindows({ configText, tableIds: schema.tableIds });
  if (windows.safeTrueFlags.length !== 0) {
    throw failure('Safe config contains enabled MKT execution flags', 'WOOCOMMERCE_FINAL_SAFE_CONFIG_NOT_CLOSED', { trueFlags: windows.safeTrueFlags });
  }
  assertExactFlags(windows.uatTrueFlags, [
    'MKT_CONNECTOR_WOOCOMMERCE_ENABLED',
    'MKT_WOOCOMMERCE_D1_WRITE_ENABLED',
    'MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED',
    'MKT_WOOCOMMERCE_LARK_WRITE_ENABLED',
  ]);
  assertExactFlags(windows.scheduledTrueFlags, [
    'MKT_CONNECTOR_WOOCOMMERCE_ENABLED',
    'MKT_SCHEDULE_WOOCOMMERCE_ENABLED',
    'MKT_WOOCOMMERCE_D1_WRITE_ENABLED',
    'MKT_WOOCOMMERCE_LARK_WRITE_ENABLED',
  ]);
  latestSafeConfig = windows.safe;

  currentStage = 'd1-backup';
  const backup = await backupD1(target);
  await writeEvidence('03-d1-backup', backup);

  currentStage = 'deploy-safe-and-verify';
  const safeDeployment = await deployAndVerify(windows.safe, [], 'safe-baseline');
  await writeEvidence('04-safe-deployment', safeDeployment);

  currentStage = 'deploy-manual-uat-window';
  const uatDeployment = await deployAndVerify(windows.uat, windows.uatTrueFlags, 'manual-uat-window');
  await writeEvidence('05-uat-deployment', uatDeployment);

  const full = createOperation('full');
  currentStage = 'full-reconciliation';
  const fullBefore = await readSnapshot(full.operationId);
  await sendQueueMessage(buildWooCommerceFinalJob({
    operationId: full.operationId,
    requestedAt: full.requestedAt,
    trigger: 'manual_uat',
    fullReconciliation: true,
  }));
  const fullAfter = await pollCompletion(full.operationId, true);
  await writeEvidence('06-full-reconciliation', { operation: full, before: fullBefore, after: fullAfter });

  currentStage = 'd1-lark-parity';
  const parity = await verifyParity(lark, schema.tableIds, fullAfter.counts);
  await writeEvidence('07-d1-lark-parity', parity);

  currentStage = 'same-operation-rerun';
  await sendQueueMessage(buildWooCommerceFinalJob({
    operationId: full.operationId,
    requestedAt: full.requestedAt,
    trigger: 'manual_uat',
    fullReconciliation: true,
  }), { attemptKey: `${full.operationId}:rerun` });
  const rerunAfter = await pollQueueAttempt(full.operationId, fullAfter.queueOperationAttempts + 1);
  const rerun = compareWooCommerceRerun(fullAfter, rerunAfter);
  const rerunParity = await verifyParity(lark, schema.tableIds, rerunAfter.counts);
  await writeEvidence('08-idempotent-rerun', { operation: full, rerun, after: rerunAfter, parity: rerunParity });

  currentStage = 'incremental-uat';
  const watermark = await readWatermark();
  const incremental = createOperation('incremental');
  await sendQueueMessage(buildWooCommerceFinalJob({
    operationId: incremental.operationId,
    requestedAt: incremental.requestedAt,
    trigger: 'manual_uat',
    fullReconciliation: false,
    modifiedAfter: watermark,
  }));
  const incrementalAfter = await pollCompletion(incremental.operationId, false);
  const incrementalParity = await verifyParity(lark, schema.tableIds, incrementalAfter.counts);
  await writeEvidence('09-incremental-uat', {
    operation: incremental,
    modifiedAfter: watermark,
    after: incrementalAfter,
    parity: incrementalParity,
  });

  currentStage = 'deploy-scheduled-window';
  const scheduledDeployment = await deployAndVerify(
    windows.scheduled,
    windows.scheduledTrueFlags,
    'scheduled-active-window',
  );
  latestSafeConfig = null;
  await writeEvidence('10-scheduled-deployment', scheduledDeployment);

  currentStage = 'final-summary';
  const summary = {
    accepted: true,
    contractVersion: WOOCOMMERCE_FINAL_CONTRACT_VERSION,
    repositoryHead: target.repositoryHead,
    workerVersion: scheduledDeployment.activeVersion,
    d1Backup: backup,
    larkSchema: { tableCount: schema.tableCount, createdTables: schema.createdTables, createdFields: schema.createdFields },
    fullReconciliation: { operationId: full.operationId, totalRows: sumCounts(fullAfter.counts) },
    parityVerified: true,
    idempotentRerunVerified: true,
    incrementalVerified: true,
    scheduleEnabled: true,
    production: false,
    nextStep: 'none_for_integration_workspace_woocommerce',
  };
  await writeEvidence('11-summary', summary);
  process.stdout.write(`${JSON.stringify({ ok: true, ...summary, evidenceRoot: relative(repositoryRoot, outputRoot) }, null, 2)}\n`);
}

function loadTarget(env) {
  const exact = (name, value) => {
    if (env[name] !== value) throw failure(`${name} must equal ${value}`, 'WOOCOMMERCE_FINAL_TARGET_INVALID', { name });
    return value;
  };
  return Object.freeze({
    environment: exact('MKT_ENV', 'development'),
    customerProfile: exact('MKT_CUSTOMER_PROFILE', 'integration_workspace'),
    customerKey: exact('MKT_CONNECTION_CUSTOMER_KEY', 'chemistry_k'),
    accountKey: 'chemistry_k',
    repositoryHead: required(env.MKT_WOOCOMMERCE_FINAL_REPOSITORY_HEAD, 'MKT_WOOCOMMERCE_FINAL_REPOSITORY_HEAD'),
    databaseName: env.MKT_WOOCOMMERCE_ROLLOUT_DATABASE_NAME ?? 'social-mkt-state-dev',
    workerName: env.MKT_WOOCOMMERCE_ROLLOUT_WORKER_NAME ?? 'social-mkt-sync-worker',
    configPath: resolveRepositoryFile(env.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc'),
    mainQueueName: env.MKT_MAIN_QUEUE_NAME ?? 'social-mkt-sync-jobs',
    dlqName: env.MKT_DLQ_QUEUE_NAME ?? 'social-mkt-sync-dlq',
    accountId: required(env.CLOUDFLARE_ACCOUNT_ID, 'CLOUDFLARE_ACCOUNT_ID'),
    queueId: required(env.MKT_WOOCOMMERCE_FINAL_QUEUE_ID, 'MKT_WOOCOMMERCE_FINAL_QUEUE_ID'),
    apiToken: required(env.CLOUDFLARE_API_TOKEN, 'CLOUDFLARE_API_TOKEN'),
  });
}

async function loadEnvironment() {
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  return Object.freeze({ ...fileEnv, ...process.env });
}

async function runLocalVerification() {
  await command('npm', ['run', 'check']);
  await command('node', ['--test',
    'tests/application/woocommerce-final-rollout-operator.test.js',
    'tests/application/woocommerce-runtime-wiring.test.js',
    'tests/application/woocommerce-schedule-runtime.test.js',
    'tests/application/scheduled-jobs.test.js',
  ]);
  await command('npm', ['run', 'deploy:dry-run']);
}

async function remotePreflight(currentTarget) {
  await wrangler(['whoami']);
  const [deployment, migrations, secrets, schema] = await Promise.all([
    readDeploymentStatus(),
    wranglerText(['d1', 'migrations', 'list', currentTarget.databaseName, '--remote', '--config', currentTarget.configPath]),
    wranglerText(['secret', 'list', '--name', currentTarget.workerName, '--config', currentTarget.configPath, '--format', 'json']),
    readD1Row(`SELECT
      (SELECT COUNT(*) FROM sqlite_master WHERE (type='table' AND name LIKE 'raw_commerce_%') OR (type='table' AND name LIKE 'commerce_%')) AS commerce_table_count,
      (SELECT COUNT(*) FROM sqlite_master WHERE (type='index' AND name LIKE 'idx_raw_commerce_%') OR (type='index' AND name LIKE 'idx_commerce_%')) AS commerce_index_count,
      (SELECT COUNT(*) FROM sync_work_runs WHERE lifecycle_status='active') AS active_work,
      (SELECT COUNT(*) FROM sync_locks WHERE expires_at > unixepoch('now') * 1000) AS active_locks;`),
  ]);
  const pendingMigrations = [...new Set([...migrations.matchAll(/\b\d{4}_[A-Za-z0-9_.-]+\.sql\b/gu)].map((match) => match[0]))];
  if (pendingMigrations.includes('0017_woocommerce_commerce.sql')) {
    throw failure('Migration 0017 is still pending; automatic application is blocked because later migrations must remain isolated', 'WOOCOMMERCE_FINAL_MIGRATION_0017_PENDING', { pendingMigrations });
  }
  const unexpected = pendingMigrations.filter((name) => name !== '0018_chatwoot_analytics.sql');
  if (unexpected.length > 0) throw failure('Unexpected pending migrations block WooCommerce final rollout', 'WOOCOMMERCE_FINAL_PENDING_MIGRATIONS_INVALID', { pendingMigrations });
  if (Number(schema.commerce_table_count) !== EXPECTED_TABLE_COUNT || Number(schema.commerce_index_count) !== EXPECTED_INDEX_COUNT) {
    throw failure('Remote WooCommerce D1 schema is incomplete', 'WOOCOMMERCE_FINAL_D1_SCHEMA_INCOMPLETE', { schema });
  }
  if (Number(schema.active_work) !== 0 || Number(schema.active_locks) !== 0) {
    throw failure('Active work or lock blocks WooCommerce final rollout', 'WOOCOMMERCE_FINAL_ACTIVE_WORK_BLOCKED', { schema });
  }
  const secretNames = parseSecretNames(secrets);
  const missingSecrets = REQUIRED_SECRET_NAMES.filter((name) => !secretNames.includes(name));
  if (missingSecrets.length > 0) throw failure('Required Worker Secret names are missing', 'WOOCOMMERCE_FINAL_SECRET_MISSING', { missingSecrets });
  const activeVersion = requireActiveVersion(deployment);
  return { activeVersion, pendingMigrations, schema, secretNameFingerprint: sha256(JSON.stringify(secretNames)) };
}

async function ensureLarkSchema(client, env) {
  const contracts = createWooCommerceLarkSchemaContract();
  let tables = await client.listTables();
  const byId = new Map(tables.map((item) => [item.tableId, item]));
  const byName = new Map(tables.map((item) => [item.name, item]));
  const tableIds = {};
  let createdTables = 0;
  let createdFields = 0;
  for (const contract of contracts) {
    const configuredId = optional(env[contract.envName]);
    let table = configuredId ? byId.get(configuredId) : null;
    if (!table) table = byName.get(contract.tableName) ?? null;
    if (!table) {
      table = await client.createTable({ name: contract.tableName, defaultViewName: 'All', fields: contract.fields });
      createdTables += 1;
      tables = [...tables, table];
      byId.set(table.tableId, table);
      byName.set(table.name, table);
    }
    if (!table.tableId) throw failure('Lark table has no table ID', 'WOOCOMMERCE_FINAL_LARK_TABLE_INVALID', { tableKey: contract.tableKey });
    const fields = await client.listFields({ tableId: table.tableId });
    const byField = new Map(fields.map((field) => [field.fieldName, field]));
    for (const field of contract.fields) {
      if (byField.has(field.fieldName)) continue;
      await client.createField({ tableId: table.tableId, field });
      createdFields += 1;
    }
    tableIds[contract.tableKey] = table.tableId;
  }
  if (new Set(Object.values(tableIds)).size !== contracts.length) {
    throw failure('WooCommerce Lark table IDs are not unique', 'WOOCOMMERCE_FINAL_LARK_TABLE_DUPLICATE');
  }
  return Object.freeze({ tableCount: contracts.length, tableIds: Object.freeze(tableIds), createdTables, createdFields });
}

async function backupD1(currentTarget) {
  const directory = join(outputRoot, 'backups');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, `social-mkt-state-dev-before-woocommerce-final-${Date.now()}.sql`);
  await wrangler(['d1', 'export', currentTarget.databaseName, '--remote', '--config', currentTarget.configPath, '--output', file, '--skip-confirmation']);
  await chmod(file, 0o600);
  const bytes = await readFile(file);
  if (bytes.length === 0) throw failure('WooCommerce D1 backup is empty', 'WOOCOMMERCE_FINAL_BACKUP_EMPTY');
  return Object.freeze({ file: relative(repositoryRoot, file), bytes: bytes.length, sha256: digest(bytes) });
}

async function deployAndVerify(configText, expectedTrueFlags, label) {
  const bundle = await buildBundle(configText, label);
  const result = await withGeneratedConfig(configText, async (configPath) => wrangler([
    'deploy', '--config', configPath, '--message',
    `${WOOCOMMERCE_FINAL_CONTRACT_VERSION} stage=${label} git=${target.repositoryHead}`,
  ]));
  const versionId = extractVersionId(result.stdout);
  const [status, view, mainConsumers, dlqConsumers] = await Promise.all([
    readDeploymentStatus(),
    readVersionView(versionId),
    readQueueConsumers(target.mainQueueName),
    readQueueConsumers(target.dlqName),
  ]);
  const activeVersion = requireActiveVersion(status, versionId);
  assertExactFlags(readRemoteTrueFlags(view), expectedTrueFlags);
  assertQueueConsumer(mainConsumers, target.mainQueueName, { maxConcurrency: 1, maxBatchSize: 10, maxBatchTimeout: 30, maxRetries: 5, deadLetterQueue: target.dlqName });
  assertQueueConsumer(dlqConsumers, target.dlqName, { maxConcurrency: 1, maxBatchSize: 10, maxBatchTimeout: 30, maxRetries: 10, deadLetterQueue: null });
  return Object.freeze({ label, activeVersion, bundleSha256: bundle.sha256, configSha256: sha256(configText), expectedTrueFlags: Object.freeze([...expectedTrueFlags].sort()) });
}

function createOperation(kind) {
  const requestedAt = Date.now();
  const suffix = createHash('sha256').update(`${target.repositoryHead}:${kind}:${requestedAt}`).digest('hex').slice(0, 12);
  return Object.freeze({ operationId: `woo-final-${kind}-${suffix}`, requestedAt });
}

async function readSnapshot(operationId) {
  return normalizeWooCommerceFinalSnapshot(await readD1Row(buildWooCommerceFinalSnapshotSql({ accountKey: target.accountKey, operationId })));
}

async function pollCompletion(operationId, fullReconciliation) {
  const maxPolls = positiveInteger(process.env.MKT_WOOCOMMERCE_FINAL_VERIFY_MAX_POLLS, 240);
  const intervalMs = positiveInteger(process.env.MKT_WOOCOMMERCE_FINAL_VERIFY_INTERVAL_MS, 5_000);
  let snapshot = null;
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    snapshot = await readSnapshot(operationId);
    if (classifyWooCommerceFinalCompletion(snapshot, { fullReconciliation }).complete) return snapshot;
    if (attempt + 1 < maxPolls) await sleep(intervalMs);
  }
  throw failure('WooCommerce operation did not complete within bounded verification', 'WOOCOMMERCE_FINAL_VERIFY_TIMEOUT', { operationId, snapshot });
}

async function pollQueueAttempt(operationId, minimumAttempts) {
  const maxPolls = positiveInteger(process.env.MKT_WOOCOMMERCE_FINAL_RERUN_MAX_POLLS, 60);
  const intervalMs = positiveInteger(process.env.MKT_WOOCOMMERCE_FINAL_VERIFY_INTERVAL_MS, 5_000);
  let snapshot = null;
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    snapshot = await readSnapshot(operationId);
    if (snapshot.queueOperationAttempts >= minimumAttempts && snapshot.activeLockCount === 0) return snapshot;
    if (attempt + 1 < maxPolls) await sleep(intervalMs);
  }
  throw failure('WooCommerce rerun attempt was not observed', 'WOOCOMMERCE_FINAL_RERUN_TIMEOUT', { operationId, snapshot });
}

async function verifyParity(client, tableIds, d1Counts) {
  const larkCounts = {};
  for (const binding of listWooCommerceTableBindings()) {
    const records = await client.listRecords({ tableId: tableIds[binding.tableKey], pageSize: 500 });
    larkCounts[binding.tableKey] = records.filter((record) => normalizeLarkScalar(record.fields?.account_key) === target.accountKey).length;
  }
  return compareWooCommerceParity({ d1Counts, larkCounts });
}

async function readWatermark() {
  const row = await readD1Row(buildWooCommerceWatermarkSql(target.accountKey));
  const order = Number(row.order_watermark);
  const product = Number(row.product_watermark);
  if (!Number.isSafeInteger(order) || !Number.isSafeInteger(product)) {
    throw failure('WooCommerce incremental watermark is unavailable after full reconciliation', 'WOOCOMMERCE_FINAL_WATERMARK_MISSING', { row });
  }
  return Math.min(order, product);
}

async function sendQueueMessage(job, options = {}) {
  const attemptKey = options.attemptKey ?? job.operationId;
  const attemptFile = join(outputRoot, 'queue-attempts', `${safeFile(attemptKey)}.json`);
  try {
    await stat(attemptFile);
    throw failure('WooCommerce Queue attempt already recorded', 'WOOCOMMERCE_FINAL_QUEUE_REATTEMPT_BLOCKED', { attemptKey });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await writePrivateJson(attemptFile, { attemptKey, jobSha256: sha256(JSON.stringify(job)), attemptedAt: new Date().toISOString() });
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(target.accountId)}/queues/${encodeURIComponent(target.queueId)}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${target.apiToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ body: job, content_type: 'json' }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) throw failure(`Cloudflare Queue rejected WooCommerce operation (HTTP ${response.status})`, 'WOOCOMMERCE_FINAL_QUEUE_SEND_FAILED');
}

async function readD1Row(sql) {
  const output = await wranglerText(['d1', 'execute', target.databaseName, '--remote', '--json', '--config', target.configPath, '--command', sql]);
  const parsed = JSON.parse(output);
  const row = Array.isArray(parsed) ? parsed.flatMap((entry) => entry?.results ?? [])[0] : parsed?.results?.[0];
  if (!row) throw failure('Remote D1 query returned no row', 'WOOCOMMERCE_FINAL_D1_QUERY_EMPTY');
  return row;
}

async function readDeploymentStatus() {
  const output = await wranglerText(['deployments', 'status', '--name', target.workerName, '--config', target.configPath, '--json']);
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed[0] : parsed;
}
async function readVersionView(versionId) { return JSON.parse(await wranglerText(['versions', 'view', versionId, '--name', target.workerName, '--config', target.configPath, '--json'])); }
async function readQueueConsumers(queueName) { const output = await wranglerText(['queues', 'consumer', 'list', queueName, '--json']); const parsed = JSON.parse(output); return Array.isArray(parsed) ? parsed : (parsed?.result ?? parsed?.consumers ?? []); }

function requireActiveVersion(status, expected = null) {
  const active = (Array.isArray(status?.versions) ? status.versions : []).filter((version) => Number(version?.percentage) === 100);
  if (active.length !== 1 || !active[0]?.version_id) throw failure('Worker does not have exactly one 100% active version', 'WOOCOMMERCE_FINAL_ACTIVE_VERSION_INVALID');
  if (expected && active[0].version_id !== expected) throw failure('Worker active version differs from deployed version', 'WOOCOMMERCE_FINAL_ACTIVE_VERSION_MISMATCH');
  return active[0].version_id;
}

function readRemoteTrueFlags(value) {
  const flags = new Map();
  walk(value, (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    for (const [key, nested] of Object.entries(node)) if (/^MKT_[A-Z0-9_]+_ENABLED$/u.test(key)) flags.set(key, booleanLike(nested));
    if (typeof node.name === 'string' && /^MKT_[A-Z0-9_]+_ENABLED$/u.test(node.name)) flags.set(node.name, booleanLike(node.text ?? node.value ?? node.json ?? node.data));
  });
  return [...flags.entries()].filter(([, enabled]) => enabled).map(([name]) => name).sort();
}

function assertExactFlags(observed, expected) {
  const left = [...observed].sort();
  const right = [...expected].sort();
  if (JSON.stringify(left) !== JSON.stringify(right)) throw failure('Worker flags differ from approved WooCommerce window', 'WOOCOMMERCE_FINAL_REMOTE_FLAG_MISMATCH', { observed: left, expected: right });
}

function assertQueueConsumer(consumers, queueName, expected) {
  const entry = consumers.find((item) => (item?.queue_name ?? item?.queue ?? item?.name) === queueName) ?? (consumers.length === 1 ? consumers[0] : null);
  if (!entry) throw failure(`Queue consumer missing for ${queueName}`, 'WOOCOMMERCE_FINAL_QUEUE_TOPOLOGY_INVALID');
  const observed = { maxConcurrency: Number(entry.max_concurrency ?? entry.settings?.max_concurrency), maxBatchSize: Number(entry.max_batch_size ?? entry.settings?.max_batch_size), maxBatchTimeout: Number(entry.max_batch_timeout ?? entry.settings?.max_batch_timeout), maxRetries: Number(entry.max_retries ?? entry.settings?.max_retries), deadLetterQueue: entry.dead_letter_queue ?? entry.settings?.dead_letter_queue ?? null };
  for (const [key, value] of Object.entries(expected)) if ((observed[key] ?? null) !== value) throw failure(`Queue consumer drift: ${queueName}.${key}`, 'WOOCOMMERCE_FINAL_QUEUE_TOPOLOGY_INVALID', { observed, expected });
}

async function buildBundle(configText, label) {
  return withGeneratedConfig(configText, async (configPath) => {
    const directory = await mkdtemp(join(tmpdir(), `woocommerce-final-${safeFile(label)}-`));
    try {
      await wrangler(['deploy', '--dry-run', '--outdir', directory, '--config', configPath]);
      const files = await listFiles(directory);
      if (files.length === 0) throw failure('Wrangler dry-run bundle is empty', 'WOOCOMMERCE_FINAL_BUNDLE_EMPTY');
      const hash = createHash('sha256');
      for (const file of files) {
        hash.update(relative(directory, file));
        hash.update(await readFile(file));
      }
      return { sha256: hash.digest('hex'), fileCount: files.length };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

async function withGeneratedConfig(text, callback) {
  const path = join(repositoryRoot, `.woocommerce-final-${process.pid}-${Date.now()}-${basename(target.configPath)}`);
  try {
    await writeFile(path, text, { mode: 0o600 });
    return await callback(path);
  } finally {
    await rm(path, { force: true });
  }
}

async function listFiles(directory) {
  const { readdir } = await import('node:fs/promises');
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(path));
    else if (entry.isFile()) result.push(path);
  }
  return result.sort();
}

async function writeEvidence(name, data) {
  const priorPath = join(outputRoot, 'evidence-head.json');
  let previousEvidenceSha256 = null;
  try { previousEvidenceSha256 = JSON.parse(await readFile(priorPath, 'utf8')).evidenceSha256; } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  const unsigned = safeWooCommerceFinalEvidence({ contractVersion: WOOCOMMERCE_FINAL_CONTRACT_VERSION, stage: name, capturedAt: new Date().toISOString(), repositoryHead: target.repositoryHead, previousEvidenceSha256, data });
  const evidence = Object.freeze({ ...unsigned, evidenceSha256: sha256(JSON.stringify(unsigned)) });
  await writePrivateJson(join(outputRoot, `${name}.json`), evidence);
  await writePrivateJson(priorPath, { evidenceSha256: evidence.evidenceSha256, stage: name });
  return evidence;
}

async function writePrivateJson(path, value) { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const temporary = `${path}.tmp`; await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); await rename(temporary, path); await chmod(path, 0o600); }
async function assertRepositoryState(expectedHead) { const [head, status] = await Promise.all([gitText(['rev-parse', 'HEAD']), gitText(['status', '--porcelain', '--untracked-files=all'], false)]); if (head !== expectedHead || status.trim() !== '') throw failure('WooCommerce final rollout requires exact reviewed HEAD and clean worktree', 'WOOCOMMERCE_FINAL_REPOSITORY_INVALID', { head, expectedHead }); }
async function gitText(args, trim = true) { const result = await command('git', args); return trim ? result.stdout.trim() : result.stdout; }
async function wranglerText(args) { return (await wrangler(args)).stdout; }
async function wrangler(args) { return command('npx', ['wrangler', ...args], { env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: target?.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID } }); }
async function command(file, args, options = {}) { return execFileAsync(file, args, { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options }); }
function parseSecretNames(output) { const parsed = JSON.parse(output); const list = Array.isArray(parsed) ? parsed : (parsed?.result ?? []); return list.map((item) => String(item?.name ?? '')).filter(Boolean).sort(); }
function extractVersionId(output) {
  const text = String(output);
  const labeled = /Version ID:\s*([0-9a-f-]{36})/iu.exec(text)?.[1]?.toLowerCase();
  if (labeled) return labeled;
  const values = [...new Set((text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu) ?? []).map((value) => value.toLowerCase()))];
  if (values.length !== 1) throw failure('Deployment output did not contain exactly one version ID', 'WOOCOMMERCE_FINAL_DEPLOYMENT_VERSION_INVALID', { count: values.length });
  return values[0];
}
function normalizeLarkScalar(value) { if (Array.isArray(value)) return value.length === 1 ? normalizeLarkScalar(value[0]) : null; if (value && typeof value === 'object') return value.text ?? value.value ?? null; return value === null || value === undefined ? null : String(value); }
function booleanLike(value) { return value === true || value === 1 || String(value ?? '').trim().toLowerCase() === 'true'; }
function walk(value, callback) { callback(value); if (Array.isArray(value)) for (const item of value) walk(item, callback); else if (value && typeof value === 'object') for (const nested of Object.values(value)) walk(nested, callback); }
function resolveRepositoryFile(value) { const path = resolve(repositoryRoot, required(value, 'config path')); if (!path.startsWith(`${repositoryRoot}/`) && path !== repositoryRoot) throw failure('Config path must be inside Repository', 'WOOCOMMERCE_FINAL_PATH_INVALID'); return path; }
function safeTarget(value) { return { environment: value.environment, customerProfile: value.customerProfile, customerKey: value.customerKey, accountKey: value.accountKey, repositoryHead: value.repositoryHead, databaseName: value.databaseName, workerName: value.workerName, mainQueueName: value.mainQueueName, dlqName: value.dlqName }; }
function required(value, name) { if (typeof value !== 'string' || value.trim() === '') throw failure(`${name} is required`, 'WOOCOMMERCE_FINAL_INPUT_REQUIRED', { name }); return value.trim(); }
function optional(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function positiveInteger(value, fallback) { const number = Number(value ?? fallback); if (!Number.isSafeInteger(number) || number < 1 || number > 10_000) throw failure('Polling limit is invalid', 'WOOCOMMERCE_FINAL_POLLING_INVALID'); return number; }
function safeFile(value) { return String(value).replace(/[^A-Za-z0-9._-]+/gu, '-'); }
function sumCounts(value) { return Object.values(value).reduce((sum, count) => sum + Number(count), 0); }
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function sleep(milliseconds) { return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds)); }
function failure(message, code, details = undefined) { const error = new Error(message); error.name = 'WooCommerceFinalRolloutError'; error.code = code; error.details = details; return error; }
