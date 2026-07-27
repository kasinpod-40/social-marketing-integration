import { createHash } from 'node:crypto';
import {
  CHATWOOT_LARK_BLUEPRINT,
  CHATWOOT_LARK_BLUEPRINT_VERSION,
  CHATWOOT_LARK_FIELD_TYPE,
  CHATWOOT_REQUIRED_LARK_TABLE_KEYS,
  validateChatwootLarkBlueprint,
} from '../../packages/config/src/chatwoot-lark-blueprint.js';
import { LARK_TABLE_ENV } from '../../packages/config/src/lark-table-config.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';
import { CHATWOOT_LARK_METADATA_CONTRACT_VERSION } from './chatwoot-lark-metadata-readiness.js';

export const CHATWOOT_LARK_SCHEMA_APPLY_CONTRACT_VERSION = 'chatwoot-lark-additive-schema-apply-v1';
export const CHATWOOT_LARK_SCHEMA_APPLY_PHASES = Object.freeze(['plan', 'apply']);
export const CHATWOOT_LARK_SCHEMA_APPLY_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_CHATWOOT_LARK_SCHEMA',
  value: 'APPLY_CHATWOOT_LARK_ADDITIVE_SCHEMA',
});

const DECISION_ADDITIVE = 'CHATWOOT_LARK_ADDITIVE_PLAN_REQUIRED';
const DECISION_READY = 'PASS_CHATWOOT_LARK_METADATA_READY';
const ALLOWED_ACTIONS = new Set(['bind_table_env', 'create_table', 'create_field']);
const T = CHATWOOT_LARK_FIELD_TYPE;

export function parseChatwootLarkSchemaApplyArgs(args = []) {
  let phase = 'plan';
  let execute = false;
  for (const arg of args) {
    if (arg === '--execute') execute = true;
    else if (arg.startsWith('--phase=')) phase = arg.slice('--phase='.length);
    else throw operatorError(
      `Unknown Chatwoot Lark schema argument: ${arg}`,
      'CHATWOOT_LARK_SCHEMA_ARGUMENT_INVALID',
    );
  }
  if (!CHATWOOT_LARK_SCHEMA_APPLY_PHASES.includes(phase)) {
    throw operatorError(
      `Unsupported Chatwoot Lark schema phase: ${phase}`,
      'CHATWOOT_LARK_SCHEMA_PHASE_INVALID',
      { phase },
    );
  }
  if (phase === 'plan' && execute) {
    throw operatorError(
      'Chatwoot Lark schema plan does not accept --execute',
      'CHATWOOT_LARK_SCHEMA_PLAN_EXECUTE_INVALID',
    );
  }
  return Object.freeze({ phase, execute });
}

export function assertChatwootLarkSchemaApplyConfirmation(env = {}) {
  const expected = CHATWOOT_LARK_SCHEMA_APPLY_CONFIRMATION;
  if (env?.[expected.envName] !== expected.value) {
    throw operatorError(
      `Chatwoot Lark schema apply requires ${expected.envName}=${expected.value}`,
      'CHATWOOT_LARK_SCHEMA_CONFIRMATION_REQUIRED',
      { envName: expected.envName },
    );
  }
  return true;
}

export function validateChatwootLarkMetadataEvidence(value = {}) {
  validateChatwootLarkBlueprint();
  const evidence = requireObject(value, 'Chatwoot Lark metadata evidence');
  const blockers = requireObject(evidence.blockers, 'evidence.blockers');
  const plan = requireObject(evidence.additivePlan, 'evidence.additivePlan');
  const inventory = requireObject(evidence.inventory, 'evidence.inventory');
  const boundaries = requireObject(evidence.boundaries, 'evidence.boundaries');
  const actions = requireArray(plan.actions, 'evidence.additivePlan.actions');

  const valid = evidence.phase === 'lark-preflight'
    && evidence.contractVersion === CHATWOOT_LARK_METADATA_CONTRACT_VERSION
    && evidence.decision === DECISION_ADDITIVE
    && evidence.status === 'action_required'
    && evidence.accepted === false
    && Number(inventory.expectedTableCount) === CHATWOOT_LARK_BLUEPRINT.length
    && Number(plan.actionCount) === actions.length
    && Number(plan.destructiveActions) === 0
    && Number(plan.renameTableCount) === 0
    && Number(plan.deleteTableCount) === 0
    && Number(plan.deleteFieldCount) === 0
    && Number(plan.changeFieldTypeCount) === 0
    && emptyArray(blockers.ambiguousTables)
    && emptyArray(blockers.identityMismatches)
    && emptyArray(blockers.missingPrimaryKeys)
    && emptyArray(blockers.typeMismatches)
    && boundaries.metadataReadOnly === true
    && Number(boundaries.larkRecordReadCount) === 0
    && Number(boundaries.larkMutationCount) === 0
    && Number(boundaries.providerRequestCount) === 0
    && Number(boundaries.d1MutationCount) === 0
    && Number(boundaries.queueActionCount) === 0
    && Number(boundaries.workerDeploymentCount) === 0
    && Number(boundaries.scheduleWebhookActionCount) === 0
    && Number(boundaries.destructivePlanActionCount) === 0;

  if (!valid) {
    throw operatorError(
      'Chatwoot Lark metadata evidence is not accepted for additive schema apply',
      'CHATWOOT_LARK_SCHEMA_EVIDENCE_INVALID',
    );
  }

  const normalizedActions = normalizeSafeActions(actions);
  if (!normalizedActions.some((action) => action.action === 'create_table' || action.action === 'create_field')) {
    throw operatorError(
      'Chatwoot Lark evidence contains no schema mutation action',
      'CHATWOOT_LARK_SCHEMA_EVIDENCE_NO_SCHEMA_ACTION',
    );
  }

  return deepFreeze({
    evidenceSha256: sha256(stableJson(evidence)),
    actionFingerprint: fingerprintActions(normalizedActions),
    allowedTableKeys: [...new Set(normalizedActions.map((action) => action.tableKey))].sort(),
    actions: normalizedActions,
  });
}

export function buildChatwootLarkSchemaApplyPlan(input = {}) {
  validateChatwootLarkBlueprint();
  const analysis = requireObject(input.analysis, 'analysis');
  const reviewedEvidence = requireObject(input.reviewedEvidence, 'reviewedEvidence');
  const bindings = requireObject(input.bindings ?? {}, 'bindings');
  const actions = normalizeSafeActions(requireArray(analysis?.additivePlan?.actions ?? [], 'analysis.additivePlan.actions'));

  if (analysis.decision === DECISION_READY) {
    return deepFreeze({
      alreadyReady: true,
      decision: DECISION_READY,
      actions: [],
      actionFingerprint: fingerprintActions([]),
      mutationActionCount: 0,
      bindingActionCount: 0,
    });
  }

  if (analysis.decision !== DECISION_ADDITIVE || analysis.status !== 'action_required') {
    throw operatorError(
      'Current Chatwoot Lark metadata is not an additive-only plan',
      'CHATWOOT_LARK_SCHEMA_CURRENT_PLAN_BLOCKED',
      { decision: analysis.decision, status: analysis.status },
    );
  }
  assertNoBlockers(analysis.blockers);
  assertNoDestructivePlan(analysis.additivePlan);

  const reviewedKeys = new Set(requireArray(reviewedEvidence.allowedTableKeys, 'reviewedEvidence.allowedTableKeys'));
  for (const action of actions) {
    if (!reviewedKeys.has(action.tableKey)) {
      throw operatorError(
        `Current additive plan contains unreviewed table ${action.tableKey}`,
        'CHATWOOT_LARK_SCHEMA_PLAN_DRIFT',
        { tableKey: action.tableKey },
      );
    }
  }

  const executable = actions.map((action) => enrichAction(action, bindings));
  return deepFreeze({
    alreadyReady: false,
    decision: DECISION_ADDITIVE,
    actions: executable,
    actionFingerprint: fingerprintActions(actions),
    mutationActionCount: executable.filter((action) => action.action !== 'bind_table_env').length,
    bindingActionCount: executable.filter((action) => action.action === 'bind_table_env').length,
  });
}

export function buildChatwootLarkEnvironmentUpdates(bindings = {}) {
  const lines = [];
  const entries = [];
  for (const table of CHATWOOT_LARK_BLUEPRINT) {
    const binding = requireObject(bindings[table.key], `bindings.${table.key}`);
    const tableId = requireText(binding.tableId, `bindings.${table.key}.tableId`);
    const envName = LARK_TABLE_ENV[table.key];
    entries.push(Object.freeze({ tableKey: table.key, envName, tableId }));
    lines.push(`${envName}=${tableId}`);
  }
  return deepFreeze({
    entries,
    text: `${lines.join('\n')}\n`,
    tableCount: entries.length,
    fingerprint: sha256(stableJson(entries.map(({ tableKey, envName, tableId }) => ({
      tableKey,
      envName,
      tableIdHash: sha256(tableId),
    })))),
  });
}

export function buildChatwootLarkSchemaApplyEvidence(input = {}) {
  const plan = requireObject(input.plan, 'plan');
  const verification = requireObject(input.verification, 'verification');
  const environmentUpdates = requireObject(input.environmentUpdates, 'environmentUpdates');
  const appliedActions = requireArray(input.appliedActions ?? [], 'appliedActions');
  const capturedAt = requireText(input.capturedAt, 'capturedAt');
  if (verification.decision !== DECISION_READY || verification.accepted !== true) {
    throw operatorError(
      'Chatwoot Lark schema post-apply verification is not ready',
      'CHATWOOT_LARK_SCHEMA_VERIFICATION_FAILED',
      { decision: verification.decision },
    );
  }
  return deepFreeze({
    phase: 'apply',
    contractVersion: CHATWOOT_LARK_SCHEMA_APPLY_CONTRACT_VERSION,
    blueprintVersion: CHATWOOT_LARK_BLUEPRINT_VERSION,
    capturedAt,
    status: 'passed',
    accepted: true,
    decision: DECISION_READY,
    plan: {
      actionFingerprint: plan.actionFingerprint,
      plannedMutationActions: Number(plan.mutationActionCount ?? 0),
      plannedBindingActions: Number(plan.bindingActionCount ?? 0),
    },
    result: {
      appliedActionCount: appliedActions.length,
      createdTableCount: appliedActions.filter((action) => action.action === 'create_table').length,
      createdFieldCount: appliedActions.filter((action) => action.action === 'create_field').length,
      environmentTableCount: environmentUpdates.tableCount,
      environmentFingerprint: environmentUpdates.fingerprint,
      postApplyTableCount: Number(verification?.inventory?.resolvedTableCount ?? 0),
      postApplyMissingTableCount: Number(verification?.inventory?.missingTableCount ?? 0),
    },
    boundaries: {
      additiveOnly: true,
      destructiveActionCount: 0,
      renameTableCount: 0,
      deleteTableCount: 0,
      deleteFieldCount: 0,
      changeFieldTypeCount: 0,
      larkRecordReadCount: 0,
      providerRequestCount: 0,
      d1MutationCount: 0,
      queueActionCount: 0,
      workerDeploymentCount: 0,
      scheduleWebhookActionCount: 0,
      credentialValuesPersisted: false,
      rawMetadataPayloadPersisted: false,
      rawTableIdsPersistedInSummary: false,
    },
  });
}

export function safeChatwootLarkSchemaApplyPlan() {
  return deepFreeze({
    contractVersion: CHATWOOT_LARK_SCHEMA_APPLY_CONTRACT_VERSION,
    blueprintVersion: CHATWOOT_LARK_BLUEPRINT_VERSION,
    planOnly: true,
    phases: CHATWOOT_LARK_SCHEMA_APPLY_PHASES,
    confirmation: `${CHATWOOT_LARK_SCHEMA_APPLY_CONFIRMATION.envName}=${CHATWOOT_LARK_SCHEMA_APPLY_CONFIRMATION.value}`,
    evidenceRequired: 'outputs/chatwoot-lark-metadata-readiness/summary.json',
    expectedTableCount: CHATWOOT_LARK_BLUEPRINT.length,
    allowedActions: [...ALLOWED_ACTIONS],
    creationTransport: {
      checkboxPreferred: 'Number 0/1',
      singleSelectPreferred: 'Text',
      dateTimePreferred: 'Number epoch',
      reason: 'match_the_existing_PII_minimized_write_set_without_a_new_conversion_layer',
    },
    execution: {
      metadataReadBeforeMutation: true,
      additiveOnly: true,
      createTables: true,
      createFields: true,
      bindEnvironmentOutputOnly: true,
      recordReads: false,
      renameDeleteOrTypeChange: false,
      automaticDevVarsEdit: false,
      automaticWranglerEdit: false,
      providerRequests: false,
      d1QueueDeploymentSchedule: false,
      production: false,
    },
  });
}

function enrichAction(action, bindings) {
  const table = requireBlueprintTable(action.tableKey);
  if (action.action === 'bind_table_env') {
    const binding = requireObject(bindings[action.tableKey], `bindings.${action.tableKey}`);
    return Object.freeze({
      action: action.action,
      tableKey: table.key,
      envName: table.envName,
      tableId: requireText(binding.tableId, `bindings.${action.tableKey}.tableId`),
    });
  }
  if (action.action === 'create_table') {
    return Object.freeze({
      action: action.action,
      tableKey: table.key,
      envName: table.envName,
      name: table.createName,
      defaultViewName: '📋 All Records',
      fields: table.fields.map(toMutationField),
    });
  }
  if (action.action === 'create_field') {
    const binding = requireObject(bindings[action.tableKey], `bindings.${action.tableKey}`);
    const field = table.fields.find((candidate) => candidate.fieldName === action.fieldName);
    if (!field || field.primary) {
      throw operatorError(
        `Invalid Chatwoot Lark create_field action: ${action.tableKey}.${action.fieldName}`,
        'CHATWOOT_LARK_SCHEMA_FIELD_ACTION_INVALID',
      );
    }
    return Object.freeze({
      action: action.action,
      tableKey: table.key,
      envName: table.envName,
      tableId: requireText(binding.tableId, `bindings.${action.tableKey}.tableId`),
      field: toMutationField(field),
    });
  }
  throw operatorError(
    `Unsupported Chatwoot Lark schema action: ${action.action}`,
    'CHATWOOT_LARK_SCHEMA_ACTION_INVALID',
  );
}

function toMutationField(field) {
  const type = transportType(field);
  return Object.freeze({
    fieldName: field.fieldName,
    type,
    uiType: uiTypeFor(type),
    primary: field.primary === true,
    description: `${field.semantics}. ${field.importNote}`,
  });
}

function transportType(field) {
  if (field.type === T.CHECKBOX && field.compatibleTypes.includes(T.NUMBER)) return T.NUMBER;
  if (field.type === T.SINGLE_SELECT && field.compatibleTypes.includes(T.TEXT)) return T.TEXT;
  if (field.type === T.DATETIME && field.compatibleTypes.includes(T.NUMBER)) return T.NUMBER;
  return field.type;
}

function uiTypeFor(type) {
  if (type === T.TEXT) return 'Text';
  if (type === T.NUMBER) return 'Number';
  if (type === T.SINGLE_SELECT) return 'SingleSelect';
  if (type === T.DATETIME) return 'DateTime';
  if (type === T.CHECKBOX) return 'Checkbox';
  throw operatorError(`Unsupported Lark field type: ${type}`, 'CHATWOOT_LARK_SCHEMA_FIELD_TYPE_INVALID');
}

function normalizeSafeActions(actions) {
  const seen = new Set();
  return actions.map((input) => {
    const action = requireObject(input, 'additive action');
    const kind = requireText(action.action, 'additive action.action');
    const tableKey = requireText(action.tableKey, 'additive action.tableKey');
    if (!ALLOWED_ACTIONS.has(kind)) {
      throw operatorError(
        `Unsupported Chatwoot Lark additive action: ${kind}`,
        'CHATWOOT_LARK_SCHEMA_ACTION_INVALID',
        { action: kind },
      );
    }
    if (!CHATWOOT_REQUIRED_LARK_TABLE_KEYS.includes(tableKey)) {
      throw operatorError(
        `Unknown Chatwoot Lark table key: ${tableKey}`,
        'CHATWOOT_LARK_SCHEMA_TABLE_INVALID',
        { tableKey },
      );
    }
    const fieldName = kind === 'create_field' ? requireText(action.fieldName, 'additive action.fieldName') : null;
    const identity = `${kind}:${tableKey}:${fieldName ?? ''}`;
    if (seen.has(identity)) {
      throw operatorError(
        `Duplicate Chatwoot Lark additive action: ${identity}`,
        'CHATWOOT_LARK_SCHEMA_ACTION_DUPLICATE',
      );
    }
    seen.add(identity);
    return Object.freeze({ action: kind, tableKey, ...(fieldName ? { fieldName } : {}) });
  }).sort(compareAction);
}

function fingerprintActions(actions) {
  return sha256(stableJson(actions.map((action) => ({
    action: action.action,
    tableKey: action.tableKey,
    fieldName: action.fieldName ?? null,
  })).sort(compareAction)));
}

function compareAction(left, right) {
  return `${left.tableKey}:${left.action}:${left.fieldName ?? ''}`
    .localeCompare(`${right.tableKey}:${right.action}:${right.fieldName ?? ''}`);
}

function assertNoBlockers(blockers = {}) {
  const value = requireObject(blockers, 'analysis.blockers');
  if (!emptyArray(value.ambiguousTables)
    || !emptyArray(value.identityMismatches)
    || !emptyArray(value.missingPrimaryKeys)
    || !emptyArray(value.typeMismatches)) {
    throw operatorError(
      'Current Chatwoot Lark metadata has blockers',
      'CHATWOOT_LARK_SCHEMA_CURRENT_PLAN_BLOCKED',
    );
  }
}

function assertNoDestructivePlan(plan = {}) {
  const value = requireObject(plan, 'analysis.additivePlan');
  for (const field of [
    'destructiveActions', 'renameTableCount', 'deleteTableCount',
    'deleteFieldCount', 'changeFieldTypeCount',
  ]) {
    if (Number(value[field] ?? 0) !== 0) {
      throw operatorError(
        `Chatwoot Lark plan contains destructive action count: ${field}`,
        'CHATWOOT_LARK_SCHEMA_DESTRUCTIVE_PLAN_BLOCKED',
        { field, count: value[field] },
      );
    }
  }
}

function requireBlueprintTable(tableKey) {
  const table = CHATWOOT_LARK_BLUEPRINT.find((candidate) => candidate.key === tableKey);
  if (!table) throw operatorError(`Unknown Chatwoot Lark table: ${tableKey}`, 'CHATWOOT_LARK_SCHEMA_TABLE_INVALID');
  return table;
}

function emptyArray(value) {
  return Array.isArray(value) && value.length === 0;
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be non-empty text`);
  return value.trim();
}

function stableJson(value) {
  return JSON.stringify(sortObject(value));
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function operatorError(message, code, details = {}) {
  return permanentError(message, { code, details });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
