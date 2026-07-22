const REPORT_SETTING_TEMPLATES = Object.freeze({
  integration_workspace: Object.freeze({
    customerProfile: 'integration_workspace',
    accountKey: 'ft_pumkin',
  }),
  chemistry_k: Object.freeze({
    customerProfile: 'chemistry_k',
    accountKey: 'chemistry_k',
  }),
});

/**
 * สร้าง Report settings มาตรฐานแยกตาม Customer profile
 * เก็บเฉพาะค่าที่ไม่เป็นความลับ ส่วน Group ID จริงแก้ใน Lark Base ของเจ้าของทรัพยากร
 */
export function createReportSettingRowsForProfile(profileKey) {
  const template = REPORT_SETTING_TEMPLATES[requireText(profileKey, 'profileKey')];
  if (!template) throw new Error(`Unsupported report setting profile: ${profileKey}`);

  return Object.freeze([
    createSettingRow({
      ...template,
      periodType: 'daily',
      reportType: 'daily_organic_report',
      reportName: 'TikTok Daily Organic',
      sendTime: '08:10',
      sendWeekday: null,
    }),
    createSettingRow({
      ...template,
      periodType: 'weekly',
      reportType: 'weekly_organic_report',
      reportName: 'TikTok Weekly Organic',
      sendTime: '08:15',
      sendWeekday: 'monday',
    }),
  ]);
}

/** สร้างหนึ่งแถว Report setting พร้อม Stable key */
function createSettingRow(input) {
  const customerProfile = requireText(input.customerProfile, 'customerProfile');
  const accountKey = requireText(input.accountKey, 'accountKey');
  const periodType = requireText(input.periodType, 'periodType');

  return Object.freeze({
    report_setting_key: `${customerProfile}:tiktok:${periodType}`,
    customer_profile: customerProfile,
    report_name: requireText(input.reportName, 'reportName'),
    report_type: requireText(input.reportType, 'reportType'),
    period_type: periodType,
    platforms: Object.freeze(['tiktok']),
    account_keys_json: JSON.stringify([accountKey]),
    timezone: 'Asia/Bangkok',
    utc_offset: '+07:00',
    send_time: requireText(input.sendTime, 'sendTime'),
    send_weekday: input.sendWeekday,
    comparison_mode: 'previous_period',
    language: 'th',
    top_content_limit: 5,
    ai_enabled: false,
    notification_enabled: false,
    group_id: null,
    enabled: true,
    config_version: 'report-v1',
  });
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Report setting seed requires ${fieldName}`);
  }
  return value.trim();
}
