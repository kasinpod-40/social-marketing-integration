#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  assertReportLarkCurrentSlotRetentionConfirmation,
  planReportLarkCurrentSlotRetention,
  reportLarkCurrentSlotTableRoles,
  REPORT_LARK_CURRENT_SLOT_RETENTION_CONFIRMATION,
  REPORT_LARK_CURRENT_SLOT_RETENTION_VERSION,
} from './lib/report-lark-current-slot-retention.js';

const execFileAsync = promisify(execFile);
const execute = new Set(process.argv.slice(2)).has('--execute');
const SLOT_FIELD = 'lark_slot_key';
const BATCH_SIZE = 100;
let stage = 'init';
let evidenceRoot = null;
let confirmedUpdates = 0;
let confirmedDeletes = 0;

try {
  const repositoryRoot = await resolveRepositoryRoot();
  evidenceRoot = resolve(
    process.env.MKT_REPORT_LARK_RETENTION_EVIDENCE_DIR
      ?? join(repositoryRoot, 'outputs', 'report-lark-current-slot-retention'),
    `attempt-${new Date().toISOString().replaceAll(':', '-')}`,
  );
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });

  if (execute) {
    stage = 'confirmation';
    assertReportLarkCurrentSlotRetentionConfirmation(
      process.env.CONFIRM_REPORT_LARK_CURRENT_SLOT_RETENTION,
    );
    await assertExactMain(repositoryRoot);
  }

  stage = 'environment';
  const fileEnv = await readDevVars(resolve(repositoryRoot, process.env.DEV_VARS_FILE ?? '.dev.vars'));
  const env = Object.freeze({ ...fileEnv, ...process.env });
  const client = createLarkBitableClientFromEnv(env);

  stage = 'table-read';
  const tables = await client.listTables();
  const roles = reportLarkCurrentSlotTableRoles();
  const plans = {};
  const resolvedTables = {};

  for (const [role, contract] of Object.entries(roles)) {
    const table = uniqueByName(tables, contract.tableName);
    const tableId = requireText(table.tableId, `${contract.tableName} tableId`);
    const fields = await client.listFields({ tableId });
    const slotFields = fields.filter((field) => field.fieldName === SLOT_FIELD);
    const schemaReady = slotFields.length === 1 && Number(slotFields[0]?.type) === 1;
    const records = await client.listRecords({ tableId, includeRecordMetadata: false });
    const plan = planReportLarkCurrentSlotRetention({ role, records });
    plans[role] = plan;
    resolvedTables[role] = Object.freeze({
      role,
      tableId,
      tableName: contract.tableName,
      schemaReady,
      records,
    });
  }

  const preview = buildSummary({
    decision: execute ? 'REPORT_LARK_CURRENT_SLOT_RETENTION_EXECUTION_PLANNED' : 'REPORT_LARK_CURRENT_SLOT_RETENTION_PREVIEW',
    mode: execute ? 'execute' : 'preview',
    plans,
    evidenceRoot,
    confirmedUpdates: 0,
    confirmedDeletes: 0,
  });
  await writePrivateJson(join(evidenceRoot, 'preview.json'), {
    ...preview,
    tables: Object.fromEntries(Object.entries(plans).map(([role, plan]) => [role, {
      summary: summarizePlan(plan, resolvedTables[role].schemaReady),
      updates: plan.updates,
      deletes: plan.deletes,
      retained: plan.retained,
    }])),
  });
  process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);

  if (execute) {
    const notReady = Object.values(resolvedTables).filter((table) => !table.schemaReady);
    if (notReady.length > 0) throw operatorError(
      'Report schema v7 with lark_slot_key must be applied before retention execution',
      'REPORT_LARK_CURRENT_SLOT_SCHEMA_REQUIRED',
      { tables: notReady.map((table) => table.tableName) },
    );

    stage = 'backup';
    await writePrivateJson(join(evidenceRoot, 'before.json'), {
      contractVersion: REPORT_LARK_CURRENT_SLOT_RETENTION_VERSION,
      tables: Object.fromEntries(Object.entries(plans).map(([role, plan]) => [role, {
        tableName: resolvedTables[role].tableName,
        recordCount: plan.recordCount,
        retainedCount: plan.retainedCount,
        staleDeleteCount: plan.staleDeleteCount,
        slotKeyUpdateCount: plan.slotKeyUpdateCount,
        updates: plan.updates,
        deletes: plan.deletes,
      }])),
    });

    stage = 'slot-key-update';
    for (const [role, plan] of Object.entries(plans)) {
      if (plan.updates.length === 0) continue;
      const result = await client.batchUpdateRecords({
        tableId: resolvedTables[role].tableId,
        records: plan.updates.map((update) => ({ recordId: update.recordId, fields: update.fields })),
      });
      const updated = Number(result.updated ?? 0);
      if (updated !== plan.updates.length) throw operatorError(
        'Slot-key update count did not match plan',
        'REPORT_LARK_CURRENT_SLOT_UPDATE_COUNT_MISMATCH',
        { role, planned: plan.updates.length, updated },
      );
      confirmedUpdates += updated;
    }

    stage = 'stale-record-delete';
    for (const [role, plan] of Object.entries(plans)) {
      if (plan.deletes.length === 0) continue;
      const deleted = await batchDeleteRecords({
        client,
        tableId: resolvedTables[role].tableId,
        recordIds: plan.deletes.map((row) => row.recordId),
      });
      if (deleted !== plan.deletes.length) throw operatorError(
        'Stale Report delete count did not match plan',
        'REPORT_LARK_CURRENT_SLOT_DELETE_COUNT_MISMATCH',
        { role, planned: plan.deletes.length, deleted },
      );
      confirmedDeletes += deleted;
    }

    stage = 'readback';
    const finalPlans = {};
    for (const [role, table] of Object.entries(resolvedTables)) {
      const records = await client.listRecords({ tableId: table.tableId, includeRecordMetadata: false });
      finalPlans[role] = planReportLarkCurrentSlotRetention({ role, records });
      if (finalPlans[role].staleDeleteCount !== 0 || finalPlans[role].slotKeyUpdateCount !== 0) {
        throw operatorError(
          'Report Lark current-slot retention did not converge',
          'REPORT_LARK_CURRENT_SLOT_VERIFY_FAILED',
          {
            role,
            staleDeleteCount: finalPlans[role].staleDeleteCount,
            slotKeyUpdateCount: finalPlans[role].slotKeyUpdateCount,
          },
        );
      }
    }

    const finalSummary = buildSummary({
      decision: 'REPORT_LARK_CURRENT_SLOT_RETENTION_CONVERGED',
      mode: 'execute',
      plans: finalPlans,
      evidenceRoot,
      confirmedUpdates,
      confirmedDeletes,
    });
    await writePrivateJson(join(evidenceRoot, 'summary.json'), finalSummary);
    process.stdout.write(`${JSON.stringify(finalSummary, null, 2)}\n`);
  }
} catch (error) {
  const failure = Object.freeze({
    ok: false,
    contractVersion: REPORT_LARK_CURRENT_SLOT_RETENTION_VERSION,
    stage,
    code: error?.code ?? 'REPORT_LARK_CURRENT_SLOT_RETENTION_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: Object.freeze({
      ...(error?.details ?? {}),
      confirmedUpdates,
      confirmedDeletes,
    }),
    queueMessages: 0,
    d1Mutations: 0,
    workerDeployments: 0,
    production: 'BLOCKED',
  });
  if (evidenceRoot) await writePrivateJson(join(evidenceRoot, 'failure.json'), failure);
  process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
  process.exitCode = 1;
}

function buildSummary(input) {
  const tableSummaries = Object.fromEntries(Object.entries(input.plans).map(([role, plan]) => [
    role,
    summarizePlan(plan),
  ]));
  return Object.freeze({
    ok: true,
    decision: input.decision,
    mode: input.mode,
    contractVersion: REPORT_LARK_CURRENT_SLOT_RETENTION_VERSION,
    tables: tableSummaries,
    totalRecordCount: sumPlan(input.plans, 'recordCount'),
    totalRetainedCount: sumPlan(input.plans, 'retainedCount'),
    totalStaleDeleteCount: sumPlan(input.plans, 'staleDeleteCount'),
    totalSlotKeyUpdateCount: sumPlan(input.plans, 'slotKeyUpdateCount'),
    confirmedRecordUpdates: input.confirmedUpdates,
    confirmedRecordDeletes: input.confirmedDeletes,
    recordCreates: 0,
    d1Mutations: 0,
    queueMessages: 0,
    workerDeployments: 0,
    scheduleChanges: 0,
    production: 'BLOCKED',
    nextCommand: input.mode === 'preview'
      ? `CONFIRM_REPORT_LARK_CURRENT_SLOT_RETENTION=${REPORT_LARK_CURRENT_SLOT_RETENTION_CONFIRMATION} node scripts/report-lark-current-slot-retention.mjs --execute`
      : null,
    evidenceRoot: input.evidenceRoot,
  });
}

function summarizePlan(plan, schemaReady = true) {
  return Object.freeze({
    recordCount: plan.recordCount,
    retainedCount: plan.retainedCount,
    staleDeleteCount: plan.staleDeleteCount,
    slotKeyUpdateCount: plan.slotKeyUpdateCount,
    rollingSlotCount: plan.rollingSlotCount,
    customSlotCount: plan.customSlotCount,
    schemaReady,
  });
}

function sumPlan(plans, fieldName) {
  return Object.values(plans).reduce((sum, plan) => sum + Number(plan[fieldName] ?? 0), 0);
}

async function batchDeleteRecords(input) {
  const recordIds = requireArray(input.recordIds, 'recordIds').map((recordId) => requireText(recordId, 'recordId'));
  let deleted = 0;
  for (let index = 0; index < recordIds.length; index += BATCH_SIZE) {
    const chunk = recordIds.slice(index, index + BATCH_SIZE);
    const response = await input.client.requestBitableJson(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(input.client.appToken)}/tables/${encodeURIComponent(input.tableId)}/records/batch_delete`,
      {
        method: 'POST',
        retryMode: 'rate_limit_only',
        body: { records: chunk },
      },
    );
    const rows = response?.data?.records;
    if (Array.isArray(rows)) {
      if (rows.length !== chunk.length) throw operatorError(
        'Lark batch_delete returned an unexpected record count',
        'REPORT_LARK_CURRENT_SLOT_DELETE_RESPONSE_INVALID',
        { expected: chunk.length, actual: rows.length },
      );
      deleted += rows.length;
    } else {
      deleted += chunk.length;
    }
  }
  return deleted;
}

async function assertExactMain(repositoryRoot) {
  const branch = (await git(repositoryRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  const head = (await git(repositoryRoot, ['rev-parse', 'HEAD'])).trim();
  const originMain = (await git(repositoryRoot, ['rev-parse', 'origin/main'])).trim();
  const status = (await git(repositoryRoot, ['status', '--porcelain'])).trim();
  if (branch !== 'main' || head !== originMain || status !== '') throw operatorError(
    'Live Report Lark retention requires clean exact main == origin/main',
    'REPORT_LARK_CURRENT_SLOT_REPOSITORY_INVALID',
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
    'REPORT_LARK_CURRENT_SLOT_TABLE_INVALID',
    { tableName: name, matchCount: matches.length },
  );
  return matches[0];
}

async function writePrivateJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportLarkCurrentSlotRetentionOperatorError';
  error.code = code;
  error.details = Object.freeze(details);
  return error;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
