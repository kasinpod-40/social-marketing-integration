import { permanentError } from '../../shared/src/errors/runtime-error.js';

export const STORAGE_FEATURE_FLAG_ENV = Object.freeze({
  timeSeriesD1WriteEnabled: 'MKT_TIME_SERIES_D1_WRITE_ENABLED',
  timeSeriesD1BackfillEnabled: 'MKT_TIME_SERIES_D1_BACKFILL_ENABLED',
  reportD1ShadowReadEnabled: 'MKT_REPORT_D1_SHADOW_READ_ENABLED',
  reportD1ReadEnabled: 'MKT_REPORT_D1_READ_ENABLED',
  reportPresetMaterializationEnabled: 'MKT_REPORT_PRESET_MATERIALIZATION_ENABLED',
  larkDailyRetentionEnabled: 'MKT_LARK_DAILY_RETENTION_ENABLED',
  notificationRuntimeEnabled: 'MKT_NOTIFICATION_RUNTIME_ENABLED',
});

/** อ่าน Storage migration flags แบบ Fail-closed; ค่าที่ไม่ระบุเป็น false ทุกตัว */
export function readStorageRuntimeConfig(env = {}) {
  const flags = Object.fromEntries(Object.entries(STORAGE_FEATURE_FLAG_ENV).map(([key, envName]) => [
    key,
    readBoolean(env?.[envName], envName),
  ]));

  if (flags.timeSeriesD1BackfillEnabled && !flags.timeSeriesD1WriteEnabled) {
    throw permanentError(
      'MKT_TIME_SERIES_D1_BACKFILL_ENABLED requires MKT_TIME_SERIES_D1_WRITE_ENABLED',
      {
        code: 'MKT_STORAGE_RUNTIME_CONFIG_INVALID',
        details: { fieldName: STORAGE_FEATURE_FLAG_ENV.timeSeriesD1BackfillEnabled },
      },
    );
  }

  // Retention ห้ามเปิดก่อน D1 Reader cutover แม้ Environment ถูกตั้งผิดโดยไม่ตั้งใจ
  if (flags.larkDailyRetentionEnabled && !flags.reportD1ReadEnabled) {
    throw permanentError(
      'MKT_LARK_DAILY_RETENTION_ENABLED requires MKT_REPORT_D1_READ_ENABLED',
      {
        code: 'MKT_STORAGE_RUNTIME_CONFIG_INVALID',
        details: { fieldName: STORAGE_FEATURE_FLAG_ENV.larkDailyRetentionEnabled },
      },
    );
  }

  return Object.freeze(flags);
}

function readBoolean(value, fieldName) {
  if (value === undefined || value === null || value === '') return false;
  if (value === true || value === false) return value;
  if (typeof value !== 'string') {
    throw invalidBoolean(fieldName);
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw invalidBoolean(fieldName);
}

function invalidBoolean(fieldName) {
  return permanentError(`${fieldName} must be true or false`, {
    code: 'MKT_STORAGE_RUNTIME_CONFIG_INVALID',
    details: { fieldName },
  });
}
