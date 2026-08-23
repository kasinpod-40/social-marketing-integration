import { spawnSync } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import {
  TIKTOK_PRODUCTION_RECOVERY,
  assertDarkProductionConfig,
  extractD1Rows,
  readJsoncScalar,
} from './lib/tiktok-production-uat-recovery-contract.js';
import {
  TIKTOK_PRODUCTION_RESUME,
  validateResumeDlqRow,
  validateRootRedrivenRow,
} from './lib/tiktok-production-uat-resume-contract.js';

const EVIDENCE_FILE = resolve(
  process.env.TIKTOK_PROD_RECOVERY_EVIDENCE
    ?? 'outputs/customer-production/tiktok-uat-recovery-readonly.json',
);

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error?.code ?? 'TIKTOK_PRODUCTION_UAT_RECOVERY_DIAGNOSIS_FAILED',
    message: error?.message ?? String(error),
    details: sanitize(error?.details ?? {}),
  }, null, 2));
  process.exitCode = 1;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (!args.has('--execute')) {
    console.log(JSON.stringify({
      ok: true,
      executed: false,
      mode: 'read-only-diagnosis',
      reviewedRuntime: TIKTOK_PRODUCTION_RECOVERY.reviewedMain,
      rootDlqId: TIKTOK_PRODUCTION_RESUME.rootDlqId,
      parentDlqId: TIKTOK_PRODUCTION_RESUME.parentDlqId,
      recoveryDlqId: TIKTOK_PRODUCTION_RESUME.resumeDlqId,
      note: 'No Cloudflare, D1, Queue, Worker, Lark, or Git mutation was performed.',
    }, null, 2));
    return;
  }

  const production = await discoverProductionWorktree();
  assertDarkProductionConfig(production.configText);

  const wrangler = resolve(process.cwd(), 'node_modules/.bin/wrangler');
  await requireReadable(wrangler);

  const rootRow = readDlqById({ wrangler, production, dlqId: TIKTOK_PRODUCTION_RESUME.rootDlqId });
  validateRootRedrivenRow(rootRow);

  const recoveryRow = readDlqById({ wrangler, production, dlqId: TIKTOK_PRODUCTION_RESUME.resumeDlqId });
  const recovery = validateResumeDlqRow(recoveryRow);

  const openRows = queryD1({
    wrangler,
    production,
    sql: [
      'SELECT dlq_id, message_id, queue_name, job_type, schema_version, payload_json,',
      'error_code, retry_count, status, created_at, updated_at,',
      'redrive_requested_at, redrive_reference, redriven_at',
      'FROM dead_letter_jobs',
      `WHERE status='open' AND job_type='${TIKTOK_PRODUCTION_RECOVERY.jobType}'`,
      'ORDER BY created_at DESC;',
    ].join(' '),
  });
  if (openRows.length !== 1 || openRows[0]?.dlq_id !== TIKTOK_PRODUCTION_RESUME.resumeDlqId) {
    throw operatorError('Expected fef to be the only open TikTok Production UAT DLQ', 'TIKTOK_PRODUCTION_UAT_DLQ_CARDINALITY_MISMATCH', {
      count: openRows.length,
      rows: openRows.map(summarizeDlq),
    });
  }

  const evidence = Object.freeze({
    ok: true,
    mode: 'read-only-diagnosis',
    capturedAt: new Date().toISOString(),
    reviewedRuntime: TIKTOK_PRODUCTION_RECOVERY.reviewedMain,
    productionWorktree: production.worktree,
    productionConfigPath: production.configPath,
    productionConfig: production.summary,
    lineage: {
      rootDlq: summarizeDlq(rootRow),
      parentDlqId: TIKTOK_PRODUCTION_RESUME.parentDlqId,
      recoveryDlq: summarizeDlq(recovery.row),
      recoveryPayloadRedriveOfDlqId: recovery.payload.redriveOfDlqId,
      recoveryPayloadRedriveReference: recovery.payload.redriveReference,
      verified: true,
    },
    executionBudget: {
      cpuMs: TIKTOK_PRODUCTION_RECOVERY.recoveryCpuMs,
      larkRequestTimeoutMs: TIKTOK_PRODUCTION_RECOVERY.recoveryLarkRequestTimeoutMs,
      larkMaxAttempts: TIKTOK_PRODUCTION_RECOVERY.recoveryLarkMaxAttempts,
    },
    openTikTokDlqCount: 1,
    mutationCount: 0,
    workerDeployCount: 0,
    queueSendCount: 0,
    d1WriteCount: 0,
    larkWriteCount: 0,
  });

  await mkdir(dirname(EVIDENCE_FILE), { recursive: true });
  await writeFile(EVIDENCE_FILE, `${JSON.stringify(sanitize(evidence), null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(sanitize(evidence), null, 2));
}

function readDlqById({ wrangler, production, dlqId }) {
  const rows = queryD1({
    wrangler,
    production,
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

function queryD1({ wrangler, production, sql }) {
  const result = run(wrangler, [
    'd1', 'execute', 'MKT_STATE_DB',
    '--remote',
    '--config', production.configPath,
    '--cwd', production.worktree,
    '--command', sql,
    '--json',
  ], { cwd: production.worktree });
  return extractD1Rows(result.stdout);
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
      // Ignore non-Production worktrees and worktrees without the local config.
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

  const candidate = candidates[0];
  return Object.freeze({
    repositoryRoot,
    ...candidate,
    summary: Object.freeze({
      workerName: readJsoncScalar(candidate.configText, 'name'),
      environment: readJsoncScalar(candidate.configText, 'MKT_ENV'),
      customerProfile: readJsoncScalar(candidate.configText, 'MKT_CUSTOMER_PROFILE'),
      workersDev: readJsoncScalar(candidate.configText, 'workers_dev'),
      tiktokEnabled: readJsoncScalar(candidate.configText, 'MKT_CONNECTOR_TIKTOK_ENABLED'),
      productionUatEnabled: readJsoncScalar(candidate.configText, 'MKT_PRODUCTION_CONNECTOR_UAT_ENABLED'),
      dlqRedriveEnabled: readJsoncScalar(candidate.configText, 'MKT_DLQ_REDRIVE_ENABLED'),
      tiktokScheduleEnabled: readJsoncScalar(candidate.configText, 'MKT_SCHEDULE_TIKTOK_ENABLED'),
      notificationRuntimeEnabled: readJsoncScalar(candidate.configText, 'MKT_NOTIFICATION_RUNTIME_ENABLED'),
    }),
  });
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

function sqlText(value) {
  return String(value).replaceAll("'", "''");
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|authorization|credential/iu.test(key)) output[key] = '[REDACTED]';
    else output[key] = sanitize(item);
  }
  return output;
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'TikTokProductionUatRecoveryDiagnosisError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
