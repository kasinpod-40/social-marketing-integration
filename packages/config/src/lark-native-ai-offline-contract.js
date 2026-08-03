export const LARK_NATIVE_AI_OFFLINE_CONTRACT_VERSION = 'lark_native_ai_offline_preview_v1';
export const LARK_NATIVE_AI_INPUT_SCHEMA_VERSION = 'lark_native_ai_input_bundle_v1';
export const LARK_NATIVE_AI_OUTPUT_SCHEMA_VERSION = 'lark_native_ai_output_v1';
export const LARK_NATIVE_AI_PROMPT_VERSION = 'lark_native_ai_prompt_v1';

export const LARK_NATIVE_AI_SUPPORTED_WINDOWS = Object.freeze([1, 3, 7, 30]);

export const LARK_NATIVE_AI_AVAILABILITY_STATUSES = Object.freeze([
  'complete',
  'partial',
  'unavailable',
  'no_data_confirmed',
  'source_pending',
  'coverage_incomplete',
]);

export const LARK_NATIVE_AI_COVERAGE_STATUSES = Object.freeze([
  'complete',
  'partial',
  'incomplete',
  'not_applicable',
]);

export const LARK_NATIVE_AI_FRESHNESS_STATUSES = Object.freeze([
  'fresh',
  'stale',
  'unknown',
]);

export const LARK_NATIVE_AI_SECTIONS = Object.freeze([
  freezeSection('executive_summary', 'Executive Summary', [
    'tiktok', 'youtube', 'instagram', 'facebook', 'meta_ads', 'google_ads',
    'tiktok_ads', 'woocommerce', 'chatwoot', 'operations',
  ]),
  freezeSection('organic_performance', 'Organic Performance', [
    'tiktok', 'youtube', 'instagram', 'facebook',
  ]),
  freezeSection('paid_ads_performance', 'Paid Ads Performance', [
    'meta_ads', 'google_ads', 'tiktok_ads',
  ]),
  freezeSection('commerce_conversion', 'Commerce & Conversion', ['woocommerce']),
  freezeSection('customer_service_leads', 'Customer Service & Leads', ['chatwoot']),
  freezeSection('data_quality_operations', 'Data Quality & Operations', ['operations']),
  freezeSection('recommendations', 'Recommendations', [
    'tiktok', 'youtube', 'instagram', 'facebook', 'meta_ads', 'google_ads',
    'tiktok_ads', 'woocommerce', 'chatwoot', 'operations',
  ]),
  freezeSection('warnings_missing_data', 'Warnings / Missing Data', [
    'tiktok', 'youtube', 'instagram', 'facebook', 'meta_ads', 'google_ads',
    'tiktok_ads', 'woocommerce', 'chatwoot', 'operations',
  ]),
]);

export const LARK_NATIVE_AI_CHANNELS = Object.freeze([
  freezeChannel('tiktok', 'TikTok', 'organic', 'organic_performance'),
  freezeChannel('youtube', 'YouTube', 'organic', 'organic_performance'),
  freezeChannel('instagram', 'Instagram', 'organic', 'organic_performance'),
  freezeChannel('facebook', 'Facebook', 'organic', 'organic_performance'),
  freezeChannel('meta_ads', 'Meta Ads', 'paid_ads', 'paid_ads_performance'),
  freezeChannel('google_ads', 'Google Ads', 'paid_ads', 'paid_ads_performance'),
  freezeChannel('tiktok_ads', 'TikTok Ads', 'paid_ads', 'paid_ads_performance'),
  freezeChannel('woocommerce', 'WooCommerce', 'commerce', 'commerce_conversion'),
  freezeChannel('chatwoot', 'Chatwoot', 'customer_service', 'customer_service_leads'),
  freezeChannel('operations', 'Operations', 'data_quality', 'data_quality_operations'),
]);

export const LARK_NATIVE_AI_EXECUTIVE_CHANNEL = Object.freeze({
  platform: 'executive',
  displayName: 'Executive',
  capability: 'cross_channel',
  sectionId: 'executive_summary',
});

export const LARK_NATIVE_AI_EVIDENCE_AVAILABILITY = Object.freeze([
  'available',
  'baseline_incomplete',
  'coverage_incomplete',
  'not_available',
]);

export const LARK_NATIVE_AI_RECOMMENDATION_LEVELS = Object.freeze([
  'full',
  'limited',
  'none',
]);

export function resolveLarkNativeAiOfflineChannel(platform) {
  if (platform === 'executive') return LARK_NATIVE_AI_EXECUTIVE_CHANNEL;
  const channel = LARK_NATIVE_AI_CHANNELS.find((item) => item.platform === platform);
  if (!channel) throw new TypeError(`Unsupported Lark Native AI platform: ${platform}`);
  return channel;
}

export function resolveLarkNativeAiOfflineSection(sectionId) {
  const section = LARK_NATIVE_AI_SECTIONS.find((item) => item.sectionId === sectionId);
  if (!section) throw new TypeError(`Unsupported Lark Native AI section: ${sectionId}`);
  return section;
}

function freezeChannel(platform, displayName, capability, sectionId) {
  return Object.freeze({ platform, displayName, capability, sectionId });
}

function freezeSection(sectionId, title, platforms) {
  return Object.freeze({ sectionId, title, platforms: Object.freeze(platforms) });
}
