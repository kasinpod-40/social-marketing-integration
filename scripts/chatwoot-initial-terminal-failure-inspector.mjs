#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import { buildWranglerOAuthEnvironment } from './lib/cloudflare-auth-environment.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  CHATWOOT_INITIAL_FAILURE_INSPECTED_MARKER,
  CHATWOOT_INITIAL_FAILURE_INSPECTOR_CONFIRMATION,
  CHATWOOT_INITIAL_FAILURE_INSPECTOR_CONTRACT_VERSION,
  assertChatwootInitialFailureInspectorConfirmation,
  buildChatwootInitialFailureCandidateSql,
  buildChatwootInitialFailureInspectorSql,
  normalizeChatwootInitialFailureInspection,
  selectLatestIncompleteChatwootSession,
} from './lib/chatwoot-initial-terminal-failure-recovery.js';
import {
  fingerprintChatwootFinalSourceRecovery,
  parseChatwootWranglerJsonOutput,
} from './lib/chatwoot-final-source-config-recovery.js';

const ROOT = resolve(process.cwd());
const DATABASE_NAME = 'social-mkt-state-dev';
const WORKER_NAME = 'social-mkt-sync-worker';
const OUTPUT_ROOT = join('outputs', 'chatwoot-final-30d-daily-uat');

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'CHATWOOT_INITIAL_FAILURE_INSPECTOR_FAILED',
    message: error?.message ?? String(error),
    details: scrub(error?.details ?? {}),
    providerRequests: 0,
    queueActions: 0,
    remoteD1Mutations: 0,
    remoteLarkMutations: 0,
    workerDeployments: 0,
    incidentClosureActions: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((argument) => argument !== '--execute')) {
    throw inspectorError('Inspector accepts only --execute', 'CHATWOOT_INITIAL_FAILURE_ARGUMENT_INVALID');
  }
  if (!args.includes('--execute')) return printPlan();

  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });
  assertChatwootInitialFailureInspectorConfirmation(env);
  const candidates = await loadRetainedSessionCandidates(resolve(
    ROOT,
    env.MKT_CHATWOOT_INITIAL_FAILURE_OUTPUT_ROOT ?? OUTPUT_ROOT,
  ));
  const configPath = resolve(
    ROOT,
    env.MKT_CHATWOOT_INITIAL_FAILURE_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
  );
  const wranglerEnv = buildWranglerOAuthEnvironment(env);
  const admittedRows = readD1Rows(
    wranglerEnv,
    configPath,
    buildChatwootInitialFailureCandidateSql(candidates),
  );
  const admitted = new Set(admittedRows
    .filter((row) => ['active', 'terminal'].includes(row.lifecycle_status)
      && [1, 2].includes(Number(row.main_queue_attempts))
      && Number(row.unit_sync_runs) === 1)
    .map((row) => `${row.operation_id}\n${row.work_key}\n${row.generation}\n${row.original_requested_at}`));
  const retained = selectLatestIncompleteChatwootSession(candidates.map((candidate) => ({
    ...candidate,
    remoteAdmitted: admitted.has([
      candidate.session.initial.operationId,
      candidate.session.initial.workKey,
      candidate.session.initial.generation,
      candidate.session.initial.originalRequestedAt,
    ].join('\n')),
  })));
  const row = readOneD1Row(wranglerEnv, configPath,
    buildChatwootInitialFailureInspectorSql(retained.session.initial));
  const inspection = normalizeChatwootInitialFailureInspection(row, retained.session.initial);
  const worker = verifyAllFlagsFalse(wranglerEnv, configPath);
  const repositoryHead = run('git', ['rev-parse', 'HEAD'], process.env).stdout.trim();
  const evidenceDirectory = resolve(ROOT, 'outputs', 'chatwoot-initial-terminal-failure-inspector', repositoryHead);
  const evidence = {
    contractVersion: CHATWOOT_INITIAL_FAILURE_INSPECTOR_CONTRACT_VERSION,
    marker: CHATWOOT_INITIAL_FAILURE_INSPECTED_MARKER,
    repositoryHead,
    retainedRepositoryHead: retained.session.repositoryHead,
    retainedSessionPath: relative(ROOT, retained.path),
    retainedSessionFingerprint: retained.session.sessionFingerprint,
    operationIdentityFingerprint: fingerprintChatwootFinalSourceRecovery(inspection.operation),
    failedSyncRunFingerprint: fingerprintChatwootFinalSourceRecovery(inspection.failedSyncRunId),
    errorCode: inspection.errorCode,
    errorMessage: inspection.errorMessage,
    details: inspection.details,
    inspection,
    boundary: {
      workLifecycle: inspection.workLifecycle,
      mainQueueAttempts: inspection.mainQueueAttempts,
      unitSyncRuns: inspection.unitSyncRuns,
      failedUnitSyncRuns: inspection.failedUnitSyncRuns,
      coverageRuns: inspection.coverageRuns,
      failedCoverageRows: inspection.failedCoverageRows,
      durableStage: inspection.durableStage,
      nextSequence: inspection.nextSequence,
      activeLockCount: inspection.activeLockCount,
      currentDlqRecords: inspection.currentDlqRecords,
      currentOpenAlerts: inspection.currentOpenAlerts,
      businessCounts: inspection.businessCounts,
    },
    worker,
    providerRequests: 0,
    queueActions: 0,
    remoteD1Mutations: 0,
    remoteLarkMutations: 0,
    workerDeployments: 0,
    incidentClosureActions: 0,
    scheduleEnabled: false,
    webhookEnabled: false,
    production: false,
  };
  await writePrivateJson(join(evidenceDirectory, 'inspection.json'), evidence);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    marker: evidence.marker,
    retainedRepositoryHead: evidence.retainedRepositoryHead,
    operationIdentityFingerprint: evidence.operationIdentityFingerprint,
    errorCode: evidence.errorCode,
    errorMessage: evidence.errorMessage,
    details: evidence.details,
    boundary: evidence.boundary,
    worker: evidence.worker,
    providerRequests: 0,
    queueActions: 0,
    remoteD1Mutations: 0,
    remoteLarkMutations: 0,
    workerDeployments: 0,
    incidentClosureActions: 0,
    scheduleEnabled: false,
    webhookEnabled: false,
    production: false,
    evidencePath: relative(ROOT, join(evidenceDirectory, 'inspection.json')),
  }, null, 2)}\n`);
}

function printPlan() {
  const confirmation = CHATWOOT_INITIAL_FAILURE_INSPECTOR_CONFIRMATION;
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: CHATWOOT_INITIAL_FAILURE_INSPECTOR_CONTRACT_VERSION,
    command: `${confirmation.envName}=${confirmation.value} node scripts/chatwoot-initial-terminal-failure-inspector.mjs --execute`,
    reads: ['latest admitted incomplete retained session', 'exact current-operation reliability rows', 'active Worker version and bindings'],
    sqlMode: 'SELECT_only',
    providerRequests: 0,
    queueActions: 0,
    remoteD1Mutations: 0,
    remoteLarkMutations: 0,
    workerDeployments: 0,
    incidentClosureActions: 0,
    remoteActionsPerformed: false,
    scheduleEnabled: false,
    webhookEnabled: false,
    production: false,
  }, null, 2)}\n`);
}

async function loadRetainedSessionCandidates(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, entry.name);
    const sessionPath = join(directory, 'session.json');
    if (!await isFile(sessionPath)) continue;
    candidates.push({
      path: sessionPath,
      session: JSON.parse(await readFile(sessionPath, 'utf8')),
      hasInitialSendAttempt: await isFile(join(directory, 'initial-send.attempt.json')),
      hasAcceptedSummary: await isFile(join(directory, 'summary.json')),
    });
  }
  return candidates;
}

function readOneD1Row(env, configPath, sql) {
  const rows = readD1Rows(env, configPath, sql);
  if (rows.length !== 1) {
    throw inspectorError(
      'Inspector D1 query returned an unexpected row count',
      'CHATWOOT_INITIAL_FAILURE_D1_SHAPE_INVALID',
      { rowCount: rows.length },
    );
  }
  return rows[0];
}

function readD1Rows(env, configPath, sql) {
  const output = run('npx', [
    'wrangler', 'd1', 'execute', DATABASE_NAME,
    '--remote', '--json', '--config', configPath, '--command', sql,
  ], env).stdout;
  const parsed = parseChatwootWranglerJsonOutput(output, 'Chatwoot inspector D1 output');
  const containers = Array.isArray(parsed) ? parsed : [parsed];
  const rows = containers.flatMap((container) => (
    container?.results ?? container?.result?.results ?? (Array.isArray(container?.result) ? container.result : [])
  )).filter((row) => row && typeof row === 'object' && !Array.isArray(row));
  return rows;
}

function verifyAllFlagsFalse(env, configPath) {
  const status = parseChatwootWranglerJsonOutput(run('npx', [
    'wrangler', 'deployments', 'status', '--name', WORKER_NAME, '--config', configPath, '--json',
  ], env).stdout, 'Worker deployment status');
  const item = Array.isArray(status) ? status[0] : status;
  const active = (item?.versions ?? []).filter((version) => Number(version.percentage) === 100);
  if (active.length !== 1) {
    throw inspectorError('Worker does not have one active version', 'CHATWOOT_INITIAL_FAILURE_WORKER_UNSAFE');
  }
  const versionId = String(active[0].version_id ?? active[0].id ?? '');
  if (!/^[0-9a-f-]{36}$/u.test(versionId)) {
    throw inspectorError('Worker version identity is invalid', 'CHATWOOT_INITIAL_FAILURE_WORKER_UNSAFE');
  }
  const view = parseChatwootWranglerJsonOutput(run('npx', [
    'wrangler', 'versions', 'view', versionId, '--name', WORKER_NAME, '--config', configPath, '--json',
  ], env).stdout, 'Worker version view');
  const viewItem = Array.isArray(view) ? view[0] : view;
  const bindings = viewItem?.bindings ?? viewItem?.resources?.bindings ?? [];
  const trueFlags = bindings.filter((binding) => {
    const name = String(binding.name ?? binding.binding ?? '');
    const value = binding.text ?? binding.value;
    return /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name)
      && (value === true || String(value).toLowerCase() === 'true');
  }).map((binding) => String(binding.name ?? binding.binding)).sort();
  if (trueFlags.length > 0) {
    throw inspectorError(
      'Worker contains a true execution flag',
      'CHATWOOT_INITIAL_FAILURE_WORKER_UNSAFE',
      { trueFlags },
    );
  }
  return Object.freeze({
    allFlagsFalse: true,
    versionFingerprint: fingerprintChatwootFinalSourceRecovery(versionId),
  });
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw inspectorError(
      `Command failed: ${command}`,
      'CHATWOOT_INITIAL_FAILURE_COMMAND_FAILED',
      { command, exitCode: result.status ?? null, spawnErrorCode: result.error?.code ?? null },
    );
  }
  return result;
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(scrub(value), null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

async function isFile(path) {
  try { return (await stat(path)).isFile(); }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

function scrub(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/token|secret|authorization|password|cookie|tableId|accountId|queueId/iu.test(key))
    .map(([key, nested]) => [key, scrub(nested)]));
}

function inspectorError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
