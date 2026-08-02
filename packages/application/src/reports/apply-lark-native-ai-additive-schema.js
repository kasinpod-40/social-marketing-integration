import {
  buildLarkNativeAiSchemaPreview,
  LARK_NATIVE_AI_PREVIEW_VIEW_CONTRACTS,
  LARK_NATIVE_AI_TARGET_TABLE,
} from '../../../config/src/lark-native-ai-schema-preview.js';
import { collectLarkNativeAiSchemaInventory } from './collect-lark-native-ai-schema-inventory.js';

export const LARK_NATIVE_AI_ADDITIVE_APPLY_VERSION = 'lark_native_ai_additive_apply_v1';
export const LARK_NATIVE_AI_REMOTE_EVIDENCE_VERSION = 'lark_native_ai_remote_inventory_reviewed_terminal_v1';

const FIELD_TYPE_IDS = Object.freeze({
  Text: 1,
  Number: 2,
  SingleSelect: 3,
  MultiSelect: 4,
  DateTime: 5,
  Checkbox: 7,
});

/**
 * Apply only the additive actions already bound into one reviewed Remote inventory evidence file.
 * The operation is sequential, idempotent and replayable after a partial stop.
 */
export async function applyLarkNativeAiAdditiveSchema(input = {}) {
  const client = requireApplyClient(input.client);
  const evidence = validateLarkNativeAiRemoteInventoryEvidence(input.evidence);
  const onAction = typeof input.onAction === 'function' ? input.onAction : () => undefined;

  const liveBefore = await collectLarkNativeAiSchemaInventory({
    client,
    baseName: evidence.inventory.baseName,
  });
  assertLiveTargetIsMonotonic(evidence, liveBefore);

  const tables = requireArray(await client.listTables(), 'listTables result');
  const targetTables = tables.filter((table) => tableNameOf(table) === LARK_NATIVE_AI_TARGET_TABLE);
  if (targetTables.length !== 1) throw applyError(
    'Additive Apply requires exactly one target table',
    'LARK_NATIVE_AI_APPLY_TARGET_TABLE_CARDINALITY_INVALID',
    { count: targetTables.length },
  );
  const tableId = requireText(
    targetTables[0].tableId ?? targetTables[0].table_id ?? targetTables[0].id,
    'target tableId',
  );

  let fields = requireArray(await client.listFields({ tableId }), 'listFields result');
  let views = requireArray(await client.listViews({ tableId }), 'listViews result');
  const completed = [];

  for (const action of evidence.preview.actions) {
    const key = actionKey(action);
    if (action.action === 'add_field') {
      fields = await ensureAdditiveField({ client, tableId, fields, action });
    } else if (action.action === 'extend_select_options') {
      fields = await ensureSelectOptions({ client, tableId, fields, evidence, action });
    } else if (action.action === 'create_view') {
      const result = await ensureView({ client, tableId, fields, views, action });
      views = result.views;
    } else {
      throw applyError(
        `Unsupported additive action: ${action.action}`,
        'LARK_NATIVE_AI_APPLY_ACTION_UNSUPPORTED',
        { action: action.action },
      );
    }
    completed.push(key);
    onAction(Object.freeze({ key, action: action.action, subject: action.fieldName ?? action.viewName }));
  }

  const liveAfter = await collectLarkNativeAiSchemaInventory({
    client,
    baseName: evidence.inventory.baseName,
  });
  if (!liveAfter.preview.ok || liveAfter.preview.status !== 'zero_drift'
    || liveAfter.preview.counts.totalActions !== 0 || liveAfter.preview.blockers.length !== 0) {
    throw applyError(
      'Post-Apply replay did not converge to zero drift',
      'LARK_NATIVE_AI_APPLY_ZERO_DRIFT_NOT_REACHED',
      {
        status: liveAfter.preview.status,
        totalActions: liveAfter.preview.counts.totalActions,
        blockers: liveAfter.preview.blockers.length,
      },
    );
  }

  return deepFreeze({
    ok: true,
    contractVersion: LARK_NATIVE_AI_ADDITIVE_APPLY_VERSION,
    targetTable: LARK_NATIVE_AI_TARGET_TABLE,
    evidenceInventorySha256: evidence.inventory.sourceSha256,
    completedActions: completed,
    counts: {
      completed: completed.length,
      expected: evidence.preview.counts.totalActions,
      remaining: 0,
    },
    replay: {
      status: liveAfter.preview.status,
      totalActions: liveAfter.preview.counts.totalActions,
      blockers: liveAfter.preview.blockers.length,
      inventorySha256: liveAfter.inventory.sourceSha256,
    },
    safety: {
      renameField: 0,
      deleteField: 0,
      changeFieldType: 0,
      deleteView: 0,
      recordRead: 0,
      automationCreate: 0,
      notificationSend: 0,
      aiCall: 0,
      remoteD1QueueWorkerProvider: 0,
      production: 'BLOCKED',
    },
  });
}

export function validateLarkNativeAiRemoteInventoryEvidence(value) {
  const evidence = requireObject(value, 'evidence');
  if (evidence.contractVersion !== LARK_NATIVE_AI_REMOTE_EVIDENCE_VERSION) throw applyError(
    'Remote inventory evidence contract is not supported',
    'LARK_NATIVE_AI_APPLY_EVIDENCE_CONTRACT_INVALID',
  );
  if (evidence.ok !== true || evidence.preview?.ok !== true
    || evidence.preview?.status !== 'ready_to_apply'
    || evidence.preview?.applyAuthorized !== false
    || !Array.isArray(evidence.preview?.blockers)
    || evidence.preview.blockers.length !== 0) {
    throw applyError(
      'Remote inventory evidence is not an approved ready-to-apply Preview',
      'LARK_NATIVE_AI_APPLY_EVIDENCE_NOT_READY',
    );
  }
  const counts = evidence.preview?.counts ?? {};
  if (counts.addField !== 23 || counts.extendSelectOptions !== 2
    || counts.createView !== 6 || counts.totalActions !== 31 || counts.blockers !== 0) {
    throw applyError(
      'Remote inventory evidence action counts do not match the reviewed contract',
      'LARK_NATIVE_AI_APPLY_EVIDENCE_COUNTS_INVALID',
      { counts },
    );
  }
  const actions = requireArray(evidence.preview.actions, 'evidence.preview.actions');
  for (const action of actions) validateAdditiveAction(action);
  const inventory = requireObject(evidence.inventory, 'evidence.inventory');
  requireText(inventory.sourceSha256, 'evidence.inventory.sourceSha256');
  const targetTables = requireArray(inventory.tables, 'evidence.inventory.tables')
    .filter((table) => tableNameOf(table) === LARK_NATIVE_AI_TARGET_TABLE);
  if (targetTables.length !== 1) throw applyError(
    'Evidence target table cardinality is invalid',
    'LARK_NATIVE_AI_APPLY_EVIDENCE_TARGET_INVALID',
    { count: targetTables.length },
  );
  return deepFreeze(structuredClone(evidence));
}

export function assertLiveTargetIsMonotonic(evidenceInput, liveResultInput) {
  const evidence = validateLarkNativeAiRemoteInventoryEvidence(evidenceInput);
  const liveResult = requireObject(liveResultInput, 'liveResult');
  const livePreview = requireObject(liveResult.preview, 'liveResult.preview');
  if (!livePreview.ok || livePreview.blockers?.length !== 0) throw applyError(
    'Current target schema contains blockers',
    'LARK_NATIVE_AI_APPLY_LIVE_SCHEMA_BLOCKED',
    { blockers: livePreview.blockers ?? [] },
  );

  const evidenceTarget = targetInventoryTable(evidence.inventory);
  const liveTarget = targetInventoryTable(liveResult.inventory);
  const plannedFields = new Map(evidence.preview.actions
    .filter(({ action }) => action === 'add_field')
    .map((action) => [action.fieldName, action]));
  const extensionActions = new Map(evidence.preview.actions
    .filter(({ action }) => action === 'extend_select_options')
    .map((action) => [action.fieldName, action]));
  const plannedViews = new Set(evidence.preview.actions
    .filter(({ action }) => action === 'create_view')
    .map(({ viewName }) => viewName));

  const originalFields = new Map(evidenceTarget.fields.map((field) => [field.fieldName, field]));
  const allowedFieldNames = new Set([...originalFields.keys(), ...plannedFields.keys()]);
  for (const field of liveTarget.fields) {
    if (!allowedFieldNames.has(field.fieldName)) throw applyError(
      `Unexpected target field drift: ${field.fieldName}`,
      'LARK_NATIVE_AI_APPLY_UNEXPECTED_FIELD_DRIFT',
      { fieldName: field.fieldName },
    );
    if (plannedFields.has(field.fieldName) && !originalFields.has(field.fieldName)) {
      assertAppliedFieldMatchesAction(field, plannedFields.get(field.fieldName));
      continue;
    }
    const original = originalFields.get(field.fieldName);
    if (field.fieldType !== original.fieldType) throw applyError(
      `Existing field type changed: ${field.fieldName}`,
      'LARK_NATIVE_AI_APPLY_EXISTING_FIELD_DRIFT',
      { fieldName: field.fieldName },
    );
    if (['SingleSelect', 'MultiSelect'].includes(field.fieldType)) {
      const originalOptions = sortedOptions(original.options);
      const liveOptions = sortedOptions(field.options);
      const extension = extensionActions.get(field.fieldName)?.optionsToAdd ?? [];
      const allowed = new Set([...originalOptions, ...extension]);
      if (liveOptions.some((option) => !allowed.has(option))
        || originalOptions.some((option) => !liveOptions.includes(option))) {
        throw applyError(
          `Existing Select options drifted: ${field.fieldName}`,
          'LARK_NATIVE_AI_APPLY_EXISTING_OPTIONS_DRIFT',
          { fieldName: field.fieldName },
        );
      }
    }
  }
  for (const originalName of originalFields.keys()) {
    if (!liveTarget.fields.some(({ fieldName }) => fieldName === originalName)) throw applyError(
      `Existing field disappeared: ${originalName}`,
      'LARK_NATIVE_AI_APPLY_EXISTING_FIELD_MISSING',
      { fieldName: originalName },
    );
  }

  const originalViews = new Set(evidenceTarget.views.map(({ viewName }) => viewName));
  const allowedViews = new Set([...originalViews, ...plannedViews]);
  for (const { viewName } of liveTarget.views) {
    if (!allowedViews.has(viewName)) throw applyError(
      `Unexpected target View drift: ${viewName}`,
      'LARK_NATIVE_AI_APPLY_UNEXPECTED_VIEW_DRIFT',
      { viewName },
    );
  }
  for (const viewName of originalViews) {
    if (!liveTarget.views.some((view) => view.viewName === viewName)) throw applyError(
      `Existing View disappeared: ${viewName}`,
      'LARK_NATIVE_AI_APPLY_EXISTING_VIEW_MISSING',
      { viewName },
    );
  }

  const originalActionKeys = new Set(evidence.preview.actions.map(actionKey));
  for (const action of livePreview.actions) {
    if (!originalActionKeys.has(actionKey(action))) throw applyError(
      'Current remaining plan is not a subset of the reviewed plan',
      'LARK_NATIVE_AI_APPLY_REMAINING_PLAN_DRIFT',
      { action: action.action, subject: action.fieldName ?? action.viewName },
    );
  }
  return true;
}

async function ensureAdditiveField({ client, tableId, fields, action }) {
  const matches = fields.filter((field) => fieldNameOf(field) === action.fieldName);
  if (matches.length > 1) throw duplicateError('Field', action.fieldName, matches.length);
  if (matches.length === 1) {
    assertAppliedRawFieldMatchesAction(matches[0], action);
    return fields;
  }
  try {
    const created = await client.createField({ tableId, field: fieldMutation(action) });
    assertAppliedRawFieldMatchesAction(created, action);
    return [...fields, created];
  } catch (error) {
    const refreshed = requireArray(await client.listFields({ tableId }), 'listFields recovery result');
    const recovered = refreshed.filter((field) => fieldNameOf(field) === action.fieldName);
    if (recovered.length === 1) {
      assertAppliedRawFieldMatchesAction(recovered[0], action);
      return refreshed;
    }
    throw error;
  }
}

async function ensureSelectOptions({ client, tableId, fields, evidence, action }) {
  const matches = fields.filter((field) => fieldNameOf(field) === action.fieldName);
  if (matches.length !== 1) throw applyError(
    `Select extension field cardinality invalid: ${action.fieldName}`,
    'LARK_NATIVE_AI_APPLY_EXTENSION_FIELD_INVALID',
    { fieldName: action.fieldName, count: matches.length },
  );
  const field = matches[0];
  const original = targetInventoryTable(evidence.inventory).fields
    .find(({ fieldName }) => fieldName === action.fieldName);
  if (!original) throw applyError(
    `Select extension source field missing from evidence: ${action.fieldName}`,
    'LARK_NATIVE_AI_APPLY_EXTENSION_EVIDENCE_MISSING',
  );
  const existingRawOptions = Array.isArray(field.property?.options) ? field.property.options : [];
  const existingNames = sortedOptions(existingRawOptions.map(optionName));
  const requiredOriginal = sortedOptions(original.options);
  if (requiredOriginal.some((name) => !existingNames.includes(name))) throw applyError(
    `Select extension would lose existing options: ${action.fieldName}`,
    'LARK_NATIVE_AI_APPLY_EXTENSION_EXISTING_OPTIONS_MISSING',
  );
  const missing = action.optionsToAdd.filter((name) => !existingNames.includes(name));
  if (missing.length === 0) return fields;
  const property = {
    ...(field.property ?? {}),
    options: [...existingRawOptions, ...missing.map((name) => ({ name }))],
  };
  const updated = await client.updateField({
    tableId,
    fieldId: requireText(field.fieldId ?? field.field_id, `${action.fieldName}.fieldId`),
    field: {
      fieldName: action.fieldName,
      type: Number(field.type),
      uiType: field.uiType ?? field.ui_type ?? undefined,
      description: field.description ?? undefined,
      property,
    },
  });
  const namesAfter = sortedOptions((updated.property?.options ?? []).map(optionName));
  for (const name of [...requiredOriginal, ...action.optionsToAdd]) {
    if (!namesAfter.includes(name)) throw applyError(
      `Select extension verification failed: ${action.fieldName}`,
      'LARK_NATIVE_AI_APPLY_EXTENSION_VERIFY_FAILED',
      { fieldName: action.fieldName, option: name },
    );
  }
  return fields.map((item) => item === field ? updated : item);
}

async function ensureView({ client, tableId, fields, views, action }) {
  let matches = views.filter((view) => viewNameOf(view) === action.viewName);
  if (matches.length > 1) throw duplicateError('View', action.viewName, matches.length);
  let view = matches[0] ?? null;
  if (!view) {
    try {
      view = await client.createView({ tableId, viewName: action.viewName, viewType: action.viewType });
      views = [...views, view];
    } catch (error) {
      views = requireArray(await client.listViews({ tableId }), 'listViews recovery result');
      matches = views.filter((item) => viewNameOf(item) === action.viewName);
      if (matches.length !== 1) throw error;
      [view] = matches;
    }
  }
  if (action.logicalFilter?.mode === 'all_rows') return { views };

  const filterInfo = buildViewFilter(action.logicalFilter, fields);
  const viewId = requireText(view.viewId ?? view.view_id, `${action.viewName}.viewId`);
  await client.updateView({ tableId, viewId, filterInfo });
  const hydrated = await client.getView({ tableId, viewId });
  assertViewFilterMatches(hydrated, filterInfo, action.viewName);
  return { views: views.map((item) => item === view ? hydrated : item) };
}

function buildViewFilter(logicalFilter, fields) {
  const conjunction = logicalFilter.mode === 'any_of' ? 'or' : 'and';
  const conditions = requireArray(logicalFilter.conditions, 'logicalFilter.conditions').map((condition) => {
    const field = fields.find((item) => fieldNameOf(item) === condition.fieldName);
    if (!field) throw applyError(
      `View filter field missing: ${condition.fieldName}`,
      'LARK_NATIVE_AI_APPLY_VIEW_FILTER_FIELD_MISSING',
      { fieldName: condition.fieldName },
    );
    return {
      fieldId: requireText(field.fieldId ?? field.field_id, `${condition.fieldName}.fieldId`),
      fieldType: Number(field.type),
      operator: ['equals', 'in'].includes(condition.operator) ? 'is' : condition.operator,
      value: [...condition.values],
    };
  });
  return { conjunction, conditions };
}

function assertViewFilterMatches(view, expected, viewName) {
  const actual = view?.property?.filterInfo;
  if (!actual || actual.conjunction !== expected.conjunction
    || !Array.isArray(actual.conditions) || actual.conditions.length !== expected.conditions.length) {
    throw applyError(
      `View filter verification failed: ${viewName}`,
      'LARK_NATIVE_AI_APPLY_VIEW_FILTER_VERIFY_FAILED',
      { viewName },
    );
  }
  for (let index = 0; index < expected.conditions.length; index += 1) {
    const left = actual.conditions[index];
    const right = expected.conditions[index];
    if (left.fieldId !== right.fieldId || Number(left.fieldType) !== Number(right.fieldType)
      || left.operator !== right.operator || left.value !== JSON.stringify(right.value)) {
      throw applyError(
        `View filter condition verification failed: ${viewName}`,
        'LARK_NATIVE_AI_APPLY_VIEW_FILTER_VERIFY_FAILED',
        { viewName, conditionIndex: index },
      );
    }
  }
}

function fieldMutation(action) {
  return {
    fieldName: action.fieldName,
    type: FIELD_TYPE_IDS[action.fieldType],
    property: ['SingleSelect', 'MultiSelect'].includes(action.fieldType)
      ? { options: action.options.map((name) => ({ name })) }
      : (action.fieldType === 'Number' ? { formatter: '0.00' }
        : (action.fieldType === 'DateTime'
          ? { date_formatter: 'yyyy-MM-dd HH:mm', auto_fill: false }
          : null)),
  };
}

function assertAppliedRawFieldMatchesAction(field, action) {
  assertAppliedFieldMatchesAction({
    fieldName: fieldNameOf(field),
    fieldType: fieldTypeName(field.type, field.uiType ?? field.ui_type),
    options: ['SingleSelect', 'MultiSelect'].includes(action.fieldType)
      ? (field.property?.options ?? []).map(optionName)
      : undefined,
  }, action);
}

function assertAppliedFieldMatchesAction(field, action) {
  if (field.fieldType !== action.fieldType) throw applyError(
    `Applied field type mismatch: ${action.fieldName}`,
    'LARK_NATIVE_AI_APPLY_FIELD_VERIFY_FAILED',
    { fieldName: action.fieldName, expectedType: action.fieldType, actualType: field.fieldType },
  );
  if (action.options) {
    const actual = sortedOptions(field.options);
    const expected = sortedOptions(action.options);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw applyError(
      `Applied field options mismatch: ${action.fieldName}`,
      'LARK_NATIVE_AI_APPLY_FIELD_VERIFY_FAILED',
      { fieldName: action.fieldName },
    );
  }
}

function validateAdditiveAction(actionInput) {
  const action = requireObject(actionInput, 'action');
  if (action.additiveOnly !== true || !['add_field', 'extend_select_options', 'create_view'].includes(action.action)
    || action.tableName !== LARK_NATIVE_AI_TARGET_TABLE) {
    throw applyError(
      'Evidence contains a non-additive or out-of-scope action',
      'LARK_NATIVE_AI_APPLY_ACTION_NOT_ADDITIVE',
      { action: action.action ?? null, tableName: action.tableName ?? null },
    );
  }
  if (action.action === 'add_field' && !FIELD_TYPE_IDS[action.fieldType]) throw applyError(
    `Unsupported field type: ${action.fieldType}`,
    'LARK_NATIVE_AI_APPLY_FIELD_TYPE_UNSUPPORTED',
  );
  return action;
}

function targetInventoryTable(inventoryInput) {
  const inventory = requireObject(inventoryInput, 'inventory');
  const targets = requireArray(inventory.tables, 'inventory.tables')
    .filter((table) => tableNameOf(table) === LARK_NATIVE_AI_TARGET_TABLE);
  if (targets.length !== 1) throw applyError(
    'Inventory target table cardinality is invalid',
    'LARK_NATIVE_AI_APPLY_TARGET_TABLE_CARDINALITY_INVALID',
    { count: targets.length },
  );
  return targets[0];
}

function actionKey(action) {
  return [action.phase, action.action, action.fieldName ?? action.viewName].join(':');
}
function tableNameOf(value) {
  return value?.tableName ?? value?.table_name ?? value?.name ?? null;
}
function fieldNameOf(value) {
  return value?.fieldName ?? value?.field_name ?? value?.name ?? null;
}
function viewNameOf(value) {
  return value?.viewName ?? value?.view_name ?? value?.name ?? null;
}
function optionName(value) {
  if (typeof value === 'string') return value;
  return value?.name ?? value?.text ?? value?.value ?? null;
}
function sortedOptions(value) {
  return [...new Set(requireArray(value ?? [], 'options').map((item) => requireText(item, 'option')))].sort();
}
function fieldTypeName(typeValue, uiTypeValue) {
  const uiKey = typeof uiTypeValue === 'string'
    ? uiTypeValue.toLowerCase().replace(/[^a-z0-9]/gu, '')
    : '';
  const fromUi = ({ text: 'Text', number: 'Number', singleselect: 'SingleSelect', multiselect: 'MultiSelect', date: 'DateTime', datetime: 'DateTime', checkbox: 'Checkbox' })[uiKey];
  return fromUi ?? ({ 1: 'Text', 2: 'Number', 3: 'SingleSelect', 4: 'MultiSelect', 5: 'DateTime', 7: 'Checkbox' })[Number(typeValue)] ?? null;
}
function duplicateError(resource, name, count) {
  return applyError(
    `${resource} name is duplicated: ${name}`,
    `LARK_NATIVE_AI_APPLY_${resource.toUpperCase()}_DUPLICATE`,
    { name, count },
  );
}
function requireApplyClient(value) {
  const client = requireObject(value, 'client');
  for (const method of [
    'listTables', 'listFields', 'listViews', 'createField', 'updateField',
    'createView', 'updateView', 'getView',
  ]) {
    if (typeof client[method] !== 'function') throw new TypeError(`client.${method} is required`);
  }
  return client;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}
function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${fieldName} must be an object`);
  return value;
}
function applyError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkNativeAiAdditiveApplyError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
