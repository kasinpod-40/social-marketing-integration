const REPORT_SETTING_TEMPLATES = Object.freeze({
  integration_workspace: Object.freeze({
    customerProfile: 'integration_workspace',
    accountKey: 'chemistry_k',
  }),
  chemistry_k: Object.freeze({
    customerProfile: 'chemistry_k',
    accountKey: 'chemistry_k',
  }),
});

const REPORT_SETTING_PROFILE_ALIASES = Object.freeze({
  dev_ft_pumkin: 'integration_workspace',
  uat_chemistry_k: 'integration_workspace',
});

export const DASHBOARD_REPORT_TYPE = 'dashboard_performance_report';
export const DASHBOARD_REPORT_PRESET_DAYS = Object.freeze([3, 7, 9, 15, 30, 90]);
export const LEGACY_REPORT_SETTING_KEYS = Object.freeze([
  'dev_ft_pumkin:tiktok:daily',
  'dev_ft_pumkin:tiktok:weekly',
  'uat_chemistry_k:tiktok:daily',
  'uat_chemistry_k:tiktok:weekly',
]);

/**
 * สร้าง Dashboard Report settings มาตรฐานแยกตาม Canonical Customer profile
 * Historical profile labels Resolve ไปยัง Integration Workspace เพื่อไม่สร้าง Setting/Account identity เก่าเพิ่ม
 * เก็บเฉพาะค่าที่ไม่เป็นความลับ ส่วน Group ID จริงแก้ใน Lark Base ของเจ้าของทรัพยากร
 */
export function createReportSettingRowsForProfile(profileKey) {
  const requestedProfileKey = requireText(profileKey, 'profileKey');
  const canonicalProfileKey = REPORT_SETTING_PROFILE_ALIASES[requestedProfileKey] ?? requestedProfileKey;
  const template = REPORT_SETTING_TEMPLATES[canonicalProfileKey];
  if (!template) throw new Error(`Unsupported report setting profile: ${requestedProfileKey}`);

  return Object.freeze([
    // Compatibility rows คง 1D/7D job/env contract เดิมไว้ แต่ใช้ Canonical profile เท่านั้น
    createSettingRow({
      ...template,
      periodKind: 'rolling_days',
      windowDays: 1,
      periodType: 'daily',
      reportType: 'daily_organic_report',
      periodIdentity: 'daily',
      reportName: 'TikTok Daily Organic',
      sendTime: '08:10',
    }),
    createSettingRow({
      ...template,
      periodKind: 'rolling_days',
      windowDays: 7,
      periodType: 'weekly',
      reportType: 'weekly_organic_report',
      periodIdentity: 'weekly',
      reportName: 'TikTok Weekly Organic',
      sendTime: '08:15',
      sendWeekday: 'monday',
    }),
    ...DASHBOARD_REPORT_PRESET_DAYS.map((windowDays) => createSettingRow({
      ...template,
      periodKind: 'rolling_days',
      windowDays,
      reportName: `TikTok Rolling ${windowDays}D Organic`,
    })),
    createSettingRow({
      ...template,
      periodKind: 'custom_range',
      windowDays: null,
      reportName: 'TikTok Custom Range Organic',
    }),
  ]);
}

/** สร้างหนึ่งแถว Report setting พร้อม Stable key */
function createSettingRow(input) {
  const customerProfile = requireText(input.customerProfile, 'customerProfile');
  const accountKey = requireText(input.accountKey, 'accountKey');
  const periodKind = requirePeriodKind(input.periodKind);
  const windowDays = periodKind === 'rolling_days'
    ? requireWindowDays(input.windowDays)
    : null;
  const periodIdentity = input.periodIdentity ?? (periodKind === 'rolling_days'
    ? `rolling:${windowDays}d`
    : 'custom_range');

  return Object.freeze({
    report_setting_key: `${customerProfile}:tiktok:${periodIdentity}`,
    customer_profile: customerProfile,
    report_name: requireText(input.reportName, 'reportName'),
    report_type: input.reportType ?? DASHBOARD_REPORT_TYPE,
    // period_type คงไว้เป็น Compatibility field แต่ใช้ค่า Contract กลางเดียวกับ period_kind
    period_type: input.periodType ?? periodKind,
    period_kind: periodKind,
    window_days: windowDays,
    platforms: Object.freeze(['tiktok']),
    account_keys_json: JSON.stringify([accountKey]),
    timezone: 'Asia/Bangkok',
    utc_offset: '+07:00',
    send_time: input.sendTime ?? null,
    send_weekday: input.sendWeekday ?? null,
    comparison_mode: 'previous_period',
    language: 'th',
    top_content_limit: 5,
    ai_enabled: false,
    notification_enabled: false,
    group_id: null,
    enabled: true,
    config_version: 'report-v2',
  });
}

function requirePeriodKind(value) {
  const normalized = requireText(value, 'periodKind');
  if (!['rolling_days', 'custom_range'].includes(normalized)) {
    throw new TypeError(`Unsupported report setting periodKind: ${normalized}`);
  }
  return normalized;
}

function requireWindowDays(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || ![1, ...DASHBOARD_REPORT_PRESET_DAYS].includes(number)) {
    throw new TypeError(
      `Report setting windowDays must be one of ${[1, ...DASHBOARD_REPORT_PRESET_DAYS].join(', ')}`,
    );
  }
  return number;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Report setting seed requires ${fieldName}`);
  }
  return value.trim();
}
