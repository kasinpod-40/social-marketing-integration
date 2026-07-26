import { permanentError } from '../../shared/src/errors/runtime-error.js';

export const TIKTOK_POST_LARK_FLAG_ENV = Object.freeze({
  watermarkAdmissionEnabled: 'MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED',
  postProcessReportEnabled: 'MKT_TIKTOK_POST_PROCESS_REPORT_ENABLED',
});

export function readTikTokPostLarkRuntimeConfig(env = {}) {
  const watermarkAdmissionEnabled = readBoolean(
    env?.[TIKTOK_POST_LARK_FLAG_ENV.watermarkAdmissionEnabled],
    TIKTOK_POST_LARK_FLAG_ENV.watermarkAdmissionEnabled,
  );
  const postProcessReportEnabled = readBoolean(
    env?.[TIKTOK_POST_LARK_FLAG_ENV.postProcessReportEnabled],
    TIKTOK_POST_LARK_FLAG_ENV.postProcessReportEnabled,
  );
  if (postProcessReportEnabled && !watermarkAdmissionEnabled) {
    throw invalidConfig(
      'MKT_TIKTOK_POST_PROCESS_REPORT_ENABLED requires MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED',
      TIKTOK_POST_LARK_FLAG_ENV.postProcessReportEnabled,
    );
  }
  return Object.freeze({
    watermarkAdmissionEnabled,
    postProcessReportEnabled,
    settleMs: boundedInteger(env?.MKT_TIKTOK_WATERMARK_SETTLE_MS, 5_000, 0, 60_000, 'MKT_TIKTOK_WATERMARK_SETTLE_MS'),
    d1ReportMaxContentRecords: boundedInteger(
      env?.MKT_REPORT_D1_MAX_CONTENT_RECORDS,
      10_000,
      1,
      50_000,
      'MKT_REPORT_D1_MAX_CONTENT_RECORDS',
    ),
    reportFloatTolerance: boundedNumber(
      env?.MKT_REPORT_D1_FLOAT_TOLERANCE,
      1e-9,
      0,
      0.01,
      'MKT_REPORT_D1_FLOAT_TOLERANCE',
    ),
  });
}

function readBoolean(value, fieldName) {
  if (value === undefined || value === null || value === '') return false;
  if (value === true || value === false) return value;
  if (typeof value !== 'string') throw invalidConfig(`${fieldName} must be true or false`, fieldName);
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw invalidConfig(`${fieldName} must be true or false`, fieldName);
}

function boundedInteger(value, fallback, minimum, maximum, fieldName) {
  const number = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw invalidConfig(`${fieldName} must be from ${minimum} to ${maximum}`, fieldName);
  }
  return number;
}

function boundedNumber(value, fallback, minimum, maximum, fieldName) {
  const number = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw invalidConfig(`${fieldName} must be from ${minimum} to ${maximum}`, fieldName);
  }
  return number;
}

function invalidConfig(message, fieldName) {
  return permanentError(message, {
    code: 'MKT_TIKTOK_POST_LARK_CONFIG_INVALID',
    details: { fieldName },
  });
}
