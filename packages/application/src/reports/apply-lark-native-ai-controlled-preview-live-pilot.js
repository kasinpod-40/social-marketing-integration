import {
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_LIMITS,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_TARGET_TABLE,
} from '../../../config/src/lark-native-ai-controlled-preview-live-pilot-contract.js';
import {
  buildLarkNativeAiControlledPreviewExecutionPlan,
} from './build-lark-native-ai-controlled-preview-execution-plan.js';

const READ_AFTER_WRITE_DELAY_MS = 10_000;
const RECORD_INVENTORY_PAGE_SIZE = 500;

export async function planLarkNativeAiControlledPreviewLivePilot(input = {}) {
  const client = requireClient(input.client);
  const repository = requireObject(input.repository, 'repository');
  const readinessPlans = requireArray(input.readinessPlans ?? input.readiness_plans, 'readinessPlans');
  const table = await resolveTargetTable(client);
  const planned = await buildPlanForTable({ client, repository, readinessPlans, table });
  return deepFreeze({
    ok: planned.plan.status !== 'blocked',
    mode: 'controlled_preview_live_pilot_plan',
    targetTable: table.name,
    targetTableId: table.tableId,
    existingRecordCount: planned.existingRecords.length,
    executionPlan: planned.plan,
    safety: safetySummary(),
  });
}

export async function applyLarkNativeAiControlledPreviewLivePilot(input = {}) {
  const client = requireClient(input.client);
  const repository = requireObject(input.repository, 'repository');
  const readinessPlans = requireArray(input.readinessPlans ?? input.readiness_plans, 'readinessPlans');
  const onProgress = typeof input.onProgress === 'function' ? input.onProgress : () => undefined;
  const sleep = typeof input.sleep === 'function' ? input.sleep : wait;
  const table = await resolveTargetTable(client);
  const initial = await buildPlanForTable({ client, repository, readinessPlans, table });
  const executionPlan = initial.plan;

  if (executionPlan.status === 'blocked') {
    throw pilotError(
      'Controlled Preview Live Pilot is blocked by retained authority or existing Record conflicts',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_BLOCKED',
      { blockers: executionPlan.blockers },
    );
  }

  if (executionPlan.status === 'zero_drift') {
    assertZeroDriftPlan(executionPlan);
    return deepFreeze({
      ok: true,
      mode: 'already_zero_drift',
      targetTable: table.name,
      initialPlanId: executionPlan.planId,
      verificationPlanId: executionPlan.planId,
      writes: Object.freeze({ created: 0, updated: 0, total: 0 }),
      verification: Object.freeze({ status: 'zero_drift', counts: executionPlan.counts }),
      safety: safetySummary(),
    });
  }

  assertBoundedWritePlan(executionPlan);
  const creates = executionPlan.actions
    .filter(({ action }) => action === 'create')
    .map(({ fields }) => structuredClone(fields));
  const updates = executionPlan.actions
    .filter(({ action }) => action === 'update')
    .map(({ recordId, fieldsPatch }) => ({
      recordId,
      fields: structuredClone(fieldsPatch),
    }));

  let created = 0;
  let updated = 0;
  if (creates.length > 0) {
    onProgress(safeProgress('record_create_start', { rows: creates.length }));
    const result = await client.batchCreateRecords({ tableId: table.tableId, records: creates });
    created = result.created;
    onProgress(safeProgress('record_create_complete', { rows: created }));
  }
  if (updates.length > 0) {
    onProgress(safeProgress('record_update_start', { rows: updates.length }));
    const result = await client.batchUpdateRecords({ tableId: table.tableId, records: updates });
    updated = result.updated;
    onProgress(safeProgress('record_update_complete', { rows: updated }));
  }

  if (created !== creates.length || updated !== updates.length) {
    throw pilotError(
      'Controlled Preview Live Pilot write count did not match the reviewed execution plan',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_WRITE_COUNT_MISMATCH',
      {
        expectedCreated: creates.length,
        observedCreated: created,
        expectedUpdated: updates.length,
        observedUpdated: updated,
      },
    );
  }

  if (created + updated > 0) {
    onProgress(safeProgress('record_readback_wait', {
      delayMs: READ_AFTER_WRITE_DELAY_MS,
      rows: created + updated,
    }));
    await sleep(READ_AFTER_WRITE_DELAY_MS);
  }

  const verification = await buildPlanForTable({ client, repository, readinessPlans, table });
  assertZeroDriftPlan(verification.plan);

  return deepFreeze({
    ok: true,
    mode: 'applied_and_verified',
    targetTable: table.name,
    initialPlanId: executionPlan.planId,
    verificationPlanId: verification.plan.planId,
    writes: Object.freeze({ created, updated, total: created + updated }),
    verification: Object.freeze({
      status: verification.plan.status,
      counts: verification.plan.counts,
    }),
    safety: safetySummary(),
  });
}

async function buildPlanForTable({ client, repository, readinessPlans, table }) {
  const seedPlan = await buildLarkNativeAiControlledPreviewExecutionPlan({
    repository,
    readinessPlans,
    existingRecords: [],
  });
  if (seedPlan.status === 'blocked') {
    return Object.freeze({ plan: seedPlan, existingRecords: Object.freeze([]) });
  }
  const aiRunKeys = seedPlan.actions.map(({ aiRunKey }) => aiRunKey);
  const dedupeKeys = seedPlan.actions.map(({ dedupeKey }) => dedupeKey);
  if (aiRunKeys.length !== LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_LIMITS.expectedRows
    || new Set(aiRunKeys).size !== aiRunKeys.length
    || new Set(dedupeKeys).size !== dedupeKeys.length) {
    throw pilotError(
      'Controlled Preview seed plan does not contain exactly forty unique identities',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_IDENTITY_SET_INVALID',
    );
  }
  const existingRecords = await loadExistingRecords(client, table.tableId);
  const plan = await buildLarkNativeAiControlledPreviewExecutionPlan({
    repository,
    readinessPlans,
    existingRecords,
  });
  return Object.freeze({ plan, existingRecords });
}

async function loadExistingRecords(client, tableId) {
  const inventory = await client.listRecords({
    tableId,
    pageSize: RECORD_INVENTORY_PAGE_SIZE,
    includeRecordMetadata: false,
  });
  const byRecordId = new Map();
  for (const record of inventory) {
    const recordId = requireText(record?.recordId, 'record.recordId');
    byRecordId.set(recordId, deepFreeze({
      recordId,
      fields: structuredClone(requireObject(record.fields, 'record.fields')),
    }));
  }
  return Object.freeze([...byRecordId.values()]);
}

async function resolveTargetTable(client) {
  const tables = await client.listTables();
  const matches = tables.filter(({ name }) => name === LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_TARGET_TABLE);
  if (matches.length !== 1 || !matches[0]?.tableId) {
    throw pilotError(
      'Controlled Preview Live Pilot requires one exact target Table',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_TARGET_TABLE_INVALID',
      { expected: LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_TARGET_TABLE, matches: matches.length },
    );
  }
  return Object.freeze({ name: matches[0].name, tableId: matches[0].tableId });
}

function assertBoundedWritePlan(plan) {
  const counts = plan?.counts ?? {};
  if (plan.status !== 'ready_to_apply'
    || counts.total !== LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_LIMITS.expectedRows
    || counts.write < 1
    || counts.write > LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_LIMITS.maximumRecordWrites
    || counts.delete !== 0
    || plan.safety?.executionAuthorized !== false
    || plan.safety?.deleteActionCount !== 0) {
    throw pilotError(
      'Controlled Preview execution plan is outside the reviewed Live Pilot write boundary',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_PLAN_INVALID',
      { status: plan?.status ?? null, counts },
    );
  }
}

function assertZeroDriftPlan(plan) {
  const counts = plan?.counts ?? {};
  if (plan.status !== 'zero_drift'
    || counts.total !== LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_LIMITS.expectedRows
    || counts.write !== 0
    || counts.noOp !== LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_LIMITS.expectedRows
    || counts.delete !== 0
    || plan.safety?.executionAuthorized !== false
    || plan.safety?.deleteActionCount !== 0) {
    throw pilotError(
      'Controlled Preview Live Pilot did not converge to exact zero drift',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_ZERO_DRIFT_REQUIRED',
      { status: plan?.status ?? null, counts, blockers: plan?.blockers ?? [] },
    );
  }
}

function safetySummary() {
  return Object.freeze({
    previewOnly: true,
    deleteActionCount: 0,
    schemaMutationCount: 0,
    aiCallCount: 0,
    remoteD1ActionCount: 0,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    providerActionCount: 0,
    automationCount: 0,
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  });
}

function safeProgress(stage, details) {
  return Object.freeze({ stage, ...details });
}

export function pilotError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkNativeAiControlledPreviewLivePilotError';
  error.code = code;
  error.details = Object.freeze(structuredClone(details));
  return error;
}

function requireClient(value) {
  for (const method of [
    'listTables',
    'listRecords',
    'batchCreateRecords',
    'batchUpdateRecords',
  ]) {
    if (typeof value?.[method] !== 'function') throw new TypeError(`client.${method} is required`);
  }
  return value;
}
function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}
function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return value;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
function deepFreeze(value, seen = new WeakSet()) {
  if (value && typeof value === 'object') {
    if (seen.has(value)) return value;
    seen.add(value);
    for (const nested of Object.values(value)) deepFreeze(nested, seen);
    Object.freeze(value);
  }
  return value;
}
