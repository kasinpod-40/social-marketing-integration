import { requireDateOnly, todayInTimeZone } from '../../../shared/src/date/date-only.js';

const REPORT_DAY_COUNTS = Object.freeze({
  daily_organic_report: 1,
  weekly_organic_report: 7,
});

export const REPORT_ROLLING_PRESET_DAYS = Object.freeze([1, 3, 7, 9, 15, 30, 90]);
export const REPORT_PERIOD_KINDS = Object.freeze(['rolling_days', 'custom_range']);
export const DEFAULT_CUSTOM_RANGE_MAX_DAYS = 366;

const COMPARISON_MODES = new Set(['none', 'previous_period']);
const PERIOD_KINDS = new Set(REPORT_PERIOD_KINDS);

/** Resolve the shared rolling/custom Dashboard period contract. */
export function resolveReportPeriod(input = {}) {
  const timeZone = requireText(input.timeZone ?? 'Asia/Bangkok', 'timeZone');
  const comparisonMode = requireComparisonMode(input.comparisonMode ?? 'previous_period');
  const periodKind = requirePeriodKind(input.periodKind ?? 'rolling_days');
  const lastCompletedDay = addDaysDateOnly(
    todayInTimeZone(timeZone, input.now ?? new Date()),
    -1,
  );
  const periodEnd = input.periodEnd
    ? requireDateOnly(input.periodEnd, { label: 'periodEnd' })
    : lastCompletedDay;
  if (periodEnd > lastCompletedDay) {
    throw new RangeError('periodEnd must not be after the last completed reporting day');
  }

  let periodStart;
  let windowDays;
  if (periodKind === 'rolling_days') {
    windowDays = requirePresetDays(input.windowDays);
    periodStart = addDaysDateOnly(periodEnd, -(windowDays - 1));
  } else {
    periodStart = requireDateOnly(input.periodStart, { label: 'periodStart' });
    windowDays = inclusiveDayCount(periodStart, periodEnd);
    const maximum = positiveInteger(
      input.maxCustomRangeDays ?? DEFAULT_CUSTOM_RANGE_MAX_DAYS,
      'maxCustomRangeDays',
    );
    if (windowDays > maximum) {
      throw new RangeError(`custom report range exceeds ${maximum} inclusive days`);
    }
  }

  const comparison = comparisonMode === 'none'
    ? { compareStart: null, compareEnd: null }
    : previousPeriod(periodStart, windowDays);
  return Object.freeze({
    periodKind,
    windowDays,
    periodStart,
    periodEnd,
    comparisonMode,
    ...comparison,
    days: windowDays,
  });
}

/**
 * Resolve ช่วงรายงานที่ปิดสมบูรณ์แล้วตาม Timezone
 * เมื่อไม่ส่ง periodEnd จะใช้ "เมื่อวาน" เพื่อไม่รายงานข้อมูลของวันนี้ที่ยังวิ่งอยู่
 */
export function resolveOrganicReportPeriod(input = {}) {
  const reportType = requireReportType(input.reportType);
  const resolved = resolveReportPeriod({
    ...input,
    periodKind: input.periodKind ?? 'rolling_days',
    windowDays: input.windowDays ?? REPORT_DAY_COUNTS[reportType],
  });
  if (input.periodKind === undefined && input.windowDays === undefined) {
    const { periodKind: _periodKind, windowDays: _windowDays, ...legacy } = resolved;
    return Object.freeze({ reportType, ...legacy });
  }
  return Object.freeze({
    reportType,
    ...resolved,
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

function requirePeriodKind(value) {
  const text = requireText(value, 'periodKind').toLowerCase();
  if (!PERIOD_KINDS.has(text)) {
    throw new Error(`Unsupported report period kind: ${text}`);
  }
  return text;
}

function requirePresetDays(value) {
  const days = positiveInteger(value, 'windowDays');
  if (!REPORT_ROLLING_PRESET_DAYS.includes(days)) {
    throw new RangeError(`windowDays must be one of: ${REPORT_ROLLING_PRESET_DAYS.join(', ')}`);
  }
  return days;
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`Report period requires positive integer ${fieldName}`);
  }
  return number;
}

function previousPeriod(periodStart, days) {
  const compareEnd = addDaysDateOnly(periodStart, -1);
  return {
    compareStart: addDaysDateOnly(compareEnd, -(days - 1)),
    compareEnd,
  };
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Report period requires ${fieldName}`);
  }
  return value.trim();
}
