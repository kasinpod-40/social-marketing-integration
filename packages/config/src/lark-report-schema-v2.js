import {
  LARK_REPORT_SCHEMA,
  validateReportSchemaDefinition,
} from './lark-report-schema.js';
import {
  LARK_REPORT_MATERIALIZATION_SCHEMA,
  LARK_REPORT_MATERIALIZATION_SCHEMA_VERSION,
} from './lark-report-materialization-schema.js';

const PLATFORM_OPTIONS = LARK_REPORT_MATERIALIZATION_SCHEMA.sharedOptionExtensions.platforms;
const ORGANIC_OPTIONS = PLATFORM_OPTIONS.filter(
  (value) => !value.endsWith('_ads') && value !== 'woocommerce',
);
const DATA_STATUS_OPTIONS = LARK_REPORT_MATERIALIZATION_SCHEMA.sharedOptionExtensions.dataStatuses;
const EXTENDED_TABLE_KEYS = new Set([
  'mktReportSettings',
  'mktReportSnapshots',
  'mktReportMetricValues',
  'mktReportTopContent',
]);

/** Executable additive schema used by setup:report-schema preview/apply. */
export const LARK_REPORT_SCHEMA_V2_VERSION = LARK_REPORT_MATERIALIZATION_SCHEMA_VERSION;
export const LARK_REPORT_SCHEMA_V2 = deepFreeze([
  ...LARK_REPORT_SCHEMA.map((table) => extendExistingTable(table)),
  ...(!LARK_REPORT_SCHEMA.some((table) => table.key === 'mktReportTopAds')
    ? [buildTopAdsTable()]
    : []),
]);

export function validateReportSchemaV2(schema = LARK_REPORT_SCHEMA_V2) {
  return validateReportSchemaDefinition(schema);
}

function extendExistingTable(table) {
  if (!EXTENDED_TABLE_KEYS.has(table.key)) return clone(table);

  const fields = table.fields.map((field) => {
    if (table.key === 'mktReportSettings' && field.fieldName === 'platforms') {
      return withSelectOptions(field, PLATFORM_OPTIONS);
    }
    if (field.fieldName === 'platform') {
      return withSelectOptions(
        field,
        table.key === 'mktReportTopContent' ? ORGANIC_OPTIONS : PLATFORM_OPTIONS,
      );
    }
    if (field.fieldName === 'data_status') return withSelectOptions(field, DATA_STATUS_OPTIONS);
    return clone(field);
  });
  const materializationContract = LARK_REPORT_MATERIALIZATION_SCHEMA.tables[table.key];
  for (const additiveField of materializationContract?.additiveFields ?? []) {
    if (!fields.some((field) => field.fieldName === additiveField.fieldName)) {
      fields.push(toExecutableField(additiveField));
    }
  }

  if (table.key === 'mktReportSettings'
    && !fields.some((field) => field.fieldName === 'top_ads_limit')) {
    fields.push({
      fieldName: 'top_ads_limit',
      type: 2,
      uiType: 'Number',
      primary: false,
      description: 'จำนวนอันดับ Top Ads',
      property: { formatter: '1,000' },
    });
  }

  return {
    ...clone(table),
    fields,
  };
}

function buildTopAdsTable() {
  const source = LARK_REPORT_MATERIALIZATION_SCHEMA.tables.mktReportTopAds;
  return {
    key: 'mktReportTopAds',
    createName: source.createName,
    aliases: ['MKT_Report_Top_Ads', source.createName],
    envName: source.envName,
    defaultViewName: source.defaultViewName,
    logicalName: source.logicalName,
    fields: source.fields.map((field) => {
      return toExecutableField(field, topAdsDescription(field.fieldName));
    }),
  };
}

function toExecutableField(field, description = sharedDimensionDescription(field.fieldName)) {
  const base = {
    fieldName: field.fieldName,
    type: field.type,
    uiType: field.uiType,
    primary: field.primary === true,
    description,
    ...(field.property ? { property: clone(field.property) } : {}),
  };
  return Array.isArray(field.options) ? withSelectOptions(base, field.options) : base;
}

function withSelectOptions(field, names) {
  return {
    ...clone(field),
    property: {
      options: names.map((name, index) => ({ name, color: index % 10 })),
    },
  };
}

function sharedDimensionDescription(fieldName) {
  return ({
    customer_key: 'Customer business identity',
    capability: 'Extensible lowercase capability key',
    period_kind: 'rolling_days หรือ custom_range',
    window_days: 'จำนวนวันแบบ Inclusive; Custom range เว้นว่าง',
    coverage_rate: 'Coverage รวมของ Report materialization',
  })[fieldName] ?? fieldName;
}

function topAdsDescription(fieldName) {
  return ({
    report_ad_key: 'Fixed rank key',
    report_id: 'อ้าง Report Snapshot',
    report_setting_key: 'อ้าง Report Setting',
    customer_key: 'Customer business identity',
    customer_profile: 'Canonical customer profile',
    capability: 'Extensible lowercase capability key',
    report_type: 'ชนิดรายงาน',
    platform: 'Paid Ads platform',
    account_id: 'Canonical account key',
    period_kind: 'rolling_days หรือ custom_range',
    window_days: 'จำนวนวันแบบ Inclusive; Custom range เว้นว่าง',
    rank: 'อันดับคงที่',
    external_ad_id: 'Provider Ad ID',
    external_campaign_id: 'Provider Campaign ID',
    external_ad_group_id: 'Provider Ad Group ID',
    external_creative_id: 'Provider Creative ID',
    ad_name: 'ชื่อโฆษณา',
    currency: 'สกุลเงินของบัญชี',
    spend_micros: 'Spend micros รวมช่วง',
    impressions: 'Impressions รวมช่วง',
    reach: 'Reach รวมช่วง',
    clicks: 'Clicks รวมช่วง',
    conversions: 'Conversions รวมช่วง',
    conversion_value_micros: 'Conversion value micros รวมช่วง',
    ctr: 'Clicks / impressions หลัง SUM',
    cpc_micros: 'Spend / clicks หลัง SUM',
    cpm_micros: 'Spend x 1000 / impressions หลัง SUM',
    cpa_micros: 'Spend / conversions หลัง SUM',
    roas: 'Conversion value / spend หลัง SUM',
    data_status: 'Coverage/data status',
    coverage_rate: 'Coverage รวมของ Report materialization',
    period_start: 'เริ่มช่วงรายงาน',
    period_end: 'จบช่วงรายงาน',
    generated_at: 'เวลาสร้าง materialization',
  })[fieldName] ?? fieldName;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, clone(nested)]));
  }
  return value;
}
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

validateReportSchemaV2();
