#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import { buildWranglerOAuthEnvironment } from './lib/cloudflare-auth-environment.js';
import { readDevVars } from './lib/dev-vars.js';
import { rebaseGeneratedWranglerConfigPaths } from './lib/rebase-generated-wrangler-config-paths.js';
import {
  CHATWOOT_FINAL_UAT_CONFIRMATION,
  CHATWOOT_FINAL_UAT_SUCCESS_MARKER,
  buildChatwootFinalUatSnapshotSql,
  normalizeChatwootFinalUatSnapshot,
  stableJson,
} from './lib/chatwoot-final-30d-daily-uat.js';
import {
  CHATWOOT_FINAL_SOURCE_CONFIG_INCIDENT,
  CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY_CONFIRMATION,
  CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY_CONTRACT_VERSION,
  CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY_SUCCESS_MARKER,
  assertChatwootFinalSourceConfigRecoveryConfirmation,
  assertChatwootFinalSourceIncidentOpen,
  assertChatwootFinalSourceIncidentResolved,
  assertChatwootFinalSourceRecoverySummary,
  buildChatwootFinalSourceIncidentClosureSql,
  buildChatwootFinalSourceIncidentSql,
  fingerprintChatwootFinalSourceRecovery,
  materializeChatwootFinalSourceConfig,
  normalizeChatwootFinalSourceIncident,
  resolveChatwootFinalSourceIdentity,
} from './lib/chatwoot-final-source-config-recovery.js';

const ROOT = resolve(process.cwd());
const DATABASE_NAME = 'social-mkt-state-dev';
const WORKER_NAME = 'social-mkt-sync-worker';
const LOCK_LOWER = 'integration_workspace:chatwoot:chemistry_k:';
const LOCK_UPPER = 'integration_workspace:chatwoot:chemistry_k;';
const EXECUTE_ARGUMENT = '--execute';
const WRANGLER_METRIC_KEYS = new Set([
  'Database size (MB)',
  'Rows read',
  'Rows written',
  'Total queries executed',
]);
let generatedConfigPath = null;

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY_FAILED',
    message: error?.message ?? String(error),
    details: scrub(error?.details ?? {}),
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  if (generatedConfigPath) {
    await rm(generatedConfigPath, { force: true }).catch(() => undefined);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((argument) => argument !== EXECUTE_ARGUMENT)) {
    throw recoveryError(
      'Chatwoot source-config recovery accepts only --execute',
      'CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY_ARGUMENT_INVALID',
    );
  }
  if (!args.includes(EXECUTE_ARGUMENT)) {
    printPlan();
    return;
  }

  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const sourceEnv = Object.freeze({ ...fileEnv, ...process.env });
  assertChatwootFinalSourceConfigRecoveryConfirmation(sourceEnv);
  const repository = assertRepositoryState();
  const sourceIdentity = resolveChatwootFinalSourceIdentity(sourceEnv);
  generatedConfigPath = await createSourceCompleteConfig(sourceEnv, sourceIdentity);

  const evidenceDirectory = inside(join(
    'outputs',
    'chatwoot-final-source-config-recovery',
    repository.head,
  ));
  const uatDirectory = inside(join(
    'outputs',
    'chatwoot-final-30d-daily-uat',
    repository.head,
  ));
  const env = Object.freeze({
    ...sourceEnv,
    [CHATWOOT_FINAL_UAT_CONFIRMATION.envName]: CHATWOOT_FINAL_UAT_CONFIRMATION.value,
    MKT_CHATWOOT_FINAL_UAT_WRANGLER_CONFIG: generatedConfigPath,
    MKT_CHATWOOT_FINAL_UAT_EVIDENCE_DIR: uatDirectory,
  });
  await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  const summaryPath = join(uatDirectory, 'summary.json');
  const summaryExists = await regularFile(summaryPath);

  let incidentBefore = readIncident(env);
  if (isIncidentResolved(incidentBefore)) {
    assertChatwootFinalSourceIncidentResolved(incidentBefore, {
      recoveryReference: recoveryReference(repository.head),
    });
  } else if (!summaryExists) {
    assertChatwootFinalSourceIncidentOpen(incidentBefore);
  } else {
    assertIncidentReadyForClosure(incidentBefore);
  }

  if (!summaryExists) {
    await writePrivateJson(join(evidenceDirectory, '01-uat-attempt.json'), {
      contractVersion: CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY_CONTRACT_VERSION,
      repositoryHead: repository.head,
      sourceIdentityFingerprint: sourceIdentity.fingerprint,
      retainedIncidentFingerprint: fingerprintChatwootFinalSourceRecovery(
        normalizeChatwootFinalSourceIncident(incidentBefore),
      ),
      attemptedAt: new Date().toISOString(),
      queueAdmissionOwnedBy: 'chatwoot-final-30d-daily-uat-launcher',
      evidenceDirectory: relative(ROOT, uatDirectory),
      scheduleEnabled: false,
      webhookEnabled: false,
      production: false,
    });
    runInherited(
      'node',
      ['scripts/chatwoot-final-30d-daily-uat-launcher.mjs', EXECUTE_ARGUMENT],
      env,
    );
  }

  const summaryEvidence = await readPrivateJson(summaryPath, 'Final UAT summary');
  const summary = summaryEvidence?.data ?? summaryEvidence;
  assertChatwootFinalSourceRecoverySummary(summary);
  if (summary.repositoryHead !== repository.head
      || summaryEvidence.repositoryHead !== repository.head) {
    throw recoveryError(
      'Final UAT summary belongs to another Repository Head',
      'CHATWOOT_FINAL_SOURCE_CONFIG_UAT_SUMMARY_INVALID',
    );
  }

  const safeRestoreEvidence = await readPrivateJson(
    join(uatDirectory, 'safe-restore.json'),
    'Safe restore evidence',
  );
  assertSafeRestoreEvidence(safeRestoreEvidence, repository.head);
  const session = await readPrivateJson(join(uatDirectory, 'session.json'), 'Final UAT session');
  assertSession(session, repository.head);

  const remoteSafe = assertRemoteWorkerAllFlagsFalse(env, generatedConfigPath);
  const activeLockCount = readExactActiveLockCount(env);
  if (activeLockCount !== 0) {
    throw recoveryError(
      'Exact Chatwoot lock scope remains active after UAT',
      'CHATWOOT_FINAL_SOURCE_CONFIG_ACTIVE_LOCK_BLOCKED',
      { activeLockCount },
    );
  }

  const snapshotsBefore = Object.freeze({
    initial: readSnapshot(env, session.initial),
    daily: readSnapshot(env, session.daily),
  });
  const reference = recoveryReference(repository.head);
  incidentBefore = readIncident(env);

  let closureMutationCount = 0;
  let backup = null;
  if (isIncidentResolved(incidentBefore)) {
    assertChatwootFinalSourceIncidentResolved(incidentBefore, {
      recoveryReference: reference,
    });
  } else {
    assertIncidentReadyForClosure(incidentBefore);
    backup = await createBackup(env, evidenceDirectory);
    await writePrivateJson(join(evidenceDirectory, '02-closure-attempt.json'), {
      contractVersion: CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY_CONTRACT_VERSION,
      repositoryHead: repository.head,
      attemptedAt: new Date().toISOString(),
      recoveryReference: reference,
      incidentFingerprint: fingerprintChatwootFinalSourceRecovery(
        normalizeChatwootFinalSourceIncident(incidentBefore),
      ),
      uatSummaryFingerprint: fingerprintChatwootFinalSourceRecovery(summary),
      snapshotsFingerprint: fingerprintChatwootFinalSourceRecovery(snapshotsBefore),
      backup,
      mutationScope: [
        'dead_letter_jobs exact retained row status metadata',
        'dead_letter_operation_metadata exact retained row recovery metadata',
        'system_alerts exact retained row status metadata',
      ],
      queueSend: false,
      queueRedrive: false,
      businessMutation: false,
      larkMutation: false,
      workerDeployment: false,
      scheduleEnabled: false,
      webhookEnabled: false,
      production: false,
    });
    executeD1(
      env,
      buildChatwootFinalSourceIncidentClosureSql({
        completedAt: Date.now(),
        recoveryReference: reference,
      }),
    );
    closureMutationCount = 1;
  }

  const incidentAfter = readIncident(env);
  assertChatwootFinalSourceIncidentResolved(incidentAfter, {
    recoveryReference: reference,
  });
  const snapshotsAfter = Object.freeze({
    initial: readSnapshot(env, session.initial),
    daily: readSnapshot(env, session.daily),
  });
  if (stableJson(snapshotsAfter) !== stableJson(snapshotsBefore)) {
    throw recoveryError(
      'Incident closure changed current Chatwoot UAT facts',
      'CHATWOOT_FINAL_SOURCE_CONFIG_CLOSURE_DRIFT',
    );
  }

  const remoteSafeAfter = assertRemoteWorkerAllFlagsFalse(env, generatedConfigPath);
  const finalLockCount = readExactActiveLockCount(env);
  if (finalLockCount !== 0) {
    throw recoveryError(
      'Exact Chatwoot lock scope is active after incident closure',
      'CHATWOOT_FINAL_SOURCE_CONFIG_ACTIVE_LOCK_BLOCKED',
      { activeLockCount: finalLockCount },
    );
  }

  const final = {
    ok: true,
    marker: CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY_SUCCESS_MARKER,
    innerMarker: CHATWOOT_FINAL_UAT_SUCCESS_MARKER,
    repositoryHead: repository.head,
    sourceIdentityVerified: true,
    sourceIdentityFingerprint: sourceIdentity.fingerprint,
    initial30DayVerified: true,
    initialReplayVerified: true,
    daily3DayVerified: true,
    dailyReplayVerified: true,
    retainedIncidentResolved: true,
    retainedIncidentOperationFingerprint: fingerprintChatwootFinalSourceRecovery(
      CHATWOOT_FINAL_SOURCE_CONFIG_INCIDENT.operationId,
    ),
    closureMutationCount,
    closureBackup: backup,
    currentUatSnapshotDrift: false,
    restoredAllFlagsFalse: true,
    safeVersionFingerprint: remoteSafeAfter.versionFingerprint,
    safeVersionStableAcrossClosure:
      remoteSafe.versionFingerprint === remoteSafeAfter.versionFingerprint,
    exactLockScopeVerified: true,
    activeLockCount: 0,
    queueRedrive: false,
    scheduleEnabled: false,
    webhookEnabled: false,
    production: false,
  };
  await writePrivateJson(join(evidenceDirectory, '03-summary.json'), final);
  process.stdout.write(`${JSON.stringify({
    ...final,
    evidenceDirectory: relative(ROOT, evidenceDirectory),
  }, null, 2)}\n`);
}

function printPlan() {
  const confirmation = CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY_CONFIRMATION;
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY_CONTRACT_VERSION,
    command: `${confirmation.envName}=${confirmation.value} node scripts/chatwoot-final-source-config-recovery-launcher.mjs --execute`,
    sequence: [
      'exact clean current main',
      'materialize private non-secret Chatwoot source identity',
      'verify exact retained terminal incident',
      'run or resume guarded Final UAT',
      'verify all-false Safe state and zero exact lock',
      'backup Remote D1',
      'resolve exact retained DLQ metadata and alert only',
      'verify zero current-UAT snapshot drift',
    ],
    sourceFieldsMaterialized: ['CHATWOOT_BASE_URL', 'CHATWOOT_ACCOUNT_ID'],
    secretValuesMaterialized: 0,
    evidenceDirectoryBoundToRepositoryHead: true,
    queueRedrive: false,
    scheduleEnabled: false,
    webhookEnabled: false,
    production: false,
    remoteActionsPerformed: false,
  }, null, 2)}\n`);
}

async function createSourceCompleteConfig(env, identity) {
  const sourcePath = inside(env.MKT_CHATWOOT_FINAL_UAT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc');
  const sourceText = await readFile(sourcePath, 'utf8');
  const materialized = materializeChatwootFinalSourceConfig(sourceText, identity);
  const directory = inside(join(
    'outputs',
    'chatwoot-final-source-config-recovery',
    '.generated',
  ));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const rebased = rebaseGeneratedWranglerConfigPaths(materialized.text, {
    sourceDirectory: dirname(sourcePath),
    outputDirectory: directory,
  });
  const path = join(directory, `wrangler-source-complete-${Date.now()}-${process.pid}.json`);
  await writeFile(path, rebased.text, { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

function assertRepositoryState() {
  run('git', ['fetch', 'origin', 'main', '--quiet']);
  const head = run('git', ['rev-parse', 'HEAD']).stdout.trim();
  const originMain = run('git', ['rev-parse', 'origin/main']).stdout.trim();
  const dirty = run('git', ['status', '--porcelain', '--untracked-files=all']).stdout.trim();
  if (head !== originMain || dirty !== '') {
    throw recoveryError(
      'Chatwoot source-config recovery requires clean exact current main',
      'CHATWOOT_FINAL_SOURCE_CONFIG_REPOSITORY_INVALID',
      { head, originMain, clean: dirty === '' },
    );
  }
  return Object.freeze({ head, originMain, clean: true });
}

function readIncident(env) {
  return readOneD1Row(env, buildChatwootFinalSourceIncidentSql());
}

function assertIncidentReadyForClosure(row) {
  const state = normalizeChatwootFinalSourceIncident(row);
  const incident = CHATWOOT_FINAL_SOURCE_CONFIG_INCIDENT;
  const exactIdentity = state.queueRows === 1
    && state.queueAttempts === 1
    && state.queueGenerationMin === incident.generation
    && state.queueGenerationMax === incident.generation
    && state.queueRequestedMin === incident.requestedAt
    && state.queueRequestedMax === incident.requestedAt
    && state.queueMessageId === incident.messageId
    && state.metadataRows === 1
    && state.metadataGeneration === incident.generation
    && state.metadataRequestedAt === incident.requestedAt
    && state.recoveryStatus === 'not_started'
    && state.recoveryReference === null
    && state.auditReference === null
    && state.terminalRows === 1
    && state.terminalStatus === 'open'
    && state.terminalErrorCode === incident.errorCode
    && state.terminalErrorMessage === incident.errorMessage
    && state.terminalRetryCount === 1
    && state.terminalJobType === incident.jobType
    && state.alertRows === 1
    && state.alertStatus === 'open'
    && state.alertType === 'queue_permanent_failure'
    && state.alertSeverity === 'critical'
    && state.alertPlatform === 'chatwoot'
    && state.alertErrorCode === incident.errorCode
    && state.syncRows === 0
    && state.workRows === 0
    && state.phaseRows === 0
    && state.coverageRows === 0
    && state.activeLocks === 0;
  if (!exactIdentity) {
    throw recoveryError(
      'Retained Chatwoot incident is not safe for completion-only closure',
      'CHATWOOT_FINAL_SOURCE_CONFIG_INCIDENT_INVALID',
      {
        queueRows: state.queueRows,
        queueAttempts: state.queueAttempts,
        recoveryStatus: state.recoveryStatus,
        terminalStatus: state.terminalStatus,
        terminalErrorCode: state.terminalErrorCode,
        alertStatus: state.alertStatus,
        syncRows: state.syncRows,
        workRows: state.workRows,
        phaseRows: state.phaseRows,
        coverageRows: state.coverageRows,
        activeLocks: state.activeLocks,
      },
    );
  }
  return state;
}

function isIncidentResolved(row) {
  const state = normalizeChatwootFinalSourceIncident(row);
  return state.recoveryStatus === 'completed'
    && state.terminalStatus === 'resolved'
    && state.alertStatus === 'resolved';
}

function assertSafeRestoreEvidence(evidence, head) {
  const accepted = evidence?.repositoryHead === head
    && evidence?.stage === 'safe-restore'
    && evidence?.data?.allFlagsFalse === true
    && evidence?.data?.scheduleEnabled === false
    && evidence?.data?.webhookEnabled === false
    && evidence?.data?.production === false;
  if (!accepted) {
    throw recoveryError(
      'Final UAT Safe restore evidence is invalid',
      'CHATWOOT_FINAL_SOURCE_CONFIG_SAFE_RESTORE_INVALID',
    );
  }
}

function assertSession(session, head) {
  const accepted = session?.repositoryHead === head
    && session?.initial?.mode === 'initial'
    && session?.daily?.mode === 'daily'
    && Number.isSafeInteger(session?.initial?.originalRequestedAt)
    && Number.isSafeInteger(session?.daily?.originalRequestedAt);
  if (!accepted) {
    throw recoveryError(
      'Final UAT session is invalid',
      'CHATWOOT_FINAL_SOURCE_CONFIG_SESSION_INVALID',
    );
  }
}

function readSnapshot(env, operation) {
  return normalizeChatwootFinalUatSnapshot(
    readOneD1Row(env, buildChatwootFinalUatSnapshotSql(operation)),
  );
}

function readExactActiveLockCount(env) {
  const lower = sqlText(LOCK_LOWER);
  const upper = sqlText(LOCK_UPPER);
  const row = readOneD1Row(env, [
    'SELECT COUNT(*) AS active_chatwoot_locks',
    'FROM sync_locks',
    `WHERE lock_key>=${lower}`,
    `AND lock_key<${upper}`,
    "AND expires_at>unixepoch('now')*1000;",
  ].join(' '));
  const count = Number(row.active_chatwoot_locks);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw recoveryError(
      'Exact Chatwoot lock count is invalid',
      'CHATWOOT_FINAL_SOURCE_CONFIG_LOCK_READ_INVALID',
    );
  }
  return count;
}

function assertRemoteWorkerAllFlagsFalse(env, configPath) {
  const status = parseJson(run('npx', [
    'wrangler', 'deployments', 'status',
    '--name', WORKER_NAME,
    '--config', configPath,
    '--json',
  ], { env }).stdout, 'Worker deployment status');
  const item = Array.isArray(status) ? status[0] : status;
  const active = (item?.versions ?? []).filter(
    (version) => Number(version.percentage) === 100,
  );
  if (active.length !== 1) {
    throw recoveryError(
      'Safe verification requires one 100% active Worker version',
      'CHATWOOT_FINAL_SOURCE_CONFIG_SAFE_STATE_INVALID',
    );
  }
  const versionId = String(active[0].version_id ?? active[0].id ?? '');
  if (!/^[0-9a-f-]{36}$/u.test(versionId)) {
    throw recoveryError(
      'Active Worker version identity is invalid',
      'CHATWOOT_FINAL_SOURCE_CONFIG_SAFE_STATE_INVALID',
    );
  }
  const view = parseJson(run('npx', [
    'wrangler', 'versions', 'view', versionId,
    '--name', WORKER_NAME,
    '--config', configPath,
    '--json',
  ], { env }).stdout, 'Worker version view');
  const viewItem = Array.isArray(view) ? view[0] : view;
  const bindings = viewItem?.bindings ?? viewItem?.resources?.bindings ?? [];
  const trueFlags = bindings.filter((binding) => {
    const name = String(binding.name ?? binding.binding ?? '');
    const value = binding.text ?? binding.value;
    return /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name)
      && (value === true || String(value).toLowerCase() === 'true');
  }).map((binding) => String(binding.name ?? binding.binding)).sort();
  if (trueFlags.length !== 0) {
    throw recoveryError(
      'Worker contains a true execution flag after Safe restore',
      'CHATWOOT_FINAL_SOURCE_CONFIG_SAFE_STATE_INVALID',
      { trueFlags },
    );
  }
  return Object.freeze({
    versionFingerprint: sha256(versionId),
    trueFlagCount: 0,
  });
}

async function createBackup(env, evidenceDirectory) {
  const path = join(
    evidenceDirectory,
    `before-retained-incident-closure-${Date.now()}.sql`,
  );
  run('npx', [
    'wrangler', 'd1', 'export', DATABASE_NAME,
    '--remote', '--config', generatedConfigPath,
    '--output', path, '--skip-confirmation',
  ], { env: buildWranglerOAuthEnvironment(env) });
  await chmod(path, 0o600);
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size <= 0) {
    throw recoveryError(
      'Retained incident closure backup is empty',
      'CHATWOOT_FINAL_SOURCE_CONFIG_BACKUP_INVALID',
    );
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return Object.freeze({
    file: relative(ROOT, path),
    bytes: metadata.size,
    sha256: hash.digest('hex'),
  });
}

function readOneD1Row(env, sql) {
  const rows = executeD1(env, sql);
  if (rows.length !== 1) {
    throw recoveryError(
      'Remote D1 read returned an unexpected row count',
      'CHATWOOT_FINAL_SOURCE_CONFIG_D1_SHAPE_INVALID',
      { rowCount: rows.length },
    );
  }
  return Object.freeze({ ...rows[0] });
}

function executeD1(env, sql) {
  const result = run('npx', [
    'wrangler', 'd1', 'execute', DATABASE_NAME,
    '--remote', '--json',
    '--config', generatedConfigPath,
    '--command', sql,
  ], { env: buildWranglerOAuthEnvironment(env) });
  return extractD1Rows(result.stdout);
}

function extractD1Rows(output) {
  const parsed = parseJson(output, 'Remote D1 output');
  const containers = Array.isArray(parsed) ? parsed : [parsed];
  const rows = [];
  for (const container of containers) {
    const candidates = [
      container?.results,
      container?.result?.results,
      Array.isArray(container?.result) ? container.result : null,
    ];
    for (const candidate of candidates) {
      if (!Array.isArray(candidate)) continue;
      for (const row of candidate) {
        if (row && typeof row === 'object' && !Array.isArray(row)
            && !isWranglerMetricRow(row)) {
          rows.push(row);
        }
      }
    }
  }
  return rows;
}

function isWranglerMetricRow(row) {
  const keys = Object.keys(row ?? {});
  return keys.length > 0 && keys.every((key) => WRANGLER_METRIC_KEYS.has(key));
}

function runInherited(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) {
    throw recoveryError(
      `Command failed: ${command}`,
      'CHATWOOT_FINAL_SOURCE_CONFIG_CHILD_FAILED',
      {
        command,
        exitCode: result.status ?? null,
        spawnErrorCode: result.error?.code ?? null,
      },
    );
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw recoveryError(
      `Command failed: ${command}`,
      'CHATWOOT_FINAL_SOURCE_CONFIG_COMMAND_FAILED',
      {
        command,
        exitCode: result.status ?? null,
        spawnErrorCode: result.error?.code ?? null,
        stderrFingerprint: result.stderr ? sha256(String(result.stderr)) : null,
      },
    );
  }
  return result;
}

async function readPrivateJson(path, label) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    throw recoveryError(
      `${label} is missing`,
      'CHATWOOT_FINAL_SOURCE_CONFIG_EVIDENCE_MISSING',
      { label, errorCode: cause?.code ?? null },
    );
  }
  return parseJson(text, label);
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(scrub(value), null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

async function regularFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function parseJson(value, label) {
  try {
    return JSON.parse(String(value ?? '').trim());
  } catch (cause) {
    throw recoveryError(
      `${label} returned invalid JSON`,
      'CHATWOOT_FINAL_SOURCE_CONFIG_JSON_INVALID',
      { label, cause: cause?.message ?? 'JSON_PARSE_FAILED' },
    );
  }
}

function recoveryReference(head) {
  return `chatwoot-source-config-recovery:${head}`;
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function inside(value) {
  const path = resolve(ROOT, value);
  if (relative(ROOT, path).startsWith('..')) {
    throw recoveryError(
      'Path leaves Repository',
      'CHATWOOT_FINAL_SOURCE_CONFIG_PATH_INVALID',
    );
  }
  return path;
}

function scrub(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/token|secret|authorization|password|cookie|baseUrl|accountId|tableId|queueId/iu.test(key))
    .map(([key, nested]) => [key, scrub(nested)]));
}

function recoveryError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootFinalSourceConfigRecoveryLauncherError';
  error.code = code;
  error.details = details;
  return error;
}
