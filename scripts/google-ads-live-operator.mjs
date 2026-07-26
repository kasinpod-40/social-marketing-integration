import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  GOOGLE_ADS_LIVE_OPERATOR_CONFIRMATIONS,
  GOOGLE_ADS_LIVE_OPERATOR_PHASES,
  assertGoogleAdsLiveOperatorConfirmation,
  buildGoogleAdsConnectionGateSql,
  buildGoogleAdsRunVerificationSql,
  compareGoogleAdsRerunVerification,
  loadGoogleAdsLiveOperatorTarget,
  parseGoogleAdsLiveOperatorArgs,
  requireGoogleAdsOperatorRunId,
  validateGoogleAdsConnectionGateRow,
  validateGoogleAdsFlagsFalseConfig,
  validateGoogleAdsRunVerificationRow,
} from './lib/google-ads-live-operator.js';

const EVIDENCE_ROOT = resolve(
  process.env.MKT_GOOGLE_ADS_LIVE_EVIDENCE_DIR
    ?? 'outputs/google-ads-live-operator',
);

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error?.code ?? 'GOOGLE_ADS_OPERATOR_FAILED',
    message: error?.message ?? String(error),
    details: error?.details ?? {},
  }, null, 2));
  process.exitCode = 1;
}

async function main() {
  const mode = parseGoogleAdsLiveOperatorArgs(process.argv.slice(2));
  if (mode.phase === 'plan' || mode.execute !== true) {
    printPlan(mode);
    return;
  }

  const target = loadGoogleAdsLiveOperatorTarget(process.env);
  assertGoogleAdsLiveOperatorConfirmation(mode.phase, process.env);
  await mkdir(EVIDENCE_ROOT, { recursive: true });
  const result = await runPhase(mode.phase, target);
  console.log(JSON.stringify({
    ok: true,
    phase: mode.phase,
    evidenceRoot: EVIDENCE_ROOT,
    ...result,
  }, null, 2));
}

function printPlan(mode) {
  console.log(JSON.stringify({
    ok: true,
    executed: false,
    requestedPhase: mode.phase === 'plan' ? null : mode.phase,
    phases: GOOGLE_ADS_LIVE_OPERATOR_PHASES,
    confirmations: GOOGLE_ADS_LIVE_OPERATOR_CONFIRMATIONS,
    evidenceRoot: EVIDENCE_ROOT,
    safety: {
      defaultMode: 'plan_only',
      scheduleActivation: false,
      secretMutation: false,
      generatedSignedPayload: false,
      automaticManagerScriptExecution: false,
      productionCutover: false,
    },
    note: mode.phase === 'plan'
      ? 'Plan only. No Git, Wrangler, D1, Queue, Lark, Secret or Google Ads command was executed.'
      : `Preview only. Re-run with --phase=${mode.phase} --execute and the exact phase confirmation.`,
  }, null, 2));
}

async function runPhase(phase, target) {
  switch (phase) {
    case 'preflight': return runPreflight(target);
    case 'backup': return runBackup(target);
    case 'migrate': return runMigration(target);
    case 'deploy': return runDeploy(target);
    case 'connection-gate': return runConnectionGate(target);
    case 'live-ready': return runLiveReady(target);
    case 'verify': return runVerify(target);
    case 'rerun-verify': return runRerunVerify(target);
    default: throw new TypeError(`Unsupported executable phase: ${phase}`);
  }
}

async function runPreflight(target) {
  assertRepositoryState();
  const [apiConfig, syncConfig] = await Promise.all([
    readFile(target.apiWranglerConfig, 'utf8'),
    readFile(target.syncWranglerConfig, 'utf8'),
  ]);
  const safeConfig = validateGoogleAdsFlagsFalseConfig(apiConfig, syncConfig);
  const check = runCommand('npm', ['run', 'check']);
  const focused = runCommand('node', [
    '--test',
    'tests/application/google-ads-queue-reference.test.js',
    'tests/application/google-ads-live-authorization.test.js',
    'tests/application/google-ads-live-run.test.js',
    'tests/application/process-google-ads-manager-signed-delivery.test.js',
    'tests/application/redrive-dead-letter-job.test.js',
    'tests/google-ads/d1-google-ads-live-admission-store.test.js',
    'tests/google-ads/d1-google-ads-live-redrive-store.test.js',
    'tests/apps/google-ads-manager-live-delivery-http.test.js',
  ]);
  const dryRun = runCommand('npm', ['run', 'deploy:dry-run']);
  const whoami = runCommand('npx', ['wrangler', 'whoami']);
  const migrations = runCommand('npx', [
    'wrangler', 'd1', 'migrations', 'list', target.databaseName,
    '--remote', '--config', target.syncWranglerConfig,
  ]);
  const evidence = {
    phase: 'preflight',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    repositoryHead: readCommand('git', ['rev-parse', 'HEAD']).trim(),
    target: sanitizedTarget(target),
    safeConfig,
    checks: {
      repositoryCheck: check.status,
      focusedTests: focused.status,
      wranglerDryRun: dryRun.status,
    },
    wranglerIdentityChecked: whoami.status === 0,
    pendingMigrationsReviewed: migrations.status === 0,
  };
  await saveEvidence('preflight', evidence);
  return { evidenceFile: evidencePath('preflight'), safeConfig };
}

async function runBackup(target) {
  await requirePassedEvidence('preflight');
  const timestamp = new Date().toISOString().replaceAll(/[-:.]/gu, '');
  const backupFile = join(EVIDENCE_ROOT, `google-ads-before-0015-${timestamp}.sql`);
  runCommand('npx', [
    'wrangler', 'd1', 'export', target.databaseName,
    '--remote', '--config', target.syncWranglerConfig,
    '--output', backupFile, '--skip-confirmation',
  ]);
  await requireReadableFile(backupFile);
  const contents = await readFile(backupFile);
  if (contents.byteLength === 0) throw new Error('Google Ads pre-migration backup is empty');
  const sha256 = createHash('sha256').update(contents).digest('hex');
  await writeFile(`${backupFile}.sha256`, `${sha256}  ${backupFile}\n`, 'utf8');
  const evidence = {
    phase: 'backup',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    backupFile,
    sizeBytes: contents.byteLength,
    sha256,
  };
  await saveEvidence('backup', evidence);
  return { evidenceFile: evidencePath('backup'), backupFile, sha256 };
}

async function runMigration(target) {
  const backup = await requirePassedEvidence('backup');
  await assertBackupEvidence(backup);
  const before = runCommand('npx', [
    'wrangler', 'd1', 'migrations', 'list', target.databaseName,
    '--remote', '--config', target.syncWranglerConfig,
  ]);
  const apply = runCommand('npx', [
    'wrangler', 'd1', 'migrations', 'apply', target.databaseName,
    '--remote', '--config', target.syncWranglerConfig,
  ], { env: { CI: 'true' } });
  const after = runCommand('npx', [
    'wrangler', 'd1', 'migrations', 'list', target.databaseName,
    '--remote', '--config', target.syncWranglerConfig,
  ]);
  const evidence = {
    phase: 'migrate',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    backup: { backupFile: backup.backupFile, sha256: backup.sha256 },
    migrationListBeforeReviewed: before.status === 0,
    migrationApplyCompleted: apply.status === 0,
    migrationListAfterReviewed: after.status === 0,
  };
  await saveEvidence('migrate', evidence);
  return { evidenceFile: evidencePath('migrate') };
}

async function runDeploy(target) {
  await requirePassedEvidence('migrate');
  const [apiConfig, syncConfig] = await Promise.all([
    readFile(target.apiWranglerConfig, 'utf8'),
    readFile(target.syncWranglerConfig, 'utf8'),
  ]);
  const safeConfig = validateGoogleAdsFlagsFalseConfig(apiConfig, syncConfig);
  runCommand('npx', ['wrangler', 'deploy', '--dry-run', '--config', target.apiWranglerConfig]);
  runCommand('npx', ['wrangler', 'deploy', '--dry-run', '--config', target.syncWranglerConfig]);
  const apiDeploy = runCommand('npx', ['wrangler', 'deploy', '--config', target.apiWranglerConfig]);
  const syncDeploy = runCommand('npx', ['wrangler', 'deploy', '--config', target.syncWranglerConfig]);
  const evidence = {
    phase: 'deploy',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    safeConfig,
    apiDeployCompleted: apiDeploy.status === 0,
    syncDeployCompleted: syncDeploy.status === 0,
    executionFlagsEnabled: false,
    scheduleEnabled: false,
  };
  await saveEvidence('deploy', evidence);
  return { evidenceFile: evidencePath('deploy'), safeConfig };
}

async function runConnectionGate(target) {
  await requirePassedEvidence('deploy');
  const query = runD1Query(target, buildGoogleAdsConnectionGateSql(target));
  const row = firstD1Row(query.stdout);
  const gate = validateGoogleAdsConnectionGateRow(row);
  const evidence = {
    phase: 'connection-gate',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    gate,
    secretOrCiphertextRead: false,
  };
  await saveEvidence('connection-gate', evidence);
  return { evidenceFile: evidencePath('connection-gate'), gate };
}

async function runLiveReady(target) {
  const connection = await requirePassedEvidence('connection-gate');
  const evidence = {
    phase: 'live-ready',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    target: sanitizedTarget(target),
    connectionGate: connection.gate,
    executionPerformed: false,
    externalActionRequired: [
      'Obtain a separate explicit rollout approval.',
      'Enable only the approved manual Google Ads execution flags.',
      'Run the clean Manager Script in LIVE mode once.',
      'Disable the execution flags immediately after admission.',
      'Record the returned runId and execute the verify phase.',
    ],
    scheduleEnabled: false,
  };
  await saveEvidence('live-ready', evidence);
  return { evidenceFile: evidencePath('live-ready'), externalActionRequired: true };
}

async function runVerify(target) {
  await requirePassedEvidence('live-ready');
  const runId = requireGoogleAdsOperatorRunId(process.env);
  const query = runD1Query(target, buildGoogleAdsRunVerificationSql(runId));
  const verification = validateGoogleAdsRunVerificationRow(firstD1Row(query.stdout));
  const evidence = {
    phase: 'verify',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    runId,
    verification,
  };
  await saveEvidence('verify', evidence);
  return { evidenceFile: evidencePath('verify'), runId, verification };
}

async function runRerunVerify(target) {
  const before = await requirePassedEvidence('verify');
  const runId = requireGoogleAdsOperatorRunId(process.env);
  if (before.runId !== runId) throw new Error('Rerun verification must use the same Google Ads runId');
  const query = runD1Query(target, buildGoogleAdsRunVerificationSql(runId));
  const after = validateGoogleAdsRunVerificationRow(firstD1Row(query.stdout));
  const comparison = compareGoogleAdsRerunVerification(before.verification, after);
  const evidence = {
    phase: 'rerun-verify',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    runId,
    before: before.verification,
    after,
    ...comparison,
  };
  await saveEvidence('rerun-verify', evidence);
  return { evidenceFile: evidencePath('rerun-verify'), runId, ...comparison };
}

function assertRepositoryState() {
  const branch = readCommand('git', ['branch', '--show-current']).trim();
  if (branch !== 'main') throw new Error('Google Ads rollout operator must run from reviewed main');
  const dirty = readCommand('git', ['status', '--porcelain']).trim();
  if (dirty) throw new Error('Google Ads rollout operator requires a clean working tree');
}

function runD1Query(target, sql) {
  return runCommand('npx', [
    'wrangler', 'd1', 'execute', target.databaseName,
    '--remote', '--config', target.syncWranglerConfig,
    '--command', sql, '--json',
  ]);
}

function firstD1Row(stdout) {
  const parsed = JSON.parse(stdout);
  const containers = Array.isArray(parsed) ? parsed : [parsed];
  for (const container of containers) {
    const results = container?.results ?? container?.result?.[0]?.results;
    if (Array.isArray(results) && results.length > 0) return results[0];
  }
  throw new Error('Wrangler D1 query returned no rows');
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    const error = new Error(`${command} ${args.join(' ')} failed`);
    error.code = 'GOOGLE_ADS_OPERATOR_COMMAND_FAILED';
    error.details = {
      command,
      args,
      status: result.status,
      stderr: String(result.stderr ?? '').slice(0, 2_000),
    };
    throw error;
  }
  return result;
}

function readCommand(command, args) {
  return runCommand(command, args).stdout;
}

async function saveEvidence(phase, value) {
  await writeFile(evidencePath(phase), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function evidencePath(phase) {
  return join(EVIDENCE_ROOT, `${phase}.json`);
}

async function requirePassedEvidence(phase) {
  const path = evidencePath(phase);
  await requireReadableFile(path);
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  if (parsed?.phase !== phase || parsed?.status !== 'passed') {
    throw new Error(`Google Ads operator requires passed ${phase} evidence`);
  }
  return parsed;
}

async function assertBackupEvidence(evidence) {
  await requireReadableFile(evidence.backupFile);
  const contents = await readFile(evidence.backupFile);
  const sha256 = createHash('sha256').update(contents).digest('hex');
  if (sha256 !== evidence.sha256) throw new Error('Google Ads backup checksum mismatch');
}

async function requireReadableFile(path) {
  await access(path, constants.R_OK);
}

function sanitizedTarget(target) {
  return {
    environment: target.environment,
    customerProfile: target.customerProfile,
    customerKey: target.customerKey,
    managerCustomerId: maskId(target.managerCustomerId),
    advertiserCustomerId: maskId(target.advertiserCustomerId),
    sourceTimezone: target.sourceTimezone,
    apiWranglerConfig: target.apiWranglerConfig,
    syncWranglerConfig: target.syncWranglerConfig,
  };
}

function maskId(value) {
  return `${'*'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}
