import { buildAdsMetricPayload } from '../reports/calculate-ads-period-metrics.js';
import {
  buildOrganicMetricPayload,
  buildOrganicTopContentPayload,
  calculateOrganicPeriodMetrics,
} from '../reports/calculate-organic-period-metrics.js';
import {
  REPORT_PLATFORM_CAPABILITY,
  REPORT_SOURCE_STATUS,
  reportSourceUnavailable,
} from '../reports/report-platform-adapter-registry.js';
import { saveDashboardReportMaterialization } from '../reports/report-materialization.js';
import { resolveReportPeriod } from '../reports/report-period.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const REPORT_TYPE = 'dashboard_performance_report';
const MATERIALIZATION_SCHEMA_VERSION = 'dashboard-materialization-v2';

/** Generate one deterministic report from D1 facts, then persist the validated materialization. */
export async function generateDashboardReportMaterialization(input = {}) {
  const registry = requireRegistry(input.registry);
  const store = requireMaterializationStore(input.materializationStore);
  const platformScope = requireText(input.platformScope, 'platformScope');
  const accountKey = requireText(input.accountKey, 'accountKey');
  const customerKey = requireText(input.customerKey, 'customerKey');
  const reportSettingKey = requireText(input.reportSettingKey, 'reportSettingKey');
  const generatedAt = requireTimestamp(input.generatedAt ?? Date.now(), 'generatedAt');
  const timeZone = requireText(input.timeZone ?? 'Asia/Bangkok', 'timeZone');
  const period = resolveReportPeriod({
    periodKind: input.periodKind,
    windowDays: input.windowDays,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    comparisonMode: input.comparisonMode ?? 'previous_period',
    timeZone,
    now: new Date(generatedAt),
    maxCustomRangeDays: input.maxCustomRangeDays,
  });
  const { contract, adapter } = registry.get(platformScope);
  const reportResult = contract.sourceStatus !== REPORT_SOURCE_STATUS.ACTIVE || !adapter
    ? buildUnavailableResult({ contract, reportSettingKey, period })
    : await buildActiveResult({
      adapter,
      contract,
      customerKey,
      accountKey,
      reportSettingKey,
      period,
      timeZone,
      sourceWatermark: optionalText(input.sourceWatermark),
      topContentLimit: input.topContentLimit,
      topAdsLimit: input.topAdsLimit,
      maxContentRecords: input.maxContentRecords,
      maxFactRows: input.maxFactRows,
    });
  const materialization = await saveDashboardReportMaterialization({
    store,
    result: reportResult,
    customerKey,
    accountKey,
    platformScope: contract.platformScope,
    capability: contract.capability,
    formulaVersion: contract.formulaVersion,
    schemaVersion: MATERIALIZATION_SCHEMA_VERSION,
    source: reportResult.source,
    sourceWatermark: reportResult.sourceWatermark,
    coverageRate: reportResult.coverageRate ?? reportResult.baselineCoverageRate ?? null,
    generatedAt,
  });
  return Object.freeze({
    platform: contract.platformScope,
    capability: contract.capability,
    reportType: REPORT_TYPE,
    reportSettingKey,
    reportId: materialization.reportId,
    period,
    dataStatus: reportResult.dataStatus,
    sourceWatermark: reportResult.sourceWatermark,
    sourceRead: reportResult.sourceRead,
    metricPayload: reportResult.metricPayload,
    topContent: reportResult.topContent,
    topAds: reportResult.topAds,
    materialization,
    warnings: reportResult.dataStatus === 'source_unavailable'
      ? Object.freeze([Object.freeze({
        code: reportResult.sourceUnavailableReason,
        platformScope: contract.platformScope,
      })])
      : Object.freeze([]),
  });
}

async function buildActiveResult(input) {
  if (input.contract.capability === REPORT_PLATFORM_CAPABILITY.ORGANIC) return buildOrganicResult(input);
  if (input.contract.capability === REPORT_PLATFORM_CAPABILITY.PAID_ADS) return buildAdsResult(input);
  throw permanentError('Dashboard report capability is unsupported', {
    code: 'DASHBOARD_REPORT_CAPABILITY_UNSUPPORTED',
    details: { capability: input.contract.capability },
  });
}

async function buildOrganicResult(input) {
  const source = await input.adapter.load({
    customerKey: input.customerKey,
    accountKey: input.accountKey,
    timeZone: input.timeZone,
    periodStart: input.period.periodStart,
    periodEnd: input.period.periodEnd,
    compareStart: input.period.compareStart,
    compareEnd: input.period.compareEnd,
    maxContentRecords: input.maxContentRecords,
  });
  assertWatermark(input.sourceWatermark, source.readSummary?.sourceWatermark, input.contract.platformScope);
  const current = calculateOrganicPeriodMetrics({
    platform: input.contract.platformScope,
    contents: source.contents,
    observations: source.observations ?? source.dailySnapshots,
    periodStart: input.period.periodStart,
    periodEnd: input.period.periodEnd,
    coverageStatus: source.readSummary?.coverageStatus,
  });
  const compare = input.period.comparisonMode === 'none' ? null : calculateOrganicPeriodMetrics({
    platform: input.contract.platformScope,
    contents: source.contents,
    observations: source.observations ?? source.dailySnapshots,
    periodStart: input.period.compareStart,
    periodEnd: input.period.compareEnd,
    coverageStatus: source.readSummary?.coverageStatus,
  });
  const topContent = buildOrganicTopContentPayload(current.contentRows, input.topContentLimit ?? 5);
  return Object.freeze({
    platform: input.contract.platformScope,
    capability: input.contract.capability,
    reportSettingKey: input.reportSettingKey,
    reportType: REPORT_TYPE,
    period: input.period,
    dataStatus: current.dataStatus,
    baselineCoverageRate: current.baselineCoverageRate,
    sourceWatermark: source.readSummary?.sourceWatermark ?? null,
    sourceRead: source.readSummary,
    source: 'd1_organic_observations',
    metricPayload: buildOrganicMetricPayload({
      platform: input.contract.platformScope,
      formulaVersion: input.contract.formulaVersion,
      current,
      compare,
    }),
    topContent,
    topAds: Object.freeze([]),
    topContentCount: topContent.length,
    topAdsCount: 0,
  });
}

async function buildAdsResult(input) {
  const [currentSource, compareSource] = await Promise.all([
    input.adapter.load({
      customerKey: input.customerKey,
      accountKey: input.accountKey,
      periodStart: input.period.periodStart,
      periodEnd: input.period.periodEnd,
      maxFactRows: input.maxFactRows,
      topAdsLimit: input.topAdsLimit ?? 5,
    }),
    input.period.comparisonMode === 'none' ? Promise.resolve(null) : input.adapter.load({
      customerKey: input.customerKey,
      accountKey: input.accountKey,
      periodStart: input.period.compareStart,
      periodEnd: input.period.compareEnd,
      maxFactRows: input.maxFactRows,
      topAdsLimit: input.topAdsLimit ?? 5,
    }),
  ]);
  assertWatermark(input.sourceWatermark, currentSource.readSummary?.sourceWatermark, input.contract.platformScope);
  if (compareSource) {
    assertWatermark(input.sourceWatermark, compareSource.readSummary?.sourceWatermark, input.contract.platformScope);
  }
  const metrics = currentSource.metrics;
  return Object.freeze({
    platform: input.contract.platformScope,
    capability: input.contract.capability,
    reportSettingKey: input.reportSettingKey,
    reportType: REPORT_TYPE,
    period: input.period,
    dataStatus: metrics.data_status,
    coverageRate: metrics.coverage_rate,
    sourceWatermark: currentSource.readSummary?.sourceWatermark ?? null,
    sourceRead: currentSource.readSummary,
    source: 'd1_ads_daily_facts',
    metricPayload: buildAdsMetricPayload({
      platform: input.contract.platformScope,
      formulaVersion: input.contract.formulaVersion,
      current: metrics,
      compare: compareSource?.metrics ?? null,
    }),
    topContent: Object.freeze([]),
    topAds: currentSource.topAds,
    topContentCount: 0,
    topAdsCount: currentSource.topAds.length,
  });
}

function buildUnavailableResult(input) {
  const unavailable = reportSourceUnavailable(
    input.contract,
    input.contract.sourceStatus === REPORT_SOURCE_STATUS.ACTIVE ? 'REPORT_SOURCE_ADAPTER_UNAVAILABLE' : null,
  );
  return Object.freeze({
    platform: input.contract.platformScope,
    capability: input.contract.capability,
    reportSettingKey: input.reportSettingKey,
    reportType: REPORT_TYPE,
    period: input.period,
    dataStatus: unavailable.dataStatus,
    coverageRate: null,
    sourceWatermark: null,
    sourceRead: unavailable,
    source: 'report_platform_catalog',
    sourceUnavailableReason: unavailable.reasonCode,
    metricPayload: Object.freeze({}),
    topContent: Object.freeze([]),
    topAds: Object.freeze([]),
    topContentCount: 0,
    topAdsCount: 0,
  });
}

function assertWatermark(expected, observed, platformScope) {
  if (!expected) return;
  if (observed === expected) return;
  throw permanentError('Dashboard report source watermark changed after admission', {
    code: 'DASHBOARD_REPORT_SOURCE_WATERMARK_CHANGED',
    details: { platformScope, expected, observed: observed ?? null },
  });
}
function requireRegistry(value) {
  if (typeof value?.get !== 'function') throw new TypeError('report registry requires get()');
  return value;
}
function requireMaterializationStore(value) {
  if (typeof value?.saveReportMaterialization !== 'function') {
    throw new TypeError('materializationStore requires saveReportMaterialization()');
  }
  return value;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
function optionalText(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function requireTimestamp(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${fieldName} must be epoch milliseconds`);
  return value;
}
