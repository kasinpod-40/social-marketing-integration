import { permanentError } from '../../../shared/src/errors/runtime-error.js';

export const REPORT_PLATFORM_CAPABILITY = Object.freeze({
  ORGANIC: 'organic',
  PAID_ADS: 'paid_ads',
  COMMERCE: 'commerce',
  CUSTOMER_SERVICE: 'customer_service',
});

export const REPORT_SOURCE_STATUS = Object.freeze({
  ACTIVE: 'active',
  UAT_PENDING: 'uat_pending',
  PLANNED: 'planned',
});

export const ORGANIC_READINESS_MODE = Object.freeze({
  CONTENT: 'content',
  ACCOUNT_OR_CONTENT: 'account_or_content',
});

const PLATFORM_CONTRACTS = Object.freeze({
  facebook: freezeContract({
    platformScope: 'facebook',
    capability: REPORT_PLATFORM_CAPABILITY.ORGANIC,
    sourceStatus: REPORT_SOURCE_STATUS.ACTIVE,
    datasetKey: 'facebook.content.cumulative',
    coverageDatasetKeys: ['facebook.content.cumulative'],
    accountDailyDatasetKey: 'facebook.account.daily',
    organicReadinessMode: ORGANIC_READINESS_MODE.ACCOUNT_OR_CONTENT,
    formulaVersion: 'facebook-organic-v1',
  }),
  instagram: freezeContract({
    platformScope: 'instagram',
    capability: REPORT_PLATFORM_CAPABILITY.ORGANIC,
    sourceStatus: REPORT_SOURCE_STATUS.ACTIVE,
    datasetKey: 'instagram.content.cumulative',
    coverageDatasetKeys: ['instagram.content.cumulative'],
    accountDailyDatasetKey: 'instagram.account.daily',
    organicReadinessMode: ORGANIC_READINESS_MODE.CONTENT,
    formulaVersion: 'instagram-organic-v1',
  }),
  tiktok: freezeContract({
    platformScope: 'tiktok',
    capability: REPORT_PLATFORM_CAPABILITY.ORGANIC,
    sourceStatus: REPORT_SOURCE_STATUS.ACTIVE,
    datasetKey: 'organic_content_cumulative',
    coverageDatasetKeys: ['organic_content_cumulative'],
    organicReadinessMode: ORGANIC_READINESS_MODE.CONTENT,
    formulaVersion: 'tiktok-organic-v1',
  }),
  youtube: freezeContract({
    platformScope: 'youtube',
    capability: REPORT_PLATFORM_CAPABILITY.ORGANIC,
    sourceStatus: REPORT_SOURCE_STATUS.ACTIVE,
    datasetKey: 'organic_content_cumulative',
    coverageDatasetKeys: ['organic_content_cumulative'],
    organicReadinessMode: ORGANIC_READINESS_MODE.CONTENT,
    formulaVersion: 'youtube-organic-v1',
  }),
  meta_ads: freezeContract({
    platformScope: 'meta_ads',
    capability: REPORT_PLATFORM_CAPABILITY.PAID_ADS,
    sourceStatus: REPORT_SOURCE_STATUS.ACTIVE,
    datasetKey: 'meta_ads.performance.daily',
    coverageDatasetKeys: ['meta_ads.performance.daily'],
    summaryReportLevels: ['ad'],
    rankingReportLevels: ['ad'],
    summaryBreakdownFamily: 'publisher_platform',
    summarySegmentFamily: 'none',
    rankingBreakdownFamily: 'publisher_platform',
    rankingSegmentFamily: 'none',
    topAdsRequired: true,
    formulaVersion: 'meta-ads-v1',
  }),
  google_ads: freezeContract({
    platformScope: 'google_ads',
    capability: REPORT_PLATFORM_CAPABILITY.PAID_ADS,
    sourceStatus: REPORT_SOURCE_STATUS.ACTIVE,
    datasetKey: 'campaignDailyMetrics',
    coverageDatasetKeys: ['campaignDailyMetrics'],
    summaryReportLevels: ['campaign'],
    rankingReportLevels: [],
    summaryBreakdownFamily: 'all',
    summarySegmentFamily: 'all',
    rankingBreakdownFamily: null,
    rankingSegmentFamily: null,
    topAdsRequired: false,
    formulaVersion: 'google-ads-v1',
  }),
  tiktok_ads: freezeContract({
    platformScope: 'tiktok_ads',
    capability: REPORT_PLATFORM_CAPABILITY.PAID_ADS,
    sourceStatus: REPORT_SOURCE_STATUS.PLANNED,
    datasetKey: 'ads_daily_facts',
    coverageDatasetKeys: ['ads_daily_facts'],
    summaryReportLevels: ['account'],
    rankingReportLevels: ['ad'],
    summaryBreakdownFamily: 'none',
    summarySegmentFamily: 'none',
    rankingBreakdownFamily: 'none',
    rankingSegmentFamily: 'none',
    topAdsRequired: true,
    formulaVersion: 'tiktok-ads-v1',
  }),
  woocommerce: freezeContract({
    platformScope: 'woocommerce',
    capability: REPORT_PLATFORM_CAPABILITY.COMMERCE,
    sourceStatus: REPORT_SOURCE_STATUS.ACTIVE,
    datasetKey: 'commerce_daily_sales_facts',
    coverageDatasetKeys: ['woocommerce_orders'],
    formulaVersion: 'woocommerce-commerce-v1',
  }),
  chatwoot: freezeContract({
    platformScope: 'chatwoot',
    capability: REPORT_PLATFORM_CAPABILITY.CUSTOMER_SERVICE,
    sourceStatus: REPORT_SOURCE_STATUS.ACTIVE,
    datasetKey: 'chatwoot.conversation_daily',
    coverageDatasetKeys: ['chatwoot.conversation_daily', 'chatwoot.account.daily'],
    requiredCoverageDatasetKeys: ['chatwoot.conversation.daily', 'chatwoot.account.daily'],
    formulaVersion: 'chatwoot-customer-service-v1',
  }),
});

/** Return the immutable report-source contract without assuming that an adapter is runnable. */
export function getReportPlatformContract(platformScope) {
  const key = normalizePlatformScope(platformScope);
  const contract = PLATFORM_CONTRACTS[key];
  if (!contract) {
    throw permanentError(`Unsupported Dashboard report platform scope: ${key}`, {
      code: 'DASHBOARD_REPORT_PLATFORM_UNSUPPORTED',
      details: { platformScope: key },
    });
  }
  return contract;
}

export function listReportPlatformContracts() {
  return Object.freeze(Object.values(PLATFORM_CONTRACTS));
}

/**
 * Generic adapter registry. Shared code knows only load(); provider-specific construction stays
 * at the Worker composition boundary.
 */
export function createReportPlatformAdapterRegistry(input = {}) {
  const adapters = input.adapters ?? {};
  const normalized = Object.fromEntries(Object.entries(adapters).map(([key, adapter]) => {
    const contract = getReportPlatformContract(key);
    if (typeof adapter?.load !== 'function') {
      throw new TypeError(`Report platform adapter ${contract.platformScope} requires load()`);
    }
    return [contract.platformScope, Object.freeze({ contract, adapter })];
  }));

  return Object.freeze({
    get(platformScope) {
      const contract = getReportPlatformContract(platformScope);
      const registered = normalized[contract.platformScope] ?? null;
      return Object.freeze({ contract, adapter: registered?.adapter ?? null });
    },
    list() {
      return Object.freeze(listReportPlatformContracts().map((contract) => Object.freeze({
        ...contract,
        adapterRegistered: Boolean(normalized[contract.platformScope]),
      })));
    },
  });
}

export function reportSourceUnavailable(contract, reasonCode = null) {
  return Object.freeze({
    platformScope: contract.platformScope,
    capability: contract.capability,
    sourceStatus: contract.sourceStatus,
    dataStatus: 'source_unavailable',
    reasonCode: reasonCode ?? (contract.sourceStatus === REPORT_SOURCE_STATUS.PLANNED
      ? 'REPORT_SOURCE_PLANNED'
      : 'REPORT_SOURCE_UAT_PENDING'),
  });
}

function normalizePlatformScope(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw permanentError('Dashboard report platformScope is required', {
      code: 'DASHBOARD_REPORT_PLATFORM_UNSUPPORTED',
    });
  }
  return value.trim().toLowerCase();
}

function freezeContract(value) {
  const coverageDatasetKeys = freezeTextList(
    value.coverageDatasetKeys ?? [value.datasetKey],
    'coverageDatasetKeys',
  );
  const requiredCoverageDatasetKeys = freezeTextList(
    value.requiredCoverageDatasetKeys ?? coverageDatasetKeys,
    'requiredCoverageDatasetKeys',
  );
  const summaryReportLevels = freezeTextList(
    value.summaryReportLevels
      ?? (value.summaryReportLevel ? [value.summaryReportLevel] : []),
    'summaryReportLevels',
  );
  const rankingReportLevels = freezeTextList(
    value.rankingReportLevels
      ?? (value.rankingReportLevel ? [value.rankingReportLevel] : []),
    'rankingReportLevels',
  );
  return Object.freeze({
    ...value,
    coverageDatasetKeys,
    requiredCoverageDatasetKeys,
    summaryReportLevels,
    rankingReportLevels,
    summaryReportLevel: summaryReportLevels[0] ?? null,
    rankingReportLevel: rankingReportLevels[0] ?? null,
    organicReadinessMode: value.organicReadinessMode ?? ORGANIC_READINESS_MODE.CONTENT,
    accountDailyDatasetKey: value.accountDailyDatasetKey ?? null,
    summaryBreakdownFamily: value.summaryBreakdownFamily ?? value.breakdownKey ?? 'none',
    summarySegmentFamily: value.summarySegmentFamily ?? value.segmentKey ?? 'none',
    rankingBreakdownFamily: value.rankingBreakdownFamily
      ?? value.summaryBreakdownFamily
      ?? value.breakdownKey
      ?? 'none',
    rankingSegmentFamily: value.rankingSegmentFamily
      ?? value.summarySegmentFamily
      ?? value.segmentKey
      ?? 'none',
    breakdownKey: value.breakdownKey ?? 'none',
    segmentKey: value.segmentKey ?? 'none',
    topAdsRequired: value.topAdsRequired === true,
  });
}

function freezeTextList(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  const normalized = value.map((item) => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new TypeError(`${fieldName} must contain non-empty strings`);
    }
    return item.trim();
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError(`${fieldName} must not contain duplicates`);
  }
  return Object.freeze(normalized);
}

