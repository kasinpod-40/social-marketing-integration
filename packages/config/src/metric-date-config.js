import { requireDateOnly, todayInTimeZone } from '../../shared/src/date/date-only.js';
import { permanentError } from '../../shared/src/errors/runtime-error.js';

export const DEFAULT_REPORT_TIMEZONE = 'Asia/Bangkok';

/**
 * Resolve วันที่ Snapshot จาก Job override, Environment หรือวันที่ปัจจุบันของ Timezone ตามลำดับ
 * Config/Timezone ที่ผิดถูกแปลงเป็น Permanent RuntimeError เพื่อไม่ให้ Queue Retry วนโดยไม่มีประโยชน์
 */
export function resolveMetricDate(input = {}) {
  const env = input?.env ?? {};
  const hasOverride = input?.override !== null && input?.override !== undefined && input?.override !== '';
  const timezone = normalizeOptionalText(env?.DEFAULT_TIMEZONE) ?? DEFAULT_REPORT_TIMEZONE;
  const environmentValue = normalizeOptionalText(env?.METRIC_DATE);
  const value = hasOverride ? input.override : environmentValue;

  try {
    return requireDateOnly(value ?? todayInTimeZone(timezone), {
      label: hasOverride ? 'metricDate' : 'METRIC_DATE',
    });
  } catch (cause) {
    const code = hasOverride ? 'INVALID_SYNC_JOB' : 'MKT_RUNTIME_CONFIG_INVALID';
    const source = hasOverride ? 'queue metricDate' : environmentValue ? 'METRIC_DATE' : 'DEFAULT_TIMEZONE';
    throw permanentError(`Invalid ${source}: ${cause instanceof Error ? cause.message : 'unknown date error'}`, {
      code,
      cause,
      details: {
        fieldName: source,
        timezone: environmentValue || hasOverride ? null : timezone,
      },
    });
  }
}

/** คืนข้อความ Optional ที่ตัดช่องว่างแล้ว */
function normalizeOptionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
