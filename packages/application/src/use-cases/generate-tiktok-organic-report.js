import { buildReportSnapshot } from './build-report-snapshot.js';
import {
  calculateTikTokOrganicPeriodMetrics,
  compareTikTokOrganicMetrics,
} from '../reports/calculate-tiktok-organic-report.js';
import {
  buildReportMetricValueRows,
  buildReportTopContentRows,
} from '../reports/build-report-output-rows.js';
import { loadTikTokReportMetricDefinitions } from '../reports/load-report-metric-definitions.js';
import { loadReportSetting } from '../reports/load-report-setting.js';
import { resolveOrganicReportPeriod } from '../reports/report-period.js';
import { loadTikTokOrganicReportSource } from '../reports/load-tiktok-organic-report-source.js';
import {
  normalizeTikTokContentRecords,
  normalizeTikTokDailySnapshotRecords,
} from '../reports/tiktok-organic-report-source.js';
import {
  isPartialSyncError,
  partialSyncError,
  permanentError,
} from '../../../shared/src/errors/runtime-error.js';

const FORMULA_VERSION = 'tiktok-organic-v1';
const MAX_TOP_CONTENT_LIMIT = 100;

/**
 * สร้าง Daily/Weekly TikTok Organic report จาก MKT_Content + MKT_Content_Daily
 * วางแผนทั้ง 3 ตารางก่อนเริ่มเขียน เพื่อจับ Schema/Select error แบบ Fail-fast
 */
export async function generateTikTokOrganicReport(input = {}) {
  const repository = requireRepository(input.repository);
  const syncEngine = requireSyncEngine(input.syncEngine);
  const tables = requireTables(input.tables);
  const customerProfile = requireText(input.customerProfile, 'customerProfile');
  const assertLockActive = typeof input.assertLockActive === 'function'
    ? input.assertLockActive
    : async () => undefined;
  const now = typeof input.now === 'function' ? input.now : () => Date.now();
  const progress = typeof input.onProgress === 'function' ? input.onProgress : () => undefined;

  progress({ stage: 'report_loading_configuration' });
  const [setting, metricDefinitions] = await Promise.all([
    loadReportSetting({
      repository,
      tableId: tables.mktReportSettings,
      reportSettingKey: input.reportSettingKey,
      customerProfile,
    }),
    loadTikTokReportMetricDefinitions({
      repository,
      tableId: tables.mktMetricDefinitions,
    }),
  ]);

  const accountId = requireText(input.accountId ?? setting.accountKeys[0], 'accountId');
  if (!setting.accountKeys.includes(accountId)) {
    throw new Error(`accountId ${accountId} is not allowed by report setting ${setting.reportSettingKey}`);
  }
  const reportType = requireMatchingReportType(input.reportType, setting.reportType);
  const period = resolveOrganicReportPeriod({
    reportType,
    timeZone: setting.timeZone,
    comparisonMode: input.comparisonMode ?? setting.comparisonMode,
    periodEnd: input.periodEnd,
    now: new Date(now()),
  });

  progress({
    stage: 'report_loading_source',
    reportType,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
  });
  const source = await loadTikTokOrganicReportSource({
    repository,
    tables,
    accountId,
    period,
    utcOffset: setting.utcOffset,
    maxContentRecords: input.maxContentRecords,
    maxSnapshotRecords: input.maxSnapshotRecords,
    maxFallbackScanRecords: input.maxFallbackScanRecords,
    maxPagesPerQuery: input.maxPagesPerQuery,
    pageSize: input.sourcePageSize,
  });
  await assertLockActive();
  const { contentRecords, dailyRecords } = source;
  progress({
    stage: 'report_source_loaded',
    ...source.readSummary,
  });

  const contents = normalizeTikTokContentRecords(contentRecords, {
    accountId,
    timeZone: setting.timeZone,
  });
  const dailySnapshots = normalizeTikTokDailySnapshotRecords(dailyRecords, {
    accountId,
    timeZone: setting.timeZone,
  });
  const current = calculateTikTokOrganicPeriodMetrics({
    contents,
    dailySnapshots,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
  });
  const compare = period.comparisonMode === 'none'
    ? null
    : calculateTikTokOrganicPeriodMetrics({
      contents,
      dailySnapshots,
      periodStart: period.compareStart,
      periodEnd: period.compareEnd,
    });
  const metricPayload = compareTikTokOrganicMetrics({
    current,
    compare,
    metricDefinitions,
  });
  const generatedAt = now();
  const effectiveTopContentLimit = resolveTopContentLimit(
    input.topContentLimit,
    setting.topContentLimit,
  );
  const topContentPayload = buildTopContentPayload(current.contentRows, effectiveTopContentLimit);

  const snapshotRow = buildReportSnapshot({
    reportSettingKey: setting.reportSettingKey,
    customerProfile,
    accountId,
    reportType,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    comparisonMode: period.comparisonMode,
    compareStart: period.compareStart,
    compareEnd: period.compareEnd,
    platforms: ['tiktok'],
    metricPayload,
    topContent: topContentPayload,
    topAds: [],
    generatedAt,
    utcOffset: setting.utcOffset,
    dataStatus: current.dataStatus,
    formulaVersion: FORMULA_VERSION,
    sourceSnapshotCount: current.sourceSnapshotCount,
    baselineCoverageRate: current.baselineCoverageRate,
  });
  const metricRows = buildReportMetricValueRows({
    reportId: snapshotRow.report_id,
    reportSettingKey: setting.reportSettingKey,
    customerProfile,
    reportType,
    accountId,
    metrics: metricPayload,
    dataStatus: current.dataStatus,
    sourceSnapshotCount: current.sourceSnapshotCount,
    period,
    generatedAt,
    utcOffset: setting.utcOffset,
  });
  const existingTopContentRecords = await repository.listByFieldValues(
    tables.mktReportTopContent,
    'report_id',
    [snapshotRow.report_id],
  );
  await assertLockActive();
  const existingTopContentSlots = readExistingTopContentSlotCount(
    existingTopContentRecords,
    snapshotRow.report_id,
  );
  const topContentSlotCount = Math.max(effectiveTopContentLimit, existingTopContentSlots);
  const topContentRows = buildReportTopContentRows({
    reportId: snapshotRow.report_id,
    reportSettingKey: setting.reportSettingKey,
    customerProfile,
    reportType,
    accountId,
    // Slice ด้วย Effective limit ก่อน แล้วจึงเติม Slot เก่าเป็น no_data เพื่อไม่ให้ Rank เก่าค้าง
    contentRows: current.contentRows.slice(0, effectiveTopContentLimit),
    limit: topContentSlotCount,
    period,
    generatedAt,
    utcOffset: setting.utcOffset,
  });

  progress({
    stage: 'report_planning_outputs',
    snapshotRows: 1,
    metricRows: metricRows.length,
    topContentRows: topContentRows.length,
  });
  const [snapshotPlan, metricPlan, topContentPlan] = await Promise.all([
    syncEngine.planByKey({
      repository,
      tableId: tables.mktReportSnapshots,
      keyField: 'report_id',
      rows: [snapshotRow],
    }),
    syncEngine.planByKey({
      repository,
      tableId: tables.mktReportMetricValues,
      keyField: 'report_metric_key',
      rows: metricRows,
    }),
    syncEngine.planByKey({
      repository,
      tableId: tables.mktReportTopContent,
      keyField: 'report_content_key',
      rows: topContentRows,
    }),
  ]);
  await assertLockActive();

  const plans = Object.freeze({
    reportSnapshot: snapshotPlan,
    reportMetricValues: metricPlan,
    reportTopContent: topContentPlan,
  });
  const results = {};

  for (const [name, plan] of Object.entries(plans)) {
    progress({
      stage: `report_executing_${name}`,
      createRows: plan.createRows.length,
      updateRows: plan.updateRows.length,
    });
    try {
      results[name] = await syncEngine.executePlan(plan, {
        beforeWriteChunk: assertLockActive,
        onProgress: (event) => progress({ scope: name, ...event }),
      });
    } catch (cause) {
      if (!hasReportWriteProgress({ cause, results })) throw cause;
      throw buildReportPartialError({
        cause,
        failedPhase: name,
        plans,
        results,
        reportContext: {
          reportId: snapshotRow.report_id,
          reportType,
          period,
          dataStatus: current.dataStatus,
        },
      });
    }
    await assertLockActive();
  }

  return Object.freeze({
    platform: 'tiktok',
    source: 'mkt_content_daily',
    mode: 'write',
    reportType,
    reportSettingKey: setting.reportSettingKey,
    reportId: snapshotRow.report_id,
    period,
    dataStatus: current.dataStatus,
    baselineCoverageRate: current.baselineCoverageRate,
    rawRecords: contentRecords.length + dailyRecords.length,
    sourceContentRecords: contentRecords.length,
    sourceDailySnapshotRecords: dailyRecords.length,
    sourceRead: source.readSummary,
    sourceSnapshotCount: current.sourceSnapshotCount,
    trackedContentCount: current.trackedContentCount,
    metricCount: metricRows.length,
    topContentLimit: effectiveTopContentLimit,
    topContentSlotCount,
    topContentCount: topContentRows.filter((row) => row.data_status !== 'no_data').length,
    reportSnapshot: results.reportSnapshot,
    reportMetricValues: results.reportMetricValues,
    reportTopContent: results.reportTopContent,
    metricPayload,
  });
}


function resolveTopContentLimit(override, configured) {
  const value = override === null || override === undefined || override === ''
    ? configured
    : override;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > MAX_TOP_CONTENT_LIMIT) {
    throw permanentError(`topContentLimit must be an integer between 1 and ${MAX_TOP_CONTENT_LIMIT}`, {
      code: 'INVALID_SYNC_JOB',
      details: { fieldName: 'topContentLimit', value: value ?? null, max: MAX_TOP_CONTENT_LIMIT },
    });
  }
  return number;
}

function readExistingTopContentSlotCount(records, reportId) {
  const ranks = new Set();
  let highest = 0;
  for (const record of records) {
    const fields = record?.fields;
    if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
      throw permanentError(`Top content row for ${reportId} requires fields`, {
        code: 'REPORT_TOP_CONTENT_STATE_INVALID',
        details: { reportId },
      });
    }
    const rank = Number(fields.rank);
    if (!Number.isSafeInteger(rank) || rank <= 0 || rank > MAX_TOP_CONTENT_LIMIT) {
      throw permanentError(`Top content rank must be between 1 and ${MAX_TOP_CONTENT_LIMIT}`, {
        code: 'REPORT_TOP_CONTENT_STATE_INVALID',
        details: { reportId, rank: fields.rank ?? null },
      });
    }
    if (ranks.has(rank)) {
      throw permanentError(`Duplicate top content rank ${rank} for ${reportId}`, {
        code: 'REPORT_TOP_CONTENT_STATE_INVALID',
        details: { reportId, rank },
      });
    }
    ranks.add(rank);
    highest = Math.max(highest, rank);
  }
  return highest;
}

function hasReportWriteProgress(input) {
  if (Object.values(input.results).some(hasTableWriteProgress)) return true;
  if (!isPartialSyncError(input.cause)) return false;
  return hasTableWriteProgress(input.cause.partialResult);
}

function hasTableWriteProgress(value) {
  if (!value || typeof value !== 'object') return false;
  if (nonNegative(value.created) > 0 || nonNegative(value.updated) > 0) return true;
  return value.writeOutcome === 'partial' || value.writeOutcome === 'unknown';
}

function buildTopContentPayload(rows, limit) {
  return rows.slice(0, limit).map((row, index) => Object.freeze({
    rank: index + 1,
    content_key: row.content.contentKey,
    external_content_id: row.content.externalContentId,
    caption: row.content.caption,
    content_url: row.content.contentUrl,
    published_at: row.content.publishedAt,
    period_views: row.periodViews,
    period_likes: row.periodLikes,
    period_comments: row.periodComments,
    period_shares: row.periodShares,
    period_engagement: row.periodEngagement,
    period_engagement_rate: row.periodEngagementRate,
    latest_total_views: row.current?.views ?? null,
    performance_status: row.performanceStatus,
    data_status: row.dataStatus,
  }));
}

function buildReportPartialError(input) {
  const normalizedResults = {};
  for (const [name, plan] of Object.entries(input.plans)) {
    if (input.results[name]) {
      normalizedResults[name] = input.results[name];
    } else if (name === input.failedPhase && isPartialSyncError(input.cause)) {
      normalizedResults[name] = normalizeTableResult(input.cause.partialResult, plan, 'partial');
    } else {
      normalizedResults[name] = plannedOnlyResult(plan);
    }
  }

  return partialSyncError(`TikTok report partially completed during ${input.failedPhase}`, {
    retryable: input.cause?.retryable !== false,
    cause: input.cause,
    partialResult: Object.freeze({
      platform: 'tiktok',
      source: 'mkt_content_daily',
      mode: 'write',
      ...input.reportContext,
      ...normalizedResults,
    }),
    details: {
      failedPhase: input.failedPhase,
      reportId: input.reportContext.reportId,
      causeCode: input.cause?.code ?? null,
      causeMessage: input.cause instanceof Error ? input.cause.message : String(input.cause),
    },
  });
}

function normalizeTableResult(result, plan, fallbackOutcome) {
  return Object.freeze({
    created: nonNegative(result?.created),
    updated: nonNegative(result?.updated),
    skipped: nonNegative(result?.skipped ?? plan.skipped),
    duplicateInputRows: nonNegative(result?.duplicateInputRows ?? plan.duplicateInputRows),
    writeOutcome: result?.writeOutcome ?? fallbackOutcome,
  });
}

function plannedOnlyResult(plan) {
  return Object.freeze({
    created: 0,
    updated: 0,
    skipped: plan.skipped,
    duplicateInputRows: plan.duplicateInputRows,
    writeOutcome: 'not_started',
  });
}

function requireMatchingReportType(requested, configured) {
  if (requested === null || requested === undefined || requested === '') return configured;
  const normalized = requireText(requested, 'reportType');
  if (normalized !== configured) {
    throw new Error(`Requested reportType=${normalized} does not match setting reportType=${configured}`);
  }
  return normalized;
}

function requireRepository(repository) {
  for (const method of ['listByFieldValues', 'prepareRows', 'createMany', 'updateMany']) {
    if (typeof repository?.[method] !== 'function') {
      throw new TypeError(`generateTikTokOrganicReport requires repository.${method}`);
    }
  }
  return repository;
}

function requireSyncEngine(syncEngine) {
  for (const method of ['planByKey', 'executePlan']) {
    if (typeof syncEngine?.[method] !== 'function') {
      throw new TypeError(`generateTikTokOrganicReport requires syncEngine.${method}`);
    }
  }
  return syncEngine;
}

function requireTables(tables) {
  const source = tables ?? {};
  const required = [
    'mktContent',
    'mktContentDaily',
    'mktMetricDefinitions',
    'mktReportSettings',
    'mktReportSnapshots',
    'mktReportMetricValues',
    'mktReportTopContent',
  ];
  return Object.freeze(Object.fromEntries(required.map((key) => [key, requireText(source[key], `tables.${key}`)])));
}

function nonNegative(value) {
  const number = Number(value ?? 0);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`generateTikTokOrganicReport requires ${fieldName}`);
  }
  return value.trim();
}
