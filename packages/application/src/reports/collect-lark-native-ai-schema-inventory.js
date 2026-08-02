import {
  buildLarkNativeAiSchemaPreview,
  LARK_NATIVE_AI_TARGET_TABLE,
} from '../../../config/src/lark-native-ai-schema-preview.js';

export const LARK_NATIVE_AI_REMOTE_INVENTORY_VERSION = 'lark_native_ai_remote_inventory_v1';

/**
 * Collect the minimum sanitized Lark metadata required by the additive schema planner.
 *
 * The injected client is used only through listTables/listFields/listViews. No record read,
 * field/view mutation, Automation, notification or AI operation is reachable from this module.
 */
export async function collectLarkNativeAiSchemaInventory(input = {}) {
  const client = requireClient(input.client);
  const baseName = optionalText(input.baseName);
  const rawTables = requireArray(await client.listTables(), 'listTables result');
  const tables = rawTables.map(normalizeTable).sort(compareTableIdentity);
  const targets = tables.filter(({ tableName }) => tableName === LARK_NATIVE_AI_TARGET_TABLE);

  let targetFields = [];
  let targetViews = [];
  let metadataReadOperations = 1;

  if (targets.length === 1) {
    targetFields = requireArray(
      await client.listFields({ tableId: targets[0].tableId }),
      'listFields result',
    ).map(normalizeField).sort(compareFieldIdentity);
    metadataReadOperations += 1;

    targetViews = requireArray(
      await client.listViews({ tableId: targets[0].tableId }),
      'listViews result',
    ).map(normalizeView).sort(compareViewIdentity);
    metadataReadOperations += 1;
  }

  const inventoryCore = {
    baseName,
    baseRevision: targets.length === 1 ? optionalNonNegativeInteger(targets[0].revision) : null,
    tables: tables.map((table) => ({
      tableName: table.tableName,
      fields: table.tableName === LARK_NATIVE_AI_TARGET_TABLE && targets.length === 1
        ? targetFields.map(stripFieldIdentity)
        : [],
      views: table.tableName === LARK_NATIVE_AI_TARGET_TABLE && targets.length === 1
        ? targetViews.map(({ viewName }) => ({ viewName }))
        : [],
    })),
  };
  const sourceSha256 = await sha256Hex(canonicalJson(inventoryCore));
  const inventory = deepFreeze({ ...inventoryCore, sourceSha256 });
  const preview = buildLarkNativeAiSchemaPreview({ inventory });

  return deepFreeze({
    ok: preview.ok,
    contractVersion: LARK_NATIVE_AI_REMOTE_INVENTORY_VERSION,
    targetTable: LARK_NATIVE_AI_TARGET_TABLE,
    targetTableCount: targets.length,
    metadataReadOperations,
    inventory,
    preview,
    safety: {
      tableIdsPersisted: 0,
      fieldIdsPersisted: 0,
      viewIdsPersisted: 0,
      recordReads: 0,
      remoteLarkWrites: 0,
      automationCreates: 0,
      notificationSends: 0,
      aiCalls: 0,
      remoteD1QueueWorkerProvider: 0,
      production: 'BLOCKED',
    },
  });
}

function normalizeTable(raw, index) {
  const table = requireObject(raw, `tables[${index}]`);
  return Object.freeze({
    tableId: requireText(table.tableId ?? table.table_id ?? table.id, `tables[${index}].tableId`),
    tableName: requireText(table.name ?? table.tableName ?? table.table_name, `tables[${index}].name`),
    revision: table.revision ?? null,
  });
}

function normalizeField(raw, index) {
  const field = requireObject(raw, `fields[${index}]`);
  const fieldName = requireText(
    field.fieldName ?? field.field_name ?? field.name,
    `fields[${index}].fieldName`,
  );
  const fieldType = normalizeLarkFieldType(field.type, field.uiType ?? field.ui_type, fieldName);
  const options = normalizeSelectOptions(field.property?.options, fieldType, fieldName);
  return Object.freeze({
    fieldName,
    fieldType,
    ...(options === null ? {} : { options }),
  });
}

function normalizeView(raw, index) {
  const view = requireObject(raw, `views[${index}]`);
  return Object.freeze({
    viewName: requireText(
      view.viewName ?? view.view_name ?? view.name,
      `views[${index}].viewName`,
    ),
  });
}

function normalizeLarkFieldType(typeValue, uiTypeValue, fieldName) {
  const uiKey = typeof uiTypeValue === 'string'
    ? uiTypeValue.toLowerCase().replace(/[^a-z0-9]/gu, '')
    : '';
  const fromUi = ({
    text: 'Text',
    longtext: 'Text',
    multiline: 'Text',
    number: 'Number',
    singleselect: 'SingleSelect',
    multiselect: 'MultiSelect',
    date: 'DateTime',
    datetime: 'DateTime',
    checkbox: 'Checkbox',
  })[uiKey];
  if (fromUi) return fromUi;

  const type = Number(typeValue);
  const fromType = ({
    1: 'Text',
    2: 'Number',
    3: 'SingleSelect',
    4: 'MultiSelect',
    5: 'DateTime',
    7: 'Checkbox',
  })[type];
  if (fromType) return fromType;

  throw inventoryError(
    `Unsupported Lark field type for ${fieldName}`,
    'LARK_NATIVE_AI_REMOTE_FIELD_TYPE_UNSUPPORTED',
    { fieldName, type: Number.isFinite(type) ? type : null, uiTypePresent: uiKey !== '' },
  );
}

function normalizeSelectOptions(value, fieldType, fieldName) {
  if (!['SingleSelect', 'MultiSelect'].includes(fieldType)) return null;
  if (!Array.isArray(value)) return null;
  return Object.freeze([...new Set(value.map((raw, index) => {
    if (typeof raw === 'string') return requireText(raw, `${fieldName}.options[${index}]`);
    const option = requireObject(raw, `${fieldName}.options[${index}]`);
    return requireText(
      option.name ?? option.text ?? option.value,
      `${fieldName}.options[${index}].name`,
    );
  }))].sort());
}

function stripFieldIdentity(field) {
  return {
    fieldName: field.fieldName,
    fieldType: field.fieldType,
    ...(Object.prototype.hasOwnProperty.call(field, 'options') ? { options: [...field.options] } : {}),
  };
}

function compareTableIdentity(left, right) {
  return left.tableName.localeCompare(right.tableName) || left.tableId.localeCompare(right.tableId);
}
function compareFieldIdentity(left, right) {
  return left.fieldName.localeCompare(right.fieldName);
}
function compareViewIdentity(left, right) {
  return left.viewName.localeCompare(right.viewName);
}

function requireClient(value) {
  const client = requireObject(value, 'client');
  for (const method of ['listTables', 'listFields', 'listViews']) {
    if (typeof client[method] !== 'function') throw new TypeError(`client.${method} is required`);
  }
  return client;
}
function optionalNonNegativeInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return value;
}
function inventoryError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkNativeAiRemoteInventoryError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is required');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
