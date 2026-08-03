import {
  LARK_AI_REPORT_RUNS_ADDITIVE_FIELDS,
  LARK_AI_REPORT_RUNS_OPTION_EXTENSIONS,
  LARK_AI_REPORT_RUNS_PREVIEW_VIEWS,
} from './lark-native-ai-all-channel-contract.js';

export const LARK_NATIVE_AI_SCHEMA_PREVIEW_VERSION = 'lark_native_ai_schema_preview_v1';
export const LARK_NATIVE_AI_TARGET_TABLE = '🧠 MKT_AI_Report_Runs';

export const LARK_NATIVE_AI_REUSED_FIELDS = Object.freeze([
  freezeExpectedField('report_id', 'Text'),
  freezeExpectedField('platforms', 'MultiSelect'),
  freezeExpectedField('report_type', 'SingleSelect'),
  freezeExpectedField('metric_summary_json', 'Text'),
  freezeExpectedField('insight_summary', 'Text'),
  freezeExpectedField('strengths', 'Text'),
  freezeExpectedField('weaknesses', 'Text'),
  freezeExpectedField('recommendations', 'Text'),
  freezeExpectedField('sent_to_group', 'Checkbox'),
  freezeExpectedField('sent_at', 'DateTime'),
]);

export const LARK_NATIVE_AI_PREVIEW_VIEW_CONTRACTS = Object.freeze([
  freezeView('🌐 All Channel Readiness', Object.freeze({ mode: 'all_rows' })),
  freezeView('📊 Executive Summaries', Object.freeze({
    mode: 'all_of',
    conditions: Object.freeze([freezeCondition('scope_type', 'equals', ['executive'])]),
  })),
  freezeView('⚠️ Missing / Partial Data', Object.freeze({
    mode: 'any_of',
    conditions: Object.freeze([
      freezeCondition('readiness_status', 'in', [
        'report_partial', 'report_missing', 'configuration_missing', 'source_unavailable',
        'not_observed', 'validation_failed',
      ]),
    ]),
  })),
  freezeView('✅ Notification Eligible', Object.freeze({
    mode: 'all_of',
    conditions: Object.freeze([
      freezeCondition('notification_eligible', 'equals', [true]),
      freezeCondition('preview_mode', 'equals', [false]),
    ]),
  })),
  freezeView('❌ AI Generation Failures', Object.freeze({
    mode: 'all_of',
    conditions: Object.freeze([freezeCondition('generation_status', 'equals', ['failed'])]),
  })),
  freezeView('🧪 Preview Runs', Object.freeze({
    mode: 'all_of',
    conditions: Object.freeze([freezeCondition('preview_mode', 'equals', [true])]),
  })),
]);

/**
 * Build an additive-only Lark schema Preview. It never calls Lark or mutates an inventory.
 */
export function buildLarkNativeAiSchemaPreview(input = {}) {
  const inventory = normalizeInventory(input.inventory ?? input);
  const actions = [];
  const blockers = [];
  const targetTables = inventory.tables.filter(({ tableName }) => tableName === LARK_NATIVE_AI_TARGET_TABLE);

  if (targetTables.length === 0) {
    blockers.push(blocker('TARGET_TABLE_MISSING', LARK_NATIVE_AI_TARGET_TABLE, null));
  } else if (targetTables.length > 1) {
    blockers.push(blocker('TARGET_TABLE_DUPLICATE', LARK_NATIVE_AI_TARGET_TABLE, {
      count: targetTables.length,
    }));
  }

  const table = targetTables.length === 1 ? targetTables[0] : null;
  if (table) {
    inspectDuplicateNames(table.fields.map(({ fieldName }) => fieldName), 'FIELD_NAME_DUPLICATE', blockers);
    inspectDuplicateNames(table.views.map(({ viewName }) => viewName), 'VIEW_NAME_DUPLICATE', blockers);
    planReusedFields(table, blockers);
    planAdditiveFields(table, actions, blockers);
    planOptionExtensions(table, actions, blockers);
    planViews(table, actions);
  }

  actions.sort(compareActions);
  blockers.sort(compareBlockers);
  const status = blockers.length > 0
    ? 'blocked'
    : (actions.length === 0 ? 'zero_drift' : 'ready_to_apply');

  return deepFreeze({
    ok: blockers.length === 0,
    contractVersion: LARK_NATIVE_AI_SCHEMA_PREVIEW_VERSION,
    targetTable: LARK_NATIVE_AI_TARGET_TABLE,
    inventoryIdentity: Object.freeze({
      baseName: inventory.baseName,
      baseRevision: inventory.baseRevision,
      sourceSha256: inventory.sourceSha256,
      tableCount: inventory.tables.length,
    }),
    status,
    applyAuthorized: false,
    actions,
    blockers,
    counts: Object.freeze({
      addField: actions.filter(({ action }) => action === 'add_field').length,
      extendSelectOptions: actions.filter(({ action }) => action === 'extend_select_options').length,
      createView: actions.filter(({ action }) => action === 'create_view').length,
      blockers: blockers.length,
      totalActions: actions.length,
    }),
    safety: Object.freeze({
      renameField: 0,
      deleteField: 0,
      changeFieldType: 0,
      deleteView: 0,
      remoteLarkRead: 0,
      remoteLarkWrite: 0,
      automationCreate: 0,
      notificationSend: 0,
      remoteD1QueueWorkerProvider: 0,
      production: 'BLOCKED',
    }),
  });
}

/** Pure simulation used for replay/idempotency verification. */
export function simulateLarkNativeAiSchemaPreviewApply(inventoryInput, previewInput = null) {
  const inventory = normalizeInventory(inventoryInput);
  const preview = previewInput ?? buildLarkNativeAiSchemaPreview({ inventory });
  if (!preview?.ok || preview.status === 'blocked') {
    throw new TypeError('Cannot simulate a blocked Lark Native AI schema Preview');
  }

  const clone = JSON.parse(JSON.stringify(inventory));
  const table = clone.tables.find(({ tableName }) => tableName === LARK_NATIVE_AI_TARGET_TABLE);
  if (!table) throw new TypeError(`Missing ${LARK_NATIVE_AI_TARGET_TABLE}`);

  for (const action of preview.actions) {
    if (action.action === 'add_field') {
      table.fields.push({
        fieldName: action.fieldName,
        fieldType: action.fieldType,
        options: action.options ? [...action.options] : [],
        optionsKnown: action.options !== null,
      });
    } else if (action.action === 'extend_select_options') {
      const field = table.fields.find(({ fieldName }) => fieldName === action.fieldName);
      if (!field) throw new TypeError(`Missing field during simulation: ${action.fieldName}`);
      field.options = [...new Set([...(field.options ?? []), ...action.optionsToAdd])];
      field.optionsKnown = true;
    } else if (action.action === 'create_view') {
      table.views.push({ viewName: action.viewName });
    } else {
      throw new TypeError(`Unsupported schema Preview action: ${action.action}`);
    }
  }

  return deepFreeze(clone);
}

function planReusedFields(table, blockers) {
  for (const expected of LARK_NATIVE_AI_REUSED_FIELDS) {
    const matches = table.fields.filter(({ fieldName }) => fieldName === expected.fieldName);
    if (matches.length === 0) {
      blockers.push(blocker('REQUIRED_REUSE_FIELD_MISSING', expected.fieldName, {
        expectedType: expected.fieldType,
      }));
      continue;
    }
    if (matches.length > 1) continue;
    const actualType = matches[0].fieldType;
    if (actualType !== expected.fieldType) {
      blockers.push(blocker('REQUIRED_REUSE_FIELD_TYPE_CONFLICT', expected.fieldName, {
        expectedType: expected.fieldType,
        actualType,
      }));
    }
  }
}

function planAdditiveFields(table, actions, blockers) {
  for (const expected of LARK_AI_REPORT_RUNS_ADDITIVE_FIELDS) {
    const matches = table.fields.filter(({ fieldName }) => fieldName === expected.fieldName);
    if (matches.length === 0) {
      actions.push(Object.freeze({
        action: 'add_field',
        phase: 1,
        tableName: LARK_NATIVE_AI_TARGET_TABLE,
        fieldName: expected.fieldName,
        fieldType: normalizeFieldType(expected.fieldType),
        required: expected.required,
        options: expected.options ? Object.freeze([...expected.options]) : null,
        additiveOnly: true,
      }));
      continue;
    }
    if (matches.length > 1) continue;
    const actual = matches[0];
    const expectedType = normalizeFieldType(expected.fieldType);
    if (actual.fieldType !== expectedType) {
      blockers.push(blocker('ADDITIVE_FIELD_TYPE_CONFLICT', expected.fieldName, {
        expectedType,
        actualType: actual.fieldType,
      }));
      continue;
    }
    if (expected.options) planSelectOptions(actual, expected.options, actions, blockers, 2);
  }
}

function planOptionExtensions(table, actions, blockers) {
  for (const [fieldName, expectedOptions] of Object.entries(LARK_AI_REPORT_RUNS_OPTION_EXTENSIONS)) {
    const matches = table.fields.filter((field) => field.fieldName === fieldName);
    if (matches.length !== 1) {
      if (matches.length === 0) {
        blockers.push(blocker('OPTION_EXTENSION_FIELD_MISSING', fieldName, null));
      }
      continue;
    }
    planSelectOptions(matches[0], expectedOptions, actions, blockers, 3);
  }
}

function planSelectOptions(field, expectedOptions, actions, blockers, phase) {
  if (!['SingleSelect', 'MultiSelect'].includes(field.fieldType)) {
    blockers.push(blocker('SELECT_FIELD_TYPE_CONFLICT', field.fieldName, {
      actualType: field.fieldType,
    }));
    return;
  }
  if (!field.optionsKnown) {
    blockers.push(blocker('SELECT_OPTIONS_UNAVAILABLE', field.fieldName, null));
    return;
  }
  const missing = expectedOptions.filter((option) => !field.options.includes(option));
  if (missing.length === 0) return;
  actions.push(Object.freeze({
    action: 'extend_select_options',
    phase,
    tableName: LARK_NATIVE_AI_TARGET_TABLE,
    fieldName: field.fieldName,
    optionsToAdd: Object.freeze([...missing]),
    preserveExistingOptions: true,
    additiveOnly: true,
  }));
}

function planViews(table, actions) {
  const existing = new Set(table.views.map(({ viewName }) => viewName));
  for (const contract of LARK_NATIVE_AI_PREVIEW_VIEW_CONTRACTS) {
    if (existing.has(contract.viewName)) continue;
    actions.push(Object.freeze({
      action: 'create_view',
      phase: 4,
      tableName: LARK_NATIVE_AI_TARGET_TABLE,
      viewName: contract.viewName,
      viewType: 'grid',
      logicalFilter: contract.logicalFilter,
      preserveExistingViews: true,
      additiveOnly: true,
    }));
  }
}

function normalizeInventory(value) {
  const source = requireObject(value, 'inventory');
  const tablesInput = requireArray(source.tables, 'inventory.tables');
  return deepFreeze({
    baseName: optionalText(source.baseName ?? source.base_name),
    baseRevision: optionalInteger(source.baseRevision ?? source.base_revision),
    sourceSha256: optionalText(source.sourceSha256 ?? source.source_sha256),
    tables: tablesInput.map((raw, tableIndex) => {
      const table = requireObject(raw, `inventory.tables[${tableIndex}]`);
      return {
        tableName: requireText(table.tableName ?? table.table_name ?? table.name, `inventory.tables[${tableIndex}].tableName`),
        fields: requireArray(table.fields ?? [], `inventory.tables[${tableIndex}].fields`).map((rawField, fieldIndex) => {
          const field = requireObject(rawField, `inventory.tables[${tableIndex}].fields[${fieldIndex}]`);
          const optionsPresent = Object.prototype.hasOwnProperty.call(field, 'options');
          return {
            fieldName: requireText(field.fieldName ?? field.field_name ?? field.name, `field[${fieldIndex}].fieldName`),
            fieldType: normalizeFieldType(field.fieldType ?? field.field_type ?? field.type),
            options: optionsPresent ? normalizeOptions(field.options) : [],
            optionsKnown: optionsPresent,
          };
        }),
        views: requireArray(table.views ?? [], `inventory.tables[${tableIndex}].views`).map((rawView, viewIndex) => ({
          viewName: typeof rawView === 'string'
            ? requireText(rawView, `view[${viewIndex}]`)
            : requireText(
              requireObject(rawView, `view[${viewIndex}]`).viewName
                ?? rawView.view_name
                ?? rawView.name,
              `view[${viewIndex}].viewName`,
            ),
        })),
      };
    }),
  });
}

function normalizeFieldType(value) {
  const raw = requireText(value, 'fieldType');
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalized = ({
    text: 'Text',
    longtext: 'Text',
    multiline: 'Text',
    singleselect: 'SingleSelect',
    select: 'SingleSelect',
    multiselect: 'MultiSelect',
    multipleselect: 'MultiSelect',
    number: 'Number',
    numeric: 'Number',
    checkbox: 'Checkbox',
    boolean: 'Checkbox',
    datetime: 'DateTime',
    date: 'DateTime',
  })[key];
  if (!normalized) throw new TypeError(`Unsupported Lark field type: ${raw}`);
  return normalized;
}

function normalizeOptions(value) {
  return [...new Set(requireArray(value, 'field.options').map((option, index) => {
    if (typeof option === 'string') return requireText(option, `field.options[${index}]`);
    const object = requireObject(option, `field.options[${index}]`);
    return requireText(object.name ?? object.text ?? object.value, `field.options[${index}].name`);
  }))].sort();
}

function inspectDuplicateNames(names, code, blockers) {
  const counts = new Map();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  for (const [name, count] of counts.entries()) {
    if (count > 1) blockers.push(blocker(code, name, { count }));
  }
}

function compareActions(left, right) {
  return left.phase - right.phase
    || left.action.localeCompare(right.action)
    || (left.fieldName ?? left.viewName).localeCompare(right.fieldName ?? right.viewName);
}

function compareBlockers(left, right) {
  return left.code.localeCompare(right.code) || String(left.subject).localeCompare(String(right.subject));
}

function blocker(code, subject, details) {
  return Object.freeze({ code, subject, details: details ? Object.freeze({ ...details }) : null });
}
function freezeExpectedField(fieldName, fieldType) {
  return Object.freeze({ fieldName, fieldType });
}
function freezeView(viewName, logicalFilter) {
  return Object.freeze({ viewName, logicalFilter });
}
function freezeCondition(fieldName, operator, values) {
  return Object.freeze({ fieldName, operator, values: Object.freeze([...values]) });
}
function optionalInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError('baseRevision must be a non-negative integer');
  return number;
}
function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${fieldName} must be an object`);
  return value;
}
function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
