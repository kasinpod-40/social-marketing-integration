import { spawnSync } from 'node:child_process';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import {
  TIKTOK_PRODUCTION_RECOVERY,
  assertDarkProductionConfig,
  buildRecoveryConfigText,
  extractD1Rows,
  readJsoncScalar,
} from './lib/tiktok-production-uat-recovery-contract.js';
import {
  TIKTOK_PRODUCTION_RESUME,
  buildResumeIdempotencyEnvelope,
  buildResumeRedriveEnvelope,
  validateResumeDlqRow,
  validateResumeSuccessRun,
  validateRootRedrivenRow,
} from './lib/tiktok-production-uat-resume-contract.js';

const CONFIRM_NAME = 'TIKTOK_PRODUCTION_RECOVERY_CONFIRM';
const CONFIRM_VALUE = 'RECOVER_DLQ_FEF9919E_AFTER_TRANSPORT_BOUND_REVIEW';
const POLL_MS = positiveIntegerEnv('TIKTOK_PRODUCTION_RECOVERY_POLL_MS', 2_000);
const POLL_ATTEMPTS = positiveIntegerEnv('TIKTOK_PRODUCTION_RECOVERY_POLL_ATTEMPTS', 1_800);
const EVIDENCE_FILE = resolve(
  process.env.TIKTOK_PRODUCTION_RECOVERY_LIVE_EVIDENCE
    ?? 'outputs/customer-production/tiktok-uat-live-resume.json',
);

let finalEvidence = null;

try {
  const args = new Set(process.argv.slice(2));
  if (!args.has('--recover')) {
    console.log(JSON.stringify({
      ok: true,
      executed: false,
      mode: 'live-resume-plan',
      reviewedMain: TIKTOK_PRODUCTION_RECOVERY.reviewedMain,
      rootDlqId: TIKTOK_PRODUCTION_RESUME.rootDlqId,
      parentDlqId: TIKTOK_PRODUCTION_RESUME.parentDlqId,
      resumeDlqId: TIKTOK_PRODUCTION_RESUME.resumeDlqId,
      recoveryTransportBudget: {
        larkRequestTimeoutMs: TIKTOK_PRODUCTION_RECOVERY.recoveryLarkRequestTimeoutMs,
        larkMaxAttempts: TIKTOK_PRODUCTION_RECOVERY.recoveryLarkMaxAttempts,
      },
      requiredConfirmation: `${CONFIRM_NAME}=${CONFIRM_VALUE}`,
      note: 'No Production mutation was performed.',
    }, null, 2));
  } else {
    finalEvidence = await runLiveResume();
    await persistEvidence(finalEvidence);
    console.log(JSON.stringify(finalEvidence, null, 2));
  }
} catch (error) {
  const failure = {
    ok: false,
    mode: 'live-resume',
    capturedAt: new Date().toISOString(),
    code: error?.code ?? 'TIKTOK_PRODUCTION_UAT_LIVE_RESUME_FAILED',
    message: error?.message ?? String(error),
    details: sanitizeEvidence(error?.details ?? {}),
    ...(finalEvidence ? { partialEvidence: sanitizeEvidence(finalEvidence) } : {}),
  };
  try { await persistEvidence(failure); } catch { /* best effort only */ }
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
}

async function runLiveResume() {
  requireConfirmation();
  const cloudflare = readCloudflareAuthority();
  const production = await discoverProductionWorktree();
  assertDarkProductionConfig(production.configText);

  const wrangler = resolve(production.repositoryRoot, 'node_modules/.bin/wrangler');
  await requireReadable(wrangler);

  const rootRow = readDlqById({
    wrangler,
    production,
    configPath: production.configPath,
    dlqId: TIKTOK_PRODUCTION_RESUME.rootDlqId,
  });
  validateRootRedrivenRow(rootRow);

  const resumeRow = readDlqById({
    wrangler,
    production,
    configPath: production.configPath,
    dlqId: TIKTOK_PRODUCTION_RESUME.resumeDlqId,
  });
  const resume = validateResumeDlqRow(resumeRow);

  const openBefore = readOpenTikTokDlqs({
    wrangler,
    production,
    configPath: production.configPath,
  });
  if (openBefore.length !== 1 || openBefore[0]?.dlq_id !== TIKTOK_PRODUCTION_RESUME.resumeDlqId) {
    throw operatorError('Expected fef to be the only open TikTok DLQ before recovery', 'TIKTOK_PRODUCTION_RESUME_OPEN_DLQ_CARDINALITY_MISMATCH', {
      rows: openBefore.map(summarizeDlq),
    });
  }

  const tempWorktree = join(
    tmpdir(),
    `mkt-tiktok-prod-resume-${process.pid}-${Date.now()}`,
  );
  const darkConfigPath = join(tempWorktree, 'wrangler.sync.jsonc');
  const recoveryConfigPath = join(tempWorktree, 'wrangler.sync.resume.jsonc');
  let baselineWorktreeAdded = false;
  let anyDeploySucceeded = false;
  let restore = { attempted: false, ok: false, required: false };
  let primaryError = null;
  const mutationLog = [];

  const evidence = {
    ok: false,
    mode: 'live-resume',
    capturedAt: new Date().toISOString(),
    reviewedMain: TIKTOK_PRODUCTION_RECOVERY.reviewedMain,
    lineage: {
      rootDlq: summarizeDlq(rootRow),
      parentDlqId: TIKTOK_PRODUCTION_RESUME.parentDlqId,
      resumeDlqBefore: summarizeDlq(resume.row),
      rootRedriveReference: TIKTOK_PRODUCTION_RESUME.rootRedriveReference,
      verified: true,
    },
    production: {
      worktree: production.worktree,
      workerName: readJsoncScalar(production.configText, 'name'),
      environment: readJsoncScalar(production.configText, 'MKT_ENV'),
      customerProfile: readJsoncScalar(production.configText, 'MKT_CUSTOMER_PROFILE'),
      initialState: 'dark',
    },
    recoveryTransportBudget: {
      larkRequestTimeoutMs: TIKTOK_PRODUCTION_RECOVERY.recoveryLarkRequestTimeoutMs,
      larkMaxAttempts: TIKTOK_PRODUCTION_RECOVERY.recoveryLarkMaxAttempts,
    },
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
      throw operatorError('Temporary deploy worktree is not exact reviewed TikTok baseline', 'TIKTOK_PRODUCTION_RESUME_HEAD_MISMATCH', {
        expected: TIKTOK_PRODUCTION_RECOVERY.reviewedMain,
        actual: baselineHead,
      });
    }

    await writeFile(darkConfigPath, production.configText, 'utf8');
    await writeFile(recoveryConfigPath, buildRecoveryConfigText(production.configText), 'utf8');

    deployWorker({ wrangler, cwd: tempWorktree, configPath: darkConfigPath, dryRun: true });
    deployWorker({ wrangler, cwd: tempWorktree, configPath: darkConfigPath });
    anyDeploySucceeded = true;
    restore.required = true;
    mutationLog.push({ type: 'worker_deploy', state: 'reviewed_dark', sourceHead: baselineHead });

    deployWorker({ wrangler, cwd: tempWorktree, configPath: recoveryConfigPath, dryRun: true });
    deployWorker({ wrangler, cwd: tempWorktree, configPath: recoveryConfigPath });
    mutationLog.push({
      type: 'worker_deploy',
      state: 'temporary_tiktok_uat_redrive',
      sourceHead: baselineHead,
      tiktok: true,
      productionUat: true,
      dlqRedrive: true,
      tiktokSchedule: false,
      notificationRuntime: false,
      larkRequestTimeoutMs: TIKTOK_PRODUCTION_RECOVERY.recoveryLarkRequestTimeoutMs,
      larkMaxAttempts: TIKTOK_PRODUCTION_RECOVERY.recoveryLarkMaxAttempts,
    });

    const redrivePush = await pushQueue({ cloudflare, envelope: buildResumeRedriveEnvelope() });
    mutationLog.push({
      type: 'queue_send',
      purpose: 'canonical_fef_dead_letter_redrive',
      dlqId: TIKTOK_PRODUCTION_RESUME.resumeDlqId,
      responseStatus: redrivePush.status,
    });

    const redrivenResume = await waitForDlqRedriven({
      wrangler,
      production,
      configPath: recoveryConfigPath,
      dlqId: TIKTOK_PRODUCTION_RESUME.resumeDlqId,
    });
    const recoveryBoundary = requirePositiveSafeInteger(
      redrivenResume.redrive_requested_at,
      'resume redrive_requested_at',
    );

    const recoveredRun = await waitForTikTokTerminalOutcome({
      wrangler,
      production,
      configPath: recoveryConfigPath,
      startedAtMin: recoveryBoundary,
      excludeSyncRunIds: [TIKTOK_PRODUCTION_RESUME.staleRunId],
      phase: 'recovery',
    });
    validateResumeSuccessRun(recoveredRun);
    evidence.recovery = {
      queue: redrivePush.publicResult,
      deadLetter: summarizeDlq(redrivenResume),
      syncRun: summarizeRun(recoveredRun),
      customerLarkRuntimeCompletion: true,
      directCustomerLarkReadback: 'pending_separate_read_only_verification',
      protectedTikTokSourceRuntimeWritePath: 'none',
    };

    const finishedAt = Number(recoveredRun.finished_at ?? 0);
    const idempotencyBoundary = Number.isSafeInteger(finishedAt) && finishedAt > 0
      ? finishedAt + 1
      : Math.max(0, Date.now() - 5_000);
    const idempotencyRequestedAt = Date.now();
    const idempotencyEnvelope = buildResumeIdempotencyEnvelope(resume.payload, idempotencyRequestedAt);
    const idempotencyPush = await pushQueue({ cloudflare, envelope: idempotencyEnvelope });
    mutationLog.push({
      type: 'queue_send',
      purpose: 'same_logical_scope_idempotency_proof',
      responseStatus: idempotencyPush.status,
    });

    const idempotentRun = await waitForTikTokTerminalOutcome({
      wrangler,
      production,
      configPath: recoveryConfigPath,
      startedAtMin: idempotencyBoundary,
      excludeSyncRunIds: [TIKTOK_PRODUCTION_RESUME.staleRunId, recoveredRun.sync_run_id],
      phase: 'idempotency',
    });
    validateResumeSuccessRun(idempotentRun, { idempotency: true });
    evidence.idempotency = {
      queue: idempotencyPush.publicResult,
      requestedAt: new Date(idempotencyRequestedAt).toISOString(),
      syncRun: summarizeRun(idempotentRun),
      businessWrites: 0,
      stableKeyIdempotency: true,
    };

    const rootAfter = readDlqById({
      wrangler,
      production,
      configPath: recoveryConfigPath,
      dlqId: TIKTOK_PRODUCTION_RESUME.rootDlqId,
    });
    validateRootRedrivenRow(rootAfter);
    const resumeAfter = readDlqById({
      wrangler,
      production,
      configPath: recoveryConfigPath,
      dlqId: TIKTOK_PRODUCTION_RESUME.resumeDlqId,
    });
    if (resumeAfter?.status !== 'redriven') {
      throw operatorError('Recovery DLQ is not redriven after recovery', 'TIKTOK_PRODUCTION_RESUME_REDRIVE_STATUS_INVALID', {
        row: summarizeDlq(resumeAfter),
      });
    }
    const openAfter = readOpenTikTokDlqs({
      wrangler,
      production,
      configPath: recoveryConfigPath,
    });
    if (openAfter.length !== 0) {
      throw operatorError('Open TikTok DLQ remains after recovery and idempotency proof', 'TIKTOK_PRODUCTION_RESUME_OPEN_DLQ_REMAINS', {
        rows: openAfter.map(summarizeDlq),
      });
    }

    evidence.postChecks = {
      rootDlqStatus: rootAfter.status,
      recoveryDlqStatus: resumeAfter.status,
      openTikTokDlqCount: 0,
      recoveryRunStatus: recoveredRun.status,
      idempotencyRunStatus: idempotentRun.status,
      stalePreResumeRunIdUntouched: TIKTOK_PRODUCTION_RESUME.staleRunId,
    };
    evidence.ok = true;
  } catch (error) {
    primaryError = error;
    evidence.failure = {
      code: error?.code ?? 'TIKTOK_PRODUCTION_UAT_LIVE_RESUME_FAILED',
      message: error?.message ?? String(error),
      details: sanitizeEvidence(error?.details ?? {}),
    };
  } finally {
    if (anyDeploySucceeded) {
      restore.attempted = true;
      try {
        deployWorker({ wrangler, cwd: tempWorktree, configPath: darkConfigPath });
        restore.ok = true;
        restore.state = 'reviewed_dark';
        mutationLog.push({ type: 'worker_deploy', state: 'restored_reviewed_dark', sourceHead: TIKTOK_PRODUCTION_RECOVERY.reviewedMain });
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
          code: cleanupError?.code ?? 'TIKTOK_PRODUCTION_RESUME_WORKTREE_CLEANUP_FAILED',
          message: cleanupError?.message ?? String(cleanupError),
        };
      }
    } else {
      await rm(tempWorktree, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  evidence.completedAt = new Date().toISOString();
  if (restore.required && (!restore.attempted || restore.ok !== true)) {
    evidence.ok = false;
    const restoreFailure = operatorError('Production dark-state restore was not proven', 'TIKTOK_PRODUCTION_DARK_RESTORE_NOT_PROVEN', {
      restore,
      primaryFailure: evidence.failure ?? null,
    });
    await persistEvidence(evidence).catch(() => undefined);
    throw restoreFailure;
  }
  if (primaryError) {
    await persistEvidence(evidence).catch(() => undefined);
    throw primaryError;
  }
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
      // Ignore non-Production worktrees and worktrees without local config.
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

async function waitForDlqRedriven(input) {
  let last = null;
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
    last = readDlqById(input);
    if (last?.status === 'redriven') return last;
    if (last && !['open', 'redrive_pending'].includes(last.status)) {
      throw operatorError('Recovery DLQ entered an unexpected redrive state', 'TIKTOK_PRODUCTION_RESUME_REDRIVE_STATUS_INVALID', {
        row: summarizeDlq(last),
      });
    }
    await sleep(POLL_MS);
  }
  throw operatorError('Recovery DLQ redrive did not reach redriven state', 'TIKTOK_PRODUCTION_RESUME_REDRIVE_TIMEOUT', {
    row: summarizeDlq(last),
  });
}

async function waitForTikTokTerminalOutcome(input) {
  let recent = [];
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
    recent = readTikTokRuns(input)
      .filter((row) => !input.excludeSyncRunIds.includes(row.sync_run_id));

    const success = recent.find((row) => row.status === 'success');
    if (success) return success;

    const openDlqs = readOpenTikTokDlqs({
      wrangler: input.wrangler,
      production: input.production,
      configPath: input.configPath,
      createdAtMin: input.startedAtMin,
    });
    if (openDlqs.length > 0) {
      throw operatorError(`TikTok ${input.phase} terminalized into a new DLQ`, 'TIKTOK_PRODUCTION_RESUME_NEW_DLQ_DETECTED', {
        phase: input.phase,
        rows: openDlqs.map(summarizeDlq),
        recentRuns: recent.map(summarizeRun),
      });
    }

    const terminalNonRetryable = recent.find((row) => {
      if (row.status !== 'failed') return false;
      const details = parseJsonOrText(row.details_json ?? '{}');
      return details && typeof details === 'object' && details.retryable === false;
    });
    if (terminalNonRetryable) {
      throw operatorError(`TikTok ${input.phase} failed non-retryably`, 'TIKTOK_PRODUCTION_RESUME_NON_RETRYABLE_FAILURE', {
        phase: input.phase,
        run: summarizeRun(terminalNonRetryable),
      });
    }

    await sleep(POLL_MS);
  }
  throw operatorError(`TikTok ${input.phase} did not reach a terminal success outcome`, 'TIKTOK_PRODUCTION_RESUME_SYNC_RUN_TIMEOUT', {
    phase: input.phase,
    startedAtMin: input.startedAtMin,
    recentRuns: recent.map(summarizeRun),
  });
}

function readTikTokRuns({ wrangler, production, configPath, startedAtMin }) {
  const threshold = requireNonNegativeSafeInteger(startedAtMin, 'startedAtMin');
  return queryD1({
    wrangler,
    production,
    configPath,
    sql: [
      'SELECT sync_run_id, customer_profile, platform, account_key, source, sync_type, status,',
      'started_at, finished_at, records_pulled, records_created, records_updated, records_skipped,',
      'records_written, retry_count, error_code, details_json, created_at, updated_at',
      'FROM sync_runs',
      `WHERE customer_profile='${TIKTOK_PRODUCTION_RECOVERY.customerProfile}'`,
      "AND platform='tiktok' AND sync_type='native_import'",
      `AND started_at >= ${threshold}`,
      'ORDER BY started_at DESC LIMIT 50;',
    ].join(' '),
  });
}

function readDlqById({ wrangler, production, configPath, dlqId }) {
  const rows = queryD1({
    wrangler,
    production,
    configPath,
    sql: [
      'SELECT dlq_id, message_id, queue_name, job_type, schema_version, payload_json, replay_payload_json,',
      'error_code, retry_count, status, created_at, updated_at,',
      'redrive_requested_at, redrive_reference, redriven_at',
      'FROM dead_letter_jobs',
      `WHERE dlq_id='${sqlText(dlqId)}' LIMIT 1;`,
    ].join(' '),
  });
  return rows[0] ?? null;
}

function readOpenTikTokDlqs({ wrangler, production, configPath, createdAtMin = 0 }) {
  const threshold = requireNonNegativeSafeInteger(createdAtMin, 'createdAtMin');
  return queryD1({
    wrangler,
    production,
    configPath,
    sql: [
      'SELECT dlq_id, message_id, queue_name, job_type, schema_version, payload_json,',
      'error_code, retry_count, status, created_at, updated_at,',
      'redrive_requested_at, redrive_reference, redriven_at',
      'FROM dead_letter_jobs',
      `WHERE status='open' AND job_type='${TIKTOK_PRODUCTION_RECOVERY.jobType}'`,
      `AND created_at >= ${threshold}`,
      'ORDER BY created_at DESC;',
    ].join(' '),
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
  return Object.freeze({
    accountId: requireEnv('CF_ACCOUNT_ID'),
    queueId: requireEnv('CF_QUEUE_ID'),
    apiToken: requireEnv('CLOUDFLARE_API_TOKEN'),
  });
}

function requireConfirmation() {
  if (process.env[CONFIRM_NAME] !== CONFIRM_VALUE) {
    throw operatorError('Explicit Production resume confirmation is required', 'TIKTOK_PRODUCTION_RESUME_CONFIRMATION_REQUIRED', {
      envName: CONFIRM_NAME,
      expectedValue: CONFIRM_VALUE,
    });
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw operatorError(`Production resume requires ${name}`, 'TIKTOK_PRODUCTION_RESUME_ENV_MISSING', { envName: name });
  }
  return value.trim();
}

function positiveIntegerEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw operatorError(`${name} must be a positive integer`, 'TIKTOK_PRODUCTION_RESUME_POLL_CONFIG_INVALID', { name, value: raw });
  }
  return value;
}

function requirePositiveSafeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw operatorError(`${label} must be a positive safe integer`, 'TIKTOK_PRODUCTION_RESUME_GENERATION_MISSING', { label, value });
  }
  return number;
}

function requireNonNegativeSafeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw operatorError(`${label} must be a non-negative safe integer`, 'TIKTOK_PRODUCTION_RESUME_BOUNDARY_INVALID', { label, value });
  }
  return number;
}

function safeId(value, name) {
  if (!/^[A-Za-z0-9_-]+$/u.test(String(value))) {
    throw operatorError(`${name} contains unsafe characters`, 'TIKTOK_PRODUCTION_RESUME_AUTHORITY_INVALID', { name });
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
    throw operatorError(`Command failed: ${command} ${args.join(' ')}`, 'TIKTOK_PRODUCTION_RESUME_COMMAND_FAILED', {
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
    throw operatorError('Required path is not readable', 'TIKTOK_PRODUCTION_RESUME_PATH_UNREADABLE', {
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
  error.name = 'TikTokProductionUatLiveResumeError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
