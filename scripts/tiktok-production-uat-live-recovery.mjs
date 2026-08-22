import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import {
  TIKTOK_PRODUCTION_RECOVERY,
  assertDarkProductionConfig,
  buildIdempotencyEnvelope,
  buildRecoveryConfigText,
  buildRedriveEnvelope,
  extractD1Rows,
  readJsoncScalar,
  validateRetainedDlqRow,
  validateSuccessfulSyncRun,
} from './lib/tiktok-production-uat-recovery-contract.js';

const CONFIRM_NAME = 'TIKTOK_PRODUCTION_RECOVERY_CONFIRM';
const CONFIRM_VALUE = 'RECOVER_RETAINED_TERMINAL_F7081_AND_RESTORE_DARK';
const POLL_MS = Number(process.env.TIKTOK_PRODUCTION_RECOVERY_POLL_MS ?? 2_000);
const POLL_ATTEMPTS = Number(process.env.TIKTOK_PRODUCTION_RECOVERY_POLL_ATTEMPTS ?? 120);
const EVIDENCE_FILE = resolve(
  process.env.TIKTOK_PRODUCTION_RECOVERY_LIVE_EVIDENCE
    ?? 'outputs/customer-production/tiktok-uat-live-recovery.json',
);

let finalEvidence = null;

try {
  const args = new Set(process.argv.slice(2));
  if (!args.has('--recover')) {
    console.log(JSON.stringify({
      ok: true,
      executed: false,
      mode: 'live-recovery-plan',
      reviewedMain: TIKTOK_PRODUCTION_RECOVERY.reviewedMain,
      requiredConfirmation: `${CONFIRM_NAME}=${CONFIRM_VALUE}`,
      note: 'No Production mutation was performed. Use --recover only from the customer-owned Production authority host.',
    }, null, 2));
  } else {
    finalEvidence = await runLiveRecovery();
    await persistEvidence(finalEvidence);
    console.log(JSON.stringify(finalEvidence, null, 2));
  }
} catch (error) {
  const failure = {
    ok: false,
    mode: 'live-recovery',
    capturedAt: new Date().toISOString(),
    code: error?.code ?? 'TIKTOK_PRODUCTION_UAT_LIVE_RECOVERY_FAILED',
    message: error?.message ?? String(error),
    details: sanitizeEvidence(error?.details ?? {}),
    ...(finalEvidence ? { partialEvidence: finalEvidence } : {}),
  };
  try { await persistEvidence(failure); } catch { /* best effort only */ }
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
}

async function runLiveRecovery() {
  requireConfirmation();
  const cloudflare = readCloudflareAuthority();
  const production = await discoverProductionWorktree();
  assertDarkProductionConfig(production.configText);

  const wrangler = resolve(process.cwd(), 'node_modules/.bin/wrangler');
  await requireReadable(wrangler);

  const retainedRows = queryD1({
    wrangler,
    production,
    configPath: production.configPath,
    sql: [
      'SELECT dlq_id, message_id, queue_name, job_type, schema_version,',
      'payload_json, replay_payload_json, error_code, retry_count, status,',
      'created_at, updated_at, redrive_requested_at, redrive_reference, redriven_at',
      'FROM dead_letter_jobs',
      `WHERE status='open' AND job_type='${TIKTOK_PRODUCTION_RECOVERY.jobType}'`,
      'ORDER BY created_at DESC;',
    ].join(' '),
  });
  if (retainedRows.length !== 1) {
    throw operatorError('Expected exactly one open retained TikTok Production UAT DLQ', 'TIKTOK_PRODUCTION_UAT_DLQ_CARDINALITY_MISMATCH', {
      count: retainedRows.length,
      candidates: retainedRows.map(summarizeDlq),
    });
  }
  const retained = validateRetainedDlqRow(retainedRows[0]);

  const newerOpenBefore = readOpenTikTokDlqs({
    wrangler,
    production,
    configPath: production.configPath,
    excludeDlqId: retained.dlqId,
  });
  if (newerOpenBefore.length !== 0) {
    throw operatorError('Unexpected additional open TikTok dead letters exist before recovery', 'TIKTOK_PRODUCTION_UAT_EXTRA_DLQ_PRESENT', {
      rows: newerOpenBefore.map(summarizeDlq),
    });
  }

  const tempWorktree = await mkdtemp(join(tmpdir(), 'mkt-tiktok-prod-recovery-'));
  const darkConfigPath = join(tempWorktree, 'wrangler.sync.jsonc');
  const recoveryConfigPath = join(tempWorktree, 'wrangler.sync.recovery.jsonc');
  let baselineWorktreeAdded = false;
  let anyDeploySucceeded = false;
  let recoveryConfigDeployed = false;
  let restore = { attempted: false, ok: false };
  let primaryError = null;
  const mutationLog = [];

  const evidence = {
    ok: false,
    mode: 'live-recovery',
    capturedAt: new Date().toISOString(),
    reviewedMain: TIKTOK_PRODUCTION_RECOVERY.reviewedMain,
    production: {
      worktree: production.worktree,
      workerName: readJsoncScalar(production.configText, 'name'),
      environment: readJsoncScalar(production.configText, 'MKT_ENV'),
      customerProfile: readJsoncScalar(production.configText, 'MKT_CUSTOMER_PROFILE'),
      workersDev: readJsoncScalar(production.configText, 'workers_dev'),
    },
    retainedDlq: summarizeDlq(retained.row),
    recovery: null,
    idempotency: null,
    postChecks: null,
    restore,
    mutationLog,
  };
  finalEvidence = evidence;

  try {
    run('git', [
      '-C', production.repositoryRoot,
      'worktree', 'add', '--detach', tempWorktree,
      TIKTOK_PRODUCTION_RECOVERY.reviewedMain,
    ]);
    baselineWorktreeAdded = true;

    const baselineHead = run('git', ['-C', tempWorktree, 'rev-parse', 'HEAD']).stdout;
    if (baselineHead !== TIKTOK_PRODUCTION_RECOVERY.reviewedMain) {
      throw operatorError('Temporary deploy worktree is not exact reviewed TikTok recovery main', 'TIKTOK_PRODUCTION_RECOVERY_HEAD_MISMATCH', {
        expected: TIKTOK_PRODUCTION_RECOVERY.reviewedMain,
        actual: baselineHead,
      });
    }

    await writeFile(darkConfigPath, production.configText, 'utf8');
    await writeFile(recoveryConfigPath, buildRecoveryConfigText(production.configText), 'utf8');

    deployWorker({ wrangler, cwd: production.worktree, configPath: darkConfigPath, dryRun: true });
    deployWorker({ wrangler, cwd: production.worktree, configPath: darkConfigPath });
    anyDeploySucceeded = true;
    mutationLog.push({ type: 'worker_deploy', state: 'reviewed_dark', sourceHead: baselineHead });

    deployWorker({ wrangler, cwd: production.worktree, configPath: recoveryConfigPath, dryRun: true });
    deployWorker({ wrangler, cwd: production.worktree, configPath: recoveryConfigPath });
    recoveryConfigDeployed = true;
    mutationLog.push({
      type: 'worker_deploy',
      state: 'temporary_tiktok_uat_redrive',
      tiktok: true,
      productionUat: true,
      dlqRedrive: true,
      tiktokSchedule: false,
      notificationRuntime: false,
    });

    const redriveEnvelope = buildRedriveEnvelope(retained.dlqId);
    const redrivePush = await pushQueue({ cloudflare, envelope: redriveEnvelope });
    mutationLog.push({ type: 'queue_send', purpose: 'canonical_dead_letter_redrive', responseStatus: redrivePush.status });

    const redriven = await waitForRetainedRedrive({
      wrangler,
      production,
      configPath: recoveryConfigPath,
      dlqId: retained.dlqId,
    });
    const redriveBoundary = Number(redriven.redrive_requested_at ?? 0);
    if (!Number.isSafeInteger(redriveBoundary) || redriveBoundary <= 0) {
      throw operatorError('Retained DLQ did not persist a valid redrive generation', 'TIKTOK_PRODUCTION_REDRIVE_GENERATION_MISSING', {
        dlqId: retained.dlqId,
        redriveRequestedAt: redriven.redrive_requested_at ?? null,
      });
    }

    const recoveredRun = await waitForSuccessfulTikTokRun({
      wrangler,
      production,
      configPath: recoveryConfigPath,
      startedAtMin: redriveBoundary,
      excludeSyncRunIds: [],
      retainedDlqId: retained.dlqId,
    });
    validateSuccessfulSyncRun(recoveredRun);
    evidence.recovery = {
      queue: redrivePush.publicResult,
      deadLetter: summarizeDlq(redriven),
      syncRun: summarizeRun(recoveredRun),
      targetVerification: 'successful_staged_business_completion_to_customer_lark',
      protectedTikTokSourceRuntimeWritePath: 'none',
    };

    const idempotencyRequestedAt = Math.max(Date.now(), Number(recoveredRun.finished_at ?? 0) + 1);
    const idempotencyEnvelope = buildIdempotencyEnvelope(retained.payload, idempotencyRequestedAt);
    const idempotencyPush = await pushQueue({ cloudflare, envelope: idempotencyEnvelope });
    mutationLog.push({ type: 'queue_send', purpose: 'same_logical_scope_idempotency_proof', responseStatus: idempotencyPush.status });

    const idempotentRun = await waitForSuccessfulTikTokRun({
      wrangler,
      production,
      configPath: recoveryConfigPath,
      startedAtMin: idempotencyRequestedAt,
      excludeSyncRunIds: [recoveredRun.sync_run_id],
      retainedDlqId: retained.dlqId,
    });
    validateSuccessfulSyncRun(idempotentRun, { idempotency: true });
    evidence.idempotency = {
      queue: idempotencyPush.publicResult,
      syncRun: summarizeRun(idempotentRun),
      businessWrites: 0,
      stableKeyIdempotency: true,
    };

    const originalDlq = readDlqById({
      wrangler,
      production,
      configPath: recoveryConfigPath,
      dlqId: retained.dlqId,
    });
    if (originalDlq?.status !== 'redriven') {
      throw operatorError('Original retained DLQ is not redriven after successful recovery', 'TIKTOK_PRODUCTION_REDRIVE_STATUS_INVALID', {
        dlq: summarizeDlq(originalDlq),
      });
    }
    const extraOpen = readOpenTikTokDlqs({
      wrangler,
      production,
      configPath: recoveryConfigPath,
      excludeDlqId: retained.dlqId,
    });
    if (extraOpen.length !== 0) {
      throw operatorError('Recovery created a new open TikTok dead letter', 'TIKTOK_PRODUCTION_RECOVERY_NEW_DLQ_DETECTED', {
        rows: extraOpen.map(summarizeDlq),
      });
    }
    evidence.postChecks = {
      originalDlqStatus: originalDlq.status,
      additionalOpenTikTokDlqCount: 0,
      recoveryRunStatus: recoveredRun.status,
      idempotencyRunStatus: idempotentRun.status,
    };
    evidence.ok = true;
  } catch (error) {
    primaryError = error;
    evidence.failure = {
      code: error?.code ?? 'TIKTOK_PRODUCTION_UAT_LIVE_RECOVERY_FAILED',
      message: error?.message ?? String(error),
      details: sanitizeEvidence(error?.details ?? {}),
    };
  } finally {
    if (anyDeploySucceeded || recoveryConfigDeployed) {
      restore.attempted = true;
      try {
        deployWorker({ wrangler, cwd: production.worktree, configPath: darkConfigPath });
        restore.ok = true;
        restore.state = 'reviewed_dark';
        mutationLog.push({ type: 'worker_deploy', state: 'restored_reviewed_dark' });
      } catch (restoreError) {
        restore.ok = false;
        restore.code = restoreError?.code ?? 'TIKTOK_PRODUCTION_DARK_RESTORE_FAILED';
        restore.message = restoreError?.message ?? String(restoreError);
        if (!primaryError) primaryError = restoreError;
      }
    }

    if (baselineWorktreeAdded) {
      try {
        run('git', ['-C', production.repositoryRoot, 'worktree', 'remove', '--force', tempWorktree]);
      } catch (cleanupError) {
        evidence.cleanupWarning = {
          code: cleanupError?.code ?? 'TIKTOK_PRODUCTION_RECOVERY_WORKTREE_CLEANUP_FAILED',
          message: cleanupError?.message ?? String(cleanupError),
        };
      }
    } else {
      await rm(tempWorktree, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  evidence.completedAt = new Date().toISOString();
  if (!restore.attempted || restore.ok !== true) {
    evidence.ok = false;
    throw operatorError('Production dark-state restore was not proven', 'TIKTOK_PRODUCTION_DARK_RESTORE_NOT_PROVEN', {
      restore,
      primaryFailure: evidence.failure ?? null,
    });
  }
  if (primaryError) throw primaryError;
  return evidence;
}

async function discoverProductionWorktree() {
  const repositoryRoot = resolve(
    process.env.MKT_RUNNER_REPOSITORY_ROOT
      ?? join(homedir(), 'Git', 'social-marketing-integration'),
  );
  await requireReadable(repositoryRoot);
  const output = run('git', ['-C', repositoryRoot, 'worktree', 'list', '--porcelain']);
  const worktrees = output.stdout
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim())
    .filter(Boolean);
  const candidates = [];
  for (const worktree of worktrees) {
    const configPath = join(worktree, 'wrangler.sync.jsonc');
    try {
      const configText = await readFile(configPath, 'utf8');
      if (readJsoncScalar(configText, 'name') === TIKTOK_PRODUCTION_RECOVERY.workerName
        && readJsoncScalar(configText, 'MKT_ENV') === 'production'
        && readJsoncScalar(configText, 'MKT_CUSTOMER_PROFILE') === TIKTOK_PRODUCTION_RECOVERY.customerProfile) {
        candidates.push({ worktree, configPath, configText });
      }
    } catch {
      // Non-Production worktrees may not have local Wrangler config; ignore them.
    }
  }
  if (candidates.length !== 1) {
    throw operatorError('Expected exactly one isolated customer Production worktree', 'TIKTOK_PRODUCTION_WORKTREE_CARDINALITY_MISMATCH', {
      repositoryRoot,
      discoveredWorktrees: worktrees,
      productionCandidateCount: candidates.length,
      productionCandidatePaths: candidates.map((candidate) => candidate.worktree),
    });
  }
  return Object.freeze({ repositoryRoot, ...candidates[0] });
}

function deployWorker({ wrangler, cwd, configPath, dryRun = false }) {
  const args = ['deploy', '--config', configPath];
  if (dryRun) args.push('--dry-run');
  return run(wrangler, args, { cwd });
}

async function pushQueue({ cloudflare, envelope }) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${safeId(cloudflare.accountId, 'CF_ACCOUNT_ID')}/queues/${safeId(cloudflare.queueId, 'CF_QUEUE_ID')}/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cloudflare.apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(envelope),
  });
  const text = await response.text();
  const body = parseJsonOrText(text);
  if (!response.ok || body?.success !== true) {
    throw operatorError('Cloudflare Queue HTTP push failed', 'TIKTOK_PRODUCTION_QUEUE_PUSH_FAILED', {
      status: response.status,
      response: sanitizeEvidence(body),
    });
  }
  return Object.freeze({
    status: response.status,
    publicResult: sanitizeEvidence({ success: true, result: body?.result ?? null }),
  });
}

async function waitForRetainedRedrive(input) {
  let last = null;
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
    last = readDlqById(input);
    if (last?.status === 'redriven') return last;
    if (last && !['open', 'redrive_pending'].includes(last.status)) {
      throw operatorError('Retained DLQ entered an unexpected state', 'TIKTOK_PRODUCTION_REDRIVE_STATUS_INVALID', {
        dlq: summarizeDlq(last),
      });
    }
    await sleep(POLL_MS);
  }
  throw operatorError('Timed out waiting for retained DLQ redrive', 'TIKTOK_PRODUCTION_REDRIVE_TIMEOUT', {
    dlq: summarizeDlq(last),
  });
}

async function waitForSuccessfulTikTokRun(input) {
  let recent = [];
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
    recent = readTikTokRuns(input).filter((row) => !input.excludeSyncRunIds.includes(row.sync_run_id));
    const success = recent.find((row) => row.status === 'success');
    if (success) return success;

    const newOpenDlq = readOpenTikTokDlqs({
      ...input,
      excludeDlqId: input.retainedDlqId,
      createdAtMin: input.startedAtMin,
    });
    if (newOpenDlq.length > 0) {
      throw operatorError('TikTok recovery job terminalized into a new DLQ', 'TIKTOK_PRODUCTION_RECOVERY_NEW_DLQ_DETECTED', {
        rows: newOpenDlq.map(summarizeDlq),
        recentRuns: recent.map(summarizeRun),
      });
    }
    await sleep(POLL_MS);
  }
  throw operatorError('Timed out waiting for successful TikTok Production UAT sync run', 'TIKTOK_PRODUCTION_SYNC_RUN_TIMEOUT', {
    startedAtMin: input.startedAtMin,
    recentRuns: recent.map(summarizeRun),
  });
}

function readTikTokRuns({ wrangler, production, configPath, startedAtMin }) {
  const threshold = Number(startedAtMin);
  const sql = [
    'SELECT sync_run_id, customer_profile, platform, account_key, source, sync_type, status,',
    'started_at, finished_at, records_pulled, records_created, records_updated, records_skipped,',
    'records_written, retry_count, error_code, details_json, created_at, updated_at',
    'FROM sync_runs',
    `WHERE customer_profile='${TIKTOK_PRODUCTION_RECOVERY.customerProfile}'`,
    "AND platform='tiktok' AND sync_type='native_import'",
    `AND started_at >= ${Number.isSafeInteger(threshold) && threshold >= 0 ? threshold : 0}`,
    'ORDER BY started_at DESC LIMIT 20;',
  ].join(' ');
  return queryD1({ wrangler, production, configPath, sql });
}

function readDlqById({ wrangler, production, configPath, dlqId }) {
  const rows = queryD1({
    wrangler,
    production,
    configPath,
    sql: [
      'SELECT dlq_id, message_id, queue_name, job_type, schema_version, payload_json,',
      'error_code, retry_count, status, created_at, updated_at,',
      'redrive_requested_at, redrive_reference, redriven_at',
      'FROM dead_letter_jobs',
      `WHERE dlq_id='${sqlText(dlqId)}' LIMIT 1;`,
    ].join(' '),
  });
  return rows[0] ?? null;
}

function readOpenTikTokDlqs({ wrangler, production, configPath, excludeDlqId, createdAtMin = 0 }) {
  const threshold = Number(createdAtMin);
  return queryD1({
    wrangler,
    production,
    configPath,
    sql: [
      'SELECT dlq_id, message_id, queue_name, job_type, schema_version, error_code, retry_count, status, created_at, updated_at',
      'FROM dead_letter_jobs',
      `WHERE status='open' AND job_type='${TIKTOK_PRODUCTION_RECOVERY.jobType}'`,
      excludeDlqId ? `AND dlq_id <> '${sqlText(excludeDlqId)}'` : '',
      `AND created_at >= ${Number.isSafeInteger(threshold) && threshold >= 0 ? threshold : 0}`,
      'ORDER BY created_at DESC;',
    ].filter(Boolean).join(' '),
  });
}

function queryD1({ wrangler, production, configPath, sql }) {
  const result = run(wrangler, [
    'd1', 'execute', 'MKT_STATE_DB',
    '--remote',
    '--config', configPath,
    '--command', sql,
    '--json',
  ], { cwd: production.worktree });
  return extractD1Rows(result.stdout);
}

function readCloudflareAuthority() {
  const accountId = requireEnv('CF_ACCOUNT_ID');
  const queueId = requireEnv('CF_QUEUE_ID');
  const apiToken = requireEnv('CLOUDFLARE_API_TOKEN');
  return Object.freeze({ accountId, queueId, apiToken });
}

function requireConfirmation() {
  if (process.env[CONFIRM_NAME] !== CONFIRM_VALUE) {
    throw operatorError('Explicit Production recovery confirmation is required', 'TIKTOK_PRODUCTION_RECOVERY_CONFIRMATION_REQUIRED', {
      envName: CONFIRM_NAME,
      expectedValue: CONFIRM_VALUE,
    });
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw operatorError(`Production recovery requires ${name}`, 'TIKTOK_PRODUCTION_RECOVERY_ENV_MISSING', { envName: name });
  }
  return value.trim();
}

function safeId(value, name) {
  if (!/^[A-Za-z0-9_-]+$/u.test(String(value))) {
    throw operatorError(`${name} contains unsafe characters`, 'TIKTOK_PRODUCTION_RECOVERY_AUTHORITY_INVALID', { name });
  }
  return String(value);
}

function sqlText(value) {
  return String(value).replaceAll("'", "''");
}

function summarizeDlq(row) {
  if (!row) return null;
  return {
    dlqId: row.dlq_id ?? null,
    messageId: row.message_id ?? null,
    queueName: row.queue_name ?? null,
    jobType: row.job_type ?? null,
    schemaVersion: row.schema_version ?? null,
    errorCode: row.error_code ?? null,
    retryCount: row.retry_count ?? null,
    status: row.status ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    redriveRequestedAt: row.redrive_requested_at ?? null,
    redriveReference: row.redrive_reference ?? null,
    redrivenAt: row.redriven_at ?? null,
  };
}

function summarizeRun(row) {
  if (!row) return null;
  return {
    syncRunId: row.sync_run_id ?? null,
    customerProfile: row.customer_profile ?? null,
    platform: row.platform ?? null,
    accountKey: row.account_key ?? null,
    source: row.source ?? null,
    syncType: row.sync_type ?? null,
    status: row.status ?? null,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
    recordsPulled: Number(row.records_pulled ?? 0),
    recordsCreated: Number(row.records_created ?? 0),
    recordsUpdated: Number(row.records_updated ?? 0),
    recordsSkipped: Number(row.records_skipped ?? 0),
    recordsWritten: Number(row.records_written ?? 0),
    retryCount: Number(row.retry_count ?? 0),
    errorCode: row.error_code ?? null,
    details: parseJsonOrText(row.details_json ?? '{}'),
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw operatorError(`Command failed: ${command} ${args.join(' ')}`, 'TIKTOK_PRODUCTION_RECOVERY_COMMAND_FAILED', {
      command,
      args,
      status: result.status,
      stdout: result.stdout?.trim() ?? '',
      stderr: result.stderr?.trim() ?? '',
    });
  }
  return Object.freeze({ stdout: result.stdout?.trim() ?? '', stderr: result.stderr?.trim() ?? '' });
}

async function requireReadable(path) {
  try {
    await access(path, constants.R_OK);
  } catch (cause) {
    throw operatorError('Required path is not readable', 'TIKTOK_PRODUCTION_RECOVERY_PATH_UNREADABLE', {
      path,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function parseJsonOrText(value) {
  try { return JSON.parse(String(value ?? '')); } catch { return String(value ?? ''); }
}

function sanitizeEvidence(value) {
  if (Array.isArray(value)) return value.map(sanitizeEvidence);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|authorization|credential/iu.test(key)) output[key] = '[REDACTED]';
    else output[key] = sanitizeEvidence(item);
  }
  return output;
}

async function persistEvidence(value) {
  await mkdir(dirname(EVIDENCE_FILE), { recursive: true });
  await writeFile(EVIDENCE_FILE, `${JSON.stringify(sanitizeEvidence(value), null, 2)}\n`, 'utf8');
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'TikTokProductionUatLiveRecoveryError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
