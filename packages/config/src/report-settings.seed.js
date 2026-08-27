const REPORT_SETTING_TEMPLATES = Object.freeze({
  integration_workspace: Object.freeze({ customerProfile: 'integration_workspace', accountKey: 'chemistry_k' }),
  chemistry_k: Object.freeze({ customerProfile: 'chemistry_k', accountKey: 'chemistry_k' }),
});

const REPORT_SETTING_PROFILE_ALIASES = Object.freeze({
  dev_ft_pumkin: 'integration_workspace',
  uat_chemistry_k: 'integration_workspace',
});

export const DASHBOARD_REPORT_TYPE = 'dashboard_performance_report';
export const DASHBOARD_REPORT_PRESET_DAYS = Object.freeze([1, 3, 7, 9, 15, 30, 90]);
export const DASHBOARD_REPORT_PLATFORM_SCOPES = Object.freeze([
  'facebook', 'instagram', 'tiktok', 'youtube', 'meta_ads', 'google_ads', 'tiktok_ads',
  'woocommerce', 'chatwoot',
]);
export const LEGACY_REPORT_SETTING_KEYS = Object.freeze([
  'dev_ft_pumkin:tiktok:daily',
  'dev_ft_pumkin:tiktok:weekly',
  'uat_chemistry_k:tiktok:daily',
  'uat_chemistry_k:tiktok:weekly',
]);

/** สร้าง Stable setting identity เดียวกับ Seed โดยไม่อ่าน Lark ระหว่าง Cron admission. */
export function createDashboardReportSettingKey(input = {}) {
  const requestedProfileKey = requireText(input.profileKey, 'profileKey');
  const profileKey = REPORT_SETTING_PROFILE_ALIASES[requestedProfileKey] ?? requestedProfileKey;
  if (!REPORT_SETTING_TEMPLATES[profileKey]) {
    throw new Error(`Unsupported report setting profile: ${requestedProfileKey}`);
  }
  const platformScope = requirePlatformScope(input.platformScope);
  const windowDays = requireWindowDays(input.windowDays);
  return `${profileKey}:${platformScope}:rolling:${windowDays}d`;
}

/** Canonical Integration Workspace Dashboard settings plus TikTok 1D/7D compatibility rows. */
export function createReportSettingRowsForProfile(profileKey) {
  const requestedProfileKey = requireText(profileKey, 'profileKey');
  const canonicalProfileKey = REPORT_SETTING_PROFILE_ALIASES[requestedProfileKey] ?? requestedProfileKey;
  const template = REPORT_SETTING_TEMPLATES[canonicalProfileKey];
  if (!template) throw new Error(`Unsupported report setting profile: ${requestedProfileKey}`);

  return Object.freeze([
    createSettingRow({
      ...template,
      platformScope: 'tiktok',
      periodKind: 'rolling_days',
      windowDays: 1,
      periodType: 'daily',
      reportType: 'daily_organic_report',
      periodIdentity: 'daily',
      reportName: 'TikTok Daily Organic',
      sendTime: '09:00',
    }),
    createSettingRow({
      ...template,
      platformScope: 'tiktok',
      periodKind: 'rolling_days',
      windowDays: 7,
      periodType: 'weekly',
      reportType: 'weekly_organic_report',
      periodIdentity: 'weekly',
      reportName: 'TikTok Weekly Organic',
      sendTime: '09:15',
      sendWeekday: 'monday',
    }),
    ...DASHBOARD_REPORT_PLATFORM_SCOPES.flatMap((platformScope) => [
      ...DASHBOARD_REPORT_PRESET_DAYS.map((windowDays) => createSettingRow({
        ...template,
        platformScope,
        periodKind: 'rolling_days',
        windowDays,
        reportName: `${displayPlatform(platformScope)} Rolling ${windowDays}D ${capabilityLabel(platformScope)}`,
      })),
      createSettingRow({
        ...template,
        platformScope,
        periodKind: 'custom_range',
        windowDays: null,
        reportName: `${displayPlatform(platformScope)} Custom Range ${capabilityLabel(platformScope)}`,
      }),
    ]),
  ]);
}

function createSettingRow(input) {
  const customerProfile = requireText(input.customerProfile, 'customerProfile');
  const accountKey = requireText(input.accountKey, 'accountKey');
  const platformScope = requirePlatformScope(input.platformScope);
  const periodKind = requirePeriodKind(input.periodKind);
  const windowDays = periodKind === 'rolling_days' ? requireWindowDays(input.windowDays) : null;
  const periodIdentity = input.periodIdentity ?? (periodKind === 'rolling_days'
    ? `rolling:${windowDays}d`
    : 'custom_range');
  return Object.freeze({
    report_setting_key: `${customerProfile}:${platformScope}:${periodIdentity}`,
    customer_profile: customerProfile,
    report_name: requireText(input.reportName, 'reportName'),
    report_type: input.reportType ?? DASHBOARD_REPORT_TYPE,
    period_type: input.periodType ?? periodKind,
    period_kind: periodKind,
    window_days: windowDays,
    platforms: Object.freeze([platformScope]),
    account_keys_json: JSON.stringify([accountKey]),
    timezone: 'Asia/Bangkok',
    utc_offset: '+07:00',
    send_time: input.sendTime ?? null,
    send_weekday: input.sendWeekday ?? null,
    comparison_mode: 'previous_period',
    language: 'th',
    top_content_limit: 5,
    top_ads_limit: 5,
    ai_enabled: false,
    notification_enabled: false,
    group_id: null,
    enabled: true,
    config_version: 'report-v3-multichannel',
  });
}

function displayPlatform(value) {
  return ({
    facebook: 'Facebook',
    instagram: 'Instagram',
    tiktok: 'TikTok',
    youtube: 'YouTube',
    meta_ads: 'Meta Ads',
    google_ads: 'Google Ads',
    tiktok_ads: 'TikTok Ads',
    woocommerce: 'WooCommerce',
    chatwoot: 'Chatwoot',
  })[value];
}
function capabilityLabel(value) {
  if (value === 'woocommerce') return 'Commerce';
  if (value === 'chatwoot') return 'Customer Service';
  return value.endsWith('_ads') ? 'Ads' : 'Organic';
}
function requirePlatformScope(value) {
  const normalized = requireText(value, 'platformScope');
  if (!DASHBOARD_REPORT_PLATFORM_SCOPES.includes(normalized)) {
    throw new TypeError(`Unsupported report platform scope: ${normalized}`);
  }
  return normalized;
}
function requirePeriodKind(value) {
  const normalized = requireText(value, 'periodKind');
  if (!['rolling_days', 'custom_range'].includes(normalized)) throw new TypeError(`Unsupported report setting periodKind: ${normalized}`);
  return normalized;
}
function requireWindowDays(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || !DASHBOARD_REPORT_PRESET_DAYS.includes(number)) {
    throw new TypeError(`Report setting windowDays must be one of ${DASHBOARD_REPORT_PRESET_DAYS.join(', ')}`);
  }
  return number;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`Report setting seed requires ${fieldName}`);
  return value.trim();
}
