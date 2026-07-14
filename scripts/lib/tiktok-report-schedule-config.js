import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';
import { readWranglerStringVars, updateWranglerStringVars } from './wrangler-sync-config.js';

const REQUIRED_KEYS = Object.freeze([
  'MKT_ENV',
  'MKT_CUSTOMER_PROFILE',
  'MKT_CONNECTOR_TIKTOK_ENABLED',
  'MKT_SCHEDULE_TIKTOK_ENABLED',
  'MKT_SCHEDULE_DAILY_REPORT_ENABLED',
  'MKT_SCHEDULE_WEEKLY_REPORT_ENABLED',
  'MKT_DAILY_REPORT_TIME',
  'MKT_WEEKLY_REPORT_TIME',
  'MKT_WEEKLY_REPORT_WEEKDAY',
  'MKT_DAILY_REPORT_SETTING_KEY',
  'MKT_WEEKLY_REPORT_SETTING_KEY',
  'LARK_TABLE_MKT_REPORT_SETTINGS',
  'LARK_TABLE_MKT_REPORT_SNAPSHOTS',
  'LARK_TABLE_MKT_REPORT_METRIC_VALUES',
  'LARK_TABLE_MKT_REPORT_TOP_CONTENT',
]);

const TABLE_ID_PATTERN = /^tbl[A-Za-z0-9]+$/u;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const WEEKDAYS = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);

/** ตรวจ Local DEV config ก่อนเปิด Scheduled Daily/Weekly report */
export async function planTikTokReportScheduleActivation(input = {}) {
  const filePath = input.filePath ?? 'wrangler.sync.jsonc';
  const config = await readWranglerStringVars(filePath, REQUIRED_KEYS);
  const vars = config.values;
  const conflicts = [];
  const warnings = [];

  expectValue(vars, 'MKT_ENV', 'development', conflicts);
  expectValue(vars, 'MKT_CUSTOMER_PROFILE', 'dev_ft_pumkin', conflicts);
  expectValue(vars, 'MKT_CONNECTOR_TIKTOK_ENABLED', 'true', conflicts);
  expectValue(vars, 'MKT_SCHEDULE_TIKTOK_ENABLED', 'true', conflicts);
  expectValue(vars, 'MKT_DAILY_REPORT_SETTING_KEY', 'dev_ft_pumkin:tiktok:daily', conflicts);
  expectValue(vars, 'MKT_WEEKLY_REPORT_SETTING_KEY', 'dev_ft_pumkin:tiktok:weekly', conflicts);

  for (const key of [
    'LARK_TABLE_MKT_REPORT_SETTINGS',
    'LARK_TABLE_MKT_REPORT_SNAPSHOTS',
    'LARK_TABLE_MKT_REPORT_METRIC_VALUES',
    'LARK_TABLE_MKT_REPORT_TOP_CONTENT',
  ]) {
    if (!TABLE_ID_PATTERN.test(vars[key] ?? '')) {
      conflicts.push(conflict('REPORT_TABLE_ID_INVALID', key, `ค่า ${key} ต้องเป็น Table ID จริงรูปแบบ tbl...`));
    }
  }
  for (const key of ['MKT_DAILY_REPORT_TIME', 'MKT_WEEKLY_REPORT_TIME']) {
    if (!TIME_PATTERN.test(vars[key] ?? '')) {
      conflicts.push(conflict('REPORT_TIME_INVALID', key, `${key} ต้องเป็นเวลา HH:mm`));
    }
  }
  if (!WEEKDAYS.has(vars.MKT_WEEKLY_REPORT_WEEKDAY ?? '')) {
    conflicts.push(conflict('REPORT_WEEKDAY_INVALID', 'MKT_WEEKLY_REPORT_WEEKDAY', 'วัน Weekly report ไม่ถูกต้อง'));
  }

  const actions = [];
  for (const key of ['MKT_SCHEDULE_DAILY_REPORT_ENABLED', 'MKT_SCHEDULE_WEEKLY_REPORT_ENABLED']) {
    const value = vars[key];
    if (!new Set(['true', 'false']).has(value)) {
      conflicts.push(conflict('REPORT_SCHEDULE_FLAG_INVALID', key, `${key} ต้องเป็น true หรือ false`));
    } else if (value === 'false') {
      actions.push(Object.freeze({ kind: 'set_config_var', key, from: 'false', to: 'true' }));
    }
  }

  return Object.freeze({
    mode: 'preview',
    readyToApply: conflicts.length === 0,
    configFile: filePath,
    summary: Object.freeze({
      scheduleFlagsToEnable: actions.length,
      conflicts: conflicts.length,
      warnings: warnings.length,
    }),
    schedule: Object.freeze({
      daily: Object.freeze({
        enabled: vars.MKT_SCHEDULE_DAILY_REPORT_ENABLED === 'true',
        time: vars.MKT_DAILY_REPORT_TIME,
        reportSettingKey: vars.MKT_DAILY_REPORT_SETTING_KEY,
      }),
      weekly: Object.freeze({
        enabled: vars.MKT_SCHEDULE_WEEKLY_REPORT_ENABLED === 'true',
        weekday: vars.MKT_WEEKLY_REPORT_WEEKDAY,
        time: vars.MKT_WEEKLY_REPORT_TIME,
        reportSettingKey: vars.MKT_WEEKLY_REPORT_SETTING_KEY,
      }),
    }),
    actions: Object.freeze(actions),
    conflicts: Object.freeze(conflicts),
    warnings: Object.freeze(warnings),
  });
}

export async function applyTikTokReportScheduleActivation(input = {}) {
  const filePath = input.filePath ?? 'wrangler.sync.jsonc';
  const preview = await planTikTokReportScheduleActivation({ filePath });
  if (!preview.readyToApply) {
    throw permanentError('TikTok report schedules cannot be enabled because config validation failed', {
      code: 'TIKTOK_REPORT_SCHEDULE_CONFIG_CONFLICT',
      details: { conflicts: preview.conflicts },
    });
  }

  const mutation = await updateWranglerStringVars(filePath, {
    MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'true',
    MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'true',
  });
  const verification = await planTikTokReportScheduleActivation({ filePath });
  if (!verification.readyToApply || verification.actions.length > 0) {
    throw permanentError('TikTok report schedule config apply did not verify cleanly', {
      code: 'TIKTOK_REPORT_SCHEDULE_CONFIG_VERIFICATION_FAILED',
      details: { verification },
    });
  }

  return Object.freeze({
    mode: 'apply',
    ok: true,
    configFile: filePath,
    changed: mutation.changed,
    verification,
    deployCommand: `npx wrangler deploy --config ${filePath}`,
  });
}

function expectValue(vars, key, expected, conflicts) {
  if (vars[key] !== expected) {
    conflicts.push(conflict('REPORT_SCHEDULE_PREREQUISITE_INVALID', key, `${key} ต้องเป็น ${expected}`));
  }
}

function conflict(code, key, message) {
  return Object.freeze({ code, key, message });
}
