const PLATFORM_OPTIONS = Object.freeze([
  'facebook', 'instagram', 'tiktok', 'youtube', 'meta_ads', 'google_ads', 'tiktok_ads',
]);
const DATA_STATUS_OPTIONS = Object.freeze([
  'complete', 'partial', 'no_data', 'no_data_confirmed',
  'source_unavailable', 'not_observed', 'revisable',
]);
const PERIOD_KIND_OPTIONS = Object.freeze(['rolling_days', 'custom_range']);

/**
 * Additive repository contract for the materialization consumer tables.
 * It is intentionally plan-only; applying it to a Live Base requires a separate authorization.
 */
export const LARK_REPORT_MATERIALIZATION_SCHEMA_VERSION = 'report-materialization-schema-v3';
export const LARK_REPORT_MATERIALIZATION_SCHEMA = deepFreeze({
  sharedOptionExtensions: {
    platforms: PLATFORM_OPTIONS,
    dataStatuses: DATA_STATUS_OPTIONS,
    periodKinds: PERIOD_KIND_OPTIONS,
    reportTypes: ['daily_organic_report', 'weekly_organic_report', 'dashboard_performance_report'],
  },
  tables: {
    mktReportSnapshots: {
      keyField: 'report_id',
      additiveFields: [
        text('customer_key'),
        text('capability'),
        number('coverage_rate', '0.0000'),
      ],
      platformField: { fieldName: 'platform', type: 4, uiType: 'MultiSelect', options: PLATFORM_OPTIONS },
      dataStatusField: { fieldName: 'data_status', type: 3, uiType: 'SingleSelect', options: DATA_STATUS_OPTIONS },
      sourceContract: 'report_materializations.payload_json',
    },
    mktReportMetricValues: {
      keyField: 'report_metric_key',
      additiveFields: sharedRowAdditiveFields(),
      platformField: { fieldName: 'platform', type: 3, uiType: 'SingleSelect', options: PLATFORM_OPTIONS },
      dataStatusField: { fieldName: 'data_status', type: 3, uiType: 'SingleSelect', options: DATA_STATUS_OPTIONS },
      sourceContract: 'validated materialization.metricPayload',
    },
    mktReportTopContent: {
      keyField: 'report_content_key',
      additiveFields: sharedRowAdditiveFields(),
      platformField: { fieldName: 'platform', type: 3, uiType: 'SingleSelect', options: PLATFORM_OPTIONS.slice(0, 4) },
      dataStatusField: { fieldName: 'data_status', type: 3, uiType: 'SingleSelect', options: DATA_STATUS_OPTIONS },
      sourceContract: 'validated materialization.topContent',
    },
    mktReportTopAds: {
      envName: 'LARK_TABLE_MKT_REPORT_TOP_ADS',
      logicalName: 'MKT_Report_Top_Ads',
      createName: '📣 MKT_Report_Top_Ads',
      defaultViewName: '📣 Top Ads',
      keyField: 'report_ad_key',
      sourceContract: 'validated materialization.topAds',
      fields: [
        text('report_ad_key', true), text('report_id'), text('report_setting_key'),
        text('customer_key'), text('customer_profile'), text('capability'),
        select('report_type', ['dashboard_performance_report']),
        select('platform', ['meta_ads', 'google_ads', 'tiktok_ads']), text('account_id'),
        select('period_kind', PERIOD_KIND_OPTIONS), number('window_days', '0'),
        number('rank'), text('external_ad_id'), text('external_campaign_id'),
        text('external_ad_group_id'), text('external_creative_id'), text('ad_name'),
        text('currency'), number('spend_micros'), number('impressions'), number('reach'),
        number('clicks'), number('conversions'), number('conversion_value_micros'),
        number('ctr'), number('cpc_micros'), number('cpm_micros'), number('cpa_micros'),
        number('roas'), select('data_status', DATA_STATUS_OPTIONS),
        number('coverage_rate', '0.0000'), dateTime('period_start'),
        dateTime('period_end'), dateTime('generated_at'),
      ],
    },
  },
});

export function getLarkReportMaterializationTable(tableKey) {
  const table = LARK_REPORT_MATERIALIZATION_SCHEMA.tables[tableKey];
  if (!table) throw new TypeError(`Unknown materialization table: ${tableKey}`);
  return table;
}

function text(fieldName, primary = false) { return { fieldName, type: 1, uiType: 'Text', primary }; }
function number(fieldName, formatter = null) {
  return {
    fieldName,
    type: 2,
    uiType: 'Number',
    primary: false,
    ...(formatter ? { property: { formatter } } : {}),
  };
}
function dateTime(fieldName) { return { fieldName, type: 5, uiType: 'DateTime', primary: false }; }
function select(fieldName, options) {
  return { fieldName, type: 3, uiType: 'SingleSelect', primary: false, options: [...options] };
}
function sharedRowAdditiveFields() {
  return [
    text('customer_key'),
    text('capability'),
    select('period_kind', PERIOD_KIND_OPTIONS),
    number('window_days', '0'),
    number('coverage_rate', '0.0000'),
  ];
}
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
