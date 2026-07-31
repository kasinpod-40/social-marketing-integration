#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  LARK_DASHBOARD_COMPATIBILITY_FIELD_IDENTITIES,
  LARK_DASHBOARD_COMPATIBILITY_FREEZE_VERSION,
  assertLarkDashboardCompatibilityRecordBackfillConfirmation,
} from './lib/lark-dashboard-compatibility-freeze-v1.js';
import { planPreservedWindowSelectBackfill } from './lib/lark-dashboard-field-identity-recovery-v3.js';

const execFileAsync = promisify(execFile);
const REPORT_TABLE_NAME = '📊 MKT_Report_Metric_Values';
const EXPECTED_RECORD_COUNT = 86;
const EXPECTED_BASELINE_INCOMPLETE_NULL_COUNT = 24;
const MAXIMUM_REVIEWED_RECORD_UPDATES = 28;
const args = new Set(process.argv.slice(2));
const execute = args.has('--execute');
let currentStage = 'init';
let attemptRoot = null;
let confirmedRecordUpdates = 0;

try {
  const repositoryRoot = await resolveRepositoryRoot();
  const evidenceRoot = resolve(
    process.env.MKT_LARK_DASHBOARD_COMPATIBILITY_EVIDENCE_DIR
      ?? join(repositoryRoot, 'outputs', 'lark-dashboard-compatibility-record-backfill-v1'),
  );
  attemptRoot = join(
    evidenceRoot,
    `record-backfill-${new Date().toISOString().replaceAll(':', '-')}`,
  );
  await mkdir(attemptRoot, { recursive: true, mode: 0o700 });

  if (execute) {
    currentStage = 'confirm-record-only-execution';
    assertLarkDashboardCompatibilityRecordBackfillConfirmation(
      process.env.CONFIRM_LARK_DASHBOARD_COMPATIBILITY_RECORD_BACKFILL,
    );
    await assertExactMain(repositoryRoot);
  }

  currentStage = 'read-private-environment';
  const fileEnv = await readDevVars(
    resolve(repositoryRoot, process.env.DEV_VARS_FILE ?? '.dev.vars'),
  );
  const env = Object.freeze({ ...fileEnv, ...process.env });
  const client = createLarkBitableClientFromEnv(env);

  currentStage = 'resolve-report-table';
  const tables = await client.listTables();
  const table = uniqueByName(tables, REPORT_TABLE_NAME, 'Report Metric table');
  const tableId = requireText(table.tableId, 'Report Metric tableId');

  currentStage = 'read-field-and-record-state';
  const fields = await client.listFields({ tableId });
  const fieldState = inspectCompatibilityFields(fields);
  const records = await client.listRecords({
    tableId,
    includeRecordMetadata: false,
  });
  const plan = buildPlan(records, fieldState);
  const nullCount = countBaselineIncompleteNullRows(records);
  assertReviewedLiveBoundary({ records, plan, nullCount });

  const preview = Object.freeze({
    ok: true,
    mode: execute ? 'execute' : 'preview',
    contractVersion: LARK_DASHBOARD_COMPATIBILITY_FREEZE_VERSION,
    decision: execute
      ? 'LARK_DASHBOARD_COMPATIBILITY_RECORD_BACKFILL_EXECUTION_AUTHORIZED'
      : 'LARK_DASHBOARD_COMPATIBILITY_RECORD_BACKFILL_PREVIEW_READY',
    tableName: REPORT_TABLE_NAME,
    tableId,
    recordCount: records.length,
    baselineIncompleteNullRecordCount: nullCount,
    pendingRecordUpdateCount: plan.pendingUpdateCount,
    windowConflictCount: plan.conflictCount,
    maximumReviewedRecordUpdateCount: MAXIMUM_REVIEWED_RECORD_UPDATES,
    updatedFieldId: fieldState.preservedWindowSelect.fieldId,
    updatedFieldName: fieldState.preservedWindowSelect.fieldName,
    dashboardPatchCount: 0,
    fieldMutationCount: 0,
    recordDeleteCount: 0,
    remoteMutationCount: 0,
    production: 'BLOCKED',
    evidenceRoot: attemptRoot,
  });

  await writePrivateJson(join(attemptRoot, 'record-backfill-plan.json'), {
    ...preview,
    recordIds: plan.updates.map((item) => item.recordId),
  });
  process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
  if (!execute) process.exit(0);

  currentStage = 'backup-reviewed-record-values';
  await writePrivateJson(join(attemptRoot, 'record-backfill-before.json'), {
    contractVersion: LARK_DASHBOARD_COMPATIBILITY_FREEZE_VERSION,
    tableId,
    recordCount: records.length,
    baselineIncompleteNullRecordCount: nullCount,
    rows: records.map((record) => ({
      recordId: record.recordId,
      metricKey: record.fields?.[fieldState.metricKey.fieldName] ?? null,
      currentValue: record.fields?.current_value ?? null,
      numberWindow: record.fields?.[fieldState.numberWindow.fieldName] ?? null,
      preservedWindowSelect:
        record.fields?.[fieldState.preservedWindowSelect.fieldName] ?? null,
      windowSelectV2: record.fields?.[fieldState.windowSelectV2.fieldName] ?? null,
    })),
  });

  currentStage = 'update-preserved-window-select-records';
  try {
    const result = await client.batchUpdateRecords({
      tableId,
      records: plan.updates,
      beforeChunk: async (chunk) => {
        await writePrivateJson(join(attemptRoot, `record-update-chunk-${chunk.chunk}-before.json`), {
          contractVersion: LARK_DASHBOARD_COMPATIBILITY_FREEZE_VERSION,
          ...chunk,
          dashboardPatchCount: 0,
          fieldMutationCount: 0,
          recordDeleteCount: 0,
        });
      },
    });
    confirmedRecordUpdates = result.updated;
  } catch (error) {
    confirmedRecordUpdates = Number(error?.details?.completedRows ?? 0);
    throw error;
  }

  if (confirmedRecordUpdates !== plan.pendingUpdateCount) {
    throw operatorError(
      'Record-only compatibility backfill response count did not match the reviewed plan',
      'LARK_DASHBOARD_COMPATIBILITY_RECORD_BACKFILL_COUNT_MISMATCH',
      {
        plannedRecordUpdates: plan.pendingUpdateCount,
        confirmedRecordUpdates,
      },
    );
  }

  currentStage = 'verify-record-only-convergence';
  const recordsAfter = await client.listRecords({
    tableId,
    includeRecordMetadata: false,
  });
  const finalPlan = buildPlan(recordsAfter, fieldState);
  const finalNullCount = countBaselineIncompleteNullRows(recordsAfter);

  if (recordsAfter.length !== EXPECTED_RECORD_COUNT
    || finalNullCount !== EXPECTED_BASELINE_INCOMPLETE_NULL_COUNT
    || finalPlan.conflictCount !== 0
    || finalPlan.pendingUpdateCount !== 0) {
    throw operatorError(
      'Record-only compatibility backfill did not converge to the reviewed live boundary',
      'LARK_DASHBOARD_COMPATIBILITY_RECORD_BACKFILL_NOT_CONVERGED',
      {
        recordCount: recordsAfter.length,
        baselineIncompleteNullRecordCount: finalNullCount,
        pendingRecordUpdateCount: finalPlan.pendingUpdateCount,
        windowConflictCount: finalPlan.conflictCount,
      },
    );
  }

  const summary = Object.freeze({
    ok: true,
    contractVersion: LARK_DASHBOARD_COMPATIBILITY_FREEZE_VERSION,
    decision: 'LARK_DASHBOARD_COMPATIBILITY_RECORD_BACKFILL_COMPLETED_SAFE',
    tableName: REPORT_TABLE_NAME,
    recordCount: recordsAfter.length,
    baselineIncompleteNullRecordCount: finalNullCount,
    confirmedRecordUpdateCount: confirmedRecordUpdates,
    pendingRecordUpdateCount: finalPlan.pendingUpdateCount,
    windowConflictCount: finalPlan.conflictCount,
    updatedFieldId: fieldState.preservedWindowSelect.fieldId,
    dashboardPatchCount: 0,
    fieldMutationCount: 0,
    recordDeleteCount: 0,
    remoteLarkMutationCount: confirmedRecordUpdates,
    remoteD1MutationCount: 0,
    workerDeploymentCount: 0,
    queueSendCount: 0,
    production: 'BLOCKED',
    evidenceRoot: attemptRoot,
  });
  await writePrivateJson(join(attemptRoot, 'summary.json'), summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} catch (error) {
  const failure = Object.freeze({
    ok: false,
    contractVersion: LARK_DASHBOARD_COMPATIBILITY_FREEZE_VERSION,
    stage: currentStage,
    code: error?.code ?? 'LARK_DASHBOARD_COMPATIBILITY_RECORD_BACKFILL_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: Object.freeze({
      ...(error?.details ?? {}),
      confirmedRecordUpdates,
      dashboardPatchCount: 0,
      fieldMutationCount: 0,
      recordDeleteCount: 0,
    }),
    production: 'BLOCKED',
  });
  if (attemptRoot) await writePrivateJson(join(attemptRoot, 'failure.json'), failure);
  process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
  process.exitCode = 1;
}

function inspectCompatibilityFields(fields) {
  const resolved = {};
  for (const [key, identity] of Object.entries(LARK_DASHBOARD_COMPATIBILITY_FIELD_IDENTITIES)) {
    const matches = fields.filter((field) => field.fieldId === identity.fieldId);
    if (matches.length !== 1) {
      throw operatorError(
        `Compatibility field ${key} was not resolved exactly once`,
        'LARK_DASHBOARD_COMPATIBILITY_FIELD_IDENTITY_INVALID',
        { key, fieldId: identity.fieldId, matchCount: matches.length },
      );
    }
    const field = matches[0];
    if (field.fieldName !== identity.fieldName || field.type !== identity.type) {
      throw operatorError(
        `Compatibility field ${key} does not match the reviewed name/type`,
        'LARK_DASHBOARD_COMPATIBILITY_FIELD_IDENTITY_INVALID',
        {
          key,
          fieldId: identity.fieldId,
          expectedFieldName: identity.fieldName,
          actualFieldName: field.fieldName,
          expectedType: identity.type,
          actualType: field.type,
        },
      );
    }
    resolved[key] = Object.freeze({
      fieldId: field.fieldId,
      fieldName: field.fieldName,
      type: field.type,
    });
  }
  return Object.freeze(resolved);
}

function buildPlan(records, fieldState) {
  return planPreservedWindowSelectBackfill({
    records,
    numberFieldName: fieldState.numberWindow.fieldName,
    preservedFieldName: fieldState.preservedWindowSelect.fieldName,
    v2FieldName: fieldState.windowSelectV2.fieldName,
  });
}

function assertReviewedLiveBoundary({ records, plan, nullCount }) {
  if (records.length !== EXPECTED_RECORD_COUNT) {
    throw operatorError(
      'Report Metric record count changed from the reviewed compatibility boundary',
      'LARK_DASHBOARD_COMPATIBILITY_RECORD_COUNT_DRIFT',
      { expectedRecordCount: EXPECTED_RECORD_COUNT, actualRecordCount: records.length },
    );
  }
  if (nullCount !== EXPECTED_BASELINE_INCOMPLETE_NULL_COUNT) {
    throw operatorError(
      'Baseline-incomplete null count changed from the reviewed compatibility boundary',
      'LARK_DASHBOARD_COMPATIBILITY_NULL_BOUNDARY_DRIFT',
      {
        expectedNullCount: EXPECTED_BASELINE_INCOMPLETE_NULL_COUNT,
        actualNullCount: nullCount,
      },
    );
  }
  if (plan.conflictCount !== 0) {
    throw operatorError(
      'Window compatibility fields contain conflicting values',
      'LARK_DASHBOARD_COMPATIBILITY_WINDOW_CONFLICT',
      { conflicts: plan.conflicts },
    );
  }
  if (plan.pendingUpdateCount > MAXIMUM_REVIEWED_RECORD_UPDATES) {
    throw operatorError(
      'Pending Record compatibility updates exceed the reviewed maximum',
      'LARK_DASHBOARD_COMPATIBILITY_UPDATE_BOUNDARY_EXCEEDED',
      {
        maximumReviewedRecordUpdates: MAXIMUM_REVIEWED_RECORD_UPDATES,
        pendingRecordUpdateCount: plan.pendingUpdateCount,
      },
    );
  }
}

function countBaselineIncompleteNullRows(records) {
  return records.filter((record) => {
    const value = record.fields?.current_value;
    return value === null || value === undefined || value === '';
  }).length;
}

function uniqueByName(items, name, label) {
  const matches = items.filter((item) => item.name === name);
  if (matches.length !== 1) {
    throw operatorError(
      `${label} must resolve exactly once`,
      'LARK_DASHBOARD_COMPATIBILITY_RESOURCE_UNRESOLVED',
      { name, matchCount: matches.length },
    );
  }
  return matches[0];
}

async function resolveRepositoryRoot() {
  const result = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  return resolve(requireText(result.stdout, 'repository root'));
}

async function assertExactMain(repositoryRoot) {
  const status = await git(repositoryRoot, ['status', '--porcelain']);
  if (status.trim()) {
    throw operatorError(
      'Repository must be clean before Live Record compatibility backfill',
      'LARK_DASHBOARD_COMPATIBILITY_REPOSITORY_DIRTY',
    );
  }
  const head = (await git(repositoryRoot, ['rev-parse', 'HEAD'])).trim();
  const originMain = (await git(repositoryRoot, ['rev-parse', 'origin/main'])).trim();
  if (head !== originMain) {
    throw operatorError(
      'Repository HEAD must equal sealed origin/main',
      'LARK_DASHBOARD_COMPATIBILITY_MAIN_MISMATCH',
      { head, originMain },
    );
  }
}

async function git(cwd, command) {
  const result = await execFileAsync('git', command, { cwd, encoding: 'utf8' });
  return String(result.stdout ?? '');
}

async function writePrivateJson(path, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path, text, { mode: 0o600 });
  await writeFile(
    `${path}.sha256`,
    `${createHash('sha256').update(text).digest('hex')}  ${path.split('/').at(-1)}\n`,
    { mode: 0o600 },
  );
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw operatorError(
      `${fieldName} is required`,
      'LARK_DASHBOARD_COMPATIBILITY_VALUE_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkDashboardCompatibilityRecordBackfillError';
  error.code = code;
  error.details = details;
  return error;
}
