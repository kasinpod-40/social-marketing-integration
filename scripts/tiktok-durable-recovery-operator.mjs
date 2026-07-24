import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  TIKTOK_DURABLE_RECOVERY_CONFIRMATIONS,
  TIKTOK_DURABLE_RECOVERY_INCIDENT,
  TIKTOK_DURABLE_RECOVERY_PHASES,
  assertTikTokDurableRecoveryConfirmation,
  assertTikTokDurableRecoveryOperatorEnv,
  buildCloudflareQueuePushUrl,
  buildTikTokDurableRecoveryEnvelope,
  buildTikTokRecoveryFinalSql,
  buildTikTokRecoveryPostMigrationSql,
  buildTikTokRecoveryPreflightSql,
  extractWranglerD1Rows,
  parseTikTokDurableRecoveryArgs,
  validateTikTokRecoveryFinalRow,
  validateTikTokRecoveryNoPendingMigrations,
  validateTikTokRecoveryPendingMigrations,
  validateTikTokRecoveryPostMigrationRow,
  validateTikTokRecoveryPreflightRow,
  validateTikTokRecoveryReplayRows,
  validateTikTokRecoveryWranglerConfig,
} from './lib/tiktok-durable-recovery-operator.js';

const IMPLEMENTATION_MERGE = '1fce94344100a6b1ed9dce471966f3596c00778a';
const EVIDENCE_ROOT = resolve(
  process.env.TIKTOK_RECOVERY_EVIDENCE_DIR
    ?? 'outputs/tiktok-durable-recovery/exact-2026-07-23',
);

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    name: error?.name ?? 'Error',
    code: error?.code ?? 'TIKTOK_RECOVERY_OPERATOR_FAILED',
    message: error?.message ?? String(error),
    details: error?.details ?? {},
  }, null, 2));
  process.exitCode = 1;
}

async function main() {
  const mode = parseTikTokDurableRecoveryArgs(process.argv.slice(2));
  if (mode.phase === 'plan' || mode.execute !== true) {
    printPlan(mode);
    return;
  }

  const target = assertTikTokDurableRecoveryOperatorEnv(mode.phase, process.env);
  assertTikTokDurableRecoveryConfirmation(mode.phase, process.env);
  await mkdir(EVIDENCE_ROOT, { recursive: true });

  const result = await runPhase(mode.phase, target);
  console.log(JSON.stringify({ ok: true, phase: mode.phase, evidenceRoot: EVIDENCE_ROOT, ...result }, null, 2));
}

function printPlan(mode) {
  const phase = mode.phase === 'plan' ? null : mode.phase;
  console.log(JSON.stringify({
    ok: true,
    executed: false,
    requestedPhase: phase,
    phases: TIKTOK_DURABLE_RECOVERY_PHASES,
    incident: TIKTOK_DURABLE_RECOVERY_INCIDENT,
    confirmations: TIKTOK_DURABLE_RECOVERY_CONFIRMATIONS,
    evidenceRoot: EVIDENCE_ROOT,
    note: phase
      ? `Preview only. Re-run with --phase=${phase} --execute and the exact phase confirmation when required.`
      : 'Plan only. No Wrangler, D1, deployment or Queue command was executed.',
  }, null, 2));
}

async function runPhase(phase, target) {
  switch (phase) {
    case 'preflight': return runPreflight(target);
    case 'backup': return runBackup(target);
    case 'migrate': return runMigration(target);
    case 'deploy': return runDeploy(target);
    case 'send': return runQueueSend(target, 'send');
    case 'verify': return runVerify(target, 'verify');
    case 'replay': return runQueueSend(target, 'replay');
    case 'replay-verify': return runReplayVerify(target);
    default: throw new TypeError(`Unsupported executable phase: ${phase}`);
  }
}

async function runPreflight(target) {
  assertRepositoryState();
  await requireReadableFile(target.wranglerConfig);

  const check = runCommand('npm', ['run', 'check']);
  const focused = runCommand('node', [
    '--test',
    'tests/application/tiktok-bootstrap-durable-recovery.test.js',
    'tests/reliability/d1-queue-operation-store.test.js',
    'tests/application/queue-operation.test.js',
    'tests/application/tiktok-history-bootstrap-routing.test.js',
    'tests/application/tiktok-durable-recovery-operator.test.js',
  ]);
  const dryRun = runCommand('npm', ['run', 'deploy:dry-run']);
  const whoami = runCommand('npx', ['wrangler', 'whoami']);
  const info = runCommand('npx', [
    'wrangler', 'd1', 'info', target.databaseName,
    '--config', target.wranglerConfig,
    '--json',
  ]);
  const migrations = runCommand('npx', [
    'wrangler', 'd1', 'migrations', 'list', target.databaseName,
    '--remote',
    '--config', target.wranglerConfig,
  ]);
  validateTikTokRecoveryPendingMigrations(migrations.stdout);
  const query = runD1Query(target, buildTikTokRecoveryPreflightSql());
  const row = validateTikTokRecoveryPreflightRow(extractWranglerD1Rows(query.stdout)[0]);

  const evidence = {
    phase: 'preflight',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    repositoryHead: readCommand('git', ['rev-parse', 'HEAD']).trim(),
    implementationMerge: IMPLEMENTATION_MERGE,
    target: { databaseName: target.databaseName, wranglerConfig: target.wranglerConfig },
    checks: {
      repositoryCheck: check.status,
      focusedRecoveryTests: focused.status,
      wranglerDryRun: dryRun.status,
    },
    wranglerIdentity: whoami.stdout,
    d1Info: parseJsonOrText(info.stdout),
    pendingMigrations: migrations.stdout,
    incident: row,
  };
  await saveEvidence('preflight', evidence);
  return { evidenceFile: evidencePath('preflight'), incident: row };
}

async function runBackup(target) {
  await requirePassedEvidence('preflight');
  const timestamp = new Date().toISOString().replaceAll(/[-:.]/gu, '');
  const backupFile = join(EVIDENCE_ROOT, `social-mkt-state-dev-before-0010-${timestamp}.sql`);
  runCommand('npx', [
    'wrangler', 'd1', 'export', target.databaseName,
    '--remote',
    '--config', target.wranglerConfig,
    '--output', backupFile,
    '--skip-confirmation',
  ]);
  await requireReadableFile(backupFile);
  const contents = await readFile(backupFile);
  if (contents.byteLength === 0) throw operatorError('Remote D1 backup is empty', 'TIKTOK_RECOVERY_BACKUP_EMPTY');
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
    '--remote',
    '--config', target.wranglerConfig,
  ]);
  validateTikTokRecoveryPendingMigrations(before.stdout);
  const apply = runCommand('npx', [
    'wrangler', 'd1', 'migrations', 'apply', target.databaseName,
    '--remote',
    '--config', target.wranglerConfig,
    '--skip-confirmation',
  ]);
  const after = runCommand('npx', [
    'wrangler', 'd1', 'migrations', 'list', target.databaseName,
    '--remote',
    '--config', target.wranglerConfig,
  ]);
  validateTikTokRecoveryNoPendingMigrations(after.stdout);
  const query = runD1Query(target, buildTikTokRecoveryPostMigrationSql());
  const row = validateTikTokRecoveryPostMigrationRow(extractWranglerD1Rows(query.stdout)[0]);
  const evidence = {
    phase: 'migrate',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    backup: { backupFile: backup.backupFile, sha256: backup.sha256 },
    pendingBefore: before.stdout,
    applyOutput: apply.stdout,
    pendingAfter: after.stdout,
    schemaAndCounts: row,
  };
  await saveEvidence('migrate', evidence);
  return { evidenceFile: evidencePath('migrate'), schemaAndCounts: row };
}

async function runDeploy(target) {
  await requirePassedEvidence('migrate');
  const configText = await readFile(target.wranglerConfig, 'utf8');
  const config = validateTikTokRecoveryWranglerConfig(configText);
  const dryRun = runCommand('npx', ['wrangler', 'deploy', '--dry-run', '--config', target.wranglerConfig]);
  const deploy = runCommand('npx', ['wrangler', 'deploy', '--config', target.wranglerConfig]);
  const evidence = {
    phase: 'deploy',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    config,
    dryRunOutput: dryRun.stdout,
    deployOutput: deploy.stdout,
  };
  await saveEvidence('deploy', evidence);
  return { evidenceFile: evidencePath('deploy'), config };
}

async function runQueueSend(target, phase) {
  if (phase === 'send') await requirePassedEvidence('deploy');
  else await requirePassedEvidence('verify');
  const envelope = buildTikTokDurableRecoveryEnvelope();
  const url = buildCloudflareQueuePushUrl({ accountId: target.accountId, queueId: target.queueId });
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(envelope),
  });
  const responseText = await response.text();
  const responseBody = parseJsonOrText(responseText);
  if (!response.ok || responseBody?.success !== true) {
    throw operatorError('Cloudflare Queue HTTP push failed', 'TIKTOK_RECOVERY_QUEUE_PUSH_FAILED', {
      phase,
      status: response.status,
      response: responseBody,
    });
  }
  const evidence = {
    phase,
    status: 'passed',
    capturedAt: new Date().toISOString(),
    endpoint: url,
    payload: envelope,
    responseStatus: response.status,
    response: responseBody,
  };
  await saveEvidence(phase, evidence);
  return { evidenceFile: evidencePath(phase), responseStatus: response.status, response: responseBody };
}

async function runVerify(target, phase) {
  await requirePassedEvidence('send');
  const query = runD1Query(target, buildTikTokRecoveryFinalSql());
  const row = validateTikTokRecoveryFinalRow(extractWranglerD1Rows(query.stdout)[0]);
  const evidence = {
    phase,
    status: 'passed',
    capturedAt: new Date().toISOString(),
    final: row,
  };
  await saveEvidence(phase, evidence);
  return { evidenceFile: evidencePath(phase), final: row };
}

async function runReplayVerify(target) {
  const before = await requirePassedEvidence('verify');
  await requirePassedEvidence('replay');
  const query = runD1Query(target, buildTikTokRecoveryFinalSql());
  const afterRow = validateTikTokRecoveryFinalRow(extractWranglerD1Rows(query.stdout)[0]);
  validateTikTokRecoveryReplayRows(before.final, afterRow);
  const evidence = {
    phase: 'replay-verify',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    before: before.final,
    after: afterRow,
    businessFactDrift: false,
  };
  await saveEvidence('replay-verify', evidence);
  return { evidenceFile: evidencePath('replay-verify'), businessFactDrift: false, final: afterRow };
}

function assertRepositoryState() {
  const branch = readCommand('git', ['branch', '--show-current']).trim();
  if (branch !== 'main') {
    throw operatorError('TikTok recovery operator must run from main', 'TIKTOK_RECOVERY_REPOSITORY_STATE_INVALID', { branch });
  }
  runCommand('git', ['merge-base', '--is-ancestor', IMPLEMENTATION_MERGE, 'HEAD']);
  const dirty = readCommand('git', ['status', '--porcelain']).trim();
  if (dirty) {
    throw operatorError('TikTok recovery operator requires a clean Git working tree', 'TIKTOK_RECOVERY_REPOSITORY_STATE_INVALID', {
      dirtyPaths: dirty.split(/\r?\n/u),
    });
  }
}

function runD1Query(target, sql) {
  return runCommand('npx', [
    'wrangler', 'd1', 'execute', target.databaseName,
    '--remote',
    '--config', target.wranglerConfig,
    '--command', sql,
    '--json',
  ]);
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw operatorError(`Command failed: ${command} ${args.join(' ')}`, 'TIKTOK_RECOVERY_COMMAND_FAILED', {
      command,
      args,
      status: result.status,
      stdout: result.stdout?.trim() ?? '',
      stderr: result.stderr?.trim() ?? '',
    });
  }
  return Object.freeze({
    status: result.status,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
  });
}

function readCommand(command, args) {
  return runCommand(command, args).stdout;
}

async function saveEvidence(name, value) {
  await writeFile(evidencePath(name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function requirePassedEvidence(name) {
  let value;
  try {
    value = JSON.parse(await readFile(evidencePath(name), 'utf8'));
  } catch (cause) {
    throw operatorError(`Required TikTok recovery evidence is missing or invalid: ${name}`, 'TIKTOK_RECOVERY_EVIDENCE_MISSING', {
      evidenceFile: evidencePath(name),
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
  if (value?.status !== 'passed' || value?.phase !== name) {
    throw operatorError(`Required TikTok recovery evidence did not pass: ${name}`, 'TIKTOK_RECOVERY_EVIDENCE_INVALID', {
      evidenceFile: evidencePath(name),
    });
  }
  return Object.freeze(value);
}

async function assertBackupEvidence(backup) {
  await requireReadableFile(backup.backupFile);
  const contents = await readFile(backup.backupFile);
  const actual = createHash('sha256').update(contents).digest('hex');
  if (actual !== backup.sha256) {
    throw operatorError('TikTok recovery backup checksum no longer matches', 'TIKTOK_RECOVERY_BACKUP_CHECKSUM_MISMATCH', {
      expected: backup.sha256,
      actual,
    });
  }
}

async function requireReadableFile(path) {
  try {
    await access(path, constants.R_OK);
  } catch (cause) {
    throw operatorError(`Required file is not readable: ${path}`, 'TIKTOK_RECOVERY_FILE_UNAVAILABLE', {
      path,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function evidencePath(name) {
  return join(EVIDENCE_ROOT, `${name}.json`);
}

function parseJsonOrText(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'TikTokDurableRecoveryOperatorError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
