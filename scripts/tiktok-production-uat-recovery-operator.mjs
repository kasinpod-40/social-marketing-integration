import { spawnSync } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const EXPECTED_MAIN = '673431ad618a077f039a3844355ef36ff9a231ba';
const EXPECTED_JOB_TYPE = 'tiktok.creator.native.sync';
const EXPECTED_TRIGGER = 'production_connector_uat';
const EXPECTED_METRIC_DATE = '2026-08-22';
const EXPECTED_DLQ_HINT = 'f7081';
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
    details: error?.details ?? {},
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
      expectedMain: EXPECTED_MAIN,
      note: 'No Cloudflare, D1, Queue, Worker, Lark, or Git mutation was performed.',
    }, null, 2));
    return;
  }

  const production = await discoverProductionWorktree();
  assertDarkProductionConfig(production.configText);

  const wrangler = resolve(process.cwd(), 'node_modules/.bin/wrangler');
  await requireReadable(wrangler);

  const sql = [
    'SELECT dlq_id, message_id, queue_name, job_type, schema_version,',
    '       payload_json, error_code, retry_count, status, created_at, updated_at,',
    '       redrive_requested_at, redrive_reference, redriven_at',
    'FROM dead_letter_jobs',
    `WHERE status='open' AND job_type='${EXPECTED_JOB_TYPE}'`,
    'ORDER BY created_at DESC;',
  ].join(' ');

  const query = run(wrangler, [
    'd1', 'execute', 'MKT_STATE_DB',
    '--remote',
    '--config', production.configPath,
    '--cwd', production.worktree,
    '--command', sql,
    '--json',
  ], { cwd: production.worktree });

  const rows = extractD1Rows(query.stdout);
  if (rows.length !== 1) {
    throw operatorError('Expected exactly one open TikTok Production UAT dead-letter row', 'TIKTOK_PRODUCTION_UAT_DLQ_CARDINALITY_MISMATCH', {
      count: rows.length,
      candidates: rows.map((row) => ({
        dlqId: row.dlq_id ?? null,
        messageId: row.message_id ?? null,
        status: row.status ?? null,
        jobType: row.job_type ?? null,
      })),
    });
  }

  const row = rows[0];
  const payloadContainer = parseJson(row.payload_json, 'dead_letter_jobs.payload_json');
  const payload = payloadContainer?.body && typeof payloadContainer.body === 'object'
    ? payloadContainer.body
    : payloadContainer;

  assertEqual(row.job_type, EXPECTED_JOB_TYPE, 'dead-letter job type');
  assertEqual(row.status, 'open', 'dead-letter status');
  assertEqual(payload?.type, EXPECTED_JOB_TYPE, 'payload type');
  assertEqual(payload?.trigger, EXPECTED_TRIGGER, 'payload trigger');
  assertEqual(payload?.metricDate, EXPECTED_METRIC_DATE, 'payload metricDate');

  const dlqId = requireText(row.dlq_id, 'dlq_id');
  const messageId = String(row.message_id ?? '');
  if (!dlqId.includes(EXPECTED_DLQ_HINT) && !messageId.includes(EXPECTED_DLQ_HINT)) {
    throw operatorError('The only open TikTok DLQ row does not match the retained terminal:f7081... evidence', 'TIKTOK_PRODUCTION_UAT_DLQ_HINT_MISMATCH', {
      dlqId,
      messageId,
      expectedHint: EXPECTED_DLQ_HINT,
    });
  }

  const evidence = Object.freeze({
    ok: true,
    mode: 'read-only-diagnosis',
    capturedAt: new Date().toISOString(),
    expectedMain: EXPECTED_MAIN,
    productionWorktree: production.worktree,
    productionConfigPath: production.configPath,
    productionConfig: production.summary,
    retainedDlq: {
      dlqId,
      messageId: row.message_id ?? null,
      queueName: row.queue_name ?? null,
      jobType: row.job_type,
      schemaVersion: row.schema_version ?? null,
      trigger: payload.trigger,
      metricDate: payload.metricDate,
      requestedAt: payload.requestedAt ?? null,
      status: row.status,
      retryCount: row.retry_count ?? null,
      errorCode: row.error_code ?? null,
      redriveRequestedAt: row.redrive_requested_at ?? null,
      redriveReference: row.redrive_reference ?? null,
      redrivenAt: row.redriven_at ?? null,
    },
    mutationCount: 0,
    workerDeployCount: 0,
    queueSendCount: 0,
    d1WriteCount: 0,
    larkWriteCount: 0,
  });

  await mkdir(dirname(EVIDENCE_FILE), { recursive: true });
  await writeFile(EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
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
    let configText;
    try {
      configText = await readFile(configPath, 'utf8');
    } catch {
      continue;
    }
    const env = readJsoncScalar(configText, 'MKT_ENV');
    const profile = readJsoncScalar(configText, 'MKT_CUSTOMER_PROFILE');
    const workerName = readJsoncScalar(configText, 'name');
    if (env === 'production' && profile === 'chemistry_k' && workerName === 'social-mkt-sync-worker') {
      candidates.push({ worktree, configPath, configText });
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
    ...candidate,
    summary: Object.freeze({
      workerName: readJsoncScalar(candidate.configText, 'name'),
      environment: readJsoncScalar(candidate.configText, 'MKT_ENV'),
      customerProfile: readJsoncScalar(candidate.configText, 'MKT_CUSTOMER_PROFILE'),
      workersDev: readJsoncScalar(candidate.configText, 'workers_dev'),
      tiktokEnabled: readJsoncScalar(candidate.configText, 'MKT_CONNECTOR_TIKTOK_ENABLED'),
      productionUatEnabled: readJsoncScalar(candidate.configText, 'MKT_PRODUCTION_CONNECTOR_UAT_ENABLED'),
      productionUatConnector: readJsoncScalar(candidate.configText, 'MKT_PRODUCTION_CONNECTOR_UAT_CONNECTOR'),
      dlqRedriveEnabled: readJsoncScalar(candidate.configText, 'MKT_DLQ_REDRIVE_ENABLED'),
      tiktokScheduleEnabled: readJsoncScalar(candidate.configText, 'MKT_SCHEDULE_TIKTOK_ENABLED'),
      notificationRuntimeEnabled: readJsoncScalar(candidate.configText, 'MKT_NOTIFICATION_RUNTIME_ENABLED'),
    }),
  });
}

function assertDarkProductionConfig(text) {
  assertEqual(readJsoncScalar(text, 'name'), 'social-mkt-sync-worker', 'Worker name');
  assertEqual(readJsoncScalar(text, 'MKT_ENV'), 'production', 'MKT_ENV');
  assertEqual(readJsoncScalar(text, 'MKT_CUSTOMER_PROFILE'), 'chemistry_k', 'MKT_CUSTOMER_PROFILE');
  assertBooleanFalse(text, 'MKT_CONNECTOR_TIKTOK_ENABLED');
  assertBooleanFalse(text, 'MKT_PRODUCTION_CONNECTOR_UAT_ENABLED');
  assertBooleanFalse(text, 'MKT_DLQ_REDRIVE_ENABLED');
  assertBooleanFalse(text, 'MKT_SCHEDULE_TIKTOK_ENABLED');
  assertBooleanFalse(text, 'MKT_NOTIFICATION_RUNTIME_ENABLED');
  return true;
}

function assertBooleanFalse(text, name) {
  const value = readJsoncScalar(text, name);
  if (!(value === false || value === 'false')) {
    throw operatorError(`${name} must be false before Production recovery`, 'TIKTOK_PRODUCTION_NOT_DARK', { name, value });
  }
}

function readJsoncScalar(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const expression = new RegExp(`(?:"${escaped}"|\\b${escaped}\\b)\\s*:\\s*("(?:[^"\\\\]|\\\\.)*"|true|false|null|-?\\d+(?:\\.\\d+)?)`, 'u');
  const match = String(text ?? '').match(expression);
  if (!match) return null;
  const token = match[1];
  if (token.startsWith('"')) return JSON.parse(token);
  if (token === 'true') return true;
  if (token === 'false') return false;
  if (token === 'null') return null;
  return Number(token);
}

function extractD1Rows(output) {
  const value = parseJson(output, 'wrangler d1 --json output');
  const blocks = Array.isArray(value) ? value : [value];
  const rows = [];
  for (const block of blocks) {
    if (Array.isArray(block?.results)) rows.push(...block.results);
    if (Array.isArray(block?.result)) {
      for (const nested of block.result) {
        if (Array.isArray(nested?.results)) rows.push(...nested.results);
      }
    }
  }
  return rows;
}

function parseJson(value, fieldName) {
  try {
    return JSON.parse(String(value ?? ''));
  } catch (cause) {
    throw operatorError(`${fieldName} is not valid JSON`, 'TIKTOK_PRODUCTION_RECOVERY_JSON_INVALID', {
      fieldName,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
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

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw operatorError(`${label} mismatch`, 'TIKTOK_PRODUCTION_RECOVERY_CONTRACT_MISMATCH', { label, expected, actual });
  }
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw operatorError(`${fieldName} is required`, 'TIKTOK_PRODUCTION_RECOVERY_CONTRACT_MISMATCH', { fieldName, value });
  }
  return value.trim();
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
