#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { LARK_DASHBOARD_DISPLAY_V2_FIELD } from '../packages/config/src/lark-dashboard-display-v2-compatibility.js';
import { readDevVars } from './lib/dev-vars.js';
import { LARK_DASHBOARD_COMPATIBILITY_FIELD_IDENTITIES } from './lib/lark-dashboard-compatibility-freeze-v1.js';
import {
  EXPECTED_BASELINE_INCOMPLETE_NULL_COUNT,
  EXPECTED_DASHBOARD_RECORD_COUNT,
  EXPECTED_INITIAL_CONVERGED_DISPLAY_V2_COUNT,
  EXPECTED_MISSING_DISPLAY_V2_UPDATE_COUNT,
  EXPECTED_PENDING_DISPLAY_V2_UPDATE_COUNT,
  EXPECTED_REVIEWED_ALIAS_CORRECTION_COUNT,
  LARK_DASHBOARD_DISPLAY_V2_BACKFILL_VERSION,
  assertLarkDashboardDisplayV2BackfillConfirmation,
  assertLarkDashboardDisplayV2Options,
  planLarkDashboardDisplayV2Backfill,
} from './lib/lark-dashboard-display-v2-compatibility-v1.js';

const execFileAsync = promisify(execFile);
const REPORT_TABLE_NAME = '📊 MKT_Report_Metric_Values';
const args = new Set(process.argv.slice(2));
const execute = args.has('--execute');
let currentStage = 'init';
let attemptRoot = null;
let confirmedRecordUpdates = 0;

const REQUIRED_FIELD_IDENTITIES = Object.freeze({
  ...LARK_DASHBOARD_COMPATIBILITY_FIELD_IDENTITIES,
  currentValue: { fieldId: 'fldCoOy2IP', fieldName: 'current_value', type: 2 },
  reportType: { fieldId: 'fldLwgMcgx', fieldName: 'report_type', type: 3 },
  platform: { fieldId: 'fldnCTMjx1', fieldName: 'platform', type: 3 },
  capability: { fieldId: 'fldrHiZzHt', fieldName: 'capability', type: 1 },
  periodKind: { fieldId: 'fldmKUe2ua', fieldName: 'period_kind', type: 3 },
  customerProfile: { fieldId: 'fldFGvf8bZ', fieldName: 'customer_profile', type: 1 },
  customerKey: { fieldId: 'fldATAWC7Q', fieldName: 'customer_key', type: 1 },
  accountId: { fieldId: 'fldxOCmuJ7', fieldName: 'account_id', type: 1 },
});

try {
  const repositoryRoot = await resolveRepositoryRoot();
  const evidenceRoot = resolve(
    process.env.MKT_LARK_DASHBOARD_DISPLAY_V2_EVIDENCE_DIR
      ?? join(repositoryRoot, 'outputs', 'lark-dashboard-display-v2-compatibility-v2'),
  );
  attemptRoot = join(
    evidenceRoot,
    `display-v2-backfill-${new Date().toISOString().replaceAll(':', '-')}`,
  );
  await mkdir(attemptRoot, { recursive: true, mode: 0o700 });

  if (execute) {
    currentStage = 'confirm-record-only-execution';
    assertLarkDashboardDisplayV2BackfillConfirmation(
      process.env.CONFIRM_LARK_DASHBOARD_DISPLAY_V2_BACKFILL,
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
  const fieldState = inspectRequiredFields(fields);
  assertLarkDashboardDisplayV2Options(fieldState.displaySelectV2.source);
  const records = await client.listRecords({
    tableId,
    includeRecordMetadata: false,
  });
  const initialRecordCount = records.length;
  const plan = buildPlan(records, fieldState);
  const immutableFingerprint = fingerprintRecordsExcludingField(
    records,
    fieldState.displaySelectV2.fieldName,
  );
  assertReviewedBoundary({ execute, plan });

  const preview = Object.freeze({
    ok: true,
    mode: execute ? 'execute' : 'preview',
    contractVersion: LARK_DASHBOARD_DISPLAY_V2_BACKFILL_VERSION,
    decision: execute
      ? 'LARK_DASHBOARD_DISPLAY_V2_COMPATIBILITY_EXECUTION_AUTHORIZED'
      : 'LARK_DASHBOARD_DISPLAY_V2_COMPATIBILITY_PREVIEW_READY',
    tableName: REPORT_TABLE_NAME,
    tableId,
    recordCount: initialRecordCount,
    dashboardRecordCount: plan.targetRecordCount,
    baselineIncompleteNullRecordCount: plan.targetCurrentValueNullCount,
    populatedDisplayV2Count: plan.populatedDisplayV2Count,
    convergedDisplayV2Count: plan.convergedDisplayV2Count,
    missingValueUpdateCount: plan.missingValueUpdateCount,
    reviewedAliasCorrectionCount: plan.reviewedAliasCorrectionCount,
    pendingRecordUpdateCount: plan.pendingUpdateCount,
    displayV2ConflictCount: plan.conflictCount,
    platformCounts: plan.platformCounts,
    maximumReviewedRecordUpdateCount: EXPECTED_PENDING_DISPLAY_V2_UPDATE_COUNT,
    updatedFieldId: fieldState.displaySelectV2.fieldId,
    updatedFieldName: fieldState.displaySelectV2.fieldName,
    immutableRecordFingerprint: immutableFingerprint,
    dashboardPatchCount: 0,
    fieldMutationCount: 0,
    currentValueMutationCount: 0,
    recordCreateCount: 0,
    recordDeleteCount: 0,
    remoteMutationCount: 0,
    production: 'BLOCKED',
    evidenceRoot: attemptRoot,
  });
  await writePrivateJson(join(attemptRoot, 'display-v2-backfill-plan.json'), {
    ...preview,
    updates: plan.updates.map((update) => ({
      recordId: update.recordId,
      platform: update.platform,
      metricKey: update.metricKey,
      windowDays: update.windowDays,
      reason: update.reason,
      previousDisplayV2: update.previousDisplayV2,
      desiredDisplayV2: update.desiredDisplayV2,
    })),
  });
  process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
  if (!execute) process.exit(0);

  currentStage = 'backup-reviewed-record-values';
  const recordsById = new Map(records.map((record) => [record.recordId, record]));
  await writePrivateJson(join(attemptRoot, 'display-v2-backfill-before.json'), {
    contractVersion: LARK_DASHBOARD_DISPLAY_V2_BACKFILL_VERSION,
    tableId,
    recordCount: initialRecordCount,
    dashboardRecordCount: plan.targetRecordCount,
    baselineIncompleteNullRecordCount: plan.targetCurrentValueNullCount,
    immutableRecordFingerprint: immutableFingerprint,
    rows: plan.expectedByRecord.map((expected) => {
      const record = recordsById.get(expected.recordId);
      return {
        ...expected,
        currentValue: record?.fields?.[fieldState.currentValue.fieldName] ?? null,
        currentDisplayV2: record?.fields?.[fieldState.displaySelectV2.fieldName] ?? null,
      };
    }),
  });

  currentStage = 'update-display-v2-records';
  const reviewedUpdates = plan.updates.map((update) => ({
    recordId: update.recordId,
    fields: update.fields,
  }));
  try {
    const result = await client.batchUpdateRecords({
      tableId,
      records: reviewedUpdates,
      beforeChunk: async (chunk) => {
        await writePrivateJson(
          join(attemptRoot, `display-v2-update-chunk-${chunk.chunk}-before.json`),
          {
            contractVersion: LARK_DASHBOARD_DISPLAY_V2_BACKFILL_VERSION,
            chunk: chunk.chunk,
            totalChunks: chunk.chunks,
            rowCount: chunk.rows,
            plannedRecordUpdateCount: reviewedUpdates.length,
            dashboardPatchCount: 0,
            fieldMutationCount: 0,
            currentValueMutationCount: 0,
            recordCreateCount: 0,
            recordDeleteCount: 0,
          },
        );
      },
    });
    confirmedRecordUpdates = result.updated;
  } catch (error) {
    confirmedRecordUpdates = Number(error?.writeProgress?.confirmedRows ?? 0);
    throw error;
  }

  if (confirmedRecordUpdates !== EXPECTED_PENDING_DISPLAY_V2_UPDATE_COUNT) {
    throw operatorError(
      'Display v2 backfill response count did not match the reviewed 204-row plan',
      'LARK_DASHBOARD_DISPLAY_V2_BACKFILL_COUNT_MISMATCH',
      {
        plannedRecordUpdates: EXPECTED_PENDING_DISPLAY_V2_UPDATE_COUNT,
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
  const finalImmutableFingerprint = fingerprintRecordsExcludingField(
    recordsAfter,
    fieldState.displaySelectV2.fieldName,
  );
  assertConvergedBoundary({
    initialRecordCount,
    recordsAfter,
    finalPlan,
    immutableFingerprint,
    finalImmutableFingerprint,
  });

  const summary = Object.freeze({
    ok: true,
    contractVersion: LARK_DASHBOARD_DISPLAY_V2_BACKFILL_VERSION,
    decision: 'LARK_DASHBOARD_DISPLAY_V2_COMPATIBILITY_COMPLETED_SAFE',
    tableName: REPORT_TABLE_NAME,
    recordCount: recordsAfter.length,
    dashboardRecordCount: finalPlan.targetRecordCount,
    baselineIncompleteNullRecordCount: finalPlan.targetCurrentValueNullCount,
    confirmedRecordUpdateCount: confirmedRecordUpdates,
    pendingRecordUpdateCount: finalPlan.pendingUpdateCount,
    displayV2ConflictCount: finalPlan.conflictCount,
    convergedDisplayV2Count: finalPlan.convergedDisplayV2Count,
    platformCounts: finalPlan.platformCounts,
    immutableRecordFingerprint: finalImmutableFingerprint,
    updatedFieldId: fieldState.displaySelectV2.fieldId,
    dashboardPatchCount: 0,
    fieldMutationCount: 0,
    currentValueMutationCount: 0,
    recordCreateCount: 0,
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
    contractVersion: LARK_DASHBOARD_DISPLAY_V2_BACKFILL_VERSION,
    stage: currentStage,
    code: error?.code ?? 'LARK_DASHBOARD_DISPLAY_V2_BACKFILL_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: Object.freeze({
      ...(error?.details ?? {}),
      confirmedRecordUpdates,
      dashboardPatchCount: 0,
      fieldMutationCount: 0,
      currentValueMutationCount: 0,
      recordCreateCount: 0,
      recordDeleteCount: 0,
    }),
    production: 'BLOCKED',
  });
  if (attemptRoot) await writePrivateJson(join(attemptRoot, 'failure.json'), failure);
  process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
  process.exitCode = 1;
}

function inspectRequiredFields(fields) {
  const resolved = {};
  for (const [key, identity] of Object.entries(REQUIRED_FIELD_IDENTITIES)) {
    const matches = fields.filter((field) => field.fieldId === identity.fieldId);
    if (matches.length !== 1) {
      throw operatorError(
        `Required field ${key} was not resolved exactly once`,
        'LARK_DASHBOARD_DISPLAY_V2_FIELD_IDENTITY_INVALID',
        { key, fieldId: identity.fieldId, matchCount: matches.length },
      );
    }
    const field = matches[0];
    if (field.fieldName !== identity.fieldName || field.type !== identity.type) {
      throw operatorError(
        `Required field ${key} does not match the reviewed name/type`,
        'LARK_DASHBOARD_DISPLAY_V2_FIELD_IDENTITY_INVALID',
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
      source: field,
    });
  }
  if (resolved.displaySelectV2.fieldId !== LARK_DASHBOARD_DISPLAY_V2_FIELD.fieldId) {
    throw operatorError(
      'Display v2 physical Field identity changed from the reviewed contract',
      'LARK_DASHBOARD_DISPLAY_V2_FIELD_IDENTITY_INVALID',
    );
  }
  return Object.freeze(resolved);
}

function buildPlan(records, fields) {
  return planLarkDashboardDisplayV2Backfill({
    records,
    fieldNames: {
      metricKey: fields.metricKey.fieldName,
      numberWindow: fields.numberWindow.fieldName,
      preservedWindowSelect: fields.preservedWindowSelect.fieldName,
      displaySelectV2: fields.displaySelectV2.fieldName,
      currentValue: fields.currentValue.fieldName,
      reportType: fields.reportType.fieldName,
      platform: fields.platform.fieldName,
      capability: fields.capability.fieldName,
      periodKind: fields.periodKind.fieldName,
      customerProfile: fields.customerProfile.fieldName,
      customerKey: fields.customerKey.fieldName,
      accountId: fields.accountId.fieldName,
    },
  });
}

function assertReviewedBoundary({ execute: executing, plan }) {
  if (plan.targetRecordCount !== EXPECTED_DASHBOARD_RECORD_COUNT
    || plan.targetCurrentValueNullCount !== EXPECTED_BASELINE_INCOMPLETE_NULL_COUNT
    || plan.conflictCount !== 0) {
    throw operatorError(
      'Live Organic Dashboard target state changed from the reviewed 272-row boundary',
      'LARK_DASHBOARD_DISPLAY_V2_LIVE_BOUNDARY_DRIFT',
      {
        recordCount: plan.recordCount,
        dashboardRecordCount: plan.targetRecordCount,
        targetCurrentValueNullCount: plan.targetCurrentValueNullCount,
        displayV2ConflictCount: plan.conflictCount,
        conflicts: plan.conflicts,
      },
    );
  }
  const initialState = plan.pendingUpdateCount === EXPECTED_PENDING_DISPLAY_V2_UPDATE_COUNT
    && plan.missingValueUpdateCount === EXPECTED_MISSING_DISPLAY_V2_UPDATE_COUNT
    && plan.reviewedAliasCorrectionCount === EXPECTED_REVIEWED_ALIAS_CORRECTION_COUNT
    && plan.convergedDisplayV2Count === EXPECTED_INITIAL_CONVERGED_DISPLAY_V2_COUNT
    && plan.populatedDisplayV2Count === EXPECTED_INITIAL_CONVERGED_DISPLAY_V2_COUNT;
  const convergedState = plan.pendingUpdateCount === 0
    && plan.missingValueUpdateCount === 0
    && plan.reviewedAliasCorrectionCount === 0
    && plan.convergedDisplayV2Count === EXPECTED_DASHBOARD_RECORD_COUNT
    && plan.populatedDisplayV2Count === EXPECTED_DASHBOARD_RECORD_COUNT;
  if (!initialState && !convergedState) {
    throw operatorError(
      'Display v2 state is neither the reviewed multichannel pre-apply state nor the converged state',
      'LARK_DASHBOARD_DISPLAY_V2_STATE_DRIFT',
      {
        pendingRecordUpdateCount: plan.pendingUpdateCount,
        missingValueUpdateCount: plan.missingValueUpdateCount,
        reviewedAliasCorrectionCount: plan.reviewedAliasCorrectionCount,
        convergedDisplayV2Count: plan.convergedDisplayV2Count,
        populatedDisplayV2Count: plan.populatedDisplayV2Count,
      },
    );
  }
  if (executing && !initialState) {
    throw operatorError(
      'Live execution requires the exact reviewed 204-row pre-apply state',
      'LARK_DASHBOARD_DISPLAY_V2_EXECUTION_STATE_INVALID',
      { pendingRecordUpdateCount: plan.pendingUpdateCount },
    );
  }
}

function assertConvergedBoundary(input) {
  const fingerprintMatches = input.finalImmutableFingerprint === input.immutableFingerprint;
  const recordCountStable = input.recordsAfter.length === input.initialRecordCount;
  if (!recordCountStable
    || input.finalPlan.targetRecordCount !== EXPECTED_DASHBOARD_RECORD_COUNT
    || input.finalPlan.targetCurrentValueNullCount !== EXPECTED_BASELINE_INCOMPLETE_NULL_COUNT
    || input.finalPlan.conflictCount !== 0
    || input.finalPlan.pendingUpdateCount !== 0
    || input.finalPlan.convergedDisplayV2Count !== EXPECTED_DASHBOARD_RECORD_COUNT
    || input.finalPlan.populatedDisplayV2Count !== EXPECTED_DASHBOARD_RECORD_COUNT
    || !fingerprintMatches) {
    throw operatorError(
      'Display v2 backfill did not converge without unrelated Record drift',
      'LARK_DASHBOARD_DISPLAY_V2_BACKFILL_NOT_CONVERGED',
      {
        initialRecordCount: input.initialRecordCount,
        finalRecordCount: input.recordsAfter.length,
        recordCountStable,
        dashboardRecordCount: input.finalPlan.targetRecordCount,
        targetCurrentValueNullCount: input.finalPlan.targetCurrentValueNullCount,
        pendingRecordUpdateCount: input.finalPlan.pendingUpdateCount,
        displayV2ConflictCount: input.finalPlan.conflictCount,
        convergedDisplayV2Count: input.finalPlan.convergedDisplayV2Count,
        immutableRecordFingerprintMatches: fingerprintMatches,
      },
    );
  }
}

function fingerprintRecordsExcludingField(records, excludedFieldName) {
  const projection = [...records]
    .sort((left, right) => left.recordId.localeCompare(right.recordId))
    .map((record) => ({
      recordId: record.recordId,
      fields: Object.fromEntries(
        Object.entries(record.fields ?? {})
          .filter(([fieldName]) => fieldName !== excludedFieldName)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([fieldName, value]) => [fieldName, normalizeFingerprintValue(value)]),
      ),
    }));
  return createHash('sha256').update(JSON.stringify(projection)).digest('hex');
}

function normalizeFingerprintValue(value) {
  if (Array.isArray(value)) return value.map(normalizeFingerprintValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizeFingerprintValue(nested)]),
    );
  }
  return value;
}

function uniqueByName(items, name, label) {
  const matches = items.filter((item) => item.name === name);
  if (matches.length !== 1) {
    throw operatorError(
      `${label} must resolve exactly once`,
      'LARK_DASHBOARD_DISPLAY_V2_RESOURCE_UNRESOLVED',
      { name, matchCount: matches.length },
    );
  }
  return matches[0];
}

async function resolveRepositoryRoot() {
  const result = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  });
  return resolve(requireText(result.stdout, 'repository root'));
}

async function assertExactMain(repositoryRoot) {
  const status = await git(repositoryRoot, ['status', '--porcelain']);
  if (status.trim()) {
    throw operatorError(
      'Repository must be clean before Live display v2 backfill',
      'LARK_DASHBOARD_DISPLAY_V2_REPOSITORY_DIRTY',
    );
  }
  const head = (await git(repositoryRoot, ['rev-parse', 'HEAD'])).trim();
  const originMain = (await git(repositoryRoot, ['rev-parse', 'origin/main'])).trim();
  if (head !== originMain) {
    throw operatorError(
      'Repository HEAD must equal sealed origin/main',
      'LARK_DASHBOARD_DISPLAY_V2_MAIN_MISMATCH',
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
      'LARK_DASHBOARD_DISPLAY_V2_VALUE_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkDashboardDisplayV2CompatibilityOperatorError';
  error.code = code;
  error.details = details;
  return error;
}
