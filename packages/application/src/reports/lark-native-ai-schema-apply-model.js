import {
  LARK_AI_REPORT_RUNS_ADDITIVE_FIELDS,
  LARK_AI_REPORT_RUNS_OPTION_EXTENSIONS,
} from '../../../config/src/lark-native-ai-all-channel-contract.js';
import {
  LARK_NATIVE_AI_PREVIEW_VIEW_CONTRACTS,
  LARK_NATIVE_AI_TARGET_TABLE,
} from '../../../config/src/lark-native-ai-schema-preview.js';

const FIELD_TYPES = Object.freeze({
  Text: [1, 'Text'], Number: [2, 'Number'], SingleSelect: [3, 'SingleSelect'],
  MultiSelect: [4, 'MultiSelect'], DateTime: [5, 'DateTime'], Checkbox: [7, 'Checkbox'],
});

export function assertAdditiveDescendant(acceptedInventory, currentInventory) {
  const accepted = uniqueTarget(array(acceptedInventory.tables, 'accepted.tables'));
  const current = uniqueTarget(array(currentInventory.tables, 'current.tables'));
  const acceptedFields = uniqueByName(accepted.fields, 'fieldName', 'accepted.fields');
  const currentFields = uniqueByName(current.fields, 'fieldName', 'current.fields');
  const additive = new Map(LARK_AI_REPORT_RUNS_ADDITIVE_FIELDS.map((field) => [field.fieldName, field]));
  const allowedNames = new Set([...acceptedFields.keys(), ...additive.keys()]);
  for (const name of currentFields.keys()) if (!allowedNames.has(name)) throw failure(
    'Current target contains an unaccepted Field',
    'LARK_NATIVE_AI_SCHEMA_APPLY_UNACCEPTED_FIELD_DRIFT', { fieldName: name },
  );
  for (const [name, before] of acceptedFields) {
    const after = currentFields.get(name);
    if (!after || after.fieldType !== before.fieldType) throw failure(
      'A retained Field is missing or changed type',
      'LARK_NATIVE_AI_SCHEMA_APPLY_FIELD_DRIFT', { fieldName: name },
    );
    preserveOptions(name, before, after);
    if (Object.hasOwn(before, 'options')) {
      const allowed = new Set([
        ...knownOptions(before, name),
        ...(LARK_AI_REPORT_RUNS_OPTION_EXTENSIONS[name] ?? []),
      ]);
      const extras = knownOptions(after, name).filter((option) => !allowed.has(option));
      if (extras.length > 0) throw failure(
        'A reused Select Field contains unaccepted options',
        'LARK_NATIVE_AI_SCHEMA_APPLY_OPTION_DRIFT', { fieldName: name, extras },
      );
    }
  }
  for (const [name, contract] of additive) {
    const field = currentFields.get(name);
    if (!field) continue;
    if (field.fieldType !== contract.fieldType) throw failure(
      'An additive Field has a conflicting type',
      'LARK_NATIVE_AI_SCHEMA_APPLY_FIELD_DRIFT', { fieldName: name },
    );
    if (contract.options) {
      const extras = knownOptions(field, name).filter((option) => !contract.options.includes(option));
      if (extras.length > 0) throw failure(
        'An additive Select Field contains unaccepted options',
        'LARK_NATIVE_AI_SCHEMA_APPLY_OPTION_DRIFT', { fieldName: name, extras },
      );
    }
  }
  const acceptedViews = new Set(accepted.views.map(viewName));
  const requiredViews = new Set(LARK_NATIVE_AI_PREVIEW_VIEW_CONTRACTS.map(({ viewName: name }) => name));
  for (const name of current.views.map(viewName)) {
    if (!acceptedViews.has(name) && !requiredViews.has(name)) throw failure(
      'Current target contains an unaccepted View',
      'LARK_NATIVE_AI_SCHEMA_APPLY_UNACCEPTED_VIEW_DRIFT', { viewName: name },
    );
  }
}

export function assertAllowedActions(acceptedActions, currentActions) {
  const accepted = new Map(acceptedActions.map((action) => [identity(action), action]));
  const additive = new Map(LARK_AI_REPORT_RUNS_ADDITIVE_FIELDS.map((field) => [field.fieldName, field]));
  for (const action of currentActions) {
    if (action.action === 'add_field' || action.action === 'create_view') {
      const original = accepted.get(identity(action));
      if (!original || canonical(original) !== canonical(action)) throw unacceptedAction(action);
      continue;
    }
    if (action.action === 'extend_select_options') {
      const original = accepted.get(identity(action));
      const allowed = original?.optionsToAdd ?? additive.get(action.fieldName)?.options ?? [];
      if (!Array.isArray(action.optionsToAdd)
        || action.optionsToAdd.some((option) => !allowed.includes(option))) throw unacceptedAction(action);
      continue;
    }
    throw unacceptedAction(action);
  }
}

export async function readRawTargetState(client) {
  const tables = await client.listTables();
  const matches = tables.filter(({ name }) => name === LARK_NATIVE_AI_TARGET_TABLE);
  if (matches.length !== 1) throw failure(
    'Target table identity is not unique',
    'LARK_NATIVE_AI_SCHEMA_APPLY_TARGET_TABLE_INVALID', { count: matches.length },
  );
  const table = matches[0];
  const tableId = text(table.tableId, 'tableId');
  return freeze({
    table,
    fields: await client.listFields({ tableId }),
    views: await client.listViews({ tableId }),
  });
}

export function assertRawStateMatchesInventory(raw, inventory) {
  const target = uniqueTarget(inventory.tables);
  const rawFields = raw.fields.map(sanitizeRawField).sort(byFieldName);
  const normalizedFields = [...target.fields].sort(byFieldName);
  if (canonical(rawFields) !== canonical(normalizedFields)) throw failure(
    'Raw Field metadata does not match the sanitized inventory',
    'LARK_NATIVE_AI_SCHEMA_APPLY_RAW_FIELD_DRIFT',
  );
  const rawViews = raw.views.map(({ viewName: name }) => ({ viewName: name })).sort(byViewName);
  const normalizedViews = target.views.map((view) => ({ viewName: viewName(view) })).sort(byViewName);
  if (canonical(rawViews) !== canonical(normalizedViews)) throw failure(
    'Raw View metadata does not match the sanitized inventory',
    'LARK_NATIVE_AI_SCHEMA_APPLY_RAW_VIEW_DRIFT',
  );
}

export async function buildViewPlans(client, raw) {
  const grouped = groupBy(raw.views, 'viewName');
  const plans = [];
  for (const contract of LARK_NATIVE_AI_PREVIEW_VIEW_CONTRACTS) {
    const matches = grouped.get(contract.viewName) ?? [];
    if (matches.length > 1) throw failure(
      'Required View identity is duplicated',
      'LARK_NATIVE_AI_SCHEMA_APPLY_VIEW_IDENTITY_INVALID',
      { viewName: contract.viewName, count: matches.length },
    );
    if (matches.length === 0) {
      plans.push(freeze({ viewName: contract.viewName, contract, state: 'create', view: null }));
      continue;
    }
    const view = matches[0];
    const hydrated = await client.getView({
      tableId: raw.table.tableId,
      viewId: text(view.viewId, `${contract.viewName}.viewId`),
    });
    const actual = normalizeComparableFilter(hydrated?.property?.filterInfo);
    const expected = buildExpectedViewFilter(contract, raw.fields);
    if (expected === null) {
      if (!isEmptyFilter(actual)) throw viewConflict(contract.viewName);
      plans.push(freeze({ viewName: contract.viewName, contract, state: 'complete', view }));
    } else if (canonical(actual) === canonical(expected.comparable)) {
      plans.push(freeze({ viewName: contract.viewName, contract, state: 'complete', view }));
    } else if (isEmptyFilter(actual)) {
      plans.push(freeze({ viewName: contract.viewName, contract, state: 'configure', view }));
    } else throw viewConflict(contract.viewName);
  }
  return plans;
}

export function buildExpectedViewFilter(contract, rawFields) {
  const logical = contract.logicalFilter;
  if (logical.mode === 'all_rows') return null;
  const conditions = logical.conditions.map((condition) => {
    const field = requireUniqueRawField(rawFields, condition.fieldName);
    const operator = ['equals', 'in'].includes(condition.operator) ? 'is' : null;
    if (!operator) throw failure(
      'Unsupported View filter operator',
      'LARK_NATIVE_AI_SCHEMA_APPLY_VIEW_FILTER_UNSUPPORTED',
      { operator: condition.operator },
    );
    return {
      fieldId: text(field.fieldId, `${condition.fieldName}.fieldId`),
      fieldType: Number(field.type),
      operator,
      values: condition.values.map(normalizeFilterScalar),
    };
  }).sort(compareFilterConditions);
  const conjunction = logical.mode === 'any_of' ? 'or' : 'and';
  return {
    comparable: { conjunction, conditions },
    mutation: {
      conjunction,
      conditions: conditions.map((condition) => ({
        fieldId: condition.fieldId,
        fieldType: condition.fieldType,
        operator: condition.operator,
        value: condition.values,
      })),
    },
  };
}

export function normalizeComparableFilter(value) {
  if (!value || !Array.isArray(value.conditions) || value.conditions.length === 0) {
    return { conjunction: 'and', conditions: [] };
  }
  return {
    conjunction: value.conjunction === 'or' ? 'or' : 'and',
    conditions: value.conditions.map((condition) => ({
      fieldId: condition.fieldId ?? condition.field_id ?? null,
      fieldType: Number(condition.fieldType ?? condition.field_type),
      operator: condition.operator ?? null,
      values: normalizeFilterValues(condition.value),
    })).sort(compareFilterConditions),
  };
}

export function isEmptyFilter(value) {
  return !value || !Array.isArray(value.conditions) || value.conditions.length === 0;
}

export function buildCreateFieldMutation(action) {
  const contract = FIELD_TYPES[action.fieldType];
  if (!contract) throw failure(
    'Unsupported accepted additive Field type',
    'LARK_NATIVE_AI_SCHEMA_APPLY_FIELD_TYPE_UNSUPPORTED',
    { fieldName: action.fieldName, fieldType: action.fieldType },
  );
  return {
    fieldName: action.fieldName,
    type: contract[0],
    uiType: contract[1],
    ...(Array.isArray(action.options)
      ? { property: { options: action.options.map((name, index) => ({ name, color: index % 10 })) } }
      : {}),
  };
}

export function buildSelectOptionMutation(field, optionsToAdd) {
  if (![3, 4].includes(Number(field.type)) || !Array.isArray(field.property?.options)) throw failure(
    'Select option metadata is unavailable during Apply',
    'LARK_NATIVE_AI_SCHEMA_APPLY_OPTION_METADATA_UNAVAILABLE',
    { fieldName: field.fieldName },
  );
  const options = field.property.options.map((option) => structuredClone(option));
  const names = new Set(options.map(({ name }) => name));
  for (const name of optionsToAdd) if (!names.has(name)) {
    options.push({ name, color: options.length % 10 });
    names.add(name);
  }
  return {
    fieldName: field.fieldName,
    type: Number(field.type),
    uiType: field.uiType,
    description: field.description,
    property: { ...(field.property ?? {}), options },
  };
}

export function requireUniqueRawField(fields, name) {
  const matches = fields.filter(({ fieldName }) => fieldName === name);
  if (matches.length !== 1) throw failure(
    'Apply target Field identity is invalid',
    'LARK_NATIVE_AI_SCHEMA_APPLY_FIELD_IDENTITY_INVALID',
    { fieldName: name, count: matches.length },
  );
  return matches[0];
}

export function safeProgress(stage, action) {
  return freeze({
    stage,
    action: action.action,
    fieldName: action.fieldName ?? null,
    viewName: action.viewName ?? null,
  });
}

export function wrapActionFailure(error, action, appliedLogicalActionCount) {
  if (error?.code?.startsWith('LARK_NATIVE_AI_SCHEMA_APPLY_')) return error;
  return failure(
    'Lark Native AI additive schema action failed',
    'LARK_NATIVE_AI_SCHEMA_APPLY_REMOTE_ACTION_FAILED',
    {
      causeCode: error?.code ?? null,
      action: action.action,
      subject: action.fieldName ?? action.viewName ?? null,
      appliedLogicalActionCount,
    },
    error,
  );
}

export function schemaApplyFailure(message, code, details = {}, cause = null) {
  return failure(message, code, details, cause);
}
export function canonicalSchemaValue(value) { return canonical(value); }
export function freezeSchemaValue(value) { return freeze(value); }
export function safeSchemaBlockers(value) {
  return Array.isArray(value) ? value.map(({ code, subject }) => ({ code, subject })) : [];
}
export function schemaViewConflict(viewNameValue) { return viewConflict(viewNameValue); }

function sanitizeRawField(field) {
  const fieldType = normalizeRawFieldType(field);
  const options = ['SingleSelect', 'MultiSelect'].includes(fieldType)
    ? (Array.isArray(field.property?.options)
      ? [...new Set(field.property.options.map((option) => text(option?.name ?? option, 'option')))].sort()
      : null)
    : null;
  return {
    fieldName: text(field.fieldName, 'fieldName'),
    fieldType,
    ...(options === null ? {} : { options }),
  };
}

function normalizeRawFieldType(field) {
  const ui = typeof field.uiType === 'string'
    ? field.uiType.toLowerCase().replace(/[^a-z0-9]/gu, '') : '';
  const fieldType = ({
    text: 'Text', longtext: 'Text', multiline: 'Text', number: 'Number',
    singleselect: 'SingleSelect', multiselect: 'MultiSelect', date: 'DateTime',
    datetime: 'DateTime', checkbox: 'Checkbox',
  })[ui] ?? ({
    1: 'Text', 2: 'Number', 3: 'SingleSelect', 4: 'MultiSelect',
    5: 'DateTime', 7: 'Checkbox',
  })[Number(field.type)];
  if (!fieldType) throw failure(
    'Unsupported raw Lark Field type',
    'LARK_NATIVE_AI_SCHEMA_APPLY_FIELD_TYPE_UNSUPPORTED',
    { fieldName: field.fieldName ?? null },
  );
  return fieldType;
}

function uniqueTarget(tables) {
  const matches = array(tables, 'tables').filter(({ tableName }) => tableName === LARK_NATIVE_AI_TARGET_TABLE);
  if (matches.length !== 1) throw failure(
    'Target AI table identity is invalid',
    'LARK_NATIVE_AI_SCHEMA_APPLY_TARGET_TABLE_INVALID', { count: matches.length },
  );
  return matches[0];
}

function uniqueByName(items, key, field) {
  const map = new Map();
  for (const item of array(items, field)) {
    const name = text(item?.[key], `${field}.${key}`);
    if (map.has(name)) throw failure(
      'Duplicate name in target metadata',
      'LARK_NATIVE_AI_SCHEMA_APPLY_DUPLICATE_NAME', { name },
    );
    map.set(name, item);
  }
  return map;
}

function preserveOptions(name, before, after) {
  if (!Object.hasOwn(before, 'options')) return;
  const removed = knownOptions(before, name).filter((option) => !knownOptions(after, name).includes(option));
  if (removed.length > 0) throw failure(
    'A pre-existing Select option was removed',
    'LARK_NATIVE_AI_SCHEMA_APPLY_OPTION_DRIFT', { fieldName: name, removed },
  );
}

function knownOptions(field, name) {
  if (!Array.isArray(field?.options)) throw failure(
    'Select option metadata is unavailable',
    'LARK_NATIVE_AI_SCHEMA_APPLY_OPTION_METADATA_UNAVAILABLE', { fieldName: name },
  );
  return field.options;
}

function groupBy(items, key) {
  const map = new Map();
  for (const item of items) {
    const name = text(item?.[key], key);
    map.set(name, [...(map.get(name) ?? []), item]);
  }
  return map;
}

function normalizeFilterValues(value) {
  if (Array.isArray(value)) return value.map(normalizeFilterScalar);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return (Array.isArray(parsed) ? parsed : [parsed]).map(normalizeFilterScalar);
    } catch { return [value]; }
  }
  return [normalizeFilterScalar(value)];
}

function normalizeFilterScalar(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return String(value);
  return String(value);
}

function compareFilterConditions(a, b) {
  return String(a.fieldId).localeCompare(String(b.fieldId))
    || String(a.operator).localeCompare(String(b.operator))
    || canonical(a.values).localeCompare(canonical(b.values));
}

function viewConflict(viewNameValue) {
  return failure(
    'Existing required View filter conflicts with the accepted contract',
    'LARK_NATIVE_AI_SCHEMA_APPLY_VIEW_FILTER_CONFLICT', { viewName: viewNameValue },
  );
}
function unacceptedAction(action) {
  return failure(
    'Current Preview contains an unaccepted action',
    'LARK_NATIVE_AI_SCHEMA_APPLY_UNACCEPTED_ACTION',
    { action: action.action, subject: action.fieldName ?? action.viewName ?? null },
  );
}
function identity(action) { return `${action.action}:${action.fieldName ?? action.viewName ?? ''}`; }
function viewName(view) { return typeof view === 'string' ? text(view, 'viewName') : text(view?.viewName, 'viewName'); }
function byFieldName(a, b) { return a.fieldName.localeCompare(b.fieldName); }
function byViewName(a, b) { return a.viewName.localeCompare(b.viewName); }
function text(value, field) { if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${field} is required`); return value.trim(); }
function array(value, field) { if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`); return value; }
function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`; return JSON.stringify(value); }
function failure(message, code, details = {}, cause = null) { const error = new Error(message); error.name = 'LarkNativeAiSchemaApplyError'; error.code = code; error.details = Object.freeze({ ...details }); if (cause) error.cause = cause; return error; }
function freeze(value) { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const nested of Object.values(value)) freeze(nested); return value; }
