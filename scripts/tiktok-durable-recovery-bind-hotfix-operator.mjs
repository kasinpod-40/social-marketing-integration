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
import {
  TIKTOK_RECOVERY_BIND_HOTFIX_CONFIRMATIONS,
  TIKTOK_RECOVERY_BIND_HOTFIX_MERGE,
  TIKTOK_RECOVERY_BIND_HOTFIX_PHASES,
  assertTikTokRecoveryBindHotfixConfirmation,
  assertTikTokRecoveryBindHotfixEnv,
  buildTikTokRecoveryBindResumeSql,
  parseTikTokRecoveryBindHotfixArgs,
  validateTikTokRecoveryBindResumeRow,
} from './lib/tiktok-durable-recovery-bind-hotfix.js';

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
    code: error?.code ?? 'TIKTOK_RECOVERY_BIND_HOTFIX_OPERATOR_FAILED',
    message: error?.message ?? String(error),
    details: error?.details ?? {},
  }, null, 2));
  process.exitCode = 1;
}

async function main() {
  const mode = parseTikTokRecoveryBindHotfixArgs(process.argv.slice(2));
  if (mode.phase === 'plan' || mode.execute !== true) {
    console.log(JSON.stringify({
      ok: true,
      executed: false,
      requestedPhase: mode.phase === 'plan' ? null : mode.phase,
      phases: TIKTOK_RECOVERY_BIND_HOTFIX_PHASES,
      confirmations: TIKTOK_RECOVERY_BIND_HOTFIX_CONFIRMATIONS,
      hotfixMerge: TIKTOK_RECOVERY_BIND_HOTFIX_MERGE,
      evidenceRoot: EVIDENCE_ROOT,
      note: 'Plan only. No deployment, D1 write or Queue message was executed.',
    }, null, 2));
    return;
  }

  const target = assertTikTokRecoveryBindHotfixEnv(mode.phase, process.env);
  assertTikTokRecoveryBindHotfixConfirmation(mode.phase, process.env);
  await mkdir(EVIDENCE_ROOT, { recursive: true });
  assertRepositoryState();

  const result = mode.phase === 'deploy'
    ? await runHotfixDeploy(target)
    : await runGuardedResume(target);

  console.log(JSON.stringify({
    ok: true,
    phase: mode.phase,
    evidenceRoot: EVIDENCE_ROOT,
    ...result,
  }, null, 2));
}

async function runHotfixDeploy(target) {
  await requirePassedEvidence('migrate');
  await requireReadableFile(target.wranglerConfig);
  const configText = await readFile(target.wranglerConfig, 'utf8');
  const config = validateTikTokRecoveryWranglerConfig(configText);

  const repositoryCheck = runCommand('npm', ['run', 'check']);
  const focusedTests = runCommand('node', [
    '--test',
    'tests/application/d1-organic-observation-read-limit.test.js',
    'tests/application/tiktok-bootstrap-durable-recovery.test.js',
    'tests/application/tiktok-durable-recovery-operator.test.js',
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
    phase: 'hotfix-deploy',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    repositoryHead,
    hotfixMerge: TIKTOK_RECOVERY_BIND_HOTFIX_MERGE,
    config,
    checks: {
      repositoryCheck: repositoryCheck.status,
      focusedTests: focusedTests.status,
      projectDryRun: projectDryRun.status,
      wranglerDryRun: wranglerDryRun.status,
    },
    deployOutput: deploy.stdout,
  };
  await saveEvidence('hotfix-deploy', evidence);
  return { evidenceFile: evidencePath('hotfix-deploy'), repositoryHead, config };
}

async function runGuardedResume(target) {
  const deploy = await requirePassedEvidence('hotfix-deploy');
  if (deploy.hotfixMerge !== TIKTOK_RECOVERY_BIND_HOTFIX_MERGE) {
    throw operatorError('TikTok bind-hotfix deployment evidence references the wrong merge', 'TIKTOK_RECOVERY_BIND_HOTFIX_DEPLOY_EVIDENCE_INVALID', {
      expected: TIKTOK_RECOVERY_BIND_HOTFIX_MERGE,
      actual: deploy.hotfixMerge ?? null,
    });
  }

  const query = runD1Query(target, buildTikTokRecoveryBindResumeSql());
  const guard = validateTikTokRecoveryBindResumeRow(extractWranglerD1Rows(query.stdout)[0]);
  const payload = buildTikTokDurableRecoveryEnvelope();
  const endpoint = buildCloudflareQueuePushUrl({ accountId: target.accountId, queueId: target.queueId });
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
    throw operatorError('Cloudflare Queue resume push failed', 'TIKTOK_RECOVERY_BIND_HOTFIX_QUEUE_PUSH_FAILED', {
      status: response.status,
      response: responseBody,
    });
  }

  const evidence = {
    phase: 'resume',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    hotfixDeploy: {
      repositoryHead: deploy.repositoryHead,
      hotfixMerge: deploy.hotfixMerge,
    },
    guard,
    endpoint,
    payload,
    responseStatus: response.status,
    response: responseBody,
  };
  await saveEvidence('resume', evidence);
  return {
    evidenceFile: evidencePath('resume'),
    guard,
    responseStatus: response.status,
    response: responseBody,
  };
}

function assertRepositoryState() {
  const branch = readCommand('git', ['branch', '--show-current']).trim();
  if (branch !== 'main') {
    throw operatorError('TikTok bind-hotfix operator must run from main', 'TIKTOK_RECOVERY_BIND_HOTFIX_REPOSITORY_STATE_INVALID', { branch });
  }
  runCommand('git', ['merge-base', '--is-ancestor', TIKTOK_RECOVERY_BIND_HOTFIX_MERGE, 'HEAD']);
  const dirty = readCommand('git', ['status', '--porcelain']).trim();
  if (dirty) {
    throw operatorError('TikTok bind-hotfix operator requires a clean Git working tree', 'TIKTOK_RECOVERY_BIND_HOTFIX_REPOSITORY_STATE_INVALID', {
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
    throw operatorError(`Command failed: ${command} ${args.join(' ')}`, 'TIKTOK_RECOVERY_BIND_HOTFIX_COMMAND_FAILED', {
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
    throw operatorError(`Required TikTok recovery evidence is missing or invalid: ${name}`, 'TIKTOK_RECOVERY_BIND_HOTFIX_EVIDENCE_MISSING', {
      evidenceFile: evidencePath(name),
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
  if (value?.status !== 'passed' || value?.phase !== name) {
    throw operatorError(`Required TikTok recovery evidence did not pass: ${name}`, 'TIKTOK_RECOVERY_BIND_HOTFIX_EVIDENCE_INVALID', {
      evidenceFile: evidencePath(name),
    });
  }
  return Object.freeze(value);
}

async function requireReadableFile(path) {
  try {
    await access(path, constants.R_OK);
  } catch (cause) {
    throw operatorError(`Required file is not readable: ${path}`, 'TIKTOK_RECOVERY_BIND_HOTFIX_FILE_UNAVAILABLE', {
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
  error.name = 'TikTokRecoveryBindHotfixOperatorError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
