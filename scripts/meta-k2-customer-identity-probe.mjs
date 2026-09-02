#!/usr/bin/env node

import { execFile, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
import { readWranglerScalarVars } from './lib/wrangler-jsonc-vars.js';

const CONFIRMATION = 'PROBE_EXACT_CUSTOMER_META_K2_IDENTITY_ONLY';
const ACCOUNT_ID = '154f6bf72740d29d7453cec7fb800d32';
const DATABASE_ID = 'f03ab092-a1aa-4478-8ba2-c20d7b54851f';
const CONFIG_PATH = resolve(process.env.MKT_CUSTOMER_WRANGLER_CONFIG ?? '.customer-youtube-uat.wrangler.jsonc');
const PROFILE = 'chemistry-k-prod';
const CURSOR_KEY = 'chemistry_k:meta_ads:chemistry_k:scheduled_end_to_end_chemistry_k2';
const SOURCE_PHASE = 'meta_end_to_end_source_staging_v1';
const MAX_CANDIDATES = 16;
const EXPECTED_MODE_INVALID = 'META_K2_LOCAL_LARK_MODE_INVALID';
const TARGET_MISMATCH = 'META_K2_LOCAL_LARK_TARGET_MISMATCH';
const execFileAsync = promisify(execFile);

async function main() {
  if (process.env.CONFIRM_META_K2_CUSTOMER_IDENTITY_PROBE !== CONFIRMATION) {
    throw probeError('Execution confirmation is required', 'META_K2_IDENTITY_PROBE_CONFIRMATION_REQUIRED');
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

  const projectionUrl = requireHttpsUrl(
    process.env.MKT_META_K2_LARK_PROJECTION_URL,
    'MKT_META_K2_LARK_PROJECTION_URL',
  );
  const tokenPath = requireText(
    process.env.MKT_META_K2_LARK_PROJECTION_TOKEN_FILE,
    'MKT_META_K2_LARK_PROJECTION_TOKEN_FILE',
  );
  const token = String(await readFile(resolve(tokenPath), 'utf8')).trim();
  if (token.length < 32) {
    throw probeError('Projection token file is invalid', 'META_K2_IDENTITY_PROBE_TOKEN_INVALID');
  }

  const candidates = await readIdentityCandidates({
    runtimeEnv,
    databaseName: binding.database_name,
  });
  if (candidates.length === 0) {
    throw probeError('No retained K2 source Work candidates were found', 'META_K2_IDENTITY_PROBE_CANDIDATES_ABSENT');
  }

  let closestMismatchField = null;
  for (const row of candidates) {
    const operation = operationFromCandidate(row);
    if (!operation) continue;
    const result = await probeCandidate({ projectionUrl, token, operation });
    if (result.kind === 'exact') {
      console.log(JSON.stringify({
        ok: true,
        status: 'CUSTOMER_META_K2_IDENTITY_EXACT',
        proofCode: EXPECTED_MODE_INVALID,
        checkedFields: ['operationId', 'workKey', 'generation'],
        candidatesChecked: result.candidatesChecked ?? undefined,
        exactTargetState: {
          sourceComplete: Number(row.complete) === 1
            && Number(row.processed_items) === Number(row.expected_items),
          terminal: row.lifecycle_status === 'terminal',
          retryExhausted: row.terminal_reason === 'QUEUE_RETRY_EXHAUSTED',
          currentFence: Number(row.is_current_fence) === 1,
          unlocked: Number(row.active_lock_count) === 0,
        },
        sourceUnitPayloadReads: 0,
        providerReads: 0,
        d1Writes: 0,
        larkWrites: 0,
        queueSends: 0,
      }, null, 2));
      return;
    }
    if (result.kind === 'mismatch' && result.fieldName !== 'operationId') {
      closestMismatchField = result.fieldName;
    }
  }

  throw probeError('Preview exact K2 identity was not found among retained D1 candidates', 'META_K2_IDENTITY_PROBE_TARGET_NOT_FOUND', {
    candidateCount: candidates.length,
    closestMismatchField,
  });
}

async function readIdentityCandidates(input) {
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

function operationFromCandidate(row) {
  const workKey = typeof row?.work_key === 'string' ? row.work_key : '';
  const operationId = workKey.split(':').at(-1);
  const generation = Number(row?.generation);
  if (!operationId || !/(?:^|-)\d{8}$/u.test(operationId)) return null;
  if (!Number.isSafeInteger(generation) || generation < Date.UTC(2000, 0, 1)) return null;
  return Object.freeze({ operationId, workKey, generation });
}

async function probeCandidate(input) {
  const response = await fetch(input.projectionUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.token}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      mode: 'identity_probe_only',
      operation: input.operation,
    }),
  });
  const payload = await response.json().catch(() => ({}));

  if (response.status === 400 && payload?.code === EXPECTED_MODE_INVALID) {
    return Object.freeze({ kind: 'exact' });
  }
  if (response.status === 400 && payload?.code === TARGET_MISMATCH) {
    return Object.freeze({
      kind: 'mismatch',
      fieldName: safeFieldName(payload?.diagnostic?.fieldName),
    });
  }
  throw probeError('Customer Preview identity probe returned an unexpected response', payload?.code ?? 'META_K2_IDENTITY_PROBE_HTTP_FAILED', {
    status: response.status,
  });
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
    throw probeError('Wrangler D1 read reported failure', 'META_K2_IDENTITY_PROBE_D1_READ_FAILED');
  }
  return blocks[0].results;
}

function parseWranglerJsonSuffix(output) {
  const text = String(output ?? '').trim();
  const starts = [text.lastIndexOf('\n['), text.lastIndexOf('\n{')]
    .map((index) => (index < 0 ? index : index + 1))
    .filter((index) => index >= 0);
  const start = starts.length > 0 ? Math.max(...starts) : (text.startsWith('[') || text.startsWith('{') ? 0 : -1);
  if (start < 0) throw probeError('Wrangler D1 output has no JSON result', 'META_K2_IDENTITY_PROBE_D1_JSON_INVALID');
  try {
    return JSON.parse(text.slice(start));
  } catch {
    throw probeError('Wrangler D1 output JSON is invalid', 'META_K2_IDENTITY_PROBE_D1_JSON_INVALID');
  }
}

function assertReviewedMain() {
  const branch = git(['branch', '--show-current']);
  const head = git(['rev-parse', 'HEAD']);
  const origin = git(['rev-parse', 'origin/main']);
  const dirty = git(['status', '--porcelain', '--untracked-files=no'], false);
  if (branch !== 'main' || head !== origin || dirty.trim() !== '') {
    throw probeError('Exact reviewed clean main is required', 'META_K2_IDENTITY_PROBE_REPOSITORY_INVALID', {
      branch,
      clean: dirty.trim() === '',
    });
  }
}

function git(args, required = true) {
  const result = spawnSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw probeError('git preflight failed', 'META_K2_IDENTITY_PROBE_GIT_FAILED');
  const value = String(result.stdout ?? '').trim();
  if (required && !value) throw probeError('git preflight returned empty output', 'META_K2_IDENTITY_PROBE_GIT_FAILED');
  return value;
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) throw probeError(`${fieldName} does not match Customer Production`, 'META_K2_IDENTITY_PROBE_TARGET_INVALID');
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw probeError(`${fieldName} is required`, 'META_K2_IDENTITY_PROBE_INPUT_INVALID');
  }
  return value.trim();
}

function requireHttpsUrl(value, fieldName) {
  const text = requireText(value, fieldName);
  let url;
  try {
    url = new URL(text);
  } catch {
    throw probeError(`${fieldName} is invalid`, 'META_K2_IDENTITY_PROBE_INPUT_INVALID');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw probeError(`${fieldName} must be a clean HTTPS URL`, 'META_K2_IDENTITY_PROBE_INPUT_INVALID');
  }
  return url.toString();
}

function safeFieldName(value) {
  return ['operationId', 'workKey', 'generation'].includes(value) ? value : null;
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
    scope: 'retained Customer Meta K2 identity candidates only',
    maxCandidates: MAX_CANDIDATES,
    sourceUnitPayloadReads: 0,
    providerReads: 0,
    d1Writes: 0,
    larkWrites: 0,
    queueSends: 0,
  }, null, 2));
} else {
  await main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      code: error?.code ?? 'META_K2_IDENTITY_PROBE_FAILED',
      message: error?.message ?? String(error),
      details: sanitize(error?.details ?? {}),
    }, null, 2));
    process.exitCode = 1;
  });
}
