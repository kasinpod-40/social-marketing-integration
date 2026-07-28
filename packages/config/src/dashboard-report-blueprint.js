/** Repository-only binding contract. This module never mutates a Lark Base. */
export const DASHBOARD_REPORT_BLUEPRINT = Object.freeze({
  schemaVersion: 'dashboard-report-blueprint-v1',
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
  larkTables: Object.freeze({
    snapshots: 'mktReportSnapshots',
    metricValues: 'mktReportMetricValues',
    topContent: 'mktReportTopContent',
    topAds: 'mktReportTopAds',
  }),
  missingMetric: null,
  observedZero: 0,
});
