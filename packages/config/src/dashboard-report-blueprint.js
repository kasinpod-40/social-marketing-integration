import {
  UNIVERSAL_MARKETING_DASHBOARD_CONTRACT,
  UNIVERSAL_MARKETING_DASHBOARD_VERSION,
} from './universal-marketing-dashboard-contract.js';

export const DASHBOARD_REPORT_BLUEPRINT = Object.freeze({
  schemaVersion: 'dashboard-report-blueprint-v3',
  customerProfile: 'integration_workspace',
  platformAuthority: 'report_platform_adapter_registry',
  platformDiscovery: 'validated_materializations',
  periodKinds: Object.freeze(['rolling_days', 'custom_range']),
  rollingPresetDays: Object.freeze([3, 7, 9, 15, 30, 90]),
  defaultPeriodEnd: 'last_completed_reporting_day',
  inclusiveRanges: true,
  defaultComparisonMode: 'previous_period',
  sourceOfTruth: 'd1_report_materializations',
  customRequestFlow: Object.freeze([
    'report_requests',
    'queue',
    'reliability_lock',
    'report_materializations',
  ]),
  consumerContracts: Object.freeze({
    dashboard: 'validated_report_materialization_only',
    lark: 'validated_report_materialization_only',
    ai: 'validated_report_materialization_only_no_calculation',
  }),
  universalRenderer: Object.freeze({
    version: UNIVERSAL_MARKETING_DASHBOARD_VERSION,
    contract: UNIVERSAL_MARKETING_DASHBOARD_CONTRACT,
    platformSpecificCodeAllowed: false,
    accountSpecificCodeAllowed: false,
    metricSpecificColumnsRequired: false,
  }),
  aiSummary: Object.freeze({
    featureFlag: 'MKT_REPORT_AI_SUMMARY_ENABLED',
    defaultEnabled: false,
    providerBoundary: 'injectable',
    productionBindingConfigured: false,
  }),
  larkTables: Object.freeze({
    snapshots: 'mktReportSnapshots',
    metricValues: 'mktReportMetricValues',
    topContent: 'mktReportTopContent',
    topAds: 'mktReportTopAds',
  }),
  missingMetric: null,
  observedZero: 0,
});
