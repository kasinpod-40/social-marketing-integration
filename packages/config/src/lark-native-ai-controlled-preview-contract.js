import {
  LARK_NATIVE_AI_OUTPUT_SCHEMA_VERSION,
  LARK_NATIVE_AI_PROMPT_VERSION,
  LARK_NATIVE_AI_SUPPORTED_WINDOWS,
} from './lark-native-ai-offline-contract.js';

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_CONTRACT_VERSION =
  'lark_native_ai_controlled_preview_readiness_v1';
export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_PLAN_SCHEMA_VERSION =
  'lark_native_ai_controlled_preview_plan_v1';
export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_APPROVAL_PHRASE =
  'RUN_LARK_NATIVE_AI_CONTROLLED_PREVIEW';
export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_TARGET_TABLE = '🧠 MKT_AI_Report_Runs';
export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_PROMPT_VERSION = LARK_NATIVE_AI_PROMPT_VERSION;
export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_OUTPUT_SCHEMA_VERSION =
  LARK_NATIVE_AI_OUTPUT_SCHEMA_VERSION;
export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_SUPPORTED_WINDOWS =
  LARK_NATIVE_AI_SUPPORTED_WINDOWS;

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_STATUSES = Object.freeze([
  'blocked',
  'waiting_for_remote_lock',
  'awaiting_explicit_preview_approval',
  'ready_for_controlled_preview',
]);

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_ROW_CHANNELS = Object.freeze([
  freezeRowChannel('tiktok', 'tiktok_organic', 'TikTok Organic', 'organic'),
  freezeRowChannel('facebook', 'facebook_organic', 'Facebook Organic', 'organic'),
  freezeRowChannel('instagram', 'instagram_organic', 'Instagram Organic', 'organic'),
  freezeRowChannel('youtube', 'youtube_organic', 'YouTube Organic', 'organic'),
  freezeRowChannel('meta_ads', 'meta_ads', 'Meta Ads', 'paid_ads'),
  freezeRowChannel('google_ads', 'google_ads', 'Google Ads', 'paid_ads'),
  freezeRowChannel('tiktok_ads', 'tiktok_ads', 'TikTok Ads', 'paid_ads'),
  freezeRowChannel('woocommerce', 'woocommerce', 'WooCommerce', 'commerce'),
  freezeRowChannel('chatwoot', 'chatwoot', 'Chatwoot', 'customer_service'),
]);

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_REQUIRED_LARK_FIELDS = Object.freeze([
  'report_id',
  'platforms',
  'report_type',
  'metric_summary_json',
  'insight_summary',
  'strengths',
  'weaknesses',
  'recommendations',
  'sent_to_group',
  'sent_at',
  'ai_run_key',
  'scope_type',
  'channel_key',
  'capability',
  'account_id',
  'window_days',
  'data_status',
  'readiness_status',
  'readiness_message',
  'coverage_rate',
  'source_report_ids_json',
  'source_report_checksum',
  'channel_status_vector_json',
  'severity',
  'notification_eligible',
  'notification_reason',
  'dedupe_key',
  'cooldown_until',
  'preview_mode',
  'generation_status',
  'failure_code',
  'template_version',
  'generated_at',
]);

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIMITS = Object.freeze({
  maxPromptBytes: 512_000,
  maxReferenceOutputBytes: 256_000,
  maxMetricSummaryBytesPerRow: 64_000,
  expectedRowCountPerWindow: 10,
});

export function resolveControlledPreviewRowChannel(platform) {
  const channel = LARK_NATIVE_AI_CONTROLLED_PREVIEW_ROW_CHANNELS
    .find((item) => item.platform === platform);
  if (!channel) throw new TypeError(`Unsupported controlled-preview row platform: ${platform}`);
  return channel;
}

function freezeRowChannel(platform, channelKey, displayName, capability) {
  return Object.freeze({ platform, channelKey, displayName, capability });
}
