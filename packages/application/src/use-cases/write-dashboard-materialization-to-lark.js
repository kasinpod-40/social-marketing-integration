import { dateOnlyToEpochMilliseconds } from '../../../shared/src/date/date-only.js';
import { createExplicitNullUpdateRepository } from '../../../sync-engine/src/explicit-null-update-repository.js';
import {
  buildReportMetricValueRows,
  buildReportTopAdsRows,
  buildReportTopContentRows,
} from '../reports/build-report-output-rows.js';
import {
  buildLarkMetricSlotKey,
  buildLarkReportSlotBase,
  buildLarkTopAdsSlotKey,
  buildLarkTopContentSlotKey,
  LARK_REPORT_SLOT_KEY_FIELD,
} from '../reports/lark-report-slot-key.js';
import { stableStringify } from './build-report-snapshot.js';
import { isReviewedOrganicDashboardCompatibilityProfile } from '../../../config/src/lark-dashboard-display-v2-compatibility.js';

const REPORT_METRIC_NULLABLE_FIELDS = Object.freeze([
  'current_value',
  'display_value',
  'compare_value',
  'change_value',
  'change_percent',
]);
const DASHBOARD_WINDOW_DAY_OPTIONS = new Set(['1', '3', '7', '30']);
const DASHBOARD_COMPATIBILITY_WINDOW_FIELD =
  '__mkt_legacy_window_days_single_select_v1';

/** Dashboard/Lark binding that reads materializations only, never detailed historical facts. */
export async function writeDashboardMaterializationToLark(input = {}) {
  const reader = requireReader(input.reader);
  const repository = requireObject(input.repository, 'repository');
  const syncEngine = requireSyncEngine(input.syncEngine);
  const materialization = await reader.readById(requireText(input.reportId, 'reportId'));
  if (!materialization) throw new Error(`Report materialization not found: ${input.reportId}`);
  const { row, payload } = materialization;
  const tables = requireTables(input.tables, payload.capability);
  const customerProfile = requireText(input.customerProfile, 'customerProfile');
  const utcOffset = requireText(input.utcOffset ?? '+07:00', 'utcOffset');
  const topContentLimit = boundedLimit(input.topContentLimit ?? Math.max(payload.topContent.length, 5));
  const topAdsLimit = boundedLimit(input.topAdsLimit ?? Math.max(payload.topAds.length, 5));
  const sourceSnapshotCount = nonNegativeInteger(input.sourceSnapshotCount ?? 0, 'sourceSnapshotCount');
  const sharedDimensions = buildSharedDimensions({
    row,
    payload,
    customerProfile,
    utcOffset,
  });
  const larkSlotBase = buildLarkReportSlotBase({
    reportId: row.report_id,
    customerProfile,
    customerKey: row.customer_key,
    capability: payload.capability,
    platform: payload.platformScope,
    accountId: row.account_key,
    reportType: row.report_type,
    periodKind: row.period_kind,
    windowDays: row.window_days,
  });
  const snapshotRow = Object.freeze({
    [LARK_REPORT_SLOT_KEY_FIELD]: larkSlotBase,
    report_id: row.report_id,
    ...sharedDimensions,
    compare_start: row.compare_start ? dateOnlyToEpochMilliseconds(row.compare_start, { utcOffset }) : null,
    compare_end: row.compare_end ? dateOnlyToEpochMilliseconds(row.compare_end, { utcOffset }) : null,
    comparison_mode: payload.period.comparisonMode,
    platform: Object.freeze([payload.platformScope]),
    course_name: null,
    metric_payload_json: stableStringify(payload.metricPayload),
    top_content_json: stableStringify(payload.topContent),
    top_ads_json: stableStringify(payload.topAds),
    generated_at: row.generated_at,
    data_status: payload.dataStatus,
    formula_version: row.formula_version,
    source_snapshot_count: sourceSnapshotCount,
    baseline_coverage_rate: payload.coverageRate,
  });
  const metricInput = {
    reportId: row.report_id,
    reportSettingKey: row.report_setting_key,
    customerProfile,
    reportType: row.report_type,
    platform: payload.platformScope,
    accountId: row.account_key,
    dataStatus: payload.dataStatus,
    sourceSnapshotCount,
    period: payload.period,
    generatedAt: row.generated_at,
    utcOffset,
    sharedDimensions: buildMetricSharedDimensions(sharedDimensions),
  };
  const summaryMetricRows = buildReportMetricValueRows({
    ...metricInput,
    metrics: payload.metricPayload,
  });
  const dimensionMetricRows = buildReportMetricValueRows({
    ...metricInput,
    metrics: payload.collections?.dimension_metrics ?? [],
  });
  const metricRows = Object.freeze(
    [...summaryMetricRows, ...dimensionMetricRows].map((metricRow) => {
      const compatibleRow = attachDashboardCompatibilityWindow(
        metricRow,
        metricInput.sharedDimensions,
      );
      return Object.freeze({
        ...compatibleRow,
        [LARK_REPORT_SLOT_KEY_FIELD]: buildLarkMetricSlotKey(
          larkSlotBase,
          compatibleRow.report_metric_key,
        ),
      });
    }),
  );
  const topContentRows = payload.capability === 'organic' ? Object.freeze(buildReportTopContentRows({
    reportId: row.report_id,
    reportSettingKey: row.report_setting_key,
    customerProfile,
    reportType: row.report_type,
    platform: payload.platformScope,
    accountId: row.account_key,
    contentRows: payload.topContent,
    limit: topContentLimit,
    period: payload.period,
    generatedAt: row.generated_at,
    utcOffset,
    sharedDimensions,
  }).map((contentRow) => Object.freeze({
    ...contentRow,
    [LARK_REPORT_SLOT_KEY_FIELD]: buildLarkTopContentSlotKey(larkSlotBase, contentRow.rank),
  }))) : Object.freeze([]);
  const topAdsRows = payload.capability === 'paid_ads' ? Object.freeze(buildReportTopAdsRows({
    reportId: row.report_id,
    reportSettingKey: row.report_setting_key,
    customerProfile,
    reportType: row.report_type,
    platform: payload.platformScope,
    accountId: row.account_key,
    adRows: payload.topAds,
    limit: topAdsLimit,
    period: payload.period,
    generatedAt: row.generated_at,
    utcOffset,
    sharedDimensions,
  }).map((adRow) => Object.freeze({
    ...adRow,
    [LARK_REPORT_SLOT_KEY_FIELD]: buildLarkTopAdsSlotKey(larkSlotBase, adRow.rank),
  }))) : Object.freeze([]);
  const metricRepository = createExplicitNullUpdateRepository({
    repository,
    fieldNames: REPORT_METRIC_NULLABLE_FIELDS,
  });
  const planEntries = [
    {
      name: 'reportSnapshot',
      repository,
      tableId: tables.mktReportSnapshots,
      keyField: LARK_REPORT_SLOT_KEY_FIELD,
      rows: [snapshotRow],
    },
    {
      name: 'reportMetricValues',
      repository: metricRepository,
      tableId: tables.mktReportMetricValues,
      keyField: LARK_REPORT_SLOT_KEY_FIELD,
      rows: metricRows,
    },
    ...(topContentRows.length > 0 ? [{
      name: 'reportTopContent',
      repository,
      tableId: tables.mktReportTopContent,
      keyField: LARK_REPORT_SLOT_KEY_FIELD,
      rows: topContentRows,
    }] : []),
    ...(topAdsRows.length > 0 ? [{
      name: 'reportTopAds',
      repository,
      tableId: tables.mktReportTopAds,
      keyField: LARK_REPORT_SLOT_KEY_FIELD,
      rows: topAdsRows,
    }] : []),
  ];
  const plans = {};
  for (const entry of planEntries) {
    plans[entry.name] = await syncEngine.planByKey({
      repository: entry.repository,
      tableId: entry.tableId,
      keyField: entry.keyField,
      rows: entry.rows,
    });
  }
  const results = {};
  for (const [name, plan] of Object.entries(plans)) {
    results[name] = await syncEngine.executePlan(plan, {
      beforeWriteChunk: typeof input.assertLockActive === 'function' ? input.assertLockActive : undefined,
    });
  }
  return Object.freeze({
    reportId: row.report_id,
    platform: payload.platformScope,
    capability: payload.capability,
    dataStatus: payload.dataStatus,
    source: 'report_materializations',
    rows: Object.freeze({ snapshots: 1, metrics: metricRows.length, topContent: topContentRows.length, topAds: topAdsRows.length }),
    results: Object.freeze(results),
  });
}

function buildSharedDimensions(input) {
  return Object.freeze({
    customer_key: requireText(input.row.customer_key, 'materialization.customer_key'),
    customer_profile: requireText(input.customerProfile, 'customerProfile'),
    capability: requireText(input.payload.capability, 'materialization.capability'),
    account_id: requireText(input.row.account_key, 'materialization.account_key'),
    report_setting_key: requireText(
      input.row.report_setting_key,
      'materialization.report_setting_key',
    ),
    report_type: requireText(input.row.report_type, 'materialization.report_type'),
    period_kind: requireText(input.row.period_kind, 'materialization.period_kind'),
    window_days: input.row.window_days ?? null,
    period_start: dateOnlyToEpochMilliseconds(input.row.period_start, {
      utcOffset: input.utcOffset,
    }),
    period_end: dateOnlyToEpochMilliseconds(input.row.period_end, {
      utcOffset: input.utcOffset,
    }),
    data_status: requireText(input.row.data_status, 'materialization.data_status'),
    coverage_rate: input.row.coverage_rate ?? null,
    generated_at: input.row.generated_at,
  });
}

/**
 * The reviewed Integration Workspace and Chemistry K Customer Production runtimes keep Number
 * window_days as planning/write authority and mirror the same preset into the immutable physical
 * SingleSelect used by their copied Dashboard slicers and charts. Other customer profiles retain the
 * normal SingleSelect text contract.
 */
function buildMetricSharedDimensions(sharedDimensions) {
  const periodKind = requireText(sharedDimensions.period_kind, 'sharedDimensions.period_kind');
  const compatibility = isReviewedOrganicDashboardCompatibilityProfile(
    sharedDimensions.customer_profile,
  );
  if (periodKind === 'custom_range') {
    if (sharedDimensions.window_days !== null) {
      throw new TypeError('custom_range metric dimensions must keep window_days null');
    }
    return Object.freeze({
      ...sharedDimensions,
      window_days: null,
      ...(compatibility ? { [DASHBOARD_COMPATIBILITY_WINDOW_FIELD]: null } : {}),
    });
  }
  const value = String(sharedDimensions.window_days ?? '').trim();
  if (!DASHBOARD_WINDOW_DAY_OPTIONS.has(value)) {
    throw new TypeError('rolling_days metric window_days must be one of 1, 3, 7, 30');
  }
  return Object.freeze({
    ...sharedDimensions,
    window_days: compatibility ? Number(value) : value,
    ...(compatibility ? { [DASHBOARD_COMPATIBILITY_WINDOW_FIELD]: value } : {}),
  });
}

function attachDashboardCompatibilityWindow(metricRow, sharedDimensions) {
  if (!Object.hasOwn(sharedDimensions, DASHBOARD_COMPATIBILITY_WINDOW_FIELD)) return metricRow;
  return Object.freeze({
    ...metricRow,
    [DASHBOARD_COMPATIBILITY_WINDOW_FIELD]:
      sharedDimensions[DASHBOARD_COMPATIBILITY_WINDOW_FIELD],
  });
}

function requireReader(value) {
  if (typeof value?.readById !== 'function') throw new TypeError('materialization reader requires readById()');
  return value;
}
function requireSyncEngine(value) {
  if (typeof value?.planByKey !== 'function' || typeof value?.executePlan !== 'function') {
    throw new TypeError('syncEngine requires planByKey() and executePlan()');
  }
  return value;
}
function requireTables(value, capability) {
  const tables = requireObject(value, 'tables');
  const shared = {
    mktReportSnapshots: requireText(tables.mktReportSnapshots, 'tables.mktReportSnapshots'),
    mktReportMetricValues: requireText(tables.mktReportMetricValues, 'tables.mktReportMetricValues'),
  };
  if (capability === 'organic') {
    return Object.freeze({
      ...shared,
      mktReportTopContent: requireText(tables.mktReportTopContent, 'tables.mktReportTopContent'),
    });
  }
  if (capability === 'paid_ads') {
    return Object.freeze({
      ...shared,
      mktReportTopAds: requireText(tables.mktReportTopAds, 'tables.mktReportTopAds'),
    });
  }
  return Object.freeze(shared);
}
function boundedLimit(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > 100) throw new TypeError('rank limit must be 1..100');
  return number;
}
function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be non-negative`);
  return number;
}
function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${fieldName} is required`);
  return value;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
