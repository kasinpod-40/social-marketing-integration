#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  LARK_DASHBOARD_WINDOW_FIELD,
  LARK_DASHBOARD_WINDOW_OPTION_ORDER_VERSION,
  assertLarkDashboardWindowOptionOrderConfirmation,
  buildLarkDashboardWindowFieldMutation,
  planLarkDashboardWindowOptionOrder,
} from './lib/lark-dashboard-window-option-order-v1.js';

const execFileAsync = promisify(execFile);
const EXPECTED_RECORD_COUNT = 86;
const args = new Set(process.argv.slice(2));
const execute = args.has('--execute');
let currentStage = 'init';
let attemptRoot = null;
let fieldMetadataMutationConfirmed = false;

try {
  const repositoryRoot = await resolveRepositoryRoot();
  const evidenceRoot = resolve(
    process.env.MKT_LARK_DASHBOARD_WINDOW_OPTION_ORDER_EVIDENCE_DIR
      ?? join(repositoryRoot, 'outputs', 'lark-dashboard-window-option-order-v1'),
  );
  attemptRoot = join(
    evidenceRoot,
    `window-option-order-${new Date().toISOString().replaceAll(':', '-')}`,
  );
  await mkdir(attemptRoot, { recursive: true, mode: 0o700 });

  if (execute) {
    currentStage = 'confirm-field-metadata-execution';
    assertLarkDashboardWindowOptionOrderConfirmation(
      process.env.CONFIRM_LARK_DASHBOARD_WINDOW_OPTION_ORDER,
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
  const table = uniqueByName(
    tables,
    LARK_DASHBOARD_WINDOW_FIELD.tableName,
    'Report Metric table',
  );
  const tableId = requireText(table.tableId, 'Report Metric tableId');

  currentStage = 'read-field-and-record-state';
  const fieldsBefore = await client.listFields({ tableId });
  const targetFieldBefore = uniqueByFieldId(
    fieldsBefore,
    LARK_DASHBOARD_WINDOW_FIELD.fieldId,
    'Window SingleSelect field',
  );
  const recordsBefore = await client.listRecords({
    tableId,
    includeRecordMetadata: false,
  });
  if (recordsBefore.length !== EXPECTED_RECORD_COUNT) {
    throw operatorError(
      'Report Metric record count changed from the reviewed boundary',
      'LARK_DASHBOARD_WINDOW_OPTION_ORDER_RECORD_BOUNDARY_DRIFT',
      { expectedRecordCount: EXPECTED_RECORD_COUNT, actualRecordCount: recordsBefore.length },
    );
  }

  const planBefore = planLarkDashboardWindowOptionOrder(targetFieldBefore);
  const recordFingerprintBefore = fingerprintRecords(recordsBefore);
  const otherFieldsFingerprintBefore = fingerprintOtherFields(
    fieldsBefore,
    LARK_DASHBOARD_WINDOW_FIELD.fieldId,
  );
  const targetFieldContentFingerprintBefore = fingerprintTargetFieldContent(targetFieldBefore);

  if (execute && !planBefore.reorderRequired) {
    throw operatorError(
      'Live execution requires the exact reviewed 3,7,1,30 pre-apply order',
      'LARK_DASHBOARD_WINDOW_OPTION_ORDER_EXECUTION_STATE_INVALID',
      { currentOrder: planBefore.currentOrder },
    );
  }

  const preview = Object.freeze({
    ok: true,
    mode: execute ? 'execute' : 'preview',
    contractVersion: LARK_DASHBOARD_WINDOW_OPTION_ORDER_VERSION,
    decision: execute
      ? 'LARK_DASHBOARD_WINDOW_OPTION_ORDER_EXECUTION_AUTHORIZED'
      : 'LARK_DASHBOARD_WINDOW_OPTION_ORDER_PREVIEW_READY',
    tableName: LARK_DASHBOARD_WINDOW_FIELD.tableName,
    tableId,
    fieldId: targetFieldBefore.fieldId,
    fieldName: targetFieldBefore.fieldName,
    fieldType: targetFieldBefore.type,
    currentOrder: planBefore.currentOrder,
    desiredOrder: planBefore.desiredOrder,
    currentOptionIds: planBefore.currentOptionIds,
    desiredOptionIds: planBefore.desiredOptionIds,
    optionIdSetPreserved: sameSet(planBefore.currentOptionIds, planBefore.desiredOptionIds),
    optionNameSetPreserved: sameSet(planBefore.currentOrder, planBefore.desiredOrder),
    reorderRequired: planBefore.reorderRequired,
    recordCount: recordsBefore.length,
    recordFingerprint: recordFingerprintBefore,
    otherFieldsFingerprint: otherFieldsFingerprintBefore,
    targetFieldContentFingerprint: targetFieldContentFingerprintBefore,
    fieldIdentityMutationCount: 0,
    optionCreateCount: 0,
    optionDeleteCount: 0,
    optionRenameCount: 0,
    optionColorMutationCount: 0,
    recordMutationCount: 0,
    currentValueMutationCount: 0,
    dashboardPatchCount: 0,
    remoteMutationCount: 0,
    production: 'BLOCKED',
    evidenceRoot: attemptRoot,
  });
  await writePrivateJson(join(attemptRoot, 'window-option-order-plan.json'), preview);
  process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
  if (!execute) process.exit(0);

  currentStage = 'backup-field-and-record-fingerprints';
  await writePrivateJson(join(attemptRoot, 'window-option-order-before.json'), {
    contractVersion: LARK_DASHBOARD_WINDOW_OPTION_ORDER_VERSION,
    tableId,
    targetField: targetFieldBefore,
    currentOrder: planBefore.currentOrder,
    desiredOrder: planBefore.desiredOrder,
    recordCount: recordsBefore.length,
    recordFingerprint: recordFingerprintBefore,
    otherFieldsFingerprint: otherFieldsFingerprintBefore,
    targetFieldContentFingerprint: targetFieldContentFingerprintBefore,
  });

  currentStage = 'update-window-option-order';
  const mutation = buildLarkDashboardWindowFieldMutation(planBefore);
  await writePrivateJson(join(attemptRoot, 'window-option-order-request.json'), {
    contractVersion: LARK_DASHBOARD_WINDOW_OPTION_ORDER_VERSION,
    tableId,
    fieldId: targetFieldBefore.fieldId,
    field: mutation,
  });
  await client.updateField({
    tableId,
    fieldId: targetFieldBefore.fieldId,
    field: mutation,
  });
  fieldMetadataMutationConfirmed = true;

  currentStage = 'verify-window-option-order-convergence';
  const fieldsAfter = await client.listFields({ tableId });
  const targetFieldAfter = uniqueByFieldId(
    fieldsAfter,
    LARK_DASHBOARD_WINDOW_FIELD.fieldId,
    'Window SingleSelect field',
  );
  const recordsAfter = await client.listRecords({
    tableId,
    includeRecordMetadata: false,
  });
  const planAfter = planLarkDashboardWindowOptionOrder(targetFieldAfter);
  const recordFingerprintAfter = fingerprintRecords(recordsAfter);
  const otherFieldsFingerprintAfter = fingerprintOtherFields(
    fieldsAfter,
    LARK_DASHBOARD_WINDOW_FIELD.fieldId,
  );
  const targetFieldContentFingerprintAfter = fingerprintTargetFieldContent(targetFieldAfter);

  if (!planAfter.converged
    || planAfter.reorderRequired
    || recordsAfter.length !== recordsBefore.length
    || recordFingerprintAfter !== recordFingerprintBefore
    || otherFieldsFingerprintAfter !== otherFieldsFingerprintBefore
    || targetFieldContentFingerprintAfter !== targetFieldContentFingerprintBefore) {
    throw operatorError(
      'Window option reorder did not converge without unrelated mutation',
      'LARK_DASHBOARD_WINDOW_OPTION_ORDER_NOT_CONVERGED',
      {
        currentOrder: planAfter.currentOrder,
        desiredOrder: planAfter.desiredOrder,
        recordCountBefore: recordsBefore.length,
        recordCountAfter: recordsAfter.length,
        recordFingerprintMatches: recordFingerprintAfter === recordFingerprintBefore,
        otherFieldsFingerprintMatches:
          otherFieldsFingerprintAfter === otherFieldsFingerprintBefore,
        targetFieldContentFingerprintMatches:
          targetFieldContentFingerprintAfter === targetFieldContentFingerprintBefore,
      },
    );
  }

  const summary = Object.freeze({
    ok: true,
    contractVersion: LARK_DASHBOARD_WINDOW_OPTION_ORDER_VERSION,
    decision: 'LARK_DASHBOARD_WINDOW_OPTION_ORDER_COMPLETED_SAFE',
    tableName: LARK_DASHBOARD_WINDOW_FIELD.tableName,
    recordCount: recordsAfter.length,
    fieldId: targetFieldAfter.fieldId,
    fieldName: targetFieldAfter.fieldName,
    previousOrder: planBefore.currentOrder,
    currentOrder: planAfter.currentOrder,
    optionIds: planAfter.currentOptionIds,
    optionIdSetPreserved: true,
    optionNameSetPreserved: true,
    recordFingerprintMatches: true,
    otherFieldsFingerprintMatches: true,
    targetFieldContentFingerprintMatches: true,
    fieldMetadataMutationCount: 1,
    fieldIdentityMutationCount: 0,
    optionCreateCount: 0,
    optionDeleteCount: 0,
    optionRenameCount: 0,
    optionColorMutationCount: 0,
    recordMutationCount: 0,
    currentValueMutationCount: 0,
    dashboardPatchCount: 0,
    remoteLarkMutationCount: 1,
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
    contractVersion: LARK_DASHBOARD_WINDOW_OPTION_ORDER_VERSION,
    stage: currentStage,
    code: error?.code ?? 'LARK_DASHBOARD_WINDOW_OPTION_ORDER_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: Object.freeze({
      ...(error?.details ?? {}),
      fieldMetadataMutationConfirmed,
      fieldIdentityMutationCount: 0,
      optionCreateCount: 0,
      optionDeleteCount: 0,
      optionRenameCount: 0,
      optionColorMutationCount: 0,
      recordMutationCount: 0,
      currentValueMutationCount: 0,
      dashboardPatchCount: 0,
    }),
    production: 'BLOCKED',
  });
  if (attemptRoot) await writePrivateJson(join(attemptRoot, 'failure.json'), failure);
  process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
  process.exitCode = 1;
}

function uniqueByName(items, name, label) {
  const matches = items.filter((item) => item.name === name);
  if (matches.length !== 1) {
    throw operatorError(
      `${label} must resolve exactly once`,
      'LARK_DASHBOARD_WINDOW_OPTION_ORDER_RESOURCE_UNRESOLVED',
      { name, matchCount: matches.length },
    );
  }
  return matches[0];
}

function uniqueByFieldId(items, fieldId, label) {
  const matches = items.filter((item) => item.fieldId === fieldId);
  if (matches.length !== 1) {
    throw operatorError(
      `${label} must resolve exactly once`,
      'LARK_DASHBOARD_WINDOW_OPTION_ORDER_RESOURCE_UNRESOLVED',
      { fieldId, matchCount: matches.length },
    );
  }
  return matches[0];
}

function fingerprintRecords(records) {
  const normalized = [...records]
    .sort((left, right) => String(left.recordId).localeCompare(String(right.recordId)))
    .map((record) => ({
      recordId: record.recordId,
      fields: normalizeForFingerprint(record.fields ?? {}),
    }));
  return sha256(normalized);
}

function fingerprintOtherFields(fields, excludedFieldId) {
  const normalized = fields
    .filter((field) => field.fieldId !== excludedFieldId)
    .sort((left, right) => String(left.fieldId).localeCompare(String(right.fieldId)))
    .map(normalizeForFingerprint);
  return sha256(normalized);
}

function fingerprintTargetFieldContent(field) {
  const normalized = normalizeForFingerprint({
    fieldId: field.fieldId,
    fieldName: field.fieldName,
    type: field.type,
    uiType: field.uiType,
    description: field.description,
    isPrimary: field.isPrimary,
    property: {
      ...(field.property ?? {}),
      options: [...(field.property?.options ?? [])]
        .map(normalizeForFingerprint)
        .sort((left, right) => String(left.id).localeCompare(String(right.id))),
    },
  });
  return sha256(normalized);
}

function normalizeForFingerprint(value) {
  if (Array.isArray(value)) return value.map(normalizeForFingerprint);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizeForFingerprint(nested)]),
    );
  }
  return value;
}

function sameSet(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
      'Repository must be clean before Live Window option reorder',
      'LARK_DASHBOARD_WINDOW_OPTION_ORDER_REPOSITORY_DIRTY',
    );
  }
  const head = (await git(repositoryRoot, ['rev-parse', 'HEAD'])).trim();
  const originMain = (await git(repositoryRoot, ['rev-parse', 'origin/main'])).trim();
  if (head !== originMain) {
    throw operatorError(
      'Repository HEAD must equal sealed origin/main',
      'LARK_DASHBOARD_WINDOW_OPTION_ORDER_MAIN_MISMATCH',
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
  if (typeof value !== 'string' || value.trim() === '') {
    throw operatorError(
      `${fieldName} is required`,
      'LARK_DASHBOARD_WINDOW_OPTION_ORDER_VALUE_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkDashboardWindowOptionOrderOperatorError';
  error.code = code;
  error.details = details;
  return error;
}
