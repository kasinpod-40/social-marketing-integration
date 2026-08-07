#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  REPORT_METRIC_DISPLAY_VALUE_BACKFILL_CONFIRMATION,
  REPORT_METRIC_DISPLAY_VALUE_BACKFILL_VERSION,
  assertReportMetricDisplayValueBackfillConfirmation,
  planReportMetricDisplayValueBackfill,
} from './lib/report-metric-display-value-backfill.js';

const execFileAsync = promisify(execFile);
const REPORT_TABLE_NAME = '📊 MKT_Report_Metric_Values';
const REQUIRED_FIELDS = Object.freeze({
  metricKey: { fieldName: 'metric_key', type: 1 },
  currentValue: { fieldName: 'current_value', type: 2 },
  displayValue: { fieldName: 'display_value', type: 2 },
  unit: { fieldName: 'unit', type: 3 },
});
const execute = new Set(process.argv.slice(2)).has('--execute');
let stage = 'init';
let evidenceRoot = null;
let confirmedUpdates = 0;

try {
  const repositoryRoot = await resolveRepositoryRoot();
  evidenceRoot = resolve(
    process.env.MKT_REPORT_METRIC_DISPLAY_VALUE_EVIDENCE_DIR
      ?? join(repositoryRoot, 'outputs', 'report-metric-display-value-backfill'),
    `attempt-${new Date().toISOString().replaceAll(':', '-')}`,
  );
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });

  if (execute) {
    stage = 'confirmation';
    assertReportMetricDisplayValueBackfillConfirmation(
      process.env.CONFIRM_REPORT_METRIC_DISPLAY_VALUE_BACKFILL,
    );
    await assertExactMain(repositoryRoot);
  }

  stage = 'environment';
  const fileEnv = await readDevVars(resolve(repositoryRoot, process.env.DEV_VARS_FILE ?? '.dev.vars'));
  const env = Object.freeze({ ...fileEnv, ...process.env });
  const client = createLarkBitableClientFromEnv(env);

  stage = 'table-and-field-read';
  const tables = await client.listTables();
  const table = uniqueByName(tables, REPORT_TABLE_NAME);
  const tableId = requireText(table.tableId, 'Report Metric tableId');
  const fields = await client.listFields({ tableId });
  const resolvedFields = resolveRequiredFields(fields);

  stage = 'record-read';
  const records = await client.listRecords({ tableId, includeRecordMetadata: false });
  const immutableFingerprint = fingerprintExcludingDisplayValue(records, resolvedFields.displayValue.fieldName);
  const plan = planReportMetricDisplayValueBackfill({
    records,
    fieldNames: Object.fromEntries(Object.entries(resolvedFields).map(([key, field]) => [key, field.fieldName])),
  });

  const preview = Object.freeze({
    ok: true,
    mode: execute ? 'execute' : 'preview',
    contractVersion: REPORT_METRIC_DISPLAY_VALUE_BACKFILL_VERSION,
    tableName: REPORT_TABLE_NAME,
    recordCount: plan.recordCount,
    convergedCount: plan.convergedCount,
    pendingRecordUpdateCount: plan.pendingUpdateCount,
    nullValueCount: plan.nullValueCount,
    microsCurrencyCount: plan.microsCurrencyCount,
    immutableRecordFingerprint: immutableFingerprint,
    updatedFieldName: resolvedFields.displayValue.fieldName,
    canonicalCurrentValueMutationCount: 0,
    recordCreateCount: 0,
    recordDeleteCount: 0,
    remoteD1MutationCount: 0,
    queueSendCount: 0,
    workerDeploymentCount: 0,
    production: 'BLOCKED',
    nextCommand: execute
      ? null
      : `CONFIRM_REPORT_METRIC_DISPLAY_VALUE_BACKFILL=${REPORT_METRIC_DISPLAY_VALUE_BACKFILL_CONFIRMATION} node scripts/report-metric-display-value-backfill.mjs --execute`,
    evidenceRoot,
  });
  await writePrivateJson(join(evidenceRoot, 'preview.json'), {
    ...preview,
    updates: plan.updates.map((update) => ({
      recordId: update.recordId,
      metricKey: update.metricKey,
      unit: update.unit,
      currentValue: update.currentValue,
      previousDisplayValue: update.previousDisplayValue,
      desiredDisplayValue: update.desiredDisplayValue,
    })),
  });
  process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
  if (!execute) process.exit(0);

  stage = 'backup';
  await writePrivateJson(join(evidenceRoot, 'before.json'), {
    contractVersion: REPORT_METRIC_DISPLAY_VALUE_BACKFILL_VERSION,
    recordCount: records.length,
    immutableRecordFingerprint: immutableFingerprint,
    rows: plan.updates.map((update) => ({
      recordId: update.recordId,
      metricKey: update.metricKey,
      currentValue: update.currentValue,
      previousDisplayValue: update.previousDisplayValue,
      desiredDisplayValue: update.desiredDisplayValue,
    })),
  });

  stage = 'record-only-display-value-update';
  if (plan.updates.length > 0) {
    try {
      const result = await client.batchUpdateRecords({
        tableId,
        records: plan.updates.map((update) => ({ recordId: update.recordId, fields: update.fields })),
      });
      confirmedUpdates = Number(result.updated ?? 0);
    } catch (error) {
      confirmedUpdates = Number(error?.writeProgress?.confirmedRows ?? 0);
      throw error;
    }
    if (confirmedUpdates !== plan.updates.length) throw operatorError(
      'Display-value backfill response count did not match the planned update count',
      'REPORT_METRIC_DISPLAY_VALUE_BACKFILL_COUNT_MISMATCH',
      { plannedUpdates: plan.updates.length, confirmedUpdates },
    );
  }

  stage = 'readback';
  const recordsAfter = await client.listRecords({ tableId, includeRecordMetadata: false });
  const immutableFingerprintAfter = fingerprintExcludingDisplayValue(
    recordsAfter,
    resolvedFields.displayValue.fieldName,
  );
  const finalPlan = planReportMetricDisplayValueBackfill({
    records: recordsAfter,
    fieldNames: Object.fromEntries(Object.entries(resolvedFields).map(([key, field]) => [key, field.fieldName])),
  });
  if (recordsAfter.length !== records.length
    || immutableFingerprintAfter !== immutableFingerprint
    || finalPlan.pendingUpdateCount !== 0) throw operatorError(
    'Display-value backfill did not converge without unrelated Record drift',
    'REPORT_METRIC_DISPLAY_VALUE_BACKFILL_VERIFY_FAILED',
    {
      beforeRecordCount: records.length,
      afterRecordCount: recordsAfter.length,
      pendingRecordUpdateCount: finalPlan.pendingUpdateCount,
      immutableFingerprintMatch: immutableFingerprintAfter === immutableFingerprint,
    },
  );

  const summary = Object.freeze({
    ok: true,
    contractVersion: REPORT_METRIC_DISPLAY_VALUE_BACKFILL_VERSION,
    decision: 'REPORT_METRIC_DISPLAY_VALUE_BACKFILL_CONVERGED',
    recordCount: recordsAfter.length,
    confirmedRecordUpdateCount: confirmedUpdates,
    pendingRecordUpdateCount: 0,
    microsCurrencyCount: finalPlan.microsCurrencyCount,
    nullValueCount: finalPlan.nullValueCount,
    immutableRecordFingerprint: immutableFingerprintAfter,
    updatedFieldName: resolvedFields.displayValue.fieldName,
    canonicalCurrentValueMutationCount: 0,
    recordCreateCount: 0,
    recordDeleteCount: 0,
    remoteLarkMutationCount: confirmedUpdates,
    remoteD1MutationCount: 0,
    queueSendCount: 0,
    workerDeploymentCount: 0,
    production: 'BLOCKED',
    evidenceRoot,
  });
  await writePrivateJson(join(evidenceRoot, 'summary.json'), summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} catch (error) {
  const failure = Object.freeze({
    ok: false,
    contractVersion: REPORT_METRIC_DISPLAY_VALUE_BACKFILL_VERSION,
    stage,
    code: error?.code ?? 'REPORT_METRIC_DISPLAY_VALUE_BACKFILL_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: Object.freeze({ ...(error?.details ?? {}), confirmedUpdates }),
    production: 'BLOCKED',
  });
  if (evidenceRoot) await writePrivateJson(join(evidenceRoot, 'failure.json'), failure);
  process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
  process.exitCode = 1;
}

function resolveRequiredFields(fields) {
  const result = {};
  for (const [key, expected] of Object.entries(REQUIRED_FIELDS)) {
    const matches = fields.filter((field) => field.fieldName === expected.fieldName);
    if (matches.length !== 1 || Number(matches[0]?.type) !== expected.type) throw operatorError(
      `Required Report Metric field ${expected.fieldName} is missing or has the wrong type`,
      key === 'displayValue'
        ? 'REPORT_METRIC_DISPLAY_VALUE_SCHEMA_REQUIRED'
        : 'REPORT_METRIC_DISPLAY_VALUE_FIELD_INVALID',
      { fieldName: expected.fieldName, expectedType: expected.type, matchCount: matches.length },
    );
    result[key] = Object.freeze({
      fieldId: matches[0].fieldId,
      fieldName: matches[0].fieldName,
      type: Number(matches[0].type),
    });
  }
  return Object.freeze(result);
}

function fingerprintExcludingDisplayValue(records, displayFieldName) {
  const canonical = records.map((record) => ({
    recordId: record.recordId,
    fields: Object.fromEntries(Object.entries(record.fields ?? {})
      .filter(([name]) => name !== displayFieldName)
      .sort(([left], [right]) => left.localeCompare(right))),
  })).sort((left, right) => String(left.recordId).localeCompare(String(right.recordId)));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

async function assertExactMain(repositoryRoot) {
  const branch = (await git(repositoryRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  const head = (await git(repositoryRoot, ['rev-parse', 'HEAD'])).trim();
  const originMain = (await git(repositoryRoot, ['rev-parse', 'origin/main'])).trim();
  const status = (await git(repositoryRoot, ['status', '--porcelain'])).trim();
  if (branch !== 'main' || head !== originMain || status !== '') throw operatorError(
    'Live display-value backfill requires clean exact main == origin/main',
    'REPORT_METRIC_DISPLAY_VALUE_REPOSITORY_INVALID',
    { branch, headMatchesOriginMain: head === originMain, clean: status === '' },
  );
}

async function resolveRepositoryRoot() {
  return (await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
    cwd: process.cwd(), encoding: 'utf8', maxBuffer: 1024 * 1024,
  })).stdout.trim();
}

async function git(cwd, args) {
  return (await execFileAsync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 })).stdout;
}

function uniqueByName(rows, name) {
  const matches = rows.filter((row) => row.name === name || row.tableName === name);
  if (matches.length !== 1) throw operatorError(
    `Expected exactly one ${name} table`,
    'REPORT_METRIC_DISPLAY_VALUE_TABLE_INVALID',
    { matchCount: matches.length },
  );
  return matches[0];
}

async function writePrivateJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportMetricDisplayValueBackfillError';
  error.code = code;
  error.details = Object.freeze(details);
  return error;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
