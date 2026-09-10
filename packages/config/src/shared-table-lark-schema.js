import { LARK_TABLE_ENV } from './lark-table-config.js';
import { permanentError } from '../../shared/src/errors/runtime-error.js';
import { parseCsvRecords } from '../../shared/src/text/csv.js';

export const SHARED_TABLE_LARK_SCHEMA_VERSION = 'customer-shared-table-lark-schema-v0.15.0';
export const SHARED_TABLE_LARK_SCHEMA_EXPECTED_TABLE_COUNT = 3;
export const SHARED_TABLE_LARK_SCHEMA_EXPECTED_FIELD_COUNT = 51;
export const MKT_ADS_CAMPAIGN_SUMMARY_LOGICAL_NAME = 'MKT_Ads_Campaign_Summary';
export const MKT_ADS_CAMPAIGN_SUMMARY_DISPLAY_NAME = '📊 MKT_Ads_Campaign_Summary';
export const MKT_ADS_CAMPAIGN_SUMMARY_EXPECTED_FIELD_COUNT = 22;
export const MKT_ADS_CAMPAIGN_SUMMARY_GROUP_FIELD = 'period_month_th';
// Lark canonicalizes independent Sort to [] once this Grid View is grouped.
// Month order is therefore owned only by the descending group configuration.
export const MKT_ADS_CAMPAIGN_SUMMARY_VIEW_SORT = deepFreeze([]);
export const MKT_ADS_CAMPAIGN_SUMMARY_VISIBLE_FIELDS = deepFreeze([
  'campaign_summary_key',
  'campaign_name', 'platform', 'status', 'period_month_th', 'period_start', 'period_end',
  'spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm', 'conversions', 'conversion_value', 'cpa', 'roas',
  'currency', 'account_id', 'campaign_id', 'last_synced_at', 'period_kind',
]);

const MKT_ADS_CAMPAIGN_SUMMARY_FIELD_CONTRACT = deepFreeze([
  ['campaign_summary_key', 1, true, true, false, []],
  ['period_kind', 3, false, true, false, ['mtd']],
  ['period_month_th', 1, false, true, false, []],
  ['period_start', 5, false, true, false, []],
  ['period_end', 5, false, true, false, []],
  ['platform', 3, false, true, false, ['meta_ads', 'google_ads', 'tiktok_ads']],
  ['account_id', 1, false, true, false, []],
  ['campaign_id', 1, false, true, false, []],
  ['campaign_name', 1, false, false, true, []],
  ['status', 1, false, false, true, []],
  ['currency', 1, false, false, true, []],
  ['spend', 2, false, false, true, []],
  ['impressions', 2, false, false, true, []],
  ['clicks', 2, false, false, true, []],
  ['ctr', 2, false, false, true, []],
  ['cpc', 2, false, false, true, []],
  ['cpm', 2, false, false, true, []],
  ['conversions', 2, false, false, true, []],
  ['cpa', 2, false, false, true, []],
  ['conversion_value', 2, false, false, true, []],
  ['roas', 2, false, false, true, []],
  ['last_synced_at', 5, false, true, false, []],
]);

const MKT_ADS_CAMPAIGN_SUMMARY_VIEW_CONTRACT = deepFreeze([
  ['📊 Overview', 'platform IS NOT EMPTY'],
  ['🔵 Meta', 'platform=meta_ads'],
  ['🔴 Google', 'platform=google_ads'],
  ['⚫ TikTok', 'platform=tiktok_ads'],
]);

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
  MKT_Account_Daily: table('mktAccountDaily', 'LARK_TABLE_MKT_ACCOUNT_DAILY', '📋 All Account Daily'),
  MKT_Ads_Ads: table('mktAdsAds', 'LARK_TABLE_MKT_ADS_ADS', '📋 All Ads'),
  [MKT_ADS_CAMPAIGN_SUMMARY_LOGICAL_NAME]: table(
    'mktAdsCampaignSummary',
    'LARK_TABLE_MKT_ADS_CAMPAIGN_SUMMARY',
    '📊 Overview',
  ),
});

const RETIRED_RAW_TABLES = new Set([
  'RAW_Meta_Organic_Accounts', 'RAW_Meta_Organic_Content', 'RAW_Meta_Organic_Metrics',
  'RAW_Ads_Entities', 'RAW_Ads_Daily',
]);

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
      createName: logicalName === MKT_ADS_CAMPAIGN_SUMMARY_LOGICAL_NAME
        ? MKT_ADS_CAMPAIGN_SUMMARY_DISPLAY_NAME
        : logicalName,
      aliases: Object.freeze([
        logicalName,
        ...(logicalName === MKT_ADS_CAMPAIGN_SUMMARY_LOGICAL_NAME
          ? [MKT_ADS_CAMPAIGN_SUMMARY_DISPLAY_NAME]
          : []),
        ...(currentSourceTable ? [currentSourceTable] : []),
      ]),
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
  const views = rows.filter((row) => TABLE_CONTRACTS[row.Table?.trim()]).map((row) => {
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
  const validateSchema = input?.validateSchema ?? validateSharedTableLarkSchema;
  validateSchema(schema);
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
    const trimmed = expression.trim();
    const equality = /^([A-Za-z][A-Za-z0-9_]*)=([A-Za-z0-9_]+)$/u.exec(trimmed);
    const notEmpty = /^([A-Za-z][A-Za-z0-9_]*)\s+IS\s+NOT\s+EMPTY$/iu.exec(trimmed);
    if (!equality && !notEmpty) throw invalid(`Unsupported Shared-table View filter: ${text}`);
    const fieldName = (equality ?? notEmpty)[1];
    if (!fieldsByName.has(fieldName)) {
      throw invalid(`Shared-table View filter references unknown field ${tableContract.logicalName}.${fieldName}`);
    }
    if (notEmpty) return Object.freeze({ fieldName, operator: 'isNotEmpty', value: null });
    return Object.freeze({ fieldName, operator: 'is', value: equality[2] });
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
  if (reuseCount !== 0 || createCount !== 3) {
    throw invalid(`Customer shared-table schema must create three tables; got reuse=${reuseCount}, create=${createCount}`);
  }
  return true;
}

/**
 * จำกัด Apply/Preview ของ Paid maintenance ให้แตะเฉพาะ Campaign Summary ตารางเดียว
 * แม้ CSV SSOT จะประกาศ Shared tables อื่นไว้ด้วยก็ตาม.
 */
export function selectMktAdsCampaignSummaryLarkContract(input = {}) {
  validateSharedTableLarkSchema(input.schema);
  const schema = input.schema.filter(
    (tableContract) => tableContract.logicalName === MKT_ADS_CAMPAIGN_SUMMARY_LOGICAL_NAME,
  );
  const views = (Array.isArray(input.views) ? input.views : []).filter(
    (view) => view.table === MKT_ADS_CAMPAIGN_SUMMARY_LOGICAL_NAME,
  );
  validateMktAdsCampaignSummaryLarkSchema(schema);
  if (views.length !== MKT_ADS_CAMPAIGN_SUMMARY_VIEW_CONTRACT.length) {
    throw invalid('Ads Campaign Summary contract must contain exactly four Views');
  }
  for (let index = 0; index < MKT_ADS_CAMPAIGN_SUMMARY_VIEW_CONTRACT.length; index += 1) {
    const view = views[index];
    const [viewName, filter] = MKT_ADS_CAMPAIGN_SUMMARY_VIEW_CONTRACT[index];
    if (view?.viewName !== viewName || view?.filter !== filter) {
      throw invalid(`Ads Campaign Summary View contract is invalid at index ${index}`);
    }
  }
  return deepFreeze({ schema, views });
}

export function validateMktAdsCampaignSummaryLarkSchema(schema) {
  if (!Array.isArray(schema) || schema.length !== 1) {
    throw invalid('Ads Campaign Summary schema must contain exactly one table');
  }
  const [tableContract] = schema;
  if (tableContract.logicalName !== MKT_ADS_CAMPAIGN_SUMMARY_LOGICAL_NAME
    || tableContract.key !== 'mktAdsCampaignSummary'
    || tableContract.envName !== 'LARK_TABLE_MKT_ADS_CAMPAIGN_SUMMARY'
    || tableContract.createName !== MKT_ADS_CAMPAIGN_SUMMARY_DISPLAY_NAME
    || !tableContract.aliases?.includes(MKT_ADS_CAMPAIGN_SUMMARY_LOGICAL_NAME)
    || !tableContract.aliases?.includes(MKT_ADS_CAMPAIGN_SUMMARY_DISPLAY_NAME)
    || tableContract.sharedTable?.physicalAction !== 'create_new') {
    throw invalid('Ads Campaign Summary table identity is invalid');
  }
  if (tableContract.defaultViewName !== '📊 Overview'
    || tableContract.sharedTable?.currentSourceTable !== null
    || tableContract.sharedTable?.preserveTableId !== false
    || tableContract.fields.length !== MKT_ADS_CAMPAIGN_SUMMARY_EXPECTED_FIELD_COUNT) {
    throw invalid('Ads Campaign Summary field/primary-key contract is invalid');
  }
  for (let index = 0; index < MKT_ADS_CAMPAIGN_SUMMARY_FIELD_CONTRACT.length; index += 1) {
    const field = tableContract.fields[index];
    const [fieldName, type, primary, required, nullable, optionNames] =
      MKT_ADS_CAMPAIGN_SUMMARY_FIELD_CONTRACT[index];
    const actualOptions = Array.isArray(field?.property?.options)
      ? field.property.options.map((option) => option?.name)
      : [];
    const expectedUiType = type === 1 ? 'Text' : type === 2 ? 'Number' : type === 3 ? 'SingleSelect' : 'DateTime';
    const expectedDateFormatter = fieldName === 'last_synced_at'
      ? 'yyyy/MM/dd HH:mm'
      : (type === 5 ? 'yyyy/MM/dd' : null);
    if (field?.fieldName !== fieldName
      || field?.type !== type
      || field?.uiType !== expectedUiType
      || field?.primary !== primary
      || field?.required !== required
      || field?.nullable !== nullable
      || (expectedDateFormatter !== null
        && (field?.property?.date_formatter !== expectedDateFormatter
          || field?.property?.auto_fill !== false))
      || actualOptions.length !== optionNames.length
      || actualOptions.some((name, optionIndex) => name !== optionNames[optionIndex])
      || field?.manageDescription !== true
      || !/[ก-๙]/u.test(field?.description ?? '')) {
      throw invalid(`Ads Campaign Summary field contract is invalid: ${fieldName}`);
    }
  }
  const fieldNames = new Set(tableContract.fields.map((field) => field.fieldName));
  if (MKT_ADS_CAMPAIGN_SUMMARY_GROUP_FIELD !== 'period_month_th'
    || MKT_ADS_CAMPAIGN_SUMMARY_VIEW_SORT.length !== 0
    || MKT_ADS_CAMPAIGN_SUMMARY_VIEW_SORT.some((entry) => !fieldNames.has(entry?.field))
    || MKT_ADS_CAMPAIGN_SUMMARY_VISIBLE_FIELDS.length !== fieldNames.size
    || MKT_ADS_CAMPAIGN_SUMMARY_VISIBLE_FIELDS.some((fieldName) => !fieldNames.has(fieldName))) {
    throw invalid('Ads Campaign Summary presentation field contract is invalid');
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
  const thai = row.Table?.trim() === MKT_ADS_CAMPAIGN_SUMMARY_LOGICAL_NAME;
  return [
    row.Definition,
    row['Source path / metric']
      ? `${thai ? 'แหล่งข้อมูล' : 'Source'}: ${row['Source path / metric']}`
      : null,
    row['Time / zero / null semantics']
      ? `${thai ? 'ความหมาย' : 'Semantics'}: ${row['Time / zero / null semantics']}`
      : null,
    row['Import note'] ? `${thai ? 'หมายเหตุ' : 'Import'}: ${row['Import note']}` : null,
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
    if (!TABLE_CONTRACTS[tableName] && !RETIRED_RAW_TABLES.has(tableName)) {
      throw invalid(`Unexpected table in shared-table field contract: ${tableName}`);
    }
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
