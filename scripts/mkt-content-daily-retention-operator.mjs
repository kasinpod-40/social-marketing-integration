#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { readDevVars } from './lib/dev-vars.js';
import { planMktContentDailyRetention } from './lib/mkt-content-daily-retention.js';
import {
  assertDeferredPlatformDeleteScope,
  reconcileLatestLarkWithD1,
  summarizePlatforms,
} from './lib/mkt-content-daily-retention-operator.js';

export const CONFIRMATION = 'DELETE_EXACT_NON_FACEBOOK_MKT_CONTENT_DAILY_WITH_BACKUP';
const execFileAsync = promisify(execFile);
const BATCH_SIZE = 100;
const args = process.argv.slice(2);
const execute = args.includes('--execute');
const inspect = args.includes('--inspect');
const deferredPlatforms = args
  .filter((value) => value.startsWith('--defer-platform='))
  .map((value) => value.slice('--defer-platform='.length).trim().toLowerCase());
let stage = 'arguments';
let evidenceRoot = null;
let confirmedDeletes = 0;

try {
  assertArguments();
  const repositoryRoot = await resolveRepositoryRoot();
  if (execute) {
    assertConfirmation();
    await assertExactMain(repositoryRoot);
  }
  evidenceRoot = resolve(
    process.env.MKT_CONTENT_DAILY_RETENTION_EVIDENCE_DIR
      ?? '/private/tmp/social-mkt-content-daily-retention-deferred-facebook-20260815',
    `attempt-${new Date().toISOString().replaceAll(':', '-')}`,
  );
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });

  stage = 'environment';
  const devVarsPath = resolve(repositoryRoot, process.env.DEV_VARS_FILE ?? '.dev.vars');
  const fileEnv = await readDevVars(devVarsPath);
  const env = Object.freeze({ ...fileEnv, ...process.env });
  const client = createLarkBitableClientFromEnv(env);

  stage = 'lark-read';
  const tables = await client.listTables();
  const table = uniqueTable(tables, 'MKT_Content_Daily');
  const tableId = requireText(table.tableId, 'tableId');
  const protectedTikTokTable = uniqueTable(tables, 'RAW_TikTok_Creator_Videos');
  const protectedTikTokTableId = requireText(protectedTikTokTable.tableId, 'protectedTikTokTableId');
  const records = await client.listRecords({ tableId, includeRecordMetadata: false });
  const protectedTikTokRecords = await client.listRecords({
    tableId: protectedTikTokTableId,
    includeRecordMetadata: false,
  });
  const protectedTikTokVideoIds = extractTikTokVideoIds(protectedTikTokRecords);
  const protectedTikTokDigest = sha256(json([...protectedTikTokVideoIds].sort()));
  const plan = planMktContentDailyRetention({ records, deferredPlatforms });
  const protection = assertDeferredPlatformDeleteScope(plan, 'facebook');
  const beforeIds = new Set(records.map((record) => requireText(record.recordId ?? record.record_id, 'recordId')));
  const retainedIds = new Set(plan.retained.map((record) => requireText(record.recordId, 'retained.recordId')));
  const deleteIds = new Set(plan.deletes.map((record) => requireText(record.recordId, 'delete.recordId')));
  if (beforeIds.size !== retainedIds.size + deleteIds.size) throw operatorError(
    'Retention plan does not partition the current table exactly',
    'MKT_CONTENT_DAILY_PLAN_PARTITION_INVALID',
  );

  stage = 'd1-read';
  const d1 = await readD1Evidence(repositoryRoot);
  const unexpectedActive = d1.activeWork.filter((row) => !String(row.work_key).startsWith('meta_ads:'));
  if (unexpectedActive.length > 0 || d1.activeLocks.length > 0) throw operatorError(
    'An active writer could change MKT_Content_Daily during retention',
    'MKT_CONTENT_DAILY_ACTIVE_WRITER_DETECTED',
    { unexpectedActiveWork: unexpectedActive.length, activeLocks: d1.activeLocks.length },
  );
  const parity = reconcileLatestLarkWithD1({
    records,
    d1Rows: d1.latestRows,
    deferredPlatforms,
    requireMetricParity: false,
    sourceBackedExternalIdsByPlatform: { tiktok: protectedTikTokVideoIds },
    requiredExternalIdsByPlatform: groupDeleteAffectedExternalIds(plan.deletes),
  });

  stage = 'backup';
  const beforeEvidence = Object.freeze({
    contractVersion: plan.contractVersion,
    tableName: 'MKT_Content_Daily',
    records,
  });
  const candidatesEvidence = Object.freeze({
    contractVersion: plan.contractVersion,
    deferredPlatforms,
    deletes: plan.deletes,
  });
  const d1Evidence = Object.freeze({
    activeWork: d1.activeWork,
    activeLocks: d1.activeLocks,
    latestRows: d1.latestRows,
  });
  const beforeJson = json(beforeEvidence);
  const candidatesJson = json(candidatesEvidence);
  const d1Json = json(d1Evidence);
  await writePrivate(join(evidenceRoot, 'before.json'), beforeJson);
  await writePrivate(join(evidenceRoot, 'exact-delete-candidates.json'), candidatesJson);
  await writePrivate(join(evidenceRoot, 'd1-pre-delete-authority.json'), d1Json);

  const preview = summary({
    mode: execute ? 'execute_planned' : 'read_only_preview',
    plan,
    protection,
    parity,
    beforeJson,
    candidatesJson,
    d1Json,
    confirmedDeletes: 0,
    evidenceRoot,
  });
  await writePrivate(join(evidenceRoot, 'preview.json'), json(preview));
  process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);

  if (execute) {
    stage = 'exact-delete';
    confirmedDeletes = await deleteExactRecords({ client, tableId, recordIds: [...deleteIds] });
    if (confirmedDeletes !== deleteIds.size) throw operatorError(
      'Lark confirmed a different delete count than planned',
      'MKT_CONTENT_DAILY_DELETE_COUNT_MISMATCH',
      { planned: deleteIds.size, confirmed: confirmedDeletes },
    );

    stage = 'readback';
    const afterRecords = await client.listRecords({ tableId, includeRecordMetadata: false });
    const afterTables = await client.listTables();
    const afterProtectedTikTokTable = uniqueTable(afterTables, 'RAW_TikTok_Creator_Videos');
    if (requireText(afterProtectedTikTokTable.tableId, 'afterProtectedTikTokTableId') !== protectedTikTokTableId) {
      throw operatorError('Protected TikTok RAW table identity changed', 'MKT_CONTENT_DAILY_TIKTOK_RAW_IDENTITY_CHANGED');
    }
    const afterProtectedTikTokRecords = await client.listRecords({
      tableId: protectedTikTokTableId,
      includeRecordMetadata: false,
    });
    const afterProtectedTikTokDigest = sha256(json([...extractTikTokVideoIds(afterProtectedTikTokRecords)].sort()));
    if (afterProtectedTikTokDigest !== protectedTikTokDigest) throw operatorError(
      'Protected TikTok RAW source changed during retention',
      'MKT_CONTENT_DAILY_TIKTOK_RAW_SOURCE_CHANGED',
    );
    const afterIds = new Set(afterRecords.map((record) => requireText(record.recordId ?? record.record_id, 'recordId')));
    const deletedStillPresent = [...deleteIds].filter((recordId) => afterIds.has(recordId));
    const retainedMissing = [...retainedIds].filter((recordId) => !afterIds.has(recordId));
    const unexpectedIds = [...afterIds].filter((recordId) => !retainedIds.has(recordId));
    if (deletedStillPresent.length > 0 || retainedMissing.length > 0 || unexpectedIds.length > 0
      || afterRecords.length !== plan.retainedCount) {
      throw operatorError('Post-delete Lark identity readback did not converge', 'MKT_CONTENT_DAILY_DELETE_READBACK_FAILED', {
        expectedRows: plan.retainedCount,
        actualRows: afterRecords.length,
        deletedStillPresent: deletedStillPresent.length,
        retainedMissing: retainedMissing.length,
        unexpectedIds: unexpectedIds.length,
      });
    }
    const postParity = reconcileLatestLarkWithD1({
      records: afterRecords,
      d1Rows: d1.latestRows,
      deferredPlatforms,
      requireMetricParity: false,
      sourceBackedExternalIdsByPlatform: { tiktok: protectedTikTokVideoIds },
      requiredExternalIdsByPlatform: groupDeleteAffectedExternalIds(plan.deletes),
    });
    const afterJson = json({ contractVersion: plan.contractVersion, records: afterRecords });
    await writePrivate(join(evidenceRoot, 'after.json'), afterJson);
    const complete = summary({
      mode: 'execute_complete',
      plan,
      protection,
      parity: postParity,
      beforeJson,
      candidatesJson,
      d1Json,
      afterJson,
      confirmedDeletes,
      evidenceRoot,
    });
    await writePrivate(join(evidenceRoot, 'summary.json'), json(complete));
    process.stdout.write(`${JSON.stringify(complete, null, 2)}\n`);
  }
} catch (error) {
  const failure = Object.freeze({
    ok: false,
    stage,
    code: error?.code ?? 'MKT_CONTENT_DAILY_RETENTION_OPERATOR_FAILED',
    message: error?.message ?? String(error),
    details: error?.details ?? {},
    confirmedRecordDeletes: confirmedDeletes,
    d1Mutations: 0,
    queueMessages: 0,
    workerDeployments: 0,
  });
  if (evidenceRoot) await writePrivate(join(evidenceRoot, 'failure.json'), json(failure));
  process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
  process.exitCode = 1;
}

function assertArguments() {
  const modes = Number(execute) + Number(inspect);
  const unsupported = args.filter((value) => (
    value !== '--execute' && value !== '--inspect' && !value.startsWith('--defer-platform=')
  ));
  if (modes !== 1 || unsupported.length > 0) throw operatorError(
    'Use exactly one mode and defer Facebook explicitly',
    'MKT_CONTENT_DAILY_RETENTION_ARGUMENT_INVALID',
  );
  if (deferredPlatforms.length !== 1 || deferredPlatforms[0] !== 'facebook') throw operatorError(
    'This operator requires --defer-platform=facebook',
    'MKT_CONTENT_DAILY_FACEBOOK_DEFERRAL_REQUIRED',
  );
}

function assertConfirmation() {
  if (process.env.CONFIRM_MKT_CONTENT_DAILY_RETENTION !== CONFIRMATION) throw operatorError(
    'Exact retention confirmation is missing',
    'MKT_CONTENT_DAILY_RETENTION_CONFIRMATION_REQUIRED',
  );
}

async function readD1Evidence(repositoryRoot) {
  const config = resolve(repositoryRoot, process.env.MKT_CONTENT_DAILY_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc');
  const database = process.env.MKT_CONTENT_DAILY_D1_DATABASE ?? 'social-mkt-state-dev';
  const sql = `
    SELECT work_key,lifecycle_status,updated_at
    FROM sync_work_runs
    WHERE lifecycle_status IN ('queued','running','active')
    ORDER BY updated_at DESC;
    SELECT lock_key,owner_id,expires_at
    FROM sync_locks
    WHERE expires_at > datetime('now')
    ORDER BY expires_at ASC;
    SELECT platform,account_key,external_content_id,metric_date,observed_at,observation_key,
      views,likes,comments,shares,unique_viewers,avg_watch_time_seconds,
      total_watch_time_seconds,completion_rate
    FROM organic_content_observations
    WHERE platform <> 'facebook'
    ORDER BY platform,external_content_id,metric_date,observed_at,observation_key;
  `;
  const { stdout } = await execFileAsync('npx', [
    'wrangler', 'd1', 'execute', database, '--remote', '--config', config,
    '--command', sql, '--json',
  ], { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const payload = JSON.parse(stdout.slice(stdout.indexOf('[')));
  if (!Array.isArray(payload) || payload.length !== 3 || payload.some((item) => item.success !== true)) {
    throw operatorError('Wrangler D1 evidence response was incomplete', 'MKT_CONTENT_DAILY_D1_RESPONSE_INVALID');
  }
  return Object.freeze({
    activeWork: Object.freeze(payload[0].results ?? []),
    activeLocks: Object.freeze(payload[1].results ?? []),
    latestRows: Object.freeze(payload[2].results ?? []),
  });
}

async function deleteExactRecords(input) {
  let deleted = 0;
  for (let index = 0; index < input.recordIds.length; index += BATCH_SIZE) {
    const chunk = input.recordIds.slice(index, index + BATCH_SIZE);
    const response = await input.client.requestBitableJson(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(input.client.appToken)}/tables/${encodeURIComponent(input.tableId)}/records/batch_delete`,
      { method: 'POST', retryMode: 'rate_limit_only', body: { records: chunk } },
    );
    const records = response?.data?.records;
    if (Array.isArray(records) && records.length !== chunk.length) throw operatorError(
      'Lark batch_delete returned an unexpected exact count',
      'MKT_CONTENT_DAILY_DELETE_RESPONSE_INVALID',
      { expected: chunk.length, actual: records.length },
    );
    deleted += Array.isArray(records) ? records.length : chunk.length;
  }
  return deleted;
}

function summary(input) {
  return Object.freeze({
    ok: true,
    mode: input.mode,
    contractVersion: input.plan.contractVersion,
    deferredPlatforms: input.plan.deferredPlatforms,
    protectedFacebookRows: input.protection.protectedRows,
    recordCountBefore: input.plan.recordCount,
    retainedCount: input.plan.retainedCount,
    deleteCandidateCount: input.plan.deleteCandidateCount,
    effectiveRetentionDays: input.plan.effectiveRetentionDays,
    retainedByPlatform: summarizePlatforms(input.plan.retained),
    deletesByPlatform: summarizePlatforms(input.plan.deletes),
    d1LarkLatestParity: input.parity,
    confirmedRecordDeletes: input.confirmedDeletes,
    recordCountAfter: input.mode === 'execute_complete' ? input.plan.retainedCount : null,
    beforeSha256: sha256(input.beforeJson),
    exactDeleteCandidatesSha256: sha256(input.candidatesJson),
    d1AuthoritySha256: sha256(input.d1Json),
    afterSha256: input.afterJson ? sha256(input.afterJson) : null,
    evidenceRoot: input.evidenceRoot,
    d1Mutations: 0,
    queueMessages: 0,
    workerDeployments: 0,
    nextCommand: input.mode === 'read_only_preview'
      ? `CONFIRM_MKT_CONTENT_DAILY_RETENTION=${CONFIRMATION} node scripts/mkt-content-daily-retention-operator.mjs --execute --defer-platform=facebook`
      : null,
  });
}

async function assertExactMain(repositoryRoot) {
  const branch = (await git(repositoryRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  const head = (await git(repositoryRoot, ['rev-parse', 'HEAD'])).trim();
  const originMain = (await git(repositoryRoot, ['rev-parse', 'origin/main'])).trim();
  const status = (await git(repositoryRoot, ['status', '--porcelain', '--untracked-files=all'])).trim();
  if (branch !== 'main' || head !== originMain || status !== '') throw operatorError(
    'Live retention requires clean exact main == origin/main',
    'MKT_CONTENT_DAILY_REPOSITORY_INVALID',
    { branch, headMatchesOriginMain: head === originMain, clean: status === '' },
  );
}

async function resolveRepositoryRoot() {
  return (await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
    cwd: process.cwd(), encoding: 'utf8', maxBuffer: 1024 * 1024,
  })).stdout.trim();
}

async function git(cwd, arguments_) {
  return (await execFileAsync('git', arguments_, {
    cwd, encoding: 'utf8', maxBuffer: 1024 * 1024,
  })).stdout;
}

function uniqueTable(tables, name) {
  const matches = tables.filter((table) => normalizeTableName(table.name ?? table.tableName) === name);
  if (matches.length !== 1) throw operatorError('Expected one exact Lark table', 'MKT_CONTENT_DAILY_TABLE_INVALID', {
    tableName: name,
    matchCount: matches.length,
  });
  return matches[0];
}

function extractTikTokVideoIds(records) {
  const ids = new Set();
  for (const record of records) {
    const fields = record?.fields && typeof record.fields === 'object' ? record.fields : {};
    const value = fields.video_id ?? fields['Video ID'] ?? fields['Unique identifier of the video'] ?? fields.ID;
    const id = normalizeCellText(value);
    if (id) ids.add(id);
  }
  if (ids.size === 0) throw operatorError(
    'Protected TikTok RAW source has no readable Video IDs',
    'MKT_CONTENT_DAILY_TIKTOK_RAW_SOURCE_INVALID',
  );
  return ids;
}

function groupDeleteAffectedExternalIds(deletes) {
  const grouped = {};
  for (const row of deletes) {
    const platform = requireText(row.platform, 'delete.platform');
    const externalContentId = requireText(row.externalContentId, 'delete.externalContentId');
    grouped[platform] ??= new Set();
    grouped[platform].add(externalContentId);
  }
  return grouped;
}

function normalizeCellText(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value) && value.length === 1) return normalizeCellText(value[0]);
  if (value && typeof value === 'object') return normalizeCellText(value.text ?? value.name ?? value.value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function normalizeTableName(value) {
  return String(value ?? '').trim().replace(/^[^A-Za-z0-9_]+/u, '').trim();
}

async function writePrivate(path, content) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

function json(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MktContentDailyRetentionOperatorError';
  error.code = code;
  error.details = Object.freeze(details);
  return error;
}
