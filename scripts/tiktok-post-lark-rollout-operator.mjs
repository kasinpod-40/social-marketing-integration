import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  TIKTOK_POST_LARK_ROLLOUT_CONFIRMATIONS,
  TIKTOK_POST_LARK_ROLLOUT_PHASES,
  assertTikTokPostLarkRolloutConfirmation,
  buildTikTokPostLarkPostMigrationSql,
  buildTikTokPostLarkPreflightSql,
  extractWranglerD1Rows,
  loadTikTokPostLarkRolloutTarget,
  parseTikTokPostLarkRolloutArgs,
  validateTikTokPostLarkAuditResponse,
  validateTikTokPostLarkNoPendingMigrations,
  validateTikTokPostLarkPendingMigrations,
  validateTikTokPostLarkPostMigrationRow,
  validateTikTokPostLarkPreflightRow,
  validateTikTokPostLarkRouteStatus,
  validateTikTokPostLarkWranglerConfig,
} from './lib/tiktok-post-lark-rollout-operator.js';

const REQUIRED_BASELINE = 'ad6614dd8ee0cb2a1dda5cdbe7035f44b40581d4';
const EVIDENCE_ROOT = resolve(
  process.env.MKT_TIKTOK_ROLLOUT_EVIDENCE_DIR
    ?? 'outputs/tiktok-post-lark-rollout',
);

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    name: error?.name ?? 'Error',
    code: error?.code ?? 'TIKTOK_POST_LARK_ROLLOUT_FAILED',
    message: error?.message ?? String(error),
    details: error?.details ?? {},
  }, null, 2));
  process.exitCode = 1;
}

async function main() {
  const mode = parseTikTokPostLarkRolloutArgs(process.argv.slice(2));
  if (mode.phase === 'plan' || mode.execute !== true) {
    printPlan(mode);
    return;
  }

  const target = loadTikTokPostLarkRolloutTarget(process.env, mode.phase);
  assertTikTokPostLarkRolloutConfirmation(mode.phase, process.env);
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
  const phase = mode.phase === 'plan' ? null : mode.phase;
  console.log(JSON.stringify({
    ok: true,
    executed: false,
    requestedPhase: phase,
    phases: TIKTOK_POST_LARK_ROLLOUT_PHASES,
    confirmations: TIKTOK_POST_LARK_ROLLOUT_CONFIRMATIONS,
    requiredBaseline: REQUIRED_BASELINE,
    evidenceRoot: EVIDENCE_ROOT,
    safety: {
      defaultMode: 'plan_only',
      queueSend: false,
      dlqRedrive: false,
      larkMutation: false,
      scheduleActivation: false,
      retentionDelete: false,
      productionCutover: false,
    },
    note: phase
      ? `Preview only. Re-run with --phase=${phase} --execute and the exact phase confirmation.`
      : 'Plan only. No Git, Wrangler, D1, Worker, Queue or Lark command was executed.',
  }, null, 2));
}

async function runPhase(phase, target) {
  switch (phase) {
    case 'preflight': return runPreflight(target);
    case 'backup': return runBackup(target);
    case 'migrate': return runMigration(target);
    case 'deploy-safe': return runDeploySafe(target);
    case 'enable-audit': return runEnableAudit(target);
    case 'audit': return runAudit(target);
    case 'disable-audit': return runDisableAudit(target);
    default: throw operatorError(`Unsupported executable phase: ${phase}`, 'TIKTOK_POST_LARK_ROLLOUT_PHASE_INVALID');
  }
}

async function runPreflight(target) {
  assertRepositoryState();
  await Promise.all([
    requireReadableFile(target.safeWranglerConfig),
    requireReadableFile(target.auditWranglerConfig),
  ]);
  const [safeText, auditText] = await Promise.all([
    readFile(target.safeWranglerConfig, 'utf8'),
    readFile(target.auditWranglerConfig, 'utf8'),
  ]);
  const safeConfig = validateTikTokPostLarkWranglerConfig(safeText, { auditEnabled: false });
  const auditConfig = validateTikTokPostLarkWranglerConfig(auditText, { auditEnabled: true });

  runCommand('npm', ['run', 'check']);
  runCommand('node', [
    '--test',
    'tests/application/tiktok-post-lark-rollout-operator.test.js',
    'tests/application/tiktok-post-lark-audit-http.test.js',
    'tests/application/tiktok-post-lark-schedule-gates.test.js',
  ]);
  runCommand('npm', ['run', 'deploy:dry-run']);
  runCommand('npx', ['wrangler', 'whoami']);
  runCommand('npx', [
    'wrangler', 'd1', 'info', target.databaseName,
    '--config', target.safeWranglerConfig,
    '--json',
  ]);
  const migrations = runCommand('npx', [
    'wrangler', 'd1', 'migrations', 'list', target.databaseName,
    '--remote',
    '--config', target.safeWranglerConfig,
  ]);
  const pendingMigrations = validateTikTokPostLarkPendingMigrations(migrations.stdout);
  const query = runD1Query(target, target.safeWranglerConfig, buildTikTokPostLarkPreflightSql());
  const remote = validateTikTokPostLarkPreflightRow(extractWranglerD1Rows(query.stdout)[0]);

  const evidence = {
    phase: 'preflight',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    repositoryHead: readCommand('git', ['rev-parse', 'HEAD']).trim(),
    requiredBaseline: REQUIRED_BASELINE,
    target: sanitizedTarget(target),
    safeConfig,
    auditConfig,
    pendingMigrations,
    remote,
    mutationPerformed: false,
  };
  await saveEvidence('preflight', evidence);
  return { evidenceFile: evidencePath('preflight'), pendingMigrations, remote };
}

async function runBackup(target) {
  await requirePassedEvidence('preflight');
  const timestamp = new Date().toISOString().replaceAll(/[-:.]/gu, '');
  const backupFile = join(EVIDENCE_ROOT, `social-mkt-state-dev-before-0016-${timestamp}.sql`);
  runCommand('npx', [
    'wrangler', 'd1', 'export', target.databaseName,
    '--remote',
    '--config', target.safeWranglerConfig,
    '--output', backupFile,
    '--skip-confirmation',
  ]);
  await requireReadableFile(backupFile);
  const contents = await readFile(backupFile);
  if (contents.byteLength === 0) {
    throw operatorError('TikTok post-Lark Remote D1 backup is empty', 'TIKTOK_POST_LARK_ROLLOUT_BACKUP_EMPTY');
  }
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
  const preflight = await requirePassedEvidence('preflight');
  const backup = await requirePassedEvidence('backup');
  await assertBackupEvidence(backup);

  const before = runCommand('npx', [
    'wrangler', 'd1', 'migrations', 'list', target.databaseName,
    '--remote',
    '--config', target.safeWranglerConfig,
  ]);
  validateTikTokPostLarkPendingMigrations(before.stdout);
  runCommand('npx', [
    'wrangler', 'd1', 'migrations', 'apply', target.databaseName,
    '--remote',
    '--config', target.safeWranglerConfig,
  ], { env: { CI: 'true' } });
  const after = runCommand('npx', [
    'wrangler', 'd1', 'migrations', 'list', target.databaseName,
    '--remote',
    '--config', target.safeWranglerConfig,
  ]);
  validateTikTokPostLarkNoPendingMigrations(after.stdout);
  const query = runD1Query(target, target.safeWranglerConfig, buildTikTokPostLarkPostMigrationSql());
  const remote = validateTikTokPostLarkPostMigrationRow(
    extractWranglerD1Rows(query.stdout)[0],
    preflight.remote,
  );

  const evidence = {
    phase: 'migrate',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    backup: { backupFile: backup.backupFile, sha256: backup.sha256 },
    remote,
    businessFactDrift: false,
  };
  await saveEvidence('migrate', evidence);
  return { evidenceFile: evidencePath('migrate'), remote, businessFactDrift: false };
}

async function runDeploySafe(target) {
  await requirePassedEvidence('migrate');
  const configText = await readFile(target.safeWranglerConfig, 'utf8');
  const config = validateTikTokPostLarkWranglerConfig(configText, { auditEnabled: false });
  runCommand('npx', ['wrangler', 'deploy', '--dry-run', '--config', target.safeWranglerConfig]);
  runCommand('npx', ['wrangler', 'deploy', '--config', target.safeWranglerConfig]);
  const status = await getRouteStatus(target.workerOrigin);
  validateTikTokPostLarkRouteStatus(status, 404);
  const evidence = {
    phase: 'deploy-safe',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    config,
    unauthenticatedAuditRouteStatus: status,
    executionFlagsEnabled: false,
    schedulesEnabled: false,
  };
  await saveEvidence('deploy-safe', evidence);
  return { evidenceFile: evidencePath('deploy-safe'), routeStatus: status };
}

async function runEnableAudit(target) {
  await requirePassedEvidence('deploy-safe');
  const configText = await readFile(target.auditWranglerConfig, 'utf8');
  const config = validateTikTokPostLarkWranglerConfig(configText, { auditEnabled: true });
  runCommand('npx', ['wrangler', 'deploy', '--dry-run', '--config', target.auditWranglerConfig]);
  runCommand('npx', ['wrangler', 'deploy', '--config', target.auditWranglerConfig]);
  const status = await getRouteStatus(target.workerOrigin);
  validateTikTokPostLarkRouteStatus(status, 401);
  const evidence = {
    phase: 'enable-audit',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    config,
    unauthenticatedAuditRouteStatus: status,
    businessFlagsEnabled: false,
    schedulesEnabled: false,
  };
  await saveEvidence('enable-audit', evidence);
  return { evidenceFile: evidencePath('enable-audit'), routeStatus: status };
}

async function runAudit(target) {
  await requirePassedEvidence('enable-audit');
  const response = await fetch(`${target.workerOrigin}/operator/tiktok/post-lark-audit`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${target.operatorToken}`,
      Accept: 'application/json',
    },
  });
  const body = await readJsonResponse(response);
  validateTikTokPostLarkRouteStatus(response.status, 200);
  const audit = validateTikTokPostLarkAuditResponse(body, {
    customerKey: target.customerKey,
    accountKey: target.customerKey,
    sourceHandle: target.sourceHandle,
  });
  const evidence = {
    phase: 'audit',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    audit,
    raw: body.audit.raw,
    d1: body.audit.d1,
    canonical: body.audit.canonical,
    gaps: body.audit.gaps,
    issues: body.audit.issues,
    queueOrWritePerformed: false,
  };
  await saveEvidence('audit', evidence);
  return {
    evidenceFile: evidencePath('audit'),
    readyForManualProcessing: audit.readyForManualProcessing,
    issueCount: audit.issueCount,
    rawRecordCount: audit.rawRecordCount,
    sourceWatermark: audit.sourceWatermark,
  };
}

async function runDisableAudit(target) {
  await requirePassedEvidence('audit');
  const configText = await readFile(target.safeWranglerConfig, 'utf8');
  const config = validateTikTokPostLarkWranglerConfig(configText, { auditEnabled: false });
  runCommand('npx', ['wrangler', 'deploy', '--dry-run', '--config', target.safeWranglerConfig]);
  runCommand('npx', ['wrangler', 'deploy', '--config', target.safeWranglerConfig]);
  const status = await getRouteStatus(target.workerOrigin);
  validateTikTokPostLarkRouteStatus(status, 404);
  const evidence = {
    phase: 'disable-audit',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    config,
    unauthenticatedAuditRouteStatus: status,
    safeClosed: true,
  };
  await saveEvidence('disable-audit', evidence);
  return { evidenceFile: evidencePath('disable-audit'), routeStatus: status, safeClosed: true };
}

function assertRepositoryState() {
  const branch = readCommand('git', ['branch', '--show-current']).trim();
  if (branch !== 'main') {
    throw operatorError(
      'TikTok post-Lark rollout operator must run from main',
      'TIKTOK_POST_LARK_ROLLOUT_REPOSITORY_STATE_INVALID',
      { branch },
    );
  }
  runCommand('git', ['merge-base', '--is-ancestor', REQUIRED_BASELINE, 'HEAD']);
  const dirty = readCommand('git', ['status', '--porcelain']).trim();
  if (dirty) {
    throw operatorError(
      'TikTok post-Lark rollout operator requires a clean Git working tree',
      'TIKTOK_POST_LARK_ROLLOUT_REPOSITORY_STATE_INVALID',
      { dirtyPaths: dirty.split(/\r?\n/u) },
    );
  }
}

function runD1Query(target, config, sql) {
  return runCommand('npx', [
    'wrangler', 'd1', 'execute', target.databaseName,
    '--remote',
    '--config', config,
    '--command', sql,
    '--json',
  ]);
}

async function getRouteStatus(origin) {
  const response = await fetch(`${origin}/operator/tiktok/post-lark-audit`, {
    method: 'GET',
    redirect: 'manual',
  });
  await response.arrayBuffer();
  return response.status;
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw operatorError(
      'TikTok post-Lark audit response was not valid JSON',
      'TIKTOK_POST_LARK_ROLLOUT_AUDIT_RESPONSE_INVALID',
      {
        status: response.status,
        cause: cause instanceof Error ? cause.message : String(cause),
      },
    );
  }
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw operatorError(
      `Command failed: ${command} ${args.join(' ')}`,
      'TIKTOK_POST_LARK_ROLLOUT_COMMAND_FAILED',
      {
        command,
        args,
        status: result.status,
        stdout: result.stdout?.trim() ?? '',
        stderr: result.stderr?.trim() ?? '',
      },
    );
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
    throw operatorError(
      `Required TikTok post-Lark rollout evidence is missing or invalid: ${name}`,
      'TIKTOK_POST_LARK_ROLLOUT_EVIDENCE_MISSING',
      {
        evidenceFile: evidencePath(name),
        cause: cause instanceof Error ? cause.message : String(cause),
      },
    );
  }
  if (value?.status !== 'passed' || value?.phase !== name) {
    throw operatorError(
      `Required TikTok post-Lark rollout evidence did not pass: ${name}`,
      'TIKTOK_POST_LARK_ROLLOUT_EVIDENCE_INVALID',
      { evidenceFile: evidencePath(name) },
    );
  }
  return Object.freeze(value);
}

async function assertBackupEvidence(backup) {
  await requireReadableFile(backup.backupFile);
  const contents = await readFile(backup.backupFile);
  const actual = createHash('sha256').update(contents).digest('hex');
  if (actual !== backup.sha256) {
    throw operatorError(
      'TikTok post-Lark rollout backup checksum no longer matches',
      'TIKTOK_POST_LARK_ROLLOUT_BACKUP_CHECKSUM_MISMATCH',
      { expected: backup.sha256, actual },
    );
  }
}

async function requireReadableFile(path) {
  try {
    await access(path, constants.R_OK);
  } catch (cause) {
    throw operatorError(
      `Required file is not readable: ${path}`,
      'TIKTOK_POST_LARK_ROLLOUT_FILE_UNAVAILABLE',
      { path, cause: cause instanceof Error ? cause.message : String(cause) },
    );
  }
}

function evidencePath(name) {
  return join(EVIDENCE_ROOT, `${name}.json`);
}

function sanitizedTarget(target) {
  return Object.freeze({
    environment: target.environment,
    customerProfile: target.customerProfile,
    customerKey: target.customerKey,
    sourceHandle: target.sourceHandle,
    databaseName: target.databaseName,
    safeWranglerConfig: target.safeWranglerConfig,
    auditWranglerConfig: target.auditWranglerConfig,
    workerOrigin: target.workerOrigin,
  });
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'TikTokPostLarkRolloutOperatorError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
