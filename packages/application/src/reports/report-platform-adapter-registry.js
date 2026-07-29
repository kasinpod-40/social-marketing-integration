import { permanentError } from '../../../shared/src/errors/runtime-error.js';

export const REPORT_PLATFORM_CAPABILITY = Object.freeze({
  ORGANIC: 'organic',
  PAID_ADS: 'paid_ads',
  COMMERCE: 'commerce',
});

export const REPORT_SOURCE_STATUS = Object.freeze({
  ACTIVE: 'active',
  UAT_PENDING: 'uat_pending',
  PLANNED: 'planned',
});

const PLATFORM_CONTRACTS = Object.freeze({
  facebook: freezeContract({
    platformScope: 'facebook',
    capability: REPORT_PLATFORM_CAPABILITY.ORGANIC,
    sourceStatus: REPORT_SOURCE_STATUS.UAT_PENDING,
    datasetKey: 'organic_content_cumulative',
    formulaVersion: 'facebook-organic-v1',
  }),
  instagram: freezeContract({
    platformScope: 'instagram',
    capability: REPORT_PLATFORM_CAPABILITY.ORGANIC,
    sourceStatus: REPORT_SOURCE_STATUS.UAT_PENDING,
    datasetKey: 'organic_content_cumulative',
    formulaVersion: 'instagram-organic-v1',
  }),
  tiktok: freezeContract({
    platformScope: 'tiktok',
    capability: REPORT_PLATFORM_CAPABILITY.ORGANIC,
    sourceStatus: REPORT_SOURCE_STATUS.ACTIVE,
    datasetKey: 'organic_content_cumulative',
    formulaVersion: 'tiktok-organic-v1',
  }),
  youtube: freezeContract({
    platformScope: 'youtube',
    capability: REPORT_PLATFORM_CAPABILITY.ORGANIC,
    sourceStatus: REPORT_SOURCE_STATUS.ACTIVE,
    datasetKey: 'organic_content_cumulative',
    formulaVersion: 'youtube-organic-v1',
  }),
  meta_ads: freezeContract({
    platformScope: 'meta_ads',
    capability: REPORT_PLATFORM_CAPABILITY.PAID_ADS,
    sourceStatus: REPORT_SOURCE_STATUS.UAT_PENDING,
    datasetKey: 'ads_daily_facts',
    summaryReportLevel: 'account',
    rankingReportLevel: 'ad',
    formulaVersion: 'meta-ads-v1',
  }),
  google_ads: freezeContract({
    platformScope: 'google_ads',
    capability: REPORT_PLATFORM_CAPABILITY.PAID_ADS,
    sourceStatus: REPORT_SOURCE_STATUS.UAT_PENDING,
    datasetKey: 'ads_daily_facts',
    summaryReportLevel: 'account',
    rankingReportLevel: 'ad',
    formulaVersion: 'google-ads-v1',
  }),
  tiktok_ads: freezeContract({
    platformScope: 'tiktok_ads',
    capability: REPORT_PLATFORM_CAPABILITY.PAID_ADS,
    sourceStatus: REPORT_SOURCE_STATUS.PLANNED,
    datasetKey: 'ads_daily_facts',
    summaryReportLevel: 'account',
    rankingReportLevel: 'ad',
    formulaVersion: 'tiktok-ads-v1',
  }),
  woocommerce: freezeContract({
    platformScope: 'woocommerce',
    capability: REPORT_PLATFORM_CAPABILITY.COMMERCE,
    sourceStatus: REPORT_SOURCE_STATUS.ACTIVE,
    datasetKey: 'commerce_daily_sales_facts',
    formulaVersion: 'woocommerce-commerce-v1',
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
  return Object.freeze({
    ...value,
    breakdownKey: value.breakdownKey ?? 'none',
    segmentKey: value.segmentKey ?? 'none',
  });
}
