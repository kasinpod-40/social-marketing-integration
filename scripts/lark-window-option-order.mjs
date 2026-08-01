#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  CONFIRMATION,
  LARK_WINDOW_OPTION_ORDER_VERSION,
  TARGET_FIELD,
  assertConfirmation,
  planWindowOptionOrder,
} from './lib/lark-window-option-order-v1.js';

const execFileAsync = promisify(execFile);
const TABLE_NAME = '📊 MKT_Report_Metric_Values';
const execute = new Set(process.argv.slice(2)).has('--execute');
let stage = 'init';
let attemptRoot = null;

try {
  const repositoryRoot = await resolveRepositoryRoot();
  const evidenceBase = resolve(
    process.env.MKT_LARK_WINDOW_OPTION_ORDER_EVIDENCE_DIR
      ?? join(repositoryRoot, 'outputs', 'lark-window-option-order-v1'),
  );
  attemptRoot = join(evidenceBase, `attempt-${new Date().toISOString().replaceAll(':', '-')}`);
  await mkdir(attemptRoot, { recursive: true, mode: 0o700 });

  if (execute) {
    stage = 'confirm-execution';
    assertConfirmation(process.env.CONFIRM_LARK_WINDOW_OPTION_ORDER);
    await assertExactMain(repositoryRoot);
  }

  stage = 'read-environment';
  const fileEnv = await readDevVars(resolve(repositoryRoot, process.env.DEV_VARS_FILE ?? '.dev.vars'));
  const env = Object.freeze({ ...fileEnv, ...process.env });
  const client = createLarkBitableClientFromEnv(env);

  stage = 'resolve-table-and-field';
  const tables = await client.listTables();
  const table = uniqueByName(tables, TABLE_NAME, 'Report Metric table');
  const fields = await client.listFields({ tableId: table.tableId });
  const field = uniqueById(fields, TARGET_FIELD.fieldId, 'Window Select Field');
  const plan = planWindowOptionOrder(field);

  const preview = Object.freeze({
    ok: true,
    mode: execute ? 'execute' : 'preview',
    contractVersion: LARK_WINDOW_OPTION_ORDER_VERSION,
    decision: execute
      ? 'LARK_WINDOW_OPTION_ORDER_EXECUTION_AUTHORIZED'
      : 'LARK_WINDOW_OPTION_ORDER_PREVIEW_READY',
    tableId: table.tableId,
    fieldId: plan.fieldId,
    fieldName: plan.fieldName,
    currentOrder: plan.currentOrder,
    desiredOrder: plan.desiredOrder,
    currentOptionIds: plan.currentOptionIds,
    desiredOptionIds: plan.desiredOptionIds,
    optionIdentityPreserved: plan.optionIdentityPreserved,
    pendingFieldMetadataUpdateCount: plan.pendingFieldMetadataUpdateCount,
    recordMutationCount: 0,
    currentValueMutationCount: 0,
    dashboardMutationCount: 0,
    fieldRenameCount: 0,
    fieldDeleteCount: 0,
    optionCreateCount: 0,
    optionDeleteCount: 0,
    remoteMutationCount: 0,
    production: 'BLOCKED',
    evidenceRoot: attemptRoot,
  });
  await writePrivateJson(join(attemptRoot, 'plan.json'), preview);
  process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
  if (!execute) process.exit(0);

  if (plan.alreadyConverged) {
    throw operatorError('Field options are already in the desired order', 'LARK_WINDOW_OPTION_ORDER_ALREADY_CONVERGED');
  }
  if (!plan.optionIdentityPreserved || plan.pendingFieldMetadataUpdateCount !== 1) {
    throw operatorError('Reviewed option identity/order plan is invalid', 'LARK_WINDOW_OPTION_ORDER_PLAN_INVALID');
  }

  stage = 'backup-field';
  await writePrivateJson(join(attemptRoot, 'field-before.json'), field);

  stage = 'update-field-option-order';
  await client.updateField({
    tableId: table.tableId,
    fieldId: field.fieldId,
    field: plan.desiredField,
  });

  stage = 'verify-readback';
  const fieldsAfter = await client.listFields({ tableId: table.tableId });
  const fieldAfter = uniqueById(fieldsAfter, TARGET_FIELD.fieldId, 'Window Select Field after update');
  const finalPlan = planWindowOptionOrder(fieldAfter);

  if (!finalPlan.alreadyConverged
    || finalPlan.pendingFieldMetadataUpdateCount !== 0
    || !finalPlan.optionIdentityPreserved) {
    throw operatorError('Window option order did not converge', 'LARK_WINDOW_OPTION_ORDER_NOT_CONVERGED', {
      currentOrder: finalPlan.currentOrder,
      desiredOrder: finalPlan.desiredOrder,
    });
  }

  const summary = Object.freeze({
    ok: true,
    contractVersion: LARK_WINDOW_OPTION_ORDER_VERSION,
    decision: 'LARK_WINDOW_OPTION_ORDER_COMPLETED_SAFE',
    tableId: table.tableId,
    fieldId: fieldAfter.fieldId,
    fieldName: fieldAfter.fieldName,
    finalOrder: finalPlan.currentOrder,
    finalOptionIds: finalPlan.currentOptionIds,
    optionIdentityPreserved: finalPlan.optionIdentityPreserved,
    confirmedFieldMetadataUpdateCount: 1,
    pendingFieldMetadataUpdateCount: 0,
    recordMutationCount: 0,
    currentValueMutationCount: 0,
    dashboardMutationCount: 0,
    fieldRenameCount: 0,
    fieldDeleteCount: 0,
    optionCreateCount: 0,
    optionDeleteCount: 0,
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
    contractVersion: LARK_WINDOW_OPTION_ORDER_VERSION,
    stage,
    code: error?.code ?? 'LARK_WINDOW_OPTION_ORDER_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: error?.details ?? {},
    recordMutationCount: 0,
    currentValueMutationCount: 0,
    dashboardMutationCount: 0,
    production: 'BLOCKED',
  });
  if (attemptRoot) await writePrivateJson(join(attemptRoot, 'failure.json'), failure);
  process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
  process.exitCode = 1;
}

function uniqueByName(items, name, label) {
  const matches = items.filter((item) => item.name === name);
  if (matches.length !== 1) throw operatorError(`${label} must resolve exactly once`, 'LARK_WINDOW_OPTION_RESOURCE_UNRESOLVED', { name, matchCount: matches.length });
  return matches[0];
}

function uniqueById(items, fieldId, label) {
  const matches = items.filter((item) => item.fieldId === fieldId);
  if (matches.length !== 1) throw operatorError(`${label} must resolve exactly once`, 'LARK_WINDOW_OPTION_RESOURCE_UNRESOLVED', { fieldId, matchCount: matches.length });
  return matches[0];
}

async function resolveRepositoryRoot() {
  const result = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  return resolve(String(result.stdout).trim());
}

async function assertExactMain(repositoryRoot) {
  const status = String((await execFileAsync('git', ['status', '--porcelain'], { cwd: repositoryRoot, encoding: 'utf8' })).stdout ?? '');
  if (status.trim()) throw operatorError('Repository must be clean before Live option reorder', 'LARK_WINDOW_OPTION_REPOSITORY_DIRTY');
  const head = String((await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' })).stdout).trim();
  const originMain = String((await execFileAsync('git', ['rev-parse', 'origin/main'], { cwd: repositoryRoot, encoding: 'utf8' })).stdout).trim();
  if (head !== originMain) throw operatorError('Repository HEAD must equal sealed origin/main', 'LARK_WINDOW_OPTION_MAIN_MISMATCH', { head, originMain });
}

async function writePrivateJson(path, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path, text, { mode: 0o600 });
  await writeFile(`${path}.sha256`, `${createHash('sha256').update(text).digest('hex')}  ${path.split('/').at(-1)}\n`, { mode: 0o600 });
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkWindowOptionOrderOperatorError';
  error.code = code;
  error.details = details;
  return error;
}
