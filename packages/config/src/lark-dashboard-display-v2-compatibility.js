export const LARK_DASHBOARD_DISPLAY_V2_COMPATIBILITY_VERSION =
  'lark_dashboard_display_v2_compatibility_v1';

export const LARK_DASHBOARD_DISPLAY_V2_FIELD = Object.freeze({
  fieldId: 'fldHNUhCfl',
  fieldName: '__mkt_legacy_display_name_single_select_v2',
  type: 3,
});

export const TIKTOK_ORGANIC_DASHBOARD_WINDOWS = Object.freeze([1, 3, 7, 30]);

export const TIKTOK_ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_KEY = deepFreeze({
  'tiktok:period_views': 'Views',
  'tiktok:period_likes': 'Likes',
  'tiktok:period_comments': 'Comments',
  'tiktok:period_shares': 'Shares',
  'tiktok:period_engagement': 'Engagement',
  'tiktok:period_engagement_rate': 'Engagement rate',
  'tiktok:latest_total_views': 'Latest total views',
  'tiktok:latest_total_likes': 'Latest total likes',
  'tiktok:latest_total_comments': 'Latest total comments',
  'tiktok:latest_total_shares': 'Latest total shares',
  'tiktok:latest_total_engagement': 'Latest total engagement',
  'tiktok:latest_engagement_rate': 'Latest engagement rate',
  'tiktok:new_content_count': 'New content',
  'tiktok:tracked_content_count': 'Tracked content',
  'tiktok:baseline_covered_content_count': 'Baseline coverage',
  'tiktok:baseline_missing_content_count': 'Baseline Missing Content',
  'tiktok:baseline_coverage_rate': 'Baseline Coverage Rate',
});

export const TIKTOK_ORGANIC_DASHBOARD_DISPLAY_V2_REVIEWED_ALIASES = deepFreeze({
  'tiktok:baseline_coverage_rate': Object.freeze(['Baseline coverage']),
});

export const TIKTOK_ORGANIC_DASHBOARD_METRIC_KEYS = Object.freeze(
  Object.keys(TIKTOK_ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_KEY),
);

export const TIKTOK_ORGANIC_DASHBOARD_DISPLAY_V2_OPTIONS = Object.freeze(
  [...new Set(Object.values(TIKTOK_ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_KEY))],
);

export function resolveTikTokOrganicDashboardDisplayV2(input = {}) {
  if (normalizeText(input.customerProfile) !== 'integration_workspace') return null;
  if (normalizeText(input.accountId) !== 'chemistry_k') return null;
  if (normalizeText(input.platform) !== 'tiktok') return null;
  if (normalizeText(input.capability) !== 'organic') return null;
  if (normalizeText(input.reportType) !== 'dashboard_performance_report') return null;
  return resolveTikTokOrganicDashboardDisplayV2ByMetricKey(input.metricKey);
}

export function resolveTikTokOrganicDashboardDisplayV2ByMetricKey(metricKey) {
  return TIKTOK_ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_KEY[
    normalizeText(metricKey)
  ] ?? null;
}

export function isReviewedTikTokOrganicDashboardDisplayV2Alias(input = {}) {
  const aliases = TIKTOK_ORGANIC_DASHBOARD_DISPLAY_V2_REVIEWED_ALIASES[
    normalizeText(input.metricKey)
  ] ?? [];
  return aliases.includes(normalizeText(input.value));
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
