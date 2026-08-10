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
  EXPECTED_DASHBOARD_RECORD_COUNT,
  assertLarkDashboardDisplayV2Options,
  planLarkDashboardDisplayV2Backfill,
} from './lib/lark-dashboard-display-v2-compatibility-v1.js';

const execFileAsync = promisify(execFile);
const CONTRACT_VERSION = 'organic-display-v2-current-slot-repair-v1';
const CONFIRMATION = 'APPLY_ORGANIC_DISPLAY_V2_CURRENT_SLOT_REPAIR_V1';
const REPORT_TABLE_NAME = '📊 MKT_Report_Metric_Values';
const execute = new Set(process.argv.slice(2)).has('--execute');
let stage = 'init';
let evidenceRoot = null;
let confirmedUpdates = 0;

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
  evidenceRoot = resolve(
    process.env.MKT_ORGANIC_DISPLAY_V2_CURRENT_SLOT_EVIDENCE_DIR
      ?? join(repositoryRoot, 'outputs', 'organic-display-v2-current-slot-repair'),
    `attempt-${new Date().toISOString().replaceAll(':', '-')}`,
  );
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });

  if (execute) {
    stage = 'confirmation';
    if (process.env.CONFIRM_ORGANIC_DISPLAY_V2_CURRENT_SLOT_REPAIR !== CONFIRMATION) {
      throw operatorError(
        'Organic Display V2 current-slot repair confirmation is missing',
        'ORGANIC_DISPLAY_V2_CURRENT_SLOT_CONFIRMATION_REQUIRED',
      );
    }
    await assertExactMain(repositoryRoot);
  }

  stage = 'environment';
  const fileEnv = await readDevVars(resolve(repositoryRoot, process.env.DEV_VARS_FILE ?? '.dev.vars'));
  const env = Object.freeze({ ...fileEnv, ...process.env });
  const client = createLarkBitableClientFromEnv(env);

  stage = 'read-state';
  const tables = await client.listTables();
  const table = uniqueByName(tables, REPORT_TABLE_NAME);
  const tableId = requireText(table.tableId, 'Report Metric tableId');
  const fields = await client.listFields({ tableId });
  const fieldState = inspectRequiredFields(fields);
  assertLarkDashboardDisplayV2Options(fieldState.displaySelectV2.source);
  const records = await client.listRecords({ tableId, includeRecordMetadata: false });
  const plan = buildPlan(records, fieldState);
  assertCurrentSlotBoundary(plan);
  const fingerprint = fingerprintExcludingDisplay(records, fieldState.displaySelectV2.fieldName);

  const preview = Object.freeze({
    ok: true,
    mode: execute ? 'execute' : 'preview',
    contractVersion: CONTRACT_VERSION,
    decision: execute
      ? 'ORGANIC_DISPLAY_V2_CURRENT_SLOT_EXECUTION_PLANNED'
      : 'ORGANIC_DISPLAY_V2_CURRENT_SLOT_PREVIEW_READY',
    recordCount: records.length,
    dashboardRecordCount: plan.targetRecordCount,
    convergedDisplayV2Count: plan.convergedDisplayV2Count,
    pendingRecordUpdateCount: plan.pendingUpdateCount,
    displayV2ConflictCount: plan.conflictCount,
    platformCounts: plan.platformCounts,
    currentValueMutationCount: 0,
    recordCreateCount: 0,
    recordDeleteCount: 0,
    dashboardPatchCount: 0,
    queueSendCount: 0,
    d1MutationCount: 0,
    workerDeploymentCount: 0,
    production: 'BLOCKED',
    evidenceRoot,
  });
  await writePrivateJson(join(evidenceRoot, 'preview.json'), {
    ...preview,
    immutableFingerprint: fingerprint,
    updates: plan.updates.map((update) => ({
      recordId: update.recordId,
      platform: update.platform,
      metricKey: update.metricKey,
      windowDays: update.windowDays,
      previousDisplayV2: update.previousDisplayV2,
      desiredDisplayV2: update.desiredDisplayV2,
    })),
  });
  process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);

  if (execute && plan.pendingUpdateCount > 0) {
    stage = 'backup';
    await writePrivateJson(join(evidenceRoot, 'before.json'), {
      contractVersion: CONTRACT_VERSION,
      recordCount: records.length,
      immutableFingerprint: fingerprint,
      updates: plan.updates,
    });

    stage = 'record-only-update';
    const result = await client.batchUpdateRecords({
      tableId,
      records: plan.updates.map((update) => ({ recordId: update.recordId, fields: update.fields })),
    });
    confirmedUpdates = Number(result.updated ?? 0);
    if (confirmedUpdates !== plan.pendingUpdateCount) {
      throw operatorError(
        'Organic Display V2 update count did not match the preview plan',
        'ORGANIC_DISPLAY_V2_CURRENT_SLOT_UPDATE_COUNT_MISMATCH',
        { planned: plan.pendingUpdateCount, confirmed: confirmedUpdates },
      );
    }
  }

  if (execute) {
    stage = 'readback';
    const recordsAfter = await client.listRecords({ tableId, includeRecordMetadata: false });
    const finalPlan = buildPlan(recordsAfter, fieldState);
    const finalFingerprint = fingerprintExcludingDisplay(recordsAfter, fieldState.displaySelectV2.fieldName);
    if (recordsAfter.length !== records.length
      || finalPlan.targetRecordCount !== EXPECTED_DASHBOARD_RECORD_COUNT
      || finalPlan.conflictCount !== 0
      || finalPlan.pendingUpdateCount !== 0
      || finalPlan.convergedDisplayV2Count !== EXPECTED_DASHBOARD_RECORD_COUNT
      || finalFingerprint !== fingerprint) {
      throw operatorError(
        'Organic Display V2 current-slot repair did not converge without unrelated drift',
        'ORGANIC_DISPLAY_V2_CURRENT_SLOT_VERIFY_FAILED',
        {
          initialRecordCount: records.length,
          finalRecordCount: recordsAfter.length,
          dashboardRecordCount: finalPlan.targetRecordCount,
          pendingRecordUpdateCount: finalPlan.pendingUpdateCount,
          displayV2ConflictCount: finalPlan.conflictCount,
          convergedDisplayV2Count: finalPlan.convergedDisplayV2Count,
          unrelatedFingerprintStable: finalFingerprint === fingerprint,
        },
      );
    }

    const summary = Object.freeze({
      ok: true,
      decision: 'ORGANIC_DISPLAY_V2_CURRENT_SLOT_CONVERGED',
      contractVersion: CONTRACT_VERSION,
      recordCount: recordsAfter.length,
      dashboardRecordCount: finalPlan.targetRecordCount,
      confirmedRecordUpdateCount: confirmedUpdates,
      pendingRecordUpdateCount: 0,
      convergedDisplayV2Count: finalPlan.convergedDisplayV2Count,
      platformCounts: finalPlan.platformCounts,
      currentValueMutationCount: 0,
      recordCreateCount: 0,
      recordDeleteCount: 0,
      dashboardPatchCount: 0,
      queueSendCount: 0,
      d1MutationCount: 0,
      workerDeploymentCount: 0,
      production: 'BLOCKED',
      evidenceRoot,
    });
    await writePrivateJson(join(evidenceRoot, 'summary.json'), summary);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
} catch (error) {
  const failure = Object.freeze({
    ok: false,
    contractVersion: CONTRACT_VERSION,
    stage,
    code: error?.code ?? 'ORGANIC_DISPLAY_V2_CURRENT_SLOT_REPAIR_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: Object.freeze({ ...(error?.details ?? {}), confirmedUpdates }),
    currentValueMutationCount: 0,
    recordCreateCount: 0,
    recordDeleteCount: 0,
    dashboardPatchCount: 0,
    queueSendCount: 0,
    d1MutationCount: 0,
    workerDeploymentCount: 0,
    production: 'BLOCKED',
  });
  if (evidenceRoot) await writePrivateJson(join(evidenceRoot, 'failure.json'), failure);
  process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
  process.exitCode = 1;
}

function buildPlan(records, fieldState) {
  return planLarkDashboardDisplayV2Backfill({
    records,
    fieldNames: {
      metricKey: fieldState.metricKey.fieldName,
      numberWindow: fieldState.numberWindow.fieldName,
      preservedWindowSelect: fieldState.preservedWindowSelect.fieldName,
      displaySelectV2: fieldState.displaySelectV2.fieldName,
      currentValue: fieldState.currentValue.fieldName,
      reportType: fieldState.reportType.fieldName,
      platform: fieldState.platform.fieldName,
      capability: fieldState.capability.fieldName,
      periodKind: fieldState.periodKind.fieldName,
      customerProfile: fieldState.customerProfile.fieldName,
      customerKey: fieldState.customerKey.fieldName,
      accountId: fieldState.accountId.fieldName,
    },
  });
}

function assertCurrentSlotBoundary(plan) {
  if (plan.targetRecordCount !== EXPECTED_DASHBOARD_RECORD_COUNT || plan.conflictCount !== 0) {
    throw operatorError(
      'Current Organic Dashboard matrix is not the exact 272-row reviewed shape',
      'ORGANIC_DISPLAY_V2_CURRENT_SLOT_BOUNDARY_DRIFT',
      {
        recordCount: plan.recordCount,
        dashboardRecordCount: plan.targetRecordCount,
        displayV2ConflictCount: plan.conflictCount,
        conflicts: plan.conflicts,
      },
    );
  }
  if (plan.pendingUpdateCount < 0 || plan.pendingUpdateCount > EXPECTED_DASHBOARD_RECORD_COUNT) {
    throw operatorError(
      'Current Organic Dashboard pending repair count is outside the reviewed matrix',
      'ORGANIC_DISPLAY_V2_CURRENT_SLOT_PENDING_INVALID',
      { pendingRecordUpdateCount: plan.pendingUpdateCount },
    );
  }
}

function inspectRequiredFields(fields) {
  const resolved = {};
  for (const [key, identity] of Object.entries(REQUIRED_FIELD_IDENTITIES)) {
    const matches = fields.filter((field) => field.fieldId === identity.fieldId);
    if (matches.length !== 1) {
      throw operatorError('Required Dashboard compatibility field was not resolved exactly once',
        'ORGANIC_DISPLAY_V2_FIELD_IDENTITY_INVALID', { key, fieldId: identity.fieldId, matchCount: matches.length });
    }
    const field = matches[0];
    if (field.fieldName !== identity.fieldName || Number(field.type) !== identity.type) {
      throw operatorError('Required Dashboard compatibility field identity changed',
        'ORGANIC_DISPLAY_V2_FIELD_IDENTITY_INVALID', {
          key,
          fieldId: identity.fieldId,
          expectedFieldName: identity.fieldName,
          actualFieldName: field.fieldName,
          expectedType: identity.type,
          actualType: field.type,
        });
    }
    resolved[key] = Object.freeze({
      fieldId: field.fieldId,
      fieldName: field.fieldName,
      type: Number(field.type),
      source: field,
    });
  }
  if (resolved.displaySelectV2.fieldId !== LARK_DASHBOARD_DISPLAY_V2_FIELD.fieldId) {
    throw operatorError('Display V2 physical field identity changed', 'ORGANIC_DISPLAY_V2_FIELD_IDENTITY_INVALID');
  }
  return Object.freeze(resolved);
}

function fingerprintExcludingDisplay(records, fieldName) {
  const projected = [...records]
    .sort((a, b) => String(a.recordId).localeCompare(String(b.recordId)))
    .map((record) => {
      const fields = { ...(record.fields ?? {}) };
      delete fields[fieldName];
      return { recordId: record.recordId, fields };
    });
  return createHash('sha256').update(JSON.stringify(projected)).digest('hex');
}

async function assertExactMain(repositoryRoot) {
  const branch = (await git(repositoryRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  const head = (await git(repositoryRoot, ['rev-parse', 'HEAD'])).trim();
  const originMain = (await git(repositoryRoot, ['rev-parse', 'origin/main'])).trim();
  const status = (await git(repositoryRoot, ['status', '--porcelain'])).trim();
  if (branch !== 'main' || head !== originMain || status !== '') {
    throw operatorError('Live Organic Display V2 repair requires clean exact main == origin/main',
      'ORGANIC_DISPLAY_V2_REPOSITORY_INVALID', { branch, headMatchesOriginMain: head === originMain, clean: status === '' });
  }
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
  if (matches.length !== 1) {
    throw operatorError(`Expected exactly one ${name} table`, 'ORGANIC_DISPLAY_V2_TABLE_INVALID', { matchCount: matches.length });
  }
  return matches[0];
}

async function writePrivateJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'OrganicDisplayV2CurrentSlotRepairError';
  error.code = code;
  error.details = Object.freeze(details);
  return error;
}
