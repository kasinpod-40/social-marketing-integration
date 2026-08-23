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
  validateIdempotencyDurableProof,
} from './lib/tiktok-production-uat-resume-contract.js';

const LIVE_EVIDENCE_FILE = resolve(
  process.env.TIKTOK_PRODUCTION_RECOVERY_LIVE_EVIDENCE
    ?? 'outputs/customer-production/tiktok-uat-live-resume.json',
);
const OUTPUT_FILE = resolve(
  process.env.TIKTOK_PRODUCTION_LARK_READBACK_EVIDENCE
    ?? 'outputs/customer-production/tiktok-uat-lark-readback-proof.json',
);

try {
  const args = new Set(process.argv.slice(2));
  if (!args.has('--execute')) {
    console.log(JSON.stringify({
      ok: true,
      executed: false,
      mode: 'read-only-lark-three-table-proof',
      liveEvidenceFile: LIVE_EVIDENCE_FILE,
      outputFile: OUTPUT_FILE,
      note: 'Reads only D1 durable phase evidence produced by the successful idempotency generation. No Cloudflare, Queue, D1, Lark, or Git mutation is performed.',
    }, null, 2));
  } else {
    const evidence = await proveLarkReadback();
    await persistEvidence(evidence);
    console.log(JSON.stringify(evidence, null, 2));
  }
} catch (error) {
  const failure = {
    ok: false,
    mode: 'read-only-lark-three-table-proof',
    capturedAt: new Date().toISOString(),
    code: error?.code ?? 'TIKTOK_PRODUCTION_LARK_READBACK_PROOF_FAILED',
    message: error?.message ?? String(error),
    details: sanitize(error?.details ?? {}),
  };
  try { await persistEvidence(failure); } catch { /* best effort */ }
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
}

async function proveLarkReadback() {
  const liveEvidence = parseJson(
    await readFile(LIVE_EVIDENCE_FILE, 'utf8'),
    'TikTok Production live recovery evidence',
  );
  if (liveEvidence?.ok !== true) {
    throw proofError('Live recovery evidence is not successful', 'TIKTOK_PRODUCTION_LIVE_EVIDENCE_NOT_SUCCESS', {
      liveEvidenceOk: liveEvidence?.ok ?? null,
    });
  }
  if (liveEvidence?.restore?.ok !== true || liveEvidence?.restore?.state !== 'reviewed_dark') {
    throw proofError('Live recovery evidence does not prove reviewed-dark restore', 'TIKTOK_PRODUCTION_DARK_RESTORE_NOT_PROVEN', {
      restore: liveEvidence?.restore ?? null,
    });
  }
  if (liveEvidence?.postChecks?.openTikTokDlqCount !== 0) {
    throw proofError('Live recovery evidence does not prove zero open TikTok DLQs', 'TIKTOK_PRODUCTION_OPEN_DLQ_REMAINS', {
      openTikTokDlqCount: liveEvidence?.postChecks?.openTikTokDlqCount ?? null,
    });
  }
  if (liveEvidence?.idempotency?.syncRun?.status !== 'success') {
    throw proofError('Live recovery evidence does not contain a successful idempotency sync run', 'TIKTOK_PRODUCTION_IDEMPOTENCY_SUCCESS_MISSING');
  }

  const requestedAtIso = requireText(liveEvidence?.idempotency?.requestedAt, 'idempotency.requestedAt');
  const generation = Date.parse(requestedAtIso);
  if (!Number.isSafeInteger(generation) || generation <= 0) {
    throw proofError('Idempotency requestedAt is not a valid generation timestamp', 'TIKTOK_PRODUCTION_IDEMPOTENCY_GENERATION_INVALID', {
      requestedAt: requestedAtIso,
    });
  }

  const production = await discoverProductionWorktree();
  assertDarkProductionConfig(production.configText);
  const wrangler = resolve(production.repositoryRoot, 'node_modules/.bin/wrangler');
  await requireReadable(wrangler);

  const workRows = queryD1({
    wrangler,
    production,
    sql: [
      'SELECT work_key, cursor_key, work_type, generation, requested_at, lifecycle_status,',
      'completed_at, completion_json, created_at, updated_at',
      'FROM sync_work_runs',
      `WHERE work_type='${TIKTOK_PRODUCTION_RESUME.workType}' AND generation=${generation}`,
      'ORDER BY updated_at DESC;',
    ].join(' '),
  });
  if (workRows.length !== 1) {
    throw proofError('Expected exactly one durable TikTok work row for the idempotency generation', 'TIKTOK_PRODUCTION_IDEMPOTENCY_WORK_CARDINALITY_MISMATCH', {
      generation,
      count: workRows.length,
      workKeys: workRows.map((row) => row.work_key ?? null),
    });
  }
  const workRow = workRows[0];
  const workKey = requireText(workRow.work_key, 'work_key');

  const phaseRows = queryD1({
    wrangler,
    production,
    sql: [
      'SELECT work_key, phase, state_json, expected_items, processed_items,',
      'pages_processed, chunks_processed, complete, created_at, updated_at',
      'FROM sync_work_phases',
      `WHERE work_key='${sqlText(workKey)}'`,
      `AND phase IN ('${TIKTOK_PRODUCTION_RESUME.sourcePhase}','${TIKTOK_PRODUCTION_RESUME.businessWritePhase}')`,
      'ORDER BY phase ASC;',
    ].join(' '),
  });
  const sourcePhase = phaseRows.find((row) => row.phase === TIKTOK_PRODUCTION_RESUME.sourcePhase) ?? null;
  const businessWritePhase = phaseRows.find((row) => row.phase === TIKTOK_PRODUCTION_RESUME.businessWritePhase) ?? null;
  const proof = validateIdempotencyDurableProof({
    expectedGeneration: generation,
    workRow,
    sourcePhase,
    businessWritePhase,
  });

  const result = Object.freeze({
    ok: true,
    mode: 'read-only-lark-three-table-proof',
    capturedAt: new Date().toISOString(),
    reviewedRuntime: TIKTOK_PRODUCTION_RECOVERY.reviewedMain,
    liveEvidenceFile: LIVE_EVIDENCE_FILE,
    production: Object.freeze({
      worktree: production.worktree,
      workerName: readJsoncScalar(production.configText, 'name'),
      environment: readJsoncScalar(production.configText, 'MKT_ENV'),
      customerProfile: readJsoncScalar(production.configText, 'MKT_CUSTOMER_PROFILE'),
      configState: 'dark',
    }),
    idempotency: Object.freeze({
      syncRunId: liveEvidence.idempotency.syncRun.syncRunId,
      requestedAt: requestedAtIso,
      generation,
      workKey: proof.workKey,
      sourceRecords: proof.sourceRecords,
      sourcePages: proof.sourcePages,
    }),
    larkReadback: Object.freeze({
      verified: proof.larkReadbackVerified,
      method: 'fresh_full_sync_stable_key_reads_plus_durable_three-table_zero-write-proof',
      tables: Object.freeze({
        MKT_Accounts: proof.tables.account,
        MKT_Content: proof.tables.content,
        MKT_Content_Daily: proof.tables.contentDaily,
      }),
      businessWrites: proof.businessWrites,
    }),
    openTikTokDlqCount: 0,
    darkRestoreVerifiedByLiveEvidence: true,
    mutationCount: 0,
    d1WriteCount: 0,
    queueSendCount: 0,
    larkWriteCount: 0,
    workerDeployCount: 0,
  });
  return result;
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
    throw proofError('Expected exactly one isolated customer Production worktree', 'TIKTOK_PRODUCTION_WORKTREE_CARDINALITY_MISMATCH', {
      repositoryRoot,
      productionCandidateCount: candidates.length,
      productionCandidatePaths: candidates.map((candidate) => candidate.worktree),
    });
  }
  return Object.freeze({ repositoryRoot, ...candidates[0] });
}

function queryD1({ wrangler, production, sql }) {
  const args = [
    'd1', 'execute', 'MKT_STATE_DB',
    '--remote',
    '--config', production.configPath,
    '--cwd', production.worktree,
    '--command', sql,
    '--json',
  ];
  const profile = normalizeOptionalText(process.env.MKT_WRANGLER_PROFILE);
  if (profile) args.splice(3, 0, '--profile', profile);
  return extractD1Rows(run(wrangler, args, { cwd: production.worktree }).stdout);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw proofError(`Command failed: ${command} ${args.join(' ')}`, 'TIKTOK_PRODUCTION_LARK_READBACK_COMMAND_FAILED', {
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
    throw proofError('Required path is not readable', 'TIKTOK_PRODUCTION_LARK_READBACK_PATH_UNREADABLE', {
      path,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function parseJson(value, label) {
  try { return JSON.parse(String(value ?? '')); } catch (cause) {
    throw proofError(`${label} is not valid JSON`, 'TIKTOK_PRODUCTION_LARK_READBACK_JSON_INVALID', {
      label,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw proofError(`${fieldName} is required`, 'TIKTOK_PRODUCTION_LARK_READBACK_CONTRACT_MISMATCH', { fieldName, value });
  }
  return value.trim();
}

function normalizeOptionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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

async function persistEvidence(value) {
  await mkdir(dirname(OUTPUT_FILE), { recursive: true });
  await writeFile(OUTPUT_FILE, `${JSON.stringify(sanitize(value), null, 2)}\n`, 'utf8');
}

function proofError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'TikTokProductionLarkReadbackProofError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
