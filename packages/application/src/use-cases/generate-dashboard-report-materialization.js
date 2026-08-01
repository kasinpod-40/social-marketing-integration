import { buildAdsMetricPayload } from '../reports/calculate-ads-period-metrics.js';
import { buildCommerceDimensionMetricPayload } from '../reports/build-commerce-dimension-metric-payload.js';
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
  if (input.contract.capability === REPORT_PLATFORM_CAPABILITY.COMMERCE) return buildCommerceResult(input);
  throw permanentError('Dashboard report capability is unsupported', {
    code: 'DASHBOARD_REPORT_CAPABILITY_UNSUPPORTED',
    details: { capability: input.contract.capability },
  });
}

async function buildCommerceResult(input) {
  const [current, compare] = await Promise.all([
    input.adapter.load({
      customerKey: input.customerKey,
      accountKey: input.accountKey,
      periodStart: input.period.periodStart,
      periodEnd: input.period.periodEnd,
    }),
    input.period.comparisonMode === 'none' ? Promise.resolve(null) : input.adapter.load({
      customerKey: input.customerKey,
      accountKey: input.accountKey,
      periodStart: input.period.compareStart,
      periodEnd: input.period.compareEnd,
    }),
  ]);
  assertWatermark(input.sourceWatermark, current.source_watermark, input.contract.platformScope);
  if (compare) assertWatermark(input.sourceWatermark, compare.source_watermark, input.contract.platformScope);
  const metricPayload = buildCommerceMetricPayload({
    platform: input.contract.platformScope,
    formulaVersion: input.contract.formulaVersion,
    current: current.totals,
    compare: compare?.totals ?? null,
  });
  const collections = Object.freeze({
    commerce_context: Object.freeze([{ currency: current.currency }]),
    top_products: Object.freeze(current.products.slice(0, 5)),
    payment_methods: Object.freeze(current.payment_methods.slice(0, 20)),
    shipping_methods: Object.freeze(current.shipping_methods.slice(0, 20)),
  });
  return Object.freeze({
    platform: input.contract.platformScope,
    capability: input.contract.capability,
    reportSettingKey: input.reportSettingKey,
    reportType: REPORT_TYPE,
    period: input.period,
    dataStatus: current.data_status,
    coverageRate: coverageRate(current),
    sourceWatermark: current.source_watermark,
    sourceRead: Object.freeze({
      coverageStatus: current.coverage?.status ?? null,
      productRows: current.products.length,
      paymentMethodRows: current.payment_methods.length,
      shippingMethodRows: current.shipping_methods.length,
      sourceWatermark: current.source_watermark,
    }),
    source: 'd1_commerce_facts',
    metricPayload,
    collections: Object.freeze({
      ...collections,
      dimension_metrics: buildCommerceDimensionMetricPayload({
        platform: input.contract.platformScope,
        formulaVersion: input.contract.formulaVersion,
        collections,
      }),
    }),
    topContent: Object.freeze([]),
    topAds: Object.freeze([]),
    topContentCount: 0,
    topAdsCount: 0,
  });
}

function buildCommerceMetricPayload(input) {
  const definitions = [
    ['net_sales_micros', 'Net sales', 'currency'],
    ['gross_sales_micros', 'Gross sales', 'currency'],
    ['recognized_revenue_micros', 'Recognized revenue', 'currency'],
    ['refund_micros', 'Refunds', 'currency'],
    ['discount_micros', 'Discounts', 'currency'],
    ['shipping_micros', 'Shipping', 'currency'],
    ['tax_micros', 'Tax', 'currency'],
    ['recognized_orders', 'Recognized orders', 'count'],
    ['provisional_orders', 'Provisional orders', 'count'],
    ['cancelled_orders', 'Cancelled orders', 'count'],
    ['failed_orders', 'Failed orders', 'count'],
    ['refunded_orders', 'Refunded orders', 'count'],
    ['quantity_total', 'Quantity', 'count'],
  ];
  return Object.freeze(Object.fromEntries(definitions.map(([key, displayName, unit], index) => {
    const current = finiteOrNull(input.current?.[key]);
    const compare = input.compare ? finiteOrNull(input.compare[key]) : null;
    const change = current === null || compare === null ? null : current - compare;
    const metricKey = `${input.platform}:${key}`;
    return [metricKey, Object.freeze({
      metricKey,
      displayName,
      unit,
      current,
      compare,
      change,
      changePercent: change === null || compare === 0 ? null : change / Math.abs(compare),
      clientVisible: true,
      sortOrder: index + 1,
      formulaVersion: input.formulaVersion,
    })];
  })));
}

function coverageRate(report) {
  return ['complete', 'no_data_confirmed'].includes(report.coverage?.status) ? 1 : null;
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError('Commerce report metric must be finite');
  return number;
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
