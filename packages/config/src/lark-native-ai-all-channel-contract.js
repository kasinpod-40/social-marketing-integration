export const LARK_NATIVE_AI_CONTRACT_VERSION = 'report_to_lark_ai_v1';
export const LARK_NATIVE_AI_TEMPLATE_VERSION = 'all_channel_preview_v1';
export const LARK_NATIVE_AI_WINDOW_DAYS = Object.freeze([1, 3, 7, 30]);

export const LARK_NATIVE_AI_CHANNELS = Object.freeze([
  freezeChannel('tiktok_organic', 'TikTok Organic', 'tiktok', 'organic'),
  freezeChannel('facebook_organic', 'Facebook Organic', 'facebook', 'organic'),
  freezeChannel('instagram_organic', 'Instagram Organic', 'instagram', 'organic'),
  freezeChannel('youtube_organic', 'YouTube Organic', 'youtube', 'organic'),
  freezeChannel('meta_ads', 'Meta Ads', 'meta_ads', 'paid_ads'),
  freezeChannel('google_ads', 'Google Ads', 'google_ads', 'paid_ads'),
  freezeChannel('tiktok_ads', 'TikTok Ads', 'tiktok_ads', 'paid_ads'),
  freezeChannel('woocommerce', 'WooCommerce', 'woocommerce', 'commerce'),
  freezeChannel('chatwoot', 'Chatwoot', 'chatwoot', 'customer_service'),
]);

export const LARK_NATIVE_AI_READINESS = Object.freeze({
  report_available: freezeReadiness('มีข้อมูล Report พร้อมใช้งาน', 'info'),
  report_partial: freezeReadiness('มีข้อมูลบางส่วน ยังไม่ครบ', 'warning'),
  no_data_confirmed: freezeReadiness('ตรวจสอบแล้ว แต่ไม่มีข้อมูลในช่วงนี้', 'info'),
  source_unavailable: freezeReadiness('แหล่งข้อมูลยังไม่พร้อม', 'warning'),
  not_observed: freezeReadiness('ยังไม่มีข้อมูลสังเกตการณ์', 'info'),
  report_missing: freezeReadiness('ยังไม่มีข้อมูล Report สำหรับช่วงนี้', 'info'),
  configuration_missing: freezeReadiness('ยังไม่ได้ตั้งค่า Report สำหรับช่องทางนี้', 'warning'),
  validation_failed: freezeReadiness('ข้อมูล Report ไม่ผ่านการตรวจสอบ', 'critical'),
});

export const LARK_AI_REPORT_RUNS_ADDITIVE_FIELDS = Object.freeze([
  freezeField('ai_run_key', 'Text', true),
  freezeField('scope_type', 'SingleSelect', true, ['channel', 'executive']),
  freezeField('channel_key', 'SingleSelect', true, [
    ...LARK_NATIVE_AI_CHANNELS.map(({ channelKey }) => channelKey),
    'executive',
  ]),
  freezeField('capability', 'Text', true),
  freezeField('account_id', 'Text', false),
  freezeField('window_days', 'SingleSelect', true, LARK_NATIVE_AI_WINDOW_DAYS.map(String)),
  freezeField('data_status', 'SingleSelect', true, [
    'complete', 'partial', 'revisable', 'no_data_confirmed', 'source_unavailable', 'not_observed',
    'report_missing', 'configuration_missing', 'validation_failed',
  ]),
  freezeField('readiness_status', 'SingleSelect', true, Object.keys(LARK_NATIVE_AI_READINESS)),
  freezeField('readiness_message', 'Text', true),
  freezeField('coverage_rate', 'Number', false),
  freezeField('source_report_ids_json', 'Text', true),
  freezeField('source_report_checksum', 'Text', true),
  freezeField('channel_status_vector_json', 'Text', false),
  freezeField('severity', 'SingleSelect', true, ['info', 'warning', 'critical']),
  freezeField('notification_eligible', 'Checkbox', true),
  freezeField('notification_reason', 'Text', true),
  freezeField('dedupe_key', 'Text', true),
  freezeField('cooldown_until', 'DateTime', false),
  freezeField('preview_mode', 'Checkbox', true),
  freezeField('generation_status', 'SingleSelect', true, ['pending', 'generated', 'skipped', 'failed']),
  freezeField('failure_code', 'Text', false),
  freezeField('template_version', 'Text', true),
  freezeField('generated_at', 'DateTime', true),
]);

export const LARK_AI_REPORT_RUNS_OPTION_EXTENSIONS = Object.freeze({
  platforms: Object.freeze(['woocommerce', 'chatwoot']),
  report_type: Object.freeze(['dashboard_channel_status', 'dashboard_executive_summary']),
});

export const LARK_AI_REPORT_RUNS_PREVIEW_VIEWS = Object.freeze([
  '🌐 All Channel Readiness',
  '📊 Executive Summaries',
  '⚠️ Missing / Partial Data',
  '✅ Notification Eligible',
  '❌ AI Generation Failures',
  '🧪 Preview Runs',
]);

export function resolveLarkNativeAiChannel(channelKey) {
  const channel = LARK_NATIVE_AI_CHANNELS.find((item) => item.channelKey === channelKey);
  if (!channel) throw new TypeError(`Unsupported Lark Native AI channel: ${channelKey}`);
  return channel;
}

export function resolveLarkNativeAiReadiness(status) {
  const readiness = LARK_NATIVE_AI_READINESS[status];
  if (!readiness) throw new TypeError(`Unsupported Lark Native AI readiness status: ${status}`);
  return readiness;
}

function freezeChannel(channelKey, displayName, platform, capability) {
  return Object.freeze({ channelKey, displayName, platform, capability });
}

function freezeReadiness(message, severity) {
  return Object.freeze({ message, severity });
}

function freezeField(fieldName, fieldType, required, options = null) {
  return Object.freeze({
    fieldName,
    fieldType,
    required,
    options: options ? Object.freeze([...options]) : null,
  });
}
