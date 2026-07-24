import { spawnSync } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  buildCloudflareQueuePushUrl,
  buildTikTokDurableRecoveryEnvelope,
  extractWranglerD1Rows,
  validateTikTokRecoveryWranglerConfig,
} from './lib/tiktok-durable-recovery-operator.js';
import { buildWranglerOAuthEnvironment } from './lib/cloudflare-auth-environment.js';
import {
  TIKTOK_RECOVERY_COMPLETION_CLOSURE_CONFIRMATIONS,
  TIKTOK_RECOVERY_COMPLETION_CLOSURE_PHASES,
  assertTikTokRecoveryCompletionClosureConfirmation,
  assertTikTokRecoveryCompletionClosureEnv,
  buildTikTokRecoveryCompletionClosureEvidenceSql,
  buildTikTokRecoveryCompletionClosureRepairSql,
  parseTikTokRecoveryCompletionClosureArgs,
  validateTikTokRecoveryCompletionClosureRepairRows,
  validateTikTokRecoveryCompletionClosureReplay,
  validateTikTokRecoveryCompletionClosureRow,
} from './lib/tiktok-recovery-completion-closure.js';

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
    code: error?.code ?? 'TIKTOK_RECOVERY_COMPLETION_CLOSURE_OPERATOR_FAILED',
    message: error?.message ?? String(error),
    details: error?.details ?? {},
  }, null, 2));
  process.exitCode = 1;
}

async function main() {
  const mode = parseTikTokRecoveryCompletionClosureArgs(process.argv.slice(2));
  if (mode.phase === 'plan' || mode.execute !== true) {
    console.log(JSON.stringify({
      ok: true,
      executed: false,
      requestedPhase: mode.phase === 'plan' ? null : mode.phase,
      phases: TIKTOK_RECOVERY_COMPLETION_CLOSURE_PHASES,
      confirmations: TIKTOK_RECOVERY_COMPLETION_CLOSURE_CONFIRMATIONS,
      evidenceRoot: EVIDENCE_ROOT,
      note: 'Plan only. No deployment, Remote D1 write or Queue message was executed.',
    }, null, 2));
    return;
  }

  const target = assertTikTokRecoveryCompletionClosureEnv(mode.phase, process.env);
  assertTikTokRecoveryCompletionClosureConfirmation(mode.phase, process.env);
  await mkdir(EVIDENCE_ROOT, { recursive: true });
  assertRepositoryState();

  const result = await runPhase(mode.phase, target);
  console.log(JSON.stringify({
    ok: true,
    phase: mode.phase,
    evidenceRoot: EVIDENCE_ROOT,
    ...result,
  }, null, 2));
}

async function runPhase(phase, target) {
  switch (phase) {
    case 'deploy': return runDeploy(target);
    case 'repair': return runRepair(target);
    case 'verify': return runVerify(target);
    case 'replay': return runReplay(target);
    case 'replay-verify': return runReplayVerify(target);
    default: throw new TypeError(`Unsupported executable TikTok completion-closure phase: ${phase}`);
  }
}

async function runDeploy(target) {
  await assertNoPassedEvidence('completion-closure-deploy');
  await requirePassedEvidence('terminal-resume');
  await requireReadableFile(target.wranglerConfig);
  const configText = await readFile(target.wranglerConfig, 'utf8');
  const config = validateTikTokRecoveryWranglerConfig(configText);
  const repositoryCheck = runCommand('npm', ['run', 'check']);
  const focusedTests = runCommand('node', [
    '--test',
    'tests/reliability/d1-queue-operation-store.test.js',
    'tests/application/tiktok-recovery-completion-closure.test.js',
    'tests/application/queue-completed-work-terminal-guard.test.js',
  ]);
  const projectDryRun = runCommand('npm', ['run', 'deploy:dry-run']);
  const wranglerDryRun = runCommand('npx', [
    'wrangler', 'deploy', '--dry-run', '--config', target.wranglerConfig,
  ]);
  const deploy = runCommand('npx', [
    'wrangler', 'deploy', '--config', target.wranglerConfig,
  ]);
  const repositoryHead = readCommand('git', ['rev-parse', 'HEAD']).trim();
  const evidence = {
    phase: 'completion-closure-deploy',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    repositoryHead,
    config,
    checks: {
      repositoryCheck: repositoryCheck.status,
      focusedTests: focusedTests.status,
      projectDryRun: projectDryRun.status,
      wranglerDryRun: wranglerDryRun.status,
    },
    deployOutput: deploy.stdout,
    remoteD1Write: false,
    queueMessageSent: false,
  };
  await saveEvidence('completion-closure-deploy', evidence);
  return {
    evidenceFile: evidencePath('completion-closure-deploy'),
    repositoryHead,
    config,
    queueMessageSent: false,
  };
}

async function runRepair(target) {
  await assertNoPassedEvidence('completion-closure-repair');
  await requirePassedEvidence('completion-closure-deploy');
  const beforeQuery = runD1Command(target, buildTikTokRecoveryCompletionClosureEvidenceSql());
  const before = validateTikTokRecoveryCompletionClosureRow(
    extractWranglerD1Rows(beforeQuery.stdout)[0],
    'before_repair',
  );
  const repairedAt = Date.now();
  const repairCommand = runD1Command(
    target,
    buildTikTokRecoveryCompletionClosureRepairSql(repairedAt),
  );
  const repair = validateTikTokRecoveryCompletionClosureRepairRows(
    extractWranglerD1Rows(repairCommand.stdout),
  );
  const afterQuery = runD1Command(target, buildTikTokRecoveryCompletionClosureEvidenceSql());
  const after = validateTikTokRecoveryCompletionClosureRow(
    extractWranglerD1Rows(afterQuery.stdout)[0],
    'final',
  );
  const evidence = {
    phase: 'completion-closure-repair',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    repairedAt,
    before,
    repair,
    after,
    businessFactsChanged: false,
    queueMessageSent: false,
  };
  await saveEvidence('completion-closure-repair', evidence);
  return {
    evidenceFile: evidencePath('completion-closure-repair'),
    repair,
    final: after,
    businessFactsChanged: false,
    queueMessageSent: false,
  };
}

async function runVerify(target) {
  await requirePassedEvidence('completion-closure-repair');
  const query = runD1Command(target, buildTikTokRecoveryCompletionClosureEvidenceSql());
  const final = validateTikTokRecoveryCompletionClosureRow(
    extractWranglerD1Rows(query.stdout)[0],
    'final',
  );
  const evidence = {
    phase: 'completion-closure-verify',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    final,
  };
  await saveEvidence('completion-closure-verify', evidence);
  return { evidenceFile: evidencePath('completion-closure-verify'), final };
}

async function runReplay(target) {
  await assertNoPassedEvidence('completion-closure-replay');
  const before = await requirePassedEvidence('completion-closure-verify');
  validateTikTokRecoveryCompletionClosureRow(before.final, 'final');
  const payload = buildTikTokDurableRecoveryEnvelope();
  const endpoint = buildCloudflareQueuePushUrl({
    accountId: target.accountId,
    queueId: target.queueId,
  });
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const responseText = await response.text();
  const responseBody = parseJsonOrText(responseText);
  if (!response.ok || responseBody?.success !== true) {
    throw operatorError(
      'Cloudflare Queue completion-closure replay push failed',
      'TIKTOK_RECOVERY_COMPLETION_CLOSURE_QUEUE_PUSH_FAILED',
      { status: response.status, response: responseBody },
    );
  }
  const evidence = {
    phase: 'completion-closure-replay',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    before: before.final,
    endpoint,
    payload,
    responseStatus: response.status,
    response: responseBody,
    queueMessageSent: true,
  };
  await saveEvidence('completion-closure-replay', evidence);
  return {
    evidenceFile: evidencePath('completion-closure-replay'),
    responseStatus: response.status,
    response: responseBody,
    queueMessageSent: true,
  };
}

async function runReplayVerify(target) {
  const before = await requirePassedEvidence('completion-closure-verify');
  await requirePassedEvidence('completion-closure-replay');
  const query = runD1Command(target, buildTikTokRecoveryCompletionClosureEvidenceSql());
  const after = validateTikTokRecoveryCompletionClosureRow(
    extractWranglerD1Rows(query.stdout)[0],
    'final',
  );
  validateTikTokRecoveryCompletionClosureReplay(before.final, after);
  const evidence = {
    phase: 'completion-closure-replay-verify',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    before: before.final,
    after,
    businessFactDrift: false,
  };
  await saveEvidence('completion-closure-replay-verify', evidence);
  return {
    evidenceFile: evidencePath('completion-closure-replay-verify'),
    final: after,
    businessFactDrift: false,
  };
}

function assertRepositoryState() {
  const branch = readCommand('git', ['branch', '--show-current']).trim();
  if (branch !== 'main') {
    throw operatorError(
      'TikTok completion-closure operator must run from main',
      'TIKTOK_RECOVERY_COMPLETION_CLOSURE_REPOSITORY_STATE_INVALID',
      { branch },
    );
  }
  const dirty = readCommand('git', ['status', '--porcelain']).trim();
  if (dirty) {
    throw operatorError(
      'TikTok completion-closure operator requires a clean Git working tree',
      'TIKTOK_RECOVERY_COMPLETION_CLOSURE_REPOSITORY_STATE_INVALID',
      { dirtyPaths: dirty.split(/\r?\n/u) },
    );
  }
}

function runD1Command(target, sql) {
  return runCommand('npx', [
    'wrangler', 'd1', 'execute', target.databaseName,
    '--remote',
    '--config', target.wranglerConfig,
    '--command', sql,
    '--json',
  ], {
    env: buildWranglerOAuthEnvironment(process.env),
  });
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw operatorError(
      `Command failed: ${command} ${args.join(' ')}`,
      'TIKTOK_RECOVERY_COMPLETION_CLOSURE_COMMAND_FAILED',
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
      `Required TikTok completion-closure evidence is missing or invalid: ${name}`,
      'TIKTOK_RECOVERY_COMPLETION_CLOSURE_EVIDENCE_MISSING',
      {
        evidenceFile: evidencePath(name),
        cause: cause instanceof Error ? cause.message : String(cause),
      },
    );
  }
  if (value?.status !== 'passed' || value?.phase !== name) {
    throw operatorError(
      `Required TikTok completion-closure evidence did not pass: ${name}`,
      'TIKTOK_RECOVERY_COMPLETION_CLOSURE_EVIDENCE_INVALID',
      { evidenceFile: evidencePath(name) },
    );
  }
  return Object.freeze(value);
}

async function assertNoPassedEvidence(name) {
  try {
    await access(evidencePath(name), constants.F_OK);
  } catch {
    return true;
  }
  const existing = await requirePassedEvidence(name);
  throw operatorError(
    `TikTok completion-closure phase ${name} already passed and cannot be repeated`,
    'TIKTOK_RECOVERY_COMPLETION_CLOSURE_ALREADY_EXECUTED',
    { evidenceFile: evidencePath(name), capturedAt: existing.capturedAt ?? null },
  );
}

async function requireReadableFile(path) {
  try {
    await access(path, constants.R_OK);
  } catch (cause) {
    throw operatorError(
      `Required file is not readable: ${path}`,
      'TIKTOK_RECOVERY_COMPLETION_CLOSURE_FILE_UNAVAILABLE',
      { path, cause: cause instanceof Error ? cause.message : String(cause) },
    );
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
  error.name = 'TikTokRecoveryCompletionClosureOperatorError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
