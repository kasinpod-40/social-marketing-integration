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
  'daily_impressions',
  'daily_clicks',
  'daily_cpc',
  'daily_cpm',
  'ad_spend_amount',
  'ad_clicks',
  'ad_ctr_percent',
  'content_chart_label',
  'content_period_views',
  'content_period_engagement',
]);
const DASHBOARD_WINDOW_DAY_OPTIONS = new Set(['1', '3', '7', '30']);
const MAX_DASHBOARD_RANK_ROWS = 50_000;
const LEGACY_PADDED_RANK_COUNT = 5;
const SNAPSHOT_RANKED_JSON_MAX_ROWS = 100;
const SNAPSHOT_RANKED_JSON_MAX_BYTES = 50_000;
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
  const shouldReadExistingRankCounts = (
    payload.capability === 'organic' && input.topContentLimit === undefined
  ) || (
    payload.capability === 'paid_ads' && input.topAdsLimit === undefined
  );
  const existingRankCounts = shouldReadExistingRankCounts
    ? await readExistingRankCounts({
      repository,
      snapshotTableId: tables.mktReportSnapshots,
      topContentTableId: tables.mktReportTopContent,
      topAdsTableId: tables.mktReportTopAds,
      capability: payload.capability,
      larkSlotBase,
    })
    : Object.freeze({ topContent: 0, topAds: 0 });
  const topContentLimit = boundedLimit(input.topContentLimit ?? Math.max(
    payload.topContent.length,
    existingRankCounts.topContent,
    LEGACY_PADDED_RANK_COUNT,
  ));
  const topAdsLimit = boundedLimit(input.topAdsLimit ?? Math.max(
    payload.topAds.length,
    existingRankCounts.topAds,
    LEGACY_PADDED_RANK_COUNT,
  ));
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
    // Ranked tables are the complete Dashboard source. Snapshot JSON stays bounded for Lark cells
    // and legacy/AI readers that historically consumed only a compact ranked sample.
    top_content_json: buildBoundedRankedSnapshotJson(payload.topContent),
    top_ads_json: buildBoundedRankedSnapshotJson(payload.topAds),
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
    metrics: [
      ...(payload.collections?.dimension_metrics ?? []),
      ...buildPaidAdsRankMetricPayload({
        capability: payload.capability,
        platform: payload.platformScope,
        rows: payload.topAds,
        limit: topAdsLimit,
        formulaVersion: row.formula_version,
      }),
      ...buildOrganicContentRankMetricPayload({
        capability: payload.capability,
        platform: payload.platformScope,
        rows: payload.topContent,
        limit: topContentLimit,
        formulaVersion: row.formula_version,
      }),
    ],
  });
  const dailyTrendMetricRows = buildPaidAdsDailyTrendRows({
    ...metricInput,
    capability: payload.capability,
    rows: payload.collections?.ads_daily_trend ?? [],
    formulaVersion: row.formula_version,
  });
  const metricRows = Object.freeze(
    [...summaryMetricRows, ...dimensionMetricRows, ...dailyTrendMetricRows].map((metricRow) => {
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
  const topContentRowCount = payload.capability === 'organic'
    ? Math.min(topContentLimit, payload.topContent.length)
    : 0;
  const topContentRows = topContentRowCount > 0 ? Object.freeze(buildReportTopContentRows({
    reportId: row.report_id,
    reportSettingKey: row.report_setting_key,
    customerProfile,
    reportType: row.report_type,
    platform: payload.platformScope,
    accountId: row.account_key,
    contentRows: payload.topContent,
    limit: topContentRowCount,
    period: payload.period,
    generatedAt: row.generated_at,
    utcOffset,
    sharedDimensions,
  }).map((contentRow) => {
    const compatibleRow = attachDashboardCompatibilityWindow(
      contentRow,
      buildMetricSharedDimensions(sharedDimensions),
    );
    return Object.freeze({
      ...compatibleRow,
      [LARK_REPORT_SLOT_KEY_FIELD]: buildLarkTopContentSlotKey(larkSlotBase, contentRow.rank),
    });
  })) : Object.freeze([]);
  const topAdsRowCount = payload.capability === 'paid_ads'
    ? Math.min(topAdsLimit, payload.topAds.length)
    : 0;
  const topAdsRows = topAdsRowCount > 0 ? Object.freeze(buildReportTopAdsRows({
    reportId: row.report_id,
    reportSettingKey: row.report_setting_key,
    customerProfile,
    reportType: row.report_type,
    platform: payload.platformScope,
    accountId: row.account_key,
    adRows: payload.topAds,
    limit: topAdsRowCount,
    period: payload.period,
    generatedAt: row.generated_at,
    utcOffset,
    sharedDimensions,
  }).map((adRow) => {
    const compatibleRow = attachDashboardCompatibilityWindow(
      adRow,
      buildMetricSharedDimensions(sharedDimensions),
    );
    return Object.freeze({
      ...compatibleRow,
      [LARK_REPORT_SLOT_KEY_FIELD]: buildLarkTopAdsSlotKey(larkSlotBase, adRow.rank),
    });
  })) : Object.freeze([]);
  const staleTopContentSlotKeys = payload.capability === 'organic'
    ? buildUnusedRankSlotKeys({
      slotBase: larkSlotBase,
      populated: topContentRowCount,
      limit: topContentLimit,
      buildSlotKey: buildLarkTopContentSlotKey,
    })
    : Object.freeze([]);
  const staleTopAdsSlotKeys = payload.capability === 'paid_ads'
    ? buildUnusedRankSlotKeys({
      slotBase: larkSlotBase,
      populated: topAdsRowCount,
      limit: topAdsLimit,
      buildSlotKey: buildLarkTopAdsSlotKey,
    })
    : Object.freeze([]);
  const staleTopContentRecords = await readExactSlotRecords({
    repository,
    tableId: tables.mktReportTopContent,
    slotKeys: staleTopContentSlotKeys,
  });
  const staleTopAdsRecords = await readExactSlotRecords({
    repository,
    tableId: tables.mktReportTopAds,
    slotKeys: staleTopAdsSlotKeys,
  });
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
  const deleted = Object.freeze({
    topContent: await deleteExactSlotRecords({
      repository,
      tableId: tables.mktReportTopContent,
      records: staleTopContentRecords,
      slotKeys: staleTopContentSlotKeys,
      assertLockActive: input.assertLockActive,
    }),
    topAds: await deleteExactSlotRecords({
      repository,
      tableId: tables.mktReportTopAds,
      records: staleTopAdsRecords,
      slotKeys: staleTopAdsSlotKeys,
      assertLockActive: input.assertLockActive,
    }),
  });
  return Object.freeze({
    reportId: row.report_id,
    platform: payload.platformScope,
    capability: payload.capability,
    dataStatus: payload.dataStatus,
    source: 'report_materializations',
    rows: Object.freeze({ snapshots: 1, metrics: metricRows.length, topContent: topContentRows.length, topAds: topAdsRows.length }),
    deleted,
    results: Object.freeze(results),
  });
}

function buildPaidAdsDailyTrendRows(input) {
  if (input.capability !== 'paid_ads') return Object.freeze([]);
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const platform = requireText(input.platform, 'paidAdsDailyTrend.platform');
  const formulaVersion = requireText(input.formulaVersion, 'paidAdsDailyTrend.formulaVersion');
  const baseRows = buildReportMetricValueRows({
    ...input,
    metrics: rows.map((row, index) => ({
      metricKey: `${platform}:ads_daily_trend`,
      stableMetricKey: `${platform}:ads_daily_trend`,
      displayName: requireText(row.metric_date, 'paidAdsDailyTrend.metric_date'),
      current: nullableFinite(row.impressions),
      compare: null,
      change: null,
      changePercent: null,
      unit: 'count',
      metricScope: 'period_delta',
      availabilityStatus: row.data_status === 'no_data_confirmed' ? 'not_observed' : 'available',
      formulaVersion,
      clientVisible: true,
      dimensionType: 'day',
      dimensionValue: `paid_ads_day:${index + 1}`,
      rank: index + 1,
    })),
  });
  return Object.freeze(baseRows.map((metricRow, index) => {
    const source = rows[index];
    return Object.freeze({
      ...metricRow,
      metric_date: dateOnlyToEpochMilliseconds(source.metric_date, { utcOffset: input.utcOffset }),
      daily_impressions: nullableFinite(source.impressions),
      daily_clicks: nullableFinite(source.clicks),
      daily_cpc: microsToCurrency(source.cpc_micros),
      daily_cpm: microsToCurrency(source.cpm_micros),
    });
  }));
}

function microsToCurrency(value) {
  const number = nullableFinite(value);
  return number === null ? null : number / 1_000_000;
}

function nullableFinite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError('Dashboard metric value must be finite');
  return number;
}

function buildUnusedRankSlotKeys(input) {
  const keys = [];
  for (let rank = input.populated + 1; rank <= input.limit; rank += 1) {
    keys.push(input.buildSlotKey(input.slotBase, rank));
  }
  return Object.freeze(keys);
}

async function readExistingRankCounts(input) {
  const records = await requireRepositoryMethod(input.repository, 'listByFieldValues')(
    input.snapshotTableId,
    LARK_REPORT_SLOT_KEY_FIELD,
    [input.larkSlotBase],
  );
  if (records.length === 0) return Object.freeze({ topContent: 0, topAds: 0 });
  if (records.length !== 1) throw new Error('Dashboard snapshot slot must resolve to exactly one record');
  const fields = records[0]?.fields ?? {};
  const previousReportId = readRecordText(fields.report_id);
  const previousTopContentRank = input.capability === 'organic' && previousReportId
    ? await readPreviousMaxRank(input.repository, input.topContentTableId, previousReportId)
    : 0;
  const previousTopAdsRank = input.capability === 'paid_ads' && previousReportId
    ? await readPreviousMaxRank(input.repository, input.topAdsTableId, previousReportId)
    : 0;
  return Object.freeze({
    topContent: Math.max(
      previousTopContentRank,
      readJsonArrayLength(fields.top_content_json, 'top_content_json'),
    ),
    topAds: Math.max(
      previousTopAdsRank,
      readJsonArrayLength(fields.top_ads_json, 'top_ads_json'),
    ),
  });
}

async function readPreviousMaxRank(repository, tableId, reportId) {
  const records = await requireRepositoryMethod(repository, 'listByFieldValues')(
    tableId,
    'report_id',
    [reportId],
  );
  let maxRank = 0;
  for (const record of records) {
    const rank = Number(record?.fields?.rank);
    if (!Number.isSafeInteger(rank) || rank <= 0 || rank > MAX_DASHBOARD_RANK_ROWS) {
      throw new TypeError('Existing Dashboard rank must be a bounded positive integer');
    }
    maxRank = Math.max(maxRank, rank);
  }
  return maxRank;
}

function buildBoundedRankedSnapshotJson(rows) {
  const bounded = rows.slice(0, SNAPSHOT_RANKED_JSON_MAX_ROWS);
  while (bounded.length > 0) {
    const json = stableStringify(bounded);
    if (new TextEncoder().encode(json).byteLength <= SNAPSHOT_RANKED_JSON_MAX_BYTES) return json;
    bounded.pop();
  }
  return '[]';
}

function readJsonArrayLength(value, fieldName) {
  const text = readRecordText(value);
  if (text === '') return 0;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new TypeError(`${fieldName} must contain valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (!Array.isArray(parsed)) throw new TypeError(`${fieldName} must contain a JSON array`);
  return parsed.length;
}

async function readExactSlotRecords(input) {
  if (input.slotKeys.length === 0) return Object.freeze([]);
  const records = await requireRepositoryMethod(input.repository, 'listByFieldValues')(
    input.tableId,
    LARK_REPORT_SLOT_KEY_FIELD,
    input.slotKeys,
  );
  const allowed = new Set(input.slotKeys);
  return Object.freeze(records.map((record) => {
    const recordId = requireText(record?.recordId ?? record?.record_id, 'recordId');
    const slotKey = readRecordText(record?.fields?.[LARK_REPORT_SLOT_KEY_FIELD]);
    if (!allowed.has(slotKey)) throw new Error('Report stale-slot lookup returned an out-of-scope record');
    return Object.freeze({ recordId, slotKey });
  }));
}

async function deleteExactSlotRecords(input) {
  if (input.records.length === 0) return 0;
  const response = await requireRepositoryMethod(input.repository, 'deleteMany')(
    input.tableId,
    input.records.map((record) => record.recordId),
    {
      beforeChunk: typeof input.assertLockActive === 'function'
        ? input.assertLockActive
        : undefined,
    },
  );
  const deleted = Number(response?.deleted ?? 0);
  if (deleted !== input.records.length) {
    throw new Error('Report stale-slot delete count did not match the exact plan');
  }
  const surviving = await requireRepositoryMethod(input.repository, 'listByFieldValues')(
    input.tableId,
    LARK_REPORT_SLOT_KEY_FIELD,
    input.slotKeys,
  );
  if (surviving.length > 0) throw new Error('Report stale-slot delete readback failed');
  return deleted;
}

function readRecordText(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value.map((item) => (
      typeof item === 'string' ? item : String(item?.text ?? item?.value ?? '')
    )).join('').trim();
  }
  return String(value?.text ?? value?.value ?? '').trim();
}

function requireRepositoryMethod(repository, method) {
  if (typeof repository?.[method] !== 'function') {
    throw new TypeError(`Dashboard materialization requires repository.${method}()`);
  }
  return repository[method].bind(repository);
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

/**
 * Mirror one bounded Clicks metric per paid-media rank into the Metric table so the existing
 * Channel and Period slicers can filter the Top Ads chart. Rank is the stable identity; label and
 * value are replaced on every materialization, while unused historical ranks become not_observed.
 */
function buildPaidAdsRankMetricPayload(input) {
  if (input.capability !== 'paid_ads') return Object.freeze([]);
  const platform = requireText(input.platform, 'paidAdsRank.platform');
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const limit = boundedLimit(input.limit);
  const formulaVersion = requireText(input.formulaVersion, 'paidAdsRank.formulaVersion');
  return Object.freeze(Array.from({ length: limit }, (_, index) => {
    const rank = index + 1;
    const row = rows[index] ?? null;
    const clicks = row?.clicks === null || row?.clicks === undefined
      ? null
      : Number(row.clicks);
    return Object.freeze({
      metricKey: `${platform}:ad_clicks`,
      stableMetricKey: `${platform}:ad_clicks`,
      displayName: row?.ad_name ?? 'ไม่มีข้อมูล',
      current: Number.isFinite(clicks) ? clicks : null,
      compare: null,
      change: null,
      changePercent: null,
      unit: 'count',
      metricScope: 'period_delta',
      availabilityStatus: row ? 'available' : 'not_observed',
      formulaVersion,
      clientVisible: true,
      // Reuse the deployed summary option; metric_key and rank keep these chart-only rows isolated.
      dimensionType: 'summary',
      dimensionValue: `paid_ad_rank:${rank}`,
      rank,
      adChartLabel: row ? `${String(rank).padStart(3, '0')} · ${row.ad_name ?? 'ไม่มีข้อมูล'}` : null,
      adSpendAmount: row?.spend_micros === null || row?.spend_micros === undefined
        ? null
        : Number(row.spend_micros) / 1_000_000,
      adClicks: Number.isFinite(clicks) ? clicks : null,
      adCtrPercent: row?.ctr === null || row?.ctr === undefined
        ? null
        : Number(row.ctr) * 100,
    });
  }));
}

/**
 * Mirror bounded Organic content ranks into the Metric table. This keeps the Content chart on the
 * same physical table as the Channel and Period slicers, avoiding cross-table option-ID drift.
 */
function buildOrganicContentRankMetricPayload(input) {
  if (input.capability !== 'organic') return Object.freeze([]);
  const platform = requireText(input.platform, 'organicContentRank.platform');
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const limit = boundedLimit(input.limit);
  const formulaVersion = requireText(input.formulaVersion, 'organicContentRank.formulaVersion');
  return Object.freeze(Array.from({ length: limit }, (_, index) => {
    const rank = index + 1;
    const row = rows[index] ?? null;
    const caption = row?.caption ?? row?.content?.caption ?? 'ไม่มีข้อมูล';
    const views = nullableFinite(row?.period_views ?? row?.periodViews);
    const engagement = nullableFinite(row?.period_engagement ?? row?.periodEngagement);
    return Object.freeze({
      metricKey: `${platform}:content_performance`,
      stableMetricKey: `${platform}:content_performance`,
      displayName: caption,
      current: views,
      compare: null,
      change: null,
      changePercent: null,
      unit: 'count',
      metricScope: 'period_delta',
      availabilityStatus: row ? 'available' : 'not_observed',
      formulaVersion,
      clientVisible: true,
      dimensionType: 'summary',
      dimensionValue: `organic_content_rank:${rank}`,
      rank,
      contentChartLabel: row ? `${String(rank).padStart(3, '0')} · ${caption}` : null,
      contentPeriodViews: views,
      contentPeriodEngagement: engagement,
    });
  }));
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
  if (!Number.isSafeInteger(number) || number <= 0 || number > MAX_DASHBOARD_RANK_ROWS) {
    throw new TypeError(`rank limit must be 1..${MAX_DASHBOARD_RANK_ROWS}`);
  }
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
