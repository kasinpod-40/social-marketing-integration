#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { buildWranglerOAuthEnvironment } from './lib/cloudflare-auth-environment.js';
import { readDevVars } from './lib/dev-vars.js';
import { extractWranglerD1Rows } from './lib/tiktok-durable-recovery-operator.js';
import {
  WOOCOMMERCE_DLQ_CLOSURE_CONFIRMATION,
  WOOCOMMERCE_DLQ_CLOSURE_CONTRACT_VERSION,
  WOOCOMMERCE_DLQ_CLOSURE_INCIDENT,
  assertWooCommerceDlqClosureConfirmation,
  assertWooCommerceDlqClosureNoSnapshotDrift,
  assertWooCommerceDlqClosureSnapshot,
  assertWooCommerceDlqClosureSummary,
  buildWooCommerceDlqClosureEvidenceSql,
  buildWooCommerceDlqClosureRepairSql,
  validateWooCommerceDlqClosureRepairResults,
  validateWooCommerceDlqClosureRows,
} from './lib/woocommerce-dlq-closure.js';
import { buildWooCommerceFinalSnapshotSql } from './lib/woocommerce-final-rollout-operator.js';

const repositoryRoot = resolve(process.cwd());
const evidenceRoot = resolve(
  process.env.MKT_WOOCOMMERCE_DLQ_CLOSURE_EVIDENCE_DIR
    ?? 'outputs/woocommerce-dlq-closure',
);
const finalSummaryPath = resolve(
  process.env.MKT_WOOCOMMERCE_FINAL_SUMMARY_PATH
    ?? 'outputs/woocommerce-final-rollout/11-summary.json',
);

try {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) printPlan();
  else await executeClosure();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'WOOCOMMERCE_DLQ_CLOSURE_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: safeEvidence(error?.details ?? {}),
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: WOOCOMMERCE_DLQ_CLOSURE_CONTRACT_VERSION,
    operationId: WOOCOMMERCE_DLQ_CLOSURE_INCIDENT.operationId,
    incidentRows: WOOCOMMERCE_DLQ_CLOSURE_INCIDENT.rows.length,
    command: `CONFIRM_WOOCOMMERCE_DLQ_CLOSURE=${WOOCOMMERCE_DLQ_CLOSURE_CONFIRMATION} node scripts/woocommerce-dlq-closure-operator.mjs --execute`,
    mutation: 'exact retained DLQ and dead-letter operation metadata only',
    businessMutation: false,
    queueMessage: false,
    workerDeployment: false,
    schedule: false,
    production: false,
  }, null, 2)}\n`);
}

async function executeClosure() {
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });
  assertWooCommerceDlqClosureConfirmation(env);
  const repository = assertRepositoryState();
  const configPath = resolve(env.MKT_WOOCOMMERCE_DLQ_CLOSURE_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc');
  const databaseName = env.MKT_WOOCOMMERCE_DLQ_CLOSURE_D1_DATABASE ?? 'social-mkt-state-dev';
  if (databaseName !== 'social-mkt-state-dev'
    || env.MKT_ENV !== 'development'
    || env.MKT_CUSTOMER_PROFILE !== 'integration_workspace'
    || env.MKT_CONNECTION_CUSTOMER_KEY !== 'chemistry_k') {
    throw closureError(
      'WooCommerce DLQ closure target differs from Integration Workspace development',
      'WOOCOMMERCE_DLQ_CLOSURE_TARGET_INVALID',
    );
  }

  const finalSummary = JSON.parse(await readFile(finalSummaryPath, 'utf8'));
  assertWooCommerceDlqClosureSummary(finalSummary);
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  const backup = await createBackup({ configPath, databaseName, env });
  const snapshotSql = buildWooCommerceFinalSnapshotSql({
    accountKey: 'chemistry_k',
    operationId: WOOCOMMERCE_DLQ_CLOSURE_INCIDENT.operationId,
  });
  const snapshotBefore = readOneD1Row({ configPath, databaseName, env, sql: snapshotSql });
  assertWooCommerceDlqClosureSnapshot(snapshotBefore);
  const incidentBeforeRows = readD1Rows({
    configPath,
    databaseName,
    env,
    sql: buildWooCommerceDlqClosureEvidenceSql(),
  });
  const incidentBefore = validateWooCommerceDlqClosureRows(incidentBeforeRows, 'before');
  const attemptedAt = Date.now();
  const attempt = {
    contractVersion: WOOCOMMERCE_DLQ_CLOSURE_CONTRACT_VERSION,
    attemptedAt: new Date(attemptedAt).toISOString(),
    repository,
    operationId: WOOCOMMERCE_DLQ_CLOSURE_INCIDENT.operationId,
    backup,
    incidentBefore,
    finalSummarySha256: sha256(JSON.stringify(finalSummary)),
    businessMutation: false,
    queueMessage: false,
    workerDeployment: false,
    schedule: false,
    production: false,
  };
  await writePrivateJson(resolve(evidenceRoot, `01-attempt-${attemptedAt}.json`), attempt);

  const repairedAt = Date.now();
  const repairRows = readD1Rows({
    configPath,
    databaseName,
    env,
    sql: buildWooCommerceDlqClosureRepairSql(repairedAt),
  });
  const repair = validateWooCommerceDlqClosureRepairResults(repairRows);
  const incidentAfterRows = readD1Rows({
    configPath,
    databaseName,
    env,
    sql: buildWooCommerceDlqClosureEvidenceSql(),
  });
  const incidentAfter = validateWooCommerceDlqClosureRows(incidentAfterRows, 'final');
  const snapshotAfter = readOneD1Row({ configPath, databaseName, env, sql: snapshotSql });
  assertWooCommerceDlqClosureSnapshot(snapshotAfter);
  assertWooCommerceDlqClosureNoSnapshotDrift(snapshotBefore, snapshotAfter);

  const summary = {
    ok: true,
    contractVersion: WOOCOMMERCE_DLQ_CLOSURE_CONTRACT_VERSION,
    closedAt: new Date(repairedAt).toISOString(),
    repository,
    operationId: WOOCOMMERCE_DLQ_CLOSURE_INCIDENT.operationId,
    retainedDlqRows: incidentAfter.rowCount,
    redrivenRows: incidentAfter.redrivenRows,
    completedMetadataRows: incidentAfter.completedMetadataRows,
    repair,
    snapshotDrift: false,
    backup,
    businessMutation: false,
    coverageMutation: false,
    larkMutation: false,
    queueMessage: false,
    workerDeployment: false,
    schedule: false,
    production: false,
  };
  await writePrivateJson(resolve(evidenceRoot, '02-summary.json'), summary);
  process.stdout.write(`${JSON.stringify({
    ...summary,
    evidenceRoot: relative(repositoryRoot, evidenceRoot),
  }, null, 2)}\n`);
}

function parseArgs(argv) {
  const unknown = argv.filter((argument) => argument !== '--execute');
  if (unknown.length > 0) throw closureError(
    `Unsupported WooCommerce DLQ closure arguments: ${unknown.join(', ')}`,
    'WOOCOMMERCE_DLQ_CLOSURE_ARGUMENT_INVALID',
  );
  return argv.includes('--execute');
}

function assertRepositoryState() {
  run('git', ['fetch', 'origin', 'main', '--quiet']);
  const branch = run('git', ['branch', '--show-current']).stdout.trim();
  const head = run('git', ['rev-parse', 'HEAD']).stdout.trim();
  const originMain = run('git', ['rev-parse', 'origin/main']).stdout.trim();
  const dirty = run('git', ['status', '--porcelain', '--untracked-files=all']).stdout.trim();
  if (branch !== 'main' || head !== originMain || dirty !== '') throw closureError(
    'WooCommerce DLQ closure requires clean current main equal to origin/main',
    'WOOCOMMERCE_DLQ_CLOSURE_REPOSITORY_INVALID',
    { branch, head, originMain, clean: dirty === '' },
  );
  return Object.freeze({ branch, head, originMain, clean: true });
}

function readOneD1Row(input) {
  const rows = readD1Rows(input);
  if (rows.length !== 1) throw closureError(
    'WooCommerce DLQ closure D1 query returned an unexpected row count',
    'WOOCOMMERCE_DLQ_CLOSURE_D1_SHAPE_INVALID',
    { rowCount: rows.length },
  );
  return Object.freeze({ ...rows[0] });
}

function readD1Rows(input) {
  const result = run('npx', [
    'wrangler', 'd1', 'execute', input.databaseName,
    '--remote', '--json', '--config', input.configPath, '--command', input.sql,
  ], { env: buildWranglerOAuthEnvironment(input.env) });
  return extractWranglerD1Rows(result.stdout);
}

async function createBackup(input) {
  const path = resolve(
    evidenceRoot,
    'backups',
    `before-woocommerce-dlq-closure-${Date.now()}.sql`,
  );
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  run('npx', [
    'wrangler', 'd1', 'export', input.databaseName,
    '--remote', '--config', input.configPath, '--output', path, '--skip-confirmation',
  ], { env: buildWranglerOAuthEnvironment(input.env) });
  await chmod(path, 0o600);
  const bytes = await readFile(path);
  if (bytes.length === 0) throw closureError(
    'WooCommerce DLQ closure backup is empty',
    'WOOCOMMERCE_DLQ_CLOSURE_BACKUP_INVALID',
  );
  return Object.freeze({
    file: relative(repositoryRoot, path),
    bytes: bytes.length,
    sha256: sha256(bytes),
  });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: options.env ?? process.env,
    maxBuffer: 67_108_864,
  });
  if (result.status !== 0) throw closureError(
    `WooCommerce DLQ closure command failed: ${command}`,
    'WOOCOMMERCE_DLQ_CLOSURE_COMMAND_FAILED',
    { command, status: result.status ?? 1, stderr: String(result.stderr ?? '').trim() },
  );
  return result;
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(safeEvidence(value), null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

function safeEvidence(value) {
  if (Array.isArray(value)) return value.map(safeEvidence);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(?:token|secret|authorization|cookie|password)/iu.test(key))
    .map(([key, nested]) => [key, safeEvidence(nested)]));
}

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function closureError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommerceDlqClosureOperatorError';
  error.code = code;
  error.details = details;
  return error;
}
