#!/usr/bin/env node

import { execFile, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
import { readWranglerScalarVars } from './lib/wrangler-jsonc-vars.js';

const CONFIRMATION = 'PROBE_EXACT_CUSTOMER_META_K2_RETAINED_STATE_ONLY';
const ACCOUNT_ID = '154f6bf72740d29d7453cec7fb800d32';
const DATABASE_ID = 'f03ab092-a1aa-4478-8ba2-c20d7b54851f';
const CONFIG_PATH = resolve(process.env.MKT_CUSTOMER_WRANGLER_CONFIG ?? '.customer-youtube-uat.wrangler.jsonc');
const PROFILE = 'chemistry-k-prod';
const CURSOR_KEY = 'chemistry_k:meta_ads:chemistry_k:scheduled_end_to_end_chemistry_k2';
const SOURCE_PHASE = 'meta_end_to_end_source_staging_v1';
const EXACT_OPERATION_DATE = '20260827';
const EXACT_SOURCE_ITEMS = 194;
const MAX_CANDIDATES = 32;
const execFileAsync = promisify(execFile);

async function main() {
  if (process.env.CONFIRM_META_K2_CUSTOMER_RETAINED_STATE_PROBE !== CONFIRMATION) {
    throw probeError('Execution confirmation is required', 'META_K2_RETAINED_STATE_PROBE_CONFIRMATION_REQUIRED');
  }
  assertReviewedMain();

  const configText = await readFile(CONFIG_PATH, 'utf8');
  const config = parseJsoncObject(configText);
  const binding = (config.d1_databases ?? []).find((entry) => entry.binding === 'MKT_STATE_DB');
  requireExact(config.account_id, ACCOUNT_ID, 'account_id');
  requireExact(binding?.database_id, DATABASE_ID, 'database_id');

  const fileEnv = await readDevVars(resolve(process.env.DEV_VARS_FILE ?? '.dev.vars'));
  const runtimeEnv = { ...process.env, ...fileEnv, ...readWranglerScalarVars(configText) };
  requireExact(runtimeEnv.MKT_CUSTOMER_PROFILE, 'chemistry_k', 'MKT_CUSTOMER_PROFILE');
  requireExact(runtimeEnv.LARK_APP_ID, 'cli_aaf9b6ddfcf99ed1', 'LARK_APP_ID');

  const candidates = await readRetainedCandidates({
    runtimeEnv,
    databaseName: binding.database_name,
  });
  const exact = candidates.filter(isExactRetainedK2Candidate);
  if (exact.length !== 1) {
    throw probeError(
      'Exact retained 20260827 K2 source-complete Work is not unique',
      'META_K2_RETAINED_STATE_PROBE_TARGET_NOT_UNIQUE',
      {
        candidateCount: candidates.length,
        exactDateCandidateCount: candidates.filter(isExactOperationDateCandidate).length,
        exactSourceCompleteCandidateCount: exact.length,
      },
    );
  }

  const row = exact[0];
  console.log(JSON.stringify({
    ok: true,
    status: 'CUSTOMER_META_K2_20260827_RETAINED_STATE',
    evidence: {
      operationDate: EXACT_OPERATION_DATE,
      sourceExpectedItems: EXACT_SOURCE_ITEMS,
      sourceProcessedItems: EXACT_SOURCE_ITEMS,
      sourceComplete: true,
    },
    exactTargetState: {
      terminal: row.lifecycle_status === 'terminal',
      retryExhausted: row.terminal_reason === 'QUEUE_RETRY_EXHAUSTED',
      currentFence: Number(row.is_current_fence) === 1,
      unlocked: Number(row.active_lock_count) === 0,
    },
    sourceUnitPayloadReads: 0,
    previewRequests: 0,
    providerReads: 0,
    d1Writes: 0,
    larkWrites: 0,
    queueSends: 0,
  }, null, 2));
}

async function readRetainedCandidates(input) {
  const sql = `
    SELECT r.work_key, r.generation, r.lifecycle_status, r.terminal_reason,
           p.expected_items, p.processed_items, p.complete,
           CASE WHEN f.work_key=r.work_key AND f.generation=r.generation THEN 1 ELSE 0 END AS is_current_fence,
           (
             SELECT COUNT(*) FROM sync_locks AS lock
             WHERE lock.lock_key=r.cursor_key AND lock.expires_at>unixepoch()*1000
           ) AS active_lock_count
    FROM sync_work_runs AS r
    JOIN sync_work_phases AS p ON p.work_key=r.work_key AND p.phase='${SOURCE_PHASE}'
    LEFT JOIN sync_generation_fences AS f ON f.cursor_key=r.cursor_key
    WHERE r.cursor_key='${CURSOR_KEY}'
    ORDER BY r.generation DESC
    LIMIT ${MAX_CANDIDATES}
  `;
  return executeReadOnlyD1({ ...input, sql });
}

function isExactOperationDateCandidate(row) {
  const operation = operationFromCandidate(row);
  return operation?.operationId.endsWith(EXACT_OPERATION_DATE) === true;
}

function isExactRetainedK2Candidate(row) {
  return isExactOperationDateCandidate(row)
    && Number(row?.expected_items) === EXACT_SOURCE_ITEMS
    && Number(row?.processed_items) === EXACT_SOURCE_ITEMS
    && Number(row?.complete) === 1;
}

function operationFromCandidate(row) {
  const workKey = typeof row?.work_key === 'string' ? row.work_key : '';
  const operationId = workKey.split(':').at(-1);
  const generation = Number(row?.generation);
  if (!operationId || !/(?:^|-)\d{8}$/u.test(operationId)) return null;
  if (!Number.isSafeInteger(generation) || generation < Date.UTC(2000, 0, 1)) return null;
  return Object.freeze({ operationId, generation });
}

async function executeReadOnlyD1(input) {
  const result = await execFileAsync('npx', [
    'wrangler', 'd1', 'execute', input.databaseName,
    '--remote', '--config', CONFIG_PATH, '--profile', PROFILE,
    '--command', input.sql, '--json',
  ], {
    cwd: process.cwd(),
    env: input.runtimeEnv,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const parsed = parseWranglerJsonSuffix(result.stdout);
  const blocks = Array.isArray(parsed) ? parsed : [parsed];
  if (blocks.length !== 1 || blocks[0]?.success === false || !Array.isArray(blocks[0]?.results)) {
    throw probeError('Wrangler D1 read reported failure', 'META_K2_RETAINED_STATE_PROBE_D1_READ_FAILED');
  }
  return blocks[0].results;
}

function parseWranglerJsonSuffix(output) {
  const text = String(output ?? '').trim();
  const starts = [text.lastIndexOf('\n['), text.lastIndexOf('\n{')]
    .map((index) => (index < 0 ? index : index + 1))
    .filter((index) => index >= 0);
  const start = starts.length > 0 ? Math.max(...starts) : (text.startsWith('[') || text.startsWith('{') ? 0 : -1);
  if (start < 0) throw probeError('Wrangler D1 output has no JSON result', 'META_K2_RETAINED_STATE_PROBE_D1_JSON_INVALID');
  try {
    return JSON.parse(text.slice(start));
  } catch {
    throw probeError('Wrangler D1 output JSON is invalid', 'META_K2_RETAINED_STATE_PROBE_D1_JSON_INVALID');
  }
}

function assertReviewedMain() {
  const branch = git(['branch', '--show-current']);
  const head = git(['rev-parse', 'HEAD']);
  const origin = git(['rev-parse', 'origin/main']);
  const dirty = git(['status', '--porcelain', '--untracked-files=no'], false);
  if (branch !== 'main' || head !== origin || dirty.trim() !== '') {
    throw probeError('Exact reviewed clean main is required', 'META_K2_RETAINED_STATE_PROBE_REPOSITORY_INVALID', {
      branch,
      clean: dirty.trim() === '',
    });
  }
}

function git(args, required = true) {
  const result = spawnSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw probeError('git preflight failed', 'META_K2_RETAINED_STATE_PROBE_GIT_FAILED');
  const value = String(result.stdout ?? '').trim();
  if (required && !value) throw probeError('git preflight returned empty output', 'META_K2_RETAINED_STATE_PROBE_GIT_FAILED');
  return value;
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw probeError(`${fieldName} does not match Customer Production`, 'META_K2_RETAINED_STATE_PROBE_TARGET_INVALID');
  }
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/token|secret|authorization|workKey|operationId|generation/iu.test(key))
    .map(([key, nested]) => [key, sanitize(nested)]));
}

function probeError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

if (!process.argv.includes('--execute')) {
  console.log(JSON.stringify({
    ok: true,
    planOnly: true,
    scope: 'exact retained Customer Meta K2 20260827 state only',
    sourceExpectedItems: EXACT_SOURCE_ITEMS,
    sourceUnitPayloadReads: 0,
    previewRequests: 0,
    providerReads: 0,
    d1Writes: 0,
    larkWrites: 0,
    queueSends: 0,
  }, null, 2));
} else {
  await main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      code: error?.code ?? 'META_K2_RETAINED_STATE_PROBE_FAILED',
      message: error?.message ?? String(error),
      details: sanitize(error?.details ?? {}),
    }, null, 2));
    process.exitCode = 1;
  });
}
