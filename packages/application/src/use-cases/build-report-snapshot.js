import { requireDateOnly } from '../../../shared/src/date/date-only.js';
import { toEpochMilliseconds } from '../../../shared/src/date/date-time.js';

const REPORT_TYPES = new Set([
  'weekly_organic_report',
  'monthly_organic_report',
  'ads_performance_report',
  'course_campaign_report',
  'top_content_report',
  'platform_strength_weakness_report',
  'executive_summary_report',
  'yoy_report',
]);

const COMPARISON_MODES = new Set(['none', 'previous_period', 'year_over_year', 'custom_range']);

/**
 * สร้างหนึ่งแถวสำหรับ MKT_Report_Snapshots
 *
 * ตัวเลขใน metric/top content/top ads ต้องถูกระบบคำนวณเสร็จก่อน
 * แล้วจึงเก็บเป็น Stable JSON เพื่อให้ Lark AI สรุปจากข้อมูลจริง ไม่คำนวณเองแบบเดา
 */
export function buildReportSnapshot(input) {
  const reportType = requireOption(input?.reportType, REPORT_TYPES, 'reportType');
  const periodStart = requireDateOnly(input?.periodStart, { label: 'periodStart' });
  const periodEnd = requireDateOnly(input?.periodEnd, { label: 'periodEnd' });
  const comparisonMode = requireOption(
    input?.comparisonMode ?? 'none',
    COMPARISON_MODES,
    'comparisonMode',
  );
  const compareStart = optionalDate(input?.compareStart, 'compareStart');
  const compareEnd = optionalDate(input?.compareEnd, 'compareEnd');
  const platforms = normalizePlatforms(input?.platforms);
  const courseName = normalizeNullableText(input?.courseName);
  const generatedAt = normalizeIsoDateTime(input?.generatedAt ?? new Date().toISOString(), 'generatedAt');

  assertDateRange(periodStart, periodEnd, 'report period');
  if (comparisonMode !== 'none') {
    if (!compareStart || !compareEnd) {
      throw new Error('Comparison report snapshot requires compareStart and compareEnd');
    }
    assertDateRange(compareStart, compareEnd, 'comparison period');
  } else if (compareStart || compareEnd) {
    throw new Error('comparisonMode=none must not include compareStart or compareEnd');
  }

  return Object.freeze({
    report_id: createReportId({
      reportType,
      periodStart,
      periodEnd,
      compareStart,
      compareEnd,
      comparisonMode,
      platforms,
      courseName,
    }),
    report_type: reportType,
    period_start: periodStart,
    period_end: periodEnd,
    compare_start: compareStart,
    compare_end: compareEnd,
    comparison_mode: comparisonMode,
    platform: Object.freeze(platforms),
    course_name: courseName,
    metric_payload_json: stableStringify(requirePlainObject(input?.metricPayload, 'metricPayload')),
    top_content_json: stableStringify(input?.topContent ?? []),
    top_ads_json: stableStringify(input?.topAds ?? []),
    generated_at: generatedAt,
  });
}

/** สร้าง Stable report ID จากทุกมิติที่กำหนดเอกลักษณ์ของ Snapshot */
function createReportId(input) {
  const platformDimension = input.platforms
    .map((platform) => escapeReportIdentityPart(platform))
    .join('+');

  return [
    input.reportType,
    input.periodStart,
    input.periodEnd,
    input.comparisonMode,
    input.compareStart ?? 'none',
    input.compareEnd ?? 'none',
    platformDimension,
    escapeReportIdentityPart(input.courseName ?? 'all_courses'),
  ].join('::');
}

/**
 * Escape เฉพาะ Separator ของ Report ID เพื่อป้องกัน Key collision แต่ยังคงชื่อคอร์สให้อ่านง่าย
 * ต้อง Escape % ก่อนเสมอเพื่อไม่ให้ข้อความจริง %3A ถูกตีความเหมือน Colon ที่ Escape แล้ว
 */
function escapeReportIdentityPart(value) {
  return requireText(value, 'report identity part')
    .replace(/%/gu, '%25')
    .replace(/:/gu, '%3A')
    .replace(/\+/gu, '%2B');
}

/** Normalize Platform ให้ไม่ซ้ำ ตัวพิมพ์เล็ก และเรียงลำดับคงที่ */
function normalizePlatforms(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('Report snapshot requires non-empty platforms array');
  }

  return [...new Set(value.map((item) => requireText(item, 'platform').toLowerCase()))].sort();
}

/** Serialize JSON แบบเรียง Object key ทุกระดับเพื่อให้ Diff และ Hash คงที่ */
function stableStringify(value) {
  return JSON.stringify(sortDeep(value));
}

/** เรียง Object key แบบ Recursive และปฏิเสธค่าที่ JSON รองรับไม่ชัดเจน */
function sortDeep(value, seen = new WeakSet()) {
  // Array ต้องตรวจสมาชิกทุกตัว เพราะ JSON.stringify จะแปลง undefined/NaN เป็น null เงียบ ๆ
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError('Report snapshot payload must not contain circular references');
    seen.add(value);
    const sortedItems = value.map((item) => sortDeep(item, seen));
    seen.delete(value);
    return sortedItems;
  }

  // ยอมรับเฉพาะ Plain object เพื่อไม่ให้ Date/Map/Set ถูกแปลงเป็น {} และทำข้อมูลสูญหาย
  if (value && typeof value === 'object') {
    if (!isPlainObject(value)) {
      throw new TypeError('Report snapshot payload must contain only plain JSON objects and arrays');
    }
    if (seen.has(value)) throw new TypeError('Report snapshot payload must not contain circular references');
    seen.add(value);
    const sorted = Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortDeep(nested, seen)]),
    );
    seen.delete(value);
    return sorted;
  }

  // ปฏิเสธค่าที่ JSON จะลบหรือเปลี่ยนความหมายโดยไม่แจ้ง เช่น undefined, NaN และ Infinity
  if (value === undefined
    || typeof value === 'bigint'
    || typeof value === 'function'
    || typeof value === 'symbol'
    || (typeof value === 'number' && !Number.isFinite(value))) {
    throw new TypeError('Report snapshot payload contains a non-JSON value');
  }
  return value;
}

/** ตรวจ Object ที่มี Prototype เป็น Object.prototype หรือ null เท่านั้น */
function isPlainObject(value) {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** ตรวจค่าที่ต้องอยู่ใน Set ที่ระบบรองรับ */
function requireOption(value, allowed, fieldName) {
  const text = requireText(value, fieldName);
  if (!allowed.has(text)) throw new Error(`${fieldName} is not supported: ${text}`);
  return text;
}

/** อ่านวันที่ Optional ด้วย Validator กลาง */
function optionalDate(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return requireDateOnly(value, { label: fieldName });
}

/** ตรวจวันที่เริ่มไม่เกินวันที่สิ้นสุด */
function assertDateRange(start, end, label) {
  if (start > end) throw new RangeError(`${label} start must not be after end`);
}

/** Normalize ISO datetime ให้เป็น UTC ISO string และบังคับ Timezone ชัดเจน */
function normalizeIsoDateTime(value, fieldName) {
  const text = requireText(value, fieldName);
  const epochMs = toEpochMilliseconds(text, { label: fieldName });
  return new Date(epochMs).toISOString();
}

/** บังคับ Plain Object สำหรับ metric payload */
function requirePlainObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Report snapshot requires object ${fieldName}`);
  }
  return value;
}

/** Normalize Course name ที่เป็น Optional */
function normalizeNullableText(value) {
  if (value === null || value === undefined || value === '') return null;
  return requireText(value, 'courseName');
}

/** บังคับข้อความที่ไม่ว่าง */
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Report snapshot requires ${fieldName}`);
  }
  return value.trim();
}
