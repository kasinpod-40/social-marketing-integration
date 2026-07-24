import { spawnSync } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  buildCloudflareQueuePushUrl,
  buildTikTokDurableRecoveryEnvelope,
  extractWranglerD1Rows,
} from './lib/tiktok-durable-recovery-operator.js';
import { buildWranglerOAuthEnvironment } from './lib/cloudflare-auth-environment.js';
import {
  TIKTOK_TERMINAL_WORK_CONFIRMATIONS,
  TIKTOK_TERMINAL_WORK_PHASES,
  assertTikTokTerminalWorkConfirmation,
  assertTikTokTerminalWorkEnv,
  buildTikTokTerminalWorkEvidenceSql,
  buildTikTokTerminalWorkReactivationSql,
  parseTikTokTerminalWorkArgs,
  validateTikTokTerminalWorkReactivationResult,
  validateTikTokTerminalWorkRow,
} from './lib/tiktok-terminal-work-recovery.js';

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
    code: error?.code ?? 'TIKTOK_TERMINAL_WORK_OPERATOR_FAILED',
    message: error?.message ?? String(error),
    details: error?.details ?? {},
  }, null, 2));
  process.exitCode = 1;
}

async function main() {
  const mode = parseTikTokTerminalWorkArgs(process.argv.slice(2));
  if (mode.phase === 'plan' || mode.execute !== true) {
    console.log(JSON.stringify({
      ok: true,
      executed: false,
      requestedPhase: mode.phase === 'plan' ? null : mode.phase,
      phases: TIKTOK_TERMINAL_WORK_PHASES,
      confirmations: TIKTOK_TERMINAL_WORK_CONFIRMATIONS,
      evidenceRoot: EVIDENCE_ROOT,
      note: 'Plan only. No Remote D1 write or Queue message was executed.',
    }, null, 2));
    return;
  }

  const target = assertTikTokTerminalWorkEnv(mode.phase, process.env);
  assertTikTokTerminalWorkConfirmation(mode.phase, process.env);
  await mkdir(EVIDENCE_ROOT, { recursive: true });
  assertRepositoryState();
  await requirePassedEvidence('hotfix-deploy');

  const result = mode.phase === 'reactivate'
    ? await runGuardedReactivation(target)
    : await runGuardedResume(target);

  console.log(JSON.stringify({
    ok: true,
    phase: mode.phase,
    evidenceRoot: EVIDENCE_ROOT,
    ...result,
  }, null, 2));
}

async function runGuardedReactivation(target) {
  await assertNoPassedEvidence('terminal-reactivate');
  const capturedAt = Date.now();
  const beforeQuery = runD1Command(target, buildTikTokTerminalWorkEvidenceSql());
  const before = validateTikTokTerminalWorkRow(
    extractWranglerD1Rows(beforeQuery.stdout)[0],
    'terminal',
    capturedAt,
  );

  const update = runD1Command(target, buildTikTokTerminalWorkReactivationSql(capturedAt));
  const reactivation = validateTikTokTerminalWorkReactivationResult(
    extractWranglerD1Rows(update.stdout),
  );

  const afterQuery = runD1Command(target, buildTikTokTerminalWorkEvidenceSql());
  const after = validateTikTokTerminalWorkRow(
    extractWranglerD1Rows(afterQuery.stdout)[0],
    'active',
    Date.now(),
  );

  const evidence = {
    phase: 'terminal-reactivate',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    repositoryHead: readCommand('git', ['rev-parse', 'HEAD']).trim(),
    before,
    reactivation,
    after,
    queueMessageSent: false,
  };
  await saveEvidence('terminal-reactivate', evidence);
  return {
    evidenceFile: evidencePath('terminal-reactivate'),
    repositoryHead: evidence.repositoryHead,
    reactivation,
    after,
    queueMessageSent: false,
  };
}

async function runGuardedResume(target) {
  await assertNoPassedEvidence('terminal-resume');
  const reactivationEvidence = await requirePassedEvidence('terminal-reactivate');
  if (reactivationEvidence.queueMessageSent !== false) {
    throw operatorError('Terminal reactivation evidence does not prove zero Queue sends', 'TIKTOK_TERMINAL_WORK_REACTIVATION_EVIDENCE_INVALID');
  }

  const query = runD1Command(target, buildTikTokTerminalWorkEvidenceSql());
  const guard = validateTikTokTerminalWorkRow(
    extractWranglerD1Rows(query.stdout)[0],
    'active',
    Date.now(),
  );
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
    throw operatorError('Cloudflare Queue terminal-work resume push failed', 'TIKTOK_TERMINAL_WORK_QUEUE_PUSH_FAILED', {
      status: response.status,
      response: responseBody,
    });
  }

  const evidence = {
    phase: 'terminal-resume',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    repositoryHead: readCommand('git', ['rev-parse', 'HEAD']).trim(),
    terminalReactivationEvidence: evidencePath('terminal-reactivate'),
    guard,
    endpoint,
    payload,
    responseStatus: response.status,
    response: responseBody,
    queueMessageSent: true,
  };
  await saveEvidence('terminal-resume', evidence);
  return {
    evidenceFile: evidencePath('terminal-resume'),
    repositoryHead: evidence.repositoryHead,
    guard,
    responseStatus: response.status,
    response: responseBody,
    queueMessageSent: true,
  };
}

function assertRepositoryState() {
  const branch = readCommand('git', ['branch', '--show-current']).trim();
  if (branch !== 'main') {
    throw operatorError('TikTok terminal-work operator must run from main', 'TIKTOK_TERMINAL_WORK_REPOSITORY_STATE_INVALID', { branch });
  }
  const dirty = readCommand('git', ['status', '--porcelain']).trim();
  if (dirty) {
    throw operatorError('TikTok terminal-work operator requires a clean Git working tree', 'TIKTOK_TERMINAL_WORK_REPOSITORY_STATE_INVALID', {
      dirtyPaths: dirty.split(/\r?\n/u),
    });
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
    throw operatorError(`Command failed: ${command} ${args.join(' ')}`, 'TIKTOK_TERMINAL_WORK_COMMAND_FAILED', {
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
    throw operatorError(`Required TikTok terminal-work evidence is missing or invalid: ${name}`, 'TIKTOK_TERMINAL_WORK_EVIDENCE_MISSING', {
      evidenceFile: evidencePath(name),
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
  if (value?.status !== 'passed' || value?.phase !== name) {
    throw operatorError(`Required TikTok terminal-work evidence did not pass: ${name}`, 'TIKTOK_TERMINAL_WORK_EVIDENCE_INVALID', {
      evidenceFile: evidencePath(name),
    });
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
  throw operatorError(`TikTok terminal-work phase ${name} already passed and cannot be repeated`, 'TIKTOK_TERMINAL_WORK_ALREADY_EXECUTED', {
    evidenceFile: evidencePath(name),
    capturedAt: existing.capturedAt ?? null,
  });
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
  error.name = 'TikTokTerminalWorkRecoveryOperatorError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
