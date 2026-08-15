#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { readDevVars } from './lib/dev-vars.js';
import { planMktContentDailyRetention } from './lib/mkt-content-daily-retention.js';

const inspect = process.argv.slice(2).includes('--inspect');

try {
  if (process.argv.slice(2).some((value) => value !== '--inspect')) throw previewError('Unsupported argument', 'MKT_CONTENT_DAILY_RETENTION_ARGUMENT_INVALID');
  if (!inspect) {
    process.stdout.write(`${JSON.stringify({
      ok: true, mode: 'plan', readOnly: true,
      nextCommand: 'node scripts/mkt-content-daily-retention-preview.mjs --inspect',
      larkRecordDeletes: 0, d1Mutations: 0,
    }, null, 2)}\n`);
    process.exit(0);
  }
  const root = resolve(process.cwd());
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? resolve(root, '.dev.vars'));
  const env = Object.freeze({ ...fileEnv, ...process.env });
  const client = createLarkBitableClientFromEnv(env);
  const tables = await client.listTables();
  const matches = tables.filter((table) => normalizeTableName(table.name ?? table.tableName) === 'MKT_Content_Daily');
  if (matches.length !== 1) throw previewError('Expected one MKT_Content_Daily table', 'MKT_CONTENT_DAILY_TABLE_INVALID', { matchCount: matches.length });
  const tableId = matches[0].tableId;
  const records = await client.listRecords({ tableId, includeRecordMetadata: false });
  const plan = planMktContentDailyRetention({ records });
  const evidenceRoot = resolve(process.env.MKT_CONTENT_DAILY_RETENTION_EVIDENCE_DIR
    ?? '/private/tmp/social-mkt-content-daily-retention-20260815');
  const backupJson = `${JSON.stringify({ tableName: 'MKT_Content_Daily', records }, null, 2)}\n`;
  const deleteKeysJson = `${JSON.stringify(plan.deletes, null, 2)}\n`;
  await writePrivate(join(evidenceRoot, 'before.json'), backupJson);
  await writePrivate(join(evidenceRoot, 'exact-delete-candidates.json'), deleteKeysJson);
  const summary = Object.freeze({
    ok: true,
    mode: 'read_only_preview',
    contractVersion: plan.contractVersion,
    requestedRetentionDays: plan.requestedRetentionDays,
    effectiveRetentionDays: plan.effectiveRetentionDays,
    maxRetainedRecords: plan.maxRetainedRecords,
    recordCount: plan.recordCount,
    contentIdentityCount: plan.contentIdentityCount,
    unmanagedPreservedCount: plan.unmanagedPreservedCount,
    retainedCount: plan.retainedCount,
    deleteCandidateCount: plan.deleteCandidateCount,
    maxMetricDate: plan.maxMetricDate,
    cutoffMetricDate: plan.cutoffMetricDate,
    backupSha256: sha256(backupJson),
    exactDeleteCandidatesSha256: sha256(deleteKeysJson),
    evidenceRoot,
    larkRecordDeletes: 0,
    d1Mutations: 0,
    queueActions: 0,
    production: 'BLOCKED',
    blockedBy: ['facebook_fresh_metrics_parity', 'pre_delete_d1_lark_dashboard_reconciliation'],
  });
  await writePrivate(join(evidenceRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false, code: error?.code ?? 'MKT_CONTENT_DAILY_RETENTION_PREVIEW_FAILED',
    message: error?.message ?? String(error), details: error?.details ?? {},
    larkRecordDeletes: 0, d1Mutations: 0, production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function writePrivate(path, content) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, content, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function normalizeTableName(value) { return String(value ?? '').trim().replace(/^[^A-Za-z0-9_]+/u, '').trim(); }
function previewError(message, code, details = {}) { const error = new Error(message); error.code = code; error.details = details; return error; }
