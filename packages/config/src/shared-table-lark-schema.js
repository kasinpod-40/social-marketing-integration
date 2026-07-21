import { LARK_TABLE_ENV } from './lark-table-config.js';
import { permanentError } from '../../shared/src/errors/runtime-error.js';
import { parseCsvRecords } from '../../shared/src/text/csv.js';

export const SHARED_TABLE_LARK_SCHEMA_VERSION = 'shared-table-lark-schema-v0.12.1';
export const SHARED_TABLE_LARK_SCHEMA_EXPECTED_TABLE_COUNT = 7;
export const SHARED_TABLE_LARK_SCHEMA_EXPECTED_FIELD_COUNT = 128;

const FIELD_TYPE_MAP = Object.freeze({
  Text: Object.freeze({ type: 1, uiType: 'Text' }),
  LongText: Object.freeze({ type: 1, uiType: 'Text' }),
  Number: Object.freeze({ type: 2, uiType: 'Number' }),
  SingleSelect: Object.freeze({ type: 3, uiType: 'SingleSelect' }),
  Date: Object.freeze({ type: 5, uiType: 'DateTime' }),
  DateTime: Object.freeze({ type: 5, uiType: 'DateTime' }),
  Checkbox: Object.freeze({ type: 7, uiType: 'Checkbox' }),
  URL: Object.freeze({ type: 15, uiType: 'Url' }),
});

const TABLE_CONTRACTS = deepFreeze({
  RAW_Meta_Organic_Accounts: table('rawMetaOrganicAccounts', 'LARK_TABLE_RAW_META_ORGANIC_ACCOUNTS', '📋 All Accounts'),
  RAW_Meta_Organic_Content: table('rawMetaOrganicContent', 'LARK_TABLE_RAW_META_ORGANIC_CONTENT', '📋 All Content'),
  RAW_Meta_Organic_Metrics: table('rawMetaOrganicMetrics', 'LARK_TABLE_RAW_META_ORGANIC_METRICS', '📋 All Metrics'),
  RAW_Ads_Entities: table('rawAdsEntities', 'LARK_TABLE_RAW_ADS_ENTITIES', '📋 All Entities'),
  RAW_Ads_Daily: table('rawAdsDaily', 'LARK_TABLE_RAW_ADS_DAILY', '📋 All Daily Metrics'),
  MKT_Account_Daily: table('mktAccountDaily', 'LARK_TABLE_MKT_ACCOUNT_DAILY', '📋 All Account Daily'),
  MKT_Ads_Ads: table('mktAdsAds', 'LARK_TABLE_MKT_ADS_ADS', '📋 All Ads'),
});

export const SHARED_TABLE_LARK_SCHEMA_TABLE_KEYS = Object.freeze(
  Object.values(TABLE_CONTRACTS).map((contract) => contract.key),
);

export function buildSharedTableLarkSchemaFromCsv(input) {
  const inventoryRows = parseCsvRecords(requireText(input?.tableInventoryCsv, 'tableInventoryCsv'));
  const fieldRows = parseCsvRecords(requireText(input?.fieldsCsv, 'fieldsCsv'));
  const migrationRows = parseCsvRecords(requireText(input?.migrationMapCsv, 'migrationMapCsv'));
  const inventoryByTable = new Map(inventoryRows.map((row) => [requireText(row.Table, 'tableInventory.Table'), row]));
  const fieldsByTable = groupRows(fieldRows, 'Table');
  const migrationByTarget = new Map(
    migrationRows
      .filter((row) => row['Target table']?.trim())
      .map((row) => [row['Target table'].trim(), row]),
  );

  rejectUnexpectedTables(fieldsByTable);
  const schema = [];

  for (const [logicalName, contract] of Object.entries(TABLE_CONTRACTS)) {
    const inventory = inventoryByTable.get(logicalName);
    if (!inventory) throw invalid(`Shared-table inventory is missing ${logicalName}`);
    const migration = migrationByTarget.get(logicalName);
    if (!migration) throw invalid(`Shared-table migration map is missing ${logicalName}`);
    const rows = [...(fieldsByTable.get(logicalName) ?? [])]
      .sort((left, right) => readOrder(left) - readOrder(right));
    if (rows.length === 0) throw invalid(`Shared-table field contract is missing ${logicalName}`);
    validateFieldRows(logicalName, inventory, rows);

    const envName = LARK_TABLE_ENV[contract.key];
    if (envName !== contract.envName) {
      throw invalid(`Lark environment mapping mismatch for ${logicalName}: expected ${contract.envName}`);
    }

    const currentSourceTable = migration['Current table']?.trim() || null;
    const physicalAction = normalizePhysicalAction(inventory['Physical action'], logicalName);
    if (physicalAction === 'rename_reuse_in_place' && !currentSourceTable) {
      throw invalid(`Rename/reuse table requires a current source table: ${logicalName}`);
    }
    if (physicalAction === 'create_new' && currentSourceTable) {
      throw invalid(`Create-new table must not declare a current source table: ${logicalName}`);
    }

    schema.push(Object.freeze({
      key: contract.key,
      logicalName,
      createName: logicalName,
      aliases: Object.freeze([logicalName, ...(currentSourceTable ? [currentSourceTable] : [])]),
      defaultViewName: contract.defaultViewName,
      envName,
      fields: Object.freeze(rows.map((row) => toInstallerField(logicalName, row))),
      sharedTable: Object.freeze({
        physicalAction,
        currentSourceTable,
        preserveTableId: migration['Preserve Table ID'] === 'Yes',
        safetyGate: migration['Safety gate']?.trim() || null,
      }),
    }));
  }

  validateSharedTableLarkSchema(schema);
  return deepFreeze(schema);
}

export function buildSharedTableViewContractFromCsv(input) {
  const rows = parseCsvRecords(requireText(input?.viewPlanCsv, 'viewPlanCsv'));
  const views = rows.map((row) => {
    const table = requireText(row.Table, 'viewPlan.Table');
    if (!TABLE_CONTRACTS[table]) throw invalid(`View contract targets unknown shared table: ${table}`);
    return Object.freeze({
      table,
      viewName: requireText(row.View, `${table}.View`),
      filter: requireText(row.Filter, `${table}.Filter`),
      purpose: row.Purpose?.trim() || null,
    });
  });
  const unique = new Set();
  for (const view of views) {
    const key = `${view.table}\u0000${view.viewName.toLocaleLowerCase('en-US')}`;
    if (unique.has(key)) throw invalid(`Duplicate shared-table View: ${view.table}.${view.viewName}`);
    unique.add(key);
  }
  return deepFreeze(views);
}


/**
 * แปลง View plan แบบอ่านง่ายจาก CSV เป็น Contract ของ View installer กลาง
 * เพื่อใช้ Resolver เดียวกับ Report Views สำหรับ Field ID, Select option ID และ Idempotency.
 */
export function buildSharedTableViewInstallerContract(input) {
  const views = Array.isArray(input?.views) ? input.views : [];
  const schema = Array.isArray(input?.schema) ? input.schema : [];
  validateSharedTableLarkSchema(schema);
  const schemaByName = new Map(schema.map((tableContract) => [tableContract.logicalName, tableContract]));
  const grouped = new Map();

  for (let index = 0; index < views.length; index += 1) {
    const view = views[index];
    const tableContract = schemaByName.get(view?.table);
    if (!tableContract) throw invalid(`Shared-table View targets unknown table: ${view?.table}`);
    const parsedFilter = parseSharedTableViewFilter(view.filter, tableContract);
    const group = grouped.get(tableContract.key) ?? {
      tableKey: tableContract.key,
      envName: tableContract.envName,
      views: [],
    };
    group.views.push(Object.freeze({
      key: `shared_${String(index + 1).padStart(2, '0')}`,
      name: requireText(view.viewName, `${tableContract.logicalName}.viewName`),
      type: 'grid',
      hiddenFields: Object.freeze([]),
      filterInfo: parsedFilter,
    }));
    grouped.set(tableContract.key, group);
  }

  const contract = schema
    .filter((tableContract) => grouped.has(tableContract.key))
    .map((tableContract) => {
      const group = grouped.get(tableContract.key);
      return Object.freeze({
        tableKey: group.tableKey,
        envName: group.envName,
        views: Object.freeze(group.views),
      });
    });

  if (contract.flatMap((tableContract) => tableContract.views).length !== views.length) {
    throw invalid('Shared-table View installer contract lost one or more Views');
  }
  return deepFreeze(contract);
}

function parseSharedTableViewFilter(value, tableContract) {
  const text = requireText(value, `${tableContract.logicalName}.filter`);
  const fieldsByName = new Set(tableContract.fields.map((field) => field.fieldName));
  const conditions = text.split(/\s+AND\s+/iu).map((expression) => {
    const match = /^([A-Za-z][A-Za-z0-9_]*)=([A-Za-z0-9_]+)$/u.exec(expression.trim());
    if (!match) throw invalid(`Unsupported Shared-table View filter: ${text}`);
    const [, fieldName, filterValue] = match;
    if (!fieldsByName.has(fieldName)) {
      throw invalid(`Shared-table View filter references unknown field ${tableContract.logicalName}.${fieldName}`);
    }
    return Object.freeze({ fieldName, operator: 'is', value: filterValue });
  });
  if (conditions.length === 0) throw invalid(`Shared-table View filter is empty: ${text}`);
  return Object.freeze({ conjunction: 'and', conditions: Object.freeze(conditions) });
}

export function validateSharedTableLarkSchema(schema) {
  if (!Array.isArray(schema) || schema.length !== SHARED_TABLE_LARK_SCHEMA_EXPECTED_TABLE_COUNT) {
    throw invalid(`Shared-table schema must contain exactly ${SHARED_TABLE_LARK_SCHEMA_EXPECTED_TABLE_COUNT} tables`);
  }
  const keys = new Set();
  let fieldCount = 0;
  let reuseCount = 0;
  let createCount = 0;
  for (const tableContract of schema) {
    if (keys.has(tableContract.key)) throw invalid(`Duplicate shared-table key: ${tableContract.key}`);
    keys.add(tableContract.key);
    if (LARK_TABLE_ENV[tableContract.key] !== tableContract.envName) {
      throw invalid(`Invalid environment mapping for shared table ${tableContract.key}`);
    }
    const primary = tableContract.fields.filter((field) => field.primary === true);
    if (primary.length !== 1 || tableContract.fields[0].primary !== true || tableContract.fields[0].type !== 1) {
      throw invalid(`Shared table ${tableContract.logicalName} must have one Primary Text field first`);
    }
    const fieldNames = new Set();
    for (const field of tableContract.fields) {
      if (fieldNames.has(field.fieldName)) throw invalid(`Duplicate field ${tableContract.logicalName}.${field.fieldName}`);
      fieldNames.add(field.fieldName);
      fieldCount += 1;
    }
    if (tableContract.sharedTable.physicalAction === 'rename_reuse_in_place') reuseCount += 1;
    else if (tableContract.sharedTable.physicalAction === 'create_new') createCount += 1;
    else throw invalid(`Unknown shared-table physical action for ${tableContract.logicalName}`);
  }
  if (fieldCount !== SHARED_TABLE_LARK_SCHEMA_EXPECTED_FIELD_COUNT) {
    throw invalid(`Shared-table schema must contain exactly ${SHARED_TABLE_LARK_SCHEMA_EXPECTED_FIELD_COUNT} fields`);
  }
  if (reuseCount !== 5 || createCount !== 2) {
    throw invalid(`Shared-table schema must reuse five tables and create two tables; got reuse=${reuseCount}, create=${createCount}`);
  }
  return true;
}

function toInstallerField(tableName, row) {
  const typeName = requireText(row['Lark Type'], `${tableName}.${row.Field}.Lark Type`);
  const mapped = FIELD_TYPE_MAP[typeName];
  if (!mapped) throw invalid(`Unsupported shared-table Lark field type: ${typeName}`);
  const order = readOrder(row);
  const keyRole = row['Key role']?.trim() ?? '';
  const relationOrOptions = row['Relation / Options']?.trim() ?? '';
  const property = buildProperty(typeName, relationOrOptions);
  return Object.freeze({
    fieldName: requireText(row.Field, `${tableName}.Field`),
    type: mapped.type,
    uiType: mapped.uiType,
    primary: order === 1 && /primary/iu.test(keyRole),
    ...(property ? { property } : {}),
    description: buildDescription(row),
    manageDescription: true,
    required: row.Required === 'Yes',
    nullable: row.Nullable === 'Yes',
    keyRole,
    sourcePath: row['Source path / metric']?.trim() || null,
    relationTarget: typeName !== 'SingleSelect' && relationOrOptions ? relationOrOptions : null,
  });
}

function buildProperty(typeName, relationOrOptions) {
  if (typeName === 'SingleSelect') {
    const options = relationOrOptions.split('|').map((value) => value.trim()).filter(Boolean);
    if (options.length === 0) throw invalid('SingleSelect fields require approved options');
    return Object.freeze({ options: Object.freeze(options.map((name, index) => Object.freeze({ name, color: index % 8 }))) });
  }
  if (typeName === 'Date') return Object.freeze({ date_formatter: 'yyyy/MM/dd', auto_fill: false });
  if (typeName === 'DateTime') return Object.freeze({ date_formatter: 'yyyy/MM/dd HH:mm', auto_fill: false });
  return null;
}

function buildDescription(row) {
  return [
    row.Definition,
    row['Source path / metric'] ? `Source: ${row['Source path / metric']}` : null,
    row['Time / zero / null semantics'] ? `Semantics: ${row['Time / zero / null semantics']}` : null,
    row['Import note'] ? `Import: ${row['Import note']}` : null,
  ].map((value) => value?.trim()).filter(Boolean).join(' | ').slice(0, 900);
}

function validateFieldRows(tableName, inventory, rows) {
  const orders = new Set();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const order = readOrder(row);
    if (orders.has(order)) throw invalid(`Duplicate field order ${tableName}.${order}`);
    orders.add(order);
    if (order !== index + 1) throw invalid(`Field order must be contiguous for ${tableName}`);
    requireChoice(row.Required, `${tableName}.${row.Field}.Required`, ['Yes', 'No']);
    requireChoice(row.Nullable, `${tableName}.${row.Field}.Nullable`, ['Yes', 'No']);
    if (row.Required === 'Yes' && row.Nullable !== 'No') {
      throw invalid(`Required field cannot be nullable: ${tableName}.${row.Field}`);
    }
  }
  if (rows[0].Field !== inventory['Stable key field']) {
    throw invalid(`Stable key mismatch for ${tableName}: inventory=${inventory['Stable key field']}, first=${rows[0].Field}`);
  }
}

function rejectUnexpectedTables(fieldsByTable) {
  for (const tableName of fieldsByTable.keys()) {
    if (!TABLE_CONTRACTS[tableName]) throw invalid(`Unexpected table in shared-table field contract: ${tableName}`);
  }
}

function groupRows(rows, key) {
  const result = new Map();
  for (const row of rows) {
    const value = requireText(row[key], `CSV.${key}`);
    const group = result.get(value) ?? [];
    group.push(row);
    result.set(value, group);
  }
  return result;
}

function normalizePhysicalAction(value, tableName) {
  const text = requireText(value, `${tableName}.Physical action`).toLocaleLowerCase('en-US');
  if (text === 'rename/reuse in place') return 'rename_reuse_in_place';
  if (text === 'create new') return 'create_new';
  throw invalid(`Unsupported physical action for ${tableName}: ${value}`);
}

function readOrder(row) {
  const value = Number(row.Order);
  if (!Number.isInteger(value) || value <= 0) throw invalid(`Invalid field order: ${row.Order}`);
  return value;
}

function table(key, envName, defaultViewName) { return Object.freeze({ key, envName, defaultViewName }); }
function invalid(message) { return permanentError(message, { code: 'SHARED_TABLE_LARK_SCHEMA_INVALID' }); }
function requireText(value, name) { if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required`); return value.trim(); }
function requireChoice(value, name, choices) { const text = requireText(value, name); if (!choices.includes(text)) throw invalid(`${name} must be one of: ${choices.join(', ')}`); return text; }
function deepFreeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; }
