import { requireDateOnly, todayInTimeZone } from '../../../shared/src/date/date-only.js';

const REPORT_DAY_COUNTS = Object.freeze({
  daily_organic_report: 1,
  weekly_organic_report: 7,
});

const COMPARISON_MODES = new Set(['none', 'previous_period']);

/**
 * Resolve ช่วงรายงานที่ปิดสมบูรณ์แล้วตาม Timezone
 * เมื่อไม่ส่ง periodEnd จะใช้ "เมื่อวาน" เพื่อไม่รายงานข้อมูลของวันนี้ที่ยังวิ่งอยู่
 */
export function resolveOrganicReportPeriod(input = {}) {
  const reportType = requireReportType(input.reportType);
  const timeZone = requireText(input.timeZone ?? 'Asia/Bangkok', 'timeZone');
  const comparisonMode = requireComparisonMode(input.comparisonMode ?? 'previous_period');
  const days = REPORT_DAY_COUNTS[reportType];
  const periodEnd = input.periodEnd
    ? requireDateOnly(input.periodEnd, { label: 'periodEnd' })
    : addDaysDateOnly(todayInTimeZone(timeZone, input.now ?? new Date()), -1);
  const periodStart = addDaysDateOnly(periodEnd, -(days - 1));

  if (comparisonMode === 'none') {
    return Object.freeze({
      reportType,
      periodStart,
      periodEnd,
      comparisonMode,
      compareStart: null,
      compareEnd: null,
      days,
    });
  }

  const compareEnd = addDaysDateOnly(periodStart, -1);
  const compareStart = addDaysDateOnly(compareEnd, -(days - 1));
  return Object.freeze({
    reportType,
    periodStart,
    periodEnd,
    comparisonMode,
    compareStart,
    compareEnd,
    days,
  });
}

/** เพิ่ม/ลดจำนวนวันบน Date-only โดยไม่พึ่ง Local timezone ของ Runtime */
export function addDaysDateOnly(value, days) {
  const date = requireDateOnly(value, { label: 'date' });
  if (!Number.isSafeInteger(days)) throw new TypeError('days must be an integer');
  const [year, month, day] = date.split('-').map(Number);
  const instant = new Date(Date.UTC(year, month - 1, day + days));
  return [
    String(instant.getUTCFullYear()).padStart(4, '0'),
    String(instant.getUTCMonth() + 1).padStart(2, '0'),
    String(instant.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

/** คืนจำนวนวันแบบ Inclusive ระหว่างสอง Date-only */
export function inclusiveDayCount(start, end) {
  const normalizedStart = requireDateOnly(start, { label: 'start' });
  const normalizedEnd = requireDateOnly(end, { label: 'end' });
  const startMs = Date.parse(`${normalizedStart}T00:00:00Z`);
  const endMs = Date.parse(`${normalizedEnd}T00:00:00Z`);
  if (endMs < startMs) throw new RangeError('end must not be before start');
  return Math.floor((endMs - startMs) / 86_400_000) + 1;
}

function requireReportType(value) {
  const text = requireText(value, 'reportType');
  if (!Object.hasOwn(REPORT_DAY_COUNTS, text)) {
    throw new Error(`Unsupported organic report type: ${text}`);
  }
  return text;
}

function requireComparisonMode(value) {
  const text = requireText(value, 'comparisonMode');
  if (!COMPARISON_MODES.has(text)) {
    throw new Error(`Unsupported report comparison mode: ${text}`);
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Report period requires ${fieldName}`);
  }
  return value.trim();
}
