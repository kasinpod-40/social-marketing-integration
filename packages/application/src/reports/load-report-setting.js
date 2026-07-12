import {
  readLarkNumber,
  readLarkText,
} from '../../../connectors/src/shared/lark-cell-value.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const SUPPORTED_REPORT_TYPES = new Set(['daily_organic_report', 'weekly_organic_report']);
const SUPPORTED_COMPARISON_MODES = new Set(['none', 'previous_period']);
const SUPPORTED_LANGUAGES = new Set(['th', 'en']);

/** โหลด Report setting หนึ่งรายการด้วย Stable key และปฏิเสธ Duplicate/ข้าม Customer profile */
export async function loadReportSetting(input = {}) {
  const repository = requireRepository(input.repository);
  const tableId = requireText(input.tableId, 'tableId');
  const reportSettingKey = requireText(input.reportSettingKey, 'reportSettingKey');
  const expectedProfile = requireText(input.customerProfile, 'customerProfile');
  const records = await repository.listByFieldValues(
    tableId,
    'report_setting_key',
    [reportSettingKey],
  );

  if (records.length === 0) {
    throw permanentError(`Report setting not found: ${reportSettingKey}`, {
      code: 'REPORT_SETTING_NOT_FOUND',
      details: { reportSettingKey },
    });
  }
  if (records.length > 1) {
    throw permanentError(`Duplicate report setting key: ${reportSettingKey}`, {
      code: 'REPORT_SETTING_DUPLICATE',
      details: { reportSettingKey, rows: records.length },
    });
  }

  const setting = normalizeReportSettingRecord(records[0]);
  if (setting.customerProfile !== expectedProfile) {
    throw permanentError(
      `Report setting ${reportSettingKey} belongs to ${setting.customerProfile}, not ${expectedProfile}`,
      {
        code: 'REPORT_SETTING_PROFILE_MISMATCH',
        details: { reportSettingKey, expectedProfile, actualProfile: setting.customerProfile },
      },
    );
  }
  if (!setting.enabled && input.allowDisabled !== true) {
    throw permanentError(`Report setting is disabled: ${reportSettingKey}`, {
      code: 'REPORT_SETTING_DISABLED',
      details: { reportSettingKey },
    });
  }
  return setting;
}

/** Normalize Lark row ให้เป็น Report setting contract ที่ Runtime ใช้ */
export function normalizeReportSettingRecord(record) {
  const fields = record?.fields;
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
    throw permanentError('Report setting record requires fields object', {
      code: 'REPORT_SETTING_INVALID',
    });
  }

  const reportType = requireOption(
    readLarkText(fields.report_type, { allowNull: false, label: 'report_type' }),
    SUPPORTED_REPORT_TYPES,
    'report_type',
  );
  const comparisonMode = requireOption(
    readLarkText(fields.comparison_mode, { allowNull: false, label: 'comparison_mode' }),
    SUPPORTED_COMPARISON_MODES,
    'comparison_mode',
  );
  const language = requireOption(
    readLarkText(fields.language, { allowNull: false, label: 'language' }),
    SUPPORTED_LANGUAGES,
    'language',
  );
  const platforms = readTextList(fields.platforms);
  if (!platforms.includes('tiktok')) {
    throw permanentError('TikTok report setting must include platform=tiktok', {
      code: 'REPORT_SETTING_INVALID',
      details: { fieldName: 'platforms', platforms },
    });
  }
  const accountKeys = parseTextArray(
    readLarkText(fields.account_keys_json, { allowNull: false, label: 'account_keys_json' }),
    'account_keys_json',
  );
  if (accountKeys.length !== 1) {
    throw permanentError('TikTok Organic report v1 requires exactly one account key', {
      code: 'REPORT_SETTING_INVALID',
      details: { fieldName: 'account_keys_json', accountKeys },
    });
  }

  return Object.freeze({
    recordId: optionalText(record?.recordId ?? record?.record_id),
    reportSettingKey: readLarkText(fields.report_setting_key, {
      allowNull: false,
      label: 'report_setting_key',
    }),
    customerProfile: readLarkText(fields.customer_profile, {
      allowNull: false,
      label: 'customer_profile',
    }),
    reportName: readLarkText(fields.report_name, { allowNull: false, label: 'report_name' }),
    reportType,
    periodType: readLarkText(fields.period_type, { allowNull: false, label: 'period_type' }),
    platforms: Object.freeze(platforms),
    accountKeys: Object.freeze(accountKeys),
    timeZone: readLarkText(fields.timezone, { allowNull: false, label: 'timezone' }),
    utcOffset: readLarkText(fields.utc_offset, { allowNull: false, label: 'utc_offset' }),
    sendTime: readLarkText(fields.send_time, { allowNull: false, label: 'send_time' }),
    sendWeekday: readLarkText(fields.send_weekday, { label: 'send_weekday' }),
    comparisonMode,
    language,
    topContentLimit: positiveInteger(
      readLarkNumber(fields.top_content_limit, { allowNull: false, label: 'top_content_limit' }),
      'top_content_limit',
    ),
    aiEnabled: readCheckbox(fields.ai_enabled, 'ai_enabled'),
    notificationEnabled: readCheckbox(fields.notification_enabled, 'notification_enabled'),
    groupId: readLarkText(fields.group_id, { label: 'group_id' }),
    enabled: readCheckbox(fields.enabled, 'enabled'),
    configVersion: readLarkText(fields.config_version, {
      allowNull: false,
      label: 'config_version',
    }),
  });
}

function readTextList(value) {
  const text = readLarkText(value, { allowNull: true, separator: ',' });
  if (!text) return [];
  return [...new Set(text.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean))].sort();
}

function parseTextArray(value, fieldName) {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error('not array');
    const normalized = parsed.map((item) => requireText(item, fieldName));
    if (normalized.length === 0) throw new Error('empty array');
    return [...new Set(normalized)];
  } catch (error) {
    if (error?.code === 'REPORT_SETTING_INVALID') throw error;
    throw permanentError(`${fieldName} must be a non-empty JSON string array`, {
      code: 'REPORT_SETTING_INVALID',
      details: { fieldName },
    });
  }
}

function readCheckbox(value, fieldName) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const text = readLarkText(value, { allowNull: true, label: fieldName });
  if (text === null) return false;
  const normalized = text.trim().toLowerCase();
  if (['true', '1', 'yes', 'checked'].includes(normalized)) return true;
  if (['false', '0', 'no', 'unchecked'].includes(normalized)) return false;
  throw permanentError(`${fieldName} must be a checkbox value`, {
    code: 'REPORT_SETTING_INVALID',
    details: { fieldName },
  });
}

function requireOption(value, allowed, fieldName) {
  const text = requireText(value, fieldName);
  if (!allowed.has(text)) {
    throw permanentError(`Unsupported ${fieldName}: ${text}`, {
      code: 'REPORT_SETTING_INVALID',
      details: { fieldName, value: text },
    });
  }
  return text;
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > 100) {
    throw permanentError(`${fieldName} must be an integer between 1 and 100`, {
      code: 'REPORT_SETTING_INVALID',
      details: { fieldName, value },
    });
  }
  return number;
}

function requireRepository(repository) {
  if (typeof repository?.listByFieldValues !== 'function') {
    throw new TypeError('loadReportSetting requires repository.listByFieldValues');
  }
  return repository;
}

function optionalText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw permanentError(`Report setting requires ${fieldName}`, {
      code: 'REPORT_SETTING_INVALID',
      details: { fieldName },
    });
  }
  return value.trim();
}
