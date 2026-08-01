#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import { buildWranglerOAuthEnvironment } from './lib/cloudflare-auth-environment.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  CHATWOOT_FINAL_UAT_SUCCESS_MARKER,
  buildChatwootFinalUatSnapshotSql,
  classifyChatwootFinalUatCompletion,
  normalizeChatwootFinalUatSnapshot,
} from './lib/chatwoot-final-30d-daily-uat.js';
import {
  CHATWOOT_INITIAL_FAILURE_INSPECTOR_CONFIRMATION,
  CHATWOOT_INITIAL_FAILURE_RECOVERY_CONFIRMATION,
  CHATWOOT_INITIAL_FAILURE_RECOVERY_CONTRACT_VERSION,
  assertChatwootInitialFailureRecoveryConfirmation,
  buildChatwootCurrentIncidentClosureSql,
  buildChatwootInitialFailureReactivationSql,
  validateRetainedSession,
} from './lib/chatwoot-initial-terminal-failure-recovery.js';
import {
  CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY_CONFIRMATION,
  CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY_SUCCESS_MARKER,
  assertChatwootFinalSourceRecoverySummary,
  parseChatwootWranglerJsonOutput,
} from './lib/chatwoot-final-source-config-recovery.js';

const ROOT = resolve(process.cwd());
const DATABASE_NAME = 'social-mkt-state-dev';
const SUCCESS_MARKER = 'CHATWOOT_INITIAL_TERMINAL_FAILURE_RECOVERY_COMPLETED_SAFE';

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'CHATWOOT_INITIAL_FAILURE_RECOVERY_FAILED',
    message: error?.message ?? String(error),
    details: scrub(error?.details ?? {}),
    safeRestore: 'REQUIRED_BY_INNER_OPERATOR_AFTER_ACTIVE_DEPLOYMENT',
    scheduleEnabled: false,
    webhookEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((argument) => argument !== '--execute')) {
    throw operatorError('Recovery accepts only --execute', 'CHATWOOT_INITIAL_FAILURE_ARGUMENT_INVALID');
  }
  if (!args.includes('--execute')) return printPlan();

  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const sourceEnv = Object.freeze({ ...fileEnv, ...process.env });
  assertChatwootInitialFailureRecoveryConfirmation(sourceEnv);
  const head = assertRepositoryState();
  const configPath = resolve(ROOT, sourceEnv.MKT_CHATWOOT_INITIAL_FAILURE_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc');
  const env = Object.freeze({
    ...sourceEnv,
    [CHATWOOT_INITIAL_FAILURE_INSPECTOR_CONFIRMATION.envName]:
      CHATWOOT_INITIAL_FAILURE_INSPECTOR_CONFIRMATION.value,
  });
  runInherited('node', ['scripts/chatwoot-initial-terminal-failure-inspector.mjs', '--execute'], env);
  const inspectionPath = join(
    ROOT,
    'outputs',
    'chatwoot-initial-terminal-failure-inspector',
    head,
    'inspection.json',
  );
  const evidence = JSON.parse(await readFile(inspectionPath, 'utf8'));
  const inspection = evidence.inspection;
  const retainedSessionPath = resolve(ROOT, evidence.retainedSessionPath);
  const session = validateRetainedSession(JSON.parse(await readFile(retainedSessionPath, 'utf8')));
  if (inspection?.operation?.operationId !== session.initial.operationId) {
    throw operatorError('Inspector/session identity drifted', 'CHATWOOT_INITIAL_FAILURE_SESSION_INVALID');
  }

  const recoveryDirectory = join(ROOT, 'outputs', 'chatwoot-initial-terminal-failure-recovery', head);
  await mkdir(recoveryDirectory, { recursive: true, mode: 0o700 });
  const wranglerEnv = buildWranglerOAuthEnvironment(env);
  let reactivatedRows = 0;
  if (inspection.workLifecycle === 'terminal') {
    const backup = await createBackup(wranglerEnv, configPath, recoveryDirectory);
    await writePrivateJson(join(recoveryDirectory, '01-reactivation.attempt.json'), {
      contractVersion: CHATWOOT_INITIAL_FAILURE_RECOVERY_CONTRACT_VERSION,
      repositoryHead: head,
      retainedSessionFingerprint: session.sessionFingerprint,
      inspectionFingerprint: sha256(JSON.stringify(inspection)),
      backup,
      mutationScope: ['exact sync_work_runs lifecycle row'],
      queueAction: false,
      businessMutation: false,
      coverageMutation: false,
      larkMutation: false,
      incidentClosure: false,
    });
    const rows = executeD1(wranglerEnv, configPath,
      buildChatwootInitialFailureReactivationSql(inspection));
    const result = rows.find((row) => Object.hasOwn(row, 'reactivated_rows'));
    if (Number(result?.reactivated_rows) !== 1) {
      throw operatorError('Exact Work reactivation did not update one row', 'CHATWOOT_INITIAL_FAILURE_REACTIVATION_FAILED');
    }
    reactivatedRows = 1;
  } else if (inspection.workLifecycle !== 'active') {
    throw operatorError('Recovery Work is neither terminal nor reactivated', 'CHATWOOT_INITIAL_FAILURE_BOUNDARY_DRIFT');
  }

  const childEnv = Object.freeze({
    ...env,
    [CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY_CONFIRMATION.envName]:
      CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY_CONFIRMATION.value,
    MKT_CHATWOOT_INITIAL_FAILURE_RECOVERY_SESSION_PATH: retainedSessionPath,
  });
  runInherited('node', ['scripts/chatwoot-final-source-config-recovery-launcher.mjs', '--execute'], childEnv);

  const sourceSummary = JSON.parse(await readFile(join(
    ROOT,
    'outputs',
    'chatwoot-final-source-config-recovery',
    head,
    '03-summary.json',
  ), 'utf8'));
  if (sourceSummary.marker !== CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY_SUCCESS_MARKER) {
    throw operatorError('Source-config recovery marker is missing', 'CHATWOOT_INITIAL_FAILURE_INNER_SUMMARY_INVALID');
  }
  const uatEvidence = JSON.parse(await readFile(join(
    ROOT,
    'outputs',
    'chatwoot-final-30d-daily-uat',
    head,
    'summary.json',
  ), 'utf8'));
  const uatSummary = uatEvidence.data ?? uatEvidence;
  assertChatwootFinalSourceRecoverySummary(uatSummary);

  await writePrivateJson(join(recoveryDirectory, '02-current-incident-closure.attempt.json'), {
    contractVersion: CHATWOOT_INITIAL_FAILURE_RECOVERY_CONTRACT_VERSION,
    repositoryHead: head,
    retainedSessionFingerprint: session.sessionFingerprint,
    uatSummaryFingerprint: sha256(JSON.stringify(uatSummary)),
    sourceSummaryFingerprint: sha256(JSON.stringify(sourceSummary)),
    mutationScope: ['exact current DLQ status', 'exact current DLQ metadata', 'exact current Alert status'],
    queueSend: false,
    queueRedrive: false,
    businessMutation: false,
    coverageMutation: false,
    larkMutation: false,
    workerDeployment: false,
  });
  const closureRows = executeD1(wranglerEnv, configPath, buildChatwootCurrentIncidentClosureSql(
    session.initial,
    { recoveryReference: `chatwoot-initial-terminal-recovery:${head}`, completedAt: Date.now() },
  ));
  for (const field of ['current_terminal_rows', 'current_metadata_rows', 'current_alert_rows']) {
    const row = closureRows.find((value) => Object.hasOwn(value, field));
    if (Number(row?.[field]) !== 1) {
      throw operatorError('Current incident closure did not update the exact row set', 'CHATWOOT_INITIAL_FAILURE_CLOSURE_FAILED', { field });
    }
  }

  const finalSnapshot = normalizeChatwootFinalUatSnapshot(readOneD1Row(
    wranglerEnv,
    configPath,
    buildChatwootFinalUatSnapshotSql(session.initial),
  ));
  const finalClassification = classifyChatwootFinalUatCompletion(finalSnapshot, session.initial, {
    allowedDlqRecords: 1,
    allowedOpenAlerts: 0,
  });
  if (!finalClassification.complete) {
    throw operatorError('Recovered Initial operation is not accepted', 'CHATWOOT_INITIAL_FAILURE_FINAL_STATE_INVALID', { missing: finalClassification.missing });
  }

  const final = {
    ok: true,
    marker: SUCCESS_MARKER,
    innerMarker: CHATWOOT_FINAL_UAT_SUCCESS_MARKER,
    sourceRecoveryMarker: CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY_SUCCESS_MARKER,
    repositoryHead: head,
    initial30DayVerified: true,
    initialReplayVerified: true,
    daily3DayVerified: true,
    dailyReplayVerified: true,
    baselinePreserved: true,
    retainedIncidentResolved: true,
    currentIncidentResolved: true,
    restoredAllFlagsFalse: true,
    activeLockCount: 0,
    reactivatedRows,
    currentIncidentClosureRows: 3,
    secondInitialAdmission: false,
    exactExistingWorkContinuation: true,
    scheduleEnabled: false,
    webhookEnabled: false,
    production: false,
  };
  await writePrivateJson(join(recoveryDirectory, '03-summary.json'), final);
  process.stdout.write(`${JSON.stringify(final, null, 2)}\n`);
}

function printPlan() {
  const confirmation = CHATWOOT_INITIAL_FAILURE_RECOVERY_CONFIRMATION;
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: CHATWOOT_INITIAL_FAILURE_RECOVERY_CONTRACT_VERSION,
    command: `${confirmation.envName}=${confirmation.value} node scripts/chatwoot-initial-terminal-failure-recovery-launcher.mjs --execute`,
    sequence: [
      'SELECT-only exact incident inspection',
      'fresh Remote D1 backup',
      'one exact guarded Work lifecycle reactivation when terminal',
      'exact existing-Work continuation (never a second Initial admission)',
      'Initial completion and replay',
      'Daily completion and replay',
      '15-target D1/Lark parity and non-empty Lark delivery',
      'all-false Safe restore',
      'retained old source-config incident closure',
      'current exact terminal incident closure',
    ],
    remoteActionsPerformed: false,
    scheduleEnabled: false,
    webhookEnabled: false,
    production: false,
  }, null, 2)}\n`);
}

function assertRepositoryState() {
  run('git', ['fetch', 'origin', 'main', '--quiet'], process.env);
  const head = run('git', ['rev-parse', 'HEAD'], process.env).stdout.trim();
  const main = run('git', ['rev-parse', 'origin/main'], process.env).stdout.trim();
  const branch = run('git', ['branch', '--show-current'], process.env).stdout.trim();
  const dirty = run('git', ['status', '--porcelain', '--untracked-files=all'], process.env).stdout.trim();
  if (head !== main || branch !== 'main' || dirty !== '') {
    throw operatorError('Recovery requires clean exact current main', 'CHATWOOT_INITIAL_FAILURE_REPOSITORY_INVALID', { head, originMain: main, branch, clean: dirty === '' });
  }
  return head;
}

async function createBackup(env, configPath, directory) {
  const path = join(directory, `before-reactivation-${Date.now()}.sql`);
  run('npx', ['wrangler', 'd1', 'export', DATABASE_NAME, '--remote', '--config', configPath,
    '--output', path, '--skip-confirmation'], env);
  await chmod(path, 0o600);
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size <= 0) throw operatorError('D1 backup is invalid', 'CHATWOOT_INITIAL_FAILURE_BACKUP_INVALID');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return Object.freeze({ file: relative(ROOT, path), bytes: metadata.size, sha256: hash.digest('hex') });
}

function executeD1(env, configPath, sql) {
  const result = run('npx', ['wrangler', 'd1', 'execute', DATABASE_NAME, '--remote', '--json',
    '--config', configPath, '--command', sql], env);
  const parsed = parseChatwootWranglerJsonOutput(result.stdout, 'Chatwoot recovery D1 output');
  const containers = Array.isArray(parsed) ? parsed : [parsed];
  return containers.flatMap((container) => (
    container?.results ?? container?.result?.results ?? (Array.isArray(container?.result) ? container.result : [])
  )).filter((row) => row && typeof row === 'object' && !Array.isArray(row));
}

function readOneD1Row(env, configPath, sql) {
  const rows = executeD1(env, configPath, sql);
  if (rows.length !== 1) throw operatorError('D1 read returned an unexpected row count', 'CHATWOOT_INITIAL_FAILURE_D1_SHAPE_INVALID', { rowCount: rows.length });
  return rows[0];
}

function runInherited(command, args, env) {
  const result = spawnSync(command, args, { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw operatorError(`Child failed: ${command}`, 'CHATWOOT_INITIAL_FAILURE_CHILD_FAILED', { exitCode: result.status ?? null });
}

function run(command, args, env) {
  const result = spawnSync(command, args, { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw operatorError(`Command failed: ${command}`, 'CHATWOOT_INITIAL_FAILURE_COMMAND_FAILED', { command, exitCode: result.status ?? null });
  return result;
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(scrub(value), null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

function scrub(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/token|secret|authorization|password|cookie|tableId|accountId|queueId/iu.test(key))
    .map(([key, nested]) => [key, scrub(nested)]));
}
function sha256(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function operatorError(message, code, details = {}) { const error = new Error(message); error.code = code; error.details = details; return error; }
