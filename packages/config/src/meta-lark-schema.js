import { LARK_TABLE_ENV } from './lark-table-config.js';
import { permanentError } from '../../shared/src/errors/runtime-error.js';
import { parseCsvRecords } from '../../shared/src/text/csv.js';

export const META_LARK_SCHEMA_VERSION = 'meta-lark-schema-v0.12.0';
export const META_LARK_SCHEMA_EXPECTED_TABLE_COUNT = 15;
export const META_LARK_SCHEMA_EXPECTED_FIELD_COUNT = 229;

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
  RAW_Facebook_Pages: table('rawFacebookPages', 'LARK_TABLE_RAW_FACEBOOK_PAGES'),
  RAW_Facebook_Posts: table('rawFacebookPosts', 'LARK_TABLE_RAW_FACEBOOK_POSTS'),
  RAW_Facebook_Post_Insights: table('rawFacebookPostInsights', 'LARK_TABLE_RAW_FACEBOOK_POST_INSIGHTS'),
  RAW_Facebook_Page_Insights: table('rawFacebookPageInsights', 'LARK_TABLE_RAW_FACEBOOK_PAGE_INSIGHTS'),
  RAW_Instagram_Accounts: table('rawInstagramAccounts', 'LARK_TABLE_RAW_INSTAGRAM_ACCOUNTS'),
  RAW_Instagram_Media: table('rawInstagramMedia', 'LARK_TABLE_RAW_INSTAGRAM_MEDIA'),
  RAW_Instagram_Media_Insights: table('rawInstagramMediaInsights', 'LARK_TABLE_RAW_INSTAGRAM_MEDIA_INSIGHTS'),
  RAW_Instagram_Account_Insights: table('rawInstagramAccountInsights', 'LARK_TABLE_RAW_INSTAGRAM_ACCOUNT_INSIGHTS'),
  RAW_Meta_Ad_Accounts: table('rawMetaAdAccounts', 'LARK_TABLE_RAW_META_AD_ACCOUNTS'),
  RAW_Meta_Campaigns: table('rawMetaCampaigns', 'LARK_TABLE_RAW_META_CAMPAIGNS'),
  RAW_Meta_Ad_Sets: table('rawMetaAdSets', 'LARK_TABLE_RAW_META_AD_SETS'),
  RAW_Meta_Ads: table('rawMetaAds', 'LARK_TABLE_RAW_META_ADS'),
  RAW_Meta_Creatives: table('rawMetaCreatives', 'LARK_TABLE_RAW_META_CREATIVES'),
  RAW_Meta_Ads_Insights: table('rawMetaAdsInsights', 'LARK_TABLE_RAW_META_ADS_INSIGHTS'),
  MKT_Account_Daily: table('mktAccountDaily', 'LARK_TABLE_MKT_ACCOUNT_DAILY'),
});

export const META_LARK_SCHEMA_TABLE_KEYS = Object.freeze(
  Object.values(TABLE_CONTRACTS).map((contract) => contract.key),
);

export function buildMetaLarkSchemaFromCsv(input) {
  const inventory = parseCsvRecords(requireText(input?.inventoryCsv, 'inventoryCsv'));
  const fieldSources = requireArray(input?.fieldCsvs, 'fieldCsvs');
  const fields = fieldSources.flatMap((source, index) => parseCsvRecords(requireText(source, `fieldCsvs[${index}]`)));
  const inventoryByTable = buildInventoryIndex(inventory);
  const fieldsByTable = groupFields(fields);
  rejectUnexpectedFieldTables(fieldsByTable);
  const schema = [];
  for (const [tableName, contract] of Object.entries(TABLE_CONTRACTS)) {
    const inventoryRow = inventoryByTable.get(tableName);
    if (!inventoryRow) throw invalid(`Approved inventory is missing ${tableName}`);
    const rows = fieldsByTable.get(tableName) ?? [];
    if (rows.length === 0) throw invalid(`Approved field contract is missing ${tableName}`);
    const envName = LARK_TABLE_ENV[contract.key];
    if (envName !== contract.envName) throw invalid(`Lark environment mapping mismatch for ${tableName}: expected ${contract.envName}`);
    const orderedRows = [...rows].sort((left, right) => readOrder(left) - readOrder(right));
    validateFieldRows(tableName, inventoryRow, orderedRows);
    schema.push(Object.freeze({
      key: contract.key,
      logicalName: tableName,
      createName: tableName,
      aliases: Object.freeze([tableName, `🧪 ${tableName}`]),
      defaultViewName: 'All Records',
      envName,
      fields: Object.freeze(orderedRows.map((field) => toInstallerField(tableName, field))),
      sourceContract: Object.freeze({
        layer: inventoryRow.Layer,
        connector: inventoryRow.Connector,
        grain: inventoryRow.Grain,
        writeMode: inventoryRow['Write mode'],
        stableKeyField: inventoryRow['Stable key field'],
        environments: parseEnvironments(inventoryRow.Environment, tableName),
      }),
    }));
  }
  validateMetaLarkSchema(schema);
  return deepFreeze(schema);
}

export function validateMetaLarkSchema(schema) {
  if (!Array.isArray(schema) || schema.length !== META_LARK_SCHEMA_EXPECTED_TABLE_COUNT) throw invalid(`Meta Lark schema must contain exactly ${META_LARK_SCHEMA_EXPECTED_TABLE_COUNT} tables`);
  const tableKeys = new Set();
  let fieldCount = 0;
  for (const tableContract of schema) {
    if (tableKeys.has(tableContract.key)) throw invalid(`Duplicate Meta table key: ${tableContract.key}`);
    tableKeys.add(tableContract.key);
    if (LARK_TABLE_ENV[tableContract.key] !== tableContract.envName) throw invalid(`Invalid environment mapping for Meta table ${tableContract.key}`);
    if (!Array.isArray(tableContract.fields) || tableContract.fields.length === 0) throw invalid(`Meta table ${tableContract.logicalName} has no fields`);
    const primaryFields = tableContract.fields.filter((field) => field.primary === true);
    if (primaryFields.length !== 1 || tableContract.fields[0].primary !== true) throw invalid(`Meta table ${tableContract.logicalName} must have one Primary field first`);
    if (tableContract.fields[0].type !== 1) throw invalid(`Meta table ${tableContract.logicalName} Primary field must be Text`);
    const names = new Set();
    for (const field of tableContract.fields) {
      if (names.has(field.fieldName)) throw invalid(`Duplicate Meta field ${tableContract.logicalName}.${field.fieldName}`);
      names.add(field.fieldName);
      fieldCount += 1;
    }
  }
  if (fieldCount !== META_LARK_SCHEMA_EXPECTED_FIELD_COUNT) throw invalid(`Meta Lark schema must contain exactly ${META_LARK_SCHEMA_EXPECTED_FIELD_COUNT} fields`);
  return true;
}

function toInstallerField(tableName, row) {
  const typeName = requireText(row['Lark Type'], `${tableName}.${row.Field}.Lark Type`);
  const mapped = FIELD_TYPE_MAP[typeName];
  if (!mapped) throw invalid(`Unsupported Meta Lark field type: ${typeName}`);
  const fieldName = requireText(row.Field, `${tableName}.Field`);
  const order = readOrder(row);
  const keyRole = row['Key role']?.trim() ?? '';
  const primary = order === 1 && /primary/iu.test(keyRole);
  const relationOrOptions = row['Relation / Options']?.trim() ?? '';
  const property = buildProperty(typeName, relationOrOptions);
  return Object.freeze({
    fieldName,
    type: mapped.type,
    uiType: mapped.uiType,
    primary,
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
    const names = relationOrOptions.split('|').map((value) => value.trim()).filter(Boolean);
    if (names.length === 0) throw invalid('SingleSelect fields require approved options');
    return Object.freeze({ options: Object.freeze(names.map((name, index) => Object.freeze({ name, color: index % 8 }))) });
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

function buildInventoryIndex(rows) {
  const result = new Map();
  for (const row of rows) {
    const tableName = requireText(row.Table, 'inventory.Table');
    if (!TABLE_CONTRACTS[tableName]) continue;
    if (result.has(tableName)) throw invalid(`Duplicate approved inventory row: ${tableName}`);
    result.set(tableName, row);
  }
  return result;
}

function rejectUnexpectedFieldTables(fieldsByTable) {
  for (const tableName of fieldsByTable.keys()) if (!TABLE_CONTRACTS[tableName]) throw invalid(`Unexpected table in Meta field contract: ${tableName}`);
}

function parseEnvironments(value, tableName) {
  const environments = requireText(value, `${tableName}.Environment`).split('/').map((item) => item.trim()).filter(Boolean);
  if (!environments.includes('DEV')) throw invalid(`Meta DEV schema table is not approved for DEV: ${tableName}`);
  return Object.freeze(environments);
}

function validateFieldRows(tableName, inventoryRow, rows) {
  const orders = new Set();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const order = readOrder(row);
    if (orders.has(order)) throw invalid(`Duplicate field order ${tableName}.${order}`);
    orders.add(order);
    if (order !== index + 1) throw invalid(`Field order must be contiguous for ${tableName}`);
    requireChoice(row.Required, `${tableName}.${row.Field}.Required`, ['Yes', 'No']);
    requireChoice(row.Nullable, `${tableName}.${row.Field}.Nullable`, ['Yes', 'No']);
    if (row.Required === 'Yes' && row.Nullable !== 'No') throw invalid(`Required field cannot be nullable: ${tableName}.${row.Field}`);
  }
  if (rows[0].Field !== inventoryRow['Stable key field']) throw invalid(`Stable key mismatch for ${tableName}: inventory=${inventoryRow['Stable key field']}, first=${rows[0].Field}`);
}

function groupFields(rows) {
  const result = new Map();
  for (const row of rows) {
    const tableName = requireText(row.Table, 'field.Table');
    const group = result.get(tableName) ?? [];
    group.push(row);
    result.set(tableName, group);
  }
  return result;
}

function readOrder(row) {
  const value = Number(row.Order);
  if (!Number.isInteger(value) || value <= 0) throw invalid(`Invalid field order: ${row.Order}`);
  return value;
}
function table(key, envName) { return Object.freeze({ key, envName }); }
function invalid(message) { return permanentError(message, { code: 'META_LARK_SCHEMA_INVALID' }); }
function requireText(value, name) { if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required`); return value.trim(); }
function requireChoice(value, name, choices) { const text = requireText(value, name); if (!choices.includes(text)) throw invalid(`${name} must be one of: ${choices.join(', ')}`); return text; }
function requireArray(value, name) { if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${name} must be a non-empty array`); return value; }
function deepFreeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; }
