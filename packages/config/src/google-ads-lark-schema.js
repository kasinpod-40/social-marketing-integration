import { LARK_TABLE_ENV } from './lark-table-config.js';
import { permanentError } from '../../shared/src/errors/runtime-error.js';
import { GOOGLE_ADS_RAW_SCHEMA_DATA_1 } from './google-ads-raw-schema-data-1.js';
import { GOOGLE_ADS_RAW_SCHEMA_DATA_2 } from './google-ads-raw-schema-data-2.js';
import { GOOGLE_ADS_RAW_SCHEMA_DATA_3 } from './google-ads-raw-schema-data-3.js';
import { GOOGLE_ADS_RAW_SCHEMA_DATA_4 } from './google-ads-raw-schema-data-4.js';
import { GOOGLE_ADS_RAW_SCHEMA_DATA_5 } from './google-ads-raw-schema-data-5.js';
import { GOOGLE_ADS_CANONICAL_EXTENSION_DATA } from './google-ads-canonical-extension-data.js';
import {
  GOOGLE_ADS_RELATION_VIEW_DATA,
  GOOGLE_ADS_SELECT_OPTION_DATA,
} from './google-ads-select-view-data.js';

export const GOOGLE_ADS_LARK_SCHEMA_VERSION = 'google-ads-lark-schema-v0.13.0-rc1';
export const GOOGLE_ADS_EXPECTED_RAW_TABLE_COUNT = 13;
export const GOOGLE_ADS_EXPECTED_RAW_FIELD_COUNT = 208;
export const GOOGLE_ADS_EXPECTED_NEW_CANONICAL_TABLE_COUNT = 1;
export const GOOGLE_ADS_EXPECTED_CANONICAL_DEFINITION_COUNT = 44;
export const GOOGLE_ADS_EXPECTED_LINK_FIELD_COUNT = 7;
export const GOOGLE_ADS_EXPECTED_PHYSICAL_VIEW_COUNT = 19;

const RAW_DATA = Object.freeze([
  ...GOOGLE_ADS_RAW_SCHEMA_DATA_1,
  ...GOOGLE_ADS_RAW_SCHEMA_DATA_2,
  ...GOOGLE_ADS_RAW_SCHEMA_DATA_3,
  ...GOOGLE_ADS_RAW_SCHEMA_DATA_4,
  ...GOOGLE_ADS_RAW_SCHEMA_DATA_5,
]);

const EXISTING_CANONICAL = Object.freeze({
  MKT_Ads_Accounts: Object.freeze({ key: 'mktAdsAccounts', envName: 'LARK_TABLE_MKT_ADS_ACCOUNTS' }),
  MKT_Ads_Campaigns: Object.freeze({ key: 'mktAdsCampaigns', envName: 'LARK_TABLE_MKT_ADS_CAMPAIGNS' }),
  MKT_Ads_AdGroups: Object.freeze({ key: 'mktAdsAdGroups', envName: 'LARK_TABLE_MKT_ADS_ADGROUPS' }),
  MKT_Ads_Ads: Object.freeze({ key: 'mktAdsAds', envName: 'LARK_TABLE_MKT_ADS_ADS' }),
  MKT_Ads_Creatives: Object.freeze({ key: 'mktAdsCreatives', envName: 'LARK_TABLE_MKT_ADS_CREATIVES' }),
  MKT_Ads_Daily: Object.freeze({ key: 'mktAdsDaily', envName: 'LARK_TABLE_MKT_ADS_DAILY' }),
});

const FIELD_TYPES = Object.freeze({
  Text: Object.freeze({ type: 1, uiType: 'Text' }),
  Number: Object.freeze({ type: 2, uiType: 'Number' }),
  SingleSelect: Object.freeze({ type: 3, uiType: 'SingleSelect' }),
  DateTime: Object.freeze({ type: 5, uiType: 'DateTime' }),
  Checkbox: Object.freeze({ type: 7, uiType: 'Checkbox' }),
  URL: Object.freeze({ type: 15, uiType: 'Url' }),
  Link: Object.freeze({ type: 18, uiType: 'SingleLink' }),
});

const IDENTIFIER_NAME = /(^|_)(id|ids)$/iu;

export const GOOGLE_ADS_RAW_TABLE_KEYS = Object.freeze(RAW_DATA.map((table) => table.key));
export const GOOGLE_ADS_EXISTING_CANONICAL_KEYS = Object.freeze(
  Object.values(EXISTING_CANONICAL).map((table) => table.key),
);
export const GOOGLE_ADS_SELECT_OPTION_RULES = deepFreeze(GOOGLE_ADS_SELECT_OPTION_DATA);
export const GOOGLE_ADS_WORKBOOK_RELATION_VIEW_ROWS = deepFreeze(GOOGLE_ADS_RELATION_VIEW_DATA);
export const GOOGLE_ADS_RELATIONS = deepFreeze(buildRelations());
export const GOOGLE_ADS_VIEW_CONTRACT = deepFreeze(buildViews());
export const GOOGLE_ADS_NON_BLOCKING_MANUAL_ACTIONS = deepFreeze([
  {
    code: 'GOOGLE_ADS_30D_VIEW_DATE_FILTER_REVIEW_REQUIRED',
    tableKey: 'mktAdsDaily',
    viewName: 'Google Ads Daily 30D',
    message: 'Lark OpenAPI contract ที่ยืนยันแล้วไม่มี Relative-date filter แบบเลื่อนได้ทุกวัน; Installer สร้าง platform filter และให้ตรวจ Last 30 days ใน Lark UI',
  },
]);
export const GOOGLE_ADS_LARK_SCHEMA = deepFreeze(buildSchema());

export function validateGoogleAdsLarkSchema(schema = GOOGLE_ADS_LARK_SCHEMA) {
  if (!Array.isArray(schema)) invalid('Google Ads schema must be an array');
  const raw = schema.filter((table) => table.googleAds?.role === 'raw');
  const newCanonical = schema.filter((table) => table.googleAds?.role === 'new_canonical');
  const existingCanonical = schema.filter((table) => table.googleAds?.role === 'existing_canonical_extension');
  if (raw.length !== GOOGLE_ADS_EXPECTED_RAW_TABLE_COUNT) {
    invalid(`Google Ads schema must contain exactly ${GOOGLE_ADS_EXPECTED_RAW_TABLE_COUNT} RAW tables`);
  }
  const rawFieldCount = raw.flatMap((table) => table.fields).length;
  if (rawFieldCount !== GOOGLE_ADS_EXPECTED_RAW_FIELD_COUNT) {
    invalid(`Google Ads RAW schema must contain exactly ${GOOGLE_ADS_EXPECTED_RAW_FIELD_COUNT} fields`);
  }
  if (newCanonical.length !== GOOGLE_ADS_EXPECTED_NEW_CANONICAL_TABLE_COUNT) {
    invalid('Google Ads schema must create only MKT_Ads_AssetGroups as a new Canonical table');
  }
  if (existingCanonical.length !== Object.keys(EXISTING_CANONICAL).length) {
    invalid('Google Ads schema must reuse exactly six existing Canonical Ads tables');
  }
  const keys = new Set();
  const names = new Set();
  for (const table of schema) {
    requireText(table.key, 'table.key');
    requireText(table.logicalName, `${table.key}.logicalName`);
    if (keys.has(table.key)) invalid(`Duplicate Google Ads logical table key: ${table.key}`);
    if (names.has(table.logicalName)) invalid(`Duplicate Google Ads table name: ${table.logicalName}`);
    keys.add(table.key);
    names.add(table.logicalName);
    if (LARK_TABLE_ENV[table.key] !== table.envName) {
      invalid(`Lark environment mapping mismatch for ${table.logicalName}`);
    }
    const fieldNames = new Set();
    for (const field of table.fields) {
      if (fieldNames.has(field.fieldName)) invalid(`Duplicate field ${table.logicalName}.${field.fieldName}`);
      fieldNames.add(field.fieldName);
    }
  }
  for (const table of raw) {
    const primaries = table.fields.filter((field) => field.primary === true);
    if (primaries.length !== 1 || table.fields[0].primary !== true || table.fields[0].type !== 1) {
      invalid(`RAW table ${table.logicalName} must have one Primary Text field first`);
    }
    for (const field of table.fields) {
      if (IDENTIFIER_NAME.test(field.fieldName) && field.type !== 1) {
        invalid(`Google Ads identifier must be Text: ${table.logicalName}.${field.fieldName}`);
      }
    }
  }
  if (GOOGLE_ADS_CANONICAL_EXTENSION_DATA.length !== GOOGLE_ADS_EXPECTED_CANONICAL_DEFINITION_COUNT) {
    invalid(`Google Ads canonical contract must contain ${GOOGLE_ADS_EXPECTED_CANONICAL_DEFINITION_COUNT} definitions`);
  }
  if (GOOGLE_ADS_RELATIONS.length !== GOOGLE_ADS_EXPECTED_LINK_FIELD_COUNT) {
    invalid(`Google Ads relation contract must contain ${GOOGLE_ADS_EXPECTED_LINK_FIELD_COUNT} Link fields`);
  }
  if (GOOGLE_ADS_WORKBOOK_RELATION_VIEW_ROWS.length !== 13) {
    invalid('Google Ads workbook relation/view contract must contain 13 rows');
  }
  if (GOOGLE_ADS_VIEW_CONTRACT.flatMap((table) => table.views).length !== GOOGLE_ADS_EXPECTED_PHYSICAL_VIEW_COUNT) {
    invalid(`Google Ads view contract must contain ${GOOGLE_ADS_EXPECTED_PHYSICAL_VIEW_COUNT} physical Views`);
  }
  return true;
}

export function validateGoogleAdsRelationTargets(schema = GOOGLE_ADS_LARK_SCHEMA) {
  const schemaByKey = new Map(schema.map((table) => [table.key, table]));
  for (const relation of GOOGLE_ADS_RELATIONS) {
    if (!schemaByKey.has(relation.sourceTableKey) || !schemaByKey.has(relation.targetTableKey)) {
      invalid(`Unknown Google Ads relation target: ${relation.sourceTableKey}.${relation.field.fieldName}`);
    }
  }
  return true;
}

function buildSchema() {
  const raw = RAW_DATA.map((table) => ({
    key: table.key,
    logicalName: table.logicalName,
    createName: table.logicalName,
    aliases: [table.logicalName],
    defaultViewName: table.defaultViewName,
    envName: requireEnvName(table.key, table.logicalName),
    fields: table.fields.map((row, index) => toField({
      tableName: table.logicalName,
      row,
      primary: index === 0 && row[0] === table.primaryField,
      selectOptions: selectOptionsFor(table.logicalName, row[0]),
    })),
    googleAds: { role: 'raw', physicalAction: 'create_new', purpose: table.purpose },
  }));
  const extensionByTable = groupBy(
    GOOGLE_ADS_CANONICAL_EXTENSION_DATA.filter((row) => row.type !== 'Link'),
    (row) => row.table,
  );
  const assetGroupRows = extensionByTable.get('MKT_Ads_AssetGroups') ?? [];
  const assetGroups = {
    key: 'mktAdsAssetGroups',
    logicalName: 'MKT_Ads_AssetGroups',
    createName: 'MKT_Ads_AssetGroups',
    aliases: ['MKT_Ads_AssetGroups'],
    defaultViewName: '📋 All Asset Groups',
    envName: requireEnvName('mktAdsAssetGroups', 'MKT_Ads_AssetGroups'),
    fields: assetGroupRows.sort((left, right) => left.order - right.order)
      .map((row, index) => toCanonicalField(row, index === 0)),
    googleAds: {
      role: 'new_canonical',
      physicalAction: 'create_new',
      purpose: 'Shared Canonical Asset Group master for Performance Max',
    },
  };
  const extensions = Object.entries(EXISTING_CANONICAL).map(([logicalName, contract]) => ({
    key: contract.key,
    logicalName,
    createName: logicalName,
    aliases: [logicalName],
    defaultViewName: 'Grid',
    envName: requireEnvName(contract.key, logicalName),
    fields: (extensionByTable.get(logicalName) ?? [])
      .sort((left, right) => left.order - right.order)
      .map((row) => toCanonicalField(row, false)),
    googleAds: {
      role: 'existing_canonical_extension',
      physicalAction: 'extend_existing',
      createForbidden: true,
    },
  }));
  return [...raw, assetGroups, ...extensions];
}

function buildRelations() {
  return GOOGLE_ADS_CANONICAL_EXTENSION_DATA.filter((row) => row.type === 'Link').map((row) => {
    const source = row.table === 'MKT_Ads_AssetGroups'
      ? { key: 'mktAdsAssetGroups', envName: 'LARK_TABLE_MKT_ADS_ASSET_GROUPS' }
      : EXISTING_CANONICAL[row.table];
    const targetName = requireText(row.relation, `${row.table}.${row.field}.relation`)
      .replace(/^Multiple Link\s*→\s*/u, '')
      .replace(/^Link\s*→\s*/u, '')
      .trim();
    const target = targetName === 'MKT_Ads_AssetGroups'
      ? { key: 'mktAdsAssetGroups', envName: 'LARK_TABLE_MKT_ADS_ASSET_GROUPS' }
      : EXISTING_CANONICAL[targetName];
    if (!source || !target) invalid(`Unknown relation metadata ${row.table}.${row.field}`);
    return {
      sourceTableKey: source.key,
      sourceEnvName: source.envName,
      sourceTableName: row.table,
      targetTableKey: target.key,
      targetEnvName: target.envName,
      targetTableName: targetName,
      field: toField({
        tableName: row.table,
        row: [row.field, 'Link', row.required, row.nullable, null, row.source, row.semantics, row.formatter],
        primary: false,
        relation: { multiple: /^Multiple Link/u.test(row.relation) },
      }),
    };
  });
}

function buildViews() {
  const rawErrorTables = RAW_DATA.map((table, index) => ({
    tableKey: table.key,
    envName: requireEnvName(table.key, table.logicalName),
    views: [{
      key: `googleRawErrors${String(index + 1).padStart(2, '0')}`,
      name: 'Google Ads RAW Errors',
      type: 'grid',
      hiddenFields: [],
      filterInfo: {
        conjunction: 'and',
        conditions: [{ fieldName: table.primaryField, operator: 'isEmpty' }],
      },
    }],
  }));
  const explicit = [
    viewTable('mktAdsAccounts', 'LARK_TABLE_MKT_ADS_ACCOUNTS', 'googleAdsAccounts', 'Google Ads Accounts', [
      condition('platform', 'is', 'google_ads'),
    ]),
    viewTable('mktAdsCampaigns', 'LARK_TABLE_MKT_ADS_CAMPAIGNS', 'youtubeAdsCampaigns', 'YouTube Ads Campaigns', [
      condition('platform', 'is', 'google_ads'),
      condition('ad_channel', 'is', 'youtube_ads'),
    ]),
    viewTable('mktAdsDaily', 'LARK_TABLE_MKT_ADS_DAILY', 'googleAdsDaily30D', 'Google Ads Daily 30D', [
      condition('platform', 'is', 'google_ads'),
    ]),
    viewTable('mktAdsCreatives', 'LARK_TABLE_MKT_ADS_CREATIVES', 'youtubeVideoAssets', 'YouTube Video Assets', [
      condition('platform', 'is', 'google_ads'),
      condition('creative_type', 'is', 'video'),
    ]),
    viewTable('mktAdsAssetGroups', 'LARK_TABLE_MKT_ADS_ASSET_GROUPS', 'performanceMaxAssetGroups', 'Performance Max Asset Groups', [
      condition('platform', 'is', 'google_ads'),
    ]),
    {
      tableKey: 'rawGoogleAdsConversionActions',
      envName: requireEnvName('rawGoogleAdsConversionActions', 'RAW_Google_Ads_Conversion_Actions'),
      views: [{
        key: 'conversionActionsUat',
        name: 'Conversion Actions UAT',
        type: 'grid',
        hiddenFields: [],
        filterInfo: {
          conjunction: 'or',
          conditions: [condition('status', 'is', 'ENABLED'), condition('status', 'is', 'UNKNOWN')],
        },
      }],
    },
  ];
  return [...rawErrorTables, ...explicit];
}

function viewTable(tableKey, envName, key, name, conditions) {
  return {
    tableKey,
    envName,
    views: [{ key, name, type: 'grid', hiddenFields: [], filterInfo: { conjunction: 'and', conditions } }],
  };
}

function condition(fieldName, operator, value = undefined) {
  return value === undefined ? { fieldName, operator } : { fieldName, operator, value };
}

function toCanonicalField(row, primary) {
  return toField({
    tableName: row.table,
    row: [
      row.field, row.type, row.required, row.nullable,
      primary ? 'Primary + Stable key' : null,
      row.source, row.semantics, row.formatter,
    ],
    primary,
    selectOptions: selectOptionsFor(row.table, row.field),
    formulaHint: row.formulaHint,
  });
}

function toField(input) {
  const [fieldName, typeName, required, nullable, keyRole, source, semantics, formatter] = input.row;
  const mapped = FIELD_TYPES[typeName];
  if (!mapped) invalid(`Unsupported Google Ads Lark field type: ${typeName}`);
  const property = buildProperty({
    typeName,
    formatter,
    options: input.selectOptions,
    relation: input.relation,
  });
  return {
    fieldName: requireText(fieldName, `${input.tableName}.fieldName`),
    type: mapped.type,
    uiType: mapped.uiType,
    primary: input.primary === true,
    ...(property ? { property } : {}),
    required: required === true,
    nullable: nullable === true,
    keyRole: keyRole || null,
    sourcePath: source || null,
    formulaHint: input.formulaHint || null,
    description: buildDescription({ source, semantics, formulaHint: input.formulaHint }),
    manageDescription: true,
  };
}

function buildProperty(input) {
  if (input.typeName === 'SingleSelect') {
    const names = [...new Set(input.options ?? [])];
    if (names.length === 0) invalid('SingleSelect fields require approved options');
    return { options: names.map((name, index) => ({ name, color: index % 8 })) };
  }
  if (input.typeName === 'DateTime') {
    const hasTime = /h/i.test(input.formatter ?? '');
    return { date_formatter: hasTime ? 'yyyy/MM/dd HH:mm' : 'yyyy/MM/dd', auto_fill: false };
  }
  if (input.typeName === 'Number' && input.formatter) {
    return { formatter: normalizeNumberFormatter(input.formatter) };
  }
  if (input.typeName === 'Link') {
    return { multiple: input.relation?.multiple === true };
  }
  return null;
}

function selectOptionsFor(tableName, fieldName) {
  const options = [];
  for (const row of GOOGLE_ADS_SELECT_OPTION_DATA) {
    const applies = (
      (row.scope === 'RAW/MKT' && fieldName === row.field)
      || (row.scope === tableName && fieldName === row.field)
      || (row.scope === 'MKT_Ads_*' && tableName.startsWith('MKT_Ads_') && fieldName === row.field)
      || (row.scope === 'Canonical status' && tableName.startsWith('MKT_Ads_') && fieldName === 'status')
    );
    if (applies) options.push(row.option);
  }
  if (tableName === 'RAW_Google_Ads_Daily' && fieldName === 'ad_channel') {
    options.push(...GOOGLE_ADS_SELECT_OPTION_DATA
      .filter((row) => row.scope === 'MKT_Ads_*' && row.field === 'ad_channel')
      .map((row) => row.option));
  }
  if (tableName === 'RAW_Google_Ads_Conversion_Daily' && fieldName === 'report_level') {
    options.push('campaign', 'ad_group', 'ad');
  }
  if (tableName === 'MKT_Ads_Accounts' && fieldName === 'account_link_status') {
    options.push('selectable', 'not_selectable', 'unknown');
  }
  return [...new Set(options)];
}

function buildDescription(input) {
  return [
    input.semantics,
    input.source ? `Source: ${input.source}` : null,
    input.formulaHint ? `Formula hint (not installed): ${input.formulaHint}` : null,
  ].filter(Boolean).join(' | ').slice(0, 900);
}

function normalizeNumberFormatter(value) {
  const text = String(value).trim();
  if (text === '0') return '0';
  if (text === '0.00') return '0.00';
  if (text === '0.0000') return '0.0000';
  if (text === '0.00%') return '0.00%';
  return text;
}

function requireEnvName(key, logicalName) {
  const envName = LARK_TABLE_ENV[key];
  if (!envName) invalid(`Missing Lark environment mapping for ${logicalName}: ${key}`);
  return envName;
}

function groupBy(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

function invalid(message) {
  throw permanentError(message, { code: 'GOOGLE_ADS_LARK_SCHEMA_INVALID' });
}

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') invalid(`${name} is required`);
  return value.trim();
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

validateGoogleAdsLarkSchema();
validateGoogleAdsRelationTargets();
