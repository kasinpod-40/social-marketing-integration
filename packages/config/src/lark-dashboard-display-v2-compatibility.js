export const LARK_DASHBOARD_DISPLAY_V2_COMPATIBILITY_VERSION =
  'lark_dashboard_display_v2_compatibility_v4';

export const LARK_DASHBOARD_DISPLAY_V2_FIELD = Object.freeze({
  fieldId: 'fldHNUhCfl',
  fieldName: '__mkt_legacy_display_name_single_select_v2',
  type: 3,
});

export const ORGANIC_DASHBOARD_WINDOWS = Object.freeze([1, 3, 7, 30]);
export const ORGANIC_DASHBOARD_PLATFORMS = Object.freeze([
  'facebook',
  'instagram',
  'tiktok',
  'youtube',
]);
export const ORGANIC_DASHBOARD_CUSTOMER_PROFILES = Object.freeze([
  'integration_workspace',
  'chemistry_k',
]);

export const ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_SUFFIX = deepFreeze({
  period_views: 'Views',
  period_likes: 'Likes',
  period_comments: 'Comments',
  period_shares: 'Shares',
  period_engagement: 'Engagement',
  period_engagement_rate: 'Engagement rate',
  latest_total_views: 'Latest total views',
  latest_total_likes: 'Latest total likes',
  latest_total_comments: 'Latest total comments',
  latest_total_shares: 'Latest total shares',
  latest_total_engagement: 'Latest total engagement',
  latest_engagement_rate: 'Latest engagement rate',
  new_content_count: 'New content',
  tracked_content_count: 'Tracked content',
  baseline_covered_content_count: 'Baseline coverage',
  baseline_missing_content_count: 'Baseline Missing Content',
  baseline_coverage_rate: 'Baseline Coverage Rate',
});

export const ORGANIC_DASHBOARD_METRIC_SUFFIXES = Object.freeze(
  Object.keys(ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_SUFFIX),
);

export const ORGANIC_DASHBOARD_DISPLAY_V2_OPTIONS = Object.freeze(
  [...new Set(Object.values(ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_SUFFIX))],
);

export const ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_KEY = deepFreeze(
  Object.fromEntries(ORGANIC_DASHBOARD_PLATFORMS.flatMap((platform) => (
    ORGANIC_DASHBOARD_METRIC_SUFFIXES.map((suffix) => [
      `${platform}:${suffix}`,
      ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_SUFFIX[suffix],
    ])
  ))),
);

const REVIEWED_DISPLAY_V2_ALIASES = deepFreeze({
  'tiktok:baseline_coverage_rate': Object.freeze(['Baseline coverage']),
});

/**
 * Display-v2 is a presentation compatibility field for the reviewed Integration Workspace and
 * Chemistry K Customer Production Organic dashboards. Source account identity is intentionally
 * not part of this presentation scope:
 * Facebook/Instagram/YouTube may use provider-native account IDs while customer_profile remains
 * the stable workspace boundary. Using accountId here caused valid current-slot rows to lose the
 * legacy Dashboard selector when a connector exposed its real source account identity.
 */
export function resolveOrganicDashboardDisplayV2(input = {}) {
  const platform = normalizeText(input.platform);
  if (!ORGANIC_DASHBOARD_CUSTOMER_PROFILES.includes(normalizeText(input.customerProfile))) {
    return null;
  }
  if (!ORGANIC_DASHBOARD_PLATFORMS.includes(platform)) return null;
  if (normalizeText(input.capability) !== 'organic') return null;
  if (normalizeText(input.reportType) !== 'dashboard_performance_report') return null;
  return resolveOrganicDashboardDisplayV2ByMetricKey(input.metricKey, platform);
}

export function resolveOrganicDashboardDisplayV2ByMetricKey(metricKey, expectedPlatform = null) {
  const normalizedMetricKey = normalizeText(metricKey);
  const splitAt = normalizedMetricKey.indexOf(':');
  if (splitAt <= 0) return null;
  const platform = normalizedMetricKey.slice(0, splitAt);
  const suffix = normalizedMetricKey.slice(splitAt + 1);
  if (!ORGANIC_DASHBOARD_PLATFORMS.includes(platform)) return null;
  if (expectedPlatform !== null && normalizeText(expectedPlatform) !== platform) return null;
  return ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_SUFFIX[suffix] ?? null;
}

export function isReviewedOrganicDashboardDisplayV2Alias(input = {}) {
  const aliases = REVIEWED_DISPLAY_V2_ALIASES[normalizeText(input.metricKey)] ?? [];
  return aliases.includes(normalizeText(input.value));
}

// Backward-compatible exports retained for the historical TikTok-only contract and tests.
export const TIKTOK_ORGANIC_DASHBOARD_WINDOWS = ORGANIC_DASHBOARD_WINDOWS;
export const TIKTOK_ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_KEY = deepFreeze(
  Object.fromEntries(ORGANIC_DASHBOARD_METRIC_SUFFIXES.map((suffix) => [
    `tiktok:${suffix}`,
    ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_SUFFIX[suffix],
  ])),
);
export const TIKTOK_ORGANIC_DASHBOARD_DISPLAY_V2_REVIEWED_ALIASES = deepFreeze({
  'tiktok:baseline_coverage_rate': Object.freeze(['Baseline coverage']),
});
export const TIKTOK_ORGANIC_DASHBOARD_METRIC_KEYS = Object.freeze(
  Object.keys(TIKTOK_ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_KEY),
);
export const TIKTOK_ORGANIC_DASHBOARD_DISPLAY_V2_OPTIONS = ORGANIC_DASHBOARD_DISPLAY_V2_OPTIONS;

export function resolveTikTokOrganicDashboardDisplayV2(input = {}) {
  if (normalizeText(input.platform) !== 'tiktok') return null;
  return resolveOrganicDashboardDisplayV2(input);
}

export function resolveTikTokOrganicDashboardDisplayV2ByMetricKey(metricKey) {
  return resolveOrganicDashboardDisplayV2ByMetricKey(metricKey, 'tiktok');
}

export function isReviewedTikTokOrganicDashboardDisplayV2Alias(input = {}) {
  return isReviewedOrganicDashboardDisplayV2Alias(input);
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
